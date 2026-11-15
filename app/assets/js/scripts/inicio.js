/**
 * La vista principal del launcher: barra lateral, Inicio, Servidores, Mis instancias,
 * la vista de cada servidor e instancia, el perfil y el diálogo para crear instancias.
 *
 * Los servidores llegan del distribution.json (el servidor decide cuáles ve cada uno).
 * Los datos de presentación (loader, banner, color, estado y paneles) vienen aparte
 * en servidores-extra.json y las noticias en noticias.json. Si algo falla se muestran
 * valores por defecto y el launcher sigue andando.
 */
const { getStatus: pingLegacy, getStatusModerno } = require('./assets/js/serverstatus')
const { SHELL_OPCODE }            = require('./assets/js/ipcconstants')
const ModsJar                     = require('./assets/js/modsjar')
const fsInicio                    = require('fs-extra')
const pathInicio                  = require('path')
const { pathToFileURL }           = require('url')
const Servidor                    = require('./assets/js/servidor')

const IMG           = 'assets/images/potato'
const loggerInicio  = LoggerUtil.getLogger('Inicio')

let distroInicio = null
let extrasServidores = {}
let estadosServidores = {}
let noticiasCache = []
let seccionActual = 'inicio'
let seccionAnterior = 'inicio'
let instanciaAbierta = null

const tInicio = (k, p) => Lang.queryJS('inicio.' + k, p)

/* ---------- Íconos de loader (pixel art 8×8) ---------- */

const ICONOS_LOADER = {
    vanilla: '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><rect width="8" height="8" fill="#8b5a2b"/><rect width="8" height="2" fill="#6cc04a"/><rect y="2" width="1" height="1" fill="#6cc04a"/><rect x="2" y="2" width="2" height="1" fill="#6cc04a"/><rect x="5" y="2" width="1" height="1" fill="#6cc04a"/><rect x="7" y="2" width="1" height="2" fill="#6cc04a"/><rect x="1" width="1" height="1" fill="#58a535"/><rect x="5" y="1" width="1" height="1" fill="#58a535"/><rect x="1" y="4" width="1" height="1" fill="#6b431f"/><rect x="4" y="5" width="1" height="1" fill="#6b431f"/><rect x="6" y="6" width="1" height="1" fill="#6b431f"/><rect x="2" y="7" width="1" height="1" fill="#a9733d"/><rect x="5" y="3" width="1" height="1" fill="#a9733d"/></svg>',
    fabric: '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><rect width="8" height="8" fill="#e3d6b4"/><rect width="4" height="4" fill="#cdbb8f"/><rect x="4" y="4" width="4" height="4" fill="#cdbb8f"/><rect x="1" y="1" width="2" height="2" fill="#e3d6b4"/><rect x="5" y="5" width="2" height="2" fill="#e3d6b4"/><rect y="7" width="8" height="1" fill="#a99568"/></svg>',
    forge: '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><rect y="2" width="8" height="1" fill="#7d848c"/><rect x="1" y="3" width="6" height="1" fill="#5b6168"/><rect x="3" y="4" width="2" height="1" fill="#5b6168"/><rect x="2" y="5" width="4" height="1" fill="#5b6168"/><rect x="1" y="6" width="6" height="1" fill="#454a50"/><rect y="2" width="2" height="1" fill="#9aa1a8"/></svg>',
    neoforge: '<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><rect y="2" width="8" height="1" fill="#e2a15a"/><rect x="1" y="3" width="6" height="1" fill="#c47a35"/><rect x="3" y="4" width="2" height="1" fill="#c47a35"/><rect x="2" y="5" width="4" height="1" fill="#c47a35"/><rect x="1" y="6" width="6" height="1" fill="#9a5a24"/><rect y="2" width="2" height="1" fill="#f2c48a"/></svg>'
}

const ICONO_PAPELERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'

/* ---------- Utilidades ---------- */

function el(tag, clase, texto){
    const e = document.createElement(tag)
    if(clase){
        e.className = clase
    }
    if(texto != null){
        e.textContent = texto
    }
    return e
}

async function pedirJson(url){
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if(!res.ok){
        throw new Error(`HTTP ${res.status}`)
    }
    return res.json()
}

async function abrirCarpeta(carpeta){
    await fsInicio.ensureDir(carpeta)
    shell.openPath(carpeta)
}

async function aLaPapelera(ruta){
    const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, ruta)
    if(!res.result){
        loggerInicio.error('No se pudo mandar a la papelera.', ruta, res.error)
    }
    return res.result
}

function confirmar(titulo, texto, si, alAceptar){
    setOverlayContent(titulo, texto, si, tInicio('cancelar'))
    setOverlayHandler(() => {
        toggleOverlay(false)
        alAceptar()
    })
    setDismissHandler(() => toggleOverlay(false))
    toggleOverlay(true, true)
}

function mostrarError(titulo, texto){
    setOverlayContent(titulo, `<img class="overlayMascota" src="${IMG}/mascota-error.png" alt="">${texto}`, tInicio('entendido'))
    setOverlayHandler(null)
    toggleOverlay(true)
}

function nombreLoader(id){
    return Instancias.LOADERS[id]?.nombre ?? id
}

function chipLoader(loader, version){
    const c = el('span', 'chip chipLoader', `${nombreLoader(loader)} ${version}`)
    c.setAttribute('loader', loader)
    return c
}

function vacio(texto){
    const v = el('div', 'listaVacia')
    const img = el('img')
    img.src = `${IMG}/mascota-vacio.png`
    img.alt = ''
    v.append(img, el('p', null, texto))
    return v
}

/**
 * Pestañas: los botones [role=tab] y los .pestana de un mismo data-grupo.
 */
function elegirPestana(grupo, pestana){
    for(const b of document.querySelectorAll(`.pestanas[data-grupo="${grupo}"] [role="tab"]`)){
        b.setAttribute('aria-selected', b.dataset.pestana === pestana ? 'true' : 'false')
    }
    for(const p of document.querySelectorAll(`.pestana[data-grupo="${grupo}"]`)){
        p.hidden = p.dataset.pestana !== pestana
    }
}
for(const barra of document.querySelectorAll('.pestanas')){
    for(const b of barra.querySelectorAll('[role="tab"]')){
        b.addEventListener('click', () => {
            elegirPestana(barra.dataset.grupo, b.dataset.pestana)
            if(barra.dataset.grupo === 'instancia' && b.dataset.pestana === 'mods'){
                cargarModsInstancia()
            }
            if(barra.dataset.grupo === 'servidor' && b.dataset.pestana === 'mods'){
                modsExtraServidor.cargar()
            }
        })
    }
}

/**
 * Botones para abrir las subcarpetas de una instancia o servidor.
 */
function pintarCarpetas(contenedor, base, nombres){
    contenedor.replaceChildren()
    for(const n of nombres){
        const b = el('button', 'botonCarpeta')
        b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>'
        b.append(el('span', 'carpetaNombre', tInicio('carpeta.' + n)), el('span', 'carpetaRuta', n))
        b.addEventListener('click', () => abrirCarpeta(pathInicio.join(base, n)))
        contenedor.append(b)
    }
}

/* ---------- Servidores: datos ---------- */

function loaderDeServidor(serv){
    const extra = extrasServidores[serv.rawServer.id]
    if(extra?.loader){
        return extra.loader
    }
    const tipos = serv.modules.map(m => m.rawModule.type)
    if(tipos.includes('ForgeHosted') || tipos.includes('Forge')){
        return 'forge'
    }
    if(tipos.includes('Fabric')){
        return 'fabric'
    }
    return 'vanilla'
}

