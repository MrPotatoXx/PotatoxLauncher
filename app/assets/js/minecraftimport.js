/**
 * Importa los ajustes del Minecraft normal del jugador (u otro launcher) a la
 * instancia de un servidor del launcher.
 *
 * Nunca escribe en la carpeta de origen: solo la lee. Antes de sobrescribir
 * algo en la instancia guarda un respaldo con sufijo .bak-<fecha>.
 */
const child_process = require('child_process')
const fs            = require('fs-extra')
const os            = require('os')
const path          = require('path')

const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('MinecraftImport')

/** DataVersion de Minecraft 1.20.1. Un options.txt con una versión mayor viene de un Minecraft más nuevo. */
exports.TARGET_DATA_VERSION = 3465

/** Lo que se puede importar, en el orden en que se muestra. */
exports.ITEMS = ['options', 'servers', 'journeymap', 'config']

const ITEM_PATHS = {
    options: 'options.txt',
    servers: 'servers.dat',
    journeymap: 'journeymap',
    config: 'config'
}

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
 * @param {string} sourceDir Carpeta de origen (por ejemplo .minecraft).
 * @returns {Promise<{exists: boolean, found: Object<string, boolean>, dataVersion: number|null}>}
 */
exports.inspectSource = async function(sourceDir){
    const found = {}
    let exists = false
    try {
        exists = (await fs.stat(sourceDir)).isDirectory()
    } catch (_err) {
        exists = false
    }
    for(const item of exports.ITEMS){
        found[item] = exists && await fs.pathExists(path.join(sourceDir, ITEM_PATHS[item]))
    }
    const dataVersion = found.options ? await exports.readDataVersion(path.join(sourceDir, ITEM_PATHS.options)) : null
    return { exists, found, dataVersion }
}

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

function timestamp(){
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
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
 * Copia un archivo a la instancia. Si ya existe, primero lo respalda junto a él.
 *
 * @returns {Promise<string|null>} El nombre del respaldo, o null si no hacía falta.
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

/**
 * Importa los ajustes elegidos desde sourceDir a instanceDir.
 *
 * @param {string} sourceDir Carpeta de origen. Solo se lee.
 * @param {string} instanceDir Carpeta de la instancia del servidor.
 * @param {Object<string, boolean>} selection Qué importar (claves de ITEMS).
 * @returns {Promise<Array<{item: string, status: string, files?: number, skipped?: number, backup?: string|null, error?: string}>>}
 * status es 'imported', 'missing' (no existe en el origen) o 'error'.
 */
exports.importSettings = async function(sourceDir, instanceDir, selection){
    const stamp = timestamp()
    const results = []
    await fs.ensureDir(instanceDir)

    for(const item of exports.ITEMS){
        if(!selection[item]){
            continue
        }
        const src = path.join(sourceDir, ITEM_PATHS[item])
        const dest = path.join(instanceDir, ITEM_PATHS[item])
        try {
            if(!await fs.pathExists(src)){
                results.push({ item, status: 'missing' })
                continue
            }
            if(item === 'options' || item === 'servers'){
                const backup = await copyFileWithBackup(src, dest, stamp)
                results.push({ item, status: 'imported', backup })
            } else if(item === 'journeymap'){
                const { files, backup } = await copyDirWithBackup(src, dest, stamp)
                results.push({ item, status: 'imported', files, backup })
            } else if(item === 'config'){
                const { files, skipped } = await copyDirMissingOnly(src, dest)
                results.push({ item, status: 'imported', files, skipped })
            }
        } catch (err) {
            logger.error(`Failed to import ${item} from ${src}`, err)
            results.push({ item, status: 'error', error: err.message })
        }
    }
    logger.info(`Imported settings from ${sourceDir} to ${instanceDir}`, results)
    return results
}
