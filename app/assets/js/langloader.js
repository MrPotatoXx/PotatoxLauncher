const fs = require('fs-extra')
const path = require('path')
const toml = require('toml')
const merge = require('lodash.merge')

let lang

exports.loadLanguage = function(id){
    lang = merge(lang || {}, toml.parse(fs.readFileSync(path.join(__dirname, '..', 'lang', `${id}.toml`))) || {})
}

exports.query = function(id, placeHolders){
    let query = id.split('.')
    let res = lang
    for(let q of query){
        res = res[q]
    }
    let text = res === lang ? '' : res
    if (placeHolders) {
        Object.entries(placeHolders).forEach(([key, value]) => {
            text = text.replace(`{${key}}`, value)
        })
    }
    return text
}

exports.queryJS = function(id, placeHolders){
    return exports.query(`js.${id}`, placeHolders)
}

exports.queryEJS = function(id, placeHolders){
    return exports.query(`ejs.${id}`, placeHolders)
}

exports.IDIOMAS = ['es_ES', 'en_US']

/**
 * Idioma elegido en Ajustes (settings.launcher.idioma en config.json). Se lee del
 * archivo porque esto corre también en el proceso principal, antes que ConfigManager.
 */
exports.idiomaElegido = function(){
    try {
        const { app } = process.type === 'browser' ? require('electron') : require('@electron/remote')
        const config = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
        const idioma = config?.settings?.launcher?.idioma
        return exports.IDIOMAS.includes(idioma) ? idioma : 'es_ES'
    } catch(_err) {
        return 'es_ES'
    }
}

exports.setupLanguage = function(){
    // Load Language Files
    // en_US queda como respaldo para cualquier clave sin traducir
    exports.loadLanguage('en_US')
    if(exports.idiomaElegido() !== 'en_US'){
        exports.loadLanguage('es_ES')
    }

    // Load Custom Language File for Launcher Customizer
    exports.loadLanguage('_custom')
}