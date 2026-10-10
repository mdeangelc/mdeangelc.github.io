import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES GENERALES
// Opciones en la dirección:
//   ?momento=noche   -> empezar de noche
//   ?pixel=no        -> sin efecto píxel
//   ?calidad=baja    -> menos hierba
//   ?fps=si          -> contador de fotogramas
//   ?tocar=no        -> la hierba no reacciona al ratón
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = window.innerWidth < 760 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tocarHierba = parametros.get("tocar") !== "no";
const factorCalidad = (parametros.get("calidad") === "baja" ? 0.4 : 1) * (movil ? 0.4 : 1);

const ajustes = {
    hierba: Math.floor(100000 * factorCalidad),
    largoHierba: 58,
    anchoHierba: 22,
    tamanoPixel: movil ? 2.5 : 3,
    largoTrozo: 25,
    trozosDelante: 5,
    alturaOjos: 1.7
};

// Números aleatorios con semilla, para que todo salga igual al recargar
function crearAzar(semilla) {
    return function () {
        semilla = (semilla + 0x6d2b79f5) | 0;
        let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const azar = crearAzar(20261010);
function entre(a, b, aleatorio = azar) {
    return a + aleatorio() * (b - a);
}

// =====================================================================
// 2. EL CAMINO, EL ARROYO Y EL TERRENO
// El camino serpentea hacia el castillo y no se acaba nunca. Cada 150 m
// lo cruza un arroyo con su puente de piedra. Las mismas fórmulas están
// en JavaScript (para colocar objetos) y en GLSL (para los shaders).
// =====================================================================

const ANCHO_CAMINO = 1.35;
const PERIODO_ARROYO = 150;
const LARGO_PUENTE = 7.6;

function caminoX(z) {
    return 2.4 * Math.sin(z * 0.04) + 0.7 * Math.sin(z * 0.11 + 1.0);
}

function suave(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function indiceArroyo(z) {
    return Math.floor((-z + PERIODO_ARROYO / 2) / PERIODO_ARROYO);
}

// Distancia (con signo) desde un punto hasta el arroyo más cercano
function arroyo(x, z) {
    const k = indiceArroyo(z);
    if (k < 1) return 99;
    return z - (-k * PERIODO_ARROYO + 4 * Math.sin(x * 0.12 + k * 1.7));
}

function alturaTerreno(x, z) {
    const lado = Math.abs(x - caminoX(z));
    let h = 2.2 * suave(5, 18, lado) * (0.55 + 0.45 * Math.sin(z * 0.07 + x * 0.1));
    h += 0.2 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.45 + x * 0.2) * suave(2.5, 5, lado);
    h -= 0.38 * (1 - suave(1.3, 3.2, Math.abs(arroyo(x, z))));
    return h;
}

// Dónde cruza el puente el camino (se busca con unas pocas vueltas)
const puentes = new Map();
function centroPuente(k) {
    if (!puentes.has(k)) {
        let z = -k * PERIODO_ARROYO;
        for (let i = 0; i < 5; i++) z = -k * PERIODO_ARROYO + 4 * Math.sin(caminoX(z) * 0.12 + k * 1.7);
        puentes.set(k, z);
    }
    return puentes.get(k);
}

function alturaPuente(z) {
    const k = indiceArroyo(z);
    if (k < 1) return 0;
    const t = (z - centroPuente(k)) / LARGO_PUENTE + 0.5;
    return t > 0 && t < 1 ? 0.5 * Math.sin(Math.PI * t) : 0;
}

// Ángulo para que algo quede atravesado al camino
function anguloCamino(z) {
    return -Math.atan(caminoX(z - 1) - caminoX(z));
}

const terrenoGLSL = `
    float caminoX(float z) {
        return 2.4 * sin(z * 0.04) + 0.7 * sin(z * 0.11 + 1.0);
    }

    float arroyo(float x, float z) {
        float k = floor((-z + 75.0) / 150.0);
        if (k < 1.0) return 99.0;
        return z - (-k * 150.0 + 4.0 * sin(x * 0.12 + k * 1.7));
    }

    float alturaTerreno(float x, float z) {
        float lado = abs(x - caminoX(z));
        float h = 2.2 * smoothstep(5.0, 18.0, lado) * (0.55 + 0.45 * sin(z * 0.07 + x * 0.1));
        h += 0.2 * sin(x * 0.7 + z * 0.3) * sin(z * 0.45 + x * 0.2) * smoothstep(2.5, 5.0, lado);
        h -= 0.38 * (1.0 - smoothstep(1.3, 3.2, abs(arroyo(x, z))));
        return h;
    }

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float tramado(vec2 pixel) {
        vec2 p = mod(floor(pixel), 4.0);
        int i = int(p.x + p.y * 4.0);
        float m[16];
        m[0] = 0.0; m[1] = 8.0; m[2] = 2.0; m[3] = 10.0;
        m[4] = 12.0; m[5] = 4.0; m[6] = 14.0; m[7] = 6.0;
        m[8] = 3.0; m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
        m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
        for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
        return 0.5;
    }

    float ruido(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    // Charco de luz de la farola de cada trozo (una cada 25 m, alternando lado)
    float luzFarolas(vec3 p) {
        float i = floor(-p.z / 25.0);
        float zf = -(i + 0.5) * 25.0;
        float lado = mod(i, 2.0) < 0.5 ? 1.0 : -1.0;
        vec2 centro = vec2(caminoX(zf) + lado * 1.8, zf);
        vec2 d = p.xz - centro;
        return exp(-dot(d, d) * 0.09);
    }
`;

// =====================================================================
// 3. RENDERIZADOR
// Con el efecto píxel se dibuja a un tercio de la resolución y el
// navegador lo amplía sin suavizar (CSS image-rendering: pixelated).
// =====================================================================

let renderizador;
try {
    renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
} catch (error) {
    document.getElementById("cargando").textContent = "Tu navegador no puede mostrar 3D (WebGL).";
    throw error;
}

let modoPixel = parametros.get("pixel") !== "no";
renderizador.autoClear = false;
renderizador.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderizador.domElement);

function aplicarResolucion() {
    renderizador.setPixelRatio(modoPixel ? 1 / ajustes.tamanoPixel : Math.min(window.devicePixelRatio, 1.5));
    renderizador.setSize(window.innerWidth, window.innerHeight);
}
aplicarResolucion();

// =====================================================================
// 4. MOMENTOS DEL DÍA
// =====================================================================

const momentos = {
    atardecer: {
        noche: 0,
        niebla: "#4a4677", tierra: "#22392b", tierraClara: "#3c5a33",
        hierbaBase: "#14281a", hierbaPunta: "#5c8a3c", luz: "#ffc9a0", ambiente: "#6a5f99",
        piedra: "#8e8a8e", juntas: "#2b2436", barro: "#4a3a40", musgo: "#3f5a2e",
        reflejoAlto: "#6c5aa8", reflejoBajo: "#f2a07c"
    },
    noche: {
        noche: 1,
        niebla: "#141834", tierra: "#0d1520", tierraClara: "#18283a",
        hierbaBase: "#081018", hierbaPunta: "#2a4a66", luz: "#8aa0e0", ambiente: "#2e3668",
        piedra: "#46507a", juntas: "#0d0f1e", barro: "#151824", musgo: "#142636",
        reflejoAlto: "#0c1230", reflejoBajo: "#3a4c96"
    }
};

const nombresColor = ["niebla", "tierra", "tierraClara", "hierbaBase", "hierbaPunta", "luz", "ambiente", "piedra", "juntas", "barro", "musgo", "reflejoAlto", "reflejoBajo"];

function prepararMomento(datos) {
    const m = { noche: datos.noche };
    nombresColor.forEach((n) => (m[n] = new THREE.Color(datos[n])));
    return m;
}

Object.keys(momentos).forEach((k) => (momentos[k] = prepararMomento(momentos[k])));
const momentoVacio = { noche: 0, ...Object.fromEntries(nombresColor.map((n) => [n, "#000000"])) };
const actual = prepararMomento(momentoVacio);

function mezclarMomentos(destino, a, b, t) {
    destino.noche = a.noche + (b.noche - a.noche) * t;
    nombresColor.forEach((n) => destino[n].lerpColors(a[n], b[n], t));
}

const comunes = {
    uTiempo: { value: 0 },
    uCamara: { value: new THREE.Vector3() },
    uNiebla: { value: actual.niebla },
    uLuz: { value: actual.luz },
    uAmbiente: { value: actual.ambiente },
    uNoche: { value: 0 },
    uRaton: { value: new THREE.Vector2(999, 999) },
    uFuerzaRaton: { value: 0 },
    uViento: { value: movimientoReducido ? 0.25 : 1 },
    uClaros: { value: Array.from({ length: 16 }, () => new THREE.Vector3(9999, 9999, 0)) }
};

// Claros: alrededor de la carreta, el pozo, etc. la hierba es más baja
// y el suelo está pisado. Se guardan como (x, z, radio).
const clarosGLSL = `
    uniform vec3 uClaros[16];
    float enClaro(vec2 p) {
        float c = 1.0;
        for (int i = 0; i < 16; i++) {
            float r = uClaros[i].z;
            c = min(c, smoothstep(r * 0.5, r, length(p - uClaros[i].xy)));
        }
        return c;
    }
`;

// =====================================================================
// 5. EL FONDO PINTADO POR CAPAS (2.5D)
// Cada capa es una imagen que cubre la pantalla. Se mueven a distinta
// velocidad con el ratón (paralaje) y crecen un poco al caminar, más
// las cercanas que las lejanas. Así hay profundidad sin modelar nada.
// =====================================================================

const ANCHO_MARCO = 1672;
const ALTO_MARCO = 941;
const aspectoMarco = ANCHO_MARCO / ALTO_MARCO;

// x, y: desplazamiento en píxeles del marco original; escala; paralaje; zoom máximo al caminar
const capas = [
    { nombre: "cielo", x: 0, y: -60, escala: 1.12, paralaje: 0.004, zoom: 0.0, esCielo: true },
    { nombre: "montanas", x: 0, y: -70, escala: 1.0, paralaje: 0.008, zoom: 0.03 },
    { nombre: "nubes", x: 0, y: 10, escala: 1.0, paralaje: 0.012, zoom: 0.05, deriva: true },
    { nombre: "castillo", x: 0, y: -112, escala: 0.44, paralaje: 0.016, zoom: 0.1 },
    { nombre: "valle", x: 30, y: -46, escala: 0.55, paralaje: 0.024, zoom: 0.18 }
];

const escenaFondo = new THREE.Scene();
const camaraFondo = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const visible = new THREE.Vector2(1, 1);
const desplazamientoRaton = new THREE.Vector2();

const vertexCapa = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentCapa = `
    uniform sampler2D uTextura;
    uniform vec2 uVisible;
    uniform vec2 uCentro;
    uniform float uEscala;
    uniform vec2 uRatonCapa;
    uniform float uNoche;
    uniform float uTiempo;
    uniform float uAspecto;
    uniform bool uEsCielo;
    uniform bool uDeriva;
    varying vec2 vUv;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
        vec2 marco = (vUv - 0.5) * uVisible + 0.5 + uRatonCapa;
        if (uDeriva) marco.x += sin(uTiempo * 0.05) * 0.006;
        vec2 uvCapa = (marco - uCentro) / uEscala + 0.5;

        if (uEsCielo) uvCapa = clamp(uvCapa, 0.001, 0.999);
        else if (uvCapa.x < 0.0 || uvCapa.x > 1.0 || uvCapa.y < 0.0 || uvCapa.y > 1.0) discard;

        vec4 color = texture2D(uTextura, uvCapa);
        if (color.a < 0.5) discard;

        vec3 c = color.rgb;
        float brillo = max(c.r, c.g);
        float calido = smoothstep(0.06, 0.22, c.r - c.b) * smoothstep(0.45, 0.75, brillo);
        vec3 deNoche = c * vec3(0.2, 0.24, 0.52);

        if (uEsCielo) {
            deNoche = mix(vec3(0.015, 0.02, 0.07), vec3(0.06, 0.07, 0.2), vUv.y * 0.3 + c.b * 0.6) + c * 0.06;
            vec2 celda = floor(vUv * vec2(uAspecto, 1.0) * 180.0);
            float estrella = step(0.994, hash(celda)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + hash(celda + 3.0) * 30.0));
            deNoche += vec3(estrella) * smoothstep(0.35, 0.7, vUv.y);
            vec2 luna = (vUv - vec2(0.2, 0.8)) * vec2(uAspecto, 1.0);
            float disco = 1.0 - smoothstep(0.045, 0.05, length(luna));
            deNoche = mix(deNoche, vec3(0.92, 0.93, 1.0), disco);
            deNoche += vec3(0.25, 0.28, 0.45) * exp(-length(luna) * 9.0) * 0.6;
            calido = 0.0;
        }

        c = mix(c, deNoche, uNoche);
        c += color.rgb * calido * uNoche * 1.15;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
    }
`;

function crearCapas(texturas) {
    capas.forEach((capa, i) => {
        const textura = texturas[capa.nombre];
        textura.colorSpace = THREE.SRGBColorSpace;
        textura.magFilter = THREE.NearestFilter;
        textura.minFilter = THREE.LinearFilter;
        textura.generateMipmaps = false;

        capa.material = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            uniforms: {
                uTextura: { value: textura },
                uVisible: { value: visible },
                uCentro: { value: new THREE.Vector2(0.5 + capa.x / ANCHO_MARCO, 0.5 - capa.y / ALTO_MARCO) },
                uEscala: { value: capa.escala },
                uRatonCapa: { value: new THREE.Vector2() },
                uNoche: comunes.uNoche,
                uTiempo: comunes.uTiempo,
                uAspecto: { value: 1 },
                uEsCielo: { value: !!capa.esCielo },
                uDeriva: { value: !!capa.deriva }
            },
            vertexShader: vertexCapa,
            fragmentShader: fragmentCapa
        });

        const plano = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), capa.material);
        plano.renderOrder = i;
        plano.frustumCulled = false;
        escenaFondo.add(plano);
    });
}

