/**
 * Discord Rich Presence: "En el launcher" mientras está abierto y "Jugando <nombre>"
 * con el ícono del servidor o del loader mientras se juega. Se apaga desde Ajustes.
 *
 * Necesita el Application ID de una app de Discord: se toma de distribution.json
 * ("discord": { "clientId": "..." }) o de CLIENT_ID_POR_DEFECTO. Sin ID, o sin
 * Discord abierto, no hace nada.
 */
const { LoggerUtil } = require('helios-core')
const { Client } = require('discord-rpc-patch')

const Lang = require('./langloader')

const logger = LoggerUtil.getLogger('DiscordWrapper')

// Application ID de la app "Potatox Launcher" en el Developer Portal de Discord.
// Se usa si la distribution no trae discord.clientId o no se pudo descargar.
const CLIENT_ID_POR_DEFECTO = '1571646877303050330'
// Clave de la imagen subida en Rich Presence → Art Assets del portal (ícono del launcher).
const ICONO_LAUNCHER = 'icono'

let client = null
let clientId = null
let conectado = false
let actividad = null

function aplicar(){
    if(client != null && conectado && actividad != null){
        client.setActivity(actividad).catch(err => logger.warn('No se pudo actualizar Discord.', err.message))
    }
}

/**
 * Conecta con Discord (si hay ID y Discord está abierto).
 *
 * @param {string|null} id El Application ID (o null para usar el de por defecto).
 */
exports.iniciar = function(id){
    clientId = (typeof id === 'string' && id.trim() !== '') ? id.trim() : CLIENT_ID_POR_DEFECTO
    if(client != null || clientId == null){
        if(clientId == null){
            logger.info('Discord Rich Presence sin Application ID: desactivado.')
        }
        return
    }
    client = new Client({ transport: 'ipc' })
    client.on('ready', () => {
        conectado = true
        logger.info('Discord RPC Connected')
        aplicar()
    })
    client.login({ clientId }).catch(error => {
        conectado = false
        client = null
        if(error.message.includes('ENOENT') || error.message.includes('connect')) {
            logger.info('Discord no está abierto: sin Rich Presence.')
        } else {
            logger.info('Unable to initialize Discord Rich Presence: ' + error.message)
        }
    })
}

/** "En el launcher". */
exports.enLauncher = function(){
    actividad = {
        details: Lang.queryJS('discord.enLauncher'),
        largeImageKey: ICONO_LAUNCHER,
        largeImageText: 'Potatox Launcher',
        instance: false
    }
    aplicar()
}

/**
 * "Jugando <nombre>".
 *
 * @param {{nombre: string, detalle?: string, imagen?: string, imagenTexto?: string}} o
 * `imagen` es la clave de un Art Asset (discord.largeImageKey del servidor); sin ella, el ícono.
 */
exports.jugando = function(o){
    const imagen = (typeof o.imagen === 'string' && o.imagen.trim() !== '') ? o.imagen.trim() : ICONO_LAUNCHER
    actividad = {
        details: Lang.queryJS('discord.jugando', { nombre: o.nombre }),
        state: o.detalle || undefined,
        largeImageKey: imagen,
        largeImageText: o.imagenTexto || o.nombre,
        startTimestamp: Date.now(),
        instance: false
    }
    // Con el arte del servidor, el ícono del launcher va chico en la esquina.
    if(imagen !== ICONO_LAUNCHER){
        actividad.smallImageKey = ICONO_LAUNCHER
        actividad.smallImageText = 'Potatox Launcher'
    }
    aplicar()
}

/** Compatibilidad con el código de Helios (mensajes durante la carga del juego). */
exports.updateDetails = function(details){
    if(actividad != null){
        actividad.state = details
        aplicar()
    }
}

exports.apagar = function(){
    if(client == null){
        return
    }
    try {
        client.clearActivity().catch(() => {})
        client.destroy().catch(() => {})
    } catch(_err) {
        // Ya estaba cerrado.
    }
    client = null
    conectado = false
}
