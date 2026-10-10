/**
 * Skin y capa de la cuenta de Minecraft.
 *
 * Usa la API oficial de Mojang (la misma que usa minecraft.net): el cambio vale
 * en todo Minecraft, no solo en este launcher. Mojang solo guarda la skin activa,
 * así que el launcher lleva su propia biblioteca de skins en <userData>/skins.
 *
 * La biblioteca del launcher oficial (launcher_custom_skins.json) solo se lee.
 */
const crypto = require('crypto')
const fs     = require('fs-extra')
const got    = require('got')
const os     = require('os')
const path   = require('path')

const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('SkinManager')

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const TIMEOUT = { request: 15000 }

/** Error con un código que la interfaz traduce. */
class SkinError extends Error {
    constructor(code, detail){
        super(detail || code)
        this.code = code
    }
}
exports.SkinError = SkinError

function toSkinError(err){
    if(err instanceof SkinError){
        return err
    }
    const status = err.response?.statusCode
    if(status === 401 || status === 403){
        return new SkinError('unauthorized')
    }
    if(status === 429){
        return new SkinError('rateLimited')
    }
    if(status === 400){
        return new SkinError('invalidSkin', err.response?.body?.errorMessage)
    }
    if(status != null){
        return new SkinError('server', `HTTP ${status}`)
    }
    return new SkinError('network', err.code || err.message)
}

async function api(method, url, token, options = {}){
    try {
        const request = {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
            responseType: 'json',
            timeout: TIMEOUT,
            retry: 0
        }
        if(options.body != null){
            request.body = options.body
        }
        if(options.json != null){
            request.json = options.json
        }
        const res = await got(url, request)
        return res.body
    } catch(err){
        logger.warn(`${method} ${url} falló:`, err.response?.statusCode ?? err.code ?? err.message)
        throw toSkinError(err)
    }
}

