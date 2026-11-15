/**
 * Ayuda cuando el juego se cae (causa probable, sugerencia y logs), visor de logs
 * dentro del launcher y Discord Rich Presence.
 */
const Diagnostico   = require('./assets/js/diagnostico')
const Discord       = require('./assets/js/discordwrapper')
const Registro      = require('./assets/js/registro')
const { clipboard } = require('electron')

const tAyuda = (k, p) => Lang.queryJS('inicio.' + k, p)
const loggerAyuda = LoggerUtil.getLogger('Ayuda')

/* ---------- Discord ---------- */

function discordIniciar(){
    if(!ConfigManager.getDiscordActivo()){
        return
    }
    Discord.iniciar(DistroAPI.distribution?.rawDistribution?.discord?.clientId ?? null)
    Discord.enLauncher()
}

function discordEnLauncher(){
    if(ConfigManager.getDiscordActivo()){
        Discord.enLauncher()
    }
}

function discordJugando(serv){
    if(!ConfigManager.getDiscordActivo()){
        return
    }
    const id = serv.rawServer.id
    const inst = Instancias.esLocal(id) ? Instancias.obtener(id) : null
    const loader = inst ? inst.loader : loaderDeServidor(serv)
    Discord.jugando({
        nombre: serv.rawServer.name,
        detalle: `${nombreLoader(loader)} ${serv.rawServer.minecraftVersion}`,
        imagen: inst == null ? serv.rawServer.discord?.largeImageKey : null,
        imagenTexto: (inst == null ? serv.rawServer.discord?.largeImageText : null) || serv.rawServer.name
    })
}

const ajusteDiscord = document.getElementById('ajusteDiscord')
ajusteDiscord.checked = ConfigManager.getDiscordActivo()
ajusteDiscord.addEventListener('change', () => {
    ConfigManager.setDiscordActivo(ajusteDiscord.checked)
    ConfigManager.save()
    if(ajusteDiscord.checked){
        discordIniciar()
    } else {
        Discord.apagar()
    }
})

/* ---------- Visor de logs ---------- */

const modalLog = document.getElementById('modalLog')
const logContenido = document.getElementById('logContenido')
const logBuscar = document.getElementById('logBuscar')
let logActual = { texto: '', carpeta: null }
let coincidencias = []
let coincidenciaActual = -1

function nivelLinea(l){
    if(/\b(ERROR|FATAL|SEVERE)\b|Exception|^\s+at |Caused by:/.test(l)){
        return 'error'
    }
    if(/\bWARN(ING)?\b/.test(l)){
        return 'warn'
    }
    if(/\bDEBUG\b|\bTRACE\b/.test(l)){
        return 'debug'
    }
    return ''
}

/**
 * @param {string} titulo
 * @param {string} texto
 * @param {string|null} carpeta Para "Abrir carpeta de logs".
 */
function abrirVisorLog(titulo, texto, carpeta){
    logActual = { texto: texto ?? '', carpeta }
    document.getElementById('logTitulo').textContent = titulo
    // Las últimas 8000 líneas alcanzan y no traban la ventana.
    const lineas = logActual.texto.split(/\r?\n/)
    const visibles = lineas.slice(-8000)
    const frag = document.createDocumentFragment()
    if(lineas.length > visibles.length){
        frag.append(Object.assign(document.createElement('div'), { className: 'lineaLog debug', textContent: tAyuda('logRecortado', { n: lineas.length - visibles.length }) }))
    }
    for(const l of visibles){
        const d = document.createElement('div')
        d.className = 'lineaLog ' + nivelLinea(l)
        d.textContent = l || ' '
        frag.append(d)
    }
    logContenido.replaceChildren(frag)
    logBuscar.value = ''
    document.getElementById('logCoincidencias').textContent = ''
    coincidencias = []
    modalLog.hidden = false
    logContenido.scrollTop = logContenido.scrollHeight
    logBuscar.focus()
}

