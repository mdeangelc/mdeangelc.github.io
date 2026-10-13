import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// =====================================================================
// 1. AJUSTES
// Gargantua, flotando en el espacio y haciendo de portada del
// portfolio. El disco de gas son tres capas que giran (más rápido por
// dentro), la luz doblada son dos arcos que abrazan la sombra negra, y
// detrás hay estrellas, la Vía Láctea y Andrómeda, todo deformado por la
// gravedad. De vez en cuando se come un planeta. Arrastrando se gira
// alrededor y con la rueda o pellizcando te acercas. El menú lleva la
// cámara a una toma distinta por sección. Al cargar llegas desde lejos
// mientras el gas se enciende en espiral. Si el sistema pide menos
// movimiento, no hay entrada, balanceo ni planetas.
// Opciones en la dirección:
//   ?sinentrada  -> sin la llegada
//   ?fijo        -> sin llegada ni cambios de resolución
//   ?marea=si    -> el planeta que se come Gargantua (quitado por ahora)
//                   vuelve y cae enseguida
//   ?pulso       -> despierta el agujero al cargar
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const pocoMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.75,
    resolucionMin: movil ? 0.75 : 1,
    brilloEscala: movil ? 3 : 2
};
const ALTURA = 3.6;
const CENTRO = new THREE.Vector3(0, ALTURA, 0);
const OBJETIVO = new THREE.Vector3(0, ALTURA - 0.2, 0);
const CAPA_BRILLO = 1;
const CAPA_FUGAZ = 2;
const BASE_GIRO = 0.16;
const BASE_ALTURA = 0.19;


// =====================================================================
// 2. RENDERIZADOR, ESCENA Y CÁMARA
// =====================================================================

let renderizador;
try {
    renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
} catch (error) {
    sin3D();
    throw error;
}

// Sin 3D (navegador o tarjeta gráfica que no puede): una imagen fija de
// Gargantua de fondo y el menú sigue funcionando con paneles normales
function sin3D() {
    document.body.classList.add("sin-3d");
    document.getElementById("cargando").classList.add("oculta");
    const paneles = [...document.querySelectorAll(".cartel")];
    const cerrar = () => paneles.forEach((c) => c.classList.remove("visible"));
    document.querySelectorAll(".seccion").forEach((b) =>
        b.addEventListener("click", () => {
            if (b.dataset.puerta) {
                location.href = "../camino-cine/";
                return;
            }
            const abierto = document.getElementById(b.dataset.cartel).classList.contains("visible");
            cerrar();
            if (!abierto) document.getElementById(b.dataset.cartel).classList.add("visible");
        })
    );
    paneles.forEach((c) => c.querySelector(".cerrar").addEventListener("click", cerrar));
}
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
document.body.prepend(renderizador.domElement);
renderizador.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
renderizador.domElement.addEventListener("webglcontextrestored", () => location.reload());

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 400);
camara.layers.enable(CAPA_BRILLO);

const comunes = {
    uTiempo: { value: 0 },
    uVista: { value: new THREE.Vector3(0, 0, 1) },
    uPulso: { value: 0 },
    uOnda: { value: 9 },
    uEncendido: { value: 0 },
    uExpo: { value: 1 }
};


// =====================================================================
// 3. TEXTURA DE RUIDO
// Ruido suave que se repite, hecho una vez al cargar, octava a octava.
// Lo usan el gas y la nebulosa del fondo.
// =====================================================================

function texturaRuido() {
    const n = 512;
    const celdas = 64;
    const rejilla = new Float32Array(celdas * celdas).map(() => Math.random());
    const suma = new Float32Array(n * n);
    let amp = 0.5;
    for (let o = 0; o < 5; o++) {
        const c = 4 << o;
        const lado = n / c;
        for (let y = 0; y < n; y++) {
            const yi = Math.floor(y / lado);
            const fy = (y - yi * lado) / lado;
            const sy = fy * fy * (3 - 2 * fy);
            const fila0 = (yi % c) * celdas;
            const fila1 = ((yi + 1) % c) * celdas;
            for (let x = 0; x < n; x++) {
                const xi = Math.floor(x / lado);
                const fx = (x - xi * lado) / lado;
                const sx = fx * fx * (3 - 2 * fx);
                const x0 = xi % c;
                const x1 = (xi + 1) % c;
                const arriba = rejilla[fila0 + x0] + (rejilla[fila0 + x1] - rejilla[fila0 + x0]) * sx;
                const abajo = rejilla[fila1 + x0] + (rejilla[fila1 + x1] - rejilla[fila1 + x0]) * sx;
                suma[y * n + x] += amp * (arriba + (abajo - arriba) * sy);
            }
        }
        amp *= 0.5;
    }
    const datos = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) datos[i] = Math.floor(Math.min(1, suma[i] / 0.97) * 255);
    const t = new THREE.DataTexture(datos, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
}

const tRuido = { value: texturaRuido() };


// =====================================================================
// 4. EL FONDO: ESTRELLAS DOBLADAS POR LA GRAVEDAD
// Un cielo hecho en el shader: estrellas en una rejilla sobre las caras
// de un cubo y una nebulosa muy tenue. Cada píxel primero se dobla con
// la ecuación de una lente gravitatoria, así que alrededor del agujero
// las estrellas se estiran, se acercan a un anillo y aparecen
// repetidas al otro lado.
// =====================================================================

