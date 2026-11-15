const got = require('got')
const { DistributionAPI, RestResponseStatus, handleGotError } = require('helios-core/common')
const { LoggerUtil } = require('helios-core')

const ConfigManager = require('./configmanager')
const Servidor      = require('./servidor')

const logger = LoggerUtil.getLogger('DistroManager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = Servidor.url('distribution.json')

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

/**
 * UUID de la cuenta activa con guiones, como lo da Mojang, o null sin cuenta.
 */
function uuidCuentaActiva(){
    const uuid = ConfigManager.isLoaded() ? ConfigManager.getSelectedAccount()?.uuid : null
    if(typeof uuid !== 'string'){
        return null
    }
    const limpio = uuid.replace(/-/g, '').toLowerCase()
    if(!/^[0-9a-f]{32}$/.test(limpio)){
        return null
    }
    return `${limpio.slice(0, 8)}-${limpio.slice(8, 12)}-${limpio.slice(12, 16)}-${limpio.slice(16, 20)}-${limpio.slice(20)}`
}

/**
 * Igual que el de helios-core, pero:
 * - manda la cuenta activa en X-Potatox-Cuenta (el servidor la usa para entregarle
 *   al admin también los servidores de prueba);
 * - no espera más de 5 s ni reintenta: si el servidor está apagado se usa la
 *   copia guardada (distribution.json en userData) y el launcher sigue.
 */
api.pullRemote = async function(){
    const uuid = uuidCuentaActiva()
    try {
        const res = await got.get(this.remoteUrl, {
            responseType: 'json',
            headers: uuid ? { 'X-Potatox-Cuenta': uuid } : {},
            timeout: { request: Servidor.TIMEOUT },
            retry: { limit: 0 }
        })
        Servidor.estado.alcanzable = true
        return {
            data: res.body,
            responseStatus: RestResponseStatus.SUCCESS
        }
    } catch(error) {
        Servidor.estado.alcanzable = false
        return handleGotError('Pull Remote', error, logger, () => null)
    }
}

/**
 * Sin servidor y sin copia guardada (primera vez y con el servidor apagado), se
 * sigue con una lista vacía: Inicio, Ajustes, Perfil e instancias propias andan igual.
 */
const pullLocalOriginal = api.pullLocal.bind(api)
api.pullLocal = async function(){
    const distro = await pullLocalOriginal()
    if(distro == null){
        logger.warn('Sin servidor ni copia guardada de la distribution: sigo sin servidores.')
        return { version: '1.0.0', servers: [] }
    }
    return distro
}

exports.DistroAPI = api
exports.uuidCuentaActiva = uuidCuentaActiva
