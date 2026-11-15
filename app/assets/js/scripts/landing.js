/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')
const Instancias              = require('./assets/js/instancias')

// Launch Elements
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    // El progreso es un panel flotante y deshabilita todos los botones JUGAR.
    document.body.toggleAttribute('lanzando', loading)
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

/**
 * Id del servidor o instancia que se está lanzando. La configuración de Java
 * (ejecutable, RAM) se guarda con este id.
 */
let idLanzamiento = null
/** Qué hacer cuando ya hay un Java válido (lo usa asyncSystemScan). */
let alTenerJava = () => dlAsync()

/**
 * Lanza el servidor seleccionado (del distribution.json).
 */
async function lanzarServidor(){
    // Con una actualización obligatoria pendiente no se juega.
    if(document.body.hasAttribute('actualizacionObligatoria')){
        return
    }
    loggerLanding.info('Launching game..')
    try {
        idLanzamiento = ConfigManager.getSelectedServer()
        alTenerJava = () => dlAsync()
        const server = (await DistroAPI.getDistribution()).getServerById(idLanzamiento)
        guardarUltimaSeleccion('servidor', idLanzamiento)
        const jExe = ConfigManager.getJavaExecutable(idLanzamiento)
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
}

/**
 * Lanza una instancia propia (Vanilla, Fabric). Baja lo que falte, busca o baja
 * el Java que pide esa versión de Minecraft y abre el juego.
 *
 * @param {string} id El id de la instancia (local-...).
 */
async function lanzarInstancia(id){
    // Con una actualización obligatoria pendiente no se juega.
    if(document.body.hasAttribute('actualizacionObligatoria')){
        return
    }
    const inst = Instancias.obtener(id)
    if(inst == null){
        return
    }
    if(ConfigManager.getSelectedAccount() == null){
        loggerLanding.error('You must be logged into an account.')
        return
    }
    loggerLanding.info(`Launching local instance ${id}..`)
    idLanzamiento = id
    guardarUltimaSeleccion('instancia', id)

    setLaunchDetails(Lang.queryJS('inicio.lanzar.preparando'))
    toggleLaunchArea(true)
    setLaunchPercentage(0)

    try {
        const loader = Instancias.LOADERS[inst.loader]
        const { modManifest, modulos } = await loader.perfil(inst)
        let serv = Instancias.construirServidor(inst, modulos, 17)

        setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
        let bajando = false
        const { javaMajor } = await Instancias.prepararArchivos(inst, serv, {
            validando: p => setLaunchPercentage(p),
            bajando: p => {
                if(!bajando){
                    bajando = true
                    setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
                }
                setDownloadPercentage(p)
            }
        })
        remote.getCurrentWindow().setProgressBar(-1)

        // Ahora se sabe qué Java pide esta versión de Minecraft.
        serv = Instancias.construirServidor(inst, modulos, javaMajor)
        ConfigManager.ensureJavaConfig(id, serv.effectiveJavaOptions, null)
        ConfigManager.setModConfiguration(id, { id, mods: {} })
        ConfigManager.save()

        const versionData = await new MojangIndexProcessor(ConfigManager.getCommonDirectory(), inst.mc).getVersionJson()
        alTenerJava = () => lanzarProceso(serv, versionData, modManifest, null)

        const jExe = ConfigManager.getJavaExecutable(id)
        const valido = jExe != null && await validateSelectedJvm(ensureJavaDirIsRoot(jExe), serv.effectiveJavaOptions.supported) != null
        if(valido){
            await alTenerJava()
        } else {
            await asyncSystemScan(serv.effectiveJavaOptions)
        }
    } catch(err) {
        loggerLanding.error('Error while launching local instance.', err)
        remote.getCurrentWindow().setProgressBar(-1)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
    }
}

/**
 * Recuerda lo último que se jugó, para "Continuar donde quedaste".
 */
function guardarUltimaSeleccion(tipo, id){
    ConfigManager.setUltimaSeleccion({ tipo, id })
    if(tipo === 'instancia'){
        Instancias.actualizar(id, { ultimaVez: new Date().toISOString() })
    }
    ConfigManager.save()
    if(typeof pintarContinuar === 'function'){
        pintarContinuar()
    }
}

document.getElementById('launch_button').addEventListener('click', () => lanzarServidor())

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null && authUser.displayName != null){
        username = authUser.displayName
    }
    user_text.textContent = username
    refrescarAvatarCuenta()
    if(typeof pintarSaludo === 'function'){
        pintarSaludo()
    }
    // La distribution depende de la cuenta (el admin recibe los servidores de prueba).
    const uuid = authUser?.uuid ?? null
    if(uuid !== uuidDistribution){
        const antes = uuidDistribution
        uuidDistribution = uuid
        if(antes !== undefined){
            refrescarDistroPorCuenta()
        }
    }
}