const fondo = new THREE.Mesh(
    new THREE.SphereGeometry(200, 48, 24),
    new THREE.ShaderMaterial({
        uniforms: {
            uTiempo: comunes.uTiempo,
            tRuido,
            uAgujero: { value: CENTRO },
            uRadioLente: { value: 0.1 },
            uAparece: { value: 1 },
            uGalaxia: { value: new THREE.Vector3() }
        },
        vertexShader: `
            varying vec3 vMundo;
            void main() {
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform float uTiempo;
            uniform sampler2D tRuido;
            uniform vec3 uAgujero;
            uniform float uRadioLente;
            uniform float uAparece;
            uniform vec3 uGalaxia;
            varying vec3 vMundo;

            vec3 hash33(vec3 p3) {
                p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yxz + 33.33);
                return fract((p3.xxy + p3.yxx) * p3.zyx);
            }

            vec2 caraCubo(vec3 d, out float cara) {
                vec3 a = abs(d);
                if (a.x >= a.y && a.x >= a.z) {
                    cara = d.x > 0.0 ? 0.0 : 1.0;
                    return d.yz / a.x;
                }
                if (a.y >= a.z) {
                    cara = d.y > 0.0 ? 2.0 : 3.0;
                    return d.xz / a.y;
                }
                cara = d.z > 0.0 ? 4.0 : 5.0;
                return d.xy / a.z;
            }

            vec3 capaEstrellas(vec3 d, float escala, float densidad, float tam, float semilla) {
                float cara;
                vec2 uv = caraCubo(d, cara) * escala;
                vec2 celda = floor(uv);
                // Derivadas antes de salir y acotadas: en el cambio de cara del cubo
                // saltan y harían líneas de estrellas gordas
                float px = min(length(fwidth(uv)) * 0.75, tam * 3.0);
                vec3 h = hash33(vec3(celda, cara * 17.0 + semilla));
                if (h.x > densidad) return vec3(0.0);
                vec2 centro = celda + 0.3 + h.yz * 0.4;
                float dist = length(uv - centro);
                float r = max(tam, px);
                float luz = smoothstep(r, 0.0, dist) * min(1.0, (tam * tam) / (r * r) * 1.6);
                float fuerza = 0.25 + pow(fract(h.y * 7.31), 4.0) * 2.4;
                fuerza *= 0.85 + 0.15 * sin(uTiempo * (0.8 + h.z * 2.5) + h.y * 40.0);
                vec3 col = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.7), fract(h.z * 3.7));
                return col * luz * fuerza;
            }

            // Andrómeda, enorme en el cielo: un disco muy inclinado con el
            // núcleo dorado, brazos azulados con nudos de estrellas
            // jóvenes, bandas de polvo oscuro (más marcadas en el lado que
            // queda delante) y sus dos galaxias pequeñas al lado. Se lee
            // con la dirección ya doblada por la lente, así que cuando
            // pasa por detrás del agujero se curva a su alrededor.
            vec3 andromeda(vec3 d) {
                vec3 g = normalize(uGalaxia);
                if (dot(d, g) < 0.94) return vec3(0.0);
                vec3 e1 = normalize(cross(g, vec3(0.0, 1.0, 0.0)));
                vec3 e2 = cross(e1, g);
                vec2 p = vec2(dot(d, e1), dot(d, e2)) / 0.17;
                p = mat2(0.83, -0.56, 0.56, 0.83) * p;
                vec2 q = vec2(p.x, p.y / 0.3);
                float r = length(q);
                vec3 col = vec3(0.0);
                if (r < 1.7) {
                    float ang = atan(q.y, q.x);
                    float ruidoA = texture2D(tRuido, q * 0.45 + 0.3).r;
                    float ruidoB = texture2D(tRuido, q * 1.6 + 0.7).r;
                    float brazos = pow(0.5 + 0.5 * sin(ang * 2.0 - log(r + 0.03) * 6.5 + ruidoA * 2.0), 1.6);
                    float nucleo = exp(-r * r * 60.0) * 2.4 + exp(-r * 7.0) * 0.9;
                    float disco = exp(-r * 1.7) * (0.3 + 0.7 * brazos) * smoothstep(1.7, 1.1, r);
                    float polvo = smoothstep(0.42, 0.7, ruidoA * 0.6 + ruidoB * 0.4) * (0.5 + 0.5 * sin(r * 15.0 + ruidoA * 4.0));
                    polvo *= smoothstep(0.12, 0.35, r) * smoothstep(1.4, 0.7, r) * (q.y > 0.0 ? 1.0 : 0.45);
                    float nudos = smoothstep(0.7, 0.85, ruidoB) * brazos * smoothstep(0.35, 0.6, r) * smoothstep(1.3, 0.9, r);
                    col = vec3(1.0, 0.8, 0.56) * nucleo;
                    col += mix(vec3(0.42, 0.58, 1.0), vec3(0.95, 0.78, 0.66), exp(-r * 2.6)) * disco;
                    col += vec3(0.55, 0.7, 1.0) * nudos * 0.6 + vec3(1.0, 0.45, 0.6) * nudos * smoothstep(0.8, 0.95, ruidoA) * 0.5;
                    col *= 1.0 - polvo * 0.75;
                }
                // M32, pegada al disco, y M110, más lejos y alargada
                vec2 a1 = (p - vec2(0.12, 0.2)) / vec2(0.05, 0.045);
                vec2 a2 = mat2(0.6, -0.8, 0.8, 0.6) * (p - vec2(-0.5, -0.62)) / vec2(0.14, 0.07);
                col += vec3(1.0, 0.86, 0.7) * (exp(-dot(a1, a1) * 1.6) * 0.8 + exp(-dot(a2, a2) * 1.4) * 0.35);
                return col * 0.32;
            }

            // La Vía Láctea: una banda ancha que cruza todo el cielo, con
            // nubes de estrellas, una zona central más cálida y una franja
            // de polvo oscuro en medio
            vec3 viaLactea(vec3 d, out float densidad) {
                vec3 n = normalize(vec3(0.35, 0.8, -0.45));
                float lat = dot(d, n);
                float banda = exp(-lat * lat / 0.07);
                float lon = atan(dot(d, normalize(cross(n, vec3(1.0, 0.0, 0.0)))), dot(d, normalize(cross(n, vec3(0.0, 0.0, 1.0))))) / 6.2832;
                float nubes = texture2D(tRuido, vec2(lon * 3.0, lat * 1.5 + 0.5)).r;
                float finas = texture2D(tRuido, vec2(lon * 9.0 + 0.3, lat * 4.0 + 0.2)).r;
                float polvo = smoothstep(0.45, 0.7, finas) * exp(-lat * lat / 0.006);
                float centro = exp(-pow((lon - 0.12) * 4.0, 2.0));
                densidad = banda * (0.5 + nubes) * (1.0 - polvo * 0.8);
                vec3 color = mix(vec3(0.38, 0.45, 0.7), vec3(0.9, 0.72, 0.52), centro * 0.8);
                return color * banda * smoothstep(0.35, 0.8, nubes * 0.7 + finas * 0.4) * (1.0 - polvo * 0.85) * (0.05 + centro * 0.05);
            }

            void main() {
                vec3 dir = normalize(vMundo - cameraPosition);
                vec3 haciaAgujero = normalize(uAgujero - cameraPosition);
                float coseno = clamp(dot(dir, haciaAgujero), -1.0, 1.0);
                float theta = acos(coseno);
                float e2 = uRadioLente * uRadioLente;
                float beta = theta - e2 / max(theta, 0.0005);
                vec3 eje = dir - haciaAgujero * coseno;
                float largoEje = length(eje);
                eje = largoEje > 0.00001 ? eje / largoEje : vec3(0.0, 1.0, 0.0);
                vec3 d = normalize(cos(beta) * haciaAgujero + sin(beta) * eje);
                float aumento = clamp(1.0 / abs(1.0 - e2 * e2 / pow(max(theta, 0.0005), 4.0)), 0.0, 6.0);

                vec3 cielo = mix(vec3(0.004, 0.005, 0.01), vec3(0.012, 0.012, 0.022), exp(-theta * 2.5));
                float nebulosa;
                cielo += viaLactea(d, nebulosa);

                vec3 estrellas = capaEstrellas(d, 110.0, 0.3, 0.07, 1.0) * 0.6;
                estrellas += capaEstrellas(d, 40.0, 0.22, 0.05, 2.0) * 1.6;
                estrellas += capaEstrellas(d, 14.0, 0.12, 0.035, 3.0) * 3.6;
                estrellas *= 0.7 + nebulosa * 1.5;
                float lejosDelCentro = smoothstep(0.05, 0.3, abs(beta) / uRadioLente) * smoothstep(0.95, 1.4, theta * 2.4 / uRadioLente);
                cielo += estrellas * min(aumento, 3.0) * lejosDelCentro;
                cielo += andromeda(d) * min(aumento, 4.0) * smoothstep(0.02, 0.25, abs(beta) / uRadioLente) * smoothstep(0.9, 1.3, theta * 2.4 / uRadioLente);
                gl_FragColor = vec4(cielo * uAparece, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    })
);
fondo.renderOrder = -1;
escena.add(fondo);
// Andrómeda queda arriba a la izquierda del agujero vista desde el sitio
// de partida; al girar alrededor pasa por detrás y se dobla
fondo.material.uniforms.uGalaxia.value.set(-Math.sin(BASE_GIRO - 0.3), -Math.sin(BASE_ALTURA) + 0.14, -Math.cos(BASE_GIRO - 0.3)).normalize();



// =====================================================================
// 5. EL GAS
// La textura de ruido leída en coordenadas polares: gira más rápido por
// dentro, se enrolla en espiral, se retuerce despacio, con anillos que
// se desplazan, filamentos finos, vetas oscuras de polvo, grumos
// calientes, un borde interior al rojo blanco donde el gas cae y un
// lado más brillante (el gas que viene hacia ti).
// =====================================================================

const gasGlsl = `
    uniform sampler2D tRuido;
    uniform float uTiempo;
    uniform vec3 uVista;
    uniform float uEncendido;
    uniform float uPulso;
    uniform float uOnda;
    uniform float uExpo;
    const float DENTRO = 1.35;
    const float FUERA = 4.8;
    float manchasFijas = 0.0;


    float manchasEn(float r, float phi) {
        float m = 0.0;
        for (int i = 0; i < 10; i++) {
            float ri = 1.55 + float(i) * 0.31 + 0.1 * sin(float(i) * 3.7);
            float ai = uTiempo * 1.5 * pow(ri / DENTRO, -1.5) + float(i) * 2.3;
            float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
            m += exp(-pow(da / (0.3 + float(i) * 0.08), 2.0) - pow((r - ri) / (0.07 + float(i) * 0.008), 2.0)) * (0.55 + 0.45 * sin(uTiempo * 2.0 + float(i) * 1.3));
        }
        return m;
    }

    vec4 gas(float r, float phi, float phiLuz, float desfase) {
        float x = (r - DENTRO) / (FUERA - DENTRO);
        float omega = 1.5 * pow(r / DENTRO, -1.5);
        float espiral = log(r) * 0.55;
        float ang = (phi - uTiempo * omega) / 6.2832 + desfase;
        #ifdef GAS_LIGERO
        float angT = ang;
        float rT = r;
        #else
        vec2 torcer = vec2(
            texture2D(tRuido, vec2(ang * 2.0 + uTiempo * 0.013, r * 0.3 - uTiempo * 0.021)).r,
            texture2D(tRuido, vec2(ang * 2.0 + 0.5 - uTiempo * 0.017, r * 0.3 + 0.4 + uTiempo * 0.015)).r
        ) - 0.5;
        float angT = ang + torcer.x * 0.018;
        float rT = r + torcer.y * 0.1;
        #endif
        float n = texture2D(tRuido, vec2(angT + espiral * 0.3, rT * 0.16 + desfase)).r;
        float fino = texture2D(tRuido, vec2(angT * 3.0 + espiral, rT * 0.6 + 0.37)).r;
        float hebras = texture2D(tRuido, vec2(angT * 9.0 + espiral * 2.0, rT * 2.2 + 0.11)).r;
        #ifdef GAS_LIGERO
        float rizo = 0.5;
        float manchas = manchasFijas;
        #else
        float rizo = texture2D(tRuido, vec2(angT * 22.0 + espiral * 4.0, rT * 5.0 + 0.53)).r;
        float manchas = manchasEn(r, phi);
        #endif
        float polvo = smoothstep(0.55, 0.8, texture2D(tRuido, vec2(angT + 0.5, rT * 0.09 + 0.61)).r) * smoothstep(0.12, 0.6, x);
        // En el disco, la parte de delante pasa por encima de la sombra:
        // ahí el borde interior se suaviza para que se vea como gas y no
        // como una raya recta
        float delante = 0.0;
        #ifdef DISCO
        delante = smoothstep(0.1, 0.75, dot(vec2(cos(phi), sin(phi)), normalize(uVista.xz + 0.0001)));
        #endif
        float perfil = smoothstep(-0.02, 0.05 + delante * 0.22, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.3);
        float anillos = 0.6 + 0.4 * sin(rT * 14.0 - uTiempo * 1.1 + n * 4.0) * sin(rT * 4.6 + uTiempo * 0.4);
        float densidad = smoothstep(0.3, 0.75, n) * (0.4 + 0.8 * fino) * (0.65 + 0.7 * hebras) * (0.8 + 0.4 * rizo) * anillos;
        densidad = mix(densidad, 1.0, smoothstep(0.14, 0.0, x));
        float temperatura = pow(DENTRO / r, 1.4);
        vec3 col = mix(vec3(0.38, 0.13, 0.05), vec3(1.0, 0.46, 0.16), smoothstep(0.1, 0.42, temperatura));
        col = mix(col, vec3(1.0, 0.78, 0.5), smoothstep(0.42, 0.75, temperatura));
        col = mix(col, vec3(1.0, 0.95, 0.88), smoothstep(0.75, 1.0, temperatura));
        vec3 vel = vec3(-sin(phiLuz), 0.0, cos(phiLuz));
        float v = 0.45 * pow(DENTRO / r, 0.5);
        float doppler = 1.0 / (inversesqrt(1.0 - v * v) * (1.0 - v * dot(vel, uVista)));
        float haz = mix(1.0, pow(doppler, 3.5), 0.85);
        float brillo = temperatura * 2.0 * haz * (1.0 + 0.12 * sin(uTiempo * 1.3 + r * 2.5)) * (0.72 + 0.56 * rizo);
        col *= brillo * (1.0 - polvo * 0.85) * (1.0 + manchas * 1.5);
        col = mix(col, col * vec3(1.1, 0.8, 0.62), smoothstep(1.0, 0.6, doppler) * 0.6);
        col = mix(col, col * vec3(0.88, 0.98, 1.2) + vec3(0.03, 0.05, 0.1), smoothstep(1.0, 1.45, doppler) * 0.65);
        float borde = exp(-pow((r - DENTRO - 0.025) / (0.032 + delante * 0.08), 2.0)) * (0.7 + 0.3 * sin(phi * 7.0 + uTiempo * 3.1) * sin(phi * 3.0 - uTiempo * 1.7)) * (1.0 - delante * 0.75);
        col += vec3(1.0, 0.95, 0.88) * borde * 2.2 * haz;
        col *= 1.0 + uPulso * 0.45 + uPulso * 2.2 * exp(-pow((r - uOnda) / 0.3, 2.0));
        float alfa = clamp((densidad + manchas * 0.4) * perfil * 1.6 + borde * 0.5, 0.0, 1.0);
        float frente = mix(FUERA + 0.9, DENTRO - 1.0, uEncendido);
        float filo = r + 0.45 * sin(phi * 2.0 - log(r) * 5.0 - uTiempo * 0.8);
        alfa *= smoothstep(frente - 0.2, frente + 0.6, filo);
        col *= 1.0 + 2.0 * exp(-pow((filo - frente - 0.3) / 0.35, 2.0)) * (1.0 - uEncendido);
        return vec4(col, alfa);
    }
`;


// =====================================================================
// 6. GARGANTUA
// La sombra es una bola negra sin ningún reflejo. El disco son tres
// capas de gas y sigue casi del todo a la cámara. Los arcos de luz
// doblada se pintan en un anillo plano, sin piezas ni bordes cortados,
// y junto a los dos anillos de fotones miran siempre del todo a la
// cámara. Alrededor, halos de luz.
// =====================================================================

const agujero = new THREE.Group();
agujero.position.copy(CENTRO);
agujero.rotation.order = "YXZ";
escena.add(agujero);

const brillar = (o) => {
    o.layers.enable(CAPA_BRILLO);
    return o;
};

// Lo que brilla solo un momento (el planeta que se rompe, sus trozos y
// el fogonazo) tiene resplandor pero no hace el destello horizontal
const brillarFugaz = (o) => {
    o.layers.enable(CAPA_FUGAZ);
    return o;
};

// Durante la llegada la sombra aparece poco a poco con el gas, para que
// no se vea una bola negra sola
const sombra = brillar(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 })));
agujero.add(sombra);


function discoConVolumen(grosorMax) {
    const perfil = [];
    const dentro = 1.3;
    const fuera = 4.85;
    const grosor = (r) => grosorMax * Math.pow(1 - (r - dentro) / (fuera - dentro), 0.8) + 0.006;
    const n = 28;
    for (let i = 0; i <= n; i++) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, -grosor(r)));
    }
    for (let i = n; i >= 0; i--) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, grosor(r)));
    }
    perfil.push(perfil[0].clone());
    return new THREE.LatheGeometry(perfil, 144);
}

const VERTICE_LOCAL = `
    varying vec3 vLocal;
    void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const MEZCLA_PREMULTIPLICADA = {
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor
};

// El disco en tres capas: la del medio con todo el detalle y dos más
// gruesas y suaves por encima y por debajo que le dan cuerpo
function materialDisco(fuerza, desfase) {
    return new THREE.ShaderMaterial({
        uniforms: { ...comunes, tRuido },
        vertexShader: VERTICE_LOCAL,
        fragmentShader: "#define DISCO\n" + (fuerza < 0.5 ? "#define GAS_LIGERO\n" : "") + gasGlsl + `
            varying vec3 vLocal;
            void main() {
                float r = length(vLocal.xz);
                float fi = atan(vLocal.z, vLocal.x);
                vec4 g = gas(r, fi, fi, ${desfase.toFixed(2)});
                float a = clamp(g.a * ${fuerza.toFixed(3)} * 1.7, 0.0, 1.0);
                if (a < 0.002) discard;
                gl_FragColor = vec4(pow(g.rgb, vec3(1.15)) * 0.85 * a * uExpo, a);
            }
        `,
        ...MEZCLA_PREMULTIPLICADA
    });
}

[[0.06, 1, 0], [0.16, 0.3, 0.37], [0.28, 0.14, 0.71]].forEach(([grosor, fuerza, desfase], i) => {
    const capa = brillar(new THREE.Mesh(discoConVolumen(grosor), materialDisco(fuerza, desfase)));
    capa.renderOrder = 3 + i;
    agujero.add(capa);
});

// Los arcos: la parte de atrás del disco doblada por encima y por
// debajo. Fluyen en el mismo sentido que el disco de detrás y son más
// brillantes pegados a la sombra
function materialArcos(fuerza, desfase) {
    return new THREE.ShaderMaterial({
        uniforms: { ...comunes, tRuido },
        vertexShader: VERTICE_LOCAL,
        fragmentShader: (fuerza < 0.5 ? "#define GAS_LIGERO\n" : "") + gasGlsl + `
            varying vec3 vLocal;
            void main() {
                float rho = length(vLocal.xy);
                float aG = atan(vLocal.y, vLocal.x);
                bool arriba = vLocal.y > 0.0;
                float dentroArco = arriba ? 1.1 : 1.07;
                float fueraArco = arriba ? 2.55 : 1.5;
                if (rho < dentroArco - 0.02 || rho > fueraArco + 0.05) discard;
                float rG = DENTRO + max(0.0, rho - dentroArco) * (arriba ? 1.75 : 3.6);
                vec4 g = gas(rG, (arriba ? -aG : aG) * 0.9 + 1.4, aG * 0.9 + 1.4, ${desfase.toFixed(2)});
                g.rgb *= 1.0 + 0.5 * exp(-(rho - dentroArco) / (arriba ? 0.08 : 0.05));
                float a = clamp(g.a * (arriba ? 2.0 : 1.5), 0.0, 1.0);
                a *= smoothstep(0.0, 0.22, abs(vLocal.y) / rho);
                a *= smoothstep(dentroArco - 0.01, dentroArco + 0.05, rho);
                a *= smoothstep(fueraArco, fueraArco - (arriba ? 1.05 : 0.35), rho);
                a = clamp(a * ${fuerza.toFixed(2)} * 1.7, 0.0, 1.0);
                if (a < 0.002) discard;
                gl_FragColor = vec4(pow(g.rgb, vec3(1.15)) * a * uExpo, a);
            }
        `,
        ...MEZCLA_PREMULTIPLICADA
    });
}

// Los arcos y los anillos van en su propio grupo, que mira siempre del
// todo a la cámara: así rodean la sombra igual se mire como se mire y
// no se nota que debajo hay una bola
const arcos = new THREE.Group();
arcos.position.copy(CENTRO);
arcos.rotation.order = "YXZ";
const planoArcos = new THREE.RingGeometry(1.03, 2.62, 160, 1);
const arcoAtras = brillar(new THREE.Mesh(planoArcos, materialArcos(0.35, 0.5)));
arcoAtras.position.z = -0.12;
const arcoDelante = brillar(new THREE.Mesh(planoArcos, materialArcos(1, 0)));
arcoAtras.renderOrder = 6;
arcoDelante.renderOrder = 7;
// Los anillos de fotones: una línea de luz pintada en un anillo plano.
// Nunca es más fina que un píxel (si lo fuera saldría a trozos, como
// una línea discontinua); cuando debería serlo se ensancha y se apaga
// un poco en proporción.
function materialAnillo(radio, ancho) {
    return new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() } },
        vertexShader: VERTICE_LOCAL,
        fragmentShader: `
            uniform vec3 uColor;
            varying vec3 vLocal;
            void main() {
                float r = length(vLocal.xy);
                float w = max(${ancho.toFixed(4)}, fwidth(r) * 0.8);
                float a = exp(-pow((r - ${radio.toFixed(4)}) / w, 2.0)) * min(1.0, ${ancho.toFixed(4)} / w * 1.4 + 0.3);
                gl_FragColor = vec4(uColor * a, a);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
}
const anillo = brillar(new THREE.Mesh(new THREE.RingGeometry(0.98, 1.08, 256, 1), materialAnillo(1.028, 0.008)));
const anillo2 = brillar(new THREE.Mesh(new THREE.RingGeometry(1.04, 1.11, 256, 1), materialAnillo(1.075, 0.004)));
anillo.renderOrder = 9;
anillo2.renderOrder = 9;
arcos.add(arcoAtras, arcoDelante, anillo, anillo2);
escena.add(arcos);

function texturaHalo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 128;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    d.addColorStop(0, "rgba(255, 255, 255, 1)");
    d.addColorStop(0.25, "rgba(255, 255, 255, 0.45)");
    d.addColorStop(0.6, "rgba(255, 255, 255, 0.1)");
    d.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(lienzo);
}

const mapaHalo = texturaHalo();
// Unas pocas estrellas muy brillantes con rayitos, lejos del agujero
function texturaDestello() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 128;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(64, 64, 0, 64, 64, 14);
    d.addColorStop(0, "rgba(255, 255, 255, 1)");
    d.addColorStop(0.25, "rgba(255, 255, 255, 0.55)");
    d.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 128, 128);
    [[1, 0.025], [0.025, 1]].forEach(([sx, sy]) => {
        const rayo = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        rayo.addColorStop(0, "rgba(255, 255, 255, 1)");
        rayo.addColorStop(0.35, "rgba(255, 255, 255, 0.25)");
        rayo.addColorStop(1, "rgba(255, 255, 255, 0)");
        g.save();
        g.translate(64, 64);
        g.scale(sx, sy);
        g.fillStyle = rayo;
        g.beginPath();
        g.arc(0, 0, 64, 0, Math.PI * 2);
        g.fill();
        g.restore();
    });
    return new THREE.CanvasTexture(lienzo);
}

const destellos = (() => {
    const mapa = texturaDestello();
    const haciaAgujero = new THREE.Vector3(-Math.sin(BASE_GIRO), -Math.sin(BASE_ALTURA), -Math.cos(BASE_GIRO)).normalize();
    const lista = [];
    const tonos = [0xcfe0ff, 0xffffff, 0xffe2c4, 0xdde6ff];
    while (lista.length < 8) {
        const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (v.lengthSq() > 1 || v.lengthSq() < 0.01) continue;
        v.normalize();
        if (v.angleTo(haciaAgujero) < 0.16 || v.angleTo(haciaAgujero) > 0.6) continue;
        const estrella = new THREE.Sprite(new THREE.SpriteMaterial({ map: mapa, color: tonos[lista.length % tonos.length], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
        estrella.position.copy(v).multiplyScalar(150).add(CENTRO);
        estrella.scale.setScalar(0.022 + Math.random() * 0.03);
        estrella.userData = { fase: Math.random() * 6.28, fuerza: 0.45 + Math.random() * 0.55 };
        estrella.renderOrder = 0;
        escena.add(estrella);
        lista.push(estrella);
    }
    return lista;
})();

const halos = [[10, 0.16, [1, 0.5, 0.22]], [3.8, 0.28, [1, 0.72, 0.45]]].map(([tam, fuerza, c]) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: mapaHalo, color: new THREE.Color(...c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: fuerza }));
    halo.scale.setScalar(tam);
    halo.renderOrder = 10;
    halo.userData.fuerza = fuerza;
    agujero.add(halo);
    return halo;
});


// =====================================================================
// 6b. EL PLANETA DEVORADO
// De vez en cuando (o al tocar) un planeta cae hacia el agujero. Al
// acercarse se estira hacia él como un espagueti, se agrieta con la lava
// brillando por dentro y empieza a soltar trozos por las dos puntas. Muy
// cerca se rompe del todo: parte de los trozos sale despedida y el resto
// da vueltas y entra en el disco como un brazo brillante. Los últimos
// trozos, ya en el borde, se vuelven rojos y se apagan, como congelados.
// Cada trozo se mueve con la gravedad de verdad.
// =====================================================================

const GM = 5.4;
const TROZOS = movil ? 600 : 1200;
const marea = {
    estado: "nada",
    espera: parametros.get("marea") === "si" ? 7 : 40 + Math.random() * 25,
    ultima: -99,
    cuerpo: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    trozos: new Float32Array(TROZOS * 7),
    siguiente: 0
};

const geometriaMarea = new THREE.BufferGeometry();
geometriaMarea.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TROZOS * 3), 3));
geometriaMarea.setAttribute("aBrillo", new THREE.BufferAttribute(new Float32Array(TROZOS), 1));
geometriaMarea.setAttribute("aRadio", new THREE.BufferAttribute(new Float32Array(TROZOS).fill(9), 1));
const materialMarea = new THREE.ShaderMaterial({
    uniforms: { uEscala: { value: 1 } },
    vertexShader: `
        attribute float aBrillo;
        attribute float aRadio;
        uniform float uEscala;
        varying float vBrillo;
        varying float vRadio;
        void main() {
            vBrillo = aBrillo;
            vRadio = aRadio;
            vec4 vista = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uEscala * (0.6 + min(aBrillo, 1.5) * 0.5) / -vista.z;
            gl_Position = projectionMatrix * vista;
        }
    `,
    fragmentShader: `
        varying float vBrillo;
        varying float vRadio;
        void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = exp(-r * r * 5.0);
            vec3 color = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.86, 0.66), clamp(vBrillo - 0.8, 0.0, 1.0));
            // Pegado al borde la luz sale enrojecida y cada vez más débil
            float rojo = smoothstep(2.3, 1.4, vRadio);
            color = mix(color, vec3(0.7, 0.08, 0.03), rojo);
            float apaga = smoothstep(1.22, 1.75, vRadio);
            gl_FragColor = vec4(color * a * vBrillo * 2.4 * apaga, a * min(vBrillo, 1.0) * apaga);
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const rioMarea = brillarFugaz(new THREE.Points(geometriaMarea, materialMarea));
rioMarea.frustumCulled = false;
rioMarea.renderOrder = 8;
rioMarea.visible = false;
agujero.add(rioMarea);

