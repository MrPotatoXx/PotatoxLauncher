/**
 * El reino vivo: integra a la escena lo que pasa en el servidor.
 *
 * Lee https://mc.potatox.me/reino.json al abrir y cada minuto, y muestra:
 * - la voz de Aldric (una frase a la vez, escrita como con pluma),
 * - la barra de la Prueba de Aldric con su cuenta regresiva,
 * - las gemas de los fragmentos de la corona alrededor del logo,
 * - la Luna de Sangre (body[luna], ver reino.css),
 * - las cabezas de los jugadores conectados junto a JUGAR,
 * - las Crónicas (la actividad) en el panel de noticias.
 * Si la lectura falla, se oculta en silencio todo lo que depende de ella.
 */
const REINO_URL = 'https://mc.potatox.me/reino.json'
const REINO_INTERVALO = 60 * 1000
const REINO_TIMEOUT = 10 * 1000
const ALDRIC_ROTACION = 8 * 1000
const ALDRIC_PLUMA = 14 // ms por letra

const loggerReino = LoggerUtil.getLogger('Reino')

// Colores de Minecraft para el borde de las cabezas (sobre fondo oscuro).
const REINO_COLORES = {
    black: '#3A3A3A',
    dark_blue: '#3F3FCC',
    dark_green: '#00AA00',
    dark_aqua: '#00AAAA',
    dark_red: '#AA0000',
    dark_purple: '#AA00AA',
    gold: '#FFAA00',
    gray: '#AAAAAA',
    dark_gray: '#555555',
    blue: '#5555FF',
    green: '#55FF55',
    aqua: '#55FFFF',
    red: '#FF5555',
    light_purple: '#FF55FF',
    yellow: '#FFFF55',
    white: '#FFFFFF'
}

const reinoMovimientoReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const aldricVoz = document.getElementById('aldricVoz')
const aldricFrase = document.getElementById('aldricFrase')
const pruebaBarra = document.getElementById('pruebaBarra')
const pruebaTexto = document.getElementById('pruebaTexto')
const pruebaLleno = document.getElementById('pruebaLleno')
const coronaGemas = document.getElementById('coronaGemas')
const conectadosCabezas = document.getElementById('conectadosCabezas')
const cronicasLista = document.getElementById('cronicasLista')
const reinoTooltip = document.getElementById('reinoTooltip')
const lunaAnuncio = document.getElementById('lunaAnuncio')

let reinoDatos = null
let reinoLeyendo = false
let reinoUltimaLectura = 0

function reinoTexto(key, placeholders){
    return Lang.queryJS('landing.reino.' + key, placeholders)
}

function reinoEl(tag, className, text){
    const el = document.createElement(tag)
    if(className){
        el.className = className
    }
    if(text != null){
        el.textContent = text
    }
    return el
}

/* Tooltip compartido (gemas y cabezas) */

function mostrarReinoTooltip(ancla, contenido){
    reinoTooltip.replaceChildren(...contenido)
    reinoTooltip.setAttribute('visible', '')
    const r = ancla.getBoundingClientRect()
    const t = reinoTooltip.getBoundingClientRect()
    let x = r.left + r.width / 2 - t.width / 2
    x = Math.max(8, Math.min(window.innerWidth - t.width - 8, x))
    let y = r.bottom + 10
    if(y + t.height > window.innerHeight - 8){
        y = r.top - t.height - 10
    }
    reinoTooltip.style.left = x + 'px'
    reinoTooltip.style.top = y + 'px'
}

function ocultarReinoTooltip(){
    reinoTooltip.removeAttribute('visible')
}

function conTooltip(el, contenido){
    el.tabIndex = 0
    el.addEventListener('mouseenter', () => mostrarReinoTooltip(el, contenido()))
    el.addEventListener('focus', () => mostrarReinoTooltip(el, contenido()))
    el.addEventListener('mouseleave', ocultarReinoTooltip)
    el.addEventListener('blur', ocultarReinoTooltip)
}

/* Voz de Aldric */

let aldricFrases = []
let aldricIndice = 0
let aldricTimer = null
let aldricPluma = null

function escribirAldric(frase){
    clearInterval(aldricPluma)
    aldricFrase.textContent = ''
    aldricVoz.removeAttribute('apagada')
    if(reinoMovimientoReducido){
        aldricFrase.textContent = frase
        return
    }
    let i = 0
    aldricPluma = setInterval(() => {
        i++
        aldricFrase.textContent = frase.slice(0, i)
        if(i >= frase.length){
            clearInterval(aldricPluma)
        }
    }, ALDRIC_PLUMA)
}