// Bruma: una franja de niebla justo encima del horizonte que funde el
// final del suelo 3D con el valle pintado. Va por escalones, como en
// un dibujo de píxeles, y se mueve muy despacio.
const uHorizonte = { value: 0.4 };

function crearBruma() {
    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
            uHorizonte,
            uNiebla: comunes.uNiebla,
            uTiempo: comunes.uTiempo,
            uAspecto: { value: 1 }
        },
        vertexShader: vertexCapa,
        fragmentShader: `
            uniform float uHorizonte;
            uniform vec3 uNiebla;
            uniform float uTiempo;
            uniform float uAspecto;
            varying vec2 vUv;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            float ruido(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
            }

            void main() {
                float alto = vUv.y - uHorizonte;
                if (alto < -0.06) discard;
                float x = vUv.x * uAspecto;
                float franjas = ruido(vec2(x * 4.0 + uTiempo * 0.012, vUv.y * 34.0)) * 0.7 + ruido(vec2(x * 11.0 - uTiempo * 0.02, vUv.y * 70.0)) * 0.3;
                float a = 1.0 - smoothstep(0.0, 0.1 + franjas * 0.09, alto);
                a = floor(a * 5.0 + 0.5) / 5.0 * 0.85;
                gl_FragColor = vec4(uNiebla, a);
                #include <colorspace_fragment>
            }
        `
    });
    const plano = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    plano.renderOrder = 20;
    plano.frustumCulled = false;
    escenaFondo.add(plano);
    return material;
}
let materialBruma = null;

function actualizarCapas(metros) {
    if (materialBruma) materialBruma.uniforms.uAspecto.value = window.innerWidth / window.innerHeight;
    const progreso = 1 - Math.exp(-metros / 700);
    capas.forEach((capa) => {
        if (!capa.material) return;
        const u = capa.material.uniforms;
        u.uEscala.value = capa.escala * (1 + capa.zoom * progreso);
        u.uRatonCapa.value.set(desplazamientoRaton.x * capa.paralaje, desplazamientoRaton.y * capa.paralaje * 0.5);
        u.uAspecto.value = window.innerWidth / window.innerHeight;
    });
}

// =====================================================================
// 6. ESCENA 3D DEL PRIMER PLANO Y CÁMARA
// La cámara se inclina para que el horizonte del suelo 3D quede justo
// donde empieza el valle pintado. Cuanto más bajo el horizonte, más
// pantalla ocupa el camino.
// =====================================================================

const escena = new THREE.Scene();
escena.fog = new THREE.Fog(actual.niebla, 14, 110);

const camara = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
camara.rotation.order = "YXZ";
let inclinacion = 0;

const HORIZONTE_EN_MARCO = 0.6;

function ajustarEncuadre() {
    const aspecto = window.innerWidth / window.innerHeight;
    if (aspecto > aspectoMarco) visible.set(1, aspectoMarco / aspecto);
    else visible.set(aspecto / aspectoMarco, 1);
    visible.multiplyScalar(0.94);

    camara.aspect = aspecto;
    camara.fov = aspecto < 0.8 ? 64 : 55;
    camara.updateProjectionMatrix();

    const uvHorizonte = 1 - HORIZONTE_EN_MARCO;
    const pantallaY = (uvHorizonte - 0.5) / visible.y + 0.5;
    const ndcY = pantallaY * 2 - 1;
    inclinacion = -Math.atan(ndcY * Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)));
    uHorizonte.value = pantallaY;
}

const luzSol = new THREE.DirectionalLight("#ffc9a0", 1.6);
luzSol.position.set(60, 30, 20);
const luzCielo = new THREE.HemisphereLight("#9a88d8", "#2a3a2a", 2.0);
escena.add(luzSol, luzCielo);

// =====================================================================
// 7. SUELO, CAMINO DE ADOQUINES Y ARROYO
// Un plano grande que acompaña a la cámara. El shader lo pinta todo:
//  - hierba del suelo con manchas
//  - el camino: adoquines (celdas Voronoi) con relieve, piedras hundidas
//    o que faltan, musgo en las juntas, rodadas de carro y desgaste
//  - un bordillo de piedras alargadas a cada lado y tierra pisada
//  - charcos que reflejan el cielo y piedras mojadas alrededor
//  - el agua del arroyo y la luz de las farolas por la noche
// =====================================================================

const uniformesSuelo = {
    ...comunes,
    uTierra: { value: actual.tierra },
    uTierraClara: { value: actual.tierraClara },
    uPiedra: { value: actual.piedra },
    uJuntas: { value: actual.juntas },
    uBarro: { value: actual.barro },
    uMusgo: { value: actual.musgo },
    uReflejoAlto: { value: actual.reflejoAlto },
    uReflejoBajo: { value: actual.reflejoBajo }
};

