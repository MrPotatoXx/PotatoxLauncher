/**
 * Importa los ajustes del Minecraft del jugador (launcher oficial u otros launchers)
 * a la instancia de un servidor del launcher.
 *
 * Nunca escribe en la carpeta de origen: solo la lee. Antes de sobrescribir algo
 * en la instancia guarda un respaldo con sufijo .bak-<fecha>.
 */
const child_process = require('child_process')
const fs            = require('fs-extra')
const os            = require('os')
const path          = require('path')

const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('MinecraftImport')

/** DataVersion de Minecraft 1.20.1. Un options.txt con una versión mayor viene de un Minecraft más nuevo. */
exports.TARGET_DATA_VERSION = 3465

/** DataVersion -> versión de Minecraft, solo para mostrarla cuando el launcher de origen no la indica. */
const DATA_VERSIONS = {
    3465: '1.20.1', 3578: '1.20.2', 3700: '1.20.4', 3839: '1.20.6',
    3953: '1.21', 3955: '1.21.1', 4082: '1.21.3', 4189: '1.21.4', 4325: '1.21.5'
}

/**
 * @param {number|null} dataVersion El DataVersion de un options.txt.
 * @returns {string|null} La versión de Minecraft, si se conoce.
 */
exports.mcVersionFromDataVersion = function(dataVersion){
    return dataVersion != null ? DATA_VERSIONS[dataVersion] || null : null
}

/**
 * Lo que se puede importar.
 * - mode 'file': copia el archivo (con respaldo si existe).
 * - mode 'merge': mezcla la carpeta; respalda solo los archivos que reemplaza.
 * - mode 'missing': solo copia archivos que no existan; nunca sobrescribe.
 * - defaultOn: si viene marcado cuando se encuentra en el origen.
 */
exports.ITEMS = [
    { key: 'options',        path: 'options.txt',        mode: 'file',    defaultOn: true },
    { key: 'servers',        path: 'servers.dat',        mode: 'file',    defaultOn: true },
    { key: 'journeymap',     path: 'journeymap',         mode: 'merge',   defaultOn: true },
    { key: 'local',          path: 'local',              mode: 'merge',   defaultOn: true },
    { key: 'shadersOptions', path: 'optionsshaders.txt', mode: 'file',    defaultOn: true },
    { key: 'resourcepacks',  path: 'resourcepacks',      mode: 'merge',   defaultOn: false },
    { key: 'shaderpacks',    path: 'shaderpacks',        mode: 'merge',   defaultOn: false },
    { key: 'config',         path: 'config',             mode: 'missing', defaultOn: false },
    { key: 'defaultconfigs', path: 'defaultconfigs',     mode: 'missing', defaultOn: false }
]

/**
 * Carpetas que nunca se importan como "otros archivos": las maneja el launcher
 * (mods, librerías) o no tienen sentido en otra instancia (mundos, logs).
 */
exports.BLOCKED_TOP_LEVEL = ['mods', 'saves', 'logs', 'crash-reports', 'versions', 'libraries', 'assets', 'natives', 'bin', 'downloads']

// Utilidades

function timestamp(){
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function readJsonSafe(file){
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (_err) {
        return null
    }
}

async function isDir(dir){
    try {
        return (await fs.stat(dir)).isDirectory()
    } catch (_err) {
        return false
    }
}

async function listSubdirs(dir){
    try {
        return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => path.join(dir, e.name))
    } catch (_err) {
        return []
    }
}

/** Lee un .cfg estilo INI de Prism/MultiMC (clave=valor). */
async function readIni(file){
    const out = {}
    try {
        for(const line of (await fs.readFile(file, 'utf8')).split(/\r?\n/)){
            const i = line.indexOf('=')
            if(i > 0){
                out[line.substring(0, i).trim()] = line.substring(i + 1).trim()
            }
        }
    } catch (_err) {
        // Sin archivo, sin datos.
    }
    return out
}

/** Un archivo que existe, o una carpeta que no está vacía. */
async function hasContent(target){
    try {
        const stat = await fs.stat(target)
        return !stat.isDirectory() || (await fs.readdir(target)).length > 0
    } catch (_err) {
        return false
    }
}

