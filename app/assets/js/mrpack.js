/**
 * Compartir instancias con el formato oficial de Modrinth (.mrpack).
 *
 * Exportar: modrinth.index.json con la versión de Minecraft, el loader y los archivos
 * que están en Modrinth (por referencia, con sus hashes y URL); el resto (mods que no
 * están en Modrinth, config y options.txt) va dentro del archivo en overrides/.
 *
 * Importar: lee el índice, crea la instancia, baja los archivos verificando su hash
 * y copia overrides/ y client-overrides/ a la carpeta de la instancia. Rechaza rutas
 * que intenten salir de la instancia.
 */
const fs       = require('fs-extra')
const path     = require('path')
const crypto   = require('crypto')
const AdmZip   = require('adm-zip')
const { LoggerUtil } = require('helios-core')

const Modrinth   = require('./modrinth')
const Instancias = require('./instancias')

const logger = LoggerUtil.getLogger('Mrpack')

const LOADER_A_DEPENDENCIA = { fabric: 'fabric-loader', forge: 'forge', neoforge: 'neoforge' }
const DEPENDENCIA_A_LOADER = { 'fabric-loader': 'fabric', forge: 'forge', neoforge: 'neoforge' }
const CARPETAS_EXPORTADAS = ['mods', 'resourcepacks', 'shaderpacks']
const EXTRAS_EXPORTADOS = ['config', 'options.txt']

function errorMostrable(mensaje){
    return Object.assign(new Error(mensaje), { displayable: mensaje })
}

/**
 * Ruta segura dentro de la instancia, o null si intenta salir (../, absoluta, unidad).
 */
function rutaSegura(base, relativa){
    if(typeof relativa !== 'string' || relativa.length === 0 || path.isAbsolute(relativa) || /^[a-zA-Z]:/.test(relativa)){
        return null
    }
    const destino = path.resolve(base, relativa)
    return destino.startsWith(path.resolve(base) + path.sep) ? destino : null
}
exports.rutaSegura = rutaSegura

function hash(datos, algo){
    return crypto.createHash(algo).update(datos).digest('hex')
}

/* ---------- Exportar ---------- */

/**
 * @param {Object} inst La instancia.
 * @param {string} destino Ruta del .mrpack a crear.
 * @returns {Promise<{referencias: number, incluidos: number}>}
 */
exports.exportar = async function(inst, destino){
    const carpeta = Instancias.carpeta(inst.id)
    const zip = new AdmZip()
    const archivos = []
    let incluidos = 0

    for(const sub of CARPETAS_EXPORTADAS){
        const dir = path.join(carpeta, sub)
        if(!await fs.pathExists(dir)){
            continue
        }
        const nombres = (await fs.readdir(dir)).filter(n => /\.(jar|zip)$/i.test(n))
        const datosPorNombre = {}
        const hashes = []
        for(const n of nombres){
            const datos = await fs.readFile(path.join(dir, n))
            datosPorNombre[n] = datos
            hashes.push(hash(datos, 'sha1'))
        }
        // Los que están en Modrinth van por referencia.
        let versiones = {}
        if(hashes.length > 0){
            try {
                const res = await fetch('https://api.modrinth.com/v2/version_files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hashes, algorithm: 'sha1' }),
                    signal: AbortSignal.timeout(15000)
                })
                versiones = res.ok ? await res.json() : {}
            } catch(err) {
                logger.warn('No se pudo consultar Modrinth al exportar; todo va dentro del archivo.', err.message)
            }
        }
        nombres.forEach((n, i) => {
            const v = versiones[hashes[i]]
            const archivo = v?.files?.find(f => f.hashes?.sha1 === hashes[i])
            if(archivo){
                archivos.push({
                    path: `${sub}/${n}`,
                    hashes: { sha1: hashes[i], sha512: archivo.hashes.sha512 ?? hash(datosPorNombre[n], 'sha512') },
                    downloads: [archivo.url],
                    fileSize: datosPorNombre[n].length
                })
            } else {
                zip.addFile(`overrides/${sub}/${n}`, datosPorNombre[n])
                incluidos++
            }
        })
    }

    for(const extra of EXTRAS_EXPORTADOS){
        const ruta = path.join(carpeta, extra)
        if(!await fs.pathExists(ruta)){
            continue
        }
        if((await fs.stat(ruta)).isDirectory()){
            zip.addLocalFolder(ruta, `overrides/${extra}`)
        } else {
            zip.addLocalFile(ruta, 'overrides')
        }
    }

    const dependencias = { minecraft: inst.mc }
    if(LOADER_A_DEPENDENCIA[inst.loader]){
        dependencias[LOADER_A_DEPENDENCIA[inst.loader]] = inst.loaderVersion
    }
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1.0.0',
        name: inst.nombre,
        summary: 'Exportado desde Potatox Launcher',
        files: archivos,
        dependencies: dependencias
    }, null, 2)))
    await fs.ensureDir(path.dirname(destino))
    zip.writeZip(destino)
    return { referencias: archivos.length, incluidos }
}