/**
 * Paneles de la vista del servidor (servidores-extra.json → paneles).
 * Mientras servidores-extra.json no traiga paneles para Tierras Malditas, se
 * usa su bloque de siempre para que no se pierda.
 */
function panelesDe(id){
    const paneles = extrasServidores[id]?.paneles
    if(Array.isArray(paneles)){
        return paneles.filter(p => p && typeof p.tipo === 'string')
    }
    if(typeof id === 'string' && id.startsWith('TierrasMalditas')){
        return [{ tipo: 'estado' }, { tipo: 'tierras' }]
    }
    return [{ tipo: 'estado' }, { tipo: 'jugadores' }, { tipo: 'noticias' }]
}

function tieneTierras(id){
    return panelesDe(id).some(p => p.tipo === 'tierras')
}

/**
 * El banner sale de servidores-extra.json; sin banner, la tarjeta genérica.
 * (Un servidor con el panel "tierras" y sin banner usa el arte oscuro local.)
 */
const bannersElegidos = {}

/**
 * background-image del servidor: el banner (desde la caché si ya se bajó) y,
 * debajo, el arte local por si no carga (sin conexión y sin caché).
 */
function fondoServidor(id){
    const respaldo = tieneTierras(id) ? 'assets/images/backgrounds/0.jpg' : `${IMG}/tarjeta-generica.jpg`
    return `url('${Servidor.imagen(arteServidor(id))}'), url('${respaldo}')`
}

function arteServidor(id){
    const extra = extrasServidores[id]
    // Con varios banners, uno al azar que se mantiene toda la sesión.
    const lista = Array.isArray(extra?.banners) ? extra.banners.filter(b => typeof b === 'string' && b) : []
    if(lista.length > 0){
        if(!lista.includes(bannersElegidos[id])){
            bannersElegidos[id] = lista[Math.floor(Math.random() * lista.length)]
        }
        return bannersElegidos[id]
    }
    if(extra?.banner){
        return extra.banner
    }
    // Sin conexión (o sin banner), el panel "tierras" usa el arte oscuro que viene en el launcher.
    if(tieneTierras(id)){
        return 'assets/images/backgrounds/0.jpg'
    }
    return `${IMG}/tarjeta-generica.jpg`
}

/**
 * Estado que se muestra de un servidor: el de servidores-extra.json manda;
 * si está "abierto" se le pregunta al servidor si está en línea.
 */
function estadoServidor(id){
    const extra = extrasServidores[id]?.estado ?? 'abierto'
    const ping = estadosServidores[id]
    // mc.potatox.me no respondió: el servidor del admin está apagado o sin conexión.
    if(Servidor.estado.alcanzable === false && !ping?.online && extra !== 'cerrado'){
        return { clave: 'sinConexion', texto: tInicio('estado.sinConexion') }
    }
    if(extra !== 'abierto'){
        return { clave: extra, texto: tInicio('estado.' + extra) }
    }
    if(ping == null){
        return { clave: 'cargando', texto: tInicio('estado.cargando') }
    }
    if(ping.online){
        return { clave: 'enLinea', texto: tInicio('estado.enLinea', { jugadores: ping.onlinePlayers, max: ping.maxPlayers }) }
    }
    return { clave: 'apagado', texto: tInicio('estado.apagado') }
}

function chipEstado(id){
    const e = estadoServidor(id)
    const c = el('span', 'chipEstado')
    c.setAttribute('estado', e.clave)
    c.append(el('span', 'punto'), document.createTextNode(e.texto))
    return c
}

async function pingServidor(s){
    try {
        return await getStatusModerno(s.hostname, s.port)
    } catch(_err) {
        try {
            return { ...await pingLegacy(s.hostname, s.port), jugadores: [] }
        } catch(_err2) {
            return { online: false, jugadores: [] }
        }
    }
}

/* ---------- Navegación ---------- */

function irA(seccion){
    if(seccion !== seccionActual && ['inicio', 'servidores', 'instancias'].includes(seccionActual)){
        seccionAnterior = seccionActual
    }
    seccionActual = seccion
    for(const s of document.querySelectorAll('#contenido > .seccion')){
        s.hidden = s.dataset.seccion !== seccion
    }
    for(const b of document.querySelectorAll('#barraLateral [data-seccion]')){
        const activo = b.dataset.seccion === seccion
            || (seccion === 'servidor' && b.dataset.seccion === 'servidores')
            || (seccion === 'instancia' && b.dataset.seccion === 'instancias')
        if(activo){
            b.setAttribute('aria-current', 'page')
        } else {
            b.removeAttribute('aria-current')
        }
    }
    document.getElementById('contenido').scrollTop = 0
    const tierras = seccion === 'servidor' && tieneTierras(ConfigManager.getSelectedServer())
    document.body.toggleAttribute('vistaTierras', tierras)
    if(typeof window.ambienteActivo === 'function'){
        window.ambienteActivo(tierras)
    }
    if(seccion === 'perfil'){
        refrescarPerfil()
    } else if(perfilVisor != null){
        perfilVisor.renderPaused = true
    }
}

for(const b of document.querySelectorAll('#barraLateral [data-seccion]')){
    b.addEventListener('click', () => irA(b.dataset.seccion))
}
for(const b of document.querySelectorAll('[data-volver]')){
    b.addEventListener('click', () => irA(seccionAnterior))
}
for(const b of document.querySelectorAll('[data-accion="crear"]')){
    b.addEventListener('click', () => abrirCrear())
}

// Soltar un archivo fuera de la zona de mods no debe navegar a él.
document.addEventListener('dragover', e => e.preventDefault())
document.addEventListener('drop', e => e.preventDefault())

/* ---------- Saludo y continuar ---------- */

function pintarSaludo(){
    const acc = ConfigManager.getSelectedAccount()
    document.getElementById('saludoTitulo').textContent = acc?.displayName
        ? tInicio('saludo', { nombre: acc.displayName })
        : tInicio('saludoSinNombre')
}

function objetivoContinuar(){
    const sel = ConfigManager.getUltimaSeleccion()
    if(sel?.tipo === 'instancia' && Instancias.obtener(sel.id) != null){
        return sel
    }
    if(sel?.tipo === 'servidor' && distroInicio?.getServerById(sel.id) != null){
        return sel
    }
    // Primera vez: el servidor principal.
    const principal = distroInicio?.getMainServer()
    return principal ? { tipo: 'servidor', id: principal.rawServer.id } : null
}

