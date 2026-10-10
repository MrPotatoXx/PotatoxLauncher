// Requirements
const os     = require('os')
const semver = require('semver')

const DropinModUtil  = require('./assets/js/dropinmodutil')
const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')

const settingsState = {
    invalid: new Set()
}

function bindSettingsSelect(){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]

        selectedDiv.onclick = (e) => {
            e.stopPropagation()
            closeSettingsSelect(e.target)
            e.target.nextElementSibling.toggleAttribute('hidden')
            e.target.classList.toggle('select-arrow-active')
        }
    }
}

function closeSettingsSelect(el){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]
        const optionsDiv = ele.getElementsByClassName('settingsSelectOptions')[0]

        if(!(selectedDiv === el)) {
            selectedDiv.classList.remove('select-arrow-active')
            optionsDiv.setAttribute('hidden', '')
        }
    }
}

/* If the user clicks anywhere outside the select box,
then close all select boxes: */
document.addEventListener('click', closeSettingsSelect)

bindSettingsSelect()


function bindFileSelectors(){
    for(let ele of document.getElementsByClassName('settingsFileSelButton')){
        
        ele.onclick = async e => {
            const isJavaExecSel = ele.id === 'settingsJavaExecSel'
            const directoryDialog = ele.hasAttribute('dialogDirectory') && ele.getAttribute('dialogDirectory') == 'true'
            const properties = directoryDialog ? ['openDirectory', 'createDirectory'] : ['openFile']

            const options = {
                properties
            }

            if(ele.hasAttribute('dialogTitle')) {
                options.title = ele.getAttribute('dialogTitle')
            }

            if(isJavaExecSel && process.platform === 'win32') {
                options.filters = [
                    { name: Lang.queryJS('settings.fileSelectors.executables'), extensions: ['exe'] },
                    { name: Lang.queryJS('settings.fileSelectors.allFiles'), extensions: ['*'] }
                ]
            }

            const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), options)
            if(!res.canceled) {
                ele.previousElementSibling.value = res.filePaths[0]
                if(isJavaExecSel) {
                    await populateJavaExecDetails(ele.previousElementSibling.value)
                }
            }
        }
    }
}

bindFileSelectors()


/**
 * General Settings Functions
 */

/**
  * Bind value validators to the settings UI elements. These will
  * validate against the criteria defined in the ConfigManager (if
  * any). If the value is invalid, the UI will reflect this and saving
  * will be disabled until the value is corrected. This is an automated
  * process. More complex UI may need to be bound separately.
  */
function initSettingsValidators(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const vFn = ConfigManager['validate' + v.getAttribute('cValue')]
        if(typeof vFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    v.addEventListener('keyup', (e) => {
                        const v = e.target
                        if(!vFn(v.value)){
                            settingsState.invalid.add(v.id)
                            v.setAttribute('error', '')
                            settingsSaveDisabled(true)
                        } else {
                            if(v.hasAttribute('error')){
                                v.removeAttribute('error')
                                settingsState.invalid.delete(v.id)
                                if(settingsState.invalid.size === 0){
                                    settingsSaveDisabled(false)
                                }
                            }
                        }
                    })
                }
            }
        }

    })
}

/**
 * Load configuration values onto the UI. This is an automated process.
 */
async function initSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')

    for(const v of sEls) {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const gFn = ConfigManager['get' + cVal]
        const gFnOpts = []
        if(serverDependent) {
            gFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof gFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    // Special Conditions
                    if(cVal === 'JavaExecutable'){
                        v.value = gFn.apply(null, gFnOpts)
                        await populateJavaExecDetails(v.value)
                    } else if (cVal === 'DataDirectory'){
                        v.value = gFn.apply(null, gFnOpts)
                    } else if(cVal === 'JVMOptions'){
                        v.value = gFn.apply(null, gFnOpts).join(' ')
                    } else {
                        v.value = gFn.apply(null, gFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    v.checked = gFn.apply(null, gFnOpts)
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    // Special Conditions
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = gFn.apply(null, gFnOpts)
                        if(val.endsWith('M')){
                            val = Number(val.substring(0, val.length-1))/1024
                        } else {
                            val = Number.parseFloat(val)
                        }

                        v.setAttribute('value', val)
                    } else {
                        v.setAttribute('value', Number.parseFloat(gFn.apply(null, gFnOpts)))
                    }
                }
            }
        }
    }

}

/**
 * Save the settings values.
 */
function saveSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const sFn = ConfigManager['set' + cVal]
        const sFnOpts = []
        if(serverDependent) {
            sFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof sFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    // Special Conditions
                    if(cVal === 'JVMOptions'){
                        if(!v.value.trim()) {
                            sFnOpts.push([])
                            sFn.apply(null, sFnOpts)
                        } else {
                            sFnOpts.push(v.value.trim().split(/\s+/))
                            sFn.apply(null, sFnOpts)
                        }
                    } else {
                        sFnOpts.push(v.value)
                        sFn.apply(null, sFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    sFnOpts.push(v.checked)
                    sFn.apply(null, sFnOpts)
                    // Special Conditions
                    if(cVal === 'AllowPrerelease'){
                        changeAllowPrerelease(v.checked)
                    }
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    // Special Conditions
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = Number(v.getAttribute('value'))
                        if(val%1 > 0){
                            val = val*1024 + 'M'
                        } else {
                            val = val + 'G'
                        }

                        sFnOpts.push(val)
                        sFn.apply(null, sFnOpts)
                    } else {
                        sFnOpts.push(v.getAttribute('value'))
                        sFn.apply(null, sFnOpts)
                    }
                }
            }
        }
    })
}

let selectedSettingsTab = 'settingsTabAccount'

/**
 * Modify the settings container UI when the scroll threshold reaches
 * a certain poin.
 * 
 * @param {UIEvent} e The scroll event.
 */
function settingsTabScrollListener(e){
    if(e.target.scrollTop > Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)){
        document.getElementById('settingsContainer').setAttribute('scrolled', '')
    } else {
        document.getElementById('settingsContainer').removeAttribute('scrolled')
    }
}

/**
 * Bind functionality for the settings navigation items.
 */
function setupSettingsTabs(){
    Array.from(document.getElementsByClassName('settingsNavItem')).map((val) => {
        if(val.hasAttribute('rSc')){
            val.onclick = () => {
                settingsNavItemListener(val)
            }
        }
    })
}

/**
 * Settings nav item onclick lisener. Function is exposed so that
 * other UI elements can quickly toggle to a certain tab from other views.
 * 
 * @param {Element} ele The nav item which has been clicked.
 * @param {boolean} fade Optional. True to fade transition.
 */
function settingsNavItemListener(ele, fade = true){
    if(ele.hasAttribute('selected')){
        return
    }
    const navItems = document.getElementsByClassName('settingsNavItem')
    for(let i=0; i<navItems.length; i++){
        if(navItems[i].hasAttribute('selected')){
            navItems[i].removeAttribute('selected')
        }
    }
    ele.setAttribute('selected', '')
    let prevTab = selectedSettingsTab
    selectedSettingsTab = ele.getAttribute('rSc')

    setSkinViewerVisible(selectedSettingsTab === 'settingsTabSkin')
    if(selectedSettingsTab === 'settingsTabSkin'){
        prepareSkinTab()
    }

    document.getElementById(prevTab).onscroll = null
    document.getElementById(selectedSettingsTab).onscroll = settingsTabScrollListener

    if(fade){
        $(`#${prevTab}`).fadeOut(250, () => {
            $(`#${selectedSettingsTab}`).fadeIn({
                duration: 250,
                start: () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                }
            })
        })
    } else {
        $(`#${prevTab}`).hide(0, () => {
            $(`#${selectedSettingsTab}`).show({
                duration: 0,
                start: () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                }
            })
        })
    }
}

const settingsNavDone = document.getElementById('settingsNavDone')