function buscarEnLog(){
    const termino = logBuscar.value.trim().toLowerCase()
    for(const d of coincidencias){
        d.removeAttribute('encontrada')
        d.removeAttribute('actual')
    }
    coincidencias = []
    coincidenciaActual = -1
    if(termino){
        for(const d of logContenido.children){
            if(d.textContent.toLowerCase().includes(termino)){
                d.setAttribute('encontrada', '')
                coincidencias.push(d)
            }
        }
    }
    document.getElementById('logCoincidencias').textContent = termino ? tAyuda('logCoincidencias', { n: coincidencias.length }) : ''
    siguienteCoincidencia()
}

function siguienteCoincidencia(){
    if(coincidencias.length === 0){
        return
    }
    coincidencias[coincidenciaActual]?.removeAttribute('actual')
    coincidenciaActual = (coincidenciaActual + 1) % coincidencias.length
    const d = coincidencias[coincidenciaActual]
    d.setAttribute('actual', '')
    d.scrollIntoView({ block: 'center' })
}

let esperaBusqueda = null
logBuscar.addEventListener('input', () => {
    clearTimeout(esperaBusqueda)
    esperaBusqueda = setTimeout(buscarEnLog, 200)
})
logBuscar.addEventListener('keydown', e => {
    if(e.key === 'Enter'){
        e.preventDefault()
        siguienteCoincidencia()
    }
})
modalLog.querySelector('[data-accion="cerrar"]').addEventListener('click', () => {
    modalLog.hidden = true
})
modalLog.addEventListener('keydown', e => {
    if(e.key === 'Escape'){
        modalLog.hidden = true
    }
})
modalLog.querySelector('[data-accion="copiar"]').addEventListener('click', () => clipboard.writeText(logActual.texto))
modalLog.querySelector('[data-accion="carpeta"]').addEventListener('click', () => {
    if(logActual.carpeta){
        abrirCarpeta(logActual.carpeta)
    }
})

document.getElementById('ajusteVerLogs').addEventListener('click', async () => {
    let texto = ''
    try {
        texto = await require('fs-extra').readFile(Registro.archivo, 'utf8')
    } catch(_err) {
        texto = tAyuda('logVacio')
    }
    abrirVisorLog(tAyuda('logLauncherTitulo'), texto, require('path').dirname(Registro.archivo))
})

/* ---------- El juego se cerró con un error ---------- */

const modalCrash = document.getElementById('modalCrash')
let crashActual = null

function ramActualGb(id){
    try {
        return ramAGb(ConfigManager.getMaxRAM(id))
    } catch(_err) {
        return 4
    }
}

/**
 * La lanza lanzarProceso (landing.js) cuando Minecraft sale con un código distinto de 0.
 */