function pintarContinuar(){
    const banner = document.getElementById('continuar')
    const obj = objetivoContinuar()
    if(obj == null){
        banner.style.display = 'none'
        return
    }
    banner.style.display = ''
    const arte = banner.querySelector('.bannerArte')
    const chips = banner.querySelector('.bannerChips')
    const nombre = banner.querySelector('.bannerNombre')
    const ver = banner.querySelector('[data-accion="ver"]')
    chips.replaceChildren()

    if(obj.tipo === 'servidor'){
        const serv = distroInicio.getServerById(obj.id)
        nombre.textContent = serv.rawServer.name
        arte.style.backgroundImage = fondoServidor(obj.id)
        banner.toggleAttribute('tierras', tieneTierras(obj.id))
        banner.style.setProperty('--acento', extrasServidores[obj.id]?.colorAcento ?? 'transparent')
        chips.append(chipLoader(loaderDeServidor(serv), serv.rawServer.minecraftVersion), chipEstado(obj.id))
        ver.textContent = tInicio('verServidor')
        ver.onclick = () => abrirServidor(obj.id)
        banner.querySelector('[data-accion="jugar"]').onclick = () => {
            seleccionarServidor(obj.id)
            lanzarServidor()
        }
    } else {
        const inst = Instancias.obtener(obj.id)
        nombre.textContent = inst.nombre
        arte.style.backgroundImage = `url('${IMG}/fondo-carga.jpg')`
        banner.removeAttribute('tierras')
        banner.style.setProperty('--acento', 'transparent')
        chips.append(chipLoader(inst.loader, inst.mc))
        ver.textContent = tInicio('verInstancia')
        ver.onclick = () => abrirInstancia(obj.id)
        banner.querySelector('[data-accion="jugar"]').onclick = () => lanzarInstancia(obj.id)
    }
}

/* ---------- Noticias ---------- */

function fechaCorta(iso){
    const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
    return isNaN(d) ? iso : d.toLocaleDateString(Lang.idiomaElegido() === 'en_US' ? 'en' : 'es', { day: 'numeric', month: 'short', year: 'numeric' })
}

function tarjetaNoticia(n){
    const tarjeta = el(n.link ? 'a' : 'article', 'tarjetaNoticia')
    if(n.link){
        tarjeta.href = n.link
    }
    const img = el('img', 'noticiaImagen')
    img.alt = ''
    img.src = n.imagen ? Servidor.imagen(n.imagen) : `${IMG}/noticia-default.jpg`
    img.onerror = () => {
        img.onerror = null
        img.src = `${IMG}/noticia-default.jpg`
    }
    const textos = el('div', 'noticiaTextos')
    if(n.etiqueta){
        textos.append(el('span', 'noticiaEtiqueta', n.etiqueta))
    }
    textos.append(el('span', 'noticiaTitulo', n.titulo ?? ''))
    const meta = [n.fecha ? fechaCorta(n.fecha) : null, n.resumen].filter(Boolean).join(' · ')
    textos.append(el('span', 'noticiaResumen', meta))
    tarjeta.append(img, textos)
    return tarjeta
}

async function cargarNoticias(){
    const bloque = document.getElementById('bloqueNoticias')
    const lista = document.getElementById('listaNoticias')
    // Sin servidor se muestran las últimas que se bajaron.
    const { datos } = await Servidor.leerJson('noticias.json')
    noticiasCache = Array.isArray(datos?.noticias) ? datos.noticias : []
    lista.replaceChildren(...noticiasCache.slice(0, 6).map(tarjetaNoticia))
    bloque.style.display = noticiasCache.length > 0 ? '' : 'none'
    if(seccionActual === 'servidor'){
        pintarPaneles()
    }
}

/* ---------- Servidores: tarjetas ---------- */

function seleccionarServidor(id){
    if(ConfigManager.getSelectedServer() !== id){
        updateSelectedServer(distroInicio.getServerById(id))
    }
}

function tarjetaServidor(serv){
    const id = serv.rawServer.id
    const t = el('button', 'tarjetaServidor')
    t.style.setProperty('--acento', extrasServidores[id]?.colorAcento ?? '#6CC04A')
    if(ConfigManager.getUltimaSeleccion()?.id === id){
        t.setAttribute('ultima', '')
    }
    const arte = el('div', 'tarjetaArte')
    arte.style.backgroundImage = fondoServidor(id)
    if(serv.rawServer.icon){
        const icono = el('img', 'tarjetaIcono')
        icono.src = Servidor.imagen(serv.rawServer.icon)
        icono.alt = ''
        icono.onerror = () => icono.remove()
        arte.append(icono)
    }
    const cuerpo = el('div', 'tarjetaCuerpo')
    cuerpo.append(el('span', 'tarjetaNombre', serv.rawServer.name))
    const fila = el('div', 'tarjetaFila')
    fila.append(chipLoader(loaderDeServidor(serv), serv.rawServer.minecraftVersion), chipEstado(id))
    cuerpo.append(fila)
    t.append(arte, cuerpo)
    t.addEventListener('click', () => abrirServidor(id))
    return t
}

function pintarServidores(){
    const servidores = distroInicio?.servers ?? []
    for(const contenedor of [document.getElementById('inicioServidores'), document.getElementById('listaServidores')]){
        contenedor.replaceChildren()
        if(servidores.length === 0){
            contenedor.append(vacio(tInicio(Servidor.estado.alcanzable === false ? 'sinServidoresConexion' : 'sinServidores')))
        }
        for(const s of servidores){
            contenedor.append(tarjetaServidor(s))
        }
    }
}

async function pingTodos(){
    const servidores = distroInicio?.servers ?? []
    await Promise.all(servidores.map(async s => {
        estadosServidores[s.rawServer.id] = await pingServidor(s)
    }))
    pintarServidores()
    pintarContinuar()
    if(seccionActual === 'servidor'){
        pintarVistaServidor()
    }
}

/* ---------- Vista de servidor y sus paneles ---------- */

function abrirServidor(id){
    seleccionarServidor(id)
    elegirPestana('servidor', 'resumen')
    pintarVistaServidor()
    irA('servidor')
}

function panelBase(titulo, clase){
    const p = el('section', 'panelServidor' + (clase ? ' ' + clase : ''))
    if(titulo){
        p.append(el('h3', null, titulo))
    }
    return p
}

function filaDato(etiqueta, valor){
    const f = el('div', 'filaDato')
    f.append(el('span', 'datoEtiqueta', etiqueta), el('span', 'datoValor', valor))
    return f
}

/**
 * Tipos de panel que entiende el launcher. Un tipo desconocido se ignora,
 * así el servidor puede agregar tipos nuevos sin romper launchers viejos.
 */
