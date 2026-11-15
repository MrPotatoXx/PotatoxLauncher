/**
 * La vista principal del launcher: barra lateral, Inicio, Servidores, Mis instancias,
 * la vista de cada servidor e instancia, el perfil y el diálogo para crear instancias.
 *
 * Los servidores llegan del distribution.json (el servidor decide cuáles ve cada uno).
 * Los datos de presentación (loader, banner, color, estado) vienen aparte en
 * servidores-extra.json y las noticias en noticias.json. Si algo falla se muestran
 * valores por defecto y el launcher sigue andando.
 */
const { getStatus: pingServidor } = require('./assets/js/serverstatus')
const { SHELL_OPCODE }            = require('./assets/js/ipcconstants')

const URL_EXTRA     = 'https://mc.potatox.me/launcher/servidores-extra.json'
const URL_NOTICIAS  = 'https://mc.potatox.me/launcher/noticias.json'
const IMG           = 'assets/images/potato'
const loggerInicio  = LoggerUtil.getLogger('Inicio')

let distroInicio = null
let extrasServidores = {}
let estadosServidores = {}
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

function esTierras(id){
    return typeof id === 'string' && id.startsWith('TierrasMalditas')
}

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

function nombreLoader(id){
    return Instancias.LOADERS[id]?.nombre ?? id
}

function chipLoader(loader, version){
    const c = el('span', 'chip chipLoader', `${nombreLoader(loader)} ${version}`)
    c.setAttribute('loader', loader)
    return c
}

/**
 * Estado que se muestra de un servidor: el de servidores-extra.json manda;
 * si está "abierto" se le pregunta al servidor si está en línea.
 */
