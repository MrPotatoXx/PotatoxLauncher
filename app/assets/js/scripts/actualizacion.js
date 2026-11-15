/**
 * Actualizaciones obligatorias y opcionales, controladas desde el repo.
 *
 * Cada release lleva en sus notas (docs/release-notes.md) una línea
 * "obligatoria: sí" u "obligatoria: no" (puede ir dentro de un comentario HTML
 * para que no se vea). Sin la línea cuenta como "no".
 *
 * Mientras está la pantalla de carga se consultan los releases de GitHub más
 * nuevos que la versión instalada (5 s como máximo):
 * - Si alguno es obligatorio: en la misma pantalla de carga se muestra
 *   "Actualización obligatoria", se descarga con barra de progreso, se instala y
 *   el launcher se vuelve a abrir. No se entra sin actualizar.
 * - Si no: se entra normal. electron-updater baja la nueva en segundo plano, hay un
 *   aviso discreto en la barra lateral y un toast una vez; se instala al cerrar
 *   el launcher o al apretar "Reiniciar y actualizar".
 * - Sin internet o si GitHub no responde a tiempo: se entra normal.
 */
const semverAct = require('semver')

const REPO_ACT = 'MrPotatoXx/PotatoxLauncher'
const URL_RELEASES = `https://api.github.com/repos/${REPO_ACT}/releases?per_page=30`
const URL_INSTALADOR = `https://github.com/${REPO_ACT}/releases/latest/download/Potatox-Launcher-setup.exe`
const TIMEOUT_RELEASES = 5000
// Sin \b después de "sí": la í no cuenta como letra en un regex sin la bandera u.
const RE_OBLIGATORIA = /^\s*(?:<!--\s*)?obligatoria\s*:\s*(s[ií]|no)(?=\s|-->|$).*$/gim
const loggerAct = LoggerUtil.getLogger('Actualizacion')
const tAct = (k, p) => Lang.queryJS('inicio.act.' + k, p)

const estadoAct = {
    ultima: undefined,   // versión que ofrece electron-updater
    releases: [],        // releases más nuevos que la instalada (de GitHub)
    descargada: false,
    obligatoria: false
}

function versionActual(){
    return remote.app.getVersion()
}

/**
 * true si las notas del release dicen "obligatoria: sí".
 */
function esObligatoria(notas){
    RE_OBLIGATORIA.lastIndex = 0
    const m = RE_OBLIGATORIA.exec(notas ?? '')
    return m != null && m[1].toLowerCase() !== 'no'
}

/**
 * Consulta GitHub. Nunca falla: sin respuesta devuelve que no hay nada obligatorio.
 *
 * @returns {Promise<{obligatoria: boolean, releases: Array<{version: string, notas: string}>}>}
 */
async function revisarReleases(){
    const actual = versionActual()
    try {
        const res = await fetch(URL_RELEASES, {
            cache: 'no-store',
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(TIMEOUT_RELEASES)
        })
        if(!res.ok){
            throw new Error(`HTTP ${res.status}`)
        }
        const prerelease = ConfigManager.getAllowPrerelease() || semverAct.prerelease(actual) != null
        const releases = (await res.json())
            .filter(r => !r.draft && (prerelease || !r.prerelease))
            .map(r => ({ version: semverAct.valid(semverAct.clean(r.tag_name ?? '')), notas: r.body ?? '' }))
            .filter(r => r.version != null && semverAct.gt(r.version, actual))
            .sort((a, b) => semverAct.rcompare(a.version, b.version))
        const obligatoria = releases.some(r => esObligatoria(r.notas))
        loggerAct.info(`Releases nuevos: ${releases.map(r => r.version).join(', ') || 'ninguno'}${obligatoria ? ' (hay uno obligatorio)' : ''}.`)
        return { obligatoria, releases }
    } catch(err) {
        loggerAct.warn('No se pudo consultar GitHub, se entra normal.', err.message)
        return { obligatoria: false, releases: [] }
    }
}

// Arranca junto con la pantalla de carga; uibinder.js espera el resultado.
const revisionReleases = isDev && !process.env.POTATOX_PRUEBA_ACTUALIZACION
    ? Promise.resolve({ obligatoria: false, releases: [] })
    : revisarReleases()

/**
 * Lo llama showMainUI (uibinder.js) antes de entrar al launcher.
 *
 * @returns {Promise<boolean>} true si hay una actualización obligatoria (no se entra).
 */
async function actualizacionObligatoriaPendiente(){
    const { obligatoria, releases } = await revisionReleases
    estadoAct.releases = releases
    if(obligatoria){
        mostrarBloqueo()
    }
    return obligatoria
}

/* ---------- Notas: Markdown simple a HTML ---------- */