function samePath(a, b){
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function isInside(child, parent){
    const rel = path.relative(path.resolve(parent), path.resolve(child))
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Clave para comparar nombres de mods entre launchers: solo letras, sin versiones. */
function modKey(fileName){
    return fileName.toLowerCase().replace(/\.jar(\.disabled)?$/, '').replace(/[^a-z]/g, '')
}

/**
 * Lista los archivos de una carpeta, con rutas relativas a ella.
 */
async function listFiles(dir, base = dir){
    const out = []
    for(const entry of await fs.readdir(dir, { withFileTypes: true })){
        const full = path.join(dir, entry.name)
        if(entry.isDirectory()){
            out.push(...await listFiles(full, base))
        } else if(entry.isFile()){
            out.push(path.relative(base, full))
        }
    }
    return out
}

/**
 * @param {string} target Archivo o carpeta.
 * @returns {Promise<{size: number, files: number}>} Tamaño total en bytes y cantidad de archivos.
 */
exports.getSize = async function(target){
    try {
        const stat = await fs.stat(target)
        if(!stat.isDirectory()){
            return { size: stat.size, files: 1 }
        }
        let size = 0
        const files = await listFiles(target)
        for(const rel of files){
            size += (await fs.stat(path.join(target, rel))).size
        }
        return { size, files: files.length }
    } catch (_err) {
        return { size: 0, files: 0 }
    }
}

// Origen

/**
 * @returns {string} La carpeta .minecraft del launcher oficial en este sistema.
 */
exports.getDefaultSourceDir = function(){
    switch(process.platform){
        case 'win32':
            return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft')
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
        default:
            return path.join(os.homedir(), '.minecraft')
    }
}

function appDataDir(){
    switch(process.platform){
        case 'win32':
            return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support')
        default:
            return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
    }
}

/**
 * Lee la línea "version:" de un options.txt.
 *
 * @param {string} optionsPath Ruta al options.txt.
 * @returns {Promise<number|null>} El DataVersion, o null si no se encuentra.
 */
exports.readDataVersion = async function(optionsPath){
    try {
        const content = await fs.readFile(optionsPath, 'utf8')
        const match = content.match(/^version:(\d+)\s*$/m)
        return match ? Number(match[1]) : null
    } catch (_err) {
        return null
    }
}

/**
 * Revisa qué hay para importar en una carpeta de origen.
 *
 * @param {string} sourceDir Carpeta de juego de origen (la que tiene options.txt).
 * @returns {Promise<{exists: boolean, found: Object<string, boolean>, dataVersion: number|null}>}
 */
exports.inspectSource = async function(sourceDir){
    const found = {}
    const exists = await isDir(sourceDir)
    for(const item of exports.ITEMS){
        found[item.key] = exists && await hasContent(path.join(sourceDir, item.path))
    }
    const dataVersion = found.options ? await exports.readDataVersion(path.join(sourceDir, 'options.txt')) : null
    return { exists, found, dataVersion }
}

/**
 * Normaliza el loader a 'forge', 'neoforge', 'fabric', 'quilt', 'vanilla' o null.
 */
function normalizeLoader(raw){
    if(raw == null){
        return null
    }
    const s = String(raw).toLowerCase()
    if(s.includes('neoforge') || s.includes('neoforged')) return 'neoforge'
    if(s.includes('forge')) return 'forge'
    if(s.includes('quilt')) return 'quilt'
    if(s.includes('fabric')) return 'fabric'
    if(s.includes('vanilla') || s === 'none') return 'vanilla'
    return null
}

/**
 * Saca la versión de Minecraft de un id de versión del launcher oficial,
 * por ejemplo "1.20.1-forge-47.4.10" o "fabric-loader-0.15.11-1.20.1" -> "1.20.1".
 */
function mcVersionFromId(id){
    const match = /(?:^|[^\d.])(1\.\d+(?:\.\d+)?)(?![\d.])/.exec(id || '')
    return match ? match[1] : null
}

// Detectores. Cada uno devuelve [{ launcher, name, dir, mcVersion, loader, lastPlayed }] y nunca lanza.

async function detectOfficial(){
    const out = []
    const mc = exports.getDefaultSourceDir()
    const profiles = await readJsonSafe(path.join(mc, 'launcher_profiles.json'))
    let lastUsed = null
    const custom = []
    if(profiles && profiles.profiles){
        for(const p of Object.values(profiles.profiles)){
            const used = p.lastUsed ? new Date(p.lastUsed) : null
            if(p.gameDir && !samePath(p.gameDir, mc)){
                custom.push({ launcher: 'minecraft', name: p.name || path.basename(p.gameDir), dir: p.gameDir, mcVersion: mcVersionFromId(p.lastVersionId), loader: normalizeLoader(p.lastVersionId), lastPlayed: used })
            } else if(used && (lastUsed == null || used > lastUsed)){
                lastUsed = used
            }
        }
    }
    out.push({ launcher: 'minecraft', name: null, dir: mc, mcVersion: null, loader: null, lastPlayed: lastUsed })
    return out.concat(custom)
}

async function detectCurseForge(){
    const out = []
    const index = await readJsonSafe(path.join(appDataDir(), 'CurseForge', 'agent', 'GameInstances', 'MinecraftGameInstance.json'))
    if(Array.isArray(index)){
        for(const i of index){
            if(i && i.installPath){
                out.push({ launcher: 'curseforge', name: i.name, dir: i.installPath, mcVersion: i.gameVersion || null, loader: normalizeLoader(i.baseModLoader && i.baseModLoader.name), lastPlayed: i.lastPlayed ? new Date(i.lastPlayed) : null })
            }
        }
    }
    // Instalaciones antiguas (app de Overwolf) en la carpeta por defecto.
    for(const dir of await listSubdirs(path.join(os.homedir(), 'curseforge', 'minecraft', 'Instances'))){
        const meta = await readJsonSafe(path.join(dir, 'minecraftinstance.json'))
        if(meta){
            out.push({ launcher: 'curseforge', name: meta.name || path.basename(dir), dir, mcVersion: meta.gameVersion || null, loader: normalizeLoader(meta.baseModLoader && meta.baseModLoader.name), lastPlayed: meta.lastPlayed ? new Date(meta.lastPlayed) : null })
        }
    }
    return out
}

async function detectMultiMCLike(launcher, root, cfgName){
    const out = []
    // Prism/PolyMC permiten mover la carpeta de instancias (InstanceDir en su .cfg).
    const cfg = await readIni(path.join(root, cfgName))
    let instancesDir = path.join(root, 'instances')
    if(cfg.InstanceDir){
        instancesDir = path.isAbsolute(cfg.InstanceDir) ? cfg.InstanceDir : path.join(root, cfg.InstanceDir)
    }
    for(const dir of await listSubdirs(instancesDir)){
        const inst = await readIni(path.join(dir, 'instance.cfg'))
        if(Object.keys(inst).length === 0){
            continue
        }
        let gameDir = null
        for(const candidate of ['.minecraft', 'minecraft']){
            if(await isDir(path.join(dir, candidate))){
                gameDir = path.join(dir, candidate)
                break
            }
        }
        if(gameDir == null){
            continue
        }
        const pack = await readJsonSafe(path.join(dir, 'mmc-pack.json'))
        let mcVersion = null
        let loader = 'vanilla'
        for(const c of (pack && pack.components) || []){
            if(c.uid === 'net.minecraft') mcVersion = c.version || null
            else if(['net.minecraftforge', 'net.neoforged', 'net.fabricmc.fabric-loader', 'org.quiltmc.quilt-loader'].includes(c.uid)) loader = normalizeLoader(c.uid)
        }
        const lastLaunch = Number(inst.lastLaunchTime)
        out.push({ launcher, name: inst.name || path.basename(dir), dir: gameDir, mcVersion, loader, lastPlayed: lastLaunch > 0 ? new Date(lastLaunch) : null })
    }
    return out
}

async function detectModrinth(){
    const out = []
    for(const root of ['ModrinthApp', 'com.modrinth.theseus']){
        for(const dir of await listSubdirs(path.join(appDataDir(), root, 'profiles'))){
            // La app antigua guardaba profile.json; la nueva guarda los datos en su base y solo deja la carpeta.
            const meta = await readJsonSafe(path.join(dir, 'profile.json'))
            const md = meta && meta.metadata ? meta.metadata : meta || {}
            out.push({ launcher: 'modrinth', name: md.name || path.basename(dir), dir, mcVersion: md.game_version || null, loader: normalizeLoader(md.loader), lastPlayed: md.last_played ? new Date(md.last_played) : null })
        }
    }
    return out
}

async function detectATLauncher(){
    const out = []
    for(const dir of await listSubdirs(path.join(appDataDir(), 'ATLauncher', 'instances'))){
        const meta = await readJsonSafe(path.join(dir, 'instance.json'))
        if(meta){
            const l = meta.launcher || {}
            out.push({ launcher: 'atlauncher', name: l.name || path.basename(dir), dir, mcVersion: meta.id || null, loader: normalizeLoader(l.loaderVersion && l.loaderVersion.type) || 'vanilla', lastPlayed: l.lastPlayed ? new Date(l.lastPlayed) : null })
        }
    }
    return out
}

async function detectGDLauncher(){
    const out = []
    for(const dir of await listSubdirs(path.join(appDataDir(), 'gdlauncher_next', 'instances'))){
        const meta = await readJsonSafe(path.join(dir, 'config.json'))
        if(meta){
            const loader = meta.loader || {}
            out.push({ launcher: 'gdlauncher', name: meta.name || path.basename(dir), dir, mcVersion: loader.mcVersion || null, loader: normalizeLoader(loader.loaderType), lastPlayed: meta.lastPlayed ? new Date(meta.lastPlayed) : null })
        }
    }
    return out
}

async function detectFTBApp(){
    const out = []
    const roots = process.platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), '.ftba', 'instances')]
        : [path.join(os.homedir(), '.ftba', 'instances'), path.join(appDataDir(), '.ftba', 'instances')]
    for(const root of roots){
        for(const dir of await listSubdirs(root)){
            const meta = await readJsonSafe(path.join(dir, 'instance.json'))
            if(meta){
                out.push({ launcher: 'ftbapp', name: meta.name || path.basename(dir), dir, mcVersion: meta.mcVersion || null, loader: normalizeLoader(meta.modLoader) || null, lastPlayed: meta.lastPlayed ? new Date(meta.lastPlayed * (meta.lastPlayed < 1e12 ? 1000 : 1)) : null })
            }
        }
    }
    return out
}