/**
 * Set if the settings save (done) button is disabled.
 * 
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v){
    settingsNavDone.disabled = v
}

function fullSettingsSave() {
    saveSettingsValues()
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
    saveShaderpackSettings()
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
    setSkinViewerVisible(false)
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')
const msftLogoutLogger = LoggerUtil.getLogger('Microsoft Logout')

// Bind the add mojang account button.
document.getElementById('settingsAddMojangAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnCancel = VIEWS.settings
        loginViewOnSuccess = VIEWS.settings
        loginCancelEnabled(true)
    })
}

// Bind the add microsoft account button.
document.getElementById('settingsAddMicrosoftAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings)
    })
}

// Bind reply for Microsoft Login.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {

        const viewOnClose = arguments_[2]
        console.log(arguments_)
        switchView(getCurrentView(), viewOnClose, 500, 500, () => {

            if(arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLoginLogger.info('Login cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogin.errorTitle'),
                Lang.queryJS('settings.msftLogin.errorMessage'),
                Lang.queryJS('settings.msftLogin.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]

        // Error from request to Microsoft.
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                // TODO Dont know what these errors are. Just show them I guess.
                // This is probably if you messed up the app registration with Azure.      
                let error = queryMap.error // Error might be 'access_denied' ?
                let errorDesc = queryMap.error_description
                console.log('Error getting authCode, is Azure application registered correctly?')
                console.log(error)
                console.log(errorDesc)
                console.log('Full query map: ', queryMap)
                setOverlayContent(
                    error,
                    errorDesc,
                    Lang.queryJS('settings.msftLogin.okButton')
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true)

            })
        } else {

            msftLoginLogger.info('Acquired authCode, proceeding with authentication.')

            const authCode = queryMap.code
            AuthManager.addMicrosoftAccount(authCode).then(value => {
                updateSelectedAccount(value)
                switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
                    await prepareSettings()
                })
            })
                .catch((displayableError) => {

                    let actualDisplayableError
                    if(isDisplayableError(displayableError)) {
                        msftLoginLogger.error('Error while logging in.', displayableError)
                        actualDisplayableError = displayableError
                    } else {
                        // Uh oh.
                        msftLoginLogger.error('Unhandled error during login.', displayableError)
                        actualDisplayableError = Lang.queryJS('login.error.unknown')
                    }

                    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
                        setOverlayHandler(() => {
                            toggleOverlay(false)
                        })
                        toggleOverlay(true)
                    })
                })
        }
    }
})

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect(){
    Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).map((val) => {
        val.onclick = (e) => {
            if(val.hasAttribute('selected')){
                return
            }
            const selectBtns = document.getElementsByClassName('settingsAuthAccountSelect')
            for(let i=0; i<selectBtns.length; i++){
                if(selectBtns[i].hasAttribute('selected')){
                    selectBtns[i].removeAttribute('selected')
                    selectBtns[i].innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
                }
            }
            val.setAttribute('selected', '')
            val.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
            setSelectedAccount(val.closest('.settingsAuthAccount').getAttribute('uuid'))
        }
    })
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut(){
    Array.from(document.getElementsByClassName('settingsAuthAccountLogOut')).map((val) => {
        val.onclick = (e) => {
            let isLastAccount = false
            if(Object.keys(ConfigManager.getAuthAccounts()).length === 1){
                isLastAccount = true
                setOverlayContent(
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningTitle'),
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningMessage'),
                    Lang.queryJS('settings.authAccountLogout.confirmButton'),
                    Lang.queryJS('settings.authAccountLogout.cancelButton')
                )
                setOverlayHandler(() => {
                    processLogOut(val, isLastAccount)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true, true)
            } else {
                processLogOut(val, isLastAccount)
            }
            
        }
    })
}

let msAccDomElementCache
/**
 * Process a log out.
 * 
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
function processLogOut(val, isLastAccount){
    const parent = val.closest('.settingsAuthAccount')
    const uuid = parent.getAttribute('uuid')
    const prevSelAcc = ConfigManager.getSelectedAccount()
    const targetAcc = ConfigManager.getAuthAccount(uuid)
    if(targetAcc.type === 'microsoft') {
        msAccDomElementCache = parent
        switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
            ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount)
        })
    } else {
        AuthManager.removeMojangAccount(uuid).then(() => {
            if(!isLastAccount && uuid === prevSelAcc.uuid){
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if(isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.settings
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
        })
        $(parent).fadeOut(250, () => {
            parent.remove()
        })
    }
}

// Bind reply for Microsoft Logout.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {

            if(arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLogoutLogger.info('Logout cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogout.errorTitle'),
                Lang.queryJS('settings.msftLogout.errorMessage'),
                Lang.queryJS('settings.msftLogout.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        
        const uuid = arguments_[1]
        const isLastAccount = arguments_[2]
        const prevSelAcc = ConfigManager.getSelectedAccount()

        msftLogoutLogger.info('Logout Successful. uuid:', uuid)
        
        AuthManager.removeMicrosoftAccount(uuid)
            .then(() => {
                if(!isLastAccount && uuid === prevSelAcc.uuid){
                    const selAcc = ConfigManager.getSelectedAccount()
                    refreshAuthAccountSelected(selAcc.uuid)
                    updateSelectedAccount(selAcc)
                    validateSelectedAccount()
                }
                if(isLastAccount) {
                    loginOptionsCancelEnabled(false)
                    loginOptionsViewOnLoginSuccess = VIEWS.settings
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions)
                }
                if(msAccDomElementCache) {
                    msAccDomElementCache.remove()
                    msAccDomElementCache = null
                }
            })
            .finally(() => {
                if(!isLastAccount) {
                    switchView(getCurrentView(), VIEWS.settings, 500, 500)
                }
            })

    }
})

/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 * 
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid){
    Array.from(document.getElementsByClassName('settingsAuthAccount')).map((val) => {
        const selBtn = val.getElementsByClassName('settingsAuthAccountSelect')[0]
        if(uuid === val.getAttribute('uuid')){
            selBtn.setAttribute('selected', '')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
        } else {
            if(selBtn.hasAttribute('selected')){
                selBtn.removeAttribute('selected')
            }
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
        }
    })
}

const settingsCurrentMicrosoftAccounts = document.getElementById('settingsCurrentMicrosoftAccounts')
const settingsCurrentMojangAccounts = document.getElementById('settingsCurrentMojangAccounts')

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts(){
    const authAccounts = ConfigManager.getAuthAccounts()
    const authKeys = Object.keys(authAccounts)
    if(authKeys.length === 0){
        return
    }
    const selectedUUID = ConfigManager.getSelectedAccount().uuid

    let microsoftAuthAccountStr = ''
    let mojangAuthAccountStr = ''

    authKeys.forEach((val) => {
        const acc = authAccounts[val]

        const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <div class="settingsAuthAccountLeft">
                <img class="settingsAuthAccountImage" alt="${acc.displayName}" src="https://mc-heads.net/body/${acc.uuid}/60">
            </div>
            <div class="settingsAuthAccountRight">
                <div class="settingsAuthAccountDetails">
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.username')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.displayName}</div>
                    </div>
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.uuid')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.uuid}</div>
                    </div>
                </div>
                <div class="settingsAuthAccountActions">
                    <button class="settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? 'selected>' + Lang.queryJS('settings.authAccountPopulate.selectedAccount') : '>' + Lang.queryJS('settings.authAccountPopulate.selectAccount')}</button>
                    <div class="settingsAuthAccountWrapper">
                        <button class="settingsAuthAccountLogOut">${Lang.queryJS('settings.authAccountPopulate.logout')}</button>
                    </div>
                </div>
            </div>
        </div>`

        if(acc.type === 'microsoft') {
            microsoftAuthAccountStr += accHtml
        } else {
            mojangAuthAccountStr += accHtml
        }

    })

    settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr
    settingsCurrentMojangAccounts.innerHTML = mojangAuthAccountStr
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
    populateAuthAccounts()
    bindAuthAccountSelect()
    bindAuthAccountLogOut()
}

/**
 * Minecraft Tab
 */

/**
  * Disable decimals, negative signs, and scientific notation.
  */
document.getElementById('settingsGameWidth').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})
document.getElementById('settingsGameHeight').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})

/**
 * Mods Tab
 */

const settingsModsContainer = document.getElementById('settingsModsContainer')

/**
 * Resolve and update the mods on the UI.
 */
async function resolveModsForUI(){
    const serv = ConfigManager.getSelectedServer()

    const distro = await DistroAPI.getDistribution()
    const servConf = ConfigManager.getModConfiguration(serv)

    const modStr = parseModulesForUI(distro.getServerById(serv).modules, false, servConf.mods)

    document.getElementById('settingsReqModsContent').innerHTML = modStr.reqMods
    document.getElementById('settingsOptModsContent').innerHTML = modStr.optMods
}

/**
 * Recursively build the mod UI elements.
 * 
 * @param {Object[]} mdls An array of modules to parse.
 * @param {boolean} submodules Whether or not we are parsing submodules.
 * @param {Object} servConf The server configuration object for this module level.
 */
function parseModulesForUI(mdls, submodules, servConf){

    let reqMods = ''
    let optMods = ''

    for(const mdl of mdls){

        if(mdl.rawModule.type === Type.ForgeMod || mdl.rawModule.type === Type.LiteMod || mdl.rawModule.type === Type.LiteLoader || mdl.rawModule.type === Type.FabricMod){

            if(mdl.getRequired().value){

                reqMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" enabled>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch" reqmod>
                            <input type="checkbox" checked>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, servConf[mdl.getVersionlessMavenIdentifier()])).join('')}
                    </div>` : ''}
                </div>`

            } else {

                const conf = servConf[mdl.getVersionlessMavenIdentifier()]
                const val = typeof conf === 'object' ? conf.value : conf

                optMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" ${val ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${mdl.getVersionlessMavenIdentifier()}" ${val ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, conf.mods)).join('')}
                    </div>` : ''}
                </div>`

            }
        }
    }

    return {
        reqMods,
        optMods
    }

}

/**
 * Bind functionality to mod config toggle switches. Switching the value
 * will also switch the status color on the left of the mod UI.
 */
function bindModsToggleSwitch(){
    const sEls = settingsModsContainer.querySelectorAll('[formod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onchange = () => {
            if(v.checked) {
                document.getElementById(v.getAttribute('formod')).setAttribute('enabled', '')
            } else {
                document.getElementById(v.getAttribute('formod')).removeAttribute('enabled')
            }
        }
    })
}


/**
 * Save the mod configuration based on the UI values.
 */
function saveModConfiguration(){
    const serv = ConfigManager.getSelectedServer()
    const modConf = ConfigManager.getModConfiguration(serv)
    modConf.mods = _saveModConfiguration(modConf.mods)
    ConfigManager.setModConfiguration(serv, modConf)
}

/**
 * Recursively save mod config with submods.
 * 
 * @param {Object} modConf Mod config object to save.
 */
function _saveModConfiguration(modConf){
    for(let m of Object.entries(modConf)){
        const tSwitch = settingsModsContainer.querySelectorAll(`[formod='${m[0]}']`)
        if(!tSwitch[0].hasAttribute('dropin')){
            if(typeof m[1] === 'boolean'){
                modConf[m[0]] = tSwitch[0].checked
            } else {
                if(m[1] != null){
                    if(tSwitch.length > 0){
                        modConf[m[0]].value = tSwitch[0].checked
                    }
                    modConf[m[0]].mods = _saveModConfiguration(modConf[m[0]].mods)
                }
            }
        }
    }
    return modConf
}

// Drop-in mod elements.

let CACHE_SETTINGS_MODS_DIR
let CACHE_DROPIN_MODS

/**
 * Resolve any located drop-in mods for this server and
 * populate the results onto the UI.
 */
async function resolveDropinModsForUI(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_MODS_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
    CACHE_DROPIN_MODS = DropinModUtil.scanForDropinMods(CACHE_SETTINGS_MODS_DIR, serv.rawServer.minecraftVersion)

    let dropinMods = ''

    for(dropin of CACHE_DROPIN_MODS){
        dropinMods += `<div id="${dropin.fullName}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${dropin.name}</span>
                                <div class="settingsDropinRemoveWrapper">
                                    <button class="settingsDropinRemoveButton" remmod="${dropin.fullName}">${Lang.queryJS('settings.dropinMods.removeButton')}</button>
                                </div>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${dropin.fullName}" dropin ${!dropin.disabled ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`
    }

    document.getElementById('settingsDropinModsContent').innerHTML = dropinMods
}