// Estelas: una raya de cada trozo hasta donde estaba hace un momento
const geometriaEstelas = new THREE.BufferGeometry();
geometriaEstelas.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TROZOS * 6), 3));
geometriaEstelas.setAttribute("aBrillo", new THREE.BufferAttribute(new Float32Array(TROZOS * 2), 1));
const materialEstelas = new THREE.ShaderMaterial({
    vertexShader: `
        attribute float aBrillo;
        varying float vBrillo;
        void main() {
            vBrillo = aBrillo;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying float vBrillo;
        void main() {
            gl_FragColor = vec4(vec3(1.0, 0.55, 0.28) * vBrillo * 0.9, vBrillo);
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const estelas = brillarFugaz(new THREE.LineSegments(geometriaEstelas, materialEstelas));
estelas.frustumCulled = false;
estelas.renderOrder = 8;
estelas.visible = false;
agujero.add(estelas);
const anteriores = new Float32Array(TROZOS * 3);

// El planeta: roca rojiza y seca, muy distinta del planeta azul de
// "Sobre mí", con grietas por las que asoma la lava. Lo ilumina el
// disco por el lado que mira al agujero.
const materialPlaneta = new THREE.ShaderMaterial({
    uniforms: { tRuido, uGrietas: { value: 0 }, uTiempo: comunes.uTiempo },
    vertexShader: `
        varying vec3 vLocal;
        varying vec3 vNormal;
        varying vec3 vMundo;
        void main() {
            vLocal = position;
            vNormal = normalize(mat3(modelMatrix) * normal);
            vec4 m = modelMatrix * vec4(position, 1.0);
            vMundo = m.xyz;
            gl_Position = projectionMatrix * viewMatrix * m;
        }
    `,
    fragmentShader: `
        uniform sampler2D tRuido;
        uniform float uGrietas;
        uniform float uTiempo;
        varying vec3 vLocal;
        varying vec3 vNormal;
        varying vec3 vMundo;
        void main() {
            vec3 d = normalize(vLocal);
            vec2 uv = vec2(atan(d.z, d.x) / 6.2832, d.y * 0.5 + 0.5);
            float roca = texture2D(tRuido, uv * vec2(2.0, 1.0)).r * 0.6 + texture2D(tRuido, uv * vec2(7.0, 3.5) + 0.3).r * 0.4;
            vec3 base = mix(vec3(0.2, 0.08, 0.05), vec3(0.66, 0.33, 0.18), smoothstep(0.3, 0.75, roca));
            // Cráteres: manchas oscuras con el borde algo más claro
            float hueco = texture2D(tRuido, uv * vec2(9.0, 4.5) + 0.17).r;
            base *= 1.0 - smoothstep(0.68, 0.74, hueco) * 0.45;
            base += vec3(0.08, 0.04, 0.02) * (smoothstep(0.62, 0.68, hueco) - smoothstep(0.68, 0.72, hueco));
            vec3 n = normalize(vNormal);
            vec3 haciaDisco = normalize(vec3(${CENTRO.x.toFixed(2)}, ${CENTRO.y.toFixed(2)}, ${CENTRO.z.toFixed(2)}) - vMundo);
            vec3 color = base * (vec3(1.0, 0.6, 0.3) * max(dot(n, haciaDisco), 0.0) * 1.8 + 0.03);
            // Grietas: líneas finas del ruido que se abren al acercarse
            float g = texture2D(tRuido, uv * vec2(5.0, 2.5) + 0.61).r;
            float ancho = 0.01 + 0.05 * uGrietas;
            float grieta = smoothstep(ancho, 0.0, abs(g - 0.5)) * smoothstep(0.05, 0.3, uGrietas);
            float latido = 0.8 + 0.2 * sin(uTiempo * 6.0 + g * 30.0);
            color += vec3(1.0, 0.42, 0.1) * grieta * (1.5 + 3.0 * uGrietas) * latido;
            color += vec3(1.0, 0.35, 0.1) * uGrietas * uGrietas * 0.6;
            gl_FragColor = vec4(color, 1.0);
        }
    `
});
const planeta = brillarFugaz(new THREE.Mesh(new THREE.SphereGeometry(0.36, 48, 32), materialPlaneta));
planeta.visible = false;
planeta.renderOrder = 8;
agujero.add(planeta);
const ejeZ = new THREE.Vector3(0, 0, 1);
const haciaAgujero = new THREE.Vector3();

const fogonazo = brillarFugaz(new THREE.Sprite(new THREE.SpriteMaterial({ map: mapaHalo, color: new THREE.Color(1, 0.7, 0.45).multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
fogonazo.visible = false;
fogonazo.renderOrder = 8;
agujero.add(fogonazo);

function lanzarPlaneta() {
    if (marea.estado !== "nada" || comunes.uTiempo.value - marea.ultima < 15) return;
    // Órbita casi parabólica que pasa muy cerca, inclinada respecto al
    // disco para que se vea por encima antes de caer en él
    const q = 2.3;
    const phi = -2.3 + (Math.random() - 0.5) * 0.15;
    const r = (2 * q) / (1 + Math.cos(phi));
    const v = Math.sqrt((2 * GM) / r) * 0.985;
    const h = Math.sqrt(2 * GM * q) * 0.985;
    const vt = h / r;
    const vr = -Math.sqrt(Math.max(0, v * v - vt * vt));
    const e = marea.cuerpo;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const inc = 0.5;
    const z = r * s;
    const vz = vr * s + vt * c;
    e.x = r * c;
    e.y = z * Math.sin(inc);
    e.z = z * Math.cos(inc);
    e.vx = vr * c - vt * s;
    e.vy = vz * Math.sin(inc);
    e.vz = vz * Math.cos(inc);
    // Se gira la órbita para que llegue por la derecha y abajo, lejos del
    // planeta de "Sobre mí", y no se confundan
    const giro = -1.6;
    const cg = Math.cos(giro);
    const sg = Math.sin(giro);
    [e.x, e.z] = [e.x * cg + e.z * sg, -e.x * sg + e.z * cg];
    [e.vx, e.vz] = [e.vx * cg + e.vz * sg, -e.vx * sg + e.vz * cg];
    marea.estado = "cae";
    marea.t = 0;
    marea.siguiente = 0;
    marea.trozos.fill(0);
    for (let i = 0; i < TROZOS; i++) marea.trozos[i * 7 + 6] = -1;
    planeta.visible = true;
    rioMarea.visible = true;
    estelas.visible = true;
}

// Suelta "cuantos" trozos desde el planeta: por las dos puntas del eje
// que apunta al agujero (donde tira más la gravedad) o, al romperse, de
// todo el planeta y repartidos a lo largo de su camino
function soltarTrozos(cuantos, rompe) {
    const e = marea.cuerpo;
    const t = marea.trozos;
    const v = Math.hypot(e.vx, e.vy, e.vz);
    const estiramiento = planeta.scale.z;
    for (let n = 0; n < cuantos && marea.siguiente < TROZOS; n++) {
        const i = marea.siguiente++;
        const k = i * 7;
        const punta = Math.random() < 0.5 ? 1 : -1;
        const largo = rompe ? (Math.random() - 0.5) * 1.2 : punta * 0.3 * estiramiento * (0.8 + Math.random() * 0.3);
        const dir = rompe ? [e.vx / v, e.vy / v, e.vz / v] : [haciaAgujero.x, haciaAgujero.y, haciaAgujero.z];
        t[k] = e.x + dir[0] * largo + (Math.random() - 0.5) * 0.12;
        t[k + 1] = e.y + dir[1] * largo + (Math.random() - 0.5) * 0.12;
        t[k + 2] = e.z + dir[2] * largo + (Math.random() - 0.5) * 0.12;
        // Los de la punta de dentro van un poco más lentos (quedan ligados
        // al agujero) y los de fuera un poco más rápidos (se escapan)
        const extra = rompe ? 1 + (Math.random() - 0.5) * 0.18 : 1 - punta * 0.05 + (Math.random() - 0.5) * 0.04;
        t[k + 3] = e.vx * extra;
        t[k + 4] = e.vy * extra;
        t[k + 5] = e.vz * extra;
        t[k + 6] = 1;
        anteriores.set([t[k], t[k + 1], t[k + 2]], i * 3);
    }
}

function romperPlaneta() {
    soltarTrozos(TROZOS, true);
    marea.estado = "rio";
    marea.t = 0;
    planeta.visible = false;
    fogonazo.position.copy(planeta.position);
    despertar();
    sonarMarea();
}

// Un paso de gravedad (y, dentro del disco, rozamiento que va metiendo
// el gas en órbitas circulares cada vez más pequeñas)
function gravedad(p, k, dt, conRoce) {
    const x = p[k];
    const y = p[k + 1];
    const z = p[k + 2];
    const r2 = x * x + y * y + z * z;
    const r = Math.sqrt(r2);
    const a = -GM / (r2 * r);
    p[k + 3] += a * x * dt;
    p[k + 4] += a * y * dt;
    p[k + 5] += a * z * dt;
    if (conRoce && r < 5.2) {
        // Velocidad circular en el plano del disco
        const vc = Math.sqrt(GM / r) * 0.97;
        const sentido = Math.sign(x * p[k + 5] - z * p[k + 3]) || 1;
        const tx = (-z / r) * vc * sentido;
        const tz = (x / r) * vc * sentido;
        const roce = Math.min(1, dt * 0.9);
        p[k + 3] += (tx - p[k + 3]) * roce;
        p[k + 5] += (tz - p[k + 5]) * roce;
        p[k + 4] += (-y * 1.2 - p[k + 4]) * roce * 0.5;
    }
    p[k] += p[k + 3] * dt;
    p[k + 1] += p[k + 4] * dt;
    p[k + 2] += p[k + 5] * dt;
    return r;
}

const estadoPlaneta = new Float32Array(6);

function moverPlaneta(delta, pasos, dt) {
    const e = marea.cuerpo;
    const s = estadoPlaneta;
    s.set([e.x, e.y, e.z, e.vx, e.vy, e.vz]);
    let r = 99;
    for (let i = 0; i < pasos; i++) r = gravedad(s, 0, dt, false);
    [e.x, e.y, e.z, e.vx, e.vy, e.vz] = s;
    planeta.position.set(e.x, e.y, e.z);
    // Se estira hacia el agujero y se agrieta al acercarse
    haciaAgujero.set(-e.x, -e.y, -e.z).normalize();
    planeta.quaternion.setFromUnitVectors(ejeZ, haciaAgujero);
    const cerca = THREE.MathUtils.smoothstep(r, 9.5, 2.6);
    const largo = 1 + cerca * cerca * 2.6;
    planeta.scale.set(1 / Math.sqrt(largo), 1 / Math.sqrt(largo), largo);
    planeta.rotateZ(marea.t * 0.3);
    materialPlaneta.uniforms.uGrietas.value = cerca;
    // Empieza a soltar trozos por las puntas
    if (r < 7) soltarTrozos(Math.ceil(TROZOS * 0.2 * delta * cerca * cerca), false);
    if (r < 2.7) romperPlaneta();
}

// El planeta que se come Gargantua está quitado por ahora: solo sale
// con ?marea=si (el código se queda para más adelante)
const comerPlanetas = parametros.get("marea") === "si";

function moverMarea(delta) {
    if (!comerPlanetas) return;
    if (marea.estado === "nada") {
        marea.espera -= delta;
        if (marea.espera <= 0 && comunes.uEncendido.value > 0.95 && !pocoMovimiento) {
            lanzarPlaneta();
            marea.espera = 55 + Math.random() * 35;
        }
        return;
    }
    marea.t += delta;
    const pasos = 4;
    const dt = delta / pasos;
    if (marea.estado === "cae") moverPlaneta(delta, pasos, dt);
    // El fogonazo al romperse: un destello que se hincha y se apaga
    if (marea.estado === "rio" && marea.t < 1.2) {
        fogonazo.visible = true;
        fogonazo.scale.setScalar(1.2 + marea.t * 3);
        fogonazo.material.opacity = Math.max(0, 1 - marea.t / 1.2);
    } else fogonazo.visible = false;
    const p = marea.trozos;
    const pos = geometriaMarea.attributes.position.array;
    const lin = geometriaEstelas.attributes.position.array;
    const linB = geometriaEstelas.attributes.aBrillo.array;
    const brilloT = geometriaMarea.attributes.aBrillo.array;
    const radioT = geometriaMarea.attributes.aRadio.array;
    let vivos = 0;
    let enDisco = 0;
    const roce = marea.estado === "rio" && marea.t > 2.0;
    for (let i = 0; i < TROZOS; i++) {
        const k = i * 7;
        if (p[k + 6] <= 0) {
            brilloT[i] = 0;
            linB[i * 2 + 1] = 0;
            continue;
        }
        let r = 99;
        for (let j = 0; j < pasos; j++) r = gravedad(p, k, dt, roce);
        // Se apaga al llegar al borde o al alejarse mucho
        if (r < 1.5) p[k + 6] -= delta * 0.9;
        else if (r > 25) p[k + 6] -= delta * 0.6;
        else if (marea.t > 16 && marea.estado === "rio") p[k + 6] -= delta * 0.12;
        if (r < 4.8) enDisco++;
        pos[i * 3] = p[k];
        pos[i * 3 + 1] = p[k + 1];
        pos[i * 3 + 2] = p[k + 2];
        radioT[i] = r;
        // Recién roto, con todo el gas junto, cada trozo brilla menos para
        // no hacer una mancha blanca
        const junto = marea.estado === "rio" ? 0.3 + 0.7 * THREE.MathUtils.smoothstep(marea.t, 0, 1.4) : 1;
        brilloT[i] = Math.max(0, p[k + 6]) * junto * (0.5 + 0.7 * Math.exp(-marea.t * 0.25) + 0.45 / Math.max(r - 0.8, 0.6));
        vivos++;
        // La estela va de la posición de hace un momento a la de ahora
        const q = i * 3;
        const seguir = Math.min(1, delta * 7);
        anteriores[q] += (p[k] - anteriores[q]) * seguir;
        anteriores[q + 1] += (p[k + 1] - anteriores[q + 1]) * seguir;
        anteriores[q + 2] += (p[k + 2] - anteriores[q + 2]) * seguir;
        lin.set([anteriores[q], anteriores[q + 1], anteriores[q + 2], p[k], p[k + 1], p[k + 2]], i * 6);
        linB[i * 2] = 0;
        linB[i * 2 + 1] = brilloT[i] * 0.35 * THREE.MathUtils.smoothstep(r, 1.3, 1.9);
    }
    // Mientras el gas del planeta entra en el disco, el disco brilla más
    comunes.uPulso.value = Math.max(comunes.uPulso.value, (enDisco / TROZOS) * 0.35);
    geometriaMarea.attributes.position.needsUpdate = true;
    geometriaMarea.attributes.aBrillo.needsUpdate = true;
    geometriaMarea.attributes.aRadio.needsUpdate = true;
    geometriaEstelas.attributes.position.needsUpdate = true;
    geometriaEstelas.attributes.aBrillo.needsUpdate = true;
    if (marea.estado === "rio" && (!vivos || marea.t > 32)) {
        marea.estado = "nada";
        marea.ultima = comunes.uTiempo.value;
        rioMarea.visible = false;
        estelas.visible = false;
    }
}

// =====================================================================
// 6c. LAS SECCIONES DEL PORTFOLIO
// Un menú fijo con las partes del portfolio ("Sobre mí" lleva al camino). Al elegir una, la cámara viaja a
// su propia toma del agujero (más cerca, más lejos, desde otro lado),
// el agujero se aparta hacia un lado y aparece el panel con el texto.
// =====================================================================

const botonesSeccion = [...document.querySelectorAll(".seccion")];
const carteles = [...document.querySelectorAll(".cartel")];
const tomas = {
    "cartel-habilidades": { orbita: -1.2, altura: -0.07, zoom: 0.82 },
    "cartel-formacion": { orbita: 2.5, altura: 0.1, zoom: 1.12 },
    "cartel-contacto": { orbita: -2.7, altura: 0.0, zoom: 0.5 }
};
const seccion = { toma: null, apartar: 0, objApartar: 0 };

function abrirCartel(id) {
    carteles.forEach((c) => c.classList.toggle("visible", c.id === id));
    botonesSeccion.forEach((b) => b.classList.toggle("elegida", b.dataset.cartel === id));
    document.getElementById("pista").classList.add("oculta");
    seccion.toma = tomas[id] || null;
    seccion.objApartar = 1;
    document.body.classList.add("con-seccion");
    vista.velGiro = 0;
    vista.velAltura = 0;
    if (seccion.toma) vista.objZoom = seccion.toma.zoom;
}

function cerrarCartel() {
    carteles.forEach((c) => c.classList.remove("visible"));
    botonesSeccion.forEach((b) => b.classList.remove("elegida"));
    seccion.toma = null;
    seccion.objApartar = 0;
    vista.objZoom = 1;
    document.body.classList.remove("con-seccion");
}

botonesSeccion.forEach((b) =>
    b.addEventListener("click", () => {
        // "Sobre mí" no abre panel: lleva al planeta y de ahí al camino
        if (b.dataset.puerta) entrarPuerta(puertas.find((p) => p.id === b.dataset.puerta));
        else if (b.classList.contains("elegida")) cerrarCartel();
        else abrirCartel(b.dataset.cartel);
    })
);
carteles.forEach((c) => c.querySelector(".cerrar").addEventListener("click", cerrarCartel));
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cerrarCartel();
});

// Lleva la cámara poco a poco hacia la toma elegida (por el camino más
// corto alrededor) y aparta el agujero para dejar sitio al panel
function moverToma(delta) {
    const k = Math.min(1, delta * 1.4);
    if (seccion.toma && !vista.arrastrando) {
        let diferencia = seccion.toma.orbita - vista.orbita;
        diferencia -= Math.round(diferencia / (Math.PI * 2)) * Math.PI * 2;
        vista.orbita += diferencia * k;
        vista.orbitaAltura += (seccion.toma.altura - vista.orbitaAltura) * k;
    }
    seccion.apartar += (seccion.objApartar - seccion.apartar) * Math.min(1, delta * 2.2);
    const a = seccion.apartar;
    if (a < 0.001) {
        camara.clearViewOffset();
        return;
    }
    const estrecho = innerWidth < 760;
    const dx = estrecho ? 0 : innerWidth * 0.2 * a;
    const dy = estrecho ? innerHeight * 0.17 * a : 0;
    camara.setViewOffset(innerWidth, innerHeight, dx, dy, innerWidth, innerHeight);
}

// =====================================================================
// 6c2. POLVO CERCA DE LA CÁMARA
// Motas finas flotando entre la cámara y el agujero. Al girar se mueven
// más que las estrellas y dan sensación de profundidad. Las que quedan
// del lado del disco se tiñen de su luz cálida.
// =====================================================================

const polvo = (() => {
    const n = movil ? 220 : 420;
    const pos = new Float32Array(n * 3);
    const azarPolvo = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const r = 5 + Math.random() * 10;
        const a = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * 7;
        pos.set([CENTRO.x + Math.cos(a) * r, CENTRO.y + y, CENTRO.z + Math.sin(a) * r], i * 3);
        azarPolvo[i] = Math.random();
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometria.setAttribute("aAzar", new THREE.BufferAttribute(azarPolvo, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uEncendido: comunes.uEncendido, uEscala: { value: 1 } },
        vertexShader: `
            attribute float aAzar;
            uniform float uTiempo;
            uniform float uEscala;
            varying float vLuz;
            varying float vCalido;
            void main() {
                vec3 p = position + vec3(sin(uTiempo * 0.11 + aAzar * 40.0), sin(uTiempo * 0.07 + aAzar * 17.0) * 0.6, cos(uTiempo * 0.09 + aAzar * 23.0)) * 0.35;
                vec4 vista = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * vista;
                gl_PointSize = uEscala * (0.5 + aAzar) / -vista.z;
                vLuz = (0.35 + 0.65 * sin(uTiempo * (0.6 + aAzar) + aAzar * 30.0) * 0.5 + 0.5) * smoothstep(2.0, 6.0, -vista.z);
                vCalido = smoothstep(9.0, 4.0, length(p - vec3(${CENTRO.x.toFixed(2)}, ${CENTRO.y.toFixed(2)}, ${CENTRO.z.toFixed(2)})));
            }
        `,
        fragmentShader: `
            uniform float uEncendido;
            varying float vLuz;
            varying float vCalido;
            void main() {
                float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
                vec3 color = mix(vec3(0.55, 0.62, 0.8), vec3(1.0, 0.7, 0.42), vCalido);
                gl_FragColor = vec4(color * a * vLuz * 0.55 * uEncendido, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const puntos = new THREE.Points(geometria, material);
    puntos.frustumCulled = false;
    puntos.renderOrder = 9;
    escena.add(puntos);
    return material;
})();

// =====================================================================
// 6d. LOS PLANETAS-PUERTA
// Delante de Gargantua flotan los planetas del portfolio. Van colgados
// del grupo que mira siempre a la cámara, así que se quedan quietos en
// su sitio aunque gires alrededor: solo giran sobre sí mismos y flotan
// un poco. Al tocar uno, la cámara vuela hacia él, todo se funde a negro
// y se entra en su página. Para añadir otro planeta basta con añadir
// una entrada a PUERTAS (y su nombre en el HTML).
// =====================================================================

const PUERTAS = [
    {
        id: "camino",
        destino: "../camino-cine/?desde=gargantua",
        posicion: [-2.5, -0.85, 1.3],
        movil: [-0.7, -2.0, 1.3],
        radio: 0.33,
        radioMovil: 0.4,
        mar: [0.03, 0.09, 0.16],
        tierra: [0.09, 0.16, 0.08],
        cumbre: [0.33, 0.3, 0.23],
        luces: [1.0, 0.62, 0.3]
    }
];

const nombresPuerta = new Map([...document.querySelectorAll(".puerta")].map((b) => [b.dataset.puerta, b]));
const puertas = [];

function crearPuertas() {
    PUERTAS.forEach((datos) => {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                tRuido,
                uTiempo: comunes.uTiempo,
                uMar: { value: new THREE.Color(...datos.mar) },
                uTierra: { value: new THREE.Color(...datos.tierra) },
                uCumbre: { value: new THREE.Color(...datos.cumbre) },
                uLuces: { value: new THREE.Color(...datos.luces) },
                uEncima: { value: 0 },
                uViaje: { value: 0 }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vMundo;
                varying vec3 vLocal;
                void main() {
                    vLocal = normalize(position);
                    vNormal = normalize(mat3(modelMatrix) * normal);
                    vec4 m = modelMatrix * vec4(position, 1.0);
                    vMundo = m.xyz;
                    gl_Position = projectionMatrix * viewMatrix * m;
                }
            `,
            fragmentShader: `
                uniform sampler2D tRuido;
                uniform float uTiempo;
                uniform vec3 uMar;
                uniform vec3 uTierra;
                uniform vec3 uCumbre;
                uniform vec3 uLuces;
                uniform float uEncima;
                uniform float uViaje;
                varying vec3 vNormal;
                varying vec3 vMundo;
                varying vec3 vLocal;
                // Ruido pegado a la esfera desde tres lados, sin costuras ni polos
                float ruido(vec3 p, float escala, float desfase) {
                    vec3 w = pow(abs(vLocal), vec3(4.0));
                    w /= w.x + w.y + w.z;
                    return texture2D(tRuido, p.yz * escala + desfase).r * w.x
                         + texture2D(tRuido, p.zx * escala + desfase).r * w.y
                         + texture2D(tRuido, p.xy * escala + desfase).r * w.z;
                }
                void main() {
                    vec3 d = vLocal;
                    float alto = ruido(d, 0.45, 0.1) * 0.6 + ruido(d, 1.3, 0.4) * 0.4;
                    float tierra = smoothstep(0.5, 0.53, alto);
                    vec3 base = mix(uMar, mix(uTierra, uCumbre, smoothstep(0.6, 0.72, alto)), tierra);
                    // Nubes finas que giran un poco más rápido que el suelo
                    float nube = smoothstep(0.55, 0.75, ruido(d, 0.7, 0.2 + uTiempo * 0.004));
                    vec3 n = normalize(vNormal);
                    vec3 haciaDisco = normalize(vec3(${CENTRO.x.toFixed(2)}, ${CENTRO.y.toFixed(2)}, ${CENTRO.z.toFixed(2)}) - vMundo);
                    vec3 haciaOjo = normalize(cameraPosition - vMundo);
                    vec3 haciaLuz = normalize(haciaDisco * vec3(1.0, 0.4, 1.0) + haciaOjo * 0.8);
                    float luz = smoothstep(-0.15, 0.85, dot(n, haciaLuz));
                    vec3 suelo = mix(base, vec3(0.85), nube * 0.55);
                    vec3 color = suelo * vec3(1.0, 0.66, 0.36) * luz * 1.35 + suelo * vec3(0.35, 0.45, 0.7) * 0.12;
                    // Brillo del sol del disco reflejado en el mar
                    color += vec3(1.0, 0.75, 0.45) * pow(max(dot(reflect(-haciaLuz, n), haciaOjo), 0.0), 40.0) * (1.0 - tierra) * 0.8;
                    // En la cara de noche, las luces de los pueblos
                    float zona = smoothstep(0.55, 0.7, ruido(d, 2.0, 0.7));
                    float punto = ruido(d, 12.0, 0.3);
                    float pueblos = smoothstep(0.7, 0.78, punto) * zona * tierra * (1.0 - nube) * (1.0 - uViaje);
                    color += uLuces * pueblos * smoothstep(0.45, 0.1, luz) * 1.2;
                    // Atmósfera en el borde, más fuerte con el ratón encima
                    float filo = pow(1.0 - max(dot(n, haciaOjo), 0.0), 3.0);
                    color += vec3(0.35, 0.55, 1.0) * filo * (0.35 + uEncima * 0.9) + vec3(1.0, 0.6, 0.3) * filo * luz * 0.6;
                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });
        const malla = brillar(new THREE.Mesh(new THREE.SphereGeometry(datos.radio, 64, 44), material));
        malla.position.set(...datos.posicion);
        malla.rotation.z = 0.35;
        malla.renderOrder = 11;
        // Zona invisible más grande para que sea fácil de tocar en el móvil
        const zona = new THREE.Mesh(new THREE.SphereGeometry(datos.radio * 1.9, 16, 12), new THREE.MeshBasicMaterial({ visible: false }));
        malla.add(zona);
        malla.userData.zona = zona;
        arcos.add(malla);
        // Un aro fino que sale del planeta y se apaga, para que se vea que
        // se puede tocar (solo hasta la primera vez que se entra)
        const aro = new THREE.Mesh(
            new THREE.PlaneGeometry(datos.radio * 5, datos.radio * 5),
            new THREE.ShaderMaterial({
                uniforms: { uFase: { value: 0 }, uFuerza: { value: 0 } },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uFase;
                    uniform float uFuerza;
                    varying vec2 vUv;
                    void main() {
                        float r = length(vUv - 0.5) * 2.0;
                        float radio = mix(0.42, 0.95, uFase);
                        float linea = exp(-pow((r - radio) / 0.018, 2.0));
                        float apaga = (1.0 - uFase) * smoothstep(0.0, 0.12, uFase);
                        gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * linea * apaga * uFuerza, 1.0);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        aro.renderOrder = 12;
        arcos.add(aro);
        puertas.push({ ...datos, malla, aro, nombre: nombresPuerta.get(datos.id), encima: 0, objEncima: 0, fase: Math.random() * 6 });
        const boton = nombresPuerta.get(datos.id);
        if (boton) {
            const esta = puertas[puertas.length - 1];
            boton.addEventListener("click", () => entrarPuerta(esta));
            // Con el teclado (Tab) el planeta se ilumina igual que con el ratón
            boton.addEventListener("focus", () => (esta.objEncima = 1));
            boton.addEventListener("blur", () => (esta.objEncima = 0));
        }
    });
}

const auxPuerta = new THREE.Vector3();

// Si ya se ha entrado alguna vez en un planeta, no hace falta la pista
let puertaVista = false;
try {
    puertaVista = localStorage.getItem("gargantua-puerta") === "si";
} catch (error) {
    puertaVista = false;
}

function moverPuertas(delta, t) {
    puertas.forEach((p) => {
        p.malla.rotation.y += delta * 0.08;
        const enMovil = innerWidth < innerHeight;
        const sitio = enMovil ? p.movil : p.posicion;
        const radio = enMovil ? p.radioMovil : p.radio;
        p.malla.position.set(sitio[0], sitio[1] + Math.sin(t * 0.6 + p.fase) * 0.05, sitio[2]);
        p.encima += (p.objEncima - p.encima) * Math.min(1, delta * 6);
        p.malla.material.uniforms.uEncima.value = p.encima;
        p.malla.material.uniforms.uViaje.value = viaje.puerta === p ? Math.min(1, viaje.t * 2) : 0;
        const escala = (radio / p.radio) * (1 + p.encima * 0.06);
        p.malla.scale.setScalar(escala * THREE.MathUtils.smoothstep(comunes.uEncendido.value, 0.3, 0.9));
        p.malla.visible = comunes.uEncendido.value > 0.3;
        p.aro.position.copy(p.malla.position);
        p.aro.scale.setScalar(radio / p.radio);
        const u = p.aro.material.uniforms;
        u.uFase.value = (t * 0.4 + p.fase) % 1;
        const pista = !puertaVista && listo && comunes.uEncendido.value > 0.8 && !viaje.activo && p.objEncima === 0 ? 1 : 0;
        u.uFuerza.value += (pista - u.uFuerza.value) * Math.min(1, delta * 2);
        p.aro.visible = u.uFuerza.value > 0.01;
        // El nombre, centrado debajo del planeta
        if (!p.nombre) return;
        p.malla.getWorldPosition(auxPuerta);
        auxPuerta.y -= radio * 1.15;
        auxPuerta.project(camara);
        const x = (auxPuerta.x * 0.5 + 0.5) * innerWidth;
        const y = (-auxPuerta.y * 0.5 + 0.5) * innerHeight;
        p.nombre.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, 0)`;
        p.nombre.classList.toggle("visible", listo && comunes.uEncendido.value > 0.8 && !viaje.activo && !vuelta.activo);
        p.nombre.classList.toggle("encima", p.objEncima > 0);
    });
}

function puertaBajo(e) {
    punteroPuerta.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    rayoPuerta.setFromCamera(punteroPuerta, camara);
    const corte = rayoPuerta.intersectObjects(puertas.map((p) => p.malla.userData.zona), false)[0];
    return corte ? puertas.find((p) => p.malla.userData.zona === corte.object) : null;
}
const rayoPuerta = new THREE.Raycaster();
const punteroPuerta = new THREE.Vector2();

// El ratón cerca de la sombra: el anillo de luz se aviva y el gas va más
// despacio, como si el tiempo se estirara al acercarse
const ratonCerca = { x: 0.5, y: 0.5, dentro: false, fuerza: 0 };
document.addEventListener("pointerleave", () => (ratonCerca.dentro = false));
document.documentElement.addEventListener("mouseleave", () => (ratonCerca.dentro = false));

function moverRatonCerca(delta) {
    const centro = brillo.mezclar.uniforms.uCentro.value;
    const dx = (ratonCerca.x - centro.x) * (innerWidth / innerHeight);
    const dy = ratonCerca.y - centro.y;
    const objetivo = ratonCerca.dentro && !viaje.activo ? 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dy), 0.1, 0.42) : 0;
    ratonCerca.fuerza += (objetivo - ratonCerca.fuerza) * Math.min(1, delta * 2.5);
}

// El viaje: la cámara se acerca al planeta y todo se funde a negro;
// entonces se abre su página
const viaje = { activo: false, t: 0, desde: new THREE.Vector3(), hacia: new THREE.Vector3(), puerta: null };
const fundido = document.getElementById("fundido");

function entrarPuerta(p) {
    if (viaje.activo || !p) return;
    puertaVista = true;
    try {
        localStorage.setItem("gargantua-puerta", "si");
    } catch (error) {
        puertaVista = true;
    }
    cerrarCartel();
    viaje.activo = true;
    viaje.t = 0;
    viaje.puerta = p;
    viaje.desde.copy(camara.position);
    p.malla.getWorldPosition(viaje.hacia);
    fundido.classList.add("activo");
    document.body.classList.add("viajando");
    if (sonido.activo) sonarDespertar();
}

// La vuelta: al cerrar el camino la cámara sale desde el planeta y se
// aleja hasta su sitio, al revés que la ida
const vuelta = { activo: false, t: 0, puerta: null, planeta: new THREE.Vector3(), destino: new THREE.Vector3() };

function moverViaje(delta) {
    if (vuelta.activo) {
        vuelta.t += delta / 2.2;
        const k = vuelta.t < 1 ? 1 - Math.pow(1 - vuelta.t, 3) : 1;
        vuelta.puerta.malla.getWorldPosition(vuelta.planeta);
        vuelta.destino.copy(camara.position);
        camara.position.lerpVectors(auxPuerta.copy(vuelta.destino).lerp(vuelta.planeta, 0.75), vuelta.destino, k);
        camara.lookAt(auxPuerta.copy(vuelta.planeta).lerp(CENTRO, k));
        if (vuelta.t >= 1) vuelta.activo = false;
        return true;
    }
    if (!viaje.activo) return false;
    viaje.t += delta / 1.8;
    const k = viaje.t < 1 ? 1 - Math.pow(1 - viaje.t, 3) : 1;
    viaje.puerta.malla.getWorldPosition(viaje.hacia);
    camara.position.lerpVectors(viaje.desde, viaje.hacia, k * 0.75);
    camara.lookAt(auxPuerta.copy(viaje.hacia).lerp(CENTRO, 1 - k));
    if (viaje.t >= 1.1 && !viaje.ido) {
        viaje.ido = true;
        abrirMundo(viaje.puerta.destino);
    }
    return true;
}

// El mundo del planeta se abre dentro de esta misma página, encima y a
// pantalla completa, sin cambiar de página. Mientras está abierto,
// Gargantua deja de pintarse. Se vuelve con su botón o con el de atrás
// del navegador. Si el destino es otra web (una dirección completa), se
// va a ella sin más.
const mundo = { marco: null, abierto: false };

function abrirMundo(destino) {
    if (/^https?:/.test(destino)) {
        try {
            window.top.location.href = destino;
        } catch (error) {
            window.open(destino, "_blank");
        }
        return;
    }
    const marco = document.createElement("iframe");
    marco.className = "mundo";
    marco.title = "Sobre mí";
    marco.src = destino + (destino.includes("?") ? "&" : "?") + "dentro=si";
    marco.addEventListener("load", () => {
        // Si dentro se ha ido a Gargantua (por ejemplo, el enlace de volver
        // antes de que cargara el camino), se cierra el mundo
        try {
            const ruta = marco.contentWindow.location.pathname;
            if (ruta.endsWith("/gargantua/") || ruta.endsWith("/gargantua/index.html")) {
                cerrarMundo();
                return;
            }
        } catch (error) {
            marco.focus();
        }
        marco.focus();
    });
    document.body.appendChild(marco);
    mundo.marco = marco;
    mundo.abierto = true;
    if (sonido.ctx && sonido.activo) sonido.ctx.suspend();
    history.pushState({ mundo: true }, "", "#sobre-mi");
}

function cerrarMundo() {
    if (!mundo.abierto) return;
    mundo.abierto = false;
    const marco = mundo.marco;
    if (location.hash === "#sobre-mi") history.replaceState(null, "", location.pathname + location.search);
    // Detrás del negro la cámara vuelve a su sitio; el mundo se apaga y
    // después se quita el negro para que Gargantua aparezca
    if (viaje.puerta) Object.assign(vuelta, { activo: true, t: 0, puerta: viaje.puerta });
    viaje.activo = false;
    viaje.puerta = null;
    viaje.ido = false;
    reloj.getDelta();
    marco.classList.add("saliendo");
    if (sonido.ctx && sonido.activo) sonido.ctx.resume();
    setTimeout(() => {
        marco.remove();
        mundo.marco = null;
        fundido.classList.remove("activo");
        document.body.classList.remove("viajando");
    }, 650);
}

window.addEventListener("message", (e) => {
    if (e.data === "volver-gargantua" && mundo.abierto) cerrarMundo();
});
window.addEventListener("popstate", () => {
    if (mundo.abierto) cerrarMundo();
});

// =====================================================================
// 7. RESPLANDOR EN VARIAS CAPAS
// Se pinta aparte solo lo que brilla (el gas, los arcos, los anillos y
// la sombra negra, que tapa lo que queda detrás). Se queda con lo más
// fuerte, se difumina a la mitad, a un cuarto y a un octavo de tamaño
// y se suma a la imagen: un brillo cercano y nítido y otro amplio y
// suave. Sobre la sombra casi no se suma, para que siga negra.
// =====================================================================

const VERTICE_PLANO = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

class PaseBrillo extends Pass {
    constructor() {
        super();
        const op = { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false };
        this.escena = new THREE.WebGLRenderTarget(1, 1, { ...op, depthBuffer: true });
        this.niveles = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)]);
        this.raya = [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)];
        this.difuminar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uDir: { value: new THREE.Vector2() } },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tEntrada;
                uniform vec2 uDir;
                varying vec2 vUv;
                void main() {
                    vec3 c = texture2D(tEntrada, vUv).rgb * 0.2270;
                    c += (texture2D(tEntrada, vUv + uDir * 1.385).rgb + texture2D(tEntrada, vUv - uDir * 1.385).rgb) * 0.3162;
                    c += (texture2D(tEntrada, vUv + uDir * 3.231).rgb + texture2D(tEntrada, vUv - uDir * 3.231).rgb) * 0.0703;
                    gl_FragColor = vec4(c, 1.0);
                }
            `
        });
        this.recortar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uUmbral: { value: 0.7 }, uPaso: { value: new THREE.Vector2() } },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tEntrada;
                uniform float uUmbral;
                uniform vec2 uPaso;
                varying vec2 vUv;
                void main() {
                    vec3 c = texture2D(tEntrada, vUv + uPaso * vec2(-0.5, -0.5)).rgb + texture2D(tEntrada, vUv + uPaso * vec2(0.5, -0.5)).rgb
                           + texture2D(tEntrada, vUv + uPaso * vec2(-0.5, 0.5)).rgb + texture2D(tEntrada, vUv + uPaso * vec2(0.5, 0.5)).rgb;
                    c *= 0.25;
                    float l = max(c.r, max(c.g, c.b));
                    gl_FragColor = vec4(c * max(l - uUmbral, 0.0) / max(l, 0.0001), 1.0);
                }
            `
        });
        this.copiar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null } },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tEntrada;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = vec4(texture2D(tEntrada, vUv).rgb, 1.0);
                }
            `
        });
        this.mezclar = new THREE.ShaderMaterial({
            uniforms: {
                tBase: { value: null },
                tN0: { value: null },
                tN1: { value: null },
                tN2: { value: null },
                tRaya: { value: null },
                uRaya: { value: 0.22 },
                uFuerza: { value: 0.55 },
                uCentro: { value: new THREE.Vector2(0.5, 0.5) },
                uElipse: { value: new THREE.Matrix3() }
            },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tBase;
                uniform sampler2D tN0;
                uniform sampler2D tN1;
                uniform sampler2D tN2;
                uniform sampler2D tRaya;
                uniform float uRaya;
                uniform float uFuerza;
                uniform vec2 uCentro;
                uniform mat3 uElipse;
                varying vec2 vUv;
                void main() {
                    vec4 base = texture2D(tBase, vUv);
                    vec3 brillo = texture2D(tN0, vUv).rgb * 0.22 + texture2D(tN1, vUv).rgb * 0.42 + texture2D(tN2, vUv).rgb * 0.75;
                    // La sombra en pantalla es una elipse (por la perspectiva);
                    // dentro casi no se suma brillo para que siga negra
                    vec2 d = vUv - uCentro;
                    vec2 e = mat2(uElipse[0].xy, uElipse[1].xy) * d;
                    float bola = 1.0 - smoothstep(0.8, 1.0, sqrt(dot(d, e)));
                    brillo += texture2D(tRaya, vUv).rgb * vec3(0.8, 0.88, 1.0) * uRaya;
                    brillo *= 1.0 - bola * 0.88;
                    gl_FragColor = vec4(base.rgb + brillo * uFuerza, base.a);
                }
            `
        });
        this.cuadro = new FullScreenQuad();
        this.negro = new THREE.Color(0, 0, 0);
        this.antes = new THREE.Color();
    }

    setSize(ancho, alto) {
        const m = Math.max(1, Math.round(ancho / ajustes.brilloEscala));
        const n = Math.max(1, Math.round(alto / ajustes.brilloEscala));
        this.escena.setSize(m, n);
        this.niveles.forEach((par, i) => {
            const f = 1 << i;
            par.forEach((rt) => rt.setSize(Math.max(1, Math.round(m / f)), Math.max(1, Math.round(n / f))));
        });
        this.raya.forEach((rt) => rt.setSize(Math.max(1, Math.round(m / 2)), Math.max(1, Math.round(n / 4))));
    }

    pasada(renderizador, material, destino) {
        this.cuadro.material = material;
        renderizador.setRenderTarget(destino);
        this.cuadro.render(renderizador);
    }

    difumina(renderizador, [rt, auxiliar], escala) {
        const u = this.difuminar.uniforms;
        u.tEntrada.value = rt.texture;
        u.uDir.value.set(escala / rt.width, 0);
        this.pasada(renderizador, this.difuminar, auxiliar);
        u.tEntrada.value = auxiliar.texture;
        u.uDir.value.set(0, escala / rt.height);
        this.pasada(renderizador, this.difuminar, rt);
    }

    render(renderizador, destino, origen) {
        const mascara = camara.layers.mask;
        renderizador.getClearColor(this.antes);
        const alfaAntes = renderizador.getClearAlpha();
        camara.layers.set(CAPA_BRILLO);
        renderizador.setClearColor(this.negro, 1);
        renderizador.setRenderTarget(this.escena);
        renderizador.clear();
        renderizador.render(escena, camara);

        // El destello horizontal se saca antes de pintar lo fugaz: solo lo
        // más fuerte del disco, estirado de lado
        const [ra, rb] = this.raya;
        this.recortar.uniforms.tEntrada.value = this.escena.texture;
        this.recortar.uniforms.uPaso.value.set(1 / this.escena.width, 1 / this.escena.height);
        this.recortar.uniforms.uUmbral.value = 3.0;
        this.pasada(renderizador, this.recortar, ra);
        this.recortar.uniforms.uUmbral.value = 0.7;

        // Lo fugaz se suma encima, respetando lo que tapa la sombra (solo
        // si hay algo que pintar)
        if (planeta.visible || rioMarea.visible || fogonazo.visible) {
            camara.layers.set(CAPA_FUGAZ);
            const limpiarAntes = renderizador.autoClear;
            renderizador.autoClear = false;
            renderizador.setRenderTarget(this.escena);
            renderizador.render(escena, camara);
            renderizador.autoClear = limpiarAntes;
        }
        camara.layers.mask = mascara;
        renderizador.setClearColor(this.antes, alfaAntes);

        const [n0, n1, n2] = this.niveles;
        this.pasada(renderizador, this.recortar, n0[0]);
        this.difumina(renderizador, n0, 1.0);
        this.copiar.uniforms.tEntrada.value = n0[0].texture;
        this.pasada(renderizador, this.copiar, n1[0]);
        this.difumina(renderizador, n1, 1.4);
        this.copiar.uniforms.tEntrada.value = n1[0].texture;
        this.pasada(renderizador, this.copiar, n2[0]);
        this.difumina(renderizador, n2, 1.6);
        this.difumina(renderizador, n2, 3.0);

        const d = this.difuminar.uniforms;
        [[ra, rb, 2], [rb, ra, 4.5], [ra, rb, 10], [rb, ra, 22]].forEach(([desde, hacia, escala]) => {
            d.tEntrada.value = desde.texture;
            d.uDir.value.set(escala / desde.width, 0);
            this.pasada(renderizador, this.difuminar, hacia);
        });

        const u = this.mezclar.uniforms;
        u.tBase.value = origen.texture;
        u.tN0.value = n0[0].texture;
        u.tN1.value = n1[0].texture;
        u.tN2.value = n2[0].texture;
        u.tRaya.value = ra.texture;
        this.pasada(renderizador, this.mezclar, this.renderToScreen ? null : destino);
    }
}


// =====================================================================
// 8. EFECTOS: RESPLANDOR Y ACABADO
// Al final, un poco más de contraste, los colores que se separan muy
// poco hacia los bordes como en una lente de verdad, un oscurecido
// suave en las esquinas y un grano muy fino que evita que los
// degradados oscuros se vean a escalones.
// =====================================================================

const contexto = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && !!(contexto.getExtension("EXT_color_buffer_float") || contexto.getExtension("EXT_color_buffer_half_float"));
const compositor = new EffectComposer(renderizador, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType }));
compositor.addPass(new RenderPass(escena, camara));
const brillo = new PaseBrillo();
compositor.addPass(brillo);
compositor.addPass(new OutputPass());
const acabado = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTiempo: comunes.uTiempo },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTiempo;
        varying vec2 vUv;
        void main() {
            vec2 q = vUv - 0.5;
            vec2 desvio = q * dot(q, q) * 0.007;
            vec4 c = texture2D(tDiffuse, vUv);
            c.r = texture2D(tDiffuse, vUv - desvio).r;
            c.b = texture2D(tDiffuse, vUv + desvio).b;
            c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.2);
            c.rgb *= 1.0 - dot(q, q) * 0.55;
            vec3 g3 = fract(vec3(gl_FragCoord.xyx + fract(uTiempo * 7.0) * 61.0) * 0.1031); g3 += dot(g3, g3.yzx + 33.33); float grano = fract((g3.x + g3.y) * g3.z);
            c.rgb += (grano - 0.5) / 255.0 * 1.5;
            gl_FragColor = c;
        }
    `
});
compositor.addPass(acabado);


// =====================================================================
// 9. LA VISTA
// Arrastrando se gira alrededor del agujero, y al soltar sigue girando
// un poco y se frena solo (inercia). Con la rueda o pellizcando te
// acercas: la luz se dobla más, el anillo brilla más, el gas va más
// lento (el tiempo pasa más despacio cerca) y el sonido se hace más
// grave. Sin tocar nada, la cámara se mece muy despacio. El agujero
// sigue casi del todo a la cámara.
// =====================================================================

const vista = {
    giro: 0, altura: 0, objGiro: 0, objAltura: 0, radio: 16.4, arrastrando: false, x: 0, y: 0,
    orbita: 0, orbitaAltura: 0, velGiro: 0, velAltura: 0,
    zoom: 1, objZoom: 1, giroActual: BASE_GIRO, punteros: new Map(), pellizco: 0
};

// 0 lejos, 1 lo más cerca posible
const cercania = () => THREE.MathUtils.clamp((1 - vista.zoom) / (1 - 0.42), 0, 1);
const auxV = new THREE.Vector3();

function colocarCamara(delta, t) {
    const suave = Math.min(1, delta * 2.5);
    vista.giro += (vista.objGiro - vista.giro) * suave;
    vista.altura += (vista.objAltura - vista.altura) * suave;
    // Inercia: al soltar sigue girando y se va frenando
    if (!vista.arrastrando) {
        vista.orbita += vista.velGiro * delta;
        vista.orbitaAltura += vista.velAltura * delta;
        const freno = Math.exp(-delta * 1.6);
        vista.velGiro *= freno;
        vista.velAltura *= freno;
    }
    vista.orbitaAltura = THREE.MathUtils.clamp(vista.orbitaAltura, -0.1, 0.12);
    vista.zoom += (vista.objZoom - vista.zoom) * Math.min(1, delta * 3);
    // La llegada: se empieza lejos y algo más arriba, y la cámara se
    // acerca despacio mientras el gas se enciende
    const llegada = 1 - THREE.MathUtils.smoothstep(entrada.t, 0, 7.5);
    const acercar = 1 + 1.5 * llegada * llegada;
    const balanceo = pocoMovimiento ? 0 : 1;
    const giro = BASE_GIRO + vista.orbita + vista.giro + Math.sin(t * 0.12) * 0.05 * balanceo;
    const altura = Math.max(0.04, BASE_ALTURA + vista.orbitaAltura + vista.altura + Math.sin(t * 0.09) * 0.015 * balanceo + llegada * llegada * 0.12);
    vista.giroActual = giro;
    camara.position.set(Math.sin(giro) * Math.cos(altura), Math.sin(altura), Math.cos(giro) * Math.cos(altura)).multiplyScalar(vista.radio * acercar * vista.zoom).add(OBJETIVO);
    camara.lookAt(OBJETIVO);
}

function orientarAgujero() {
    auxV.subVectors(camara.position, CENTRO);
    // El giro sin cortes (atan2 saltaría de -180 a 180 grados al dar la vuelta)
    let giro = Math.atan2(auxV.x, auxV.z);
    giro += Math.round((vista.giroActual - giro) / (Math.PI * 2)) * Math.PI * 2;
    const elevacion = Math.atan2(auxV.y, Math.hypot(auxV.x, auxV.z));
    // El disco sigue del todo a la cámara al girar alrededor (así nunca se
    // ve la bola negra sola); solo la pequeña inclinación del ratón y el
    // balanceo cambian un poco el ángulo, y eso está acotado
    const g = giro - vista.giro * 0.25;
    const e = elevacion - (vista.altura + vista.orbitaAltura) * 0.25;
    agujero.rotation.set(-(e - 0.2), g, -0.4);
    agujero.updateMatrixWorld();
    arcos.rotation.set(-(elevacion - 0.2), giro, -0.4);
    arcos.updateMatrixWorld();
    auxV.copy(camara.position);
    agujero.worldToLocal(auxV);
    comunes.uVista.value.copy(auxV).normalize();
}

// Aleja la cámara lo justo para que el disco quepa a lo ancho, sobre
// todo con el móvil en vertical
function encuadrar() {
    const mitad = Math.atan(Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)) * camara.aspect);
    vista.radio = Math.min(30, Math.max(16, 4.2 / Math.tan(mitad)));
}