function escaparAct(t){
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function notasAHtml(md){
    const lineas = md.replace(RE_OBLIGATORIA, '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
    let html = ''
    let enLista = false
    const enLinea = t => escaparAct(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    for(const l of lineas){
        const item = /^\s*[-*]\s+(.*)$/.exec(l)
        if(item){
            if(!enLista){
                html += '<ul>'
                enLista = true
            }
            html += `<li>${enLinea(item[1])}</li>`
            continue
        }
        if(enLista){
            html += '</ul>'
            enLista = false
        }
        const titulo = /^\s*#{1,6}\s+(.*)$/.exec(l)
        if(titulo){
            html += `<h3>${enLinea(titulo[1])}</h3>`
        } else if(l.trim()){
            html += `<p>${enLinea(l.trim())}</p>`
        }
    }
    return enLista ? html + '</ul>' : html
}

/* ---------- Obligatoria ---------- */

const bloqueo = document.getElementById('bloqueoActualizacion')

function mostrarBloqueo(){
    estadoAct.obligatoria = true
    document.body.setAttribute('actualizacionObligatoria', '')
    document.getElementById('toastActualizacion').hidden = true
    document.getElementById('botonActualizar').hidden = true
    bloqueo.hidden = false

    const nueva = estadoAct.releases[0]?.version ?? estadoAct.ultima ?? '?'
    document.getElementById('bloqueoVersion').textContent = tAct('obligatoriaVersion', { actual: versionActual(), nueva })
    const notas = document.getElementById('bloqueoNotas')
    notas.innerHTML = estadoAct.releases.map(r => notasAHtml(r.notas)).join('')
    notas.hidden = notas.innerHTML === ''
    loggerAct.info(`Actualización obligatoria a ${nueva}.`)

    if(process.platform === 'darwin'){
        // En macOS no se descarga sola: el instalador va a mano.
        errorBloqueo(tAct('macManual'))
    } else if(estadoAct.descargada){
        instalarAhora()
    } else {
        estadoBloqueo(tAct('descargando'))
    }
}

function estadoBloqueo(texto){
    document.getElementById('bloqueoEstado').textContent = texto
    document.getElementById('bloqueoError').hidden = true
    document.getElementById('bloqueoBarra').hidden = false
}

function progresoBloqueo(porcentaje){
    const p = Math.max(0, Math.min(100, Math.trunc(porcentaje)))
    document.getElementById('bloqueoProgreso').value = p
    document.getElementById('bloqueoPorcentaje').textContent = `${p}%`
    remote.getCurrentWindow().setProgressBar(p / 100)
}

function errorBloqueo(texto){
    document.getElementById('bloqueoEstado').textContent = texto
    document.getElementById('bloqueoError').hidden = false
    document.getElementById('bloqueoBarra').hidden = process.platform === 'darwin'
    document.getElementById('bloqueoReintentar').hidden = process.platform === 'darwin'
    remote.getCurrentWindow().setProgressBar(-1)
}

function instalarAhora(){
    if(isDev){
        loggerAct.warn('En desarrollo no se instalan actualizaciones.')
        return
    }
    if(estadoAct.obligatoria){
        estadoBloqueo(tAct('instalando'))
        progresoBloqueo(100)
    }
    ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
}

document.getElementById('bloqueoReintentar').addEventListener('click', () => {
    estadoBloqueo(tAct('descargando'))
    progresoBloqueo(0)
    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
})
document.getElementById('bloqueoDescargar').href = URL_INSTALADOR

/* ---------- Opcional ---------- */

const botonActualizar = document.getElementById('botonActualizar')
const toastActualizacion = document.getElementById('toastActualizacion')

function pintarAvisoOpcional(porcentaje){
    if(estadoAct.obligatoria){
        return
    }
    botonActualizar.hidden = false
    botonActualizar.toggleAttribute('lista', estadoAct.descargada)
    botonActualizar.title = tAct('opcionalTitulo', { version: estadoAct.ultima })
    document.getElementById('botonActualizarTexto').textContent = estadoAct.descargada
        ? tAct('reiniciar')
        : (porcentaje != null ? tAct('bajandoPorcentaje', { porcentaje: Math.trunc(porcentaje) }) : tAct('disponible'))
}

function mostrarToastUnaVez(){
    const clave = 'potatox.toastActualizacion'
    try {
        if(localStorage.getItem(clave) === estadoAct.ultima){
            return
        }
        localStorage.setItem(clave, estadoAct.ultima)
    } catch(_err) {
        // Sin localStorage se muestra igual.
    }
    document.getElementById('toastActualizacionTexto').textContent = tAct('toast', { version: estadoAct.ultima })
    toastActualizacion.hidden = false
    setTimeout(() => {
        toastActualizacion.hidden = true
    }, 15000)
}

botonActualizar.addEventListener('click', () => {
    if(estadoAct.descargada){
        instalarAhora()
    }
})
toastActualizacion.querySelector('[data-accion="reiniciar"]').addEventListener('click', () => instalarAhora())
toastActualizacion.querySelector('[data-accion="cerrar"]').addEventListener('click', () => {
    toastActualizacion.hidden = true
})

/* ---------- Eventos de electron-updater (los reenvía uicore.js) ---------- */

function alEventoActualizacion(evento, info){
    switch(evento){
        case 'update-available':
            estadoAct.ultima = semverAct.valid(info?.version) ?? null
            estadoAct.descargada = false
            if(!estadoAct.obligatoria && estadoAct.ultima != null && semverAct.gt(estadoAct.ultima, versionActual())){
                pintarAvisoOpcional()
            }
            break
        case 'update-not-available':
            if(estadoAct.obligatoria){
                // GitHub dice que hay una obligatoria pero el actualizador no la encuentra.
                errorBloqueo(tAct('errorDescarga'))
            }
            break
        case 'download-progress':
            if(estadoAct.obligatoria){
                progresoBloqueo(info?.percent ?? 0)
            } else if(!estadoAct.descargada && estadoAct.ultima != null){
                pintarAvisoOpcional(info?.percent ?? 0)
            }
            break
        case 'update-downloaded':
            estadoAct.descargada = true
            estadoAct.ultima = estadoAct.ultima ?? semverAct.valid(info?.version) ?? null
            if(estadoAct.obligatoria){
                instalarAhora()
            } else {
                pintarAvisoOpcional()
                mostrarToastUnaVez()
            }
            break
        case 'realerror':
            if(estadoAct.obligatoria && !estadoAct.descargada){
                errorBloqueo(tAct('errorDescarga'))
            }
            break
    }
}
