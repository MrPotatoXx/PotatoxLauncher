/**
 * Guarda lo que el launcher escribe en la consola en <userData>/logs/launcher.log,
 * para verlo desde Ajustes sin abrir las herramientas de Chromium. Cada vez que se
 * abre el launcher, el anterior queda como launcher-anterior.log.
 */
const fs   = require('fs-extra')
const path = require('path')
const util = require('util')
const { app } = require('@electron/remote')

const dir = path.join(app.getPath('userData'), 'logs')
const archivo = path.join(dir, 'launcher.log')
const anterior = path.join(dir, 'launcher-anterior.log')

let pendiente = []
let escribiendo = false

try {
    fs.ensureDirSync(dir)
    if(fs.existsSync(archivo)){
        fs.moveSync(archivo, anterior, { overwrite: true })
    }
    fs.writeFileSync(archivo, `Potatox Launcher ${app.getVersion()} · ${new Date().toISOString()}\n`)
} catch(_err) {
    // Sin archivo de log se sigue igual.
}

function volcar(){
    if(escribiendo || pendiente.length === 0){
        return
    }
    escribiendo = true
    const texto = pendiente.join('')
    pendiente = []
    fs.appendFile(archivo, texto).catch(() => {}).finally(() => {
        escribiendo = false
        volcar()
    })
}

function formatear(args){
    return args.map(a => typeof a === 'string' ? a : util.inspect(a, { depth: 3, breakLength: 140 }))
        .join(' ')
        // Sin los códigos de color de la terminal.
        .replace(/\x1b\[[0-9;]*m/g, '')
}

for(const nivel of ['log', 'info', 'warn', 'error', 'debug']){
    const original = console[nivel].bind(console)
    console[nivel] = (...args) => {
        original(...args)
        try {
            const hora = new Date().toTimeString().substring(0, 8)
            const etiqueta = nivel === 'log' ? '' : `[${nivel.toUpperCase()}] `
            pendiente.push(`[${hora}] ${etiqueta}${formatear(args)}\n`)
            volcar()
        } catch(_err) {
            // Nunca romper el launcher por el log.
        }
    }
}

exports.archivo = archivo
exports.anterior = anterior
