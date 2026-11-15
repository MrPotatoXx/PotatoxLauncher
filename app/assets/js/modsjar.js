/**
 * Lee los mods (.jar) de una carpeta: nombre y versión desde fabric.mod.json,
 * quilt.mod.json, META-INF/mods.toml o META-INF/neoforge.mods.toml.
 * Un mod desactivado es el mismo archivo terminado en .jar.disabled.
 */
const fs      = require('fs-extra')
const path    = require('path')
const AdmZip  = require('adm-zip')
const toml    = require('toml')

const DESACTIVADO = '.disabled'

function versionManifest(zip){
    const mf = zip.getEntry('META-INF/MANIFEST.MF')
    if(mf == null){
        return null
    }
    const m = /^Implementation-Version:\s*(.+)$/m.exec(zip.readAsText(mf))
    return m ? m[1].trim() : null
}

function leerToml(texto){
    try {
        return toml.parse(texto)
    } catch(_err) {
        // Algunos mods.toml no son TOML estricto: se sacan los campos a mano.
        const campo = nombre => {
            const m = new RegExp(`^\\s*${nombre}\\s*=\\s*["']([^"']*)["']`, 'm').exec(texto)
            return m ? m[1] : null
        }
        return { mods: [{ modId: campo('modId'), displayName: campo('displayName'), version: campo('version') }] }
    }
}

/**
 * @param {string} ruta El .jar (o .jar.disabled).
 * @returns {{id: string|null, nombre: string|null, version: string|null}}
 */
exports.leerMod = function(ruta){
    try {
        const zip = new AdmZip(ruta)
        const fabric = zip.getEntry('fabric.mod.json')
        if(fabric != null){
            // Algunos traen saltos de línea sin escapar en la descripción.
            const d = JSON.parse(zip.readAsText(fabric).replace(/[\r\n\t]+/g, ' '))
            return { id: d.id ?? null, nombre: d.name ?? d.id ?? null, version: d.version ?? null }
        }
        const quilt = zip.getEntry('quilt.mod.json')
        if(quilt != null){
            const d = JSON.parse(zip.readAsText(quilt)).quilt_loader ?? {}
            return { id: d.id ?? null, nombre: d.metadata?.name ?? d.id ?? null, version: d.version ?? null }
        }
        const forge = zip.getEntry('META-INF/neoforge.mods.toml') ?? zip.getEntry('META-INF/mods.toml')
        if(forge != null){
            const mod = leerToml(zip.readAsText(forge)).mods?.[0] ?? {}
            let version = mod.version ?? null
            if(version == null || version.includes('${')){
                version = versionManifest(zip) ?? version
            }
            return { id: mod.modId ?? null, nombre: mod.displayName ?? mod.modId ?? null, version }
        }
    } catch(_err) {
        // Jar dañado o raro: se muestra solo con el nombre del archivo.
    }
    return { id: null, nombre: null, version: null }
}

/**
 * Lista los mods de una carpeta, activos y desactivados.
 *
 * @param {string} carpeta La carpeta mods de la instancia.
 * @returns {Promise<Array<{archivo: string, ruta: string, activo: boolean, nombre: string, version: string|null}>>}
 */
exports.listar = async function(carpeta){
    if(!await fs.pathExists(carpeta)){
        return []
    }
    const archivos = (await fs.readdir(carpeta))
        .filter(a => /\.jar$/i.test(a) || a.toLowerCase().endsWith('.jar' + DESACTIVADO))
    const lista = []
    for(const archivo of archivos){
        const ruta = path.join(carpeta, archivo)
        const info = exports.leerMod(ruta)
        const activo = !archivo.toLowerCase().endsWith(DESACTIVADO)
        lista.push({
            archivo,
            ruta,
            activo,
            nombre: info.nombre || archivo.replace(/\.jar(\.disabled)?$/i, ''),
            version: info.version
        })
        // Deja respirar la ventana con carpetas grandes.
        await new Promise(r => setTimeout(r, 0))
    }
    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
}

/**
 * Activa o desactiva un mod renombrándolo (.jar <-> .jar.disabled).
 *
 * @returns {Promise<string>} La ruta nueva.
 */
exports.alternar = async function(ruta, activar){
    const nueva = activar
        ? ruta.replace(new RegExp(`\\${DESACTIVADO}$`, 'i'), '')
        : ruta + DESACTIVADO
    if(nueva !== ruta){
        await fs.move(ruta, nueva, { overwrite: false })
    }
    return nueva
}

/**
 * Copia .jar a la carpeta mods (sin pisar uno que ya exista con ese nombre).
 *
 * @returns {Promise<number>} Cuántos se agregaron.
 */
exports.agregar = async function(carpeta, rutas){
    await fs.ensureDir(carpeta)
    let n = 0
    for(const r of rutas){
        if(!/\.jar$/i.test(r)){
            continue
        }
        const destino = path.join(carpeta, path.basename(r))
        if(await fs.pathExists(destino) || await fs.pathExists(destino + DESACTIVADO)){
            continue
        }
        await fs.copy(r, destino)
        n++
    }
    return n
}
