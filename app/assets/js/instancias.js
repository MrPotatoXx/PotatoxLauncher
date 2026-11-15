/**
 * Instancias propias del jugador: Vanilla y Fabric por ahora, Forge y NeoForge después.
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
const { HeliosServer } = require('helios-core/common')
const { LoggerUtil } = require('helios-core')

const ConfigManager = require('./configmanager')

const logger = LoggerUtil.getLogger('Instancias')

const PREFIJO = 'local-'
const MANIFEST_MOJANG = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const META_FABRIC = 'https://meta.fabricmc.net/v2'
const TIMEOUT = { request: 15000 }

const archivo = () => path.join(ConfigManager.getLauncherDirectory(), 'instancias.json')

let datos = null

/* ---------- Loaders ---------- */

let cacheMojang = null
let cacheFabricJuegos = null

async function manifestMojang(){
    if(cacheMojang == null){
        cacheMojang = await got.get(MANIFEST_MOJANG, { responseType: 'json', timeout: TIMEOUT }).json()
    }
    return cacheMojang
}

/**
 * Cada loader dice si está disponible, qué versiones de Minecraft soporta,
 * qué versiones propias tiene y cómo se arma para lanzar. Forge y NeoForge
 * quedan declarados pero deshabilitados: necesitan correr su instalador por
 * versión (ver ensureForgeInstalled en landing.js) y llegan en la fase 2.
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
                .filter(v => soportadas.has(v.id))
                .map(v => ({ id: v.id, estable: v.type === 'release' }))
        },
        async versionesLoader(mc){
            const lista = await got.get(`${META_FABRIC}/versions/loader/${encodeURIComponent(mc)}`, { responseType: 'json', timeout: TIMEOUT }).json()
            return lista.map(e => ({ id: e.loader.version, estable: e.loader.stable }))
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
        disponible: false,
        conVersion: true
    },
    neoforge: {
        id: 'neoforge',
        nombre: 'NeoForge',
        disponible: false,
        conVersion: true
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
    return inst
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
        supported: major > 8 ? `>=${major}.x` : '8.x',
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