/* ---------- Importar ---------- */

/**
 * Lee el índice de un .mrpack y dice qué instancia saldría.
 *
 * @returns {{nombre: string, mc: string, loader: string, loaderVersion: string|null, archivos: number}}
 */
exports.leer = function(rutaMrpack){
    let indice
    try {
        indice = JSON.parse(new AdmZip(rutaMrpack).readAsText('modrinth.index.json'))
    } catch(_err) {
        throw errorMostrable(Lang().queryJS('inicio.mrpack.invalido'))
    }
    const deps = indice.dependencies ?? {}
    if(!deps.minecraft){
        throw errorMostrable(Lang().queryJS('inicio.mrpack.invalido'))
    }
    let loader = 'vanilla'
    let loaderVersion = null
    for(const [dep, l] of Object.entries(DEPENDENCIA_A_LOADER)){
        if(deps[dep]){
            loader = l
            loaderVersion = deps[dep]
        }
    }
    if(deps['quilt-loader']){
        throw errorMostrable(Lang().queryJS('inicio.mrpack.quilt'))
    }
    // Forge en Modrinth viene como "47.4.0"; el launcher usa lo mismo.
    if(loader === 'forge' && loaderVersion?.startsWith(`${deps.minecraft}-`)){
        loaderVersion = loaderVersion.substring(deps.minecraft.length + 1)
    }
    return {
        nombre: (indice.name || 'Modpack').substring(0, 40),
        mc: deps.minecraft,
        loader,
        loaderVersion,
        archivos: (indice.files ?? []).length
    }
}

function Lang(){
    return require('./langloader')
}

/**
 * Crea una instancia a partir de un .mrpack.
 *
 * @param {string} rutaMrpack
 * @param {{alDetalle?: Function, alProgreso?: Function, nombre?: string}} o
 * @returns {Promise<Object>} La instancia creada.
 */
exports.importar = async function(rutaMrpack, o = {}){
    const datos = exports.leer(rutaMrpack)
    await Instancias.validarLoader(datos)
    const zip = new AdmZip(rutaMrpack)
    const indice = JSON.parse(zip.readAsText('modrinth.index.json'))
    const inst = Instancias.crear({ nombre: o.nombre || datos.nombre, mc: datos.mc, loader: datos.loader, loaderVersion: datos.loaderVersion })
    const carpeta = Instancias.carpeta(inst.id)
    try {
        // Archivos por referencia (solo los del cliente).
        const archivos = (indice.files ?? []).filter(f => f.env?.client !== 'unsupported')
        let hechos = 0
        for(const f of archivos){
            const destino = rutaSegura(carpeta, f.path)
            if(destino == null){
                throw errorMostrable(Lang().queryJS('inicio.mrpack.rutaInvalida', { ruta: f.path }))
            }
            const url = (f.downloads ?? []).find(u => /^https:\/\//i.test(u))
            if(url == null){
                throw errorMostrable(Lang().queryJS('inicio.mrpack.sinDescarga', { ruta: f.path }))
            }
            o.alDetalle?.(path.basename(f.path))
            await Modrinth.bajar({ url, filename: path.basename(f.path), hashes: { sha1: f.hashes?.sha1 } }, destino)
            hechos++
            o.alProgreso?.(Math.trunc(hechos / Math.max(1, archivos.length) * 100))
        }
        // overrides/ y luego client-overrides/ (que pisa).
        for(const prefijo of ['overrides/', 'client-overrides/']){
            for(const entrada of zip.getEntries()){
                if(entrada.isDirectory || !entrada.entryName.startsWith(prefijo)){
                    continue
                }
                const relativa = entrada.entryName.substring(prefijo.length)
                const destino = rutaSegura(carpeta, relativa)
                if(destino == null){
                    throw errorMostrable(Lang().queryJS('inicio.mrpack.rutaInvalida', { ruta: entrada.entryName }))
                }
                await fs.outputFile(destino, entrada.getData())
            }
        }
    } catch(err) {
        // Nada a medio crear: se borra la instancia.
        Instancias.quitar(inst.id)
        await fs.remove(carpeta)
        throw err
    }
    return inst
}