// La sombra en pantalla, para que el resplandor no la tape, y el tamaño
// de la lente para el fondo. La silueta de la bola se proyecta punto a
// punto y se ajusta una elipse (con la perspectiva no es un círculo
// centrado, sobre todo de cerca y fuera del centro de la pantalla).
const silueta = Array.from({ length: 16 }, () => new THREE.Vector3());
const auxEje1 = new THREE.Vector3();
const auxEje2 = new THREE.Vector3();
const auxCentroSil = new THREE.Vector3();

function marcarBola() {
    camara.updateMatrixWorld();
    const distancia = camara.position.distanceTo(CENTRO);
    const angulo = Math.asin(1 / distancia);
    fondo.material.uniforms.uRadioLente.value = angulo * 2.4;
    // Círculo de contacto de la bola vista desde la cámara
    const haciaOjo = auxV.subVectors(camara.position, CENTRO).normalize();
    auxCentroSil.copy(CENTRO).addScaledVector(haciaOjo, 1 / distancia);
    const radio = Math.sqrt(1 - 1 / (distancia * distancia));
    auxEje1.set(0, 1, 0).cross(haciaOjo).normalize();
    auxEje2.crossVectors(haciaOjo, auxEje1);
    let cx = 0;
    let cy = 0;
    silueta.forEach((p, i) => {
        const a = (i / silueta.length) * Math.PI * 2;
        p.copy(auxCentroSil).addScaledVector(auxEje1, Math.cos(a) * radio).addScaledVector(auxEje2, Math.sin(a) * radio).project(camara);
        p.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 0);
        cx += p.x;
        cy += p.y;
    });
    cx /= silueta.length;
    cy /= silueta.length;
    // Elipse a partir de la dispersión de los puntos: E = 2 * covarianza
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    silueta.forEach((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    });
    const n = silueta.length / 2;
    sxx /= n;
    sxy /= n;
    syy /= n;
    const det = sxx * syy - sxy * sxy || 1e-9;
    const u = brillo.mezclar.uniforms;
    u.uCentro.value.set(cx, cy);
    u.uElipse.value.set(syy / det, -sxy / det, 0, -sxy / det, sxx / det, 0, 0, 0, 1);
}