const PANELES = {
    estado(p, serv){
        const id = serv.rawServer.id
        const ping = estadosServidores[id]
        const panel = panelBase(p.titulo ?? tInicio('panel.estado'))
        panel.append(chipEstado(id))
        if(ping?.online){
            panel.append(filaDato(tInicio('panel.jugadores'), `${ping.onlinePlayers}/${ping.maxPlayers}`))
            if(ping.version){
                panel.append(filaDato(tInicio('panel.version'), ping.version))
            }
        }
        panel.append(filaDato(tInicio('panel.direccion'), serv.rawServer.address))
        if(ping?.motd){
            panel.append(el('p', 'panelMotd', ping.motd))
        }
        return panel
    },
    jugadores(p, serv){
        const ping = estadosServidores[serv.rawServer.id]
        const panel = panelBase(p.titulo ?? tInicio('panel.conectados'))
        const lista = ping?.jugadores ?? []
        if(lista.length > 0){
            const caras = el('div', 'listaCaras')
            for(const j of lista){
                const c = el('span', 'cara')
                const img = el('img')
                img.src = `https://mc-heads.net/avatar/${encodeURIComponent(j.id || j.name)}/32`
                img.alt = ''
                c.append(img, el('span', null, j.name))
                caras.append(c)
            }
            panel.append(caras)
        } else {
            // El mismo aviso en todos los servidores: apagado, cerrado o sin gente.
            const hayGente = ping?.online && Number(ping.onlinePlayers) > 0
            const aviso = el('div', 'avisoJugadores')
            aviso.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>'
            aviso.append(el('span', null, hayGente ? tInicio('panel.listaOculta', { n: ping.onlinePlayers }) : tInicio('panel.nadie')))
            panel.append(aviso)
        }
        return panel
    },
    noticias(p, serv){
        const panel = panelBase(p.titulo ?? tInicio('noticias'), 'anchoCompleto')
        const lista = el('div', 'grillaNoticias')
        panel.append(lista)
        const pintar = noticias => {
            const max = Number.isInteger(p.max) ? p.max : 4
            lista.replaceChildren(...noticias.slice(0, max).map(tarjetaNoticia))
            panel.hidden = noticias.length === 0
        }
        if(p.url){
            panel.hidden = true
            pedirJson(p.url)
                .then(d => pintar(Array.isArray(d.noticias) ? d.noticias : []))
                .catch(err => loggerInicio.warn('Panel de noticias:', err.message))
        } else {
            // Las generales (sin "servidor") y las de este servidor.
            pintar(noticiasCache.filter(n => !n.servidor || n.servidor === serv.rawServer.id))
        }
        return panel
    },
    link(p){
        if(!p.url){
            return null
        }
        const panel = panelBase(p.titulo ?? '')
        if(p.texto){
            panel.append(el('p', 'textoSuave', p.texto))
        }
        const a = el('a', 'botonSecundario', p.boton ?? tInicio('panel.abrir'))
        a.href = p.url
        panel.append(a)
        return panel
    },
    texto(p){
        if(!p.texto){
            return null
        }
        const panel = panelBase(p.titulo ?? '', p.ancho === 'completo' ? 'anchoCompleto' : '')
        panel.append(el('p', 'panelTexto', p.texto))
        return panel
    },
    tierras(p){
        // El reino vivo: Prueba, Aldric, gemas, Luna de Sangre y cabezas van en el
        // héroe (reino.js); acá quedan las Crónicas.
        window.urlReino = p.url || null
        const panel = panelBase(null, 'anchoCompleto panelTierras')
        panel.append(document.getElementById('cronicasPanel'))
        return panel
    }
}

function pintarPaneles(){
    const id = ConfigManager.getSelectedServer()
    const serv = distroInicio?.getServerById(id)
    if(serv == null){
        return
    }
    const cont = document.getElementById('panelesServidor')
    // Las Crónicas vuelven a su lugar antes de rehacer los paneles.
    cont.after(document.getElementById('cronicasPanel'))
    cont.replaceChildren()
    for(const p of panelesDe(id)){
        const fn = PANELES[p.tipo]
        if(fn == null){
            loggerInicio.debug('Tipo de panel desconocido:', p.tipo)
            continue
        }
        try {
            const panel = fn(p, serv)
            if(panel != null){
                cont.append(panel)
            }
        } catch(err) {
            loggerInicio.warn('No se pudo armar el panel', p.tipo, err)
        }
    }
}

function pintarModsServidor(serv){
    const cont = document.getElementById('servidorMods')
    cont.replaceChildren()
    const tipos = ['ForgeMod', 'FabricMod', 'LiteMod']
    const mods = serv.modules.filter(m => tipos.includes(m.rawModule.type))
    if(mods.length === 0){
        cont.append(vacio(tInicio('modsServidorVacio')))
        return
    }
    mods.sort((a, b) => (a.rawModule.name ?? '').localeCompare(b.rawModule.name ?? '', 'es', { sensitivity: 'base' }))
    for(const m of mods){
        const fila = el('div', 'filaMod')
        const textos = el('div', 'modTextos')
        textos.append(el('span', 'modNombre', m.rawModule.name ?? m.rawModule.id))
        const version = m.hasMavenComponents() ? m.getMavenComponents().version : ''
        textos.append(el('span', 'modVersion', [version, m.getRequired().value ? null : tInicio('modOpcional')].filter(Boolean).join(' · ')))
        fila.append(textos)
        cont.append(fila)
    }
}

