/**
 * Modrinth (API oficial v2, sin clave): buscar e instalar mods, resource packs,
 * shaders y modpacks, con sus dependencias obligatorias, y ver qué está instalado
 * o tiene actualización.
 *
 * Se manda un User-Agent propio y se respeta el rate limit: si Modrinth responde
 * 429, se espera lo que indica antes de reintentar.
 */
const fs       = require('fs-extra')
const path     = require('path')
const crypto   = require('crypto')
const { app }  = require('@electron/remote')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('Modrinth')

const API = 'https://api.modrinth.com/v2'
const USER_AGENT = `Potatox-Launcher/${app.getVersion()} (github.com/MrPotatoXx/PotatoxLauncher)`

/** Carpeta de cada tipo dentro de la instancia. */
exports.CARPETAS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }

/* ---------- Pedidos ---------- */

let pausaHasta = 0

async function pedir(ruta, opciones = {}, intentos = 3){
    const espera = pausaHasta - Date.now()
    if(espera > 0){
        await new Promise(r => setTimeout(r, espera))
    }
    const res = await fetch(API + ruta, {
        ...opciones,
        headers: { 'User-Agent': USER_AGENT, ...(opciones.body ? { 'Content-Type': 'application/json' } : {}), ...(opciones.headers ?? {}) },
        signal: AbortSignal.timeout(15000)
    })
    // Si quedan pocos pedidos en la ventana, se frena hasta que se renueve.
    const restantes = Number(res.headers.get('X-Ratelimit-Remaining'))
    const reinicio = Number(res.headers.get('X-Ratelimit-Reset'))
    if(!isNaN(restantes) && restantes < 5 && !isNaN(reinicio)){
        pausaHasta = Date.now() + reinicio * 1000
    }
    if(res.status === 429 && intentos > 0){
        const segundos = Number(res.headers.get('X-Ratelimit-Reset')) || 5
        logger.warn(`Rate limit de Modrinth: espero ${segundos} s.`)
        pausaHasta = Date.now() + segundos * 1000
        return pedir(ruta, opciones, intentos - 1)
    }
    if(res.status === 404){
        return null
    }
    if(!res.ok){
        throw new Error(`Modrinth respondió ${res.status} en ${ruta}`)
    }
    return res.json()
}

