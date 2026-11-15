/**
 * Corre el instalador oficial de Forge o NeoForge (--installClient) sobre la carpeta
 * common del launcher. Lo usan Tierras Malditas (ensureForgeInstalled en landing.js)
 * y las instancias propias con Forge o NeoForge (instancias.js).
 *
 * El instalador baja las librerías y genera los jars de cliente parcheados en
 * common/libraries, y deja el perfil de la versión en common/versions/<id>/<id>.json.
 * El juego después corre en la carpeta de cada instancia, nunca en .minecraft.
 */
const fs            = require('fs-extra')
const os            = require('os')
const path          = require('path')
const child_process = require('child_process')
const AdmZip        = require('adm-zip')
const { downloadFile } = require('helios-core/dl')
const { LoggerUtil }   = require('helios-core')

const ConfigManager = require('./configmanager')
const Lang          = require('./langloader')

const logger = LoggerUtil.getLogger('ForgeInstaller')

function errorMostrable(mensaje){
    const err = new Error(mensaje)
    err.displayable = mensaje
    return err
}
exports.errorMostrable = errorMostrable

/**
 * Baja el instalador a una carpeta temporal.
 *
 * @returns {Promise<{ruta: string, carpeta: string}>} El jar y la carpeta temporal (borrarla al terminar).
 */
exports.bajarInstalador = async function(url){
    const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'potatox-forge-'))
    const ruta = path.join(carpeta, path.basename(new URL(url).pathname))
    try {
        await downloadFile(url, ruta)
    } catch(err) {
        await fs.remove(carpeta)
        logger.error(`Failed to download ${url}`, err)
        throw errorMostrable(Lang.queryJS('landing.forge.downloadFailed'))
    }
    return { ruta, carpeta }
}

/**
 * El version.json que trae el instalador adentro (id, librerías, argumentos).
 */
exports.leerVersionDelInstalador = function(rutaInstalador){
    const zip = new AdmZip(rutaInstalador)
    const entrada = zip.getEntry('version.json')
    if(entrada == null){
        throw new Error('El instalador no trae version.json')
    }
    return JSON.parse(zip.readAsText(entrada))
}

/**
 * Corre el instalador ya bajado con --installClient sobre common.
 *
 * @param {{instalador: string, carpeta: string, java: string}} o
 */
exports.correrInstalador = async function({ instalador, carpeta, java }){
    const commonDir = ConfigManager.getCommonDirectory()

    // El instalador se niega a correr si no encuentra un perfil del launcher oficial.
    const profilesPath = path.join(commonDir, 'launcher_profiles.json')
    if(!await fs.pathExists(profilesPath)) {
        await fs.outputJson(profilesPath, {})
    }

    // La salida completa (decenas de miles de lineas) va a un archivo; la consola solo muestra stderr
    // y, si falla, las ultimas lineas.
    const logPath = path.join(ConfigManager.getLauncherDirectory(), 'forge-installer.log')
    const logStream = fs.createWriteStream(logPath)
    let tail = []
    const keepTail = (data) => {
        tail = tail.concat(data.split(/\r?\n/).filter(l => l.length > 0)).slice(-40)
    }

    logger.info(`Running ${java} -jar ${instalador} --installClient ${commonDir}`)
    logger.info(`Installer output: ${logPath}`)
    const exitCode = await new Promise((resolve, reject) => {
        const child = child_process.spawn(java, ['-jar', instalador, '--installClient', commonDir], { cwd: carpeta })
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', data => {
            logStream.write(data)
            keepTail(data)
        })
        child.stderr.on('data', data => {
            logStream.write(data)
            keepTail(data)
            logger.error(data.trim())
        })
        child.on('error', err => {
            logger.error(`Could not run ${java}`, err)
            reject(errorMostrable(Lang.queryJS('landing.forge.javaFailed')))
        })
        child.on('close', resolve)
    }).finally(() => logStream.end())
    if(exitCode !== 0) {
        logger.error(`Forge installer exited with code ${exitCode}. Last lines:\n${tail.join('\n')}`)
        throw errorMostrable(Lang.queryJS('landing.forge.installerFailed', { code: exitCode }))
    }
}

/**
 * Ruta (relativa a common/libraries) de cada librería de un version.json.
 */
exports.rutasLibrerias = function(version){
    return (version.libraries ?? []).map(lib => {
        if(lib.downloads?.artifact?.path){
            return lib.downloads.artifact.path
        }
        const [nombre, ext = 'jar'] = lib.name.split('@')
        const [grupo, artefacto, ver, clasificador] = nombre.split(':')
        const archivo = `${artefacto}-${ver}${clasificador ? '-' + clasificador : ''}.${ext}`
        return path.join(...grupo.split('.'), artefacto, ver, archivo)
    })
}
