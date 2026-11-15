/**
 * Lo que viene de mc.potatox.me/launcher/ (distribution.json, servidores-extra.json,
 * noticias.json e imágenes), con timeouts cortos y caché en userData para que el
 * launcher funcione aunque el servidor esté apagado.
 *
 * En desarrollo, POTATOX_SERVIDOR cambia la URL base (para probar sin servidor).
 */
const fs        = require('fs-extra')
const path      = require('path')
const crypto    = require('crypto')
const { pathToFileURL } = require('url')
const isDev     = require('./isdev')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('Servidor')

exports.BASE = (isDev && process.env.POTATOX_SERVIDOR) || 'https://mc.potatox.me/launcher/'
exports.TIMEOUT = 5000

/** null: todavía no se sabe; true/false: si el último pedido de la distribution respondió. */
exports.estado = { alcanzable: null }

exports.url = function(nombre){
    return new URL(nombre, exports.BASE).href
}

function dirCache(){
    const { app } = require('@electron/remote')
    // Aparte de la carpeta Cache de Chromium (en Windows 'cache' sería la misma).
    return path.join(app.getPath('userData'), 'cache-servidor')
}

/**
 * Pide un JSON del servidor. Si responde, guarda la copia; si no, devuelve la
 * última copia buena (o null si nunca se bajó).
 *
 * @param {string} nombre Por ejemplo 'noticias.json'.
 * @returns {Promise<{datos: any, enLinea: boolean}>}
 */
exports.leerJson = async function(nombre){
    const archivo = path.join(dirCache(), nombre)
    try {
        const res = await fetch(exports.url(nombre), { cache: 'no-store', signal: AbortSignal.timeout(exports.TIMEOUT) })
        if(!res.ok){
            throw new Error(`HTTP ${res.status}`)
        }
        const datos = await res.json()
        fs.outputJson(archivo, datos).catch(err => logger.warn('No se pudo guardar la caché de', nombre, err.message))
        return { datos, enLinea: true }
    } catch(err) {
        logger.warn(`Sin respuesta de ${nombre} (${err.message}), uso la caché.`)
        try {
            return { datos: await fs.readJson(archivo), enLinea: false }
        } catch(_err) {
            return { datos: null, enLinea: false }
        }
    }
}

const refrescadas = new Set()

/**
 * URL para mostrar una imagen remota: la copia en caché si existe (y se
 * actualiza en segundo plano una vez por sesión), o la remota mientras se baja.
 * Las imágenes locales se devuelven tal cual.
 */
exports.imagen = function(url){
    if(typeof url !== 'string' || !/^https?:\/\//i.test(url)){
        return url
    }
    const ext = (path.extname(new URL(url).pathname) || '.img').substring(0, 6)
    const ruta = path.join(dirCache(), 'imagenes', crypto.createHash('sha1').update(url).digest('hex') + ext)
    const existe = fs.existsSync(ruta)
    if(!refrescadas.has(url)){
        refrescadas.add(url)
        bajarImagen(url, ruta)
    }
    return existe ? pathToFileURL(ruta).href : url
}

async function bajarImagen(url, ruta){
    try {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
        if(!res.ok){
            throw new Error(`HTTP ${res.status}`)
        }
        const datos = Buffer.from(await res.arrayBuffer())
        await fs.outputFile(ruta + '.tmp', datos)
        await fs.move(ruta + '.tmp', ruta, { overwrite: true })
    } catch(err) {
        logger.debug('No se pudo guardar la imagen', url, err.message)
    }
}