function siguienteAldric(){
    clearTimeout(aldricTimer)
    if(aldricFrases.length === 0){
        return
    }
    if(document.hidden){
        aldricTimer = setTimeout(siguienteAldric, 1000)
        return
    }
    const frase = aldricFrases[aldricIndice % aldricFrases.length]
    aldricIndice++
    const espera = Math.max(ALDRIC_ROTACION, frase.length * ALDRIC_PLUMA + 5000)
    if(aldricFrases.length > 1 && aldricVoz.style.display !== 'none' && aldricFrase.textContent){
        // Se apaga la frase anterior antes de escribir la nueva.
        aldricVoz.setAttribute('apagada', '')
        aldricTimer = setTimeout(() => {
            escribirAldric(frase)
            aldricTimer = setTimeout(siguienteAldric, espera)
        }, 300)
    } else {
        escribirAldric(frase)
        aldricTimer = setTimeout(siguienteAldric, espera)
    }
}

function pintarAldric(frases){
    frases = Array.isArray(frases) ? frases.filter(f => typeof f === 'string' && f.trim()) : []
    if(frases.length === 0){
        aldricFrases = []
        clearTimeout(aldricTimer)
        clearInterval(aldricPluma)
        aldricVoz.style.display = 'none'
        return
    }
    const iguales = frases.length === aldricFrases.length && frases.every((f, i) => f === aldricFrases[i])
    aldricFrases = frases
    aldricVoz.style.display = ''
    if(!iguales){
        // Frases nuevas: empezar por la más importante.
        aldricIndice = 0
        aldricFrase.textContent = ''
        siguienteAldric()
    }
}

/* Prueba de Aldric (barra tipo bossbar) */

let pruebaFin = null
let pruebaTotal = 0
let pruebaClave = null

function tickPrueba(){
    if(pruebaFin == null){
        return
    }
    const resto = pruebaFin - Date.now() / 1000
    if(resto <= 0){
        pruebaFin = null
        pruebaBarra.style.display = 'none'
        return
    }
    const m = Math.floor(resto / 60)
    const s = Math.floor(resto % 60)
    pruebaTexto.setAttribute('tiempo', `${m}:${String(s).padStart(2, '0')}`)
    pruebaLleno.style.width = Math.min(100, resto / pruebaTotal * 100) + '%'
}

function pintarPrueba(prueba, actualizado){
    if(prueba == null || !prueba.activa || !prueba.texto){
        pruebaFin = null
        pruebaClave = null
        pruebaBarra.style.display = 'none'
        return
    }
    pruebaTexto.textContent = reinoTexto('pruebaTitulo', { texto: prueba.texto })
    pruebaBarra.toggleAttribute('morada', prueba.texto.startsWith('No '))
    pruebaBarra.style.display = ''
    if(prueba.segundos == null){
        pruebaFin = null
        pruebaTexto.removeAttribute('tiempo')
        pruebaLleno.style.width = '100%'
        return
    }
    // La barra se vacía desde lo que quedaba la primera vez que vimos esta prueba.
    if(pruebaClave !== prueba.texto){
        pruebaClave = prueba.texto
        pruebaTotal = prueba.segundos
    }
    pruebaTotal = Math.max(pruebaTotal, prueba.segundos, 1)
    pruebaFin = (actualizado ?? Date.now() / 1000) + prueba.segundos
    tickPrueba()
}

/* Corona de fragmentos alrededor del logo */

function pintarGemas(frag){
    if(frag == null || !(frag.total > 0)){
        coronaGemas.replaceChildren()
        return
    }
    let lista = Array.isArray(frag.lista) ? frag.lista : []
    if(lista.length === 0){
        lista = Array.from({ length: frag.total }, (_, i) => ({ ok: i < frag.logrados }))
    }
    const radio = 50
    const gemas = lista.map((f, i) => {
        const angulo = -Math.PI / 2 + i * 2 * Math.PI / lista.length
        const gema = reinoEl('div', 'gema')
        gema.style.left = `calc(50% + ${(Math.cos(angulo) * radio).toFixed(1)}px)`
        gema.style.top = `calc(50% + ${(Math.sin(angulo) * radio).toFixed(1)}px)`
        gema.style.animationDelay = (i * 0.35).toFixed(2) + 's'
        gema.toggleAttribute('ok', f.ok === true)
        if(f.nombre){
            conTooltip(gema, () => {
                const partes = [reinoEl('div', 'reinoTooltipTitulo', f.nombre)]
                if(f.jefe){
                    partes.push(reinoEl('div', null, reinoTexto('gemaDerrotando', { jefe: f.jefe })))
                }
                partes.push(f.ok
                    ? reinoEl('div', 'reinoTooltipOk', f.quien ? reinoTexto('gemaRecuperado', { quien: f.quien }) : '')
                    : reinoEl('div', 'reinoTooltipTenue', reinoTexto('gemaPerdido')))
                return partes
            })
        }
        return gema
    })
    coronaGemas.replaceChildren(...gemas)
}

/* Luna de Sangre */

let lunaAnunciada = false
let lunaAnuncioTimer = null