// =====================================================================
// 10. TOCAR
// Mover el ratón inclina la vista. Arrastrar con el dedo también. Tocar
// sin arrastrar despierta al agujero: el gas se enciende, una onda cae
// hacia dentro y el anillo de luz brilla más.
// =====================================================================

const pista = document.getElementById("pista");

// El sonido: un zumbido grave como de órgano (varias notas suaves con
// eco) que solo empieza al pulsar el botón. Al despertar al agujero se
// abre y sube un momento.
const sonido = { ctx: null, activo: false, maestro: null, filtro: null, osciladores: [], base: 520 };
const botonSonido = document.getElementById("boton-sonido");

function impulsoEco(ctx, segundos) {
    const largo = Math.floor(ctx.sampleRate * segundos);
    const buffer = ctx.createBuffer(2, largo, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
        const datos = buffer.getChannelData(canal);
        for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / largo, 2.6);
    }
    return buffer;
}

function crearSonido() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const maestro = ctx.createGain();
    maestro.gain.value = 0;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 520;
    filtro.Q.value = 0.7;
    const eco = ctx.createConvolver();
    eco.buffer = impulsoEco(ctx, 4.5);
    const seco = ctx.createGain();
    seco.gain.value = 0.55;
    const mojado = ctx.createGain();
    mojado.gain.value = 0.7;
    filtro.connect(seco).connect(maestro);
    filtro.connect(eco).connect(mojado).connect(maestro);
    maestro.connect(ctx.destination);
    [[55, 0.5, "sine"], [82.41, 0.28, "sine"], [110, 0.3, "triangle"], [164.81, 0.14, "triangle"], [220, 0.08, "sine"]].forEach(([frecuencia, volumen, tipo]) => {
        [-4, 4].forEach((desafinar) => {
            const osc = ctx.createOscillator();
            osc.type = tipo;
            osc.frequency.value = frecuencia;
            osc.detune.value = desafinar;
            osc.userData = desafinar;
            sonido.osciladores.push(osc);
            const voz = ctx.createGain();
            voz.gain.value = volumen / 2;
            osc.connect(voz).connect(filtro);
            osc.start();
        });
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const profundidad = ctx.createGain();
    profundidad.gain.value = 160;
    lfo.connect(profundidad).connect(filtro.frequency);
    lfo.start();
    Object.assign(sonido, { ctx, maestro, filtro });
}

function cambiarSonido() {
    if (!sonido.ctx) crearSonido();
    sonido.activo = !sonido.activo;
    sonido.ctx.resume();
    sonido.maestro.gain.setTargetAtTime(sonido.activo ? 0.22 : 0, sonido.ctx.currentTime, 0.8);
    botonSonido.setAttribute("aria-pressed", sonido.activo);
    botonSonido.classList.toggle("activo", sonido.activo);
}

// Al romperse la estrella: un rugido de ruido que sube y se apaga
function sonarMarea() {
    if (!sonido.activo) return;
    const ctx = sonido.ctx;
    const t = ctx.currentTime;
    const largo = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let ultimo = 0;
    for (let i = 0; i < largo; i++) {
        ultimo = (ultimo + 0.04 * (Math.random() * 2 - 1)) / 1.04;
        datos[i] = ultimo * 3;
    }
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.setValueAtTime(120, t);
    filtro.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    filtro.frequency.exponentialRampToValueAtTime(80, t + 3);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0, t);
    vol.gain.linearRampToValueAtTime(0.5, t + 0.3);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 3);
    fuente.connect(filtro).connect(vol).connect(sonido.maestro);
    fuente.onended = () => {
        fuente.disconnect();
        vol.disconnect();
    };
    fuente.start(t);
}