function pintarVistaServidor(){
    const id = ConfigManager.getSelectedServer()
    const serv = distroInicio?.getServerById(id)
    if(serv == null){
        return
    }
    const seccion = document.getElementById('seccionServidor')
    const tierras = tieneTierras(id)
    seccion.toggleAttribute('tierras', tierras)
    seccion.style.setProperty('--acento', extrasServidores[id]?.colorAcento ?? '#6CC04A')
    document.getElementById('fondoReino').style.backgroundImage = fondoServidor(id)
    const icono = document.getElementById('servidorIcono')
    icono.hidden = !serv.rawServer.icon
    if(serv.rawServer.icon){
        icono.onerror = () => {
            icono.hidden = true
        }
        icono.src = Servidor.imagen(serv.rawServer.icon)
    }
    document.getElementById('servidorNombre').textContent = serv.rawServer.name
    document.getElementById('servidorChips').replaceChildren(chipLoader(loaderDeServidor(serv), serv.rawServer.minecraftVersion), chipEstado(id))
    document.getElementById('servidorDescripcion').textContent = serv.rawServer.description ?? ''
    pintarPaneles()
    pintarModsServidor(serv)
    // Sin loader (Vanilla) no hay dónde cargar mods extra.
    const conLoader = loaderDeServidor(serv) !== 'vanilla'
    document.getElementById('bloqueModsExtra').hidden = !conLoader
    if(conLoader && !document.querySelector('.pestana[data-grupo="servidor"][data-pestana="mods"]').hidden){
        modsExtraServidor.cargar()
    }
    pintarCarpetas(document.getElementById('servidorCarpetas'), pathInicio.join(ConfigManager.getInstanceDirectory(), id),
        conLoader
            ? ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots']
            : ['config', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots'])
    document.body.toggleAttribute('vistaTierras', seccionActual === 'servidor' && tierras)
    if(seccionActual === 'servidor' && typeof window.ambienteActivo === 'function'){
        window.ambienteActivo(tierras)
    }
}

/* ---------- Instancias propias: tarjetas ---------- */

function pintarIconoInstancia(contenedor, inst){
    const ruta = Instancias.rutaIcono(inst)
    if(ruta){
        const img = el('img')
        img.alt = ''
        img.src = pathToFileURL(ruta).href + '?v=' + Date.now()
        img.onerror = () => {
            contenedor.innerHTML = ICONOS_LOADER[inst.loader] ?? ICONOS_LOADER.vanilla
        }
        contenedor.replaceChildren(img)
    } else {
        contenedor.innerHTML = ICONOS_LOADER[inst.loader] ?? ICONOS_LOADER.vanilla
    }
}

function tarjetaInstancia(inst){
    const t = el('button', 'tarjetaInstancia')
    const icono = el('span', 'iconoLoader')
    pintarIconoInstancia(icono, inst)
    const textos = el('span', 'instTextos')
    textos.append(el('span', 'instNombre', inst.nombre), el('span', 'instVersion', `${nombreLoader(inst.loader)} ${inst.mc}`))
    t.append(icono, textos)
    t.addEventListener('click', () => abrirInstancia(inst.id))
    return t
}

function tarjetaNueva(){
    const t = el('button', 'tarjetaNueva')
    t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    t.append(document.createTextNode(tInicio('nuevaInstancia')))
    t.addEventListener('click', () => abrirCrear())
    return t
}

function pintarInstancias(){
    const lista = Instancias.listar().sort((a, b) => (b.ultimaVez ?? b.creada).localeCompare(a.ultimaVez ?? a.creada))
    const enInicio = document.getElementById('inicioInstancias')
    const todas = document.getElementById('listaInstancias')
    enInicio.replaceChildren()
    todas.replaceChildren()
    if(lista.length === 0){
        todas.append(vacio(tInicio('sinInstancias')))
    }
    for(const inst of lista.slice(0, 5)){
        enInicio.append(tarjetaInstancia(inst))
    }
    enInicio.append(tarjetaNueva())
    for(const inst of lista){
        todas.append(tarjetaInstancia(inst))
    }
    if(lista.length > 0){
        todas.append(tarjetaNueva())
    }
}

/* ---------- Selector de loader y versiones (crear y editar) ---------- */

/**
 * Arma el selector de loader, versión de Minecraft y versión del loader.
 * Lo usan el diálogo de crear y la pestaña General de cada instancia.
 */
function selectorVersiones({ loaders, version, loaderVersion, campoLoaderVersion, snapshots, error }){
    let loader = 'vanilla'
    let pedido = 0
    let pedidoLoader = 0
    let preferidas = {}

    function llenar(select, opciones, textoVacio, preferida){
        // Si la lista es la misma no se toca: rehacerla cierra el desplegable si está abierto.
        const firma = JSON.stringify([opciones.map(o => o.id), textoVacio, preferida ?? null])
        if(select.dataset.firma === firma){
            return
        }
        select.dataset.firma = firma
        select.replaceChildren()
        if(opciones.length === 0){
            const o = el('option', null, textoVacio)
            o.value = ''
            select.append(o)
            select.disabled = true
            return
        }
        select.disabled = false
        // La versión actual siempre aparece, aunque sea snapshot o ya no se liste.
        if(preferida && !opciones.some(o => o.id === preferida)){
            opciones = [{ id: preferida }, ...opciones]
        }
        for(const op of opciones){
            const etiqueta = op.etiqueta ? tInicio('etiquetaVersion.' + op.etiqueta) : (op.estable === false ? tInicio('inestable') : null)
            const o = el('option', null, etiqueta ? `${op.id} (${etiqueta})` : op.id)
            o.value = op.id
            select.append(o)
        }
        if(preferida){
            select.value = preferida
        }
    }

    function pintarLoaders(){
        loaders.replaceChildren()
        for(const l of Object.values(Instancias.LOADERS)){
            const op = el('label', 'opcionLoader')
            const radio = el('input')
            radio.type = 'radio'
            radio.name = loaders.id
            radio.value = l.id
            radio.disabled = !l.disponible
            radio.checked = l.id === loader
            op.toggleAttribute('elegido', radio.checked)
            op.toggleAttribute('deshabilitado', !l.disponible)
            radio.addEventListener('change', () => {
                loader = l.id
                for(const o of loaders.children){
                    o.toggleAttribute('elegido', o.querySelector('input').value === l.id)
                }
                cargar()
            })
            const icono = el('span', 'iconoLoader')
            icono.innerHTML = ICONOS_LOADER[l.id]
            op.append(radio, icono, el('span', 'opcionNombre', l.nombre))
            if(!l.disponible){
                op.append(el('span', 'chipPronto', tInicio('pronto')))
            }
            loaders.append(op)
        }
    }

    async function cargarLoader(){
        const def = Instancias.LOADERS[loader]
        if(!def.conVersion || !version.value){
            return
        }
        // Cada pedido tiene su número: una respuesta vieja (de otra versión de
        // Minecraft) no pisa la lista de la versión elegida ahora.
        const p = ++pedidoLoader
        const mc = version.value
        llenar(loaderVersion, [], tInicio('cargandoVersiones'))
        try {
            const lista = await def.versionesLoader(mc)
            if(p !== pedidoLoader || mc !== version.value){
                return
            }
            // Las listas vienen de la más nueva a la más vieja. Por defecto, la que marca
            // el loader (la recomendada en Forge) o la estable más nueva.
            const porDefecto = lista.find(o => o.predeterminada)?.id ?? lista.find(o => o.estable !== false)?.id
            llenar(loaderVersion, lista, tInicio('sinVersiones'), preferidas.loaderVersion ?? porDefecto)
        } catch(err) {
            if(p === pedidoLoader){
                llenar(loaderVersion, [], tInicio('sinVersiones'))
                error.textContent = tInicio('errorVersiones')
                error.hidden = false
            }
            throw err
        }
    }

    async function cargar(){
        const p = ++pedido
        const def = Instancias.LOADERS[loader]
        error.hidden = true
        llenar(version, [], tInicio('cargandoVersiones'))
        campoLoaderVersion.hidden = !def.conVersion
        try {
            const lista = await def.versionesMinecraft(snapshots.checked)
            if(p !== pedido){
                return
            }
            llenar(version, lista, tInicio('sinVersiones'), preferidas.mc)
            // Si fallan los loaders, las versiones de Minecraft quedan igual.
            await cargarLoader().catch(err => loggerInicio.warn('No se pudieron cargar los loaders.', err.message))
        } catch(err) {
            loggerInicio.warn('No se pudieron cargar las versiones.', err.message)
            if(p === pedido){
                llenar(version, [], tInicio('sinVersiones'))
                error.textContent = tInicio('errorVersiones')
                error.hidden = false
            }
        }
    }

    version.addEventListener('change', () => {
        preferidas.loaderVersion = null
        cargarLoader().catch(err => loggerInicio.warn(err.message))
    })
    snapshots.addEventListener('change', () => cargar())

    return {
        reiniciar(nuevo = 'vanilla', mc = null, lv = null){
            loader = nuevo
            preferidas = { mc, loaderVersion: lv }
            snapshots.checked = false
            pintarLoaders()
            cargar()
        },
        valor(){
            const def = Instancias.LOADERS[loader]
            return {
                loader,
                mc: version.value,
                loaderVersion: def.conVersion ? loaderVersion.value : null,
                completo: !!version.value && (!def.conVersion || !!loaderVersion.value)
            }
        }
    }
}

/* ---------- Vista de instancia ---------- */

const GB = 1024 * 1024 * 1024
const JVM_DEFECTO = [
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:MaxGCPauseMillis=50',
    '-XX:G1HeapRegionSize=32M'
]

function ramAGb(valor){
    if(valor == null){
        return 4
    }
    const n = parseFloat(valor)
    return /m$/i.test(valor) ? n / 1024 : n
}

function gbATexto(gb){
    return gb % 1 === 0 ? `${gb}G` : `${Math.round(gb * 1024)}M`
}

const seccionInstancia = document.getElementById('seccionInstancia')
const editor = selectorVersiones({
    loaders: document.getElementById('editLoaders'),
    version: document.getElementById('editVersion'),
    loaderVersion: document.getElementById('editLoaderVersion'),
    campoLoaderVersion: document.getElementById('editLoaderVersionCampo'),
    snapshots: document.getElementById('editSnapshots'),
    error: document.getElementById('editError')
})

function pintarCabezaInstancia(inst){
    pintarIconoInstancia(document.getElementById('instanciaIcono'), inst)
    pintarIconoInstancia(document.getElementById('editIconoVista'), inst)
    document.getElementById('instanciaNombre').textContent = inst.nombre
    const extra = inst.loaderVersion ? ` · ${tInicio('loaderVersion', { version: inst.loaderVersion })}` : ''
    document.getElementById('instanciaVersion').textContent = `${nombreLoader(inst.loader)} ${inst.mc}${extra}`
}

function abrirInstancia(id, pestana = 'general'){
    const inst = Instancias.obtener(id)
    if(inst == null){
        return
    }
    instanciaAbierta = id
    pintarCabezaInstancia(inst)

    // General
    document.getElementById('editNombre').value = inst.nombre
    document.getElementById('editGuardado').hidden = true
    editor.reiniciar(inst.loader, inst.mc, inst.loaderVersion)

    // Mods solo con loader.
    const conMods = inst.loader !== 'vanilla'
    document.getElementById('pestanaModsInstancia').hidden = !conMods
    if(pestana === 'mods' && !conMods){
        pestana = 'general'
    }

    // Carpetas
    const carpetas = conMods
        ? ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots', 'logs', 'config']
        : ['saves', 'resourcepacks', 'shaderpacks', 'screenshots', 'logs']
    pintarCarpetas(document.getElementById('instanciaCarpetas'), Instancias.carpeta(id), carpetas)

    // Rendimiento: RAM, Java y argumentos propios (se guardan con el id de la instancia).
    ConfigManager.ensureJavaConfig(id, { suggestedMajor: 17 }, ConfigManager.getRamPorDefecto() != null ? { recommended: ConfigManager.getRamPorDefecto() } : null)
    const total = require('os').totalmem() / GB
    const rango = document.getElementById('instanciaRam')
    rango.max = Math.max(2, Math.floor(total - 1))
    rango.value = ramAGb(ConfigManager.getMaxRAM(id))
    document.getElementById('instanciaRamValor').textContent = `${rango.value} GB`
    document.getElementById('instanciaRamTotal').textContent = tInicio('instMemoriaTotal', { total: total.toFixed(1) })
    document.getElementById('instanciaJava').textContent = ConfigManager.getJavaExecutable(id) ?? tInicio('instJavaNinguno')
    document.getElementById('instanciaJvm').value = ConfigManager.getJVMOptions(id).join(' ')
    document.getElementById('jvmGuardado').hidden = true

    elegirPestana('instancia', pestana)
    if(pestana === 'mods'){
        cargarModsInstancia()
    }
    irA('instancia')
}

seccionInstancia.querySelector('[data-accion="jugar"]').addEventListener('click', () => lanzarInstancia(instanciaAbierta))

// General: nombre, ícono, loader y versión.
document.getElementById('formEditar').addEventListener('submit', e => {
    e.preventDefault()
    const inst = Instancias.obtener(instanciaAbierta)
    const nombre = document.getElementById('editNombre').value.trim()
    const v = editor.valor()
    const error = document.getElementById('editError')
    if(!nombre || !v.completo){
        error.textContent = tInicio('errorIncompleto')
        error.hidden = false
        return
    }
    const guardar = () => {
        Instancias.actualizar(inst.id, { nombre, mc: v.mc, loader: v.loader, loaderVersion: v.loaderVersion })
        const nueva = Instancias.obtener(inst.id)
        pintarCabezaInstancia(nueva)
        document.getElementById('pestanaModsInstancia').hidden = nueva.loader === 'vanilla'
        document.getElementById('editGuardado').hidden = false
        pintarInstancias()
        pintarContinuar()
    }
    const cambiaVersion = v.mc !== inst.mc || v.loader !== inst.loader || v.loaderVersion !== inst.loaderVersion
    if(cambiaVersion){
        confirmar(tInicio('cambiarVersionTitulo'), tInicio('cambiarVersionTexto'), tInicio('cambiarVersionSi'), async () => {
            try {
                await Instancias.validarLoader(v)
            } catch(err) {
                error.textContent = err.displayable ?? err.message
                error.hidden = false
                return
            }
            guardar()
        })
    } else {
        guardar()
    }
})
document.getElementById('editNombre').addEventListener('input', () => {
    document.getElementById('editGuardado').hidden = true
})
seccionInstancia.querySelector('[data-accion="iconoElegir"]').addEventListener('click', async () => {
    const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: tInicio('editIconoElegir'),
        properties: ['openFile'],
        filters: [{ name: tInicio('imagenes'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if(!res.canceled && res.filePaths.length > 0){
        await Instancias.ponerIcono(instanciaAbierta, res.filePaths[0])
        pintarCabezaInstancia(Instancias.obtener(instanciaAbierta))
        pintarInstancias()
    }
})
seccionInstancia.querySelector('[data-accion="iconoQuitar"]').addEventListener('click', async () => {
    await Instancias.ponerIcono(instanciaAbierta, null)
    pintarCabezaInstancia(Instancias.obtener(instanciaAbierta))
    pintarInstancias()
})

// Mods editables: los de una instancia propia y los "extra" que el jugador agrega a un servidor.

/**
 * Lista de .jar de una carpeta mods que se pueden activar, desactivar, borrar y
 * agregar (botón o arrastrando). Con `excluir`, se ocultan los archivos que maneja
 * la distribution (en los servidores).
 *
 * @param {{zona: HTMLElement, lista: HTMLElement, resumen: HTMLElement, soltar: HTMLElement,
 *   botonCarpeta: HTMLElement, botonAgregar: HTMLElement, carpeta: () => string,
 *   excluir?: () => Set<string>, textoVacio: string}} o
 */
function listaModsEditable(o){
    let carga = 0

    async function cargar(){
        const n = ++carga
        o.resumen.textContent = tInicio('cargando')
        const excluir = o.excluir ? o.excluir() : new Set()
        const mods = (await ModsJar.listar(o.carpeta()))
            .filter(m => !excluir.has(pathInicio.normalize(m.ruta).replace(/\.disabled$/i, '').toLowerCase()))
        if(n !== carga){
            return
        }
        o.lista.replaceChildren()
        const activos = mods.filter(m => m.activo).length
        o.resumen.textContent = mods.length > 0 ? tInicio('modsResumen', { activos, total: mods.length }) : ''
        if(mods.length === 0){
            o.lista.append(vacio(o.textoVacio))
            return
        }
        for(const m of mods){
            o.lista.append(filaModEditable(m))
        }
    }

    function filaModEditable(m){
        const fila = el('div', 'filaMod')
        fila.toggleAttribute('apagado', !m.activo)
        const interruptor = el('label', 'interruptor')
        interruptor.title = m.activo ? tInicio('modDesactivar') : tInicio('modActivar')
        const chk = el('input')
        chk.type = 'checkbox'
        chk.checked = m.activo
        chk.setAttribute('aria-label', `${m.nombre}: ${interruptor.title}`)
        chk.addEventListener('change', async () => {
            try {
                await ModsJar.alternar(m.ruta, chk.checked)
            } catch(err) {
                loggerInicio.error('No se pudo cambiar el mod.', err)
                mostrarError(tInicio('modErrorTitulo'), tInicio('modErrorTexto'))
            }
            cargar()
        })
        interruptor.append(chk, el('span', 'interruptorRiel'))
        const textos = el('div', 'modTextos')
        textos.append(el('span', 'modNombre', m.nombre))
        textos.append(el('span', 'modVersion', [m.version, m.archivo].filter(Boolean).join(' · ')))
        const borrar = el('button', 'botonIcono')
        borrar.innerHTML = ICONO_PAPELERA
        borrar.title = tInicio('modBorrar')
        borrar.setAttribute('aria-label', `${tInicio('modBorrar')}: ${m.nombre}`)
        borrar.addEventListener('click', () => {
            confirmar(tInicio('modBorrarTitulo', { nombre: m.nombre }), tInicio('modBorrarTexto'), tInicio('borrarSi'), async () => {
                if(!await aLaPapelera(m.ruta)){
                    mostrarError(tInicio('modErrorTitulo'), tInicio('modErrorTexto'))
                }
                cargar()
            })
        })
        fila.append(interruptor, textos, borrar)
        return fila
    }

    async function agregar(rutas){
        const jars = rutas.filter(r => /\.jar$/i.test(r))
        if(jars.length === 0){
            return
        }
        try {
            await ModsJar.agregar(o.carpeta(), jars)
        } catch(err) {
            loggerInicio.error('No se pudieron agregar los mods.', err)
            mostrarError(tInicio('modErrorTitulo'), tInicio('modErrorTexto'))
        }
        cargar()
    }

    o.botonCarpeta.addEventListener('click', () => abrirCarpeta(o.carpeta()))
    o.botonAgregar.addEventListener('click', async () => {
        const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            title: tInicio('modsAgregar'),
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Mods', extensions: ['jar'] }]
        })
        if(!res.canceled){
            agregar(res.filePaths)
        }
    })

    let arrastres = 0
    o.zona.addEventListener('dragenter', e => {
        e.preventDefault()
        arrastres++
        o.soltar.setAttribute('activa', '')
    })
    o.zona.addEventListener('dragleave', () => {
        if(--arrastres <= 0){
            arrastres = 0
            o.soltar.removeAttribute('activa')
        }
    })
    o.zona.addEventListener('drop', e => {
        e.preventDefault()
        arrastres = 0
        o.soltar.removeAttribute('activa')
        const { webUtils } = require('electron')
        agregar([...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)).filter(Boolean))
    })

    return { cargar, agregar }
}

const modsInstancia = listaModsEditable({
    zona: seccionInstancia.querySelector('.pestana[data-pestana="mods"]'),
    lista: document.getElementById('instanciaMods'),
    resumen: document.getElementById('modsResumen'),
    soltar: document.getElementById('zonaSoltar'),
    botonCarpeta: seccionInstancia.querySelector('[data-accion="modsCarpeta"]'),
    botonAgregar: seccionInstancia.querySelector('[data-accion="modsAgregar"]'),
    carpeta: () => pathInicio.join(Instancias.carpeta(instanciaAbierta), 'mods'),
    textoVacio: tInicio('modsVacio')
})
const cargarModsInstancia = () => modsInstancia.cargar()
const agregarMods = rutas => modsInstancia.agregar(rutas)

/**
 * Archivos que trae la distribution del servidor (recursivo, en minúsculas): los
 * mods extra del jugador son los .jar de su carpeta mods que no están acá.
 */
function archivosDeLaDistribution(serv){
    const rutas = new Set()
    const recorrer = mods => {
        for(const m of mods){
            try {
                rutas.add(pathInicio.normalize(m.getPath()).toLowerCase())
            } catch(_err) {
                // Módulo sin ruta (no pasa con mods): se ignora.
            }
            recorrer(m.subModules)
        }
    }
    recorrer(serv.modules)
    return rutas
}

const seccionServidorMods = document.querySelector('.pestana[data-grupo="servidor"][data-pestana="mods"]')
const modsExtraServidor = listaModsEditable({
    zona: document.getElementById('bloqueModsExtra'),
    lista: document.getElementById('servidorModsExtra'),
    resumen: document.getElementById('extraResumen'),
    soltar: document.getElementById('extraSoltar'),
    botonCarpeta: seccionServidorMods.querySelector('[data-accion="extraCarpeta"]'),
    botonAgregar: seccionServidorMods.querySelector('[data-accion="extraAgregar"]'),
    carpeta: () => pathInicio.join(ConfigManager.getInstanceDirectory(), ConfigManager.getSelectedServer(), 'mods'),
    excluir: () => {
        const serv = distroInicio?.getServerById(ConfigManager.getSelectedServer())
        return serv ? archivosDeLaDistribution(serv) : new Set()
    },
    textoVacio: tInicio('modsExtraVacio')
})

// Rendimiento
document.getElementById('instanciaRam').addEventListener('input', e => {
    document.getElementById('instanciaRamValor').textContent = `${e.target.value} GB`
})
document.getElementById('instanciaRam').addEventListener('change', e => {
    const valor = gbATexto(parseFloat(e.target.value))
    ConfigManager.setMaxRAM(instanciaAbierta, valor)
    ConfigManager.setMinRAM(instanciaAbierta, valor)
    ConfigManager.save()
})
seccionInstancia.querySelector('[data-accion="java"]').addEventListener('click', async () => {
    const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: tInicio('instElegirJava'),
        properties: ['openFile'],
        filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : []
    })
    if(!res.canceled && res.filePaths.length > 0){
        ConfigManager.setJavaExecutable(instanciaAbierta, res.filePaths[0])
        ConfigManager.save()
        document.getElementById('instanciaJava').textContent = res.filePaths[0]
    }
})
seccionInstancia.querySelector('[data-accion="javaAuto"]').addEventListener('click', () => {
    // Sin Java elegido, al jugar se busca o se baja el que pida esa versión.
    ConfigManager.setJavaExecutable(instanciaAbierta, null)
    ConfigManager.save()
    document.getElementById('instanciaJava').textContent = tInicio('instJavaNinguno')
})
seccionInstancia.querySelector('[data-accion="jvmGuardar"]').addEventListener('click', () => {
    const args = document.getElementById('instanciaJvm').value.split(/\s+/).filter(Boolean)
    ConfigManager.setJVMOptions(instanciaAbierta, args)
    ConfigManager.save()
    document.getElementById('jvmGuardado').hidden = false
})
seccionInstancia.querySelector('[data-accion="jvmDefecto"]').addEventListener('click', () => {
    ConfigManager.setJVMOptions(instanciaAbierta, [...JVM_DEFECTO])
    ConfigManager.save()
    document.getElementById('instanciaJvm').value = JVM_DEFECTO.join(' ')
    document.getElementById('jvmGuardado').hidden = false
})
document.getElementById('instanciaJvm').addEventListener('input', () => {
    document.getElementById('jvmGuardado').hidden = true
})

