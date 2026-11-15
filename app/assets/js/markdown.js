/**
 * Markdown simple y seguro para las noticias: párrafos, títulos (#), listas (- * 1.),
 * negrita, cursiva, código en línea y links. Arma nodos del DOM (nunca HTML crudo),
 * así que una noticia no puede meter scripts ni estilos. Solo se aceptan links
 * http(s); el launcher los abre en el navegador.
 */

/**
 * Convierte el texto de una línea (negrita, cursiva, código, links) en nodos.
 */
function enLinea(doc, texto){
    const frag = doc.createDocumentFragment()
    // Orden: código, link, negrita, cursiva.
    const re = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)|(\*\*|__)(.+?)\4|(\*|_)(.+?)\6/g
    let ultimo = 0
    let m
    while((m = re.exec(texto)) != null){
        if(m.index > ultimo){
            frag.append(doc.createTextNode(texto.slice(ultimo, m.index)))
        }
        if(m[1]){
            const code = doc.createElement('code')
            code.textContent = m[1].slice(1, -1)
            frag.append(code)
        } else if(m[2] != null){
            const url = m[3]
            if(/^https?:\/\//i.test(url)){
                const a = doc.createElement('a')
                a.href = url
                a.append(enLinea(doc, m[2]))
                frag.append(a)
            } else {
                frag.append(enLinea(doc, m[2]))
            }
        } else if(m[5] != null){
            const b = doc.createElement('strong')
            b.append(enLinea(doc, m[5]))
            frag.append(b)
        } else if(m[7] != null){
            const i = doc.createElement('em')
            i.append(enLinea(doc, m[7]))
            frag.append(i)
        }
        ultimo = re.lastIndex
    }
    if(ultimo < texto.length){
        frag.append(doc.createTextNode(texto.slice(ultimo)))
    }
    return frag
}

/**
 * @param {string} md El texto en Markdown.
 * @param {Document} doc El documento donde se van a insertar los nodos.
 * @returns {DocumentFragment}
 */
exports.renderizar = function(md, doc = globalThis.document){
    const frag = doc.createDocumentFragment()
    const lineas = String(md ?? '').replace(/\r\n?/g, '\n').split('\n')
    let parrafo = []
    let lista = null

    const cerrarParrafo = () => {
        if(parrafo.length > 0){
            const p = doc.createElement('p')
            parrafo.forEach((l, i) => {
                if(i > 0){
                    p.append(doc.createElement('br'))
                }
                p.append(enLinea(doc, l))
            })
            frag.append(p)
            parrafo = []
        }
    }
    const cerrarLista = () => {
        if(lista != null){
            frag.append(lista)
            lista = null
        }
    }

    for(const linea of lineas){
        const item = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(linea)
        const titulo = /^\s*(#{1,6})\s+(.*)$/.exec(linea)
        if(item){
            cerrarParrafo()
            const tipo = item[1] ? 'ol' : 'ul'
            if(lista == null || lista.tagName.toLowerCase() !== tipo){
                cerrarLista()
                lista = doc.createElement(tipo)
            }
            const li = doc.createElement('li')
            li.append(enLinea(doc, item[2]))
            lista.append(li)
        } else if(titulo){
            cerrarParrafo()
            cerrarLista()
            const h = doc.createElement(titulo[1].length <= 2 ? 'h3' : 'h4')
            h.append(enLinea(doc, titulo[2]))
            frag.append(h)
        } else if(linea.trim() === ''){
            cerrarParrafo()
            cerrarLista()
        } else {
            cerrarLista()
            parrafo.push(linea.trim())
        }
    }
    cerrarParrafo()
    cerrarLista()
    return frag
}