// Cerca del agujero el zumbido baja de tono y se apaga lo agudo
function sonidoCercania() {
    if (!sonido.ctx || !sonido.activo) return;
    const c = cercania();
    const ahora = sonido.ctx.currentTime;
    sonido.base = 520 * (1 - 0.55 * c);
    sonido.osciladores.forEach((o) => o.detune.setTargetAtTime(o.userData - c * 500, ahora, 0.4));
    if (comunes.uPulso.value < 0.05) {
        sonido.filtro.frequency.setTargetAtTime(sonido.base, ahora, 0.4);
        sonido.maestro.gain.setTargetAtTime(0.22 * (1 + c * 0.5), ahora, 0.4);
    }
}

function sonarDespertar() {
    if (!sonido.activo) return;
    const ahora = sonido.ctx.currentTime;
    const f = sonido.filtro.frequency;
    f.cancelScheduledValues(ahora);
    f.setTargetAtTime(1700, ahora, 0.08);
    f.setTargetAtTime(sonido.base, ahora + 0.7, 1.3);
    const g = sonido.maestro.gain;
    g.cancelScheduledValues(ahora);
    g.setTargetAtTime(0.36, ahora, 0.1);
    g.setTargetAtTime(0.22, ahora + 0.8, 1.5);
}

botonSonido.addEventListener("click", cambiarSonido);
// Al volver con el botón de atrás del navegador la página puede venir de
// la caché con el fundido puesto: se quita y se reinicia el viaje
window.addEventListener("pageshow", () => {
    fundido.classList.remove("activo");
    document.body.classList.remove("viajando");
    viaje.activo = false;
    viaje.puerta = null;
    viaje.ido = false;
});
document.addEventListener("visibilitychange", () => {
    if (!sonido.ctx || !sonido.activo) return;
    if (document.hidden) sonido.ctx.suspend();
    else sonido.ctx.resume();
});
const toque = { x: 0, y: 0, t: 0 };
const lienzo = renderizador.domElement;

