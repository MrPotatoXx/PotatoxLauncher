const net = require('net')

/**
 * Retrieves the status of a minecraft server.
 * 
 * @param {string} address The server address.
 * @param {number} port Optional. The port of the server. Defaults to 25565.
 * @returns {Promise.<Object>} A promise which resolves to an object containing
 * status information.
 */
exports.getStatus = function(address, port = 25565){

    if(port == null || port == ''){
        port = 25565
    }
    if(typeof port === 'string'){
        port = parseInt(port)
    }

    return new Promise((resolve, reject) => {
        const socket = net.connect(port, address, () => {
            let buff = Buffer.from([0xFE, 0x01])
            socket.write(buff)
        })

        socket.setTimeout(2500, () => {
            socket.end()
            reject({
                code: 'ETIMEDOUT',
                errno: 'ETIMEDOUT',
                address,
                port
            })
        })

        socket.on('data', (data) => {
            if(data != null && data != ''){
                let server_info = data.toString().split('\x00\x00\x00')
                const NUM_FIELDS = 6
                if(server_info != null && server_info.length >= NUM_FIELDS){
                    resolve({
                        online: true,
                        version: server_info[2].replace(/\u0000/g, ''),
                        motd: server_info[3].replace(/\u0000/g, ''),
                        onlinePlayers: server_info[4].replace(/\u0000/g, ''),
                        maxPlayers: server_info[5].replace(/\u0000/g,'')
                    })
                } else {
                    resolve({
                        online: false
                    })
                }
            }
            socket.end()
        })

        socket.on('error', (err) => {
            socket.destroy()
            reject(err)
            // ENOTFOUND = Unable to resolve.
            // ECONNREFUSED = Unable to connect to port.
        })
    })

}
/**
 * Estado con el protocolo actual (Server List Ping). A diferencia de getStatus,
 * trae la versión, el MOTD y una muestra de los jugadores conectados.
 *
 * @param {string} address El servidor.
 * @param {number} port El puerto (25565 por defecto).
 * @returns {Promise<{online: boolean, onlinePlayers: number, maxPlayers: number, version: string, motd: string, jugadores: Array<{name: string, id: string}>}>}
 */
exports.getStatusModerno = function(address, port = 25565){
    const varint = n => {
        const bytes = []
        do {
            let b = n & 0x7F
            n >>>= 7
            if(n !== 0){
                b |= 0x80
            }
            bytes.push(b)
        } while(n !== 0)
        return Buffer.from(bytes)
    }
    const leerVarint = (buf, pos) => {
        let valor = 0
        let corrimiento = 0
        while(pos < buf.length){
            const b = buf[pos++]
            valor |= (b & 0x7F) << corrimiento
            if((b & 0x80) === 0){
                return [valor, pos]
            }
            corrimiento += 7
            if(corrimiento > 35){
                throw new Error('VarInt demasiado largo')
            }
        }
        return null
    }
    const paquete = (...partes) => {
        const cuerpo = Buffer.concat(partes)
        return Buffer.concat([varint(cuerpo.length), cuerpo])
    }

    return new Promise((resolve, reject) => {
        const socket = net.connect(port, address)
        let recibido = Buffer.alloc(0)
        socket.setTimeout(3000, () => {
            socket.destroy()
            reject(new Error('ETIMEDOUT'))
        })
        socket.on('connect', () => {
            const host = Buffer.from(address, 'utf8')
            const puerto = Buffer.alloc(2)
            puerto.writeUInt16BE(port)
            // Handshake (estado siguiente 1 = status) y pedido de estado.
            socket.write(paquete(varint(0x00), varint(767), varint(host.length), host, puerto, varint(1)))
            socket.write(paquete(varint(0x00)))
        })
        socket.on('data', data => {
            recibido = Buffer.concat([recibido, data])
            try {
                const largo = leerVarint(recibido, 0)
                if(largo == null || recibido.length < largo[1] + largo[0]){
                    return
                }
                const [, posId] = leerVarint(recibido, largo[1])
                const [largoTexto, posTexto] = leerVarint(recibido, posId)
                const json = JSON.parse(recibido.subarray(posTexto, posTexto + largoTexto).toString('utf8'))
                socket.destroy()
                const motd = typeof json.description === 'string'
                    ? json.description
                    : [json.description?.text ?? '', ...(json.description?.extra ?? []).map(e => e.text ?? '')].join('')
                resolve({
                    online: true,
                    onlinePlayers: json.players?.online ?? 0,
                    maxPlayers: json.players?.max ?? 0,
                    version: json.version?.name ?? '',
                    motd: motd.replace(/§./g, ''),
                    jugadores: Array.isArray(json.players?.sample) ? json.players.sample : []
                })
            } catch(err) {
                socket.destroy()
                reject(err)
            }
        })
        socket.on('error', err => {
            socket.destroy()
            reject(err)
        })
    })
}