const fragmentSuelo = `
    uniform float uTiempo;
    uniform float uNoche;
    uniform vec3 uNiebla;
    uniform vec3 uLuz;
    uniform vec3 uAmbiente;
    uniform vec3 uTierra;
    uniform vec3 uTierraClara;
    uniform vec3 uPiedra;
    uniform vec3 uJuntas;
    uniform vec3 uBarro;
    uniform vec3 uMusgo;
    uniform vec3 uReflejoAlto;
    uniform vec3 uReflejoBajo;
    varying vec3 vMundo;
    ${terrenoGLSL}
    ${clarosGLSL}

    // Celdas Voronoi: x = distancia a la junta, y/w = azar de la piedra,
    // z = distancia al centro; haciaCentro sirve para el relieve
    vec4 voronoi(vec2 p, out vec2 haciaCentro) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float d1 = 8.0;
        float d2 = 8.0;
        vec2 celda = vec2(0.0);
        vec2 mejor = vec2(0.0);
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 v = vec2(float(x), float(y));
                vec2 punto = v + vec2(hash(i + v), hash(i + v + 17.0)) * 0.75 + 0.125;
                vec2 r = punto - f;
                float d = length(r);
                if (d < d1) { d2 = d1; d1 = d; celda = i + v; mejor = r; }
                else if (d < d2) { d2 = d; }
            }
        }
        haciaCentro = mejor;
        return vec4(d2 - d1, hash(celda), d1, hash(celda + 5.3));
    }

    void main() {
        float d = length(vMundo - cameraPosition);
        if (smoothstep(85.0, 135.0, d) > tramado(gl_FragCoord.xy)) discard;
        float detalle = 1.0 - smoothstep(16.0, 48.0, d);

        vec2 w = vMundo.xz;
        float u = vMundo.x - caminoX(vMundo.z);
        float lado = abs(u);
        float v = vMundo.z;
        #ifdef PUENTE
        lado = min(lado, ${(ANCHO_CAMINO - 0.12).toFixed(2)});
        #endif

        // Hierba del suelo
        float manchas = ruido(w * 0.35) * 0.6 + ruido(w * 1.7) * 0.4;
        vec3 pasto = mix(uTierra, uTierraClara, manchas);
        float grano = hash(floor(w * 7.0));
        vec3 color = pasto * (1.0 + (grano - 0.5) * 0.3 * detalle);

        // Tierra pisada junto al camino
        float borde = ${ANCHO_CAMINO.toFixed(2)} + (ruido(vec2(v * 0.9, u > 0.0 ? 7.0 : 3.0)) - 0.5) * 0.14;
        float finArcen = borde + 0.5 + ruido(w * 1.3) * 0.45;
        float arcen = 1.0 - smoothstep(borde + 0.1, finArcen, lado);
        vec3 barro = uBarro * (0.85 + grano * 0.3 * detalle);
        float guijarro = step(0.93, hash(floor(w * 9.0))) * detalle;
        barro = mix(barro, uPiedra * 0.8, guijarro);
        color = mix(color, barro, arcen * 0.92);
        #ifndef PUENTE
        float pisado = 1.0 - enClaro(w);
        color = mix(color, mix(barro, pasto, ruido(w * 2.5) * 0.6), pisado * 0.85);
        #endif

        float mojado = 0.0;
        float charco = 0.0;

        if (lado < borde) {
            vec3 empedrado;
            float exterior = (lado - (borde - 0.24)) / 0.24;

            if (exterior > 0.0) {
                // Bordillo: piedras alargadas puestas en fila
                float s = sign(u);
                float bv = v / 0.62 + s * 0.37;
                float fv = fract(bv);
                float h = hash(vec2(floor(bv), s));
                float junta = smoothstep(0.0, 0.07, fv) * (1.0 - smoothstep(0.93, 1.0, fv)) * smoothstep(0.0, 0.12, exterior);
                vec3 bloque = uPiedra * (0.8 + h * 0.3) * (1.0 - exterior * 0.3);
                bloque *= 1.0 + (1.0 - smoothstep(0.1, 0.35, exterior)) * 0.15;
                empedrado = mix(uJuntas, bloque, junta);
            } else {
                // Adoquines
                vec2 haciaCentro;
                vec4 a = voronoi(vec2(u * 2.5, v * 2.1), haciaCentro);
                float anchoJunta = 0.04 + 0.07 * smoothstep(0.4, 1.2, lado);
                float junta = smoothstep(anchoJunta, anchoJunta + 0.06, a.x);

                vec3 piedra = uPiedra * (0.68 + a.y * 0.44);
                piedra = mix(piedra, piedra * vec3(1.1, 0.95, 0.86), step(0.74, a.w));
                piedra = mix(piedra, piedra * vec3(0.88, 0.95, 1.1), step(a.w, 0.16));
                if (a.y < 0.1) piedra *= 0.66;

                float luzLado = dot(normalize(-haciaCentro + 0.0001), vec2(0.8, 0.6));
                float cercaJunta = 1.0 - smoothstep(0.02, 0.18, a.x);
                piedra *= 1.0 + luzLado * cercaJunta * 0.25 * detalle;
                piedra *= 1.0 - a.z * 0.22;

                piedra *= 1.0 + (1.0 - smoothstep(0.0, 0.5, lado)) * 0.1;
                piedra *= 1.0 - (1.0 - smoothstep(0.0, 0.13, abs(lado - 0.62))) * 0.12;

                float musgo = smoothstep(0.45, 0.8, ruido(vec2(u, v) * 1.6) + lado * 0.3);
                vec3 colorJunta = mix(uJuntas, uMusgo * 0.8, musgo);
                empedrado = mix(colorJunta, piedra, junta);

                if (fract(a.w * 31.0) < 0.045 && lado < borde - 0.5) {
                    empedrado = mix(uBarro, uMusgo * 0.75, musgo);
                }
            }

            vec3 lejano = mix(uJuntas, uPiedra * 0.88, 0.72);
            empedrado = mix(lejano, empedrado, detalle);

            // Charcos: solo en algunas zonas del camino
            float zona = smoothstep(0.45, 0.62, ruido(vec2(v * 0.05, 3.0)));
            float forma = ruido(vec2(u * 1.2, v * 0.55) + 21.0) * 0.72 + ruido(w * 3.2) * 0.28;
            float dentro = 1.0 - smoothstep(borde - 0.45, borde - 0.15, lado);
            charco = smoothstep(0.6, 0.62, forma) * zona * dentro;
            mojado = smoothstep(0.5, 0.6, forma) * zona * dentro;

            color = empedrado * (1.0 - mojado * 0.3);
        }

        // La hierba se come el borde del camino a trozos
        #ifndef PUENTE
        float invade = smoothstep(0.58, 0.72, ruido(vec2(v * 1.7, u * 2.4) + 40.0));
        invade *= smoothstep(borde - 0.5, borde + 0.05, lado) * (1.0 - smoothstep(borde + 0.4, borde + 0.8, lado));
        color = mix(color, pasto, invade);
        #endif

        // Hojas secas caídas por aquí y por allá
        float hoja = step(0.988, hash(floor(w * 8.0) + 3.7)) * step(0.45, ruido(w * 0.2)) * detalle;
        color = mix(color, mix(vec3(0.62, 0.26, 0.1), vec3(0.75, 0.48, 0.14), hash(floor(w * 8.0))), hoja * (1.0 - charco));

        // Luz del sol y del cielo
        color *= uAmbiente * 1.4 + uLuz * 0.55;
        #ifdef PUENTE
        vec3 normal = normalize(cross(dFdx(vMundo), dFdy(vMundo)));
        if (abs(normal.y) < 0.6) color *= 0.55;
        #endif

        // Charco: refleja el cielo (cerca, la parte alta; lejos, el horizonte)
        if (charco > 0.0) {
            vec3 cielo = mix(uReflejoAlto, uReflejoBajo, smoothstep(2.0, 30.0, d));
            float brillo = step(0.965, fract(v * 1.4 + ruido(w * 2.0 + uTiempo * 0.3) * 0.6));
            cielo += brillo * uReflejoBajo * 0.5;
            color = mix(color, cielo, charco * 0.92);
        }

        // Arroyo
        #ifndef PUENTE
        float dz = abs(arroyo(vMundo.x, vMundo.z));
        float agua = 1.0 - smoothstep(1.4, 1.6, dz);
        float orilla = (1.0 - smoothstep(1.5, 2.4, dz)) - agua;
        color = mix(color, uBarro * (uAmbiente * 1.2 + uLuz * 0.4) * 0.45, orilla * 0.85);
        if (agua > 0.0) {
            float ondas = ruido(vec2(vMundo.x * 0.7 - uTiempo * 0.9, vMundo.z * 3.0));
            vec3 rio = mix(uReflejoAlto * 0.5, uReflejoAlto * 1.1, ondas);
            float linea = step(0.8, ruido(vec2(vMundo.x * 1.6 - uTiempo * 1.4, vMundo.z * 6.0)));
            rio = mix(rio, uReflejoBajo, linea * 0.65);
            float destello = step(0.95, hash(floor(w * 5.0) + floor(uTiempo * 3.0)));
            rio += destello * uReflejoBajo * 0.5;
            rio *= 1.0 - smoothstep(1.0, 1.5, dz) * 0.35;
            color = mix(color, rio, agua);
        }
        #endif

        // Farolas encendidas por la noche
        color += vec3(1.0, 0.62, 0.3) * luzFarolas(vMundo) * uNoche * (0.34 + charco * 0.5);

        color = mix(color, uNiebla, smoothstep(14.0, 95.0, d) * 0.88);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
    }
`;

