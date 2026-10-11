/**
 * Ambiente de la ventana: brasas y ceniza subiendo muy sutil, parallax del
 * fondo con el mouse y brasas al pasar por los botones con [data-brasas].
 *
 * Se pausa con document.hidden y respeta prefers-reduced-motion. Con
 * body[luna] (Luna de Sangre, lo pone reino.js) las brasas se vuelven más rojas.
 */
(function(){

    const PARTICULAS = 24
    const PARALLAX = 12 // px máximos hacia cada lado

    const fondo = document.getElementById('fondoReino')
    const canvas = document.getElementById('ambienteBrasas')
    const ctx = canvas.getContext('2d')
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const particulas = []
    let ancho = 0
    let alto = 0
    let objetivoX = 0
    let objetivoY = 0
    let fondoX = 0
    let fondoY = 0
    let luna = 0 // 0 normal, 1 Luna de Sangre; cambia de a poco
    let ultimo = 0
    let raf = null

    function redimensionar(){
        const dpr = window.devicePixelRatio || 1
        ancho = window.innerWidth
        alto = window.innerHeight
        canvas.width = Math.round(ancho * dpr)
        canvas.height = Math.round(alto * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function nacer(p, enCualquierLado){
        // Un tercio es ceniza gris; el resto, brasas.
        p.ceniza = Math.random() < 0.33
        p.x = Math.random() * ancho
        p.y = enCualquierLado ? Math.random() * alto : alto + 10
        p.r = p.ceniza ? 0.8 + Math.random() * 1.2 : 0.7 + Math.random() * 1.4
        p.vx = (Math.random() - 0.5) * 10
        p.vy = -(p.ceniza ? 6 + Math.random() * 10 : 12 + Math.random() * 22)
        p.fase = Math.random() * Math.PI * 2
        p.calor = Math.random() // del naranja al rojo
        return p
    }

    function cuadro(t){
        raf = requestAnimationFrame(cuadro)
        const dt = Math.min(0.05, (t - ultimo) / 1000)
        ultimo = t
        const seg = t / 1000

        // Parallax suave del fondo.
        fondoX += (objetivoX - fondoX) * Math.min(1, dt * 3)
        fondoY += (objetivoY - fondoY) * Math.min(1, dt * 3)
        fondo.style.transform = `translate3d(${fondoX.toFixed(2)}px, ${fondoY.toFixed(2)}px, 0)`

        luna += ((document.body.hasAttribute('luna') ? 1 : 0) - luna) * Math.min(1, dt * 0.8)

        ctx.clearRect(0, 0, ancho, alto)
        for(const p of particulas){
            p.x += (p.vx + Math.sin(seg * 0.8 + p.fase) * 8) * dt
            p.y += p.vy * dt
            if(p.y < -10 || p.x < -10 || p.x > ancho + 10){
                nacer(p, false)
            }
            // Se apagan al subir.
            const altura = Math.max(0, Math.min(1, p.y / alto))
            const parpadeo = 0.5 + 0.5 * Math.sin(seg * 3 + p.fase * 5)
            if(p.ceniza){
                ctx.shadowBlur = 0
                ctx.globalAlpha = 0.18 + 0.2 * altura
                ctx.fillStyle = '#9a8f86'
            } else {
                const g = Math.round(150 - 110 * Math.max(p.calor, luna))
                const color = `rgb(255, ${g}, ${Math.round(40 * (1 - luna))})`
                ctx.shadowBlur = 8
                ctx.shadowColor = color
                ctx.globalAlpha = (0.25 + 0.55 * altura) * (0.6 + 0.4 * parpadeo)
                ctx.fillStyle = color
            }
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
    }

    function iniciar(){
        if(raf == null && !document.hidden && !reducido){
            ultimo = performance.now()
            raf = requestAnimationFrame(cuadro)
        }
    }

    function detener(){
        if(raf != null){
            cancelAnimationFrame(raf)
            raf = null
        }
    }

    redimensionar()
    for(let i = 0; i < PARTICULAS; i++){
        particulas.push(nacer({}, true))
    }

    window.addEventListener('resize', redimensionar)
    window.addEventListener('mousemove', e => {
        objetivoX = (0.5 - e.clientX / ancho) * 2 * PARALLAX
        objetivoY = (0.5 - e.clientY / alto) * 2 * PARALLAX * 0.6
    })
    document.addEventListener('visibilitychange', () => {
        if(document.hidden){
            detener()
        } else {
            iniciar()
        }
    })
    iniciar()

    // Unas pocas brasas al pasar el mouse por encima.
    document.querySelectorAll('[data-brasas]').forEach(boton => {
        boton.addEventListener('mouseenter', () => {
            if(reducido || boton.disabled){
                return
            }
            for(let i = 0; i < 8; i++){
                const brasa = document.createElement('span')
                brasa.className = 'brasa'
                brasa.style.left = (8 + Math.random() * 84) + '%'
                brasa.style.top = (35 + Math.random() * 40) + '%'
                brasa.style.setProperty('--dx', ((Math.random() - 0.5) * 40).toFixed(1) + 'px')
                brasa.style.setProperty('--dy', (-(18 + Math.random() * 34)).toFixed(1) + 'px')
                brasa.style.animationDelay = (Math.random() * 0.2).toFixed(2) + 's'
                brasa.addEventListener('animationend', () => brasa.remove())
                boton.appendChild(brasa)
            }
        })
    })

})()
