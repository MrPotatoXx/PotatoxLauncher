/**
 * Modrinth en el launcher: buscador de mods, resource packs y shaders (instancias
 * propias), de mods de cliente (servidores) y de modpacks (crear instancia), y
 * exportar / importar instancias en .mrpack.
 */
// Modrinth (require de modrinth.js) ya lo declara inicio.js: los scripts comparten el ámbito.
const Mrpack   = require('./assets/js/mrpack')

const tMr = (k, p) => Lang.queryJS('inicio.mr.' + k, p)
const loggerMr = LoggerUtil.getLogger('ModrinthUI')

function formatoDescargas(n){
    if(n >= 1e6){
        return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} M`
    }
    if(n >= 1e3){
        return `${Math.round(n / 1e3)} k`
    }
    return String(n)
}

/**
 * Operación larga con el panel de progreso de abajo (el mismo de JUGAR).
 */
async function conProgreso(texto, fn){
    setLaunchDetails(texto)
    setLaunchPercentage(0)
    toggleLaunchArea(true)
    try {
        return await fn()
    } finally {
        toggleLaunchArea(false)
        remote.getCurrentWindow().setProgressBar(-1)
    }
}

/**
 * Buscador de Modrinth.
 *
 * @param {{contenedor: HTMLElement, tipos: string[], contexto: () => ({mc: string, loader: string,
 *   carpetaInstancia: string, soloCliente?: boolean}), alInstalar?: Function, modpacks?: boolean}} o
 */
function crearBuscadorModrinth(o){
    let tipo = o.tipos[0]
    let pagina = 0
    let instalados = new Map()
    let pedido = 0

    const raiz = el('section', 'buscadorModrinth')
    const cabeza = el('div', 'buscadorCabeza')
    cabeza.append(el('h3', 'tituloPixel', o.modpacks ? tMr('tituloModpacks') : tMr('titulo')))
    const tipos = el('div', 'tiposBusqueda')
    if(o.tipos.length > 1){
        for(const t of o.tipos){
            const b = el('button', null, tMr('tipo.' + t))
            b.type = 'button'
            b.setAttribute('aria-pressed', t === tipo ? 'true' : 'false')
            b.addEventListener('click', () => {
                tipo = t
                for(const x of tipos.children){
                    x.setAttribute('aria-pressed', x === b ? 'true' : 'false')
                }
                buscar(true)
            })
            tipos.append(b)
        }
    }
    cabeza.append(tipos)
    const campo = el('input', 'campoBusqueda')
    campo.type = 'search'
    const filtro = el('p', 'textoSuave filtroBusqueda')
    const resultados = el('div', 'resultadosModrinth')
    const mas = el('button', 'botonSecundario masResultados', tMr('verMas'))
    mas.type = 'button'
    mas.hidden = true
    raiz.append(cabeza, campo, filtro, resultados, mas)
    o.contenedor.replaceChildren(raiz)

    const carpetaTipo = () => require('path').join(o.contexto().carpetaInstancia, Modrinth.CARPETAS[tipo] ?? 'mods')

    async function refrescarInstalados(){
        if(o.modpacks){
            return
        }
        try {
            instalados = await Modrinth.instalados(carpetaTipo(), { tipo, ...o.contexto() })
        } catch(err) {
            loggerMr.warn('No se pudo revisar lo instalado.', err.message)
            instalados = new Map()
        }
    }

    function tarjeta(hit){
        const t = el('article', 'resultadoModrinth')
        const icono = el('img', 'resultadoIcono')
        icono.alt = ''
        icono.loading = 'lazy'
        icono.src = hit.icon_url || 'assets/images/potato/icono-64.png'
        icono.onerror = () => {
            icono.src = 'assets/images/potato/icono-64.png'
        }
        const textos = el('div', 'resultadoTextos')
        const titulo = el('div', 'resultadoTitulo')
        titulo.append(el('span', 'resultadoNombre', hit.title), el('span', 'resultadoAutor', tMr('por', { autor: hit.author })))
        textos.append(titulo, el('p', 'resultadoDescripcion', hit.description ?? ''))
        const meta = el('div', 'resultadoMeta')
        meta.append(el('span', null, tMr('descargas', { n: formatoDescargas(hit.downloads ?? 0) })))
        const link = el('a', null, tMr('verEnModrinth'))
        link.href = Modrinth.urlProyecto(hit)
        meta.append(link)
        textos.append(meta)

        const acciones = el('div', 'resultadoAcciones')
        const inst = instalados.get(hit.project_id)
        const boton = el('button', inst ? 'botonSecundario' : 'botonPrincipal')
        boton.type = 'button'
        if(o.modpacks){
            boton.textContent = tMr('importar')
            boton.addEventListener('click', () => importarModpack(hit))
        } else if(inst?.nueva){
            boton.textContent = tMr('actualizar')
            boton.className = 'botonPrincipal'
            boton.addEventListener('click', () => actualizar(hit, inst))
        } else if(inst){
            boton.textContent = tMr('instalado')
            boton.disabled = true
        } else {
            boton.textContent = tMr('instalar')
            boton.addEventListener('click', () => instalar(hit))
        }
        acciones.append(boton)
        t.append(icono, textos, acciones)
        return t
    }

    async function buscar(desdeCero){
        const n = ++pedido
        if(desdeCero){
            pagina = 0
            resultados.replaceChildren(el('p', 'textoSuave', tInicio('cargando')))
        }
        const ctx = o.contexto()
        filtro.textContent = o.modpacks ? '' : tMr('filtro', { loader: nombreLoader(ctx.loader), mc: ctx.mc })
            + (o.contexto().soloCliente ? ' · ' + tMr('soloCliente') : '')
        campo.placeholder = tMr('buscar.' + tipo)
        try {
            if(desdeCero){
                await refrescarInstalados()
            }
            const { hits, total } = await Modrinth.buscar({
                texto: campo.value.trim(),
                tipo,
                mc: o.modpacks ? null : ctx.mc,
                loader: o.modpacks || tipo !== 'mod' ? null : ctx.loader,
                soloCliente: ctx.soloCliente === true,
                offset: pagina * 20
            })
            if(n !== pedido){
                return
            }
            if(desdeCero){
                resultados.replaceChildren()
            }
            if(hits.length === 0 && desdeCero){
                resultados.append(el('p', 'textoSuave', tMr('sinResultados')))
            }
            for(const hit of hits){
                resultados.append(tarjeta(hit))
            }
            pagina++
            mas.hidden = pagina * 20 >= total
        } catch(err) {
            loggerMr.warn('Búsqueda en Modrinth falló.', err.message)
            if(n === pedido){
                resultados.replaceChildren(el('p', 'textoError', tMr('errorBusqueda')))
            }
        }
    }

    async function instalar(hit){
        const ctx = o.contexto()
        try {
            const archivos = await conProgreso(tMr('instalando', { nombre: hit.title }), () => Modrinth.instalar(hit.project_id, {
                tipo,
                mc: ctx.mc,
                loader: ctx.loader,
                carpeta: carpetaTipo(),
                alDetalle: archivo => setLaunchDetails(tMr('instalandoArchivo', { archivo }))
            }))
            loggerMr.info('Instalado desde Modrinth:', archivos)
            await o.alInstalar?.()
        } catch(err) {
            loggerMr.error('No se pudo instalar desde Modrinth.', err)
            mostrarError(tMr('errorTitulo'), err.sinVersion
                ? tMr('sinVersion', { nombre: hit.title, loader: nombreLoader(ctx.loader), mc: ctx.mc })
                : tMr('errorTexto'))
        }
        buscar(true)
    }

    async function actualizar(hit, inst){
        try {
            await conProgreso(tMr('actualizando', { nombre: hit.title }), () => Modrinth.actualizar(inst, aLaPapelera))
            await o.alInstalar?.()
        } catch(err) {
            loggerMr.error('No se pudo actualizar desde Modrinth.', err)
            mostrarError(tMr('errorTitulo'), tMr('errorTexto'))
        }
        buscar(true)
    }

    let espera = null
    campo.addEventListener('input', () => {
        clearTimeout(espera)
        espera = setTimeout(() => buscar(true), 400)
    })
    mas.addEventListener('click', () => buscar(false))

    return { buscar: () => buscar(true), refrescar: () => buscar(true) }
}

/* ---------- Instancias propias ---------- */

const contextoInstancia = () => {
    const inst = Instancias.obtener(instanciaAbierta)
    return { mc: inst.mc, loader: inst.loader, carpetaInstancia: Instancias.carpeta(inst.id) }
}

const buscadorInstancia = crearBuscadorModrinth({
    contenedor: document.getElementById('buscadorInstancia'),
    tipos: ['mod', 'resourcepack', 'shader'],
    contexto: contextoInstancia,
    alInstalar: () => cargarModsInstancia()
})

/* ---------- Servidores: mods de cliente ---------- */

const buscadorServidor = crearBuscadorModrinth({
    contenedor: document.getElementById('buscadorServidor'),
    tipos: ['mod'],
    contexto: () => {
        const serv = servidorPorId(idVista())
        return {
            mc: serv?.rawServer.minecraftVersion,
            loader: serv ? loaderDeServidor(serv) : 'vanilla',
            carpetaInstancia: require('path').join(ConfigManager.getInstanceDirectory(), idVista()),
            soloCliente: true
        }
    },
    alInstalar: () => modsExtraServidor.cargar()
})

// Se busca al abrir la pestaña Mods (y no antes, para no gastar pedidos).
for(const [grupo, buscador] of [['instancia', buscadorInstancia], ['servidor', buscadorServidor]]){
    document.querySelector(`.pestanas[data-grupo="${grupo}"] [data-pestana="mods"]`)
        .addEventListener('click', () => buscador.buscar())
}
const abrirInstanciaOriginal = abrirInstancia
abrirInstancia = function(id, pestana){
    abrirInstanciaOriginal(id, pestana)
    if(pestana === 'mods'){
        buscadorInstancia.buscar()
    }
}

/* ---------- Exportar ---------- */

document.querySelector('#seccionInstancia [data-accion="exportar"]').addEventListener('click', async () => {
    const inst = Instancias.obtener(instanciaAbierta)
    const res = await remote.dialog.showSaveDialog(remote.getCurrentWindow(), {
        title: tMr('exportarTitulo'),
        defaultPath: `${inst.nombre.replace(/[\\/:*?"<>|]/g, '')}.mrpack`,
        filters: [{ name: 'Modrinth (.mrpack)', extensions: ['mrpack'] }]
    })
    if(res.canceled || !res.filePath){
        return
    }
    try {
        const r = await conProgreso(tMr('exportando'), () => Mrpack.exportar(inst, res.filePath))
        setOverlayContent(tMr('exportadoTitulo'), tMr('exportadoTexto', { referencias: r.referencias, incluidos: r.incluidos }), tInicio('entendido'))
        setOverlayHandler(null)
        toggleOverlay(true)
        shell.showItemInFolder(res.filePath)
    } catch(err) {
        loggerMr.error('No se pudo exportar.', err)
        mostrarError(tMr('errorTitulo'), tMr('exportarError'))
    }
})