/**
 * Bind the remove button for each loaded drop-in mod.
 */
function bindDropinModsRemoveButton(){
    const sEls = settingsModsContainer.querySelectorAll('[remmod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onclick = async () => {
            const fullName = v.getAttribute('remmod')
            const res = await DropinModUtil.deleteDropinMod(CACHE_SETTINGS_MODS_DIR, fullName)
            if(res){
                document.getElementById(fullName).remove()
            } else {
                setOverlayContent(
                    Lang.queryJS('settings.dropinMods.deleteFailedTitle', { fullName }),
                    Lang.queryJS('settings.dropinMods.deleteFailedMessage'),
                    Lang.queryJS('settings.dropinMods.okButton')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        }
    })
}

/**
 * Bind functionality to the file system button for the selected
 * server configuration.
 */
function bindDropinModFileSystemButton(){
    const fsBtn = document.getElementById('settingsDropinFileSystemButton')
    fsBtn.onclick = () => {
        DropinModUtil.validateDir(CACHE_SETTINGS_MODS_DIR)
        shell.openPath(CACHE_SETTINGS_MODS_DIR)
    }
    fsBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        fsBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    fsBtn.ondragover = e => {
        e.preventDefault()
    }
    fsBtn.ondragleave = e => {
        fsBtn.removeAttribute('drag')
    }

    fsBtn.ondrop = async e => {
        fsBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addDropinMods(e.dataTransfer.files, CACHE_SETTINGS_MODS_DIR)
        await reloadDropinMods()
    }
}

/**
 * Save drop-in mod states. Enabling and disabling is just a matter
 * of adding/removing the .disabled extension.
 */
function saveDropinModConfiguration(){
    for(dropin of CACHE_DROPIN_MODS){
        const dropinUI = document.getElementById(dropin.fullName)
        if(dropinUI != null){
            const dropinUIEnabled = dropinUI.hasAttribute('enabled')
            if(DropinModUtil.isDropinModEnabled(dropin.fullName) != dropinUIEnabled){
                DropinModUtil.toggleDropinMod(CACHE_SETTINGS_MODS_DIR, dropin.fullName, dropinUIEnabled).catch(err => {
                    if(!isOverlayVisible()){
                        setOverlayContent(
                            Lang.queryJS('settings.dropinMods.failedToggleTitle'),
                            err.message,
                            Lang.queryJS('settings.dropinMods.okButton')
                        )
                        setOverlayHandler(null)
                        toggleOverlay(true)
                    }
                })
            }
        }
    }
}

// Refresh the drop-in mods when F5 is pressed.
// Only active on the mods tab.
document.addEventListener('keydown', async (e) => {
    if(getCurrentView() === VIEWS.settings && selectedSettingsTab === 'settingsTabMods'){
        if(e.key === 'F5'){
            await reloadDropinMods()
            saveShaderpackSettings()
            await resolveShaderpacksForUI()
        }
    }
})

async function reloadDropinMods(){
    await resolveDropinModsForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindModsToggleSwitch()
}

// Shaderpack

let CACHE_SETTINGS_INSTANCE_DIR
let CACHE_SHADERPACKS
let CACHE_SELECTED_SHADERPACK

/**
 * Load shaderpack information.
 */
async function resolveShaderpacksForUI(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
    CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(CACHE_SETTINGS_INSTANCE_DIR)
    CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR)

    setShadersOptions(CACHE_SHADERPACKS, CACHE_SELECTED_SHADERPACK)
}

function setShadersOptions(arr, selected){
    const cont = document.getElementById('settingsShadersOptions')
    cont.innerHTML = ''
    for(let opt of arr) {
        const d = document.createElement('DIV')
        d.innerHTML = opt.name
        d.setAttribute('value', opt.fullName)
        if(opt.fullName === selected) {
            d.setAttribute('selected', '')
            document.getElementById('settingsShadersSelected').innerHTML = opt.name
        }
        d.addEventListener('click', function(e) {
            this.parentNode.previousElementSibling.innerHTML = this.innerHTML
            for(let sib of this.parentNode.children){
                sib.removeAttribute('selected')
            }
            this.setAttribute('selected', '')
            closeSettingsSelect()
        })
        cont.appendChild(d)
    }
}

function saveShaderpackSettings(){
    let sel = 'OFF'
    for(let opt of document.getElementById('settingsShadersOptions').childNodes){
        if(opt.hasAttribute('selected')){
            sel = opt.getAttribute('value')
        }
    }
    DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel)
}

function bindShaderpackButton() {
    const spBtn = document.getElementById('settingsShaderpackButton')
    spBtn.onclick = () => {
        const p = path.join(CACHE_SETTINGS_INSTANCE_DIR, 'shaderpacks')
        DropinModUtil.validateDir(p)
        shell.openPath(p)
    }
    spBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        spBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    spBtn.ondragover = e => {
        e.preventDefault()
    }
    spBtn.ondragleave = e => {
        spBtn.removeAttribute('drag')
    }

    spBtn.ondrop = async e => {
        spBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addShaderpacks(e.dataTransfer.files, CACHE_SETTINGS_INSTANCE_DIR)
        saveShaderpackSettings()
        await resolveShaderpacksForUI()
    }
}

// Server status bar functions.

/**
 * Load the currently selected server information onto the mods tab.
 */
