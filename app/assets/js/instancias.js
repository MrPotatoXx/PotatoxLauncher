/**
 * Instancias propias del jugador: Vanilla, Fabric, Forge y NeoForge.
 *
 * Cada instancia vive en <instances>/local-<nombre>, aparte de los servidores
 * (que usan su id del distribution.json) y nunca dentro de .minecraft.
 * Las librerías, versiones y assets se comparten en common/, igual que los servidores.
 *
 * La lista se guarda en <userData>/instancias.json.
 */
const fs            = require('fs-extra')
const path          = require('path')
const got           = require('got')
const { fork }      = require('child_process')
const { HeliosServer, mcVersionAtLeast } = require('helios-core/common')
const { LoggerUtil } = require('helios-core')

const ConfigManager = require('./configmanager')
const Lang          = require('./langloader')
const InstaladorForge = require('./instaladorforge')

const logger = LoggerUtil.getLogger('Instancias')

const PREFIJO = 'local-'
const MANIFEST_MOJANG = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const META_FABRIC = 'https://meta.fabricmc.net/v2'
const URL_FORGE_META = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
const URL_FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const URL_NEOFORGE = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
const TIMEOUT = { request: 15000 }

const archivo = () => path.join(ConfigManager.getLauncherDirectory(), 'instancias.json')

let datos = null

/* ---------- Loaders ---------- */

let cacheMojang = null
let cacheFabricJuegos = null
const cacheFabricLoaders = new Map()

async function manifestMojang(){
    if(cacheMojang == null){
        cacheMojang = await got.get(MANIFEST_MOJANG, { responseType: 'json', timeout: TIMEOUT }).json()
    }
    return cacheMojang
}

/**
 * Cada loader dice si está disponible, qué versiones de Minecraft soporta,
 * qué versiones propias tiene y cómo se arma para lanzar. Forge y NeoForge
 * corren su instalador oficial la primera vez (instaladorforge.js).
 */