// Duplicar y borrar
seccionInstancia.querySelector('[data-accion="duplicar"]').addEventListener('click', async e => {
    const boton = e.currentTarget
    const inst = Instancias.obtener(instanciaAbierta)
    boton.disabled = true
    boton.textContent = tInicio('duplicando')
    try {
        const copia = await Instancias.duplicar(inst.id, tInicio('copiaDe', { nombre: inst.nombre }).substring(0, 40))
        pintarInstancias()
        abrirInstancia(copia.id)
    } catch(err) {
        loggerInicio.error('No se pudo duplicar la instancia.', err)
        mostrarError(tInicio('duplicarErrorTitulo'), tInicio('duplicarErrorTexto'))
    } finally {
        boton.disabled = false
        boton.textContent = tInicio('instDuplicar')
    }
})
seccionInstancia.querySelector('[data-accion="borrar"]').addEventListener('click', () => {
    const inst = Instancias.obtener(instanciaAbierta)
    confirmar(tInicio('borrarTitulo', { nombre: inst.nombre }), tInicio('borrarTexto'), tInicio('borrarSi'), async () => {
        const carpeta = Instancias.carpeta(inst.id)
        if(await fsInicio.pathExists(carpeta) && !await aLaPapelera(carpeta)){
            mostrarError(tInicio('borrarErrorTitulo'), tInicio('borrarErrorTexto'))
            return
        }
        Instancias.quitar(inst.id)
        if(ConfigManager.getUltimaSeleccion()?.id === inst.id){
            ConfigManager.setUltimaSeleccion(null)
            ConfigManager.save()
        }
        pintarInstancias()
        pintarContinuar()
        irA('instancias')
    })
})