async function detectTechnic(){
    const out = []
    for(const dir of await listSubdirs(path.join(appDataDir(), '.technic', 'modpacks'))){
        out.push({ launcher: 'technic', name: path.basename(dir), dir, mcVersion: null, loader: null, lastPlayed: null })
    }
    return out
}

/**
 * Busca carpetas de juego de los launchers más comunes.
 *
 * @param {Object} target Lo que se quiere comparar para recomendar.
 * @param {string} target.mcVersion Versión de Minecraft del modpack (ej. 1.20.1).
 * @param {string} target.loader Loader del modpack (forge, fabric...).
 * @param {string[]} target.modFiles Nombres de los jars del modpack.
 * @param {string[]} target.excludeDirs Carpetas que no se deben ofrecer (las instancias del propio launcher).
 * @returns {Promise<Array<Object>>} Orígenes ordenados del más al menos recomendado. El primero
 * tiene recommended: true si coincide con la versión del modpack.
 */
exports.detectSources = async function(target){
    const detectors = [
        detectOfficial(),
        detectCurseForge(),
        detectMultiMCLike('prism', path.join(appDataDir(), 'PrismLauncher'), 'prismlauncher.cfg'),
        detectMultiMCLike('polymc', path.join(appDataDir(), 'PolyMC'), 'polymc.cfg'),
        detectMultiMCLike('multimc', path.join(appDataDir(), 'MultiMC'), 'multimc.cfg'),
        detectModrinth(),
        detectATLauncher(),
        detectGDLauncher(),
        detectFTBApp(),
        detectTechnic()
    ]
    const all = (await Promise.all(detectors.map(p => p.catch(err => {
        logger.warn('Source detector failed.', err)
        return []
    })))).flat()

    const targetMods = new Set((target.modFiles || []).map(modKey))
    const seen = new Set()
    const sources = []
    for(const s of all){
        const key = path.resolve(s.dir).toLowerCase()
        if(seen.has(key) || (target.excludeDirs || []).some(d => samePath(d, s.dir) || isInside(s.dir, d))){
            continue
        }
        seen.add(key)
        const info = await exports.inspectSource(s.dir)
        if(!info.exists || !exports.ITEMS.some(item => info.found[item.key])){
            continue
        }
        if(s.mcVersion == null && info.dataVersion != null){
            s.mcVersion = DATA_VERSIONS[info.dataVersion] || null
        }
        if(s.lastPlayed == null && info.found.options){
            try {
                s.lastPlayed = (await fs.stat(path.join(s.dir, 'options.txt'))).mtime
            } catch (_err) {
                // Sin fecha.
            }
        }

        let sharedMods = 0
        if(targetMods.size > 0){
            try {
                for(const f of await fs.readdir(path.join(s.dir, 'mods'))){
                    if(targetMods.has(modKey(f))) sharedMods++
                }
            } catch (_err) {
                // Sin carpeta de mods.
            }
        }

        const versionMatch = (s.mcVersion != null && s.mcVersion === target.mcVersion)
            || (s.mcVersion == null && info.dataVersion === exports.TARGET_DATA_VERSION)
        const loaderMatch = s.loader != null && s.loader === target.loader
        const modRatio = targetMods.size > 0 ? sharedMods / targetMods.size : 0
        const ageDays = s.lastPlayed ? (Date.now() - s.lastPlayed.getTime()) / 86400000 : 365
        const score = (versionMatch ? 100 : 0) + (loaderMatch ? 30 : 0) + Math.round(modRatio * 100) + Math.max(0, 10 - ageDays / 3)

        sources.push({ ...s, dataVersion: info.dataVersion, found: info.found, sharedMods, versionMatch, score })
    }
    sources.sort((a, b) => b.score - a.score)
    if(sources.length > 0 && sources[0].versionMatch){
        sources[0].recommended = true
    }
    return sources
}

