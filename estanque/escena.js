import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Una captura de Minecraft convertida en escena viva. La imagen se
// separa en capas con dos imágenes de máscaras (agua, primer plano,
// zonas que se mecen, profundidad, nenúfares, cielo y luces) y cada
// zona se anima por su cuenta en el shader.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ANCHO = 1315;
const ALTO = 676;
const ASPECTO_IMAGEN = ANCHO / ALTO;
const FOCO = new THREE.Vector2(0.55, 0.45);
const ORILLA = 1 - 398 / ALTO;
const enImagen = (x, y) => new THREE.Vector2(x / ANCHO, 1 - y / ALTO);
const FAROLES = [[258, 325], [905, 315], [248, 258], [685, 268], [940, 276], [1160, 300], [470, 300]].map(([x, y]) => enImagen(x, y));
const CHIMENEAS = [[618, 112], [752, 130]].map(([x, y]) => enImagen(x, y));


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

const MAX_ONDAS = 6;


// =====================================================================
// 3. EL SHADER DE LA ESCENA
// =====================================================================

const material = new THREE.ShaderMaterial({
    uniforms: {
        tImagen: { value: textura("estanque.jpg") },
        tFondo: { value: textura("fondo.jpg") },
        tMascaras: { value: textura("mascaras.png") },
        tMascaras2: { value: textura("mascaras2.png") },
        uTiempo: { value: 0 },
        uPuntero: { value: new THREE.Vector2() },
        uVentana: { value: new THREE.Vector4(0, 0, 1, 1) },
        uNoche: { value: 0 },
        uFundido: { value: 0 },
        uOndas: { value: Array.from({ length: MAX_ONDAS }, () => new THREE.Vector4(0, 0, 99, 0)) },
        uFaroles: { value: FAROLES },
        uChimeneas: { value: CHIMENEAS }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        #define ASPECTO ${ASPECTO_IMAGEN.toFixed(4)}
        #define ORILLA ${ORILLA.toFixed(4)}
        uniform sampler2D tImagen;
        uniform sampler2D tFondo;
        uniform sampler2D tMascaras;
        uniform sampler2D tMascaras2;
        uniform float uTiempo;
        uniform vec2 uPuntero;
        uniform vec4 uVentana;
        uniform float uNoche;
        uniform float uFundido;
        uniform vec4 uOndas[${MAX_ONDAS}];
        uniform vec2 uFaroles[${FAROLES.length}];
        uniform vec2 uChimeneas[${CHIMENEAS.length}];
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

        float humo(vec2 uv, vec2 base, float t) {
            vec2 q = (uv - base) * vec2(ASPECTO, 1.0) / 0.1;
            if (q.y < -0.1 || q.y > 2.5) return 0.0;
            float deriva = q.y * q.y * 0.18 + sin(t * 0.4 + q.y * 1.5) * 0.08 * q.y;
            float ancho = 0.12 + q.y * 0.28;
            float columna = smoothstep(ancho, 0.0, abs(q.x - deriva));
            float textura = fbm(vec2(q.x * 3.0, q.y * 2.0 - t * 0.6));
            return columna * smoothstep(0.35, 0.7, textura + 0.15) * smoothstep(-0.05, 0.15, q.y) * smoothstep(2.4, 0.6, q.y);
        }

        float hoja(vec2 uv, float i, float t) {
            float ciclo = fract(t * 0.045 + i * 0.173);
            vec2 inicio = vec2(0.04 + fract(i * 0.37) * 0.3, 0.78 - fract(i * 0.61) * 0.12);
            vec2 p = inicio + vec2(ciclo * 0.08 + sin(t * 1.3 + i * 4.0) * 0.025, -ciclo * 0.5);
            vec2 q = (uv - p) * vec2(ASPECTO, 1.0);
            float a = sin(t * 2.0 + i) * 1.2;
            q = mat2(cos(a), sin(a), -sin(a), cos(a)) * q;
            float tam = 0.0055 * (0.7 + fract(i * 0.9) * 0.6);
            float cuadro = step(abs(q.x), tam) * step(abs(q.y), tam * 0.75);
            return cuadro * smoothstep(1.0, 0.85, ciclo) * smoothstep(0.0, 0.05, ciclo);
        }

        void main() {
            float t = uTiempo;
            vec2 base = uVentana.xy + vUv * uVentana.zw;
            float profundidad = texture2D(tMascaras, base).a;
            vec2 desvio = uPuntero * vec2(0.012, 0.008);

            vec2 uvF = base + desvio * (0.2 + (1.0 - profundidad) * 1.2);
            vec4 m = texture2D(tMascaras, uvF);
            vec4 m2 = texture2D(tMascaras2, uvF);
            float agua = m.r;
            float cerca = clamp((ORILLA - uvF.y) / ORILLA, 0.0, 1.0);

            uvF.x += sin(t * 1.4 + uvF.y * 25.0 + uvF.x * 9.0) * 0.0016 * m.b * (1.0 - m.g);
            uvF += (vec2(fbm(uvF * 6.0 + t * 0.05), fbm(uvF * 6.0 - t * 0.04 + 3.0)) - 0.5) * 0.01 * m2.g;

            vec3 color;
            if (agua > 0.01) {
                float z = 1.0 / (0.12 + cerca);
                vec2 plano = vec2((uvF.x - 0.5) * z * 2.0, z);
                vec2 n = vec2(ruido(plano * vec2(3.0, 6.0) + vec2(t * 0.15, -t * 0.4)), ruido(plano * vec2(3.0, 6.0) + vec2(-t * 0.12, -t * 0.35) + 5.0)) - 0.5;
                n += (vec2(ruido(plano * vec2(9.0, 18.0) - vec2(t * 0.3, t * 0.8)), ruido(plano * vec2(9.0, 18.0) + vec2(t * 0.25, -t * 0.7) + 9.0)) - 0.5) * 0.5;
                vec2 desplazamiento = n * vec2(0.007, 0.004) * (0.35 + cerca);
                float brillo = 0.0;
                for (int i = 0; i < ${MAX_ONDAS}; i++) {
                    vec4 o = uOndas[i];
                    if (o.z > 6.0) continue;
                    float aplasta = 2.2 + (1.0 - cerca) * 4.0;
                    vec2 dd = (uvF - o.xy) * vec2(ASPECTO, ASPECTO * aplasta);
                    float d = length(dd);
                    float frente = o.z * 0.11;
                    float anillo = sin(d * 160.0 - o.z * 16.0) * exp(-o.z * 1.1) * smoothstep(frente + 0.01, frente - 0.03, d) * smoothstep(0.0, 0.02, d) * o.w;
                    desplazamiento += normalize(dd + 1e-5) * anillo * 0.009 / vec2(ASPECTO, ASPECTO * aplasta) * 2.0;
                    brillo += max(anillo, 0.0) * 0.4;
                }
                vec2 uvA = uvF + desplazamiento * agua;
                if (texture2D(tMascaras, uvA).r < 0.5) uvA = uvF;
                color = texture2D(tFondo, uvA).rgb;
                float centelleo = pow(ruido(plano * vec2(14.0, 28.0) + vec2(t * 0.6, -t * 1.2)), 10.0);
                float luzReflejo = dot(color, vec3(0.3, 0.5, 0.2));
                color += vec3(1.0, 0.98, 0.92) * (centelleo * smoothstep(0.35, 0.8, luzReflejo) * 0.9 + brillo * 0.6) * agua * (1.0 - uNoche * 0.7);
                color = mix(texture2D(tFondo, uvF).rgb, color, agua);
            } else {
                color = texture2D(tFondo, uvF).rgb;
            }

            vec2 balanceoNenufar = vec2(sin(t * 1.2 + uvF.x * 40.0) * 0.0012, sin(t * 1.5 + uvF.x * 30.0) * 0.0018);
            float nenufar = texture2D(tMascaras2, uvF - balanceoNenufar).r;
            color = mix(color, texture2D(tImagen, uvF - balanceoNenufar).rgb, nenufar);

            float h = 0.0;
            for (int i = 0; i < ${CHIMENEAS.length}; i++) h = max(h, humo(uvF, uChimeneas[i], t + float(i) * 3.0));
            color = mix(color, mix(vec3(0.9, 0.92, 0.95), vec3(0.35, 0.38, 0.45), uNoche), h * 0.6);

            vec2 uvP = base + desvio * (0.2 + 0.94 * 1.2);
            vec4 mp = texture2D(tMascaras, uvP);
            uvP += vec2(sin(t * 1.1 + uvP.y * 8.0) * 0.0035, sin(t * 1.7 + uvP.x * 10.0) * 0.0015) * mp.b;
            uvP += (vec2(ruido(uvP * 140.0 + t * 1.5), ruido(uvP * 140.0 - t * 1.5)) - 0.5) * 0.0015 * mp.b;
            float primer = texture2D(tMascaras, uvP).g;
            color = mix(color, texture2D(tImagen, uvP).rgb, primer);

            float hojas = 0.0;
            for (int i = 0; i < 7; i++) hojas = max(hojas, hoja(vUv * uVentana.zw + uVentana.xy, float(i), t));
            color = mix(color, mix(vec3(0.42, 0.62, 0.16), vec3(0.62, 0.78, 0.25), hash12(floor(vUv * 50.0))), hojas * (1.0 - uNoche * 0.6));

            float luces = texture2D(tMascaras2, uvF).b;
            float calido = smoothstep(0.12, 0.4, color.r - color.b) * smoothstep(0.35, 0.7, color.r) * smoothstep(0.45, 0.6, color.g) * agua * (1.0 - primer);
            vec3 noche = color * vec3(0.2, 0.26, 0.46);
            noche = mix(noche, color * vec3(1.25, 1.0, 0.75), max(luces * (1.0 - primer), calido * 0.85));
            color = mix(color, noche, uNoche);

            vec2 uvImagen = vUv * uVentana.zw + uVentana.xy;
            for (int i = 0; i < ${FAROLES.length}; i++) {
                vec2 dd = (uvImagen - uFaroles[i]) * vec2(ASPECTO, 1.0);
                float parpadeo = 0.85 + 0.15 * sin(t * 13.0 + float(i) * 2.0) * sin(t * 7.3 + float(i));
                color += vec3(1.0, 0.7, 0.35) * exp(-dot(dd, dd) * 900.0) * parpadeo * (0.12 + uNoche * 0.55);
            }

            if (uNoche > 0.01) {
                vec2 celda = floor(uvImagen * vec2(220.0, 110.0));
                float estrella = step(0.993, hash12(celda)) * (0.6 + 0.4 * sin(t * 2.0 + hash12(celda) * 40.0));
                color += vec3(0.9, 0.95, 1.0) * estrella * m2.g * uNoche;
                for (int i = 0; i < 16; i++) {
                    float fi = float(i);
                    vec2 c = vec2(fract(fi * 0.217 + 0.1) * 0.9 + 0.05 + sin(t * 0.3 + fi) * 0.03, 0.15 + fract(fi * 0.53) * 0.35 + sin(t * 0.4 + fi * 2.0) * 0.02);
                    vec2 dd = (uvImagen - c) * vec2(ASPECTO, 1.0);
                    float on = smoothstep(0.3, 1.0, sin(t * 1.3 + fi * 5.0));
                    color += vec3(0.75, 1.0, 0.35) * (exp(-dot(dd, dd) * 60000.0) * 1.5 + exp(-dot(dd, dd) * 4000.0) * 0.2) * on * uNoche;
                }
            }

            vec2 d = vUv - 0.5;
            color *= 1.0 - dot(d, d) * 0.4;
            color += (hash12(gl_FragCoord.xy + fract(t) * 97.0) - 0.5) * 0.02;
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
}

window.addEventListener("resize", encuadrar);
encuadrar();


// =====================================================================
// 5. TOCAR EL AGUA
// =====================================================================

const puntero = { x: 0, y: 0, objetivoX: 0, objetivoY: 0, ultimo: null };
const pista = document.getElementById("pista");
let ondaSiguiente = 0;

function aImagen(evento) {
    const v = material.uniforms.uVentana.value;
    return new THREE.Vector2(v.x + (evento.clientX / innerWidth) * v.z, v.y + (1 - evento.clientY / innerHeight) * v.w);
}

function soltarOnda(p, fuerza) {
    if (p.y > ORILLA - 0.01) return false;
    const o = material.uniforms.uOndas.value[ondaSiguiente];
    o.set(p.x, p.y, 0, fuerza);
    ondaSiguiente = (ondaSiguiente + 1) % MAX_ONDAS;
    return true;
}

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    pedirOrientacion();
    pista.classList.add("oculta");
    if (soltarOnda(aImagen(evento), 1)) sonarGota(0.6);
    puntero.ultimo = { x: evento.clientX, y: evento.clientY };
});

renderizador.domElement.addEventListener("pointermove", (evento) => {
    if (evento.pointerType !== "touch") {
        puntero.objetivoX = (evento.clientX / innerWidth) * 2 - 1;
        puntero.objetivoY = -((evento.clientY / innerHeight) * 2 - 1);
    }
    if (!puntero.ultimo || evento.buttons === 0) return;
    if (Math.hypot(evento.clientX - puntero.ultimo.x, evento.clientY - puntero.ultimo.y) < 40) return;
    puntero.ultimo = { x: evento.clientX, y: evento.clientY };
    soltarOnda(aImagen(evento), 0.5);
});

renderizador.domElement.addEventListener("pointerup", () => {
    puntero.ultimo = null;
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

let siguientePez = 3;

function vidaDelAgua(delta) {
    material.uniforms.uOndas.value.forEach((o) => (o.z += delta));
    siguientePez -= delta;
    if (siguientePez > 0) return;
    siguientePez = 3 + Math.random() * 6;
    soltarOnda(new THREE.Vector2(0.3 + Math.random() * 0.5, 0.08 + Math.random() * 0.28), 0.35);
}


// =====================================================================
// 6. DÍA Y NOCHE
// =====================================================================

let momento = parametros.get("momento") === "noche" ? "noche" : "dia";

function cambiarMomento(nuevo) {
    momento = nuevo;
    document.querySelectorAll("[data-momento]").forEach((boton) => {
        const activo = boton.dataset.momento === nuevo;
        boton.classList.toggle("activo", activo);
        boton.setAttribute("aria-pressed", activo);
    });
}

document.querySelectorAll("[data-momento]").forEach((boton) => {
    boton.addEventListener("click", () => cambiarMomento(boton.dataset.momento));
});
cambiarMomento(momento);
material.uniforms.uNoche.value = momento === "noche" ? 1 : 0;


// =====================================================================
// 7. SONIDO
// Agua tranquila, pájaros de día y grillos de noche.
// =====================================================================

let audio = null;
let sonidoActivo = false;
const botonSonido = document.getElementById("boton-sonido");

function crearAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const general = ctx.createGain();
    general.gain.value = 0;
    general.connect(ctx.destination);
    const largo = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let ultimo = 0;
    for (let i = 0; i < largo; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        datos[i] = ultimo * 3.5;
    }
    const agua = ctx.createBufferSource();
    agua.buffer = buffer;
    agua.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 500;
    const volumen = ctx.createGain();
    volumen.gain.value = 0.35;
    agua.connect(filtro).connect(volumen).connect(general);
    agua.start();
    return { ctx, general, filtro, siguiente: 1 };
}

function pitido(frecuencia, final, duracion, volumen, retraso = 0) {
    const ctx = audio.ctx;
    const t = ctx.currentTime + retraso;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.frequency.setValueAtTime(frecuencia, t);
    osc.frequency.exponentialRampToValueAtTime(final, t + duracion);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(volumen, t + 0.01);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    osc.connect(vol).connect(audio.general);
    osc.start(t);
    osc.stop(t + duracion + 0.02);
    osc.onended = () => {
        osc.disconnect();
        vol.disconnect();
    };
}

function sonarGota(fuerza) {
    if (!audio || !sonidoActivo) return;
    const base = 280 + Math.random() * 200;
    pitido(base, base * (2.5 + Math.random()), 0.08 + fuerza * 0.05, 0.12 * fuerza);
}

function moverSonido(delta) {
    if (!audio || !sonidoActivo) return;
    const t = audio.ctx.currentTime;
    audio.filtro.frequency.setTargetAtTime(380 + Math.sin(t * 0.7) * 120, t, 0.3);
    audio.siguiente -= delta;
    if (audio.siguiente > 0) return;
    if (momento === "noche") {
        audio.siguiente = 0.7 + Math.random() * 0.6;
        const f = 4200 + Math.random() * 400;
        for (let i = 0; i < 3; i++) pitido(f, f * 0.98, 0.04, 0.025, i * 0.06);
    } else {
        audio.siguiente = 3 + Math.random() * 6;
        const notas = 2 + Math.floor(Math.random() * 4);
        const base = 2200 + Math.random() * 1500;
        for (let i = 0; i < notas; i++) pitido(base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.8), 0.09 + Math.random() * 0.06, 0.04, i * 0.13);
    }
}

botonSonido.addEventListener("click", () => {
    if (!audio) audio = crearAudio();
    audio.ctx.resume();
    sonidoActivo = !sonidoActivo;
    botonSonido.classList.toggle("activo", sonidoActivo);
    botonSonido.setAttribute("aria-pressed", sonidoActivo);
    audio.general.gain.setTargetAtTime(sonidoActivo ? 0.5 : 0, audio.ctx.currentTime, 0.4);
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
};

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    if (!listo) return;
    const u = material.uniforms;
    u.uTiempo.value += delta;
    u.uFundido.value = Math.min(1, u.uFundido.value + delta * 0.6);
    u.uNoche.value += ((momento === "noche" ? 1 : 0) - u.uNoche.value) * Math.min(1, delta * 1.5);
    puntero.x += (puntero.objetivoX - puntero.x) * Math.min(1, delta * 2.5);
    puntero.y += (puntero.objetivoY - puntero.y) * Math.min(1, delta * 2.5);
    u.uPuntero.value.set(puntero.x, puntero.y);
    vidaDelAgua(delta);
    moverSonido(delta);
    renderizador.render(escena, camara);
}

animar();