async function mostrarAyudaCrash(o){
    let r
    try {
        r = await Diagnostico.analizar(o)
    } catch(err) {
        loggerAyuda.error('No se pudo analizar el cierre del juego.', err)
        r = { causa: 'desconocida', codigo: o.codigo, log: o.salida, rutaLog: require('path').join(o.carpetaJuego, 'logs', 'latest.log') }
    }
    const id = o.servidor.rawServer.id
    crashActual = { ...r, id, carpetaJuego: o.carpetaJuego, local: Instancias.esLocal(id) }
    toggleLaunchArea(false)

    const mod = r.mod ?? tAyuda('crash.unMod')
    const total = require('os').totalmem() / (1024 ** 3)
    const ramNueva = Math.min(Math.max(2, Math.floor(total - 2)), Math.ceil(ramActualGb(id)) + 2)
    const textos = {
        ram: [tAyuda('crash.ram'), tAyuda('crash.ramSugerencia', { gb: ramNueva }), tAyuda('crash.ramBoton', { gb: ramNueva })],
        java: [tAyuda('crash.java'), tAyuda('crash.javaSugerencia'), tAyuda('crash.javaBoton')],
        duplicado: [tAyuda('crash.duplicado', { mod }), tAyuda('crash.duplicadoSugerencia', { mod }), tAyuda('crash.carpetaMods')],
        dependencia: [r.falta ? tAyuda('crash.dependencia', { mod, falta: r.falta }) : tAyuda('crash.dependenciaSinNombre'), r.falta ? tAyuda('crash.dependenciaSugerencia', { mod, falta: r.falta }) : null, tAyuda('crash.irMods')],
        mod: [r.mod ? tAyuda('crash.mod', { mod }) : tAyuda('crash.modSinNombre'), r.mod ? tAyuda('crash.modSugerencia', { mod }) : tAyuda('crash.modSinNombreSugerencia'), tAyuda('crash.irMods')],
        video: [tAyuda('crash.video'), tAyuda('crash.videoSugerencia'), null],
        // En Windows un -1 llega como 4294967295.
        desconocida: [tAyuda('crash.desconocida', { codigo: r.codigo > 0x7fffffff ? r.codigo - 0x100000000 : r.codigo }), tAyuda('crash.desconocidaSugerencia'), null]
    }
    const [causa, sugerencia, boton] = textos[r.causa] ?? textos.desconocida
    document.getElementById('crashCausa').textContent = causa
    const sug = document.getElementById('crashSugerencia')
    sug.textContent = sugerencia ?? ''
    sug.hidden = !sugerencia
    const arreglar = modalCrash.querySelector('[data-accion="arreglar"]')
    arreglar.hidden = boton == null
    arreglar.textContent = boton ?? ''
    arreglar.dataset.gb = ramNueva
    document.getElementById('crashCopiado').hidden = true
    modalCrash.hidden = false
}

modalCrash.querySelector('[data-accion="arreglar"]').addEventListener('click', e => {
    const c = crashActual
    if(c == null){
        return
    }
    switch(c.causa){
        case 'ram': {
            const valor = `${e.currentTarget.dataset.gb}G`
            ConfigManager.setMaxRAM(c.id, valor)
            ConfigManager.setMinRAM(c.id, valor)
            ConfigManager.save()
            e.currentTarget.textContent = tAyuda('crash.listo')
            e.currentTarget.disabled = true
            break
        }
        case 'java':
            // Sin Java elegido, al jugar se busca o se baja el que corresponde.
            ConfigManager.setJavaExecutable(c.id, null)
            ConfigManager.save()
            e.currentTarget.textContent = tAyuda('crash.listo')
            e.currentTarget.disabled = true
            break
        case 'duplicado':
            abrirCarpeta(require('path').join(c.carpetaJuego, 'mods'))
            break
        default:
            modalCrash.hidden = true
            if(c.local){
                abrirInstancia(c.id, 'mods')
            } else {
                abrirServidor(c.id)
                elegirPestana('servidor', 'mods')
                modsExtraServidor.cargar()
            }
    }
})
modalCrash.querySelector('[data-accion="reintentar"]').addEventListener('click', () => {
    modalCrash.hidden = true
    modalCrash.querySelector('[data-accion="arreglar"]').disabled = false
    if(typeof ultimoLanzamiento === 'function'){
        ultimoLanzamiento()
    }
})
modalCrash.querySelector('[data-accion="verLog"]').addEventListener('click', () => {
    if(crashActual){
        abrirVisorLog(tAyuda('logJuegoTitulo'), crashActual.log, require('path').dirname(crashActual.rutaLog))
    }
})
modalCrash.querySelector('[data-accion="copiarLog"]').addEventListener('click', () => {
    if(crashActual){
        clipboard.writeText(crashActual.log)
        document.getElementById('crashCopiado').hidden = false
    }
})
modalCrash.querySelector('[data-accion="carpetaLogs"]').addEventListener('click', () => {
    if(crashActual){
        abrirCarpeta(require('path').dirname(crashActual.rutaLog))
    }
})
modalCrash.querySelector('[data-accion="cerrar"]').addEventListener('click', () => {
    modalCrash.hidden = true
    modalCrash.querySelector('[data-accion="arreglar"]').disabled = false
})
