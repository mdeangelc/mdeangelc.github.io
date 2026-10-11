import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Una sola imagen convertida en escena: el cielo, el árbol y el prado
// están separados en capas (imágenes de máscaras) y cada uno se anima
// por su cuenta en un shader. El ratón o el móvil mueven las capas a
// distinta velocidad para dar profundidad.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ASPECTO_IMAGEN = 1917 / 878;
const FOCO = new THREE.Vector2(0.62, 0.5);


// =====================================================================
// 2. RENDERIZADOR Y TEXTURAS
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, movil ? 1.5 : 1.25));
renderizador.setSize(innerWidth, innerHeight);
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
const camara = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const cargador = new THREE.LoadingManager();
const lector = new THREE.TextureLoader(cargador);

function textura(nombre) {
    const t = lector.load("imagenes/" + nombre);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
}


// =====================================================================
// 3. EL SHADER DE LA ESCENA
// =====================================================================

const material = new THREE.ShaderMaterial({
    uniforms: {
        tImagen: { value: textura("tormenta.jpg") },
        tFondo: { value: textura("fondo.jpg") },
        tMascaras: { value: textura("mascaras.png") },
        uTiempo: { value: 0 },
        uPuntero: { value: new THREE.Vector2() },
        uVentana: { value: new THREE.Vector4(0, 0, 1, 1) },
        uAspecto: { value: 1 },
        uRayo: { value: 0 },
        uRayoVisible: { value: 0 },
        uRayoX: { value: 0.5 },
        uRayoSemilla: { value: 0 },
        uLluvia: { value: 0 },
        uViento: { value: 1 },
        uRacha: { value: 0 },
        uFundido: { value: 0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tImagen;
        uniform sampler2D tFondo;
        uniform sampler2D tMascaras;
        uniform float uTiempo;
        uniform vec2 uPuntero;
        uniform vec4 uVentana;
        uniform float uAspecto;
        uniform float uRayo;
        uniform float uRayoVisible;
        uniform float uRayoX;
        uniform float uRayoSemilla;
        uniform float uLluvia;
        uniform float uViento;
        uniform float uRacha;
        uniform float uFundido;
        varying vec2 vUv;

        float hash12(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        float ruido(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        float fbm(vec2 p) {
            float s = 0.0;
            float a = 0.5;
            for (int i = 0; i < 4; i++) {
                s += a * ruido(p);
                p = mat2(1.6, 1.2, -1.2, 1.6) * p;
                a *= 0.5;
            }
            return s;
        }

        float lluvia(vec2 p, float escala, float velocidad, float semilla) {
            p.x += p.y * 0.22;
            vec2 q = p * vec2(escala, escala * 0.07);
            q.y += uTiempo * velocidad;
            q.x += semilla;
            vec2 id = floor(q);
            vec2 f = fract(q);
            float h = hash12(id + semilla);
            float x = abs(f.x - (0.25 + 0.5 * h));
            float gota = smoothstep(0.07, 0.0, x) * smoothstep(0.0, 0.25, fract(f.y + h)) * smoothstep(1.0, 0.55, fract(f.y + h));
            return gota * step(0.45, h);
        }

        float rayo(vec2 p) {
            float x = uRayoX;
            float y = 1.0 - p.y;
            x += (fbm(vec2(y * 5.0, uRayoSemilla)) - 0.5) * 0.18;
            x += (ruido(vec2(y * 60.0, uRayoSemilla * 3.0)) - 0.5) * 0.018;
            x += (ruido(vec2(y * 160.0, uRayoSemilla * 5.0)) - 0.5) * 0.006;
            float d = abs(p.x - x);
            float nucleo = exp(-d * d * 400000.0);
            float halo = exp(-d * d * 6000.0) * 0.25 + exp(-d * d * 300.0) * 0.06;
            float rama = 0.0;
            if (y > 0.25) {
                float xr = x + (y - 0.25) * 0.5 * sign(hash12(vec2(uRayoSemilla)) - 0.5) + (ruido(vec2(y * 30.0, uRayoSemilla + 7.0)) - 0.5) * 0.03;
                float dr = abs(p.x - xr);
                rama = exp(-dr * dr * 120000.0) * smoothstep(0.75, 0.3, y);
            }
            return nucleo + halo + rama * 0.7;
        }

        void main() {
            vec2 base = uVentana.xy + vUv * uVentana.zw;
            vec4 m0 = texture2D(tMascaras, base);
            float profundidad = m0.a;
            float cerca = 1.0 - profundidad;

            vec2 desvio = uPuntero * vec2(0.010, 0.007);
            vec2 uvFondo = base + desvio * (0.25 + cerca * 1.6);
            vec4 m = texture2D(tMascaras, uvFondo);
            float cielo = m.r;
            float flores = m.b;
            float prado = 1.0 - cielo;
            float cercaFondo = 1.0 - m.a;

            float t = uTiempo;
            vec2 remolino = vec2(fbm(uvFondo * vec2(3.0, 5.0) + vec2(t * 0.03, t * 0.012)), fbm(uvFondo * vec2(3.0, 5.0) + vec2(5.2, 1.3) - vec2(t * 0.02, t * 0.025))) - 0.5;
            float bordeCielo = smoothstep(0.37, 0.45, uvFondo.y);
            uvFondo += remolino * 0.022 * cielo * bordeCielo;
            uvFondo.x += t * 0.0008 * cielo * bordeCielo - 0.0;

            float onda = sin(uvFondo.x * 28.0 - t * (1.6 + uRacha * 2.0) + fbm(uvFondo * 18.0) * 4.0);
            float rafaga = smoothstep(0.2, 1.0, sin(uvFondo.x * 3.0 - t * 0.9) * 0.5 + 0.5) * (0.5 + uRacha * 1.5);
            float vaiven = (onda * 0.5 + 0.5 * ruido(uvFondo * vec2(90.0, 30.0) + t * 1.5)) * rafaga;
            uvFondo.x += vaiven * 0.0025 * pow(cercaFondo, 1.4) * prado * uViento;
            uvFondo.y += abs(onda) * 0.0012 * pow(cercaFondo, 1.6) * prado * uViento * rafaga;
            uvFondo.x += sin(t * 3.0 + uvFondo.y * 200.0 + flores * 6.0) * 0.0012 * flores * cercaFondo * uViento;

            vec3 color = texture2D(tFondo, uvFondo).rgb;

            vec2 uvArbol = base + desvio * (0.25 + 0.2 * 1.6);
            float altura = clamp((uvArbol.y - 0.33) / 0.36, 0.0, 1.0);
            float balanceo = (sin(t * 0.9) * 0.6 + sin(t * 1.7 + 1.3) * 0.4) * (0.6 + uRacha);
            uvArbol.x += balanceo * 0.0028 * altura * altura * uViento;
            uvArbol += (vec2(ruido(uvArbol * 120.0 + t * 2.0), ruido(uvArbol * 120.0 - t * 2.0)) - 0.5) * 0.0012 * altura * uViento;
            float arbol = texture2D(tMascaras, uvArbol).g;
            vec3 colorArbol = texture2D(tImagen, uvArbol).rgb;

            vec2 pantalla = vec2(vUv.x * uAspecto, vUv.y);
            float luz = dot(color, vec3(0.299, 0.587, 0.114));
            float nubes = fbm(uvFondo * vec2(4.0, 7.0) + 3.0);
            float destello = uRayo * (0.5 + 2.2 * smoothstep(0.05, 0.4, luz)) * (0.4 + 0.6 * cielo);
            color *= 1.0 + destello;
            color += vec3(0.2, 0.22, 0.28) * uRayo * cielo * (0.25 + 0.75 * nubes) * smoothstep(0.0, 0.6, vUv.y + 0.2);
            color += vec3(0.05, 0.06, 0.07) * uRayo * prado;
            if (uRayoVisible > 0.01) {
                vec2 pr = vec2(vUv.x, vUv.y);
                color += vec3(0.85, 0.9, 1.0) * rayo(pr) * uRayoVisible * 1.8 * cielo;
            }

            float luzArbol = dot(colorArbol, vec3(0.299, 0.587, 0.114));
            colorArbol *= 1.0 + uRayo * (0.15 + 2.2 * smoothstep(0.05, 0.4, luzArbol));
            color = mix(color, colorArbol, arbol);

            if (uLluvia > 0.01) {
                float gotas = lluvia(pantalla, 140.0, 9.0, 0.0) * 0.6 + lluvia(pantalla, 80.0, 6.0, 17.0) * 0.9 + lluvia(pantalla, 45.0, 4.0, 31.0);
                color = mix(color, color * vec3(0.86, 0.9, 0.95), 0.25 * uLluvia);
                color += vec3(0.55, 0.6, 0.68) * gotas * 0.11 * uLluvia * (1.0 + uRayo * 5.0);
                float bruma = smoothstep(0.62, 0.3, vUv.y) * smoothstep(0.1, 0.4, vUv.y);
                color = mix(color, vec3(0.12, 0.13, 0.15), bruma * 0.18 * uLluvia);
            }

            vec2 d = vUv - 0.5;
            color *= 1.0 - dot(d, d) * 0.55;
            color += (hash12(gl_FragCoord.xy + fract(t) * 97.0) - 0.5) * 0.025;
            gl_FragColor = vec4(color * uFundido, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const cuadro = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
cuadro.frustumCulled = false;
escena.add(cuadro);


// =====================================================================
// 4. ENCUADRE
// La imagen cubre la pantalla entera; en vertical se recorta dejando
// el árbol en el centro. Se deja un poco de margen para la profundidad.
// =====================================================================

function encuadrar() {
    renderizador.setSize(innerWidth, innerHeight);
    const aspecto = innerWidth / innerHeight;
    let ancho = 1;
    let alto = 1;
    if (aspecto > ASPECTO_IMAGEN) alto = ASPECTO_IMAGEN / aspecto;
    else ancho = aspecto / ASPECTO_IMAGEN;
    ancho *= 0.95;
    alto *= 0.95;
    const x = Math.min(1 - ancho / 2, Math.max(ancho / 2, FOCO.x)) - ancho / 2;
    const y = Math.min(1 - alto / 2, Math.max(alto / 2, FOCO.y)) - alto / 2;
    material.uniforms.uVentana.value.set(x, y, ancho, alto);
    material.uniforms.uAspecto.value = aspecto;
}

window.addEventListener("resize", encuadrar);
encuadrar();


// =====================================================================
// 5. RELÁMPAGOS, VIENTO Y LLUVIA
// =====================================================================

const tormenta = { rayo: null, siguiente: 4, racha: 0, lluvia: parametros.get("lluvia") === "si" ? 1 : 0, objetivoLluvia: parametros.get("lluvia") === "si" ? 1 : 0 };

function lanzarRayo(x) {
    tormenta.rayo = {
        t: 0,
        x: x ?? 0.15 + Math.random() * 0.7,
        golpes: [0, 0.09 + Math.random() * 0.05, 0.22 + Math.random() * 0.1].slice(0, 2 + Math.floor(Math.random() * 2))
    };
    material.uniforms.uRayoX.value = tormenta.rayo.x;
    material.uniforms.uRayoSemilla.value = Math.random() * 100;
    tronar(0.5 + Math.random() * 1.2);
}

function moverTormenta(delta) {
    const u = material.uniforms;
    tormenta.siguiente -= delta;
    if (tormenta.siguiente <= 0) {
        tormenta.siguiente = 7 + Math.random() * 12;
        lanzarRayo();
    }
    let destello = 0;
    let visible = 0;
    const r = tormenta.rayo;
    if (r) {
        r.t += delta;
        r.golpes.forEach((g) => {
            const k = r.t - g;
            if (k >= 0) destello = Math.max(destello, Math.exp(-k * 14) * (k < 0.03 ? k / 0.03 : 1));
        });
        visible = r.t < 0.35 ? Math.min(1, destello * 1.5 + 0.2) : 0;
        if (r.t > 1.5) tormenta.rayo = null;
    }
    u.uRayo.value = destello * 0.9;
    u.uRayoVisible.value = visible;
    tormenta.racha = Math.max(0, tormenta.racha - delta * 0.35);
    u.uRacha.value = tormenta.racha;
    u.uViento.value = 0.75 + 0.35 * Math.sin(u.uTiempo.value * 0.21) * Math.sin(u.uTiempo.value * 0.13 + 1) + tormenta.racha * 0.6;
    tormenta.lluvia += (tormenta.objetivoLluvia - tormenta.lluvia) * Math.min(1, delta * 0.8);
    u.uLluvia.value = tormenta.lluvia;
    moverSonido();
}

const botonLluvia = document.getElementById("boton-lluvia");
const botonRayo = document.getElementById("boton-rayo");

function ponerLluvia(activa) {
    tormenta.objetivoLluvia = activa ? 1 : 0;
    botonLluvia.classList.toggle("activo", activa);
    botonLluvia.setAttribute("aria-pressed", activa);
}

botonLluvia.addEventListener("click", () => ponerLluvia(tormenta.objetivoLluvia < 0.5));
botonRayo.addEventListener("click", () => lanzarRayo());
ponerLluvia(tormenta.objetivoLluvia > 0.5);


// =====================================================================
// 6. PUNTERO Y MÓVIL
// Mover el ratón o inclinar el móvil desplaza las capas. Tocar el cielo
// lanza un rayo ahí; tocar el prado levanta una racha de viento.
// =====================================================================

const puntero = { x: 0, y: 0, objetivoX: 0, objetivoY: 0 };
const pista = document.getElementById("pista");

renderizador.domElement.addEventListener("pointermove", (evento) => {
    if (evento.pointerType === "touch") return;
    puntero.objetivoX = (evento.clientX / innerWidth) * 2 - 1;
    puntero.objetivoY = -((evento.clientY / innerHeight) * 2 - 1);
});

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    pedirOrientacion();
    pista.classList.add("oculta");
    const u = evento.clientX / innerWidth;
    const v = 1 - evento.clientY / innerHeight;
    const ventana = material.uniforms.uVentana.value;
    const yImagen = ventana.y + v * ventana.w;
    if (yImagen > 0.4) lanzarRayo(u);
    else tormenta.racha = 1;
});

let orientacionPedida = false;

function pedirOrientacion() {
    if (orientacionPedida) return;
    orientacionPedida = true;
    let referencia = null;
    const escuchar = () => window.addEventListener("deviceorientation", (e) => {
        if (e.gamma == null || e.beta == null) return;
        if (!referencia) referencia = { beta: e.beta, gamma: e.gamma };
        puntero.objetivoX = Math.max(-1, Math.min(1, (e.gamma - referencia.gamma) / 20));
        puntero.objetivoY = Math.max(-1, Math.min(1, -(e.beta - referencia.beta) / 20));
    });
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().then((r) => r === "granted" && escuchar()).catch(() => {});
    } else escuchar();
}

if (movil && !(typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function")) pedirOrientacion();


// =====================================================================
// 7. SONIDO
// Viento, lluvia y truenos hechos con ruido filtrado.
// =====================================================================

let audio = null;
let sonidoActivo = false;
const botonSonido = document.getElementById("boton-sonido");

function crearAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const general = ctx.createGain();
    general.gain.value = 0;
    general.connect(ctx.destination);
    const largo = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    for (let i = 0; i < largo; i++) datos[i] = Math.random() * 2 - 1;
    const fuente = (filtro, frecuencia, q, volumen) => {
        const s = ctx.createBufferSource();
        s.buffer = buffer;
        s.loop = true;
        s.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = ctx.createBiquadFilter();
        f.type = filtro;
        f.frequency.value = frecuencia;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = volumen;
        s.connect(f).connect(g).connect(general);
        s.start();
        return { f, g };
    };
    const viento = fuente("bandpass", 400, 0.8, 0.25);
    const lluvia = fuente("highpass", 1800, 0.5, 0);
    return { ctx, general, buffer, viento, lluvia };
}

function tronar(retraso) {
    if (!audio || !sonidoActivo) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime + retraso;
    const s = ctx.createBufferSource();
    s.buffer = audio.buffer;
    s.playbackRate.value = 0.35 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.6, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    s.connect(f).connect(g).connect(audio.general);
    s.start(t);
    s.stop(t + 4.2);
    s.onended = () => {
        s.disconnect();
        f.disconnect();
        g.disconnect();
    };
}

function moverSonido() {
    if (!audio || !sonidoActivo) return;
    const t = audio.ctx.currentTime;
    const u = material.uniforms;
    audio.viento.f.frequency.setTargetAtTime(250 + u.uViento.value * 350, t, 0.3);
    audio.viento.g.gain.setTargetAtTime(0.12 + u.uViento.value * 0.2, t, 0.3);
    audio.lluvia.g.gain.setTargetAtTime(tormenta.lluvia * 0.22, t, 0.3);
}

botonSonido.addEventListener("click", () => {
    if (!audio) audio = crearAudio();
    audio.ctx.resume();
    sonidoActivo = !sonidoActivo;
    botonSonido.classList.toggle("activo", sonidoActivo);
    botonSonido.setAttribute("aria-pressed", sonidoActivo);
    audio.general.gain.setTargetAtTime(sonidoActivo ? 0.6 : 0, audio.ctx.currentTime, 0.4);
});


// =====================================================================
// 8. LAS TARJETAS
// =====================================================================

const botonPaisaje = document.getElementById("boton-paisaje");
const tarjetas = [...document.querySelectorAll(".tarjeta")];

function mostrarTarjetas(mostrar) {
    document.body.classList.toggle("sin-tarjetas", !mostrar);
    botonPaisaje.textContent = mostrar ? "Ver el paisaje" : "Ver tarjetas";
    botonPaisaje.setAttribute("aria-pressed", !mostrar);
    if (mostrar) {
        tarjetas.forEach((t) => {
            t.classList.remove("oculta");
            requestAnimationFrame(() => t.classList.remove("cerrada"));
        });
    }
}

botonPaisaje.addEventListener("click", () => mostrarTarjetas(document.body.classList.contains("sin-tarjetas")));

tarjetas.forEach((tarjeta) => {
    tarjeta.querySelector(".cerrar").addEventListener("click", () => {
        tarjeta.classList.add("cerrada");
        setTimeout(() => {
            if (tarjeta.classList.contains("cerrada")) tarjeta.classList.add("oculta");
        }, 350);
        if (tarjetas.every((t) => t.classList.contains("cerrada"))) mostrarTarjetas(false);
    });
});

if (parametros.get("tarjetas") === "no") mostrarTarjetas(false);


// =====================================================================
// 9. CARGA Y BUCLE
// =====================================================================

const cargando = document.getElementById("cargando");
const reloj = new THREE.Clock();
let listo = false;

cargador.onLoad = () => {
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
    setTimeout(() => lanzarRayo(0.3), 1800);
};

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    if (!listo) return;
    const u = material.uniforms;
    u.uTiempo.value += delta;
    u.uFundido.value = Math.min(1, u.uFundido.value + delta * 0.6);
    puntero.x += (puntero.objetivoX - puntero.x) * Math.min(1, delta * 2.5);
    puntero.y += (puntero.objetivoY - puntero.y) * Math.min(1, delta * 2.5);
    u.uPuntero.value.set(puntero.x, puntero.y);
    moverTormenta(delta);
    renderizador.render(escena, camara);
}

animar();