// undefined hasta la primera cuenta: la carga inicial ya va con la cuenta activa.
let uuidDistribution

/**
 * Vuelve a pedir la distribution con la cuenta nueva. Si el servidor elegido ya
 * no está en la lista (por ejemplo, uno de prueba), se elige el principal.
 */
async function refrescarDistroPorCuenta(){
    try {
        const data = await DistroAPI.refreshDistributionOrFallback()
        if(data == null){
            return
        }
        if(data.getServerById(ConfigManager.getSelectedServer()) == null && data.getMainServer() != null){
            ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
            ConfigManager.save()
        }
        onDistroRefresh(data)
    } catch(err) {
        loggerLanding.warn('No se pudo refrescar la distribution tras cambiar de cuenta.', err)
    }
}

/**
 * Actualiza la cabeza de la cuenta en la barra lateral.
 *
 * @param {number} bust Opcional. Para saltar la caché de mc-heads.net tras cambiar la skin.
 */
function refrescarAvatarCuenta(bust){
    const acc = ConfigManager.getSelectedAccount()
    const img = document.getElementById('cuentaCabeza')
    if(acc?.uuid != null){
        img.src = `https://mc-heads.net/avatar/${acc.uuid}/64${bust ? '?v=' + bust : ''}`
    } else {
        img.src = 'assets/images/potato/icono-64.png'
    }
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}

// Estado de los servicios de Mojang, en tres grupos: login, sesiones y skins.
const GRUPOS_MOJANG = {
    login: ['microsoft-o-auth-server', 'xbox-live-auth-server', 'xbox-live-gatekeeper', 'microsoft-minecraft-api', 'microsoft-minecraft-profile'],
    sesiones: ['mojang-multiplayer-session-service'],
    skins: ['minecraft-skins']
}
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }

    // El peor estado del grupo; gris solo si no se sabe nada.
    const peor = lista => {
        const estados = statuses.filter(s => lista.includes(s.service)).map(s => s.status)
        for(const e of ['red', 'yellow', 'green']){
            if(estados.includes(e)){
                return e
            }
        }
        return 'grey'
    }
    for(const [grupo, servicios] of Object.entries(GRUPOS_MOJANG)){
        const el = document.querySelector(`.mojangItem[data-grupo="${grupo}"]`)
        el.setAttribute('estado', peor(servicios))
        el.title = statuses.filter(s => servicios.includes(s.service))
            .map(s => `${s.name}: ${Lang.queryJS('inicio.mojangEstado.' + s.status)}`).join('\n')
    }
}

refreshMojangStatuses()
// El estado del reino (refreshServerStatus, en reino.js) se refresca en uibinder.js con distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        `<img class="overlayMascota" src="assets/images/potato/mascota-error.png" alt="">${desc}`,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 *
 * If none is found, the required Java is downloaded into the launcher's data
 * directory without asking: it does not install anything system-wide.
 *
 * @param {boolean} launchAfter Whether we should begin to launch after scanning.
 * @param {boolean} allowDownload Whether Java may be downloaded if none is found.
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true, allowDownload = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        if(!allowDownload) {
            // Se descargó, pero no aparece como válido.
            showJavaDownloadFailure(effectiveJavaOptions, launchAfter)
            return
        }
        loggerLanding.info(`No compatible Java found, downloading Java ${effectiveJavaOptions.suggestedMajor}.`)
        try {
            await downloadJava(effectiveJavaOptions)
        } catch(err) {
            loggerLanding.error('Unhandled error in Java Download', err)
            remote.getCurrentWindow().setProgressBar(-1)
            showJavaDownloadFailure(effectiveJavaOptions, launchAfter)
            return
        }
        await asyncSystemScan(effectiveJavaOptions, launchAfter, false)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(idLanzamiento, javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        if(idLanzamiento === ConfigManager.getSelectedServer()){
            settingsJavaExecVal.value = javaExec
            await populateJavaExecDetails(settingsJavaExecVal.value)
        }

        if(launchAfter){
            await alTenerJava()
        }
    }

}