const materialSuelo = new THREE.ShaderMaterial({
    uniforms: uniformesSuelo,
    vertexShader: `
        uniform vec3 uCamara;
        varying vec3 vMundo;
        ${terrenoGLSL}
        void main() {
            vec3 p = position;
            p.x += floor(uCamara.x / 0.8) * 0.8;
            p.z += floor(uCamara.z / 0.8) * 0.8;
            p.y = alturaTerreno(p.x, p.z);
            vMundo = p;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: fragmentSuelo
});

// El tablero del puente usa el mismo empedrado, pero sobre su forma real
const materialPuente = new THREE.ShaderMaterial({
    uniforms: uniformesSuelo,
    defines: { PUENTE: "" },
    vertexShader: `
        varying vec3 vMundo;
        void main() {
            vec4 p = modelMatrix * vec4(position, 1.0);
            vMundo = p.xyz;
            gl_Position = projectionMatrix * viewMatrix * p;
        }
    `,
    fragmentShader: fragmentSuelo
});

const geometriaSuelo = new THREE.PlaneGeometry(240, 240, 300, 300);
geometriaSuelo.rotateX(-Math.PI / 2);
geometriaSuelo.translate(0, 0, -100);
const suelo = new THREE.Mesh(geometriaSuelo, materialSuelo);
suelo.frustumCulled = false;
escena.add(suelo);

// =====================================================================
// 8. HIERBA
// Briznas repetidas con "instancing" en una franja alrededor del
// camino. Cuando una brizna se queda atrás, el shader la vuelve a
// colocar delante (operación módulo), así nunca se acaba la hierba.
// Unas pocas crecen en el bordillo y entre los adoquines.
// =====================================================================

function crearHierba() {
    const brizna = new THREE.PlaneGeometry(1, 1, 1, 3);
    brizna.translate(0, 0.5, 0);

    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = brizna.index;
    geometria.setAttribute("position", brizna.attributes.position);

    const n = ajustes.hierba;
    const posiciones = new Float32Array(n * 2);
    const datos = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const tipo = azar();
        const signo = azar() < 0.5 ? -1 : 1;
        let x;
        let alto = entre(0.35, 0.75);
        if (tipo < 0.012) {
            x = entre(-1.1, 1.1);
            alto *= 0.35;
        } else if (tipo < 0.045) {
            x = signo * entre(1.25, 1.6);
            alto *= 0.75;
        } else {
            x = signo * (1.5 + Math.pow(azar(), 1.7) * ajustes.anchoHierba);
        }
        posiciones[i * 2] = x;
        posiciones[i * 2 + 1] = azar() * ajustes.largoHierba;
        datos[i * 4] = azar() * Math.PI * 2;
        datos[i * 4 + 1] = alto;
        datos[i * 4 + 2] = entre(0.06, 0.11);
        datos[i * 4 + 3] = azar();
    }
    geometria.setAttribute("aPosicion", new THREE.InstancedBufferAttribute(posiciones, 2));
    geometria.setAttribute("aDatos", new THREE.InstancedBufferAttribute(datos, 4));
    geometria.instanceCount = n;

    const material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            ...comunes,
            uBase: { value: actual.hierbaBase },
            uPunta: { value: actual.hierbaPunta },
            uLargo: { value: ajustes.largoHierba }
        },
        vertexShader: `
            attribute vec2 aPosicion;
            attribute vec4 aDatos;
            uniform float uTiempo;
            uniform vec3 uCamara;
            uniform vec2 uRaton;
            uniform float uFuerzaRaton;
            uniform float uViento;
            uniform float uLargo;
            ${clarosGLSL}
            varying float vAltura;
            varying float vAzar;
            varying vec3 vMundo;
            ${terrenoGLSL}

            void main() {
                float delante = mod(uCamara.z + 4.0 - aPosicion.y, uLargo);
                float z = uCamara.z + 4.0 - delante;
                float x = caminoX(z) + aPosicion.x;

                float hastaAgua = abs(arroyo(x, z));
                if (hastaAgua < 1.7) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    return;
                }

                vec3 base = vec3(x, alturaTerreno(x, z), z);
                float claro = enClaro(base.xz);

                float y = position.y;
                float alto = aDatos.y * (1.0 + smoothstep(3.0, 10.0, abs(aPosicion.x)) * 0.5);
                alto *= 0.35 + 0.65 * smoothstep(1.7, 4.0, hastaAgua);
                alto *= 0.22 + 0.78 * claro;
                float ancho = aDatos.z * (1.0 - y * 0.85);
                float giro = aDatos.x;
                vec3 local = vec3(position.x * ancho, y * alto, y * y * alto * (0.2 + aDatos.w * 0.3));
                vec3 mundo = base + vec3(local.x * cos(giro) - local.z * sin(giro), local.y, local.x * sin(giro) + local.z * cos(giro));

                float curva = y * y;
                float rafaga = ruido(base.xz * 0.08 - vec2(uTiempo * 0.6, uTiempo * 0.2));
                float viento = (0.15 + rafaga * 0.55) * uViento;
                mundo.x += viento * curva * alto;
                mundo.z -= viento * 0.4 * curva * alto;

                if (uFuerzaRaton > 0.001) {
                    vec2 alejar = base.xz - uRaton;
                    float empuje = (1.0 - smoothstep(0.0, 1.5, length(alejar))) * uFuerzaRaton;
                    mundo.xz += normalize(alejar + 0.0001) * empuje * curva * alto * 1.6;
                    mundo.y -= empuje * curva * alto * 0.6;
                }

                vAltura = y;
                vAzar = aDatos.w;
                vMundo = mundo;
                gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uBase;
            uniform vec3 uPunta;
            uniform vec3 uLuz;
            uniform vec3 uAmbiente;
            uniform vec3 uNiebla;
            uniform float uNoche;
            varying float vAltura;
            varying float vAzar;
            varying vec3 vMundo;
            ${terrenoGLSL}

            void main() {
                float d = length(vMundo - cameraPosition);
                if (smoothstep(32.0, 54.0, d) > tramado(gl_FragCoord.xy)) discard;
                vec3 punta = uPunta * (0.7 + vAzar * 0.55);
                if (vAzar > 0.93) punta *= vec3(1.35, 1.1, 0.6);
                vec3 color = mix(uBase, punta, vAltura);
                color *= uAmbiente * 1.3 + uLuz * (0.3 + 0.5 * vAltura);
                color += vec3(1.0, 0.62, 0.3) * luzFarolas(vMundo) * uNoche * (0.04 + vAltura * 0.16);
                color = mix(color, uNiebla, smoothstep(14.0, 95.0, d) * 0.88);
                gl_FragColor = vec4(color, 1.0);
                #include <colorspace_fragment>
            }
        `
    });

    const malla = new THREE.Mesh(geometria, material);
    malla.frustumCulled = false;
    escena.add(malla);
    return { geometria, material, total: n };
}

const hierba = crearHierba();

// =====================================================================
// 9. PIEZAS PARA CONSTRUIR OBJETOS
// Todo lo que hay en un trozo se junta en una sola malla con colores
// por vértice: así cada trozo es una sola llamada de dibujo.
// =====================================================================

// Lo que está lejos se desvanece con un tramado de píxeles (dithering)
// para fundirse con el fondo pintado, en vez de cortarse de golpe.
function desvanecerLejos(material, cerca, lejos) {
    material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <clipping_planes_fragment>",
            `#include <clipping_planes_fragment>
            vec2 pt = mod(floor(gl_FragCoord.xy), 4.0);
            float umbral = fract((pt.x * 4.0 + pt.y * 11.0) * 0.4375 + pt.y * 0.53);
            if (smoothstep(${cerca.toFixed(1)}, ${lejos.toFixed(1)}, length(vViewPosition)) > umbral) discard;`
        );
    };
    return material;
}

const materialMundo = desvanecerLejos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, emissive: "#141c26" }), 34, 56);
const materialFarol = new THREE.MeshBasicMaterial({ color: "#2a2230" });
const materialFlores = new THREE.PointsMaterial({ size: 0.13, vertexColors: true });

const colores = {
    pino: ["#2f5a44", "#28503f", "#36604a", "#2a4a40"],
    hoja: ["#3a6a3a", "#4a7a3a", "#33603e"],
    otono: ["#9a4a2a", "#c07a30", "#a83a3a"],
    arbusto: "#2f5236",
    tronco: "#2b2019",
    madera: "#5a4030",
    maderaClara: "#8a6a48",
    maderaOscura: "#3a2a22",
    piedra: "#8a8098",
    piedraOscura: "#5a5470",
    tejado: "#7a3434",
    hierro: "#2a2a33",
    musgo: "#3f6a34",
    heno: "#b08a4a",
    tela: "#a8303e",
    oro: "#d8a040",
    agua: "#1a2238"
};
const coloresFlor = ["#8c9cff", "#d8d4ff", "#ff9ccf", "#ffe28a", "#ffffff"].map((c) => new THREE.Color(c));

function texturaBrillo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 32;
    lienzo.height = 32;
    const ctx = lienzo.getContext("2d");
    const degradado = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    degradado.addColorStop(0, "rgba(255, 214, 140, 0.95)");
    degradado.addColorStop(0.14, "rgba(255, 176, 90, 0.45)");
    degradado.addColorStop(0.45, "rgba(255, 150, 60, 0.1)");
    degradado.addColorStop(1, "rgba(255, 140, 50, 0)");
    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(lienzo);
}
const materialHalo = new THREE.SpriteMaterial({ map: texturaBrillo(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

// Formas básicas ya giradas y colocadas (en coordenadas del objeto)
function caja(an, al, fo, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(an, al, fo);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    return g.translate(x, y, z);
}

function cilindro(rArriba, rAbajo, al, lados, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(rArriba, rAbajo, al, lados);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    return g.translate(x, y, z);
}

function cono(radio, al, lados, x, y, z, ry = 0) {
    const g = new THREE.ConeGeometry(radio, al, lados);
    if (ry) g.rotateY(ry);
    return g.translate(x, y, z);
}

function bola(radio, x, y, z, aplastar = 1) {
    const g = new THREE.IcosahedronGeometry(radio, 0);
    g.scale(1, aplastar, 1);
    return g.translate(x, y, z);
}

// Una "obra" va juntando piezas pintadas; al final se fusionan
function crearObra(aleatorio) {
    const piezas = [];
    const empedrado = [];
    const luces = [];
    const halos = [];
    const claros = [];
    const flores = { puntos: [], colores: [] };
    const matriz = new THREE.Matrix4();
    const giro = new THREE.Matrix4();

    function pintar(geometria, color, variacion) {
        const g = geometria.index ? geometria.toNonIndexed() : geometria;
        g.deleteAttribute("uv");
        g.deleteAttribute("normal");
        const n = g.attributes.position.count;
        const lista = new Float32Array(n * 3);
        const c = new THREE.Color(color).multiplyScalar(1 - variacion + aleatorio() * variacion * 2);
        for (let i = 0; i < n; i++) c.toArray(lista, i * 3);
        g.setAttribute("color", new THREE.BufferAttribute(lista, 3));
        return g;
    }

    return {
        piezas,
        empedrado,
        luces,
        halos,
        claros,
        flores,
        aleatorio,
        // Coloca el sistema de coordenadas del siguiente objeto
        en(x, y, z, angulo = 0) {
            matriz.makeTranslation(x, y, z).multiply(giro.makeRotationY(angulo));
            return this;
        },
        poner(geometria, color, variacion = 0.1) {
            const g = pintar(geometria, color, variacion);
            g.applyMatrix4(matriz);
            piezas.push(g);
            return g;
        },
        losa(geometria) {
            const g = geometria.toNonIndexed();
            g.deleteAttribute("uv");
            g.deleteAttribute("normal");
            g.applyMatrix4(matriz);
            empedrado.push(g);
        },
        luz(geometria, halo = 0) {
            const g = geometria.index ? geometria.toNonIndexed() : geometria;
            g.deleteAttribute("uv");
            g.applyMatrix4(matriz);
            luces.push(g);
            if (halo) {
                g.computeBoundingBox();
                const centro = new THREE.Vector3();
                g.boundingBox.getCenter(centro);
                halos.push({ posicion: centro, tam: halo });
            }
        },
        claro(x, z, radio) {
            claros.push(new THREE.Vector3(x, z, radio));
        },
        flor(x, y, z, color) {
            flores.puntos.push(x, y, z);
            flores.colores.push(color.r, color.g, color.b);
        },
        elegir(lista) {
            return lista[Math.floor(aleatorio() * lista.length)];
        }
    };
}

// =====================================================================
// 10. ÁRBOLES, ROCAS Y PLANTAS
// =====================================================================

function pino(o, x, z, alto) {
    const a = o.aleatorio;
    const y = alturaTerreno(x, z) - 0.2;
    const color = o.elegir(colores.pino);
    o.en(x, y, z);
    const pisos = 4 + Math.floor(a() * 3);
    for (let p = 0; p < pisos; p++) {
        const t = p / pisos;
        const radio = alto * 0.26 * (1 - t * 0.75);
        o.poner(cono(radio, alto * 0.3, 7, 0, alto * (0.18 + t * 0.7), 0, a() * Math.PI), color, 0.15);
    }
    o.poner(cilindro(alto * 0.03, alto * 0.04, alto * 0.25, 5, 0, alto * 0.12, 0), colores.tronco, 0.1);
}

function frondoso(o, x, z, alto) {
    const a = o.aleatorio;
    const y = alturaTerreno(x, z) - 0.1;
    const color = a() < 0.3 ? o.elegir(colores.otono) : o.elegir(colores.hoja);
    o.en(x, y, z, a() * 6);
    o.poner(cilindro(alto * 0.05, alto * 0.08, alto * 0.55, 6, 0, alto * 0.27, 0), colores.tronco, 0.1);
    o.poner(cilindro(alto * 0.025, alto * 0.035, alto * 0.3, 5, alto * 0.1, alto * 0.5, 0, 0, 0, -0.7), colores.tronco, 0.1);
    const copas = 4 + Math.floor(a() * 3);
    for (let i = 0; i < copas; i++) {
        const ang = (i / copas) * Math.PI * 2 + a();
        const r = alto * entre(0.1, 0.22, a);
        o.poner(bola(alto * entre(0.2, 0.3, a), Math.cos(ang) * r, alto * entre(0.62, 0.85, a), Math.sin(ang) * r, 0.85), color, 0.18);
    }
    o.poner(bola(alto * 0.26, 0, alto * 0.95, 0, 0.8), color, 0.15);
}

function arbusto(o, x, z, tam, conFlores) {
    const a = o.aleatorio;
    const y = alturaTerreno(x, z);
    o.en(x, y, z);
    const color = conFlores ? o.elegir(coloresFlor) : null;
    for (let i = 0; i < 3; i++) {
        const dx = entre(-0.5, 0.5, a) * tam;
        const dz = entre(-0.5, 0.5, a) * tam;
        const r = tam * entre(0.45, 0.7, a);
        o.poner(bola(r, dx, r * 0.55, dz, 0.75), colores.arbusto, 0.2);
        if (color) {
            for (let f = 0; f < 7; f++) {
                const ang = a() * Math.PI * 2;
                const rr = r * Math.sqrt(a()) * 0.9;
                o.flor(x + dx + Math.cos(ang) * rr, y + r * (0.55 + 0.75 * 0.75) - rr * 0.3, z + dz + Math.sin(ang) * rr, color);
            }
        }
    }
}

function roca(o, x, z, tam) {
    const a = o.aleatorio;
    const y = alturaTerreno(x, z);
    o.en(x, y + tam * 0.15, z, a() * 6);
    const g = new THREE.DodecahedronGeometry(tam, 0);
    g.scale(1.3, 0.7, 1.1);
    const pieza = o.poner(g, o.elegir([colores.piedra, colores.piedraOscura]), 0.15);
    if (a() < 0.5) {
        const pos = pieza.attributes.position;
        const col = pieza.attributes.color;
        const musgo = new THREE.Color(colores.musgo);
        for (let i = 0; i < pos.count; i++) {
            if (pos.getY(i) > y + tam * 0.4) col.setXYZ(i, musgo.r, musgo.g, musgo.b);
        }
    }
}

function juncos(o, x, z) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z), z);
    for (let i = 0; i < 6; i++) {
        const dx = entre(-0.35, 0.35, a);
        const dz = entre(-0.35, 0.35, a);
        const alto = entre(0.7, 1.3, a);
        o.poner(cono(0.035, alto, 3, dx, alto / 2, dz).rotateZ(entre(-0.15, 0.15, a)), "#3a5a2a", 0.2);
        if (a() < 0.5) o.poner(cilindro(0.04, 0.04, 0.16, 4, dx, alto * 0.85, dz), "#5a3a24", 0.1);
    }
}

function rodalFlores(o, xc, zc, color) {
    const a = o.aleatorio;
    for (let f = 0; f < 16; f++) {
        const x = xc + entre(-1.3, 1.3, a);
        const z = zc + entre(-1.3, 1.3, a);
        if (Math.abs(x - caminoX(z)) < ANCHO_CAMINO + 0.3 || Math.abs(arroyo(x, z)) < 1.9) continue;
        o.flor(x, alturaTerreno(x, z) + entre(0.25, 0.55, a), z, color);
    }
}

// =====================================================================
// 11. COSAS DEL CAMINO
// Cada trozo tiene un "suceso" distinto (carreta, pozo, arco...). El
// orden sale de barajar la lista con una semilla, así no se repiten
// seguidos y el paseo siempre es el mismo.
// =====================================================================

function valla(o, desde, hasta, lado) {
    const a = o.aleatorio;
    let anterior = null;
    for (let z = desde; z > hasta; z -= 2.2) {
        if (Math.abs(arroyo(caminoX(z), z)) < 4.5) {
            anterior = null;
            continue;
        }
        const x = caminoX(z) + lado * 2.0;
        const y = alturaTerreno(x, z);
        const roto = a() < 0.12;
        if (o.claros.some((c) => Math.hypot(x - c.x, z - c.y) < c.z * 0.8 + 0.6)) {
            anterior = null;
            continue;
        }
        o.en(x, y, z);
        o.poner(caja(0.12, roto ? 0.6 : 0.95, 0.12, 0, roto ? 0.3 : 0.45, 0, entre(-0.08, 0.08, a), 0, entre(-0.1, 0.1, a)), colores.madera, 0.15);
        if (anterior && !roto && a() > 0.1) {
            const largo = Math.hypot(x - anterior.x, z - anterior.z);
            const angulo = Math.atan2(x - anterior.x, z - anterior.z);
            o.en((x + anterior.x) / 2, (y + anterior.y) / 2, (z + anterior.z) / 2, angulo);
            o.poner(caja(0.06, 0.08, largo, 0, 0.7, 0), colores.madera, 0.15);
            if (a() > 0.15) o.poner(caja(0.06, 0.08, largo, 0, 0.35, 0, a() < 0.15 ? 0.2 : 0), colores.madera, 0.15);
        }
        anterior = roto ? null : { x, y, z };
    }
}

function farola(o, z, lado) {
    const x = caminoX(z) + lado * 2.25;
    const y = alturaTerreno(x, z);
    o.en(x, y, z);
    o.poner(caja(0.14, 0.3, 0.14, 0, 0.15, 0), colores.piedraOscura, 0.1);
    o.poner(caja(0.1, 2.5, 0.1, 0, 1.4, 0), colores.maderaOscura, 0.1);
    o.poner(caja(0.6, 0.07, 0.07, -lado * 0.27, 2.6, 0), colores.maderaOscura, 0.1);
    o.poner(caja(0.03, 0.18, 0.03, -lado * 0.45, 2.48, 0), colores.hierro, 0);
    o.poner(cono(0.22, 0.14, 4, -lado * 0.45, 2.42, 0, Math.PI / 4), colores.hierro, 0);
    o.poner(caja(0.3, 0.05, 0.3, -lado * 0.45, 2.04, 0), colores.hierro, 0);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => o.poner(caja(0.035, 0.32, 0.035, -lado * 0.45 + sx * 0.12, 2.2, sz * 0.12), colores.hierro, 0)));
    o.luz(caja(0.22, 0.28, 0.22, -lado * 0.45, 2.2, 0), 2.4);
}

function carreta(o, x, z, angulo) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z), z, angulo);
    o.poner(caja(1.0, 0.1, 1.7, 0, 0.62, 0), colores.madera, 0.1);
    [-1, 1].forEach((s) => o.poner(caja(0.07, 0.3, 1.7, s * 0.5, 0.8, 0), colores.maderaOscura, 0.1));
    o.poner(caja(1.0, 0.3, 0.07, 0, 0.8, 0.83), colores.maderaOscura, 0.1);
    const rota = a() < 0.4;
    [-1, 1].forEach((s) => {
        if (rota && s === 1) o.poner(cilindro(0.42, 0.42, 0.08, 10, 0.9, 0.05, 0.9, 0, 0, 0), colores.maderaOscura, 0.05);
        else o.poner(cilindro(0.42, 0.42, 0.08, 10, s * 0.58, 0.42, 0.25, 0, 0, Math.PI / 2), colores.maderaOscura, 0.05);
    });
    o.poner(cilindro(0.04, 0.04, 1.2, 5, 0, 0.42, 0.25, 0, 0, Math.PI / 2), colores.hierro, 0);
    [-1, 1].forEach((s) => o.poner(caja(0.06, 0.06, 1.6, s * 0.3, 0.36, -1.45, -0.36), colores.madera, 0.1));
    o.poner(caja(0.8, 0.28, 1.0, 0, 0.84, 0.1), colores.heno, 0.1);
    o.poner(bola(0.25, 0.2, 1.05, -0.4, 0.8), "#8a7a5a", 0.1);
}

function pozo(o, x, z) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z), z, a() * 6);
    for (let fila = 0; fila < 2; fila++) {
        for (let i = 0; i < 10; i++) {
            const t = ((i + fila * 0.5) / 10) * Math.PI * 2;
            o.poner(caja(0.46, 0.3, 0.26, Math.cos(t) * 0.72, 0.15 + fila * 0.3, Math.sin(t) * 0.72, 0, -t + Math.PI / 2), colores.piedra, 0.18);
        }
    }
    o.poner(cilindro(0.62, 0.62, 0.05, 10, 0, 0.5, 0), colores.agua, 0);
    [-1, 1].forEach((s) => o.poner(caja(0.12, 1.75, 0.12, s * 0.82, 0.87, 0), colores.madera, 0.1));
    o.poner(cilindro(0.05, 0.05, 1.8, 5, 0, 1.45, 0, 0, 0, Math.PI / 2), colores.madera, 0.1);
    o.poner(cono(1.3, 0.75, 4, 0, 2.05, 0, Math.PI / 4), colores.tejado, 0.1);
    o.poner(caja(0.02, 0.55, 0.02, 0.2, 1.15, 0), colores.hierro, 0);
    o.poner(cilindro(0.13, 0.1, 0.22, 6, 0.2, 0.8, 0), colores.maderaOscura, 0.1);
}

function lenas(o, x, z, angulo) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z), z, angulo);
    for (let fila = 0; fila < 3; fila++) {
        const n = 4 - fila;
        for (let j = 0; j < n; j++) {
            o.poner(cilindro(0.13, 0.13, 1.3, 6, (j - (n - 1) / 2) * 0.27, 0.13 + fila * 0.23, entre(-0.08, 0.08, a), Math.PI / 2), colores.madera, 0.2);
        }
    }
    o.poner(cilindro(0.3, 0.34, 0.45, 7, 1.3, 0.22, 0.3), colores.maderaClara, 0.1);
    o.poner(caja(0.04, 0.55, 0.04, 1.3, 0.62, 0.3, 0, 0, 0.35), colores.maderaClara, 0.05);
    o.poner(caja(0.2, 0.12, 0.03, 1.39, 0.84, 0.3, 0, 0, 0.35), colores.hierro, 0);
}

function arbolCaido(o, x, z, angulo) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z), z, angulo);
    o.poner(cilindro(0.28, 0.36, 6, 7, 0, 0.32, 0, 0, 0, Math.PI / 2), colores.maderaOscura, 0.08);
    o.poner(cilindro(0.95, 0.95, 0.3, 7, 3.1, 0.65, 0, 0, 0, Math.PI / 2), colores.tronco, 0.05);
    for (let i = 0; i < 4; i++) {
        o.poner(caja(0.08, 0.7, 0.08, entre(-2.3, 2, a), 0.75, entre(-0.15, 0.15, a), entre(-0.5, 0.5, a), 0, entre(-0.6, 0.6, a)), colores.maderaOscura, 0.1);
    }
    o.poner(caja(2.6, 0.08, 0.45, entre(-1, 0.5, a), 0.64, 0), colores.musgo, 0.15);
    o.poner(bola(0.3, -2.7, 0.2, 0.5, 0.6), colores.musgo, 0.1);
}

function hito(o, x, z, lado) {
    o.en(x, alturaTerreno(x, z), z);
    o.poner(cilindro(0.18, 0.25, 0.8, 4, 0, 0.4, 0, 0, Math.PI / 4), colores.piedra, 0.08);
    o.poner(bola(0.18, 0, 0.82, 0, 0.6), colores.piedra, 0.08);
    o.poner(caja(0.1, 2.1, 0.1, lado * 0.55, 1.05, 0.2), colores.madera, 0.1);
    o.poner(caja(0.9, 0.2, 0.05, lado * 0.55 - lado * 0.35, 1.85, 0.2, 0, -0.9 * lado), colores.maderaClara, 0.05);
    o.poner(caja(0.75, 0.18, 0.05, lado * 0.55 + lado * 0.3, 1.55, 0.2, 0, 0.5), colores.maderaClara, 0.05);
    o.poner(caja(0.6, 0.16, 0.05, lado * 0.55, 1.28, 0.25, 0, 1.4), colores.maderaClara, 0.05);
}

function banco(o, x, z, lado) {
    o.en(x, alturaTerreno(x, z), z, -lado * Math.PI / 2);
    o.poner(caja(1.4, 0.07, 0.42, 0, 0.45, 0), colores.madera, 0.08);
    [-0.6, 0.6].forEach((dx) => {
        o.poner(caja(0.08, 0.45, 0.08, dx, 0.22, 0.15), colores.maderaOscura, 0.05);
        o.poner(caja(0.08, 0.85, 0.08, dx, 0.42, -0.18), colores.maderaOscura, 0.05);
    });
    o.poner(caja(1.4, 0.22, 0.05, 0, 0.75, -0.2, -0.12), colores.madera, 0.08);
}

function hornacina(o, x, z, lado) {
    o.en(x, alturaTerreno(x, z), z, -lado * Math.PI / 2);
    o.poner(caja(0.55, 0.25, 0.55, 0, 0.12, 0), colores.piedraOscura, 0.08);
    o.poner(caja(0.38, 1.25, 0.38, 0, 0.85, 0), colores.piedra, 0.08);
    o.poner(caja(0.66, 0.6, 0.5, 0, 1.75, 0), colores.piedra, 0.08);
    o.poner(caja(0.38, 0.38, 0.05, 0, 1.72, 0.24), "#141018", 0);
    o.poner(cono(0.6, 0.42, 4, 0, 2.25, 0, Math.PI / 4), colores.tejado, 0.08);
    o.poner(caja(0.05, 0.3, 0.05, 0, 2.6, 0), colores.hierro, 0);
    o.poner(caja(0.2, 0.05, 0.05, 0, 2.66, 0), colores.hierro, 0);
    o.luz(caja(0.06, 0.12, 0.06, 0, 1.6, 0.18), 0.9);
    const flor = o.elegir(coloresFlor);
    const m = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
        m.set(entre(-0.45, 0.45, o.aleatorio), 0.3, entre(0.3, 0.6, o.aleatorio)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -lado * Math.PI / 2);
        o.flor(x + m.x, alturaTerreno(x, z) + 0.3, z + m.z, flor);
    }
}

function ruina(o, x, z, angulo) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z) - 0.1, z, angulo);
    const columnas = 13;
    let alto = 5 + Math.floor(a() * 3);
    for (let c = 0; c < columnas; c++) {
        alto = Math.max(1, Math.min(9, alto + Math.floor(a() * 3) - 1 - (c > 9 ? 1 : 0)));
        for (let f = 0; f < alto; f++) {
            const desplazado = f % 2 ? 0.25 : 0;
            const ultima = f === alto - 1;
            o.poner(caja(0.48, 0.28, 0.42, (c - columnas / 2) * 0.5 + desplazado, 0.14 + f * 0.29, entre(-0.03, 0.03, a)), ultima && a() < 0.4 ? colores.musgo : colores.piedra, 0.2);
        }
    }
    for (let i = 0; i < 4; i++) {
        o.poner(caja(0.48, 0.28, 0.42, entre(-2, 2, a), 0.14, entre(0.5, 1.4, a), 0, a() * 3, entre(-0.2, 0.2, a)), colores.piedra, 0.2);
    }
    o.poner(caja(0.38, 1.6, 0.38, (columnas / 2) * 0.5 + 0.2, 0.8, 0), colores.piedra, 0.1);
}

function estandartes(o, z) {
    const angulo = anguloCamino(z);
    const color = o.aleatorio() < 0.5 ? colores.tela : "#3a4aa8";
    [-1, 1].forEach((lado) => {
        const x = caminoX(z) + lado * 2.4;
        o.en(x, alturaTerreno(x, z), z, angulo);
        o.poner(caja(0.25, 0.3, 0.25, 0, 0.15, 0), colores.piedraOscura, 0.08);
        o.poner(cilindro(0.05, 0.06, 3.6, 5, 0, 1.8, 0), colores.maderaOscura, 0.05);
        o.poner(caja(0.9, 0.06, 0.06, -lado * 0.35, 3.3, 0), colores.maderaOscura, 0.05);
        o.poner(caja(0.6, 1.35, 0.03, -lado * 0.4, 2.6, 0), color, 0.05);
        o.poner(caja(0.6, 0.1, 0.035, -lado * 0.4, 3.1, 0), colores.oro, 0.05);
        o.poner(caja(0.6, 0.1, 0.035, -lado * 0.4, 2.0, 0), colores.oro, 0.05);
        o.poner(cono(0.12, 0.3, 4, 0, 0, 0, Math.PI / 4).rotateX(Math.PI).translate(-lado * 0.4, 1.8, 0), colores.oro, 0);
        o.poner(cono(0.08, 0.25, 4, 0, 3.72, 0), colores.oro, 0);
    });
}

function arco(o, z) {
    const a = o.aleatorio;
    const x = caminoX(z);
    o.en(x, 0, z, anguloCamino(z));
    const radio = 2.15;
    const alturaPilar = 3.0;
    [-1, 1].forEach((s) => {
        for (let f = 0; f * 0.42 < alturaPilar; f++) {
            o.poner(caja(f % 2 ? 0.62 : 0.7, 0.4, 0.7, s * (radio + 0.05), 0.2 + f * 0.42, 0), colores.piedra, 0.15);
        }
    });
    const piezas = 13;
    for (let i = 0; i < piezas; i++) {
        const t = ((i + 0.5) / piezas) * Math.PI;
        const clave = i === Math.floor(piezas / 2);
        o.poner(caja(clave ? 0.5 : 0.44, clave ? 0.85 : 0.65, 0.72, Math.cos(t) * (radio + 0.05), alturaPilar + Math.sin(t) * (radio + 0.05), 0, 0, 0, t - Math.PI / 2), colores.piedra, 0.15);
    }
    for (let i = 0; i < 6; i++) {
        const t = entre(0.1, 0.9, a) * Math.PI;
        o.poner(bola(entre(0.2, 0.35, a), Math.cos(t) * (radio + 0.3), alturaPilar + Math.sin(t) * (radio + 0.3), 0.35, 0.7), colores.musgo, 0.2);
    }
    o.poner(caja(0.02, 0.6, 0.02, 0, alturaPilar + radio - 0.5, 0), colores.hierro, 0);
    o.luz(caja(0.24, 0.3, 0.24, 0, alturaPilar + radio - 0.95, 0), 2.4);
}

function puente(o, k) {
    const zp = centroPuente(k);
    const x = caminoX(zp);
    o.en(x, 0, zp, anguloCamino(zp));
    const tramos = 12;
    const ancho = 3.3;
    const largoTramo = LARGO_PUENTE / tramos + 0.03;
    const radio = 1.7;
    for (let i = 0; i < tramos; i++) {
        const t = (i + 0.5) / tramos;
        const zl = (t - 0.5) * LARGO_PUENTE;
        const h = 0.5 * Math.sin(Math.PI * t);
        const pendiente = (0.5 * Math.PI * Math.cos(Math.PI * t)) / LARGO_PUENTE;
        const inclinar = -Math.atan(pendiente);
        o.losa(caja(ancho, 0.2, largoTramo, 0, h - 0.06, zl, inclinar));
        [-1, 1].forEach((s) => o.poner(caja(0.3, 0.42, largoTramo, s * (ancho / 2 - 0.15), h + 0.25, zl, inclinar), colores.piedraOscura, 0.12));
        const fondo = Math.abs(zl) < radio ? -1.0 + Math.sqrt(radio * radio - zl * zl) * 0.75 : -1.0;
        const techo = h - 0.15;
        if (techo > fondo) o.poner(caja(ancho - 0.12, techo - fondo, largoTramo, 0, (techo + fondo) / 2, zl), colores.piedraOscura, 0.1);
    }
    [-1, 1].forEach((s) => {
        [-1, 1].forEach((e) => {
            o.poner(caja(0.4, 0.75, 0.4, s * (ancho / 2 - 0.15), 0.3, e * (LARGO_PUENTE / 2 - 0.1)), colores.piedra, 0.08);
        });
    });
}

const SUCESOS = ["carreta", "pozo", "lenas", "arbolCaido", "hornacina", "banco", "ruina", "estandartes", "arco", "hito"];
const PEQUENOS = ["lenas", "banco", "hito", "flores"];

function barajar(lista, aleatorio) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(aleatorio() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function sucesoDeTrozo(indice) {
    if (indice === 0) return "hito";
    if (indice < 0) return null;
    const bloque = Math.floor(indice / SUCESOS.length);
    return barajar(SUCESOS, crearAzar(bloque * 104729 + 7))[indice % SUCESOS.length];
}

function lejosDelAgua(z, margen = 5) {
    return Math.abs(arroyo(caminoX(z), z)) > margen;
}

function ponerSuceso(o, tipo, z, lado) {
    const a = o.aleatorio;
    const base = caminoX(z);
    const lugar = (desde, hasta, radio) => {
        const x = base + lado * entre(desde, hasta, a);
        o.claro(x, z, radio);
        return x;
    };
    if (tipo === "carreta") carreta(o, lugar(3.0, 3.6, 2.6), z, entre(-0.6, 0.6, a) + (lado > 0 ? 0 : Math.PI));
    if (tipo === "pozo") pozo(o, lugar(4, 5, 2.8), z);
    if (tipo === "lenas") lenas(o, lugar(2.9, 3.5, 2.4), z, entre(-0.3, 0.3, a));
    if (tipo === "arbolCaido") arbolCaido(o, lugar(4.5, 6, 3.6), z, entre(-0.5, 0.5, a));
    if (tipo === "hito") hito(o, lugar(2.7, 2.7, 1.4), z, lado);
    if (tipo === "banco") banco(o, lugar(2.7, 2.7, 1.8), z, lado);
    if (tipo === "hornacina") hornacina(o, lugar(2.8, 2.8, 1.6), z, lado);
    if (tipo === "ruina") ruina(o, lugar(5, 6.5, 4.2), z, Math.PI / 2 - lado * entre(0.6, 0.9, a));
    if (tipo === "estandartes") estandartes(o, z);
    if (tipo === "arco") arco(o, z);
    if (tipo === "flores") {
        for (let i = 0; i < 3; i++) arbusto(o, base + lado * entre(2.6, 4, a), z + entre(-2, 2, a), entre(0.6, 0.9, a), true);
    }
}

// =====================================================================
// 12. TROZOS DEL MUNDO
// El mundo se divide en trozos de 25 m. Cada trozo se genera siempre
// igual (su propia semilla). Se crean los de delante (como mucho uno
// por fotograma, para que no haya tirones) y se borran los de detrás.
// =====================================================================

function crearTrozo(indice) {
    const o = crearObra(crearAzar(indice * 7919 + 13));
    const a = o.aleatorio;
    const grupo = new THREE.Group();
    const largo = ajustes.largoTrozo;
    const zInicio = -indice * largo;
    const zFarola = zInicio - largo * 0.5;
    const ladoFarola = indice % 2 === 0 ? 1 : -1;

    // El suceso del trozo y, a veces, algo pequeño más
    const huecos = [zInicio - entre(3, 8, a), zInicio - entre(17, 22, a)].filter((z) => lejosDelAgua(z));
    const tipo = sucesoDeTrozo(indice);
    if (tipo && huecos.length) {
        const lado = tipo === "hito" && indice === 0 ? 1 : a() < 0.5 ? -1 : 1;
        ponerSuceso(o, tipo, indice === 0 ? -9 : huecos[0], lado);
        if (huecos.length > 1 && a() < 0.5) ponerSuceso(o, o.elegir(PEQUENOS), huecos[1], -lado);
    }

    // Sitio libre: ni en el agua ni encima de un claro
    const libre = (x, z, margenAgua, margenClaro) =>
        Math.abs(arroyo(x, z)) > margenAgua && o.claros.every((c) => Math.hypot(x - c.x, z - c.y) > c.z + margenClaro);

    // Pinos y árboles de hoja, lejos del camino
    const cuantosPinos = movil ? 6 : 9;
    for (let i = 0; i < cuantosPinos; i++) {
        const z = zInicio - a() * largo;
        const x = caminoX(z) + (a() < 0.5 ? -1 : 1) * (6.5 + Math.pow(a(), 1.1) * 20);
        if (libre(x, z, 3.2, 3)) pino(o, x, z, entre(6, 13, a));
    }
    const cuantosFrondosos = movil ? 2 : 3;
    for (let i = 0; i < cuantosFrondosos; i++) {
        const z = zInicio - a() * largo;
        const x = caminoX(z) + (a() < 0.5 ? -1 : 1) * entre(6, 16, a);
        if (libre(x, z, 3.2, 2.5)) frondoso(o, x, z, entre(4, 7, a));
    }

    // Arbustos, rocas y flores cerca del camino
    for (let i = 0; i < 5; i++) {
        const z = zInicio - a() * largo;
        const x = caminoX(z) + (a() < 0.5 ? -1 : 1) * entre(3, 9, a);
        if (libre(x, z, 2.6, 0.6)) arbusto(o, x, z, entre(0.5, 1.1, a), a() < 0.4);
    }
    for (let i = 0; i < 6; i++) {
        const z = zInicio - a() * largo;
        const x = caminoX(z) + (a() < 0.5 ? -1 : 1) * entre(2.2, 8, a);
        const tam = entre(0.15, 0.55, a);
        if (libre(x, z, 0, 0.2)) roca(o, x, z, tam);
    }
    for (let i = 0; i < 5; i++) {
        const z = zInicio - a() * largo;
        rodalFlores(o, caminoX(z) + (a() < 0.5 ? -1 : 1) * entre(2, 6, a), z, o.elegir(coloresFlor));
    }

    // Valla en algunos tramos
    if (a() < 0.5) {
        const desde = zInicio - a() * 6;
        const hasta = desde - entre(8, 18, a);
        const lados = a() < 0.5 ? [-1, 1] : [a() < 0.5 ? -1 : 1];
        lados.forEach((lado) => valla(o, desde, hasta, lado));
    }

    // Farola
    farola(o, zFarola, ladoFarola);

    // Puente si el arroyo cruza este trozo
    [indiceArroyo(zInicio), indiceArroyo(zInicio - largo)].forEach((k) => {
        if (k >= 1 && Math.floor(-centroPuente(k) / largo) === indice && !o.conPuente) {
            o.conPuente = true;
            puente(o, k);
            for (let i = 0; i < 6; i++) {
                const zr = centroPuente(k) + entre(-1.5, 1.5, a);
                roca(o, caminoX(zr) + (a() < 0.5 ? -1 : 1) * entre(2.5, 6, a), zr, entre(0.2, 0.45, a));
            }
            for (let i = 0; i < 14; i++) {
                const x = caminoX(centroPuente(k)) + (a() < 0.5 ? -1 : 1) * entre(2.4, 12, a);
                const zr = -k * PERIODO_ARROYO + 4 * Math.sin(x * 0.12 + k * 1.7) + (a() < 0.5 ? -1 : 1) * entre(1.5, 2.2, a);
                juncos(o, x, zr);
            }
        }
    });

    if (o.piezas.length) {
        const geometria = mergeGeometries(o.piezas);
        geometria.computeVertexNormals();
        grupo.add(new THREE.Mesh(geometria, materialMundo));
    }
    if (o.empedrado.length) grupo.add(new THREE.Mesh(mergeGeometries(o.empedrado), materialPuente));
    if (o.luces.length) grupo.add(new THREE.Mesh(mergeGeometries(o.luces), materialFarol));
    o.halos.forEach((h) => {
        const halo = new THREE.Sprite(materialHalo);
        halo.position.copy(h.posicion);
        halo.scale.set(h.tam, h.tam, 1);
        grupo.add(halo);
    });
    if (o.flores.puntos.length) {
        const geometriaFlores = new THREE.BufferGeometry();
        geometriaFlores.setAttribute("position", new THREE.Float32BufferAttribute(o.flores.puntos, 3));
        geometriaFlores.setAttribute("color", new THREE.Float32BufferAttribute(o.flores.colores, 3));
        grupo.add(new THREE.Points(geometriaFlores, materialFlores));
    }

    grupo.userData.claros = o.claros;
    escena.add(grupo);
    return grupo;
}

const trozos = new Map();

// Pasa a los shaders los claros de los trozos más cercanos
function actualizarClaros() {
    const lista = [];
    trozos.forEach((grupo) => lista.push(...grupo.userData.claros));
    lista.sort((p, q) => Math.abs(p.y - camara.position.z) - Math.abs(q.y - camara.position.z));
    comunes.uClaros.value.forEach((v, i) => {
        if (lista[i]) v.copy(lista[i]);
        else v.set(9999, 9999, 0);
    });
}

function actualizarTrozos(todos = false) {
    const actualIndice = Math.floor(-camara.position.z / ajustes.largoTrozo);
    const desde = actualIndice - 1;
    const hasta = actualIndice + ajustes.trozosDelante;
    for (let i = desde; i <= hasta; i++) {
        if (!trozos.has(i)) {
            trozos.set(i, crearTrozo(i));
            actualizarClaros();
            if (!todos) break;
        }
    }
    trozos.forEach((grupo, i) => {
        if (i < desde || i > hasta) {
            grupo.traverse((objeto) => {
                if (objeto.geometry) objeto.geometry.dispose();
            });
            escena.remove(grupo);
            trozos.delete(i);
            actualizarClaros();
        }
    });
}

// =====================================================================
// 13. LUCIÉRNAGAS (de noche, alrededor de la cámara)
// =====================================================================

const cuantasLuciernagas = movil ? 50 : 100;
const datosLuciernagas = [];
for (let i = 0; i < cuantasLuciernagas; i++) {
    datosLuciernagas.push({ x: entre(-14, 14), z: entre(-3, -40), y: entre(0.3, 1.8), fase: entre(0, 6.28), v: entre(0.4, 1.1) });
}
const geometriaLuciernagas = new THREE.BufferGeometry();
geometriaLuciernagas.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(cuantasLuciernagas * 3), 3));
const materialLuciernagas = new THREE.PointsMaterial({ color: "#f2ffb0", size: 0.05, transparent: true, opacity: 0 });
const luciernagas = new THREE.Points(geometriaLuciernagas, materialLuciernagas);
luciernagas.frustumCulled = false;
escena.add(luciernagas);

function moverLuciernagas(tiempo) {
    const p = geometriaLuciernagas.attributes.position;
    datosLuciernagas.forEach((l, i) => {
        const t = tiempo * l.v + l.fase;
        const z = camara.position.z + l.z;
        const x = caminoX(z) + l.x + Math.sin(t * 0.5) * 1.2;
        p.setXYZ(i, x, alturaTerreno(x, z) + l.y + Math.sin(t) * 0.3, z + Math.cos(t * 0.4) * 1.2);
    });
    p.needsUpdate = true;
    materialLuciernagas.opacity = actual.noche * (0.7 + Math.sin(tiempo * 3) * 0.3);
}

// =====================================================================
// 13b. PÉTALOS Y HOJAS QUE LLEVA EL VIENTO (al atardecer)
// =====================================================================

const cuantosPetalos = movil ? 60 : 130;
const datosPetalos = [];
const coloresPetalo = ["#ffb3d1", "#ffe0ec", "#ffc27a", "#e88a5a"].map((c) => new THREE.Color(c));
const posicionesPetalos = new Float32Array(cuantosPetalos * 3);
const coloresPetalos = new Float32Array(cuantosPetalos * 3);
for (let i = 0; i < cuantosPetalos; i++) {
    datosPetalos.push({ x: entre(-10, 10), y: entre(0.2, 3.5), z: entre(-1, -22), fase: entre(0, 6.28), v: entre(0.6, 1.4) });
    coloresPetalo[i % coloresPetalo.length].toArray(coloresPetalos, i * 3);
}
const geometriaPetalos = new THREE.BufferGeometry();
geometriaPetalos.setAttribute("position", new THREE.BufferAttribute(posicionesPetalos, 3));
geometriaPetalos.setAttribute("color", new THREE.BufferAttribute(coloresPetalos, 3));
const materialPetalos = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 1 });
const petalos = new THREE.Points(geometriaPetalos, materialPetalos);
petalos.frustumCulled = false;
escena.add(petalos);

function moverPetalos(delta, tiempo) {
    const p = geometriaPetalos.attributes.position;
    const viento = comunes.uViento.value;
    datosPetalos.forEach((d, i) => {
        d.x += delta * (0.9 + Math.sin(tiempo * 0.3 + d.fase) * 0.5) * d.v * viento;
        d.y -= delta * 0.18 * d.v;
        if (d.x > 10 || d.y < 0.05) {
            d.x = -10 + Math.random() * 3;
            d.y = entre(1.5, 4);
            d.z = entre(-1, -22);
        }
        const z = camara.position.z + d.z;
        p.setXYZ(i, caminoX(z) + d.x, alturaTerreno(caminoX(z) + d.x, z) + d.y + Math.sin(tiempo * 2 * d.v + d.fase) * 0.15, z + Math.cos(tiempo * d.v + d.fase) * 0.4);
    });
    p.needsUpdate = true;
    materialPetalos.opacity = 1 - actual.noche;
}

// =====================================================================
// 13c. PÁJAROS
// Una bandada pequeña cruza a lo lejos de vez en cuando. Cada pájaro son
// dos líneas en V: con el efecto píxel quedan como pájaros dibujados.
// =====================================================================

const cuantosPajaros = 7;
const geometriaPajaros = new THREE.BufferGeometry();
geometriaPajaros.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cuantosPajaros * 4 * 3), 3));
const materialPajaros = new THREE.LineBasicMaterial({ color: "#1c1430", transparent: true, opacity: 1, fog: false });
const pajaros = new THREE.LineSegments(geometriaPajaros, materialPajaros);
pajaros.frustumCulled = false;
escena.add(pajaros);
const formacion = Array.from({ length: cuantosPajaros }, (_, i) => ({
    x: -Math.abs(i - 3) * 2.4 + entre(-0.5, 0.5),
    y: (i - 3) * 0.9 + entre(-0.4, 0.4),
    fase: entre(0, 6.28)
}));

function moverPajaros(tiempo) {
    const vuelta = 70;
    const t = ((tiempo + 32) % vuelta) / vuelta;
    const p = geometriaPajaros.attributes.position;
    const cx = camara.position.x - 90 + t * 180;
    const cz = camara.position.z - 75;
    formacion.forEach((b, i) => {
        const x = cx + b.x;
        const y = 19 + b.y + Math.sin(t * 9 + b.fase) * 0.6;
        const z = cz + b.y * 1.5;
        const aleteo = Math.sin(tiempo * 9 + b.fase) * 0.45;
        const k = i * 12;
        p.array.set([x - 0.7, y + aleteo, z, x, y, z, x, y, z, x + 0.7, y + aleteo, z], k);
    });
    p.needsUpdate = true;
    materialPajaros.opacity = 1 - actual.noche;
    pajaros.visible = actual.noche < 0.98;
}

// =====================================================================
// 14. CAMINAR
// "metros" es la distancia recorrida. El castillo nunca llega.
// =====================================================================

let metros = 0;
let metrosObjetivo = 0;
let caminandoSolo = false;
const botonCaminar = document.getElementById("boton-caminar");
const pista = document.getElementById("pista");

if (movil) pista.textContent = "Desliza hacia arriba para caminar";

function avanzar(cantidad) {
    metrosObjetivo = Math.max(0, metrosObjetivo + cantidad);
    pista.classList.add("oculta");
}

window.addEventListener("wheel", (evento) => {
    evento.preventDefault();
    caminandoSolo = false;
    botonCaminar.classList.remove("activo");
    avanzar(evento.deltaY * 0.015);
}, { passive: false });

window.addEventListener("keydown", (evento) => {
    if (["ArrowUp", "w", "W"].includes(evento.key)) avanzar(1.5);
    if (["ArrowDown", "s", "S"].includes(evento.key)) avanzar(-1.5);
});

botonCaminar.addEventListener("click", () => {
    caminandoSolo = !caminandoSolo;
    botonCaminar.classList.toggle("activo", caminandoSolo);
    pista.classList.add("oculta");
});

// Para probar: ?metros=150 empieza ya caminado
if (parametros.has("metros")) {
    metros = metrosObjetivo = Math.max(0, Number(parametros.get("metros")) || 0);
}

// =====================================================================
// 15. RATÓN Y DEDO
// =====================================================================

const puntero = new THREE.Vector2();
const punteroSuave = new THREE.Vector2();
const punteroCero = new THREE.Vector2();
const objetivoRaton = new THREE.Vector2(999, 999);
const rayo = new THREE.Raycaster();
const puntoSuelo = new THREE.Vector3();
let punteroDentro = false;
let dedoY = null;

function moverPuntero(evento) {
    puntero.set((evento.clientX / window.innerWidth) * 2 - 1, -(evento.clientY / window.innerHeight) * 2 + 1);
    punteroDentro = true;
    if (evento.pointerType === "touch" && dedoY !== null) {
        avanzar((dedoY - evento.clientY) * 0.04);
        dedoY = evento.clientY;
    }
}

renderizador.domElement.addEventListener("pointermove", moverPuntero);
renderizador.domElement.addEventListener("pointerdown", (evento) => {
    if (evento.pointerType === "touch") dedoY = evento.clientY;
    moverPuntero(evento);
});
renderizador.domElement.addEventListener("pointerleave", () => (punteroDentro = false));
renderizador.domElement.addEventListener("pointerup", (evento) => {
    if (evento.pointerType === "touch") {
        punteroDentro = false;
        dedoY = null;
    }
});

function actualizarRaton(delta) {
    punteroSuave.lerp(punteroDentro && !movil ? puntero : punteroCero, Math.min(1, delta * 2.5));
    desplazamientoRaton.copy(punteroSuave);

    if (tocarHierba && punteroDentro) {
        rayo.setFromCamera(puntero, camara);
        const d = rayo.ray.direction;
        if (d.y < -0.01) {
            const t = (0.05 - rayo.ray.origin.y) / d.y;
            puntoSuelo.copy(rayo.ray.origin).addScaledVector(d, t);
            if (t < 30) objetivoRaton.set(puntoSuelo.x, puntoSuelo.z);
        }
    }
    const raton = comunes.uRaton.value;
    if (raton.x > 900) raton.copy(objetivoRaton);
    else raton.lerp(objetivoRaton, Math.min(1, delta * 12));
    const objetivo = tocarHierba && punteroDentro && objetivoRaton.x < 900 ? 1 : 0;
    comunes.uFuerzaRaton.value += (objetivo - comunes.uFuerzaRaton.value) * Math.min(1, delta * 4);
    if (comunes.uFuerzaRaton.value < 0.002) comunes.uFuerzaRaton.value = 0;
}

function colocarCamara() {
    const z = -metros;
    const paso = Math.abs(metrosObjetivo - metros) > 0.05 ? 1 : 0;
    camara.position.set(
        caminoX(z) * 0.85 + punteroSuave.x * 0.25,
        ajustes.alturaOjos + alturaPuente(z) + Math.sin(metros * 2.4) * 0.035 * paso,
        z
    );
    camara.rotation.set(inclinacion + punteroSuave.y * 0.02, -punteroSuave.x * 0.04 + (caminoX(z - 8) - caminoX(z)) * 0.03, 0);
    comunes.uCamara.value.copy(camara.position);
}

// =====================================================================
// 16. BOTONES
// =====================================================================

const botonesMomento = document.querySelectorAll("[data-momento]");
const pedido = parametros.get("momento");
let momentoHasta = momentos[pedido] ? momentos[pedido] : momentos.atardecer;
const momentoDesde = prepararMomento(momentoVacio);
let progresoMomento = 1;
mezclarMomentos(actual, momentoHasta, momentoHasta, 1);
botonesMomento.forEach((b) => b.classList.toggle("activo", momentos[b.dataset.momento] === momentoHasta));

botonesMomento.forEach((boton) => {
    boton.addEventListener("click", () => {
        mezclarMomentos(momentoDesde, actual, actual, 1);
        momentoHasta = momentos[boton.dataset.momento];
        progresoMomento = 0;
        botonesMomento.forEach((b) => b.classList.toggle("activo", b === boton));
    });
});

const botonPixel = document.getElementById("boton-pixel");
botonPixel.classList.toggle("activo", modoPixel);
botonPixel.addEventListener("click", () => {
    modoPixel = !modoPixel;
    botonPixel.classList.toggle("activo", modoPixel);
    aplicarResolucion();
});

function aplicarMomento() {
    comunes.uNoche.value = actual.noche;
    escena.fog.color.copy(actual.niebla);
    const u = materialSuelo.uniforms;
    u.uTierra.value = actual.tierra;
    u.uTierraClara.value = actual.tierraClara;
    u.uPiedra.value = actual.piedra;
    u.uJuntas.value = actual.juntas;
    u.uBarro.value = actual.barro;
    u.uMusgo.value = actual.musgo;
    u.uReflejoAlto.value = actual.reflejoAlto;
    u.uReflejoBajo.value = actual.reflejoBajo;
    hierba.material.uniforms.uBase.value = actual.hierbaBase;
    hierba.material.uniforms.uPunta.value = actual.hierbaPunta;

    luzSol.color.copy(actual.luz);
    luzSol.position.set(60 - 120 * actual.noche, 30 + 15 * actual.noche, 20);
    materialMundo.emissive.setRGB(0.008 + actual.noche * 0.004, 0.012 + actual.noche * 0.008, 0.02 + actual.noche * 0.022);
    luzSol.intensity = 1.6 - actual.noche * 1.38;
    luzCielo.color.copy(actual.ambiente);
    luzCielo.intensity = 2.0 - actual.noche * 1.4;
    materialFarol.color.setRGB(0.06 + actual.noche * 0.94, 0.04 + actual.noche * 0.7, 0.035 + actual.noche * 0.36);
    materialHalo.opacity = actual.noche * 0.75;
    materialFlores.color.setScalar(1 - actual.noche * 0.6);
}

// =====================================================================
// 17. RENDIMIENTO
// Si los FPS bajan de 45 se quita hierba; si sobran, se vuelve a poner.
// =====================================================================

const marcadorFps = document.createElement("p");
marcadorFps.className = "fps";
if (parametros.get("fps") === "si") document.body.appendChild(marcadorFps);

let fotogramas = 0;
let inicioMedida = performance.now();
const inicioPagina = performance.now();
let calidadHierba = 1;

function revisarRendimiento() {
    fotogramas++;
    const ahora = performance.now();
    const segundos = (ahora - inicioMedida) / 1000;
    if (segundos < 1) return;
    const fps = fotogramas / segundos;
    marcadorFps.textContent = Math.round(fps) + " FPS · hierba " + Math.round(calidadHierba * 100) + "%";
    if ((ahora - inicioPagina) / 1000 > 2) {
        if (fps < 45) calidadHierba = Math.max(0.3, calidadHierba - 0.1);
        else if (fps > 57) calidadHierba = Math.min(1, calidadHierba + 0.05);
        hierba.geometria.instanceCount = Math.floor(hierba.total * calidadHierba);
    }
    fotogramas = 0;
    inicioMedida = ahora;
}

// =====================================================================
// 18. TAMAÑO DE LA VENTANA
// =====================================================================

window.addEventListener("resize", () => {
    aplicarResolucion();
    ajustarEncuadre();
});
ajustarEncuadre();

// =====================================================================
// 19. CARGA DE LAS CAPAS Y BUCLE PRINCIPAL
// =====================================================================

const reloj = new THREE.Clock();
let tiempo = 0;

function suavizar(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    if (!movimientoReducido) tiempo += delta;
    comunes.uTiempo.value = tiempo;

    if (progresoMomento < 1) {
        progresoMomento = Math.min(1, progresoMomento + delta / 2);
        mezclarMomentos(actual, momentoDesde, momentoHasta, suavizar(progresoMomento));
    }

    if (caminandoSolo) metrosObjetivo += 1.4 * delta;
    metros += (metrosObjetivo - metros) * Math.min(1, delta * 2.5);

    actualizarRaton(delta);
    colocarCamara();
    aplicarMomento();
    actualizarTrozos();
    actualizarCapas(metros);
    if (actual.noche > 0.02) moverLuciernagas(tiempo);
    else materialLuciernagas.opacity = 0;
    petalos.visible = actual.noche < 0.98;
    if (petalos.visible) moverPetalos(delta, tiempo);
    moverPajaros(tiempo);

    renderizador.clear();
    renderizador.render(escenaFondo, camaraFondo);
    renderizador.clearDepth();
    renderizador.render(escena, camara);

    revisarRendimiento();
}

const cargador = new THREE.TextureLoader();
const texturas = {};
Promise.all(capas.map((capa) => cargador.loadAsync("capas/" + capa.nombre + ".webp").then((t) => (texturas[capa.nombre] = t))))
    .then(() => {
        crearCapas(texturas);
        materialBruma = crearBruma();
        colocarCamara();
        actualizarTrozos(true);
        document.getElementById("cargando").classList.add("oculta");
        animar();
    })
    .catch((error) => {
        document.getElementById("cargando").textContent = "No se pudieron cargar las imágenes.";
        console.error(error);
    });