function estadoServidor(id){
    const extra = extrasServidores[id]?.estado ?? 'abierto'
    if(extra !== 'abierto'){
        return { clave: extra, texto: tInicio('estado.' + extra) }
    }
    const ping = estadosServidores[id]
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

function arteServidor(id){
    const extra = extrasServidores[id]
    if(extra?.banner){
        return extra.banner
    }
    if(esTierras(id)){
        return `assets/images/backgrounds/${document.body.getAttribute('bkid')}.jpg`
    }
    return `${IMG}/tarjeta-generica.jpg`
}

function vacio(texto){
    const v = el('div', 'listaVacia')
    const img = el('img')
    img.src = `${IMG}/mascota-vacio.png`
    img.alt = ''
    v.append(img, el('p', null, texto))
    return v
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
    document.body.toggleAttribute('vistaTierras', seccion === 'servidor' && esTierras(ConfigManager.getSelectedServer()))
    if(typeof window.ambienteActivo === 'function'){
        window.ambienteActivo(document.body.hasAttribute('vistaTierras'))
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
    banner.removeAttribute('tierras')

    if(obj.tipo === 'servidor'){
        const serv = distroInicio.getServerById(obj.id)
        nombre.textContent = serv.rawServer.name
        arte.style.backgroundImage = `url('${arteServidor(obj.id)}')`
        banner.toggleAttribute('tierras', esTierras(obj.id))
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
    return isNaN(d) ? iso : d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function cargarNoticias(){
    const bloque = document.getElementById('bloqueNoticias')
    const lista = document.getElementById('listaNoticias')
    try {
        const d = await pedirJson(URL_NOTICIAS)
        const noticias = Array.isArray(d.noticias) ? d.noticias : []
        lista.replaceChildren()
        for(const n of noticias.slice(0, 6)){
            const tarjeta = el(n.link ? 'a' : 'article', 'tarjetaNoticia')
            if(n.link){
                tarjeta.href = n.link
            }
            const img = el('img', 'noticiaImagen')
            img.alt = ''
            img.src = n.imagen || `${IMG}/noticia-default.jpg`
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
            lista.append(tarjeta)
        }
        bloque.style.display = noticias.length > 0 ? '' : 'none'
    } catch(err) {
        loggerInicio.warn('No se pudieron cargar las noticias.', err.message)
        bloque.style.display = 'none'
    }
}

/* ---------- Servidores ---------- */

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
    arte.style.backgroundImage = `url('${arteServidor(id)}')`
    if(serv.rawServer.icon){
        const icono = el('img', 'tarjetaIcono')
        icono.src = serv.rawServer.icon
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
            contenedor.append(vacio(tInicio('sinServidores')))
        }
        for(const s of servidores){
            contenedor.append(tarjetaServidor(s))
        }
    }
}

async function pingTodos(){
    const servidores = distroInicio?.servers ?? []
    await Promise.all(servidores.map(async s => {
        try {
            estadosServidores[s.rawServer.id] = await pingServidor(s.hostname, s.port)
        } catch(_err) {
            estadosServidores[s.rawServer.id] = { online: false }
        }
    }))
    pintarServidores()
    pintarContinuar()
    if(seccionActual === 'servidor'){
        pintarVistaServidor()
    }
}

function abrirServidor(id){
    seleccionarServidor(id)
    pintarVistaServidor()
    irA('servidor')
}

function pintarVistaServidor(){
    const id = ConfigManager.getSelectedServer()
    const serv = distroInicio?.getServerById(id)
    if(serv == null){
        return
    }
    const seccion = document.getElementById('seccionServidor')
    const tierras = esTierras(id)
    seccion.toggleAttribute('tierras', tierras)
    seccion.style.setProperty('--acento', extrasServidores[id]?.colorAcento ?? '#6CC04A')
    const arte = document.getElementById('fondoReino')
    arte.style.backgroundImage = `url('${arteServidor(id)}')`
    const icono = document.getElementById('servidorIcono')
    icono.hidden = !serv.rawServer.icon
    if(serv.rawServer.icon){
        icono.src = serv.rawServer.icon
    }
    document.getElementById('servidorNombre').textContent = serv.rawServer.name
    document.getElementById('servidorChips').replaceChildren(chipLoader(loaderDeServidor(serv), serv.rawServer.minecraftVersion), chipEstado(id))
    document.getElementById('servidorDescripcion').textContent = serv.rawServer.description ?? ''
    document.body.toggleAttribute('vistaTierras', seccionActual === 'servidor' && tierras)
}

/* ---------- Instancias propias ---------- */

function tarjetaInstancia(inst){
    const t = el('button', 'tarjetaInstancia')
    const icono = el('span', 'iconoLoader')
    icono.innerHTML = ICONOS_LOADER[inst.loader] ?? ICONOS_LOADER.vanilla
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

const GB = 1024 * 1024 * 1024

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

function abrirInstancia(id){
    const inst = Instancias.obtener(id)
    if(inst == null){
        return
    }
    instanciaAbierta = id
    document.getElementById('instanciaIcono').innerHTML = ICONOS_LOADER[inst.loader] ?? ICONOS_LOADER.vanilla
    document.getElementById('instanciaNombre').textContent = inst.nombre
    const extra = inst.loaderVersion ? ` · ${tInicio('loaderVersion', { version: inst.loaderVersion })}` : ''
    document.getElementById('instanciaVersion').textContent = `${nombreLoader(inst.loader)} ${inst.mc}${extra}`

    // RAM y Java propios: se guardan con el id de la instancia, como los servidores.
    ConfigManager.ensureJavaConfig(id, { suggestedMajor: 21 }, null)
    const total = require('os').totalmem() / GB
    const rango = document.getElementById('instanciaRam')
    rango.max = Math.max(2, Math.floor(total - 1))
    rango.value = ramAGb(ConfigManager.getMaxRAM(id))
    document.getElementById('instanciaRamValor').textContent = `${rango.value} GB`
    document.getElementById('instanciaRamTotal').textContent = tInicio('instMemoriaTotal', { total: total.toFixed(1) })
    document.getElementById('instanciaJava').textContent = ConfigManager.getJavaExecutable(id) ?? tInicio('instJavaNinguno')
    irA('instancia')
}

document.getElementById('instanciaRam').addEventListener('input', e => {
    document.getElementById('instanciaRamValor').textContent = `${e.target.value} GB`
})
document.getElementById('instanciaRam').addEventListener('change', e => {
    const valor = gbATexto(parseFloat(e.target.value))
    ConfigManager.setMaxRAM(instanciaAbierta, valor)
    ConfigManager.setMinRAM(instanciaAbierta, valor)
    ConfigManager.save()
})

const seccionInstancia = document.getElementById('seccionInstancia')
seccionInstancia.querySelector('[data-accion="jugar"]').addEventListener('click', () => lanzarInstancia(instanciaAbierta))
seccionInstancia.querySelector('[data-accion="carpeta"]').addEventListener('click', async () => {
    const carpeta = Instancias.carpeta(instanciaAbierta)
    await require('fs-extra').ensureDir(carpeta)
    shell.openPath(carpeta)
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
seccionInstancia.querySelector('[data-accion="borrar"]').addEventListener('click', () => {
    const inst = Instancias.obtener(instanciaAbierta)
    setOverlayContent(
        tInicio('borrarTitulo', { nombre: inst.nombre }),
        tInicio('borrarTexto'),
        tInicio('borrarSi'),
        tInicio('cancelar')
    )
    setOverlayHandler(async () => {
        toggleOverlay(false)
        const carpeta = Instancias.carpeta(inst.id)
        if(await require('fs-extra').pathExists(carpeta)){
            const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, carpeta)
            if(!res.result){
                loggerInicio.error('No se pudo mandar la carpeta a la papelera.', res.error)
                mostrarError(tInicio('borrarErrorTitulo'), tInicio('borrarErrorTexto'))
                return
            }
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
    setDismissHandler(() => toggleOverlay(false))
    toggleOverlay(true, true)
})

function mostrarError(titulo, texto){
    setOverlayContent(titulo, `<img class="overlayMascota" src="${IMG}/mascota-error.png" alt="">${texto}`, tInicio('entendido'))
    setOverlayHandler(null)
    toggleOverlay(true)
}

/* ---------- Crear instancia ---------- */

const modalCrear = document.getElementById('modalCrear')
const formCrear = document.getElementById('formCrear')
const crearVersion = document.getElementById('crearVersion')
const crearLoaderVersion = document.getElementById('crearLoaderVersion')
const crearError = document.getElementById('crearError')
let loaderElegido = 'vanilla'
let pedidoVersiones = 0

function pintarOpcionesLoader(){
    const cont = document.getElementById('crearLoaders')
    cont.replaceChildren()
    for(const l of Object.values(Instancias.LOADERS)){
        const op = el('label', 'opcionLoader')
        const radio = el('input')
        radio.type = 'radio'
        radio.name = 'loader'
        radio.value = l.id
        radio.disabled = !l.disponible
        radio.checked = l.id === loaderElegido
        op.toggleAttribute('elegido', radio.checked)
        op.toggleAttribute('deshabilitado', !l.disponible)
        radio.addEventListener('change', () => {
            loaderElegido = l.id
            for(const o of cont.children){
                o.toggleAttribute('elegido', o.querySelector('input').value === l.id)
            }
            cargarVersiones()
        })
        const icono = el('span', 'iconoLoader')
        icono.innerHTML = ICONOS_LOADER[l.id]
        op.append(radio, icono, el('span', 'opcionNombre', l.nombre))
        if(!l.disponible){
            op.append(el('span', 'chipPronto', tInicio('pronto')))
        }
        cont.append(op)
    }
}

function llenarSelect(select, opciones, textoVacio){
    select.replaceChildren()
    if(opciones.length === 0){
        const o = el('option', null, textoVacio)
        o.value = ''
        select.append(o)
        select.disabled = true
        return
    }
    select.disabled = false
    for(const op of opciones){
        const o = el('option', null, op.estable === false ? `${op.id} (${tInicio('inestable')})` : op.id)
        o.value = op.id
        select.append(o)
    }
}

async function cargarVersiones(){
    const pedido = ++pedidoVersiones
    const loader = Instancias.LOADERS[loaderElegido]
    crearError.hidden = true
    llenarSelect(crearVersion, [], tInicio('cargandoVersiones'))
    document.getElementById('crearLoaderVersionCampo').hidden = !loader.conVersion
    try {
        const versiones = await loader.versionesMinecraft(document.getElementById('crearSnapshots').checked)
        if(pedido !== pedidoVersiones){
            return
        }
        llenarSelect(crearVersion, versiones, tInicio('sinVersiones'))
        await cargarVersionesLoader()
    } catch(err) {
        loggerInicio.warn('No se pudieron cargar las versiones.', err.message)
        if(pedido === pedidoVersiones){
            llenarSelect(crearVersion, [], tInicio('sinVersiones'))
            crearError.textContent = tInicio('errorVersiones')
            crearError.hidden = false
        }
    }
}

async function cargarVersionesLoader(){
    const loader = Instancias.LOADERS[loaderElegido]
    if(!loader.conVersion || !crearVersion.value){
        return
    }
    const pedido = pedidoVersiones
    llenarSelect(crearLoaderVersion, [], tInicio('cargandoVersiones'))
    const versiones = await loader.versionesLoader(crearVersion.value)
    if(pedido !== pedidoVersiones){
        return
    }
    // Primero la estable más nueva.
    versiones.sort((a, b) => (b.estable === true) - (a.estable === true))
    llenarSelect(crearLoaderVersion, versiones, tInicio('sinVersiones'))
}

crearVersion.addEventListener('change', () => {
    cargarVersionesLoader().catch(err => loggerInicio.warn(err.message))
})
document.getElementById('crearSnapshots').addEventListener('change', () => cargarVersiones())

function abrirCrear(){
    loaderElegido = 'vanilla'
    formCrear.reset()
    pintarOpcionesLoader()
    modalCrear.hidden = false
    document.getElementById('crearNombre').focus()
    cargarVersiones()
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
formCrear.addEventListener('submit', e => {
    e.preventDefault()
    const nombre = document.getElementById('crearNombre').value.trim()
    const loader = Instancias.LOADERS[loaderElegido]
    if(!nombre || !crearVersion.value || (loader.conVersion && !crearLoaderVersion.value)){
        crearError.textContent = tInicio('errorIncompleto')
        crearError.hidden = false
        return
    }
    try {
        const inst = Instancias.crear({
            nombre,
            mc: crearVersion.value,
            loader: loaderElegido,
            loaderVersion: crearLoaderVersion.value || null
        })
        cerrarCrear()
        pintarInstancias()
        abrirInstancia(inst.id)
    } catch(err) {
        loggerInicio.error('No se pudo crear la instancia.', err)
        crearError.textContent = err.message
        crearError.hidden = false
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

/* ---------- Arranque ---------- */

async function cargarExtras(){
    try {
        const d = await pedirJson(URL_EXTRA)
        extrasServidores = d?.servidores ?? {}
    } catch(err) {
        loggerInicio.warn('No se pudo cargar servidores-extra.json.', err.message)
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