const LOADERS = {
    vanilla: {
        id: 'vanilla',
        nombre: 'Vanilla',
        disponible: true,
        conVersion: false,
        async versionesMinecraft(snapshots = false){
            const m = await manifestMojang()
            return m.versions
                .filter(v => v.type === 'release' || (snapshots && v.type === 'snapshot'))
                .map(v => ({ id: v.id, estable: v.type === 'release' }))
        },
        async versionesLoader(){
            return []
        },
        async perfil(){
            // Vanilla no agrega nada encima de Minecraft.
            return { modManifest: null, modulos: [] }
        }
    },
    fabric: {
        id: 'fabric',
        nombre: 'Fabric',
        disponible: true,
        conVersion: true,
        async versionesMinecraft(snapshots = false){
            if(cacheFabricJuegos == null){
                cacheFabricJuegos = await got.get(`${META_FABRIC}/versions/game`, { responseType: 'json', timeout: TIMEOUT }).json()
            }
            // En el orden de Mojang (más nueva primero), solo las que Fabric soporta.
            const soportadas = new Set(cacheFabricJuegos.filter(v => snapshots || v.stable).map(v => v.version))
            const m = await manifestMojang()
            return m.versions
                .filter(v => soportadas.has(v.id) && (snapshots || v.type === 'release'))
                .map(v => ({ id: v.id, estable: v.type === 'release' }))
        },
        async versionesLoader(mc){
            // Los loaders dependen de la versión de Minecraft; se guardan por versión.
            if(!cacheFabricLoaders.has(mc)){
                const lista = await got.get(`${META_FABRIC}/versions/loader/${encodeURIComponent(mc)}`, { responseType: 'json', timeout: TIMEOUT }).json()
                cacheFabricLoaders.set(mc, lista.map(e => ({ id: e.loader.version, estable: e.loader.stable })))
            }
            return [...cacheFabricLoaders.get(mc)]
        },
        async perfil(inst){
            const id = `fabric-loader-${inst.loaderVersion}-${inst.mc}`
            const local = path.join(ConfigManager.getCommonDirectory(), 'versions', id, `${id}.json`)
            let perfil
            try {
                perfil = await got.get(`${META_FABRIC}/versions/loader/${encodeURIComponent(inst.mc)}/${encodeURIComponent(inst.loaderVersion)}/profile/json`,
                    { responseType: 'json', timeout: TIMEOUT }).json()
                await fs.outputJson(local, perfil)
            } catch(err) {
                // Sin internet: sirve el perfil que ya se bajó antes.
                if(await fs.pathExists(local)){
                    logger.warn('No se pudo bajar el perfil de Fabric, uso el guardado.')
                    perfil = await fs.readJson(local)
                } else {
                    throw err
                }
            }
            return { modManifest: perfil, modulos: modulosFabric(perfil) }
        }
    },
    forge: {
        id: 'forge',
        nombre: 'Forge',
        disponible: true,
        conVersion: true,
        // El instalador corre con el Java de esa versión de Minecraft: el perfil se arma
        // después de resolver Java (lanzarInstancia en landing.js).
        necesitaJava: true,
        async versionesMinecraft(){
            const meta = await forgeMeta()
            const soportadas = new Set(Object.keys(meta))
            const m = await manifestMojang()
            // Forge no publica snapshots; antes de 1.13 usaba otro sistema de arranque.
            return m.versions
                .filter(v => soportadas.has(v.id) && v.type === 'release' && mcVersionAtLeast('1.13', v.id))
                .map(v => ({ id: v.id, estable: true }))
        },
        async versionesLoader(mc){
            const [meta, promos] = await Promise.all([forgeMeta(), forgePromos()])
            const lista = (meta[mc] ?? [])
                .filter(v => v.startsWith(`${mc}-`))
                .map(v => v.substring(mc.length + 1))
                .reverse()
            const recomendada = promos[`${mc}-recommended`]
            const ultima = promos[`${mc}-latest`]
            const porDefecto = recomendada ?? ultima ?? lista[0]
            return lista.map(v => ({
                id: v,
                estable: true,
                etiqueta: v === recomendada ? 'recomendada' : (v === ultima ? 'ultima' : null),
                predeterminada: v === porDefecto
            }))
        },
        urlInstalador({ mc, loaderVersion }){
            const id = `${mc}-${loaderVersion}`
            return `https://maven.minecraftforge.net/net/minecraftforge/forge/${id}/forge-${id}-installer.jar`
        },
        async perfil(inst, ctx){
            return perfilConInstalador(this, inst, ctx)
        }
    },
    neoforge: {
        id: 'neoforge',
        nombre: 'NeoForge',
        disponible: true,
        conVersion: true,
        necesitaJava: true,
        async versionesMinecraft(snapshots = false){
            const mcs = new Set((await neoforgeLista()).map(mcDeNeoForge).filter(Boolean))
            const m = await manifestMojang()
            return m.versions
                .filter(v => mcs.has(v.id) && (snapshots || v.type === 'release'))
                .map(v => ({ id: v.id, estable: v.type === 'release' }))
        },
        async versionesLoader(mc){
            const lista = (await neoforgeLista()).filter(v => mcDeNeoForge(v) === mc).reverse()
            // Por defecto, la más nueva que no sea beta.
            const porDefecto = lista.find(v => !v.includes('-')) ?? lista[0]
            return lista.map(v => ({
                id: v,
                estable: !v.includes('-'),
                etiqueta: v.includes('-') ? 'beta' : null,
                predeterminada: v === porDefecto
            }))
        },
        urlInstalador({ loaderVersion }){
            return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
        },
        async perfil(inst, ctx){
            return perfilConInstalador(this, inst, ctx)
        }
    }
}

/* ---------- Forge y NeoForge ---------- */

let cacheForgeMeta = null
let cacheForgePromos = null
let cacheNeoforge = null

async function forgeMeta(){
    if(cacheForgeMeta == null){
        cacheForgeMeta = await got.get(URL_FORGE_META, { responseType: 'json', timeout: TIMEOUT }).json()
    }
    return cacheForgeMeta
}

async function forgePromos(){
    if(cacheForgePromos == null){
        try {
            cacheForgePromos = (await got.get(URL_FORGE_PROMOS, { responseType: 'json', timeout: TIMEOUT }).json()).promos ?? {}
        } catch(err) {
            logger.warn('No se pudieron leer las versiones recomendadas de Forge.', err.message)
            return {}
        }
    }
    return cacheForgePromos
}

async function neoforgeLista(){
    if(cacheNeoforge == null){
        cacheNeoforge = (await got.get(URL_NEOFORGE, { responseType: 'json', timeout: TIMEOUT }).json()).versions ?? []
    }
    return cacheNeoforge
}

/**
 * La versión de Minecraft de una versión de NeoForge: 21.1.x es 1.21.1, 21.0.x es 1.21,
 * y desde 26: 26.1.0.x es 26.1 y 26.1.1.x es 26.1.1. Las versiones raras (0.25w14...) quedan fuera.
 */