// Juego abierto

/**
 * Revisa si hay un proceso de Java corriendo con esta instancia como carpeta de juego.
 * Funciona aunque el juego se haya lanzado separado del launcher.
 *
 * @param {string} instanceDir Carpeta de la instancia del servidor.
 * @returns {Promise<boolean>}
 */
exports.isGameRunning = function(instanceDir){
    return new Promise(resolve => {
        const done = (err, stdout) => {
            if(err){
                logger.warn('Could not list running processes.', err)
                resolve(false)
                return
            }
            resolve(stdout.toLowerCase().includes(path.resolve(instanceDir).toLowerCase()))
        }
        if(process.platform === 'win32'){
            const command = 'Get-CimInstance Win32_Process -Filter "Name=\'javaw.exe\' OR Name=\'java.exe\'" | ForEach-Object { $_.CommandLine }'
            child_process.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, done)
        } else {
            child_process.execFile('ps', ['-eo', 'args'], { maxBuffer: 16 * 1024 * 1024 }, done)
        }
    })
}

// Copia

/**
 * Copia un archivo a la instancia. Si ya existe, primero lo respalda junto a él.
 *
 * @returns {Promise<string|null>} La ruta del respaldo, o null si no hacía falta.
 */
async function copyFileWithBackup(src, dest, stamp){
    let backup = null
    if(await fs.pathExists(dest)){
        backup = `${dest}.bak-${stamp}`
        await fs.copy(dest, backup)
    }
    await fs.copy(src, dest, { overwrite: true })
    return backup
}