function despertar() {
    sonarDespertar();
    comunes.uPulso.value = 1;
    comunes.uOnda.value = 5.2;
}

function cambiarZoom(factor) {
    vista.objZoom = THREE.MathUtils.clamp(vista.objZoom * factor, 0.42, 1.3);
}

lienzo.addEventListener("pointerdown", (e) => {
    pista.classList.add("oculta");
    lienzo.setPointerCapture(e.pointerId);
    vista.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    Object.assign(toque, { x: e.clientX, y: e.clientY, t: performance.now() });
    vista.arrastrando = true;
    vista.velGiro = 0;
    vista.velAltura = 0;
    vista.x = e.clientX;
    vista.y = e.clientY;
    if (vista.punteros.size === 2) {
        const [a, b] = [...vista.punteros.values()];
        vista.pellizco = Math.hypot(a.x - b.x, a.y - b.y);
    }
});

lienzo.addEventListener("pointermove", (e) => {
    if (vista.punteros.has(e.pointerId)) vista.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Dos dedos: pellizcar para acercar o alejar
    if (vista.punteros.size === 2) {
        const [a, b] = [...vista.punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (vista.pellizco > 0) cambiarZoom(vista.pellizco / d);
        vista.pellizco = d;
        return;
    }
    if (!vista.arrastrando) {
        // Ratón sin pulsar: solo inclina un poco la vista
        if (e.pointerType === "mouse") {
            const puerta = listo ? puertaBajo(e) : null;
            puertas.forEach((p) => (p.objEncima = p === puerta ? 1 : 0));
            lienzo.style.cursor = puerta ? "pointer" : "";
            vista.objGiro = -(e.clientX / innerWidth - 0.5) * 0.3;
            vista.objAltura = (e.clientY / innerHeight - 0.5) * 0.1;
            ratonCerca.x = e.clientX / innerWidth;
            ratonCerca.y = 1 - e.clientY / innerHeight;
            ratonCerca.dentro = true;
        }
        return;
    }
    const dx = (e.clientX - vista.x) / innerWidth;
    const dy = (e.clientY - vista.y) / innerHeight;
    vista.orbita -= dx * 3.2;
    vista.orbitaAltura += dy * 1.2;
    const dt = Math.max(0.008, (performance.now() - (vista.ultimo || 0)) / 1000);
    vista.velGiro = THREE.MathUtils.clamp((-dx * 3.2) / dt, -3, 3);
    vista.velAltura = THREE.MathUtils.clamp((dy * 1.2) / dt, -1, 1);
    vista.ultimo = performance.now();
    vista.x = e.clientX;
    vista.y = e.clientY;
});

lienzo.addEventListener("wheel", (e) => {
    e.preventDefault();
    pista.classList.add("oculta");
    cambiarZoom(Math.exp(e.deltaY * 0.0012));
}, { passive: false });

const soltar = (e) => {
    vista.punteros.delete(e.pointerId);
    if (vista.punteros.size < 2) vista.pellizco = 0;
    if (vista.punteros.size > 0) return;
    vista.arrastrando = false;
    // Si hace rato que no se movía, no se lanza al soltar
    if (performance.now() - (vista.ultimo || 0) > 120) {
        vista.velGiro = 0;
        vista.velAltura = 0;
    }
    if (e.type === "pointerup" && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 8 && performance.now() - toque.t < 350) {
        const puerta = puertaBajo(e);
        if (puerta) {
            entrarPuerta(puerta);
            return;
        }
        despertar();
        if (comerPlanetas) lanzarPlaneta();
    }
};
lienzo.addEventListener("pointerup", soltar);
lienzo.addEventListener("pointercancel", soltar);
document.addEventListener("pointerleave", () => {
    vista.objGiro = 0;
    vista.objAltura = 0;
});


// =====================================================================
// 11. MOVIMIENTO
// =====================================================================

const reloj = new THREE.Clock();
let listo = false;

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 44 : 30;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
    materialMarea.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight * 0.12;
    polvo.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight * 0.04;
}