/**
 * Tell the player that Java could not be downloaded, and offer to retry.
 *
 * @param {Object} effectiveJavaOptions The server's Java options.
 * @param {boolean} launchAfter Whether to launch after a successful retry.
 */
function showJavaDownloadFailure(effectiveJavaOptions, launchAfter){
    setOverlayContent(
        Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'),
        Lang.queryJS('landing.systemScan.javaDownloadFailureText', { 'major': effectiveJavaOptions.suggestedMajor }),
        Lang.queryJS('landing.systemScan.javaDownloadRetry'),
        Lang.queryJS('landing.systemScan.javaDownloadCancel')
    )
    setOverlayHandler(() => {
        toggleOverlay(false)
        asyncSystemScan(effectiveJavaOptions, launchAfter)
    })
    setDismissHandler(() => {
        toggleOverlay(false)
        toggleLaunchArea(false)
    })
    toggleOverlay(true, true)
}

async function downloadJava(effectiveJavaOptions) {

    setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))

    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    setLaunchDetails(Lang.queryJS('landing.downloadJava.downloadingJava', { 'major': effectiveJavaOptions.suggestedMajor }))
    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            loggerLanding.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    let newJavaExec
    try {
        newJavaExec = await extractJdk(asset.path)
    } finally {
        clearInterval(extractListener)
        // Extraction complete, remove the loading from the OS progress bar.
        remote.getCurrentWindow().setProgressBar(-1)
    }

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(idLanzamiento, newJavaExec)
    ConfigManager.save()

    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+|Backend library: LWJGL .+)$/
const MIN_LINGER = 5000

/**
 * Genera en el PC del jugador los jars de cliente que Forge busca en libraries/
 * (client srg, slim y extra de Minecraft, y forge client) corriendo el instalador
 * oficial de Forge. Asi el distro no tiene que incluir codigo de Mojang.
 *
 * Solo aplica a servidores con ForgeHosted y Minecraft 1.13 o superior.
 *
 * @param {Object} serv El servidor seleccionado (HeliosServer).
 * @param {Object} modLoaderData El version manifest de Forge.
 */