/**
 * Copia una carpeta sobre otra (mezclando). Los archivos que se van a sobrescribir
 * se respaldan antes en <carpeta>.bak-<fecha>, con la misma estructura.
 *
 * @returns {Promise<{files: number, backup: string|null}>}
 */
async function copyDirWithBackup(src, dest, stamp){
    const files = await listFiles(src)
    const backupDir = `${dest}.bak-${stamp}`
    let backedUp = 0
    for(const rel of files){
        const target = path.join(dest, rel)
        if(await fs.pathExists(target)){
            await fs.copy(target, path.join(backupDir, rel))
            backedUp++
        }
        await fs.copy(path.join(src, rel), target, { overwrite: true })
    }
    return { files: files.length, backup: backedUp > 0 ? backupDir : null }
}

/**
 * Copia solo los archivos que no existen en el destino. Nunca sobrescribe.
 *
 * @returns {Promise<{files: number, skipped: number}>}
 */
async function copyDirMissingOnly(src, dest){
    const files = await listFiles(src)
    let copied = 0
    for(const rel of files){
        const target = path.join(dest, rel)
        if(await fs.pathExists(target)){
            continue
        }
        await fs.copy(path.join(src, rel), target, { overwrite: false, errorOnExist: false })
        copied++
    }
    return { files: copied, skipped: files.length - copied }
}

async function copyByMode(mode, src, dest, stamp){
    if(mode === 'missing'){
        return copyDirMissingOnly(src, dest)
    }
    if((await fs.stat(src)).isDirectory()){
        return copyDirWithBackup(src, dest, stamp)
    }
    return { files: 1, backup: await copyFileWithBackup(src, dest, stamp) }
}

/**
 * Reconoce resource packs (pack.mcmeta) y shaders (carpeta shaders/), sueltos o en .zip.
 * Solo lee la lista de archivos del zip; no extrae nada.
 *
 * @returns {Promise<'resourcepacks'|'shaderpacks'|null>}
 */