/* ---------- Importar (.mrpack y modpacks de Modrinth) ---------- */

async function importarMrpack(ruta, nombre = null){
    cerrarCrear()
    try {
        const inst = await conProgreso(tMr('importando'), () => Mrpack.importar(ruta, {
            // Desde Modrinth: el nombre del modpack (el índice a veces trae solo la versión).
            nombre: nombre ? nombre.substring(0, 40) : null,
            alDetalle: archivo => setLaunchDetails(tMr('importandoArchivo', { archivo })),
            alProgreso: p => setDownloadPercentage(p)
        }))
        pintarInstancias()
        abrirInstancia(inst.id)
    } catch(err) {
        loggerMr.error('No se pudo importar el .mrpack.', err)
        mostrarError(tMr('importarErrorTitulo'), err.displayable ?? tMr('importarError'))
    }
}

async function importarModpack(hit){
    const os = require('os')
    const fs = require('fs-extra')
    const path = require('path')
    let carpeta = null
    try {
        const version = await Modrinth.versionCompatible(hit.project_id, { tipo: 'modpack' })
        if(version == null){
            throw Object.assign(new Error('sin versión'), { displayable: tMr('modpackSinVersion') })
        }
        const archivo = Modrinth.archivoPrincipal(version)
        carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'potatox-mrpack-'))
        const ruta = path.join(carpeta, 'modpack.mrpack')
        cerrarCrear()
        await conProgreso(tMr('bajandoModpack', { nombre: hit.title }), () => Modrinth.bajar(archivo, ruta))
        await importarMrpack(ruta, hit.title)
    } catch(err) {
        loggerMr.error('No se pudo importar el modpack.', err)
        mostrarError(tMr('importarErrorTitulo'), err.displayable ?? tMr('importarError'))
    } finally {
        if(carpeta){
            fs.remove(carpeta).catch(() => {})
        }
    }
}