function pintarLuna(activa){
    document.body.toggleAttribute('luna', activa)
    if(activa && !lunaAnunciada){
        lunaAnunciada = true
        lunaAnuncio.setAttribute('mostrar', '')
        clearTimeout(lunaAnuncioTimer)
        lunaAnuncioTimer = setTimeout(() => lunaAnuncio.removeAttribute('mostrar'), 3800)
    } else if(!activa){
        lunaAnunciada = false
        clearTimeout(lunaAnuncioTimer)
        lunaAnuncio.removeAttribute('mostrar')
    }
}

/* Jugadores conectados (cabezas junto a JUGAR) */

function pintarConectados(conectados){
    conectados = Array.isArray(conectados) ? conectados : []
    const cabezas = conectados.filter(j => j && j.nombre).map(j => {
        const img = reinoEl('img', 'cabeza')
        img.src = `https://mc-heads.net/avatar/${encodeURIComponent(j.nombre)}/24`
        img.alt = j.nombre
        img.style.borderColor = REINO_COLORES[j.color] ?? REINO_COLORES.gray
        conTooltip(img, () => {
            const partes = [reinoEl('div', 'reinoTooltipTitulo', j.nombre)]
            if(j.titulo){
                const t = reinoEl('div', null, j.titulo)
                t.style.color = REINO_COLORES[j.color] ?? REINO_COLORES.gray
                partes.push(t)
            }
            return partes
        })
        return img
    })
    conectadosCabezas.replaceChildren(...cabezas)
    conectadosCabezas.style.display = cabezas.length > 0 ? '' : 'none'
}

/* Crónicas (actividad) */

function haceCuanto(t){
    const seg = Math.max(0, Date.now() / 1000 - t)
    if(seg < 60){
        return reinoTexto('haceUnMomento')
    }
    if(seg < 3600){
        return reinoTexto('haceMinutos', { n: Math.floor(seg / 60) })
    }
    if(seg < 86400){
        return reinoTexto('haceHoras', { n: Math.floor(seg / 3600) })
    }
    const dias = Math.floor(seg / 86400)
    return dias === 1 ? reinoTexto('ayer') : reinoTexto('haceDias', { n: dias })
}

function pintarCronicas(actividad, sinDatos){
    if(sinDatos){
        cronicasLista.replaceChildren(reinoEl('div', 'cronicaVacia', reinoTexto('cronicasSinDatos')))
        return
    }
    const entradas = (Array.isArray(actividad) ? actividad : [])
        .filter(a => a && a.texto)
        .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
        .slice(0, 40)
        .map(a => {
            const fila = reinoEl('div', 'cronica')
            fila.setAttribute('tipo', a.tipo ?? '')
            if(a.t != null){
                fila.appendChild(reinoEl('span', 'cronicaFecha', haceCuanto(a.t)))
            }
            fila.appendChild(reinoEl('span', 'cronicaTexto', a.texto))
            return fila
        })
    if(entradas.length === 0){
        cronicasLista.replaceChildren(reinoEl('div', 'cronicaVacia', reinoTexto('cronicasVacio')))
    } else {
        cronicasLista.replaceChildren(...entradas)
    }
}

/* Lectura */

function pintarReino(d){
    reinoDatos = d
    pintarAldric(d.aldric)
    pintarPrueba(d.prueba, d.actualizado)
    pintarGemas(d.fragmentos)
    pintarLuna(d.luna_de_sangre === true)
    pintarConectados(d.conectados)
    pintarCronicas(d.actividad, false)
}

function ocultarReino(){
    reinoDatos = null
    pintarAldric([])
    pintarPrueba(null)
    pintarGemas(null)
    pintarLuna(false)
    pintarConectados([])
    pintarCronicas(null, true)
}

/**
 * Vuelve a leer el estado del reino. Se llama al cargar la distribución, al
 * cambiar de servidor (overlay.js) y cada minuto mientras la ventana se ve.
 */
async function refreshServerStatus(){
    if(reinoLeyendo){
        return
    }
    reinoLeyendo = true
    reinoUltimaLectura = Date.now()
    try {
        const res = await fetch(REINO_URL, { cache: 'no-store', signal: AbortSignal.timeout(REINO_TIMEOUT) })
        if(!res.ok){
            throw new Error('HTTP ' + res.status)
        }
        const datos = await res.json()
        if(datos == null || typeof datos !== 'object'){
            throw new Error('Respuesta inválida')
        }
        pintarReino(datos)
    } catch(err) {
        loggerReino.warn('No se pudo leer el estado del reino:', err.message)
        ocultarReino()
    } finally {
        reinoLeyendo = false
    }
}

setInterval(() => {
    if(!document.hidden){
        refreshServerStatus()
    }
}, REINO_INTERVALO)

setInterval(() => {
    if(!document.hidden){
        tickPrueba()
    }
}, 1000)

document.addEventListener('visibilitychange', () => {
    if(!document.hidden && Date.now() - reinoUltimaLectura >= REINO_INTERVALO){
        refreshServerStatus()
    }
})