async function ensureForgeInstalled(serv, modLoaderData) {
    const fs = require('fs-extra')
    const os = require('os')
    const child_process = require('child_process')
    const loggerForge = LoggerUtil.getLogger('ForgeInstaller')

    const forgeModule = serv.modules.find(m => m.rawModule.type === Type.ForgeHosted)
    if(forgeModule == null) {
        return
    }
    const mcVersion = serv.rawServer.minecraftVersion
    const [mcMajor, mcMinor] = mcVersion.split('.').map(Number)
    if(mcMajor < 1 || (mcMajor === 1 && mcMinor < 13)) {
        return
    }

    const displayableError = (message) => {
        const err = new Error(message)
        err.displayable = message
        return err
    }

    const gameArgs = (modLoaderData.arguments && modLoaderData.arguments.game) || []
    const argValue = (name) => {
        const i = gameArgs.indexOf(name)
        return i > -1 ? gameArgs[i + 1] : null
    }
    const mcpVersion = argValue('--fml.mcpVersion')
    const moduleVersion = forgeModule.getMavenComponents().version
    const forgeVersion = moduleVersion.startsWith(`${mcVersion}-`)
        ? moduleVersion.substring(mcVersion.length + 1)
        : argValue('--fml.forgeVersion')
    if(mcpVersion == null || forgeVersion == null) {
        throw displayableError(Lang.queryJS('landing.forge.versionUnknown'))
    }

    const commonDir = ConfigManager.getCommonDirectory()
    const libDir = path.join(commonDir, 'libraries')
    const mcpId = `${mcVersion}-${mcpVersion}`
    const forgeId = `${mcVersion}-${forgeVersion}`
    const requiredFiles = [
        path.join('net', 'minecraft', 'client', mcpId, `client-${mcpId}-srg.jar`),
        path.join('net', 'minecraft', 'client', mcpId, `client-${mcpId}-slim.jar`),
        path.join('net', 'minecraft', 'client', mcpId, `client-${mcpId}-extra.jar`),
        path.join('net', 'minecraftforge', 'forge', forgeId, `forge-${forgeId}-client.jar`)
    ]
    const findMissing = async () => {
        const exists = await Promise.all(requiredFiles.map(f => fs.pathExists(path.join(libDir, f))))
        return requiredFiles.filter((_, i) => !exists[i])
    }

    let missing = await findMissing()
    if(missing.length === 0) {
        loggerForge.info(`Forge ${forgeId} already installed.`)
        return
    }
    loggerForge.info(`Missing Forge files, running installer for ${forgeId}:`, missing)

    setLaunchDetails(Lang.queryJS('landing.forge.preparing'))
    const start = Date.now()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'potatox-forge-'))
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeId}/forge-${forgeId}-installer.jar`
    const installerPath = path.join(tmpDir, `forge-${forgeId}-installer.jar`)

    try {
        try {
            await downloadFile(installerUrl, installerPath)
        } catch(err) {
            loggerForge.error(`Failed to download ${installerUrl}`, err)
            throw displayableError(Lang.queryJS('landing.forge.downloadFailed'))
        }

        // El instalador se niega a correr si no encuentra un perfil del launcher oficial.
        const profilesPath = path.join(commonDir, 'launcher_profiles.json')
        if(!await fs.pathExists(profilesPath)) {
            await fs.writeJson(profilesPath, {})
        }

        // La salida completa (decenas de miles de lineas) va a un archivo; la consola solo muestra stderr
        // y, si falla, las ultimas lineas.
        const logPath = path.join(ConfigManager.getLauncherDirectory(), 'forge-installer.log')
        const logStream = fs.createWriteStream(logPath)
        let tail = []
        const keepTail = (data) => {
            tail = tail.concat(data.split(/\r?\n/).filter(l => l.length > 0)).slice(-40)
        }

        const javaExe = ConfigManager.getJavaExecutable(serv.rawServer.id)
        loggerForge.info(`Running ${javaExe} -jar ${installerPath} --installClient ${commonDir}`)
        loggerForge.info(`Installer output: ${logPath}`)
        const exitCode = await new Promise((resolve, reject) => {
            const child = child_process.spawn(javaExe, ['-jar', installerPath, '--installClient', commonDir], { cwd: tmpDir })
            child.stdout.setEncoding('utf8')
            child.stderr.setEncoding('utf8')
            child.stdout.on('data', data => {
                logStream.write(data)
                keepTail(data)
            })
            child.stderr.on('data', data => {
                logStream.write(data)
                keepTail(data)
                loggerForge.error(data.trim())
            })
            child.on('error', err => {
                loggerForge.error(`Could not run ${javaExe}`, err)
                reject(displayableError(Lang.queryJS('landing.forge.javaFailed')))
            })
            child.on('close', resolve)
        }).finally(() => logStream.end())
        if(exitCode !== 0) {
            loggerForge.error(`Forge installer exited with code ${exitCode}. Last lines:\n${tail.join('\n')}`)
            throw displayableError(Lang.queryJS('landing.forge.installerFailed', { code: exitCode }))
        }
    } finally {
        await fs.remove(tmpDir)
    }

    missing = await findMissing()
    if(missing.length > 0) {
        loggerForge.error('Forge installer finished but files are still missing:', missing)
        throw displayableError(Lang.queryJS('landing.forge.stillMissing', { files: missing.join('<br>') }))
    }
    loggerForge.info(`Forge ${forgeId} installed in ${((Date.now() - start) / 1000).toFixed(1)}s.`)
}

/**
 * La primera vez que se juega un modpack, si la instancia todavía no tiene options.txt
 * y se encuentra un Minecraft del jugador (launcher oficial, CurseForge, Prism...), ofrece
 * traer sus teclas y ajustes desde el más parecido al modpack.
 * Se muestra una sola vez (queda guardado en la config del launcher).
 *
 * @param {Object} serv El servidor seleccionado (HeliosServer).
 */
async function offerMinecraftImport(serv) {
    if(ConfigManager.getMinecraftImportOffered()) {
        return
    }
    const fs = require('fs-extra')
    const MinecraftImport = require('./assets/js/minecraftimport')
    const q = (key, placeHolders) => Lang.queryJS(`settings.minecraftImport.${key}`, placeHolders)

    const target = await getMinecraftImportTarget(serv)
    if(await fs.pathExists(path.join(target.instanceDir, 'options.txt'))) {
        return
    }
    let source
    try {
        source = (await MinecraftImport.detectSources(target)).find(s => s.found.options)
    } catch(err) {
        loggerLanding.warn('Could not look for Minecraft installations.', err)
    }
    if(source == null) {
        return
    }

    ConfigManager.setMinecraftImportOffered(true)
    ConfigManager.save()

    const sourceTitle = importSourceTitle(source)
    let description = q('firstRunDesc', { source: escapeImportHtml(sourceTitle), server: escapeImportHtml(target.name) })
    if(source.dataVersion != null && source.dataVersion > MinecraftImport.TARGET_DATA_VERSION) {
        description += `<br><br>${q('newerVersionNote', { mc: escapeImportHtml(target.mcVersion) })}`
    }

    const accepted = await new Promise(resolve => {
        setOverlayContent(q('firstRunTitle'), description, q('firstRunImport'), q('firstRunLater'))
        setOverlayHandler(() => {
            toggleOverlay(false)
            resolve(true)
        })
        setDismissHandler(() => {
            toggleOverlay(false)
            resolve(false)
        })
        toggleOverlay(true, true)
    })
    setOverlayHandler(null)
    setDismissHandler(null)
    if(!accepted) {
        loggerLanding.info('Minecraft settings import declined.')
        return
    }

    try {
        setLaunchDetails(q('importing'))
        const selection = {}
        for(const item of MinecraftImport.ITEMS) {
            selection[item.key] = item.defaultOn && source.found[item.key]
        }
        const results = await MinecraftImport.importSettings(source.dir, target.instanceDir, selection)
        await new Promise(resolve => {
            setOverlayContent(q('summaryTitle'), buildMinecraftImportSummary(results, sourceTitle, target.name), q('continueButton'))
            setOverlayHandler(() => {
                toggleOverlay(false)
                resolve()
            })
            toggleOverlay(true)
        })
        setOverlayHandler(null)
    } catch(err) {
        // Si falla la importación, el juego igual se lanza con los ajustes por defecto.
        loggerLanding.error('Error while importing Minecraft settings.', err)
    }
    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))
}

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    try {
        await ensureForgeInstalled(serv, modLoaderData)
    } catch(err) {
        loggerLaunchSuite.error('Error while preparing Forge.', err)
        showLaunchFailure(Lang.queryJS('landing.forge.failureTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    if(login) {
        await offerMinecraftImport(serv)
        await lanzarProceso(serv, versionData, modLoaderData, distro)
    }
}

/**
 * Abre Minecraft con los datos ya preparados. Sirve para servidores y para
 * instancias propias (distro null: sin Discord).
 */
async function lanzarProceso(serv, versionData, modLoaderData, distro){
    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))
    {
        // El token de Minecraft dura 24 h y antes solo se refrescaba al abrir el launcher.
        if(!await validateSelectedAccount()) {
            toggleLaunchArea(false)
            return
        }

        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro != null && distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}