const q = obj => '?' + Object.entries(obj)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`)
    .join('&')

/* ---------- Búsqueda ---------- */

/**
 * Loader de Modrinth para un loader del launcher.
 */
function loaderModrinth(loader){
    return { fabric: 'fabric', forge: 'forge', neoforge: 'neoforge', vanilla: null }[loader] ?? null
}
exports.loaderModrinth = loaderModrinth

/**
 * @param {{texto: string, tipo: 'mod'|'resourcepack'|'shader'|'modpack', mc?: string, loader?: string,
 *   soloCliente?: boolean, offset?: number, limite?: number}} o
 * @returns {Promise<{hits: Array, total: number}>}
 */
exports.buscar = async function(o){
    const facetas = [[`project_type:${o.tipo}`]]
    if(o.mc){
        facetas.push([`versions:${o.mc}`])
    }
    const loader = loaderModrinth(o.loader)
    if(loader && (o.tipo === 'mod' || o.tipo === 'modpack')){
        facetas.push([`categories:${loader}`])
    }
    if(o.soloCliente){
        // Mods de cliente: corren en el cliente y el servidor no los necesita.
        facetas.push(['client_side:required', 'client_side:optional'])
        facetas.push(['server_side:optional', 'server_side:unsupported'])
    }
    const d = await pedir('/search' + q({
        query: o.texto || null,
        facets: facetas,
        index: o.texto ? 'relevance' : 'downloads',
        offset: o.offset ?? 0,
        limit: o.limite ?? 20
    }))
    return { hits: d?.hits ?? [], total: d?.total_hits ?? 0 }
}

/**
 * La versión compatible más nueva de un proyecto.
 */
async function versionCompatible(proyecto, { tipo, mc, loader }){
    const params = {}
    if(mc){
        params.game_versions = [mc]
    }
    if(tipo === 'mod' || tipo === 'modpack'){
        const l = loaderModrinth(loader)
        if(l){
            params.loaders = [l]
        }
    } else if(tipo === 'resourcepack'){
        params.loaders = ['minecraft']
    }
    const versiones = await pedir(`/project/${encodeURIComponent(proyecto)}/version` + q(params))
    if(!Array.isArray(versiones) || versiones.length === 0){
        return null
    }
    // Primero las release; Modrinth las devuelve de la más nueva a la más vieja.
    return versiones.find(v => v.version_type === 'release') ?? versiones[0]
}
exports.versionCompatible = versionCompatible

function archivoPrincipal(version){
    return version.files.find(f => f.primary) ?? version.files[0]
}
exports.archivoPrincipal = archivoPrincipal

/* ---------- Hashes: qué está instalado ---------- */

function sha1(ruta){
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha1')
        fs.createReadStream(ruta).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')))
    })
}
exports.sha1 = sha1

async function archivosDe(carpeta){
    if(!await fs.pathExists(carpeta)){
        return []
    }
    const nombres = (await fs.readdir(carpeta)).filter(n => /\.(jar|zip)(\.disabled)?$/i.test(n))
    return Promise.all(nombres.map(async n => ({ nombre: n, ruta: path.join(carpeta, n), hash: await sha1(path.join(carpeta, n)) })))
}

/**
 * Lo instalado en una carpeta que viene de Modrinth, y si hay actualización.
 *
 * @returns {Promise<Map<string, {archivo: string, ruta: string, proyecto: string, version: Object, nueva: Object|null}>>}
 *   Por id de proyecto.
 */
exports.instalados = async function(carpeta, { tipo, mc, loader }){
    const archivos = await archivosDe(carpeta)
    const resultado = new Map()
    if(archivos.length === 0){
        return resultado
    }
    const hashes = archivos.map(a => a.hash)
    const versiones = await pedir('/version_files', { method: 'POST', body: JSON.stringify({ hashes, algorithm: 'sha1' }) }) ?? {}
    const cuerpo = { hashes, algorithm: 'sha1' }
    if(mc){
        cuerpo.game_versions = [mc]
    }
    const l = tipo === 'mod' ? loaderModrinth(loader) : (tipo === 'resourcepack' ? 'minecraft' : null)
    if(l){
        cuerpo.loaders = [l]
    }
    let nuevas = {}
    try {
        nuevas = await pedir('/version_files/update', { method: 'POST', body: JSON.stringify(cuerpo) }) ?? {}
    } catch(err) {
        logger.warn('No se pudieron revisar actualizaciones.', err.message)
    }
    for(const a of archivos){
        const v = versiones[a.hash]
        if(v == null){
            continue
        }
        const nueva = nuevas[a.hash]
        resultado.set(v.project_id, {
            archivo: a.nombre,
            ruta: a.ruta,
            hash: a.hash,
            proyecto: v.project_id,
            version: v,
            nueva: nueva && nueva.id !== v.id ? nueva : null
        })
    }
    return resultado
}

/* ---------- Instalar ---------- */

async function bajar(archivo, destino){
    const res = await fetch(archivo.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120000) })
    if(!res.ok){
        throw new Error(`No se pudo bajar ${archivo.filename} (${res.status})`)
    }
    const datos = Buffer.from(await res.arrayBuffer())
    const hash = crypto.createHash('sha1').update(datos).digest('hex')
    if(archivo.hashes?.sha1 && hash !== archivo.hashes.sha1){
        throw new Error(`El archivo ${archivo.filename} llegó dañado`)
    }
    await fs.outputFile(destino + '.tmp', datos)
    await fs.move(destino + '.tmp', destino, { overwrite: true })
}
exports.bajar = bajar

/**
 * Instala un proyecto (versión compatible más nueva) y sus dependencias obligatorias.
 *
 * @param {string} proyecto Id o slug del proyecto.
 * @param {{tipo: string, mc: string, loader: string, carpeta: string, alDetalle?: Function}} o
 * @returns {Promise<string[]>} Los archivos instalados.
 */
exports.instalar = async function(proyecto, o){
    const yaInstalados = new Set((await exports.instalados(o.carpeta, o)).keys())
    const vistos = new Set()
    const instalados = []

    const instalarUno = async (idProyecto, idVersion) => {
        if(vistos.has(idProyecto ?? idVersion)){
            return
        }
        vistos.add(idProyecto ?? idVersion)
        const version = idVersion ? await pedir(`/version/${idVersion}`) : await versionCompatible(idProyecto, o)
        if(version == null){
            throw Object.assign(new Error('Sin versión compatible'), { sinVersion: idProyecto })
        }
        if(yaInstalados.has(version.project_id)){
            return
        }
        const archivo = archivoPrincipal(version)
        o.alDetalle?.(archivo.filename)
        await bajar(archivo, path.join(o.carpeta, archivo.filename))
        instalados.push(archivo.filename)
        yaInstalados.add(version.project_id)
        for(const dep of version.dependencies ?? []){
            if(dep.dependency_type === 'required' && o.tipo === 'mod'){
                await instalarUno(dep.project_id, dep.project_id ? null : dep.version_id)
            }
        }
    }

    await fs.ensureDir(o.carpeta)
    await instalarUno(proyecto, null)
    return instalados
}

/**
 * Cambia un archivo instalado por su versión nueva (el viejo va a la papelera si se puede).
 */
exports.actualizar = async function(instalado, alPapelera){
    const archivo = archivoPrincipal(instalado.nueva)
    const destino = path.join(path.dirname(instalado.ruta), archivo.filename)
    await bajar(archivo, destino)
    if(destino.toLowerCase() !== instalado.ruta.toLowerCase()){
        const ok = await alPapelera(instalado.ruta)
        if(!ok){
            await fs.remove(instalado.ruta)
        }
    }
    return archivo.filename
}

/** Datos de varios proyectos (nombre e ícono para la lista de instalados). */
exports.proyectos = async function(ids){
    if(ids.length === 0){
        return []
    }
    return await pedir('/projects' + q({ ids })) ?? []
}

exports.urlProyecto = function(hit){
    const tipo = hit.project_type ?? 'mod'
    return `https://modrinth.com/${tipo}/${hit.slug ?? hit.project_id}`
}