function mcDeNeoForge(version){
    const p = version.split('-')[0].split('.').map(Number)
    if(p.length < 3 || p.some(isNaN) || p[0] < 20){
        return null
    }
    if(p[0] >= 26){
        return p[2] ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`
    }
    return p[1] ? `1.${p[0]}.${p[1]}` : `1.${p[0]}`
}
exports.mcDeNeoForge = mcDeNeoForge

/**
 * Perfil de una instancia Forge o NeoForge. La primera vez (o si falta algo) corre el
 * instalador oficial con --installClient sobre common, con el Java de la instancia.
 *
 * @param {Object} loader El loader (forge o neoforge).
 * @param {Object} inst La instancia.
 * @param {{java: string, detalle?: Function}} ctx Java para el instalador y callback de estado.
 */
async function perfilConInstalador(loader, inst, ctx = {}){
    const common = ConfigManager.getCommonDirectory()
    const libDir = path.join(common, 'libraries')
    const leer = async id => {
        const ruta = path.join(common, 'versions', id, `${id}.json`)
        if(!await fs.pathExists(ruta)){
            return null
        }
        const version = await fs.readJson(ruta)
        const existen = await Promise.all(InstaladorForge.rutasLibrerias(version).map(r => fs.pathExists(path.join(libDir, r))))
        return existen.every(Boolean) ? version : null
    }

    let version = inst.loaderId && inst.loaderIdDe === inst.loaderVersion ? await leer(inst.loaderId) : null
    if(version == null){
        if(!ctx.java){
            throw InstaladorForge.errorMostrable(Lang.queryJS('landing.forge.javaFailed'))
        }
        ctx.detalle?.(Lang.queryJS('inicio.lanzar.instalandoLoader', { loader: loader.nombre, version: inst.loaderVersion }))
        const { ruta, carpeta } = await InstaladorForge.bajarInstalador(loader.urlInstalador(inst))
        try {
            const id = InstaladorForge.leerVersionDelInstalador(ruta).id
            await InstaladorForge.correrInstalador({ instalador: ruta, carpeta, java: ctx.java })
            version = await leer(id)
            if(version == null){
                throw InstaladorForge.errorMostrable(Lang.queryJS('inicio.lanzar.loaderIncompleto', { loader: loader.nombre }))
            }
            exports.actualizar(inst.id, { loaderId: id, loaderIdDe: inst.loaderVersion })
        } finally {
            await fs.remove(carpeta)
        }
    }
    return { modManifest: version, modulos: modulosDeVersion(version) }
}

/**
 * Las librerías del perfil de Forge/NeoForge como módulos Library, para que
 * ProcessBuilder las ponga en el classpath (ya las bajó el instalador).
 */
function modulosDeVersion(version){
    const rutas = InstaladorForge.rutasLibrerias(version)
    return (version.libraries ?? []).map((lib, i) => ({
        id: lib.name,
        name: lib.name,
        type: 'Library',
        artifact: {
            size: lib.downloads?.artifact?.size ?? 0,
            MD5: null,
            url: '',
            path: rutas[i]
        }
    }))
}

/**
 * Antes de crear una instancia Forge o NeoForge, revisa que exista el instalador de
 * esa versión, para no dejar una instancia que no va a poder arrancar.
 */
exports.validarLoader = async function({ loader, mc, loaderVersion }){
    const def = LOADERS[loader]
    if(def?.urlInstalador == null){
        return
    }
    let ok = false
    try {
        const res = await fetch(def.urlInstalador({ mc, loaderVersion }), { method: 'HEAD', signal: AbortSignal.timeout(10000) })
        ok = res.ok
    } catch(err) {
        logger.warn('No se pudo revisar el instalador.', err.message)
        throw InstaladorForge.errorMostrable(Lang.queryJS('inicio.errorInstaladorConexion', { loader: def.nombre }))
    }
    if(!ok){
        throw InstaladorForge.errorMostrable(Lang.queryJS('inicio.errorInstalador', { loader: def.nombre, version: loaderVersion, mc }))
    }
}

/**
 * Convierte las librerías del perfil de Fabric en módulos con el formato del
 * distribution.json, para que ProcessBuilder las ponga en el classpath igual
 * que con un servidor Fabric.
 */
function modulosFabric(perfil){
    const aModulo = (lib, tipo) => {
        const [grupo, artefacto, version] = lib.name.split(':')
        const ruta = `${grupo.replace(/\./g, '/')}/${artefacto}/${version}/${artefacto}-${version}.jar`
        return {
            id: lib.name,
            name: lib.name,
            type: tipo,
            artifact: {
                size: lib.size ?? 0,
                MD5: lib.md5 ?? null,
                url: lib.url.replace(/\/?$/, '/') + ruta
            }
        }
    }
    const loader = perfil.libraries.find(l => l.name.startsWith('net.fabricmc:fabric-loader:'))
    const resto = perfil.libraries.filter(l => l !== loader)
    const modulo = aModulo(loader, 'Fabric')
    modulo.subModules = [
        {
            id: perfil.id,
            name: perfil.id,
            type: 'VersionManifest',
            artifact: { size: 0, MD5: null, url: '' }
        },
        ...resto.map(l => aModulo(l, 'Library'))
    ]
    return [modulo]
}

/* ---------- Lista de instancias ---------- */

function cargar(){
    if(datos == null){
        try {
            datos = fs.readJsonSync(archivo())
        } catch(_err) {
            datos = { version: 1, instancias: [] }
        }
        if(!Array.isArray(datos.instancias)){
            datos.instancias = []
        }
    }
    return datos
}

function guardar(){
    fs.outputJsonSync(archivo(), cargar(), { spaces: 4 })
}

exports.LOADERS = LOADERS
exports.PREFIJO = PREFIJO

exports.esLocal = function(id){
    return typeof id === 'string' && id.startsWith(PREFIJO)
}

exports.listar = function(){
    return [...cargar().instancias]
}

exports.obtener = function(id){
    return cargar().instancias.find(i => i.id === id) || null
}

exports.carpeta = function(id){
    return path.join(ConfigManager.getInstanceDirectory(), id)
}

function slug(nombre){
    const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40)
    return base || 'instancia'
}

/**
 * Crea una instancia nueva y su carpeta.
 *
 * @param {{nombre: string, mc: string, loader: string, loaderVersion?: string}} d
 * @returns {Object} La instancia creada.
 */
exports.crear = function(d){
    const loader = LOADERS[d.loader]
    if(loader == null || !loader.disponible){
        throw new Error(`Loader no disponible: ${d.loader}`)
    }
    const base = PREFIJO + slug(d.nombre)
    let id = base
    for(let n = 2; exports.obtener(id) != null || fs.existsSync(exports.carpeta(id)); n++){
        id = `${base}-${n}`
    }
    const inst = {
        id,
        nombre: d.nombre.trim(),
        mc: d.mc,
        loader: d.loader,
        loaderVersion: loader.conVersion ? d.loaderVersion : null,
        creada: new Date().toISOString(),
        ultimaVez: null
    }
    fs.ensureDirSync(exports.carpeta(id))
    cargar().instancias.push(inst)
    guardar()
    // Arranca con la RAM por defecto de Ajustes; después se cambia en la instancia.
    ConfigManager.ensureJavaConfig(id, { suggestedMajor: 17 }, ConfigManager.getRamPorDefecto() != null ? { recommended: ConfigManager.getRamPorDefecto() } : null)
    ConfigManager.save()
    return inst
}

/**
 * Copia una instancia (carpeta completa y ajustes de Java) con otro nombre.
 *
 * @returns {Promise<Object>} La instancia nueva.
 */
exports.duplicar = async function(id, nombre){
    const orig = exports.obtener(id)
    const copia = exports.crear({ nombre, mc: orig.mc, loader: orig.loader, loaderVersion: orig.loaderVersion })
    await fs.copy(exports.carpeta(id), exports.carpeta(copia.id), { overwrite: false })
    exports.actualizar(copia.id, { icono: orig.icono ?? null })
    ConfigManager.setMaxRAM(copia.id, ConfigManager.getMaxRAM(id))
    ConfigManager.setMinRAM(copia.id, ConfigManager.getMinRAM(id))
    ConfigManager.setJavaExecutable(copia.id, ConfigManager.getJavaExecutable(id))
    ConfigManager.setJVMOptions(copia.id, [...ConfigManager.getJVMOptions(id)])
    ConfigManager.save()
    return exports.obtener(copia.id)
}

const ARCHIVO_ICONO = 'icono-instancia.png'

/**
 * Ruta del ícono propio de la instancia, o null si usa el del loader.
 */
exports.rutaIcono = function(inst){
    return inst?.icono ? path.join(exports.carpeta(inst.id), inst.icono) : null
}

/**
 * Copia una imagen como ícono de la instancia (null para volver al del loader).
 */
exports.ponerIcono = async function(id, origen){
    if(origen == null){
        await fs.remove(path.join(exports.carpeta(id), ARCHIVO_ICONO))
        return exports.actualizar(id, { icono: null })
    }
    await fs.copy(origen, path.join(exports.carpeta(id), ARCHIVO_ICONO))
    return exports.actualizar(id, { icono: ARCHIVO_ICONO })
}

exports.actualizar = function(id, cambios){
    const inst = exports.obtener(id)
    if(inst == null){
        return null
    }
    Object.assign(inst, cambios, { id })
    guardar()
    return inst
}

/**
 * Saca la instancia de la lista. La carpeta se manda a la papelera desde el
 * renderer (shell.trashItem), así se puede recuperar si fue un error.
 */
exports.quitar = function(id){
    const d = cargar()
    d.instancias = d.instancias.filter(i => i.id !== id)
    guardar()
}

/* ---------- Preparar y lanzar ---------- */

function opcionesJava(major){
    return {
        // La versión exacta que pide Minecraft, como el launcher oficial: Forge y
        // NeoForge viejos no arrancan con un Java más nuevo (si falta, se baja sola).
        supported: `${major}.x`,
        suggestedMajor: major,
        distribution: process.platform === 'darwin' ? 'CORRETTO' : 'TEMURIN'
    }
}

/**
 * Arma el servidor (HeliosServer) que ProcessBuilder necesita para lanzar.
 *
 * @param {Object} inst La instancia.
 * @param {Array} modulos Los módulos del loader (de perfil()).
 * @param {number} javaMajor La versión de Java que pide Minecraft.
 */
exports.construirServidor = function(inst, modulos, javaMajor){
    const raw = {
        id: inst.id,
        name: inst.nombre,
        description: '',
        icon: null,
        version: '1.0.0',
        address: 'localhost',
        minecraftVersion: inst.mc,
        mainServer: false,
        autoconnect: false,
        javaOptions: opcionesJava(javaMajor),
        modules: modulos
    }
    return new HeliosServer(raw, ConfigManager.getCommonDirectory(), ConfigManager.getInstanceDirectory())
}

/**
 * Lista los archivos de los módulos (recursivo) en el formato del motor de descargas.
 */
function assetsDeModulos(servidor){
    const lista = []
    const recorrer = mods => {
        for(const m of mods){
            if(m.rawModule.type !== 'VersionManifest' && m.rawModule.artifact.url){
                lista.push({
                    id: m.rawModule.id,
                    hash: m.rawModule.artifact.MD5,
                    algo: 'md5',
                    size: m.rawModule.artifact.size,
                    url: m.rawModule.artifact.url,
                    path: m.getPath()
                })
            }
            recorrer(m.subModules)
        }
    }
    recorrer(servidor.modules)
    return lista
}

/**
 * Valida y baja todo lo que la instancia necesita (Minecraft, assets, librerías
 * y loader) en un proceso aparte, para no trabar la ventana mientras calcula hashes.
 *
 * @param {Object} inst La instancia.
 * @param {Object} servidor El HeliosServer de construirServidor.
 * @param {{validando: Function, bajando: Function}} progreso Callbacks con el porcentaje.
 * @returns {Promise<{javaMajor: number}>}
 */
exports.prepararArchivos = function(inst, servidor, progreso){
    return new Promise((resolve, reject) => {
        const hijo = fork(path.join(__dirname, 'instanciasworker.js'), [], { stdio: 'pipe' })
        hijo.stdout.setEncoding('utf8')
        hijo.stderr.setEncoding('utf8')
        hijo.stdout.on('data', d => `${d}`.trim().split('\n').forEach(l => console.log(`\x1b[32m[instancia]\x1b[0m ${l}`)))
        hijo.stderr.on('data', d => `${d}`.trim().split('\n').forEach(l => console.log(`\x1b[31m[instancia]\x1b[0m ${l}`)))
        let terminado = false
        hijo.on('message', m => {
            switch(m.tipo){
                case 'validando':
                    progreso.validando(m.porcentaje)
                    break
                case 'bajando':
                    progreso.bajando(m.porcentaje)
                    break
                case 'listo':
                    terminado = true
                    hijo.disconnect()
                    resolve({ javaMajor: m.javaMajor, bajados: m.bajados })
                    break
                case 'error':
                    terminado = true
                    hijo.disconnect()
                    reject(Object.assign(new Error(m.mensaje), { displayable: m.mensaje }))
                    break
            }
        })
        hijo.on('exit', code => {
            if(!terminado){
                reject(new Error(`El proceso de descarga terminó con código ${code}.`))
            }
        })
        hijo.send({
            commonDir: ConfigManager.getCommonDirectory(),
            mc: inst.mc,
            extras: assetsDeModulos(servidor)
        })
    })
}
