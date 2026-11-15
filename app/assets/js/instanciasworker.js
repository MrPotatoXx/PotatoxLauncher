/**
 * Proceso aparte (fork desde instancias.js) que valida y baja los archivos de una
 * instancia propia: Minecraft (cliente, librerías, assets) y las librerías del loader.
 *
 * Recibe: { commonDir, mc, extras: Asset[] }
 * Responde: { tipo: 'validando' | 'bajando', porcentaje }, { tipo: 'listo', javaMajor }
 * o { tipo: 'error', mensaje }.
 */
const { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize } = require('helios-core/dl')
const { validateLocalFile } = require('helios-core/common')

async function preparar({ commonDir, mc, extras }){
    const mojang = new MojangIndexProcessor(commonDir, mc)
    await mojang.init()

    const etapas = mojang.totalStages() + 1
    let hechas = 0
    const avanzar = () => {
        hechas++
        process.send({ tipo: 'validando', porcentaje: Math.trunc((hechas / etapas) * 100) })
    }

    const faltan = Object.values(await mojang.validate(async () => avanzar())).flat()
    for(const a of extras){
        if(!await validateLocalFile(a.path, a.algo, a.hash)){
            faltan.push(a)
        }
    }
    avanzar()

    if(faltan.length > 0){
        const total = getExpectedDownloadSize(faltan) || 1
        let actual = 0
        await downloadQueue(faltan, recibido => {
            const p = Math.min(100, Math.trunc((recibido / total) * 100))
            if(p !== actual){
                actual = p
                process.send({ tipo: 'bajando', porcentaje: p })
            }
        })
        await mojang.postDownload()
    }

    const version = await mojang.getVersionJson()
    process.send({
        tipo: 'listo',
        javaMajor: version.javaVersion?.majorVersion ?? 8,
        bajados: faltan.length
    })
}

process.on('message', async msg => {
    try {
        await preparar(msg)
    } catch(err) {
        console.error(err)
        process.send({ tipo: 'error', mensaje: err?.message || String(err) })
    }
})