async function detectPackKind(target, dir){
    try {
        let names
        if(dir){
            names = (await fs.readdir(target)).map(n => n.toLowerCase())
        } else if(target.toLowerCase().endsWith('.zip')){
            const AdmZip = require('adm-zip')
            names = new AdmZip(target).getEntries().map(e => e.entryName.toLowerCase().replace(/\\/g, '/').split('/')[0] + (e.entryName.includes('/') ? '/' : ''))
        } else {
            return null
        }
        if(names.some(n => n === 'shaders' || n === 'shaders/')){
            return 'shaderpacks'
        }
        if(names.includes('pack.mcmeta')){
            return 'resourcepacks'
        }
    } catch (err) {
        logger.warn(`Could not inspect ${target}`, err)
    }
    return null
}

/**
 * Decide dónde va cada archivo o carpeta elegido a mano dentro de la instancia.
 * Si está dentro de la carpeta de origen conserva su ruta relativa; si no, va a la raíz
 * de la instancia con el mismo nombre.
 *
 * @param {string} sourceDir Carpeta de origen elegida (puede ser null).
 * @param {string} instanceDir Carpeta de la instancia.
 * @param {string[]} paths Rutas elegidas o arrastradas.
 * @returns {Promise<Array<{src: string, rel: string, isDir: boolean, blocked: string|null}>>}
 * blocked: null si se puede importar; 'missing', 'sourceRoot', 'instance' o 'blockedFolder' si no.
 */
exports.planCustomImport = async function(sourceDir, instanceDir, paths){
    const plan = []
    for(const src of paths){
        const exists = await fs.pathExists(src)
        const dir = exists && await isDir(src)
        const insideSource = sourceDir != null && isInside(src, sourceDir)
        let rel = insideSource ? path.relative(sourceDir, src) : path.basename(src)
        if(exists && !insideSource){
            // Un pack suelto (por ejemplo, bajado a Descargas) va a su carpeta.
            const kind = await detectPackKind(src, dir)
            if(kind != null){
                rel = path.join(kind, path.basename(src))
            }
        }
        let blocked = null
        if(!exists){
            blocked = 'missing'
        } else if(sourceDir != null && samePath(src, sourceDir)){
            blocked = 'sourceRoot'
            rel = ''
        } else if(samePath(src, instanceDir) || isInside(src, instanceDir) || isInside(instanceDir, src)){
            blocked = 'instance'
        } else if(exports.BLOCKED_TOP_LEVEL.includes(rel.split(/[\\/]/)[0].toLowerCase())){
            blocked = 'blockedFolder'
        }
        plan.push({ src, rel, isDir: dir, blocked })
    }
    return plan
}

/**
 * Importa los ajustes elegidos a la instancia.
 *
 * @param {string} sourceDir Carpeta de origen. Solo se lee.
 * @param {string} instanceDir Carpeta de la instancia del servidor.
 * @param {Object<string, boolean>} selection Qué elementos del catálogo importar (claves de ITEMS).
 * @param {Array<Object>} customPlan Opcional. Resultado de planCustomImport con los archivos elegidos a mano.
 * @returns {Promise<Array<Object>>} Un resultado por elemento: { item | rel, status, files?, skipped?, backup?, error? }.
 * status es 'imported', 'missing' (no existe en el origen), 'blocked' o 'error'.
 */
exports.importSettings = async function(sourceDir, instanceDir, selection, customPlan = []){
    const stamp = timestamp()
    const results = []
    await fs.ensureDir(instanceDir)

    for(const item of exports.ITEMS){
        if(!selection[item.key]){
            continue
        }
        const src = path.join(sourceDir, item.path)
        const dest = path.join(instanceDir, item.path)
        try {
            if(!await fs.pathExists(src)){
                results.push({ item: item.key, status: 'missing' })
                continue
            }
            results.push({ item: item.key, status: 'imported', ...await copyByMode(item.mode, src, dest, stamp) })
        } catch (err) {
            logger.error(`Failed to import ${item.key} from ${src}`, err)
            results.push({ item: item.key, status: 'error', error: err.message })
        }
    }

    for(const entry of customPlan){
        if(entry.blocked){
            results.push({ rel: entry.rel || path.basename(entry.src), status: 'blocked', reason: entry.blocked })
            continue
        }
        try {
            results.push({ rel: entry.rel, status: 'imported', ...await copyByMode('merge', entry.src, path.join(instanceDir, entry.rel), stamp) })
        } catch (err) {
            logger.error(`Failed to import ${entry.src}`, err)
            results.push({ rel: entry.rel, status: 'error', error: err.message })
        }
    }

    logger.info(`Imported settings from ${sourceDir} to ${instanceDir}`, results)
    return results
}