/* ---------- Crear instancia ---------- */

const modalCrear = document.getElementById('modalCrear')
const formCrear = document.getElementById('formCrear')
const crearError = document.getElementById('crearError')
const creador = selectorVersiones({
    loaders: document.getElementById('crearLoaders'),
    version: document.getElementById('crearVersion'),
    loaderVersion: document.getElementById('crearLoaderVersion'),
    campoLoaderVersion: document.getElementById('crearLoaderVersionCampo'),
    snapshots: document.getElementById('crearSnapshots'),
    error: crearError
})

function abrirCrear(){
    formCrear.reset()
    creador.reiniciar('vanilla')
    modalCrear.hidden = false
    document.getElementById('crearNombre').focus()
}

function cerrarCrear(){
    modalCrear.hidden = true
}

formCrear.querySelector('[data-accion="cancelar"]').addEventListener('click', cerrarCrear)
modalCrear.addEventListener('mousedown', e => {
    if(e.target === modalCrear){
        cerrarCrear()
    }
})
modalCrear.addEventListener('keydown', e => {
    if(e.key === 'Escape'){
        cerrarCrear()
    }
})
formCrear.addEventListener('submit', async e => {
    e.preventDefault()
    const nombre = document.getElementById('crearNombre').value.trim()
    const v = creador.valor()
    if(!nombre || !v.completo){
        crearError.textContent = tInicio('errorIncompleto')
        crearError.hidden = false
        return
    }
    const boton = document.getElementById('crearConfirmar')
    try {
        // Forge y NeoForge: que exista el instalador antes de crear nada.
        boton.disabled = true
        boton.textContent = tInicio('revisando')
        await Instancias.validarLoader(v)
        const inst = Instancias.crear({ nombre, mc: v.mc, loader: v.loader, loaderVersion: v.loaderVersion })
        cerrarCrear()
        pintarInstancias()
        abrirInstancia(inst.id)
    } catch(err) {
        loggerInicio.error('No se pudo crear la instancia.', err)
        crearError.textContent = err.displayable ?? err.message
        crearError.hidden = false
    } finally {
        boton.disabled = false
        boton.textContent = tInicio('crear')
    }
})