async function loadSelectedServerOnModsTab(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    for(const el of document.getElementsByClassName('settingsSelServContent')) {
        el.innerHTML = `
            <img class="serverListingImg" src="${serv.rawServer.icon}"/>
            <div class="serverListingDetails">
                <span class="serverListingName">${serv.rawServer.name}</span>
                <span class="serverListingDescription">${serv.rawServer.description}</span>
                <div class="serverListingInfo">
                    <div class="serverListingVersion">${serv.rawServer.minecraftVersion}</div>
                    <div class="serverListingRevision">${serv.rawServer.version}</div>
                    ${serv.rawServer.mainServer ? `<div class="serverListingStarWrapper">
                        <svg id="Layer_1" viewBox="0 0 107.45 104.74" width="20px" height="20px">
                            <defs>
                                <style>.cls-1{fill:#fff;}.cls-2{fill:none;stroke:#fff;stroke-miterlimit:10;}</style>
                            </defs>
                            <path class="cls-1" d="M100.93,65.54C89,62,68.18,55.65,63.54,52.13c2.7-5.23,18.8-19.2,28-27.55C81.36,31.74,63.74,43.87,58.09,45.3c-2.41-5.37-3.61-26.52-4.37-39-.77,12.46-2,33.64-4.36,39-5.7-1.46-23.3-13.57-33.49-20.72,9.26,8.37,25.39,22.36,28,27.55C39.21,55.68,18.47,62,6.52,65.55c12.32-2,33.63-6.06,39.34-4.9-.16,5.87-8.41,26.16-13.11,37.69,6.1-10.89,16.52-30.16,21-33.9,4.5,3.79,14.93,23.09,21,34C70,86.84,61.73,66.48,61.59,60.65,67.36,59.49,88.64,63.52,100.93,65.54Z"/>
                            <circle class="cls-2" cx="53.73" cy="53.9" r="38"/>
                        </svg>
                        <span class="serverListingStarTooltip">${Lang.queryJS('settings.serverListing.mainServer')}</span>
                    </div>` : ''}
                </div>
            </div>
        `
    }
}

// Bind functionality to the server switch button.
Array.from(document.getElementsByClassName('settingsSwitchServerButton')).forEach(el => {
    el.addEventListener('click', async e => {
        e.target.blur()
        await toggleServerSelection(true)
    })
})

/**
 * Save mod configuration for the current selected server.
 */
function saveAllModConfigurations(){
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
}

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
function animateSettingsTabRefresh(){
    $(`#${selectedSettingsTab}`).fadeOut(500, async () => {
        await prepareSettings()
        $(`#${selectedSettingsTab}`).fadeIn(500)
    })
}

/**
 * Prepare the Mods tab for display.
 */
async function prepareModsTab(first){
    await resolveModsForUI()
    await resolveDropinModsForUI()
    await resolveShaderpacksForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindShaderpackButton()
    bindModsToggleSwitch()
    await loadSelectedServerOnModsTab()
}

/**
 * Java Tab
 */

// DOM Cache
const settingsMaxRAMRange     = document.getElementById('settingsMaxRAMRange')
const settingsMinRAMRange     = document.getElementById('settingsMinRAMRange')
const settingsMaxRAMLabel     = document.getElementById('settingsMaxRAMLabel')
const settingsMinRAMLabel     = document.getElementById('settingsMinRAMLabel')
const settingsMemoryTotal     = document.getElementById('settingsMemoryTotal')
const settingsMemoryAvail     = document.getElementById('settingsMemoryAvail')
const settingsJavaExecDetails = document.getElementById('settingsJavaExecDetails')
const settingsJavaReqDesc     = document.getElementById('settingsJavaReqDesc')
const settingsJvmOptsLink     = document.getElementById('settingsJvmOptsLink')

// Bind on change event for min memory container.
settingsMinRAMRange.onchange = (e) => {

    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMinV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMinV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Increase maximum memory if the minimum exceeds its value.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMaxRAMRange, sMinV,
            ((sMinV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMaxRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
    }

    // Update label
    settingsMinRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
}

// Bind on change event for max memory container.
settingsMaxRAMRange.onchange = (e) => {
    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMaxV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMaxV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Decrease the minimum memory if the maximum value is less.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMinRAMRange, sMaxV,
            ((sMaxV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
    }
    settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
}

/**
 * Calculate common values for a ranged slider.
 * 
 * @param {Element} v The range slider to calculate against. 
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v){
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max-val.min)/val.step
    val.inc = 100/val.ticks
    return val
}

/**
 * Binds functionality to the ranged sliders. They're more than
 * just divs now :').
 */
function bindRangeSlider(){
    Array.from(document.getElementsByClassName('rangeSlider')).map((v) => {

        // Reference the track (thumb).
        const track = v.getElementsByClassName('rangeSliderTrack')[0]

        // Set the initial slider value.
        const value = v.getAttribute('value')
        const sliderMeta = calculateRangeSliderMeta(v)

        updateRangedSlider(v, value, ((value-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)

        // The magic happens when we click on the track.
        track.onmousedown = (e) => {

            // Stop moving the track on mouse up.
            document.onmouseup = (e) => {
                document.onmousemove = null
                document.onmouseup = null
            }

            // Move slider according to the mouse position.
            document.onmousemove = (e) => {

                // Distance from the beginning of the bar in pixels.
                const diff = e.pageX - v.offsetLeft - track.offsetWidth/2
                
                // Don't move the track off the bar.
                if(diff >= 0 && diff <= v.offsetWidth-track.offsetWidth/2){

                    // Convert the difference to a percentage.
                    const perc = (diff/v.offsetWidth)*100
                    // Calculate the percentage of the closest notch.
                    const notch = Number(perc/sliderMeta.inc).toFixed(0)*sliderMeta.inc

                    // If we're close to that notch, stick to it.
                    if(Math.abs(perc-notch) < sliderMeta.inc/2){
                        updateRangedSlider(v, sliderMeta.min+(sliderMeta.step*(notch/sliderMeta.inc)), notch)
                    }
                }
            }
        }
    }) 
}

/**
 * Update a ranged slider's value and position.
 * 
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch){
    const oldVal = element.getAttribute('value')
    const bar = element.getElementsByClassName('rangeSliderBar')[0]
    const track = element.getElementsByClassName('rangeSliderTrack')[0]
    
    element.setAttribute('value', value)

    if(notch < 0){
        notch = 0
    } else if(notch > 100) {
        notch = 100
    }

    const event = new MouseEvent('change', {
        target: element,
        type: 'change',
        bubbles: false,
        cancelable: true
    })

    let cancelled = !element.dispatchEvent(event)

    if(!cancelled){
        track.style.left = notch + '%'
        bar.style.width = notch + '%'
    } else {
        element.setAttribute('value', oldVal)
    }
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus(){
    settingsMemoryTotal.innerHTML = Number((os.totalmem()-1073741824)/1073741824).toFixed(1) + 'G'
    settingsMemoryAvail.innerHTML = Number(os.freemem()/1073741824).toFixed(1) + 'G'
}

/**
 * Validate the provided executable path and display the data on
 * the UI.
 * 
 * @param {string} execPath The executable path to populate against.
 */
async function populateJavaExecDetails(execPath){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    const details = await validateSelectedJvm(ensureJavaDirIsRoot(execPath), server.effectiveJavaOptions.supported)

    if(details != null) {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.selectedJava', { version: details.semverStr, vendor: details.vendor })
    } else {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
    }
}

function populateJavaReqDesc(server) {
    settingsJavaReqDesc.innerHTML = Lang.queryJS('settings.java.requiresJava', { major: server.effectiveJavaOptions.suggestedMajor })
}

function populateJvmOptsLink(server) {
    const major = server.effectiveJavaOptions.suggestedMajor
    settingsJvmOptsLink.innerHTML = Lang.queryJS('settings.java.availableOptions', { major: major })
    if(major >= 12) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/en/java/javase/${major}/docs/specs/man/java.html#extra-options-for-java`
    }
    else if(major >= 11) {
        settingsJvmOptsLink.href = 'https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE'
    }
    else if(major >= 9) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`
    }
    else {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${process.platform === 'win32' ? 'windows' : 'unix'}/java.html`
    }
}

function bindMinMaxRam(server) {
    // Store maximum memory values.
    const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(server.rawServer.javaOptions?.ram)
    const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(server.rawServer.javaOptions?.ram)

    // Set the max and min values for the ranged sliders.
    settingsMaxRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMaxRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
    settingsMinRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMinRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab(){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    bindMinMaxRam(server)
    bindRangeSlider(server)
    populateMemoryStatus()
    populateJavaReqDesc(server)
    populateJvmOptsLink(server)
}

/**
 * About Tab
 */

const settingsTabAbout             = document.getElementById('settingsTabAbout')
const settingsAboutChangelogTitle  = settingsTabAbout.getElementsByClassName('settingsChangelogTitle')[0]
const settingsAboutChangelogText   = settingsTabAbout.getElementsByClassName('settingsChangelogText')[0]
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName('settingsChangelogButton')[0]

// Bind the devtools toggle button.
document.getElementById('settingsAboutDevToolsButton').onclick = (e) => {
    let window = remote.getCurrentWindow()
    window.toggleDevTools()
}

/**
 * Return whether or not the provided version is a prerelease.
 * 
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version){
    const preRelComp = semver.prerelease(version)
    return preRelComp != null && preRelComp.length > 0
}

/**
 * Utility method to display version information on the
 * About and Update settings tabs.
 * 
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(version, valueElement, titleElement, checkElement){
    valueElement.innerHTML = version
    if(isPrerelease(version)){
        titleElement.innerHTML = Lang.queryJS('settings.about.preReleaseTitle')
        titleElement.style.color = '#ff886d'
        checkElement.style.background = '#ff886d'
    } else {
        titleElement.innerHTML = Lang.queryJS('settings.about.stableReleaseTitle')
        titleElement.style.color = null
        checkElement.style.background = null
    }
}

/**
 * Retrieve the version information and display it on the UI.
 */
function populateAboutVersionInformation(){
    populateVersionInformation(remote.app.getVersion(), document.getElementById('settingsAboutCurrentVersionValue'), document.getElementById('settingsAboutCurrentVersionTitle'), document.getElementById('settingsAboutCurrentVersionCheck'))
}

/**
 * Fetches the GitHub atom release feed and parses it for the release notes
 * of the current version. This value is displayed on the UI.
 */
function populateReleaseNotes(){
    $.ajax({
        url: 'https://github.com/MrPotatoXx/PotatoxLauncher/releases.atom',
        success: (data) => {
            const version = 'v' + remote.app.getVersion()
            const entries = $(data).find('entry')
            
            for(let i=0; i<entries.length; i++){
                const entry = $(entries[i])
                let id = entry.find('id').text()
                id = id.substring(id.lastIndexOf('/')+1)

                if(id === version){
                    settingsAboutChangelogTitle.innerHTML = entry.find('title').text()
                    settingsAboutChangelogText.innerHTML = entry.find('content').text()
                    settingsAboutChangelogButton.href = entry.find('link').attr('href')
                }
            }

        },
        timeout: 2500
    }).catch(err => {
        settingsAboutChangelogText.innerHTML = Lang.queryJS('settings.about.releaseNotesFailed')
    })
}

/**
 * Prepare account tab for display.
 */
function prepareAboutTab(){
    populateAboutVersionInformation()
    populateReleaseNotes()
}

/**
 * Update Tab
 */

const settingsTabUpdate            = document.getElementById('settingsTabUpdate')
const settingsUpdateTitle          = document.getElementById('settingsUpdateTitle')
const settingsUpdateVersionCheck   = document.getElementById('settingsUpdateVersionCheck')
const settingsUpdateVersionTitle   = document.getElementById('settingsUpdateVersionTitle')
const settingsUpdateVersionValue   = document.getElementById('settingsUpdateVersionValue')
const settingsUpdateChangelogTitle = settingsTabUpdate.getElementsByClassName('settingsChangelogTitle')[0]
const settingsUpdateChangelogText  = settingsTabUpdate.getElementsByClassName('settingsChangelogText')[0]
const settingsUpdateChangelogCont  = settingsTabUpdate.getElementsByClassName('settingsChangelogContainer')[0]
const settingsUpdateActionButton   = document.getElementById('settingsUpdateActionButton')

/**
 * Update the properties of the update action button.
 * 
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null){
    settingsUpdateActionButton.innerHTML = text
    settingsUpdateActionButton.disabled = disabled
    if(handler != null){
        settingsUpdateActionButton.onclick = handler
    }
}

/**
 * Populate the update tab with relevant information.
 * 
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data){
    if(data != null){
        settingsUpdateTitle.innerHTML = isPrerelease(data.version) ? Lang.queryJS('settings.updates.newPreReleaseTitle') : Lang.queryJS('settings.updates.newReleaseTitle')
        settingsUpdateChangelogCont.style.display = null
        settingsUpdateChangelogTitle.innerHTML = data.releaseName
        settingsUpdateChangelogText.innerHTML = data.releaseNotes
        populateVersionInformation(data.version, settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        
        if(process.platform === 'darwin'){
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadButton'), false, () => {
                shell.openExternal(data.darwindownload)
            })
        } else {
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadingButton'), true)
        }
    } else {
        settingsUpdateTitle.innerHTML = Lang.queryJS('settings.updates.latestVersionTitle')
        settingsUpdateChangelogCont.style.display = 'none'
        populateVersionInformation(remote.app.getVersion(), settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkForUpdatesButton'), false, () => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkingForUpdatesButton'), true)
            }
        })
    }
}

/**
 * Prepare update tab for display.
 * 
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null){
    populateSettingsUpdateInformation(data)
}

/**
 * Settings preparation functions.
 */

/**
 * Minecraft Settings Import
 */

const mcImportFs = require('fs-extra')

let mcImportSources = []
let mcImportSourceDir = null
let mcImportSourceInfo = null
const mcImportSelection = {}
let mcImportCustomPaths = []

const mcImportQuery = (key, placeHolders) => Lang.queryJS(`settings.minecraftImport.${key}`, placeHolders)

/**
 * Escape text before putting it inside HTML (paths and names can contain anything).
 *
 * @param {string} text The text to escape.
 * @returns {string} The escaped text.
 */
function escapeImportHtml(text){
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * @param {number} bytes A size in bytes.
 * @returns {string} The size in a readable unit.
 */
function formatImportSize(bytes){
    if(bytes < 1024) return `${bytes} B`
    if(bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    if(bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * @param {Date} date A date in the past.
 * @returns {string} How long ago it was ("hace 2 días").
 */
function formatImportAgo(date){
    const rtf = new Intl.RelativeTimeFormat(mcImportQuery('locale'), { numeric: 'auto' })
    const diff = (date.getTime() - Date.now()) / 1000
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
    for(const [unit, secs] of units){
        if(Math.abs(diff) >= secs){
            return rtf.format(Math.round(diff / secs), unit)
        }
    }
    return rtf.format(0, 'minute')
}

/**
 * @param {Object} source A detected source.
 * @returns {string} A short title, e.g. "CurseForge · server".
 */
function importSourceTitle(source){
    const launcher = mcImportQuery(`launchers.${source.launcher}`)
    return source.name ? `${launcher} · ${source.name}` : launcher
}

/**
 * Build the HTML summary shown after an import.
 *
 * @param {Array<Object>} results The results from MinecraftImport.importSettings.
 * @param {string} sourceTitle Where the settings were imported from.
 * @param {string} serverName The name of the server whose instance received them.
 * @returns {string} The summary HTML.
 */
function buildMinecraftImportSummary(results, sourceTitle, serverName){
    const lines = results.map(r => {
        let detail
        if(r.status === 'missing'){
            detail = mcImportQuery('resultMissing')
        } else if(r.status === 'blocked'){
            detail = mcImportQuery(`blocked.${r.reason}`)
        } else if(r.status === 'error'){
            detail = mcImportQuery('resultError', { error: escapeImportHtml(r.error) })
        } else if(r.skipped != null){
            detail = mcImportQuery('resultMissingOnly', { files: r.files, skipped: r.skipped })
        } else if(r.files > 1){
            detail = mcImportQuery('resultFiles', { files: r.files })
        } else {
            detail = mcImportQuery('resultImported')
        }
        if(r.backup){
            detail += `<br><span class="mcImportBackup">${mcImportQuery('resultBackup', { backup: escapeImportHtml(path.basename(r.backup)) })}</span>`
        }
        const label = r.item != null ? mcImportQuery(`items.${r.item}`) : escapeImportHtml(r.rel.replace(/\\/g, '/'))
        return `<li><strong>${label}</strong>: ${detail}</li>`
    })
    return `${mcImportQuery('summaryFrom', { source: escapeImportHtml(sourceTitle) })}<br>${mcImportQuery('summaryTo', { server: escapeImportHtml(serverName) })}`
        + `<ul class="mcImportSummaryList">${lines.join('')}</ul>`
}

/**
 * Show a simple overlay with a single button.
 *
 * @param {string} title The overlay title.
 * @param {string} description The overlay description (HTML).
 */
function showMinecraftImportMessage(title, description){
    setOverlayContent(title, description, mcImportQuery('okButton'))
    setOverlayHandler(null)
    toggleOverlay(true)
}

/**
 * Describe the selected server's instance, and what to compare against when recommending a source.
 *
 * @param {Object} serv Optional. The server (HeliosServer); defaults to the selected one.
 * @returns {Promise<Object>} name, mcVersion, loader, modFiles, instanceDir and excludeDirs.
 */
async function getMinecraftImportTarget(serv = null){
    if(serv == null){
        serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    }
    const types = serv.modules.map(m => m.rawModule.type)
    let loader = 'vanilla'
    if(types.includes(Type.ForgeHosted) || types.includes(Type.Forge)) loader = 'forge'
    else if(types.includes(Type.Fabric)) loader = 'fabric'
    return {
        name: serv.rawServer.name,
        mcVersion: serv.rawServer.minecraftVersion,
        loader,
        // Nombre original del jar (el de la URL), que es como lo guardan los otros launchers.
        modFiles: serv.modules.filter(m => [Type.ForgeMod, Type.FabricMod, Type.LiteMod].includes(m.rawModule.type))
            .map(m => decodeURIComponent(m.rawModule.artifact.url.split('/').pop())),
        instanceDir: path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id),
        excludeDirs: [ConfigManager.getInstanceDirectory()]
    }
}

/**
 * Draw the list of detected sources.
 */
function renderImportSources(){
    const list = document.getElementById('settingsImportSourceList')
    list.innerHTML = ''
    for(const source of mcImportSources){
        const meta = []
        if(source.mcVersion) meta.push(escapeImportHtml(source.mcVersion))
        if(source.loader && source.loader !== 'vanilla') meta.push(mcImportQuery(`loaders.${source.loader}`))
        if(source.sharedMods > 0) meta.push(mcImportQuery('sharedMods', { shared: source.sharedMods, total: source.totalMods }))
        if(source.lastPlayed) meta.push(mcImportQuery('lastPlayed', { ago: formatImportAgo(source.lastPlayed) }))

        const button = document.createElement('button')
        button.className = 'settingsImportSourceOption'
        button.toggleAttribute('selected', mcImportSourceDir === source.dir)
        button.innerHTML = `<span class="settingsImportSourceName">${escapeImportHtml(importSourceTitle(source))}`
            + (source.recommended ? ` <span class="settingsImportRecommended">${mcImportQuery('recommended')}</span>` : '')
            + `</span><span class="settingsImportSourceMeta">${meta.join(' · ')}</span>`
            + `<span class="settingsImportSourcePath">${escapeImportHtml(source.dir)}</span>`
        button.onclick = async () => {
            mcImportSourceDir = source.dir
            renderImportSources()
            await refreshImportItems()
            await renderImportCustomList()
        }
        list.appendChild(button)
    }
    if(mcImportSources.length === 0){
        list.innerHTML = `<span class="settingsImportEmpty">${mcImportQuery('noSourcesFound')}</span>`
    }
}

/**
 * Draw one row per importable item found in the selected source.
 */
async function refreshImportItems(){
    const MinecraftImport = require('./assets/js/minecraftimport')
    const container = document.getElementById('settingsImportItems')
    const note = document.getElementById('settingsImportSourceNote')
    container.innerHTML = ''
    note.innerHTML = ''
    if(mcImportSourceDir == null){
        mcImportSourceInfo = null
        return
    }

    const info = await MinecraftImport.inspectSource(mcImportSourceDir)
    mcImportSourceInfo = info
    if(!info.exists){
        note.innerHTML = mcImportQuery('sourceMissing')
        return
    }
    if(!MinecraftImport.ITEMS.some(item => info.found[item.key])){
        note.innerHTML = mcImportQuery('nothingFound')
        return
    }
    if(info.dataVersion != null && info.dataVersion > MinecraftImport.TARGET_DATA_VERSION){
        const target = await getMinecraftImportTarget()
        note.innerHTML = mcImportQuery('newerVersionNote', { mc: escapeImportHtml(target.mcVersion) })
    }

    for(const item of MinecraftImport.ITEMS){
        if(!info.found[item.key]){
            continue
        }
        if(mcImportSelection[item.key] == null){
            mcImportSelection[item.key] = item.defaultOn
        }
        let desc = mcImportQuery(`itemDescs.${item.key}`)
        if(item.key === 'local'){
            try {
                const entries = (await mcImportFs.readdir(path.join(mcImportSourceDir, 'local'))).map(e => e.replace(/\.snbt$/, ''))
                if(entries.length > 0){
                    desc += ` (${escapeImportHtml(entries.slice(0, 5).join(', '))}${entries.length > 5 ? '…' : ''})`
                }
            } catch (_err) {
                // Sin detalle.
            }
        }
        const row = document.createElement('div')
        row.className = 'settingsFieldContainer'
        row.innerHTML = '<div class="settingsFieldLeft">'
            + `<span class="settingsFieldTitle">${mcImportQuery(`items.${item.key}`)}</span>`
            + `<span class="settingsFieldDesc">${desc} <span class="settingsImportStatus" found>· <span class="settingsImportSize">…</span></span></span>`
            + '</div><div class="settingsFieldRight"><label class="toggleSwitch">'
            + `<input type="checkbox"${mcImportSelection[item.key] ? ' checked' : ''}><span class="toggleSwitchSlider"></span></label></div>`
        row.querySelector('input').onchange = e => {
            mcImportSelection[item.key] = e.target.checked
        }
        container.appendChild(row)

        // El tamaño puede tardar en carpetas grandes (JourneyMap); se completa después.
        const sizeEl = row.querySelector('.settingsImportSize')
        const dirAtStart = mcImportSourceDir
        MinecraftImport.getSize(path.join(mcImportSourceDir, item.path)).then(({ size, files }) => {
            if(dirAtStart === mcImportSourceDir){
                sizeEl.innerHTML = files > 1 ? mcImportQuery('sizeFiles', { size: formatImportSize(size), files }) : formatImportSize(size)
            }
        })
    }
}

/**
 * Draw the files and folders chosen by hand, with where each one will go.
 */
async function renderImportCustomList(){
    const MinecraftImport = require('./assets/js/minecraftimport')
    const list = document.getElementById('settingsImportCustomList')
    list.innerHTML = ''
    if(mcImportCustomPaths.length === 0){
        return
    }
    const target = await getMinecraftImportTarget()
    const plan = await MinecraftImport.planCustomImport(mcImportSourceDir, target.instanceDir, mcImportCustomPaths)
    for(const entry of plan){
        const row = document.createElement('div')
        row.className = 'settingsImportCustomRow'
        row.toggleAttribute('blocked', entry.blocked != null)
        const where = entry.blocked
            ? mcImportQuery(`blocked.${entry.blocked}`)
            : mcImportQuery('goesTo', { rel: escapeImportHtml(entry.rel.replace(/\\/g, '/')) })
        row.innerHTML = `<span class="settingsImportCustomName">${escapeImportHtml(path.basename(entry.src))}${entry.isDir ? '/' : ''}</span>`
            + `<span class="settingsImportCustomWhere">${where}</span>`
            + `<button class="settingsImportCustomRemove" title="${mcImportQuery('remove')}">&#10006;</button>`
        row.querySelector('button').onclick = async () => {
            mcImportCustomPaths = mcImportCustomPaths.filter(p => p !== entry.src)
            await renderImportCustomList()
        }
        list.appendChild(row)
    }
}

/**
 * Add files or folders chosen by hand (or dropped) to the import.
 *
 * @param {string[]} paths The paths.
 */
async function addImportCustomPaths(paths){
    for(const p of paths){
        if(p && !mcImportCustomPaths.includes(p)){
            mcImportCustomPaths.push(p)
        }
    }
    await renderImportCustomList()
}

/**
 * Use a folder chosen by hand as the source. If it is the root of a Prism/MultiMC
 * instance, the game folder inside it is used.
 *
 * @param {string} dir The chosen folder.
 */
async function useImportSourceFolder(dir){
    for(const sub of ['.minecraft', 'minecraft']){
        if(await mcImportFs.pathExists(path.join(dir, sub, 'options.txt'))){
            dir = path.join(dir, sub)
            break
        }
    }
    if(!mcImportSources.some(s => path.resolve(s.dir).toLowerCase() === path.resolve(dir).toLowerCase())){
        const MinecraftImport = require('./assets/js/minecraftimport')
        // Para una carpeta .minecraft o minecraft, el nombre útil es el de la instancia que la contiene.
        const base = path.basename(dir)
        const name = ['.minecraft', 'minecraft'].includes(base.toLowerCase()) ? path.basename(path.dirname(dir)) : base
        const dataVersion = await MinecraftImport.readDataVersion(path.join(dir, 'options.txt'))
        mcImportSources.push({ launcher: 'custom', name, dir, mcVersion: MinecraftImport.mcVersionFromDataVersion(dataVersion), loader: null, lastPlayed: null, sharedMods: 0 })
    }
    mcImportSourceDir = dir
    renderImportSources()
    await refreshImportItems()
    await renderImportCustomList()
}

/**
 * Import the selected settings into the selected server's instance.
 */
async function runMinecraftImportFromSettings(){
    const MinecraftImport = require('./assets/js/minecraftimport')
    const button = document.getElementById('settingsImportButton')
    const resetButton = () => {
        button.disabled = false
        button.innerHTML = Lang.queryEJS('settings.importButton')
    }

    const info = mcImportSourceInfo
    const items = info == null ? [] : MinecraftImport.ITEMS.filter(item => info.found[item.key] && mcImportSelection[item.key])
    const target = await getMinecraftImportTarget()
    const plan = await MinecraftImport.planCustomImport(mcImportSourceDir, target.instanceDir, mcImportCustomPaths)
    const customOk = plan.filter(e => e.blocked == null)
    if(items.length === 0 && customOk.length === 0){
        showMinecraftImportMessage(mcImportQuery('noSelectionTitle'), mcImportQuery('noSelectionDesc'))
        return
    }

    button.disabled = true
    button.innerHTML = mcImportQuery('checking')
    const launcherProcRunning = typeof proc !== 'undefined' && proc != null && proc.exitCode == null
    if(launcherProcRunning || await MinecraftImport.isGameRunning(target.instanceDir)){
        resetButton()
        showMinecraftImportMessage(mcImportQuery('gameRunningTitle'), mcImportQuery('gameRunningDesc', { server: escapeImportHtml(target.name) }))
        return
    }
    resetButton()

    // Confirmación con todo lo que va a entrar.
    const source = mcImportSources.find(s => s.dir === mcImportSourceDir)
    const sourceTitle = source != null ? importSourceTitle(source) : (mcImportSourceDir || '')
    const lines = items.map(item => `<li>${mcImportQuery(`items.${item.key}`)}</li>`)
        .concat(customOk.map(e => `<li>${escapeImportHtml(path.basename(e.src))} → ${escapeImportHtml(e.rel.replace(/\\/g, '/'))}</li>`))
    let desc = `${mcImportQuery('summaryFrom', { source: escapeImportHtml(sourceTitle) })}<br>${mcImportQuery('summaryTo', { server: escapeImportHtml(target.name) })}`
        + `<ul class="mcImportSummaryList">${lines.join('')}</ul>${mcImportQuery('confirmBackupNote')}`
    if(items.some(i => i.key === 'options') && info.dataVersion != null && info.dataVersion > MinecraftImport.TARGET_DATA_VERSION){
        desc += `<br><br>${mcImportQuery('newerVersionNote', { mc: escapeImportHtml(target.mcVersion) })}`
    }

    setOverlayContent(mcImportQuery('confirmTitle'), desc, mcImportQuery('confirmButton'), mcImportQuery('cancel'))
    setOverlayHandler(async () => {
        toggleOverlay(false)
        button.disabled = true
        button.innerHTML = mcImportQuery('importing')
        try {
            const selection = {}
            for(const item of items){
                selection[item.key] = true
            }
            const results = await MinecraftImport.importSettings(mcImportSourceDir, target.instanceDir, selection, plan)
            mcImportCustomPaths = []
            await renderImportCustomList()
            showMinecraftImportMessage(mcImportQuery('summaryTitle'), buildMinecraftImportSummary(results, sourceTitle, target.name))
        } catch(err) {
            showMinecraftImportMessage(mcImportQuery('errorTitle'), mcImportQuery('errorDesc', { error: escapeImportHtml(err.message) }))
        } finally {
            resetButton()
        }
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
}

/**
 * Prepare the Minecraft settings import section of the Minecraft tab.
 */
async function prepareMinecraftImport(){
    const MinecraftImport = require('./assets/js/minecraftimport')
    const { webUtils } = require('electron')
    const win = remote.getCurrentWindow()

    document.getElementById('settingsImportSourceButton').onclick = async () => {
        const res = await remote.dialog.showOpenDialog(win, {
            title: document.getElementById('settingsImportSourceButton').getAttribute('dialogTitle'),
            defaultPath: mcImportSourceDir || undefined,
            properties: ['openDirectory']
        })
        if(!res.canceled){
            await useImportSourceFolder(res.filePaths[0])
        }
    }
    for(const [id, properties] of [['settingsImportPickFiles', ['openFile', 'multiSelections']], ['settingsImportPickFolder', ['openDirectory', 'multiSelections']]]){
        const pick = document.getElementById(id)
        pick.onclick = async () => {
            const res = await remote.dialog.showOpenDialog(win, {
                title: pick.getAttribute('dialogTitle'),
                defaultPath: mcImportSourceDir || undefined,
                properties
            })
            if(!res.canceled){
                await addImportCustomPaths(res.filePaths)
            }
        }
    }

    const drop = document.getElementById('settingsImportDrop')
    drop.ondragenter = e => {
        e.preventDefault()
        drop.setAttribute('drag', '')
    }
    drop.ondragover = e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
    }
    drop.ondragleave = e => {
        if(!drop.contains(e.relatedTarget)){
            drop.removeAttribute('drag')
        }
    }
    drop.ondrop = async e => {
        e.preventDefault()
        drop.removeAttribute('drag')
        await addImportCustomPaths([...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)))
    }

    document.getElementById('settingsImportButton').onclick = runMinecraftImportFromSettings

    // Detectar orígenes cada vez que se abren los ajustes (pudo instalar otro launcher o jugar en otra instancia).
    const target = await getMinecraftImportTarget()
    const custom = mcImportSources.filter(s => s.launcher === 'custom')
    mcImportSources = (await MinecraftImport.detectSources(target)).map(s => ({ ...s, totalMods: target.modFiles.length }))
    for(const c of custom){
        if(!mcImportSources.some(s => s.dir === c.dir)){
            mcImportSources.push(c)
        }
    }
    if(mcImportSourceDir == null || !mcImportSources.some(s => s.dir === mcImportSourceDir)){
        mcImportSourceDir = mcImportSources.length > 0 ? mcImportSources[0].dir : null
    }
    renderImportSources()
    await refreshImportItems()
    await renderImportCustomList()
}

/**
 * Skin Tab
 */

const SkinManager = require('./assets/js/skinmanager')

const skinQuery = (key, placeHolders) => Lang.queryJS(`settings.skin.${key}`, placeHolders)

const skinState = {
    viewer: null,
    library: null,
    uuid: null,
    profile: null,
    activeHash: null,
    entries: [],
    images: {},
    capeImages: {},
    previewHash: null,
    previewVariant: 'classic',
    previewCape: null,
    busy: false,
    loadId: 0
}

/**
 * @param {Buffer} png A PNG image.
 * @returns {string} The image as a data URL.
 */
function skinDataUrl(png){
    return `data:image/png;base64,${png.toString('base64')}`
}

/**
 * @param {string} src An image URL.
 * @returns {Promise<HTMLImageElement>} The loaded image.
 */
function loadSkinImage(src){
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })
}

/**
 * Guess the arm model of a skin, like Minecraft does: slim skins leave
 * transparent pixels where the fourth column of each arm would be.
 *
 * @param {HTMLImageElement} img The skin.
 * @returns {'classic'|'slim'} The arm model.
 */
function inferSkinVariant(img){
    if(img.naturalHeight !== 64){
        return 'classic'
    }
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const transparent = (x, y, w, h) => {
        const data = ctx.getImageData(x, y, w, h).data
        for(let i = 3; i < data.length; i += 4){
            if(data[i] !== 255){
                return true
            }
        }
        return false
    }
    return transparent(50, 16, 2, 4) || transparent(54, 20, 2, 12) || transparent(42, 48, 2, 4) || transparent(46, 52, 2, 12) ? 'slim' : 'classic'
}

/**
 * Draw the front of a skin (with its second layer) on a 16x32 canvas.
 *
 * @param {HTMLCanvasElement} canvas The canvas.
 * @param {HTMLImageElement} img The skin.
 * @param {'classic'|'slim'} variant The arm model.
 */
function drawSkinFront(canvas, img, variant){
    canvas.width = 16
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    const legacy = img.naturalHeight === 32
    const arm = variant === 'slim' ? 3 : 4
    const part = (sx, sy, w, h, dx, dy, mirror = false) => {
        if(mirror){
            ctx.save()
            ctx.translate(dx + w, dy)
            ctx.scale(-1, 1)
            ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h)
            ctx.restore()
        } else {
            ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h)
        }
    }
    // Primera capa.
    part(8, 8, 8, 8, 4, 0)
    part(20, 20, 8, 12, 4, 8)
    part(44, 20, arm, 12, 4 - arm, 8)
    part(4, 20, 4, 12, 4, 20)
    if(legacy){
        part(44, 20, arm, 12, 12, 8, true)
        part(4, 20, 4, 12, 8, 20, true)
    } else {
        part(36, 52, arm, 12, 12, 8)
        part(20, 52, 4, 12, 8, 20)
    }
    // Segunda capa (sombrero, chaqueta, mangas y pantalones).
    part(40, 8, 8, 8, 4, 0)
    if(!legacy){
        part(20, 36, 8, 12, 4, 8)
        part(44, 36, arm, 12, 4 - arm, 8)
        part(52, 52, arm, 12, 12, 8)
        part(4, 36, 4, 12, 4, 20)
        part(4, 52, 4, 12, 8, 20)
    }
}

/**
 * Draw the outer face of a cape on a 10x16 canvas.
 *
 * @param {HTMLCanvasElement} canvas The canvas.
 * @param {HTMLImageElement} img The cape texture.
 */
function drawCapeFront(canvas, img){
    // Las capas HD son múltiplos de 64x32.
    const scale = img.naturalWidth / 64
    canvas.width = 10
    canvas.height = 16
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 1 * scale, 1 * scale, 10 * scale, 16 * scale, 0, 0, 10, 16)
}

/**
 * Show a status line under the apply button.
 *
 * @param {string} text The message ('' to clear it).
 * @param {'info'|'ok'|'error'} type The kind of message.
 */
function setSkinStatus(text, type = 'info'){
    const status = document.getElementById('settingsSkinStatus')
    status.innerHTML = text
    status.setAttribute('type', type)
}

/**
 * @param {Error} err An error from SkinManager.
 * @returns {string} A message for the player.
 */
function skinErrorMessage(err){
    const code = err instanceof SkinManager.SkinError ? err.code : 'unknown'
    return skinQuery(`errors.${code}`, { detail: escapeImportHtml(err.message) })
}

/**
 * Show a message in place of the tab content (no account, Mojang account, load error).
 *
 * @param {string|null} html The message, or null to show the content.
 */
function setSkinTabMessage(html){
    document.getElementById('settingsSkinMessage').innerHTML = html || ''
    document.getElementById('settingsSkinContent').style.display = html ? 'none' : ''
    if(skinState.viewer != null){
        skinState.viewer.renderPaused = html != null
    }
}

/**
 * Load skinview3d from its bundle, which already includes three.js.
 *
 * The package entry imports three/examples/..., and electron-builder leaves the
 * examples folder of every dependency out of the installer. The bundle is UMD, but the
 * package is marked as ES module, so it is compiled as CommonJS by hand.
 *
 * @returns {Object} The skinview3d module.
 */
function loadSkinview3d(){
    const Module = require('module')
    const file = require.resolve('skinview3d/bundles/skinview3d.bundle.js')
    const bundle = new Module(file, module)
    bundle.filename = file
    bundle.paths = Module._nodeModulePaths(path.dirname(file))
    bundle._compile(mcImportFs.readFileSync(file, 'utf8'), file)
    return bundle.exports
}

/**
 * Create the 3D viewer the first time the tab is opened.
 */
function ensureSkinViewer(){
    if(skinState.viewer != null){
        return
    }
    const skinview3d = loadSkinview3d()
    const viewer = new skinview3d.SkinViewer({
        canvas: document.getElementById('settingsSkinCanvas'),
        width: 190,
        height: 250
    })
    viewer.fov = 40
    viewer.zoom = 0.8
    viewer.controls.enableZoom = false
    viewer.controls.enablePan = false
    viewer.animation = new skinview3d.WalkingAnimation()
    viewer.animation.speed = 0.6
    viewer.animation.headBobbing = false
    viewer.playerObject.rotation.y = -0.7
    skinState.viewer = viewer
}

/**
 * Pause the 3D viewer while the tab is not visible.
 *
 * @param {boolean} visible Whether the skin tab is visible.
 */
function setSkinViewerVisible(visible){
    if(skinState.viewer != null){
        skinState.viewer.renderPaused = !visible
    }
}

/**
 * Load the preview (skin, model and cape) into the 3D viewer.
 */
async function updateSkinPreview(){
    const viewer = skinState.viewer
    const entry = skinState.entries.find(e => e.hash === skinState.previewHash)
    if(entry != null){
        await viewer.loadSkin(skinState.images[entry.hash].src, { model: skinState.previewVariant === 'slim' ? 'slim' : 'default' })
        document.getElementById('settingsSkinPreviewName').textContent = skinEntryName(entry)
    }
    const cape = skinState.previewCape != null ? skinState.capeImages[skinState.previewCape] : null
    if(cape != null){
        await viewer.loadCape(cape.src, { backEquipment: document.getElementById('settingsSkinElytra').checked ? 'elytra' : 'cape' })
    } else {
        viewer.loadCape(null)
    }

    for(const option of document.getElementsByClassName('settingsSkinModelOption')){
        option.toggleAttribute('selected', option.getAttribute('variant') === skinState.previewVariant)
    }
    for(const card of document.querySelectorAll('#settingsSkinLibrary .settingsSkinCard')){
        card.toggleAttribute('selected', card.getAttribute('hash') === skinState.previewHash)
    }
    for(const card of document.querySelectorAll('#settingsSkinCapes .settingsSkinCard')){
        card.toggleAttribute('selected', (card.getAttribute('cape') || null) === skinState.previewCape)
    }

    const profile = skinState.profile
    const changed = skinState.previewHash !== skinState.activeHash
        || skinState.previewVariant !== profile.skin?.variant
        || skinState.previewCape !== profile.activeCape
    document.getElementById('settingsSkinApply').disabled = !changed || skinState.busy
}

/**
 * @param {Object} entry A library entry.
 * @returns {string} The name to show for it.
 */
function skinEntryName(entry){
    return entry.name || skinQuery('officialSkinName')
}

/**
 * Render the skin library.
 */
async function renderSkinLibrary(){
    const list = document.getElementById('settingsSkinLibrary')
    list.innerHTML = ''
    for(const entry of skinState.entries){
        if(skinState.images[entry.hash] == null){
            try {
                skinState.images[entry.hash] = await loadSkinImage(skinDataUrl(await skinState.library.read(entry.hash)))
            } catch(err){
                continue
            }
        }
        const active = entry.hash === skinState.activeHash
        const card = document.createElement('div')
        card.className = 'settingsSkinCard'
        card.setAttribute('hash', entry.hash)
        card.title = skinEntryName(entry)
        const thumb = document.createElement('canvas')
        thumb.className = 'settingsSkinThumb'
        drawSkinFront(thumb, skinState.images[entry.hash], entry.variant)
        card.appendChild(thumb)
        const name = document.createElement('span')
        name.className = 'settingsSkinCardName'
        name.textContent = skinEntryName(entry)
        card.appendChild(name)
        if(active){
            const badge = document.createElement('span')
            badge.className = 'settingsSkinBadge'
            badge.textContent = skinQuery('current')
            card.appendChild(badge)
        } else {
            const remove = document.createElement('button')
            remove.className = 'settingsSkinRemove'
            remove.title = skinQuery('remove')
            remove.textContent = '✕'
            remove.onclick = e => {
                e.stopPropagation()
                confirmRemoveSkin(entry)
            }
            card.appendChild(remove)
        }
        card.onclick = () => {
            skinState.previewHash = entry.hash
            skinState.previewVariant = entry.hash === skinState.activeHash ? skinState.profile.skin.variant : entry.variant
            setSkinStatus('')
            updateSkinPreview()
        }
        list.appendChild(card)
    }
}

/**
 * Render the capes the account owns.
 */
function renderSkinCapes(){
    const list = document.getElementById('settingsSkinCapes')
    list.innerHTML = ''
    const capes = skinState.profile.capes.filter(c => skinState.capeImages[c.id] != null)

    const addCard = (capeId, label, img) => {
        const card = document.createElement('div')
        card.className = 'settingsSkinCard settingsSkinCapeCard'
        card.setAttribute('cape', capeId || '')
        card.title = label
        if(img != null){
            const thumb = document.createElement('canvas')
            thumb.className = 'settingsSkinCapeThumb'
            drawCapeFront(thumb, img)
            card.appendChild(thumb)
        } else {
            const none = document.createElement('span')
            none.className = 'settingsSkinCapeNone'
            none.textContent = '∅'
            card.appendChild(none)
        }
        const name = document.createElement('span')
        name.className = 'settingsSkinCardName'
        name.textContent = label
        card.appendChild(name)
        if(capeId === skinState.profile.activeCape){
            const badge = document.createElement('span')
            badge.className = 'settingsSkinBadge'
            badge.textContent = skinQuery('current')
            card.appendChild(badge)
        }
        card.onclick = () => {
            skinState.previewCape = capeId
            setSkinStatus('')
            updateSkinPreview()
        }
        list.appendChild(card)
    }

    if(capes.length === 0){
        const empty = document.createElement('span')
        empty.className = 'settingsSkinEmpty'
        empty.innerHTML = skinQuery('noCapes')
        list.appendChild(empty)
        return
    }
    addCard(null, skinQuery('noCape'), null)
    for(const cape of capes){
        addCard(cape.id, cape.alias, skinState.capeImages[cape.id])
    }
}

/**
 * Show the "import from the official launcher" button if it has skins we don't have.
 */
async function refreshOfficialSkinsButton(){
    const button = document.getElementById('settingsSkinImportOfficial')
    const official = await SkinManager.readOfficialSkins()
    const known = new Set(skinState.entries.map(e => e.hash))
    const missing = official.filter(s => !known.has(SkinManager.hashPng(s.png)))
    button.style.display = missing.length > 0 ? '' : 'none'
    button.innerHTML = skinQuery('importOfficial', { count: missing.length })
    button.onclick = async () => {
        let last = null
        for(const skin of missing){
            const { entry } = await skinState.library.add(skin.png, { name: skin.name, variant: skin.variant, source: 'official' })
            last = entry
        }
        await reloadSkinLibrary(last?.hash)
        setSkinStatus(skinQuery('importedOfficial', { count: missing.length }), 'ok')
    }
}

/**
 * Re-read the library from disk and redraw it.
 *
 * @param {string} previewHash Optional. A skin to preview afterwards.
 */
async function reloadSkinLibrary(previewHash = null){
    skinState.entries = await skinState.library.list()
    // La skin activa siempre va primero.
    skinState.entries.sort((a, b) => (b.hash === skinState.activeHash) - (a.hash === skinState.activeHash))
    await renderSkinLibrary()
    await refreshOfficialSkinsButton()
    if(previewHash != null){
        const entry = skinState.entries.find(e => e.hash === previewHash)
        if(entry != null){
            skinState.previewHash = entry.hash
            skinState.previewVariant = entry.hash === skinState.activeHash ? skinState.profile.skin.variant : entry.variant
        }
    }
    await updateSkinPreview()
}

/**
 * Ask before removing a skin from the launcher's library.
 *
 * @param {Object} entry The library entry.
 */
function confirmRemoveSkin(entry){
    setOverlayContent(
        skinQuery('removeTitle'),
        skinQuery('removeDesc', { name: escapeImportHtml(skinEntryName(entry)) }),
        skinQuery('removeConfirm'),
        skinQuery('cancel')
    )
    setOverlayHandler(async () => {
        toggleOverlay(false)
        await skinState.library.remove(entry.hash)
        delete skinState.images[entry.hash]
        await reloadSkinLibrary(skinState.previewHash === entry.hash ? skinState.activeHash : null)
    })
    setDismissHandler(() => {
        toggleOverlay(false)
    })
    toggleOverlay(true, true)
}

/**
 * Add PNG files to the library (from the file picker or a drop).
 *
 * @param {string[]} files Paths to the files.
 */
async function addSkinFiles(files){
    const errors = []
    let last = null
    for(const file of files){
        const name = path.basename(file)
        try {
            const png = await mcImportFs.readFile(file)
            SkinManager.checkSkinPng(png)
            const img = await loadSkinImage(skinDataUrl(png))
            const { entry } = await skinState.library.add(png, {
                name: path.basename(file, path.extname(file)),
                variant: inferSkinVariant(img),
                source: 'file'
            })
            last = entry
        } catch(err){
            errors.push(`<strong>${escapeImportHtml(name)}</strong>: ${skinErrorMessage(err)}`)
        }
    }
    if(last != null){
        await reloadSkinLibrary(last.hash)
    }
    setSkinStatus(errors.join('<br>'), errors.length > 0 ? 'error' : 'info')
}

/**
 * Get a valid Minecraft token for the selected account, refreshing it if needed.
 *
 * @returns {Promise<string>} The token.
 */
async function getSkinToken(){
    const valid = await AuthManager.validateSelected()
    if(!valid){
        throw new SkinManager.SkinError('unauthorized')
    }
    return ConfigManager.getSelectedAccount().accessToken
}

/**
 * Make the account's skin and cape the ones being previewed.
 */
async function applySkinChanges(){
    const button = document.getElementById('settingsSkinApply')
    skinState.busy = true
    button.disabled = true
    setSkinStatus(skinQuery('saving'))
    try {
        const token = await getSkinToken()
        let profile = skinState.profile
        const entry = skinState.entries.find(e => e.hash === skinState.previewHash)
        if(entry != null && (skinState.previewHash !== skinState.activeHash || skinState.previewVariant !== profile.skin?.variant)){
            profile = await SkinManager.uploadSkin(token, await skinState.library.read(entry.hash), skinState.previewVariant)
            await skinState.library.update(entry.hash, { variant: skinState.previewVariant })
            skinState.activeHash = entry.hash
        }
        if(skinState.previewCape !== profile.activeCape){
            profile = await SkinManager.setCape(token, skinState.previewCape)
        }
        skinState.profile = profile
        await reloadSkinLibrary()
        renderSkinCapes()
        refreshSkinAvatars()
        setSkinStatus(skinQuery('saved'), 'ok')
    } catch(err){
        setSkinStatus(skinErrorMessage(err), 'error')
    } finally {
        skinState.busy = false
        await updateSkinPreview()
    }
}

/**
 * Reload the account pictures that show the skin (they come from mc-heads.net, which caches them).
 */
function refreshSkinAvatars(){
    const acc = ConfigManager.getSelectedAccount()
    const bust = Date.now()
    document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/body/${acc.uuid}/right?v=${bust}')`
    for(const img of document.querySelectorAll(`.settingsAuthAccount[uuid="${acc.uuid}"] .settingsAuthAccountImage`)){
        img.src = `https://mc-heads.net/body/${acc.uuid}/60?v=${bust}`
    }
}

/**
 * Load the selected account's skin and capes. Called every time the tab is opened.
 */
async function prepareSkinTab(){
    const loadId = ++skinState.loadId
    const account = ConfigManager.getSelectedAccount()
    if(account == null){
        setSkinTabMessage(skinQuery('noAccount'))
        return
    }
    if(account.type !== 'microsoft'){
        setSkinTabMessage(skinQuery('mojangAccount'))
        return
    }

    if(skinState.library == null){
        skinState.library = new SkinManager.SkinLibrary(path.join(ConfigManager.getLauncherDirectory(), 'skins'))
        bindSkinTab()
    }
    try {
        ensureSkinViewer()
    } catch(err){
        setSkinTabMessage(skinQuery('errors.viewer', { detail: escapeImportHtml(err.message) }))
        return
    }

    const firstLoad = skinState.uuid !== account.uuid || skinState.profile == null
    if(firstLoad){
        setSkinTabMessage(skinQuery('loading'))
    } else {
        setSkinTabMessage(null)
    }

    try {
        const profile = await SkinManager.getProfile(await getSkinToken())
        let activeHash = null
        if(profile.skin != null){
            const png = await SkinManager.downloadTexture(profile.skin.url)
            const { entry } = await skinState.library.add(png, { name: profile.name, variant: profile.skin.variant, source: 'account' })
            activeHash = entry.hash
        }
        for(const cape of profile.capes){
            if(skinState.capeImages[cape.id] == null){
                try {
                    skinState.capeImages[cape.id] = await loadSkinImage(skinDataUrl(await SkinManager.downloadTexture(cape.url)))
                } catch(err){
                    // Sin imagen, la capa no se muestra.
                }
            }
        }
        if(loadId !== skinState.loadId){
            return
        }

        const accountChanged = skinState.uuid !== account.uuid
        skinState.uuid = account.uuid
        skinState.profile = profile
        skinState.activeHash = activeHash
        if(accountChanged || skinState.previewHash == null){
            skinState.previewHash = activeHash
            skinState.previewVariant = profile.skin?.variant || 'classic'
            skinState.previewCape = profile.activeCape
        }
        setSkinTabMessage(null)
        renderSkinCapes()
        await reloadSkinLibrary()
        if(firstLoad){
            setSkinStatus('')
        }
    } catch(err){
        if(loadId === skinState.loadId){
            setSkinTabMessage(skinErrorMessage(err))
        }
    }
}

/**
 * Bind the tab's buttons once.
 */
function bindSkinTab(){
    const { webUtils } = require('electron')

    for(const option of document.getElementsByClassName('settingsSkinModelOption')){
        option.onclick = () => {
            skinState.previewVariant = option.getAttribute('variant')
            setSkinStatus('')
            updateSkinPreview()
        }
    }
    document.getElementById('settingsSkinElytra').onchange = () => updateSkinPreview()
    document.getElementById('settingsSkinApply').onclick = applySkinChanges

    const addButton = document.getElementById('settingsSkinAddFile')
    addButton.onclick = async () => {
        const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), {
            title: addButton.getAttribute('dialogTitle'),
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'PNG', extensions: ['png'] }]
        })
        if(!res.canceled){
            await addSkinFiles(res.filePaths)
        }
    }

    const playerInput = document.getElementById('settingsSkinPlayerName')
    const playerButton = document.getElementById('settingsSkinPlayerCopy')
    const copyPlayerSkin = async () => {
        const username = playerInput.value.trim()
        if(!/^[A-Za-z0-9_]{1,16}$/.test(username)){
            setSkinStatus(skinQuery('errors.playerNotFound'), 'error')
            return
        }
        playerButton.disabled = true
        setSkinStatus(skinQuery('copying', { name: escapeImportHtml(username) }))
        try {
            const skin = await SkinManager.getPlayerSkin(username)
            const { entry } = await skinState.library.add(skin.png, { name: skin.name, variant: skin.variant, source: 'player' })
            playerInput.value = ''
            await reloadSkinLibrary(entry.hash)
            setSkinStatus('')
        } catch(err){
            setSkinStatus(skinErrorMessage(err), 'error')
        } finally {
            playerButton.disabled = false
        }
    }
    playerButton.onclick = copyPlayerSkin
    playerInput.onkeydown = e => {
        if(e.key === 'Enter'){
            copyPlayerSkin()
        }
    }

    const tab = document.getElementById('settingsTabSkin')
    const drop = document.getElementById('settingsSkinDrop')
    tab.ondragenter = e => {
        e.preventDefault()
        drop.setAttribute('drag', '')
    }
    tab.ondragover = e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
    }
    tab.ondragleave = e => {
        if(!tab.contains(e.relatedTarget)){
            drop.removeAttribute('drag')
        }
    }
    tab.ondrop = async e => {
        e.preventDefault()
        drop.removeAttribute('drag')
        if(document.getElementById('settingsSkinContent').style.display === 'none'){
            return
        }
        await addSkinFiles([...e.dataTransfer.files].map(f => webUtils.getPathForFile(f)))
    }
}

/**
  * Prepare the entire settings UI.
  * 
  * @param {boolean} first Whether or not it is the first load.
  */
async function prepareSettings(first = false) {
    if(first){
        setupSettingsTabs()
        initSettingsValidators()
        prepareUpdateTab()
    } else {
        await prepareModsTab()
    }
    await initSettingsValues()
    prepareAccountsTab()
    await prepareJavaTab()
    prepareAboutTab()
    await prepareMinecraftImport()
    if(selectedSettingsTab === 'settingsTabSkin'){
        prepareSkinTab()
    }
}

// Prepare the settings UI on startup.
//prepareSettings(true)