/** Mojang a veces entrega las texturas por http; se piden siempre por https. */
function httpsUrl(url){
    return url ? url.replace(/^http:\/\//, 'https://') : url
}

/** Normaliza la respuesta de /minecraft/profile. */
function parseProfile(body){
    const skin = (body.skins || []).find(s => s.state === 'ACTIVE') || null
    const capes = (body.capes || []).map(c => ({
        id: c.id,
        alias: c.alias || c.id,
        url: httpsUrl(c.url),
        active: c.state === 'ACTIVE'
    }))
    return {
        id: body.id,
        name: body.name,
        skin: skin == null ? null : {
            url: httpsUrl(skin.url),
            variant: String(skin.variant).toUpperCase() === 'SLIM' ? 'slim' : 'classic'
        },
        capes,
        activeCape: capes.find(c => c.active)?.id || null
    }
}

/**
 * @param {string} token Token de Minecraft de la cuenta.
 * @returns {Promise<{id, name, skin: {url, variant}|null, capes: Array<{id, alias, url, active}>, activeCape: string|null}>}
 */
exports.getProfile = async function(token){
    return parseProfile(await api('GET', PROFILE_URL, token))
}

/**
 * Sube una skin y la deja activa.
 *
 * @param {string} token Token de Minecraft.
 * @param {Buffer} png La skin.
 * @param {'classic'|'slim'} variant Modelo de brazos.
 */
exports.uploadSkin = async function(token, png, variant){
    checkSkinPng(png)
    const boundary = '----PotatoxSkin' + crypto.randomBytes(12).toString('hex')
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${variant === 'slim' ? 'slim' : 'classic'}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
    return parseProfile(await api('POST', `${PROFILE_URL}/skins`, token, {
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
    }))
}

/**
 * Activa una capa que la cuenta ya tiene, o la oculta con capeId null.
 */
exports.setCape = async function(token, capeId){
    if(capeId == null){
        return parseProfile(await api('DELETE', `${PROFILE_URL}/capes/active`, token))
    }
    return parseProfile(await api('PUT', `${PROFILE_URL}/capes/active`, token, { json: { capeId } }))
}

/** Descarga una textura (skin o capa). */
exports.downloadTexture = async function(url){
    try {
        return await got(httpsUrl(url), { responseType: 'buffer', timeout: TIMEOUT, retry: 1 }).buffer()
    } catch(err){
        throw toSkinError(err)
    }
}

/**
 * Busca la skin de otro jugador por su nombre.
 *
 * @returns {Promise<{name, png: Buffer, variant}>}
 */
exports.getPlayerSkin = async function(username){
    let uuid, name
    try {
        const res = await got(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`, {
            responseType: 'json', timeout: TIMEOUT, retry: 0, throwHttpErrors: false
        })
        if(res.statusCode === 204 || res.statusCode === 404 || res.body?.id == null){
            throw new SkinError('playerNotFound')
        }
        if(res.statusCode === 429){
            throw new SkinError('rateLimited')
        }
        uuid = res.body.id
        name = res.body.name
    } catch(err){
        throw toSkinError(err)
    }

    let textures
    try {
        const session = await got(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, {
            responseType: 'json', timeout: TIMEOUT, retry: 1
        })
        const prop = (session.body.properties || []).find(p => p.name === 'textures')
        textures = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures
    } catch(err){
        throw toSkinError(err)
    }
    if(textures?.SKIN?.url == null){
        throw new SkinError('playerNoSkin')
    }
    const png = await exports.downloadTexture(textures.SKIN.url)
    return { name, png, variant: textures.SKIN.metadata?.model === 'slim' ? 'slim' : 'classic' }
}

/**
 * Lee el tamaño de un PNG.
 *
 * @returns {{width: number, height: number}|null}
 */
function pngSize(buf){
    const SIGNATURE = '89504e470d0a1a0a'
    if(!Buffer.isBuffer(buf) || buf.length < 24 || buf.subarray(0, 8).toString('hex') !== SIGNATURE){
        return null
    }
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Mojang acepta skins PNG de 64x64 o 64x32 (formato antiguo). */
function checkSkinPng(buf){
    const size = pngSize(buf)
    if(size == null){
        throw new SkinError('notPng')
    }
    if(size.width !== 64 || (size.height !== 64 && size.height !== 32)){
        throw new SkinError('badSize', `${size.width}x${size.height}`)
    }
}
exports.checkSkinPng = checkSkinPng

/* Biblioteca de skins del launcher */

function hashPng(buf){
    return crypto.createHash('sha1').update(buf).digest('hex')
}
exports.hashPng = hashPng

/**
 * Biblioteca local: <dir>/library.json y un PNG por skin, nombrado por su hash.
 */
class SkinLibrary {

    constructor(dir){
        this.dir = dir
        this.indexPath = path.join(dir, 'library.json')
    }

    /** @returns {Promise<Array<{hash, name, variant, source, added}>>} */
    async list(){
        try {
            const data = await fs.readJson(this.indexPath)
            return Array.isArray(data.skins) ? data.skins : []
        } catch(_err){
            return []
        }
    }

    async save(skins){
        await fs.ensureDir(this.dir)
        await fs.writeJson(this.indexPath, { version: 1, skins }, { spaces: 2 })
    }

    file(hash){
        return path.join(this.dir, `${hash}.png`)
    }

    async read(hash){
        return fs.readFile(this.file(hash))
    }

    /**
     * Agrega una skin si no estaba (se comparan por contenido).
     *
     * @returns {Promise<{entry, added: boolean}>}
     */
    async add(png, { name, variant, source }){
        checkSkinPng(png)
        const hash = hashPng(png)
        const skins = await this.list()
        const existing = skins.find(s => s.hash === hash)
        if(existing != null){
            return { entry: existing, added: false }
        }
        await fs.ensureDir(this.dir)
        await fs.writeFile(this.file(hash), png)
        const entry = {
            hash,
            name: String(name || 'Skin').slice(0, 40),
            variant: variant === 'slim' ? 'slim' : 'classic',
            source: source || 'file',
            added: Date.now()
        }
        skins.unshift(entry)
        await this.save(skins)
        return { entry, added: true }
    }

    async update(hash, changes){
        const skins = await this.list()
        const entry = skins.find(s => s.hash === hash)
        if(entry != null){
            Object.assign(entry, changes)
            await this.save(skins)
        }
        return entry
    }

    async remove(hash){
        const skins = await this.list()
        await this.save(skins.filter(s => s.hash !== hash))
        await fs.remove(this.file(hash))
    }
}
exports.SkinLibrary = SkinLibrary

/* Biblioteca del launcher oficial (solo lectura) */

exports.getOfficialSkinsFile = function(){
    const root = process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft')
        : process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
            : path.join(os.homedir(), '.minecraft')
    return path.join(root, 'launcher_custom_skins.json')
}

/**
 * Lee las skins guardadas en el launcher oficial. Nunca escribe en ese archivo.
 *
 * @returns {Promise<Array<{name, variant, png: Buffer}>>}
 */
exports.readOfficialSkins = async function(file = exports.getOfficialSkinsFile()){
    let data
    try {
        data = await fs.readJson(file)
    } catch(_err){
        return []
    }
    const entries = Object.values(data?.customSkins || {})
    const result = []
    for(const entry of entries){
        const match = /^data:image\/png;base64,(.+)$/.exec(entry?.skinImage || '')
        if(match == null){
            continue
        }
        const png = Buffer.from(match[1], 'base64')
        try {
            checkSkinPng(png)
        } catch(_err){
            continue
        }
        result.push({
            name: entry.name || null,
            variant: entry.slim ? 'slim' : 'classic',
            png
        })
    }
    return result
}