/* ---------- Perfil ---------- */

let perfilVisor = null

function refrescarPerfil(bust){
    const acc = ConfigManager.getSelectedAccount()
    document.getElementById('perfilNombre').textContent = acc?.displayName ?? ''
    document.getElementById('perfilUuid').textContent = acc?.uuid ?? ''
    if(acc?.uuid == null || seccionActual !== 'perfil'){
        return
    }
    try {
        if(perfilVisor == null){
            const skinview3d = loadSkinview3d()
            const canvas = document.getElementById('perfilSkin')
            perfilVisor = new skinview3d.SkinViewer({ canvas, width: 300, height: 420 })
            perfilVisor.fov = 40
            perfilVisor.zoom = 0.85
            perfilVisor.controls.enableZoom = false
            perfilVisor.controls.enablePan = false
            perfilVisor.animation = new skinview3d.IdleAnimation()
            perfilVisor.playerObject.rotation.y = -0.5
        }
        perfilVisor.renderPaused = false
        perfilVisor.loadSkin(`https://mc-heads.net/skin/${acc.uuid}${bust ? '?v=' + bust : ''}`, { model: 'auto-detect' })
    } catch(err) {
        loggerInicio.warn('No se pudo mostrar la skin.', err)
    }
}

const seccionPerfil = document.getElementById('seccionPerfil')
async function abrirAjustesEn(pestana){
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.querySelector(`.settingsNavItem[rSc="${pestana}"]`), false)
    })
}
seccionPerfil.querySelector('[data-accion="skin"]').addEventListener('click', () => abrirAjustesEn('settingsTabSkin'))
seccionPerfil.querySelector('[data-accion="cuentas"]').addEventListener('click', () => abrirAjustesEn('settingsTabAccount'))

/* ---------- Ajustes del launcher: idioma y RAM por defecto ---------- */

const ajusteIdioma = document.getElementById('ajusteIdioma')
const ajusteRam = document.getElementById('ajusteRam')
const ajusteRamAuto = document.getElementById('ajusteRamAuto')

function pintarAjustesLauncher(){
    ajusteIdioma.value = ConfigManager.getIdioma()
    const total = require('os').totalmem() / GB
    ajusteRam.max = Math.max(2, Math.floor(total - 1))
    const mb = ConfigManager.getRamPorDefecto()
    ajusteRamAuto.checked = mb == null
    ajusteRam.disabled = mb == null
    ajusteRam.value = mb != null ? mb / 1024 : ramAGb(ConfigManager.getRamPorDefectoTexto())
    document.getElementById('ajusteRamValor').textContent = `${ajusteRam.value} GB`
}

ajusteIdioma.addEventListener('change', () => {
    ConfigManager.setIdioma(ajusteIdioma.value)
    ConfigManager.save()
    confirmar(tInicio('idiomaTitulo'), tInicio('idiomaTexto'), tInicio('idiomaReiniciar'), () => {
        remote.app.relaunch()
        remote.app.exit(0)
    })
})
ajusteRamAuto.addEventListener('change', () => {
    ConfigManager.setRamPorDefecto(ajusteRamAuto.checked ? null : Math.round(parseFloat(ajusteRam.value) * 1024))
    ConfigManager.save()
    pintarAjustesLauncher()
})
ajusteRam.addEventListener('input', () => {
    document.getElementById('ajusteRamValor').textContent = `${ajusteRam.value} GB`
})
ajusteRam.addEventListener('change', () => {
    ConfigManager.setRamPorDefecto(Math.round(parseFloat(ajusteRam.value) * 1024))
    ConfigManager.save()
})

/* ---------- Arranque ---------- */

async function cargarExtras(){
    // Sin servidor se usa la última copia buena; sin copia, valores por defecto.
    const { datos } = await Servidor.leerJson('servidores-extra.json')
    if(datos?.servidores != null){
        extrasServidores = datos.servidores
    }
}

function pintarTodo(){
    pintarSaludo()
    pintarServidores()
    pintarInstancias()
    pintarContinuar()
}

/**
 * Lo llama uibinder.js cuando ya está la distribution.
 */
function iniciarInicio(data){
    distroInicio = data
    pintarTodo()
    pintarAjustesLauncher()
    cargarExtras().then(() => {
        pintarTodo()
        if(seccionActual === 'servidor'){
            pintarVistaServidor()
        }
    })
    cargarNoticias()
    pingTodos()
}

/**
 * Lo llama uibinder.js cada vez que se refresca la distribution.
 */
function refrescarInicio(data){
    distroInicio = data
    pintarServidores()
    pintarContinuar()
}

// Estados y noticias se refrescan solos (en pausa con la ventana minimizada).
setInterval(() => {
    if(!document.hidden && distroInicio != null){
        pingTodos()
    }
}, 60000)
setInterval(() => {
    if(!document.hidden){
        cargarNoticias()
    }
}, 15 * 60000)