const buscadorModpacks = crearBuscadorModrinth({
    contenedor: document.getElementById('buscadorModpacks'),
    tipos: ['modpack'],
    modpacks: true,
    contexto: () => ({ mc: null, loader: null, carpetaInstancia: '' })
})

document.querySelector('.pestanas[data-grupo="crear"] [data-pestana="importar"]')
    .addEventListener('click', () => buscadorModpacks.buscar())

document.querySelector('#zonaMrpack [data-accion="elegirMrpack"]').addEventListener('click', async () => {
    const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
        title: tMr('mrpackElegir'),
        properties: ['openFile'],
        filters: [{ name: 'Modrinth (.mrpack)', extensions: ['mrpack', 'zip'] }]
    })
    if(!res.canceled && res.filePaths.length > 0){
        importarMrpack(res.filePaths[0])
    }
})

const zonaMrpack = document.getElementById('zonaMrpack')
zonaMrpack.addEventListener('dragenter', e => {
    e.preventDefault()
    zonaMrpack.setAttribute('activa', '')
})
zonaMrpack.addEventListener('dragleave', () => zonaMrpack.removeAttribute('activa'))
zonaMrpack.addEventListener('drop', e => {
    e.preventDefault()
    zonaMrpack.removeAttribute('activa')
    const { webUtils } = require('electron')
    const ruta = [...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)).find(r => /\.(mrpack|zip)$/i.test(r))
    if(ruta){
        importarMrpack(ruta)
    }
})
