/**
 * Cuando Minecraft se cierra con error: busca la causa probable en la salida del
 * juego, el crash-report más nuevo y logs/latest.log, y la explica en simple con
 * una sugerencia concreta cuando se puede.
 */
const fs   = require('fs-extra')
const path = require('path')

/**
 * El crash-report creado después de `desde` (ms), si hay.
 */
async function crashReportNuevo(carpetaJuego, desde){
    const dir = path.join(carpetaJuego, 'crash-reports')
    if(!await fs.pathExists(dir)){
        return null
    }
    let mejor = null
    for(const n of await fs.readdir(dir)){
        if(!n.endsWith('.txt')){
            continue
        }
        const ruta = path.join(dir, n)
        const { mtimeMs } = await fs.stat(ruta)
        if(mtimeMs >= desde - 2000 && (mejor == null || mtimeMs > mejor.mtimeMs)){
            mejor = { ruta, mtimeMs }
        }
    }
    return mejor ? { ruta: mejor.ruta, texto: await fs.readFile(mejor.ruta, 'utf8') } : null
}

async function leerSiExiste(ruta){
    try {
        return await fs.readFile(ruta, 'utf8')
    } catch(_err) {
        return ''
    }
}

/**
 * Reglas, de la más específica a la más general. Cada una devuelve
 * { causa, sugerencia?, mod?, accion? } o null.
 */
const REGLAS = [
    // Poca memoria.
    texto => /java\.lang\.OutOfMemoryError|Java heap space|GC overhead limit exceeded/i.test(texto)
        ? { causa: 'ram', accion: 'ram' }
        : null,
    // Java equivocado.
    texto => {
        const m = /UnsupportedClassVersionError|Unsupported class file major version (\d+)|has been compiled by a more recent version of the Java Runtime|requires? (?:Java|JDK) (\d+)/i.exec(texto)
        return m ? { causa: 'java', accion: 'java' } : null
    },
    // Mods duplicados.
    texto => {
        if(!/duplicate mods?|DuplicateModsFoundException|Duplicate mod/i.test(texto)){
            return null
        }
        const m = /(?:duplicate mods?|DuplicateModsFoundException)[\s\S]{0,300}?Mod ID: '([^']+)'/i.exec(texto)
            ?? /Duplicate mods? found[^\n]*?'([\w-]+)'/i.exec(texto)
            ?? /Duplicate mod:? '?([\w-]+)'?/i.exec(texto)
        return { causa: 'duplicado', mod: m?.[1] ?? null, accion: 'mods' }
    },
    // Falta una dependencia (Forge/NeoForge y Fabric).
    texto => {
        const forge = /Mod ID: '([^']+)', Requested by: '([^']+)'/i.exec(texto)
        if(forge){
            return { causa: 'dependencia', mod: forge[2], falta: forge[1], accion: 'mods' }
        }
        // Fabric escribe el mensaje en el idioma del juego (inglés o español).
        const fabric = /(?:Mod|El mod) '([^']+)' \(([\w-]+)\)[^\n]*?\b(?:requires|necesita)\b[^\n]*?\b(?:of|de) '?([\w.-]+)'?/i.exec(texto)
        if(fabric){
            return { causa: 'dependencia', mod: fabric[1], falta: fabric[3], accion: 'mods' }
        }
        if(/Missing or unsupported mandatory dependencies/i.test(texto)){
            return { causa: 'dependencia', accion: 'mods' }
        }
        return null
    },
    // Mod incompatible o que se cayó.
    texto => {
        const sospechoso = /Suspected Mods?:\s*([^\n(]+?)\s*\(([\w-]+)\)/i.exec(texto)
        if(sospechoso && !/Minecraft|Forge|NeoForge|Fabric Loader/i.test(sospechoso[1])){
            return { causa: 'mod', mod: sospechoso[1].trim(), accion: 'mods' }
        }
        const mixin = /Mixin apply(?: for mod)? ([\w-]+) failed|from mod ([\w-]+)/i.exec(texto)
        if(mixin){
            return { causa: 'mod', mod: mixin[1] ?? mixin[2], accion: 'mods' }
        }
        if(/Incompatible mods? found|Mod resolution failed|ModLoadingException|incompatible with/i.test(texto)){
            return { causa: 'mod', accion: 'mods' }
        }
        return null
    },
    // Placa de video o drivers.
    texto => /Pixel format not accelerated|GLFW error 65542|OpenGL.*not supported|Could not create context/i.test(texto)
        ? { causa: 'video' }
        : null
]

/**
 * @param {{carpetaJuego: string, salida: string, desde: number, codigo: number}} o
 * @returns {Promise<{causa: string, mod?: string, falta?: string, accion?: string, crash?: string, log: string, rutaLog: string}>}
 */
exports.analizar = async function({ carpetaJuego, salida, desde, codigo }){
    const crash = await crashReportNuevo(carpetaJuego, desde)
    const rutaLog = path.join(carpetaJuego, 'logs', 'latest.log')
    const latest = await leerSiExiste(rutaLog)
    // Se analiza todo junto: el crash-report trae la causa más clara.
    const texto = [crash?.texto ?? '', salida ?? '', latest.slice(-200000)].join('\n')
    let resultado = null
    for(const regla of REGLAS){
        resultado = regla(texto)
        if(resultado){
            break
        }
    }
    return {
        ...(resultado ?? { causa: 'desconocida' }),
        codigo,
        crash: crash?.ruta ?? null,
        // Para el visor: lo que dijo el juego (o latest.log si no hubo salida).
        log: (salida && salida.trim().length > 0 ? salida : latest) + (crash ? `\n\n===== ${path.basename(crash.ruta)} =====\n${crash.texto}` : ''),
        rutaLog
    }
}