window.addEventListener("resize", () => {
    ajustarTamano();
    encuadrar();
});

// Si el aparato no llega a unos 28 fotogramas por segundo se baja un
// poco la resolución, y si va sobrado se vuelve a subir
const ritmo = { suma: 0, cuenta: 0, espera: 2, actual: renderizador.getPixelRatio(), fija: parametros.has("fijo") };

function adaptarResolucion(delta) {
    if (ritmo.fija) return;
    ritmo.espera -= delta;
    ritmo.suma += delta;
    ritmo.cuenta++;
    if (ritmo.cuenta < 40 || ritmo.espera > 0) return;
    const media = (ritmo.suma / ritmo.cuenta) * 1000;
    ritmo.suma = 0;
    ritmo.cuenta = 0;
    const tope = Math.min(devicePixelRatio || 1, ajustes.resolucionMax);
    let nueva = ritmo.actual;
    if (media > 36) nueva = Math.max(ajustes.resolucionMin, ritmo.actual - 0.25);
    else if (media < 20) nueva = Math.min(tope, ritmo.actual + 0.125);
    if (nueva === ritmo.actual) return;
    ritmo.actual = nueva;
    ritmo.espera = 1.5;
    renderizador.setPixelRatio(nueva);
    compositor.setPixelRatio(nueva);
    ajustarTamano();
}

// La entrada: primero aparecen las estrellas y la sombra negra, y
// después el gas se va encendiendo en espiral de fuera hacia dentro
// mientras la cámara se acerca un poco
// Dura unos 4 segundos; si ya se ha visto otra vez, unos 2
const entrada = { t: parametros.has("fijo") || parametros.has("sinentrada") || pocoMovimiento ? 10 : 0, ritmo: 1.7 };
try {
    if (localStorage.getItem("gargantua-visto") === "si") entrada.ritmo = 3.4;
    localStorage.setItem("gargantua-visto", "si");
} catch (error) {
    entrada.ritmo = 1.7;
}

function moverEntrada(delta) {
    entrada.t += delta * entrada.ritmo;
    const gas = THREE.MathUtils.smoothstep(entrada.t, 0.9, 6);
    fondo.material.uniforms.uAparece.value = THREE.MathUtils.smoothstep(entrada.t, 0.2, 1.6);
    comunes.uEncendido.value = gas;
    sombra.material.opacity = THREE.MathUtils.smoothstep(gas, 0.05, 0.45);
    return gas;
}

function animar() {
    requestAnimationFrame(animar);
    if (!listo || mundo.abierto) {
        reloj.getDelta();
        return;
    }
    const real = reloj.getDelta();
    const delta = Math.min(real, 0.1);
    // Cerca del agujero el tiempo pasa más despacio: el gas gira más lento
    // y también cuando el ratón se acerca a la sombra
    moverRatonCerca(delta);
    const t = (comunes.uTiempo.value += delta * (1 - cercania() * 0.45 - ratonCerca.fuerza * 0.3));
    if (real < 0.5) adaptarResolucion(real);
    moverToma(delta);
    colocarCamara(delta, t);
    orientarAgujero();
    moverPuertas(delta, t);
    moverViaje(delta);
    const pulso = (comunes.uPulso.value *= Math.exp(-delta * 1.1));
    comunes.uOnda.value = Math.max(0.6, comunes.uOnda.value - delta * 2.6);
    const encendido = moverEntrada(delta);
    const luzAnillo = THREE.MathUtils.smoothstep(encendido, 0.6, 1);
    const c = cercania();
    anillo.material.uniforms.uColor.value.setRGB(1, 0.88, 0.7).multiplyScalar((2.4 + Math.sin(t * 2.2) * 0.4 + pulso * 3) * luzAnillo * (1 + c * 0.8 + ratonCerca.fuerza * 0.6));
    anillo2.material.uniforms.uColor.value.setRGB(1, 0.8, 0.6).multiplyScalar(0.45 * luzAnillo);
    halos.forEach((h, i) => (h.material.opacity = h.userData.fuerza * encendido * (0.85 + 0.15 * Math.sin(t * (1.1 + i * 0.7)) + pulso * 0.8 + ratonCerca.fuerza * 0.35)));
    brillo.mezclar.uniforms.uFuerza.value = 0.55 * (1 + pulso * 0.6) * (1 - c * 0.3);
    // Al acercarte el disco ocupa más pantalla: se baja la exposición para
    // que no se queme de blanco
    comunes.uExpo.value = 1 - c * 0.38;
    marcarBola();
    moverMarea(delta);
    sonidoCercania();
    destellos.forEach((d) => (d.material.opacity = d.userData.fuerza * fondo.material.uniforms.uAparece.value * (0.8 + 0.2 * Math.sin(t * 1.3 + d.userData.fase))));
    compositor.render();
}

requestAnimationFrame(() => {
    ajustarTamano();
    encuadrar();
    colocarCamara(1, 0);
    orientarAgujero();
    marcarBola();
    moverEntrada(0);
    crearPuertas();
    if (parametros.has("pulso")) despertar();
    renderizador.compile(escena, camara);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
    reloj.getDelta();
    animar();
});
