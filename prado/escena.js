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
//   ?fondo=solo      -> solo el fondo, sin la escena 3D (para ajustarlo)
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = window.innerWidth < 760 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tocarHierba = parametros.get("tocar") !== "no";
const factorCalidad = (parametros.get("calidad") === "baja" ? 0.4 : 1) * (movil ? 0.45 : 1);

// Largo de cada trozo del mundo (en metros)
const LARGO_TROZO = 25;

const ajustes = {
    hierba: Math.floor(150000 * factorCalidad),
    largoHierba: 70,
    anchoHierba: 26,
    tamanoPixel: movil ? 2.5 : 3,
    largoTrozo: LARGO_TROZO,
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
const SEPARACION_FAROLA = 2.25;
const BRAZO_FAROLA = 0.45;
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
        float k = floor((-z + ${(PERIODO_ARROYO / 2).toFixed(1)}) / ${PERIODO_ARROYO.toFixed(1)});
        if (k < 1.0) return 99.0;
        return z - (-k * ${PERIODO_ARROYO.toFixed(1)} + 4.0 * sin(x * 0.12 + k * 1.7));
    }

    float alturaTerreno(float x, float z) {
        float lado = abs(x - caminoX(z));
        float h = 2.2 * smoothstep(5.0, 18.0, lado) * (0.55 + 0.45 * sin(z * 0.07 + x * 0.1));
        h += 0.2 * sin(x * 0.7 + z * 0.3) * sin(z * 0.45 + x * 0.2) * smoothstep(2.5, 5.0, lado);
        h -= 0.38 * (1.0 - smoothstep(1.3, 3.2, abs(arroyo(x, z))));
        return h;
    }

    // Hash sin sin(): sigue igual de bien aunque se caminen muchos kilómetros
    // (en los móviles sin() con números muy grandes pierde precisión)
    float hash(vec2 p) {
        p = mod(p, 4096.0);
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
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
        float i = floor(-p.z / ${LARGO_TROZO.toFixed(1)});
        float zf = -(i + 0.5) * ${LARGO_TROZO.toFixed(1)};
        float lado = mod(i, 2.0) < 0.5 ? 1.0 : -1.0;
        vec2 centro = vec2(caminoX(zf) + lado * ${(SEPARACION_FAROLA - BRAZO_FAROLA).toFixed(2)}, zf);
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
renderizador.domElement.setAttribute("role", "img");
renderizador.domElement.setAttribute("aria-label", "Camino empedrado que avanza hacia un castillo de fantasía entre prados, árboles y montañas");

function aplicarResolucion() {
    renderizador.setPixelRatio(modoPixel ? 1 / ajustes.tamanoPixel : Math.min(window.devicePixelRatio, 1.5));
    renderizador.setSize(window.innerWidth, window.innerHeight);
}
aplicarResolucion();

// =====================================================================
// 4. MOMENTOS DEL DÍA
// Cada momento es una paleta de colores y unos números (dónde está el
// sol, cuánta luz hay...). Al cambiar de momento se mezclan poco a poco,
// así el sol se pone de verdad y las estrellas van saliendo.
// =====================================================================

const momentos = {
    dia: {
        noche: 0, dia: 1, solX: 1.22, solY: 0.9, luzX: 30, luzY: 80, fuerzaSol: 2.2, fuerzaCielo: 2.3,
        niebla: "#a3b9dc", tierra: "#2c5230", tierraClara: "#4b7838",
        hierbaBase: "#1b4020", hierbaPunta: "#86b84a", luz: "#fff1d6", ambiente: "#7f93c8",
        piedra: "#a09a98", juntas: "#3a3640", barro: "#6b5848", musgo: "#4c7a34",
        reflejoAlto: "#4f86d8", reflejoBajo: "#d4e8ff",
        cieloAlto: "#2f6fd6", cieloMedio: "#6fa8ee", cieloBajo: "#d8ecff", colorSol: "#fff7dc",
        nubeLuz: "#ffffff", nubeMedia: "#e3ebf8", nubeSombra: "#a6b6dc",
        montanaLejos: "#93a9d8", montanaCerca: "#6181bb", nieve: "#f5f9ff",
        bosqueLejos: "#3f6e5e", bosqueCerca: "#29503c"
    },
    atardecer: {
        noche: 0, dia: 0, solX: 1.42, solY: 0.62, luzX: 60, luzY: 30, fuerzaSol: 1.6, fuerzaCielo: 2.0,
        niebla: "#4a4677", tierra: "#22392b", tierraClara: "#3c5a33",
        hierbaBase: "#14281a", hierbaPunta: "#5c8a3c", luz: "#ffc9a0", ambiente: "#6a5f99",
        piedra: "#8e8a8e", juntas: "#2b2436", barro: "#4a3a40", musgo: "#3f5a2e",
        reflejoAlto: "#6c5aa8", reflejoBajo: "#f2a07c",
        cieloAlto: "#23287a", cieloMedio: "#9a4fa0", cieloBajo: "#ff9f6e", colorSol: "#ffd47e",
        nubeLuz: "#ffbf8f", nubeMedia: "#e0708c", nubeSombra: "#5c3d8e",
        montanaLejos: "#7a68b4", montanaCerca: "#4a3c86", nieve: "#ffd2dc",
        bosqueLejos: "#3b3c6e", bosqueCerca: "#252a50"
    },
    noche: {
        noche: 1, dia: 0, solX: 1.34, solY: 0.22, luzX: -60, luzY: 45, fuerzaSol: 0.22, fuerzaCielo: 0.6,
        niebla: "#141834", tierra: "#0d1520", tierraClara: "#18283a",
        hierbaBase: "#081018", hierbaPunta: "#2a4a66", luz: "#8aa0e0", ambiente: "#2e3668",
        piedra: "#46507a", juntas: "#0d0f1e", barro: "#151824", musgo: "#142636",
        reflejoAlto: "#0c1230", reflejoBajo: "#3a4c96",
        cieloAlto: "#04071a", cieloMedio: "#0e1840", cieloBajo: "#26346a", colorSol: "#ff9a5a",
        nubeLuz: "#5a6aa8", nubeMedia: "#2c3770", nubeSombra: "#151b3e",
        montanaLejos: "#2b3466", montanaCerca: "#1b2150", nieve: "#8f9fd6",
        bosqueLejos: "#151d38", bosqueCerca: "#0d1328"
    }
};

const nombresNumero = ["noche", "dia", "solX", "solY", "luzX", "luzY", "fuerzaSol", "fuerzaCielo"];
const nombresColor = Object.keys(momentos.dia).filter((n) => !nombresNumero.includes(n));

function prepararMomento(datos) {
    const m = {};
    nombresNumero.forEach((n) => (m[n] = datos[n]));
    nombresColor.forEach((n) => (m[n] = new THREE.Color(datos[n])));
    return m;
}

Object.keys(momentos).forEach((k) => (momentos[k] = prepararMomento(momentos[k])));
const momentoVacio = {
    ...Object.fromEntries(nombresNumero.map((n) => [n, 0])),
    ...Object.fromEntries(nombresColor.map((n) => [n, "#000000"]))
};
const actual = prepararMomento(momentoVacio);

function suavizar(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Al anochecer primero baja el sol y después salen las estrellas y se
// encienden las luces; al amanecer, al revés.
function mezclarMomentos(destino, a, b, t) {
    const pronto = suavizar(Math.min(1, t * 1.6));
    const tarde = suavizar(Math.max(0, (t - 0.35) / 0.65));
    const anocheciendo = b.noche > a.noche || (b.noche === a.noche && b.solY < a.solY);
    nombresNumero.forEach((n) => {
        let tt = suavizar(t);
        if (n === "solX" || n === "solY") tt = anocheciendo ? pronto : tarde;
        if (n === "noche") tt = anocheciendo ? tarde : pronto;
        destino[n] = a[n] + (b[n] - a[n]) * tt;
    });
    nombresColor.forEach((n) => destino[n].lerpColors(a[n], b[n], suavizar(t)));
}

const comunes = {
    uTiempo: { value: 0 },
    uCamara: { value: new THREE.Vector3() },
    uNiebla: { value: actual.niebla },
    uLuz: { value: actual.luz },
    uAmbiente: { value: actual.ambiente },
    uNoche: { value: 0 },
    uDia: { value: 0 },
    uRaton: { value: new THREE.Vector2(999, 999) },
    uFuerzaRaton: { value: 0 },
    uViento: { value: movimientoReducido ? 0.25 : 1 },
    uClaros: { value: Array.from({ length: 8 }, () => new THREE.Vector3(9999, 9999, 1)) }
};

// Claros: alrededor de la carreta, el pozo, etc. la hierba es más baja
// y el suelo está pisado. Se guardan como (x, z, radio).
const clarosGLSL = `
    uniform vec3 uClaros[8];
    float enClaro(vec2 p) {
        float c = 1.0;
        for (int i = 0; i < 8; i++) {
            float r = uClaros[i].z;
            c = min(c, smoothstep(r * 0.5, r, length(p - uClaros[i].xy)));
        }
        return c;
    }
`;

// =====================================================================
// 5. EL FONDO
// Todo el fondo se pinta en un solo shader, de atrás hacia delante:
// cielo por bandas, sol, luna y estrellas, nubes altas, dos cordilleras,
// nubes bajas, el castillo (la única imagen) y dos colinas con bosque.
// Por último, la bruma sobre el horizonte.
// Las posiciones van en "coordenadas del marco": x de 0 a 1.78 y de 0
// (abajo) a 1 (arriba); el horizonte del suelo 3D está en y = 0.4.
// Cada capa se mueve distinto con el ratón (paralaje) y crece un poco
// al caminar, más cuanto más cerca está.
// =====================================================================

const ANCHO_MARCO = 1672;
const ALTO_MARCO = 941;
const aspectoMarco = ANCHO_MARCO / ALTO_MARCO;
const HORIZONTE_EN_MARCO = 0.6;

// Castillo: centro en el marco (0-1), escala respecto al marco
const castillo = { x: 0.5, y: 0.61, escala: 0.46 };

const escenaFondo = new THREE.Scene();
const camaraFondo = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const visible = new THREE.Vector2(1, 1);
const desplazamientoRaton = new THREE.Vector2();

const uniformesFondo = {
    uCastillo: { value: null },
    uVisible: { value: visible },
    uRatonFondo: { value: desplazamientoRaton },
    uProgreso: { value: 0 },
    uTiempo: comunes.uTiempo,
    uNoche: comunes.uNoche,
    uDia: comunes.uDia,
    uNiebla: comunes.uNiebla,
    uSol: { value: new THREE.Vector2(1.28, 0.5) },
    uCentroCastillo: { value: new THREE.Vector2(castillo.x, castillo.y) },
    uEscalaCastillo: { value: castillo.escala },
    uAspectoMarco: { value: aspectoMarco },
    uLinea: { value: 1 - HORIZONTE_EN_MARCO }
};
["cieloAlto", "cieloMedio", "cieloBajo", "colorSol", "nubeLuz", "nubeMedia", "nubeSombra", "montanaLejos", "montanaCerca", "nieve", "bosqueLejos", "bosqueCerca"].forEach((n) => {
    uniformesFondo["u" + n[0].toUpperCase() + n.slice(1)] = { value: actual[n] };
});

const fragmentFondo = `
    uniform sampler2D uCastillo;
    uniform vec2 uVisible;
    uniform vec2 uRatonFondo;
    uniform float uProgreso;
    uniform float uTiempo;
    uniform float uNoche;
    uniform float uDia;
    uniform vec3 uNiebla;
    uniform vec2 uSol;
    uniform vec2 uCentroCastillo;
    uniform float uEscalaCastillo;
    uniform float uAspectoMarco;
    uniform float uLinea;
    uniform vec3 uCieloAlto;
    uniform vec3 uCieloMedio;
    uniform vec3 uCieloBajo;
    uniform vec3 uColorSol;
    uniform vec3 uNubeLuz;
    uniform vec3 uNubeMedia;
    uniform vec3 uNubeSombra;
    uniform vec3 uMontanaLejos;
    uniform vec3 uMontanaCerca;
    uniform vec3 uNieve;
    uniform vec3 uBosqueLejos;
    uniform vec3 uBosqueCerca;
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

    float fbm(vec2 p) {
        float suma = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
            suma += ruido(p) * a;
            p = p * 2.03 + vec2(1.7, 9.2);
            a *= 0.5;
        }
        return suma;
    }

    // Tramado ordenado 4x4 (Bayer): reparte los píxeles entre dos tonos
    float tramado() {
        vec2 p = mod(floor(gl_FragCoord.xy), 4.0);
        int i = int(p.x + p.y * 4.0);
        float m[16];
        m[0] = 0.0; m[1] = 8.0; m[2] = 2.0; m[3] = 10.0;
        m[4] = 12.0; m[5] = 4.0; m[6] = 14.0; m[7] = 6.0;
        m[8] = 3.0; m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
        m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
        for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
        return 0.5;
    }

    // Reduce un valor de 0 a 1 a unos pocos escalones, con tramado en los bordes
    float escalones(float v, float cuantos, float t) {
        return clamp(floor(v * cuantos + t) / cuantos, 0.0, 1.0);
    }

    // Igual, pero con menos tramado (para que no salgan tableros de ajedrez)
    float escalonesSuaves(float v, float cuantos, float t) {
        return clamp(floor(v * cuantos + 0.5 + (t - 0.5) * 0.35) / cuantos, 0.0, 1.0);
    }

    // Coordenadas del marco para una capa con su paralaje y su zoom al caminar
    vec2 enCapa(vec2 marco, float paralaje, float zoom) {
        marco += uRatonFondo * vec2(paralaje, paralaje * 0.5);
        vec2 centro = vec2(0.5, uLinea);
        marco = (marco - centro) / (1.0 + zoom * uProgreso) + centro;
        return vec2(marco.x * uAspectoMarco, marco.y);
    }

    vec3 cielo(vec2 f, float t) {
        float alto = clamp((f.y - uLinea) / (1.0 - uLinea), 0.0, 1.0);
        float b = escalones(alto, 16.0, t);
        vec3 c = b < 0.3 ? mix(uCieloBajo, uCieloMedio, b / 0.3) : mix(uCieloMedio, uCieloAlto, (b - 0.3) / 0.7);

        float visibleSol = 1.0 - uNoche;
        vec2 aSol = (f - uSol) * vec2(1.0, 1.25);
        float d = length(aSol);
        float halo = escalones(exp(-d * 3.2), 7.0, t);
        c = mix(c, uColorSol, halo * 0.5 * visibleSol);
        if (d < 0.05) c = mix(c, mix(uColorSol, vec3(1.0), 0.55), visibleSol);
        else if (d < 0.062) c = mix(c, uColorSol, visibleSol * 0.8);

        // Estrellas
        vec2 celda = floor(f * 260.0);
        float estrella = step(0.995, hash(celda)) * (0.55 + 0.45 * sin(uTiempo * 2.0 + hash(celda + 3.0) * 30.0));
        estrella *= smoothstep(0.15, 0.5, alto);
        c += vec3(estrella) * uNoche;

        // Luna con cráteres
        vec2 aLuna = f - vec2(0.62, 0.84);
        float dl = length(aLuna);
        float brilloLuna = escalones(exp(-dl * 9.0), 6.0, t) * 0.35;
        c += vec3(0.28, 0.32, 0.55) * brilloLuna * uNoche;
        if (dl < 0.045) {
            float crater = step(length(aLuna - vec2(0.012, 0.01)), 0.011) + step(length(aLuna - vec2(-0.015, -0.012)), 0.008) + step(length(aLuna - vec2(0.01, -0.02)), 0.006);
            vec3 luna = mix(vec3(0.93, 0.94, 1.0), vec3(0.72, 0.75, 0.88), min(crater, 1.0));
            c = mix(c, luna, uNoche);
        }
        return c;
    }

    // Nubes: ruido estirado en horizontal; la luz depende de hacia dónde está el sol
    vec4 nubes(vec2 f, float t, float semilla, float desde, float hasta, float umbral, float estirar) {
        vec2 p = vec2(f.x * estirar + uTiempo * 0.004 + semilla, f.y * estirar * 3.2 + semilla * 3.0);
        float banda = smoothstep(desde, desde + 0.08, f.y) * (1.0 - smoothstep(hasta - 0.1, hasta, f.y));
        float n = fbm(p) * banda;
        if (n < umbral) return vec4(0.0);
        vec2 haciaSol = normalize(mix(uSol, vec2(0.62, 0.84), uNoche) - f + 0.0001) * 0.02;
        float n2 = fbm(p + vec2(haciaSol.x * estirar, haciaSol.y * estirar * 3.2)) * banda;
        float abajo = fbm(p - vec2(0.0, 0.035 * estirar * 3.2)) * banda;
        float luz = clamp((n - n2) * 14.0 + 0.62, 0.0, 1.0);
        luz = max(luz, (1.0 - smoothstep(umbral - 0.02, umbral + 0.03, abajo)) * (0.95 - uDia * 0.4));
        luz = mix(luz, 0.55, smoothstep(umbral + 0.08, umbral + 0.2, n) * 0.5);
        float q = escalonesSuaves(luz, 3.0, t);
        vec3 c = q < 0.34 ? uNubeSombra : (q < 0.67 ? uNubeMedia : uNubeLuz);
        return vec4(c, 1.0);
    }

    // Crestas de montaña con ruido "afilado"
    float cresta(float x, float semilla, float frecuencia) {
        float h = 0.0;
        float a = 0.5;
        float fr = frecuencia;
        for (int i = 0; i < 5; i++) {
            float r = 1.0 - abs(ruido(vec2(x * fr, semilla + float(i) * 7.3)) * 2.0 - 1.0);
            h += r * r * a;
            a *= 0.5;
            fr *= 2.1;
        }
        return h;
    }

    // Relieve de la ladera: crestas en diagonal para que la luz no haga rayas verticales
    float relieve(vec2 p) {
        float h = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
            h += (1.0 - abs(ruido(p) * 2.0 - 1.0)) * a;
            p = p * 2.07 + vec2(3.1, 1.7);
            a *= 0.5;
        }
        return h;
    }

    vec4 montana(vec2 f, float t, float semilla, float base, float altura, float frecuencia, vec3 color, float aire, float nieveDesde) {
        // Por encima del pico más alto posible no hay montaña: se evita calcular
        if (f.y > uLinea + base + altura) return vec4(0.0);
        float h = uLinea + base + altura * cresta(f.x, semilla, frecuencia);
        if (f.y > h) return vec4(0.0);
        float e = 0.004;
        float pendiente = (cresta(f.x + e, semilla, frecuencia) - (h - uLinea - base) / altura) * altura / e;
        float ladoLuz = mix(sign(uSol.x - 0.89), -1.0, uNoche);
        vec2 pr = vec2(f.x * frecuencia * 7.0 + f.y * 9.0, f.y * frecuencia * 4.0 + semilla);
        float gx = relieve(pr + vec2(0.04, 0.0)) - relieve(pr - vec2(0.04, 0.0));
        float porRelieve = clamp(-gx * ladoLuz * 5.0 + 0.5, 0.0, 1.0);
        float porCresta = clamp(-pendiente * ladoLuz * 0.8 + 0.5, 0.0, 1.0);
        float iluminada = mix(porCresta, porRelieve, smoothstep(0.0, 0.05, h - f.y));
        float q = escalonesSuaves(iluminada, 2.0, t);
        vec3 sombra = mix(color * 0.72, uCieloAlto, 0.2);
        vec3 luz = mix(color * 1.12, uColorSol, 0.18 * (1.0 - uNoche));
        vec3 c = mix(sombra, luz, q);
        float nieve = smoothstep(0.0, 0.004, f.y - (uLinea + nieveDesde + (ruido(vec2(f.x * 40.0, semilla)) - 0.5) * 0.03));
        vec3 colorNieve = mix(uNieve * 0.72, uNieve, q);
        c = mix(c, colorNieve, nieve);
        float bajo = 1.0 - smoothstep(uLinea, h, f.y);
        c = mix(c, uCieloBajo, aire + bajo * 0.35);
        return vec4(c, 1.0);
    }

    // Colina con una fila de pinos recortados contra el cielo
    vec4 colina(vec2 f, float t, float semilla, float base, float altura, float anchoPino, vec3 color, float aire) {
        float suelo = uLinea + base + altura * (ruido(vec2(f.x * 2.2, semilla)) * 0.7 + ruido(vec2(f.x * 6.0, semilla + 4.0)) * 0.3);
        float id = floor(f.x / anchoPino);
        float arriba = suelo;
        float ladoPino = 0.0;
        for (int k = -1; k <= 1; k++) {
            float i = id + float(k);
            float centro = (i + 0.5 + (hash(vec2(i, semilla)) - 0.5) * 0.6) * anchoPino;
            float alto = anchoPino * (1.6 + hash(vec2(i, semilla + 1.0)) * 1.6);
            float dx = (f.x - centro) / (anchoPino * 0.75);
            float pico = suelo + alto * max(0.0, 1.0 - abs(dx)) * step(0.15, hash(vec2(i, semilla + 2.0)));
            if (pico > arriba) { arriba = pico; ladoPino = dx; }
        }
        if (f.y > arriba) return vec4(0.0);
        float ladoLuz = mix(sign(uSol.x - 0.89), -1.0, uNoche);
        float luz = escalones(clamp(ladoPino * ladoLuz * 0.9 + 0.45, 0.0, 1.0), 2.0, t);
        vec3 c = mix(color * 0.8, mix(color * 1.25, uColorSol, 0.12 * (1.0 - uNoche)), luz);
        if (arriba - f.y < 0.003) c = mix(c, uColorSol, 0.25 * (1.0 - uNoche) * step(0.0, ladoPino * ladoLuz));
        float casa = step(0.965, hash(vec2(floor(f.x * 140.0), semilla + 9.0))) * step(0.006, arriba - f.y) * step(f.y, suelo - 0.004) * step(suelo - 0.012, f.y);
        c = mix(c, vec3(1.0, 0.72, 0.38), casa * uNoche);
        c = mix(c, uCieloBajo, aire);
        return vec4(c, 1.0);
    }

    vec4 castilloCapa(vec2 marco) {
        vec2 uvCapa = (marco - uCentroCastillo) / uEscalaCastillo + 0.5;
        if (uvCapa.x < 0.0 || uvCapa.x > 1.0 || uvCapa.y < 0.0 || uvCapa.y > 1.0) return vec4(0.0);
        vec4 color = texture2D(uCastillo, uvCapa);
        if (color.a < 0.5) return vec4(0.0);
        vec3 c = color.rgb;
        float brillo = max(c.r, c.g);
        float calido = smoothstep(0.06, 0.22, c.r - c.b) * smoothstep(0.45, 0.75, brillo);
        vec3 deDia = mix(c * vec3(1.02, 1.06, 1.08) + vec3(0.03, 0.05, 0.06), vec3(dot(c, vec3(0.3, 0.5, 0.2))) * vec3(0.95, 1.0, 1.1), calido * 0.7);
        vec3 deNoche = c * vec3(0.2, 0.24, 0.52);
        c = mix(c, deDia, uDia);
        c = mix(c, deNoche, uNoche);
        float enciende = step(hash(floor(uvCapa * vec2(180.0, 110.0))) * 0.85 + 0.1, uNoche);
        c += color.rgb * calido * enciende * 1.2;
        return vec4(c, 1.0);
    }

    void main() {
        float t = tramado();
        vec2 marco = (vUv - 0.5) * uVisible + 0.5;

        vec3 c = cielo(enCapa(marco, 0.004, 0.0), t);

        vec4 capa = nubes(enCapa(marco, 0.007, 0.02), t, 0.0, uLinea + 0.3, 1.0, 0.56, 1.3);
        c = mix(c, capa.rgb, capa.a);

        capa = montana(enCapa(marco, 0.01, 0.03), t, 3.0, 0.03, 0.62, 1.25, uMontanaLejos, 0.16, 0.24);
        c = mix(c, capa.rgb, capa.a);

        capa = nubes(enCapa(marco, 0.012, 0.04), t, 7.0, uLinea + 0.1, uLinea + 0.3, 0.52, 2.2);
        c = mix(c, capa.rgb, capa.a);

        capa = montana(enCapa(marco, 0.014, 0.05), t, 11.0, 0.0, 0.36, 2.0, uMontanaCerca, 0.05, 0.19);
        c = mix(c, capa.rgb, capa.a);

        vec2 fc = enCapa(marco, 0.018, 0.1);
        capa = castilloCapa(vec2(fc.x / uAspectoMarco, fc.y));
        c = mix(c, capa.rgb, capa.a);

        capa = colina(enCapa(marco, 0.022, 0.15), t, 21.0, 0.0, 0.05, 0.012, uBosqueLejos, 0.18);
        c = mix(c, capa.rgb, capa.a);

        capa = colina(enCapa(marco, 0.03, 0.22), t, 33.0, -0.015, 0.045, 0.02, uBosqueCerca, 0.0);
        c = mix(c, capa.rgb, capa.a);

        float sobre = marco.y - uLinea;
        float franjas = ruido(vec2(marco.x * 7.0 + uTiempo * 0.012, marco.y * 34.0)) * 0.7 + ruido(vec2(marco.x * 20.0 - uTiempo * 0.02, marco.y * 70.0)) * 0.3;
        float bruma = escalones(1.0 - smoothstep(0.0, 0.07 + franjas * 0.08, sobre), 5.0, t) * 0.85;
        c = mix(c, uNiebla, bruma);

        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
    }
`;

let materialFondo = null;

function crearFondo(texturaCastillo) {
    texturaCastillo.colorSpace = THREE.SRGBColorSpace;
    texturaCastillo.magFilter = THREE.NearestFilter;
    texturaCastillo.minFilter = THREE.LinearFilter;
    texturaCastillo.generateMipmaps = false;
    uniformesFondo.uCastillo.value = texturaCastillo;

    materialFondo = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: uniformesFondo,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: fragmentFondo
    });
    const plano = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), materialFondo);
    plano.frustumCulled = false;
    escenaFondo.add(plano);
}

function actualizarFondo(metros) {
    uniformesFondo.uProgreso.value = 1 - Math.exp(-metros / 700);
    uniformesFondo.uSol.value.set(actual.solX, actual.solY);
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

        if (lado < borde && detalle <= 0.0) {
            // Lejos no se distinguen las piedras: color medio sin calcular adoquines
            color = mix(uJuntas, uPiedra * 0.88, 0.72);
        } else if (lado < borde) {
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
    extensions: { derivatives: true },
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
            varying float vMancha;
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
                vMancha = ruido(base.xz * 0.07 + 11.0);
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
            varying float vMancha;
            varying vec3 vMundo;
            ${terrenoGLSL}

            void main() {
                float d = length(vMundo - cameraPosition);
                if (smoothstep(40.0, 66.0, d) > tramado(gl_FragCoord.xy)) discard;
                vec3 punta = uPunta * (0.7 + vAzar * 0.55);
                if (vAzar > 0.93) punta *= vec3(1.35, 1.1, 0.6);
                punta = mix(punta, punta * vec3(1.18, 1.08, 0.72), smoothstep(0.6, 0.85, vMancha));
                punta = mix(punta, punta * vec3(0.78, 0.9, 1.0), 1.0 - smoothstep(0.15, 0.35, vMancha));
                vec3 color = mix(uBase, punta, vAltura);
                // Florecillas sueltas en la punta de algunas briznas
                if (vAzar > 0.984 && vAltura > 0.8) {
                    color = vMancha > 0.66 ? vec3(1.0, 0.86, 0.45) : (vMancha > 0.33 ? vec3(0.95, 0.62, 0.8) : vec3(0.92, 0.92, 1.0));
                }
                color *= uAmbiente * 1.3 + uLuz * (0.3 + 0.5 * vAltura);
                // Las puntas brillan con la luz del sol (a contraluz, al atardecer)
                color += uLuz * pow(vAltura, 4.0) * 0.16 * (1.0 - uNoche);
                color += vec3(1.0, 0.55, 0.22) * luzFarolas(vMundo) * uNoche * (0.03 + vAltura * 0.13);
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
            int ib = int(pt.x + pt.y * 4.0);
            float umbral = 0.5;
            float bayer[16];
            bayer[0] = 0.0; bayer[1] = 8.0; bayer[2] = 2.0; bayer[3] = 10.0;
            bayer[4] = 12.0; bayer[5] = 4.0; bayer[6] = 14.0; bayer[7] = 6.0;
            bayer[8] = 3.0; bayer[9] = 11.0; bayer[10] = 1.0; bayer[11] = 9.0;
            bayer[12] = 15.0; bayer[13] = 7.0; bayer[14] = 13.0; bayer[15] = 5.0;
            for (int k = 0; k < 16; k++) if (k == ib) umbral = (bayer[k] + 0.5) / 16.0;
            if (smoothstep(${cerca.toFixed(1)}, ${lejos.toFixed(1)}, length(vViewPosition)) > umbral) discard;`
        );
    };
    return material;
}

const materialMundo = desvanecerLejos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, emissive: "#141c26" }), 34, 56);
const materialFarol = new THREE.MeshBasicMaterial({ color: "#2a2230" });
const materialFlores = new THREE.PointsMaterial({ size: 0.13, vertexColors: true });

const colores = {
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
    const arboles = [];
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
        arboles,
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
        arbol(variante, x, y, z, tam) {
            // En una ladera, el pie del dibujo baja hasta el punto más bajo
            // bajo el tronco para que no se vea flotando por un lado
            const tipo = atlasArboles.variantes[variante].tipo;
            const planta = ["pino", "frondoso", "arbusto", "juncos"].includes(tipo);
            const r = tam * (planta ? 0.1 : 0.4);
            const bajo = Math.min(alturaTerreno(x - r, z), alturaTerreno(x + r, z), alturaTerreno(x, z - r), alturaTerreno(x, z + r));
            const final = Math.max(y - 0.4, Math.min(y, bajo - 0.08));
            arboles.push({ variante, x, y: final, z, tam });
            return final;
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
// 9b. ÁRBOLES PINTADOS PÍXEL A PÍXEL
// Los árboles, arbustos y objetos sueltos (carreta, pozo, leña...) no son
// polígonos: se pintan al cargar en un
// canvas (un "atlas" con casillas de 128x128 píxeles) y se dibujan como
// carteles que siempre miran a la cámara. Así tienen el mismo estilo
// pixel art que el fondo y cuestan muy poco.
// =====================================================================

const CASILLA = 128;
const COLUMNAS_ATLAS = 8;
const FILAS_ATLAS = 4;

const paletasArbol = {
    pino: ["#0a1d1b", "#143a30", "#21543e", "#357449", "#58985a"],
    pinoAzul: ["#0a1a1f", "#123540", "#1d4d54", "#2f6c66", "#4f8f80"],
    verde: ["#0d2316", "#1b4226", "#2b5e31", "#437f3c", "#6aa34d"],
    verdeClaro: ["#10261a", "#21502c", "#367238", "#57954a", "#86bb5e"],
    naranja: ["#2a120a", "#682814", "#a6461d", "#d6722b", "#f3a84c"],
    rojo: ["#250b10", "#5c1820", "#91272b", "#c2423a", "#e87158"],
    dorado: ["#281d0b", "#674813", "#a6771e", "#d6a32c", "#f2d05b"],
    tronco: ["#140c08", "#33211a", "#4f3427", "#6d4a35"]
};

function crearAtlasArboles() {
    const lienzo = document.createElement("canvas");
    lienzo.width = CASILLA * COLUMNAS_ATLAS;
    lienzo.height = CASILLA * FILAS_ATLAS;
    const ctx = lienzo.getContext("2d");
    const imagen = ctx.createImageData(lienzo.width, lienzo.height);
    const datos = imagen.data;
    const variantes = [];

    const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const paletas = Object.fromEntries(Object.entries(paletasArbol).map(([k, v]) => [k, v.map(rgb)]));

    function poner(x, y, color) {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || y < 0 || x >= lienzo.width || y >= lienzo.height) return;
        const i = (y * lienzo.width + x) * 4;
        datos[i] = color[0];
        datos[i + 1] = color[1];
        datos[i + 2] = color[2];
        datos[i + 3] = 255;
    }

    function lleno(x, y) {
        if (x < 0 || y < 0 || x >= lienzo.width || y >= lienzo.height) return false;
        return datos[(y * lienzo.width + x) * 4 + 3] > 0;
    }

    // Contorno oscuro solo donde el píxel toca el vacío (como en el pixel art)
    function contorno(x0, y0, color, soloAbajoIzquierda) {
        const borde = [];
        for (let y = y0; y < y0 + CASILLA; y++) {
            for (let x = x0; x < x0 + CASILLA; x++) {
                if (!lleno(x, y)) continue;
                const fuera = !lleno(x - 1, y) || !lleno(x, y + 1) || (!soloAbajoIzquierda && (!lleno(x + 1, y) || !lleno(x, y - 1)));
                if (fuera) borde.push([x, y]);
            }
        }
        borde.forEach(([x, y]) => poner(x, y, color));
    }

    function tronco(cx, base, alto, ancho, azar, ramas) {
        const p = paletas.tronco;
        for (let y = 0; y < alto; y++) {
            const w = ancho * (1 - (y / alto) * 0.35);
            const doblez = Math.sin(y * 0.15 + azar() * 0.2) * 1.2;
            for (let x = -w / 2; x < w / 2; x++) {
                const lado = (x + w / 2) / w;
                const tono = lado > 0.65 ? p[3] : lado < 0.3 ? p[1] : p[2];
                poner(cx + x + doblez, base - y, tono);
            }
        }
        // Raíces
        for (let i = -1; i <= 1; i += 2) {
            for (let k = 0; k < ancho * 0.6; k++) poner(cx + i * (ancho / 2 + k), base - Math.max(0, 1 - k * 0.5), p[1]);
        }
        // Ramas
        for (let r = 0; r < ramas; r++) {
            const lado = r % 2 === 0 ? 1 : -1;
            const desde = alto * (0.55 + azar() * 0.35);
            const largo = alto * (0.35 + azar() * 0.25);
            for (let k = 0; k < largo; k++) {
                poner(cx + lado * k * 0.9, base - desde - k * 0.75, p[2]);
                poner(cx + lado * k * 0.9, base - desde - k * 0.75 - 1, p[1]);
            }
        }
    }

    function pino(columna, fila, paleta, semilla) {
        const azar = crearAzar(semilla);
        const x0 = columna * CASILLA;
        const y0 = fila * CASILLA;
        const cx = x0 + CASILLA / 2;
        const base = y0 + CASILLA - 2;
        const alto = CASILLA - 6;
        const p = paletas[paleta];

        tronco(cx, base, alto * 0.18, 6, azar, 0);

        const pisos = 6 + Math.floor(azar() * 2);
        const zonaCopa = alto * 0.88;
        const abajo = base - alto * 0.1;
        const finales = [];
        for (let k = 0; k < pisos; k++) {
            const t = k / pisos;
            const yb = abajo - t * zonaCopa * 0.86;
            const altoPiso = (zonaCopa / pisos) * 1.75;
            const anchoBase = alto * 0.3 * (1 - t * 0.82) * (0.85 + azar() * 0.3) + 3;
            const torcido = (azar() - 0.5) * 3;
            const izquierda = 0.85 + azar() * 0.3;
            const derecha = 0.85 + azar() * 0.3;
            for (let y = yb - altoPiso; y <= yb; y++) {
                const s = (y - (yb - altoPiso)) / altoPiso;
                const medio = anchoBase * Math.pow(s, 0.8);
                const desdeX = -medio * izquierda - azar() * 1.8;
                const hastaX = medio * derecha + azar() * 1.8;
                const centro = cx + torcido * s;
                for (let x = desdeX; x <= hastaX; x++) {
                    const lado = x / Math.max(medio, 1);
                    let tono = lado > 0.3 + azar() * 0.2 ? p[3] : lado < -0.35 - azar() * 0.2 ? p[1] : p[2];
                    if (lado > 0.55 && s < 0.85 && azar() < 0.45) tono = p[4];
                    poner(centro + x, y, tono);
                }
            }
            // Borde de abajo irregular y puntas que cuelgan
            for (let x = -anchoBase; x <= anchoBase; x++) {
                const caida = azar() < 0.35 ? 1 + Math.floor(azar() * 3) : 0;
                for (let k = 1; k <= caida; k++) {
                    if (lleno(Math.round(cx + torcido + x), Math.round(yb))) poner(cx + torcido + x, yb + k, p[x > 0 ? 2 : 1]);
                }
            }
            finales.push({ yb, anchoBase });
        }
        // Sombra bajo cada piso sobre el de abajo
        finales.slice(1).forEach(({ yb, anchoBase }) => {
            for (let x = -anchoBase * 0.8; x <= anchoBase * 0.5; x++) {
                if (azar() < 0.7 && lleno(Math.round(cx + x), Math.round(yb + 3))) poner(cx + x, yb + 3, p[1]);
            }
        });
        // Punta
        for (let y = 0; y < 5; y++) poner(cx, abajo - zonaCopa - y + 2, y < 2 ? p[2] : p[3]);
        contorno(x0, y0, p[0], false);
        return { columna, fila };
    }

    function copa(columna, fila, paleta, semilla, conTronco, alto, ancho, flores) {
        const azar = crearAzar(semilla);
        const x0 = columna * CASILLA;
        const y0 = fila * CASILLA;
        const cx = x0 + CASILLA / 2;
        const base = y0 + CASILLA - 2;
        const p = paletas[paleta];
        const centroY = base - (conTronco ? alto * 0.62 : alto * 0.5);

        if (conTronco) tronco(cx, base, alto * 0.55, 11, azar, 2);

        const bolas = [];
        const cuantas = conTronco ? 9 : 5;
        for (let i = 0; i < cuantas; i++) {
            const ang = (i / cuantas) * Math.PI * 2 + azar() * 0.6;
            const dist = (conTronco ? 0.62 : 0.55) * Math.sqrt(azar());
            bolas.push({
                x: cx + Math.cos(ang) * ancho * 0.36 * dist * 1.6,
                y: centroY + Math.sin(ang) * alto * 0.2 * dist * 1.4 - (conTronco ? 0 : -alto * 0.1),
                r: (conTronco ? alto * 0.17 : alto * 0.3) * (0.75 + azar() * 0.45)
            });
        }
        bolas.push({ x: cx, y: centroY - alto * 0.12, r: conTronco ? alto * 0.22 : alto * 0.33 });
        // Las de abajo primero: las de arriba quedan delante
        bolas.sort((a, b) => b.y - a.y + (a.r - b.r) * 0.2);

        const luz = [0.55, -0.7];
        bolas.forEach((b, indice) => {
            const fase = azar() * 10;
            for (let y = Math.floor(b.y - b.r - 2); y <= b.y + b.r + 2; y++) {
                for (let x = Math.floor(b.x - b.r - 2); x <= b.x + b.r + 2; x++) {
                    const dx = x - b.x;
                    const dy = y - b.y;
                    const ang = Math.atan2(dy, dx);
                    const radio = b.r * (1 + 0.12 * Math.sin(ang * 5 + fase) + 0.07 * Math.sin(ang * 11 + fase * 2));
                    const d = Math.hypot(dx, dy);
                    if (d > radio) continue;
                    const nx = dx / radio;
                    const ny = dy / radio;
                    let l = nx * luz[0] + ny * luz[1] + (azar() - 0.5) * 0.35 - (d / radio) * 0.15;
                    l += indice / bolas.length * 0.25;
                    const tono = l > 0.55 ? p[4] : l > 0.18 ? p[3] : l > -0.3 ? p[2] : p[1];
                    poner(x, y, tono);
                }
            }
        });
        // Huecos y hojas sueltas en el borde
        for (let i = 0; i < 40; i++) {
            const b = bolas[Math.floor(azar() * bolas.length)];
            const ang = azar() * Math.PI * 2;
            const px = Math.round(b.x + Math.cos(ang) * (b.r + 1));
            const py = Math.round(b.y + Math.sin(ang) * (b.r + 1));
            poner(px, py, p[ang > Math.PI ? 3 : 2]);
        }
        if (flores) {
            const color = rgb(flores);
            const claro = color.map((v) => Math.min(255, v + 60));
            for (let i = 0; i < 34; i++) {
                const b = bolas[Math.floor(azar() * bolas.length)];
                const ang = azar() * Math.PI * 2;
                const d = Math.sqrt(azar()) * b.r * 0.85;
                const fx = Math.round(b.x + Math.cos(ang) * d);
                const fy = Math.round(b.y + Math.sin(ang) * d);
                if (!lleno(fx, fy)) continue;
                poner(fx, fy, color);
                poner(fx + 1, fy, color);
                poner(fx, fy + 1, color);
                poner(fx + 1, fy + 1, claro);
            }
        }
        contorno(x0, y0, p[0], false);
        return { columna, fila };
    }


    // ---- Objetos del camino ----
    const pal = (lista) => lista.map(rgb);
    const madera = pal(["#1e120a", "#4a2e1a", "#6e4a2c", "#93683e", "#b88a58"]);
    const piedra = pal(["#1c1a22", "#4a4652", "#6a6672", "#8a8692", "#aeaab4"]);
    const teja = pal(["#2a0e0c", "#6a2420", "#8e3428", "#b04a36", "#d0704c"]);
    const paja = pal(["#3a2a0c", "#7a5a1c", "#a8822c", "#d0aa48", "#ecd078"]);
    const musgo = pal(["#0d1f12", "#1f4224", "#2f5e30", "#4a7e3c", "#6c9e4c"]);

    function rect(x, y, w, h, tono) {
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) poner(x + xx, y + yy, tono);
    }

    // Caja con luz arriba a la derecha: borde izquierdo y de abajo más oscuros
    function bloque(x, y, w, h, p, azar) {
        for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
                let t = 2;
                if (xx === 0 || yy === h - 1) t = 1;
                else if (yy === 0 || xx === w - 1) t = 3;
                if (azar && azar() < 0.08) t = Math.max(1, t - 1);
                poner(x + xx, y + yy, p[t]);
            }
        }
    }

    function elipse(cx, cy, rx, ry, p, azar, irregular = 0) {
        for (let y = -ry - 2; y <= ry + 2; y++) {
            for (let x = -rx - 2; x <= rx + 2; x++) {
                const ang = Math.atan2(y, x);
                const borde = 1 + irregular * Math.sin(ang * 5 + cx) * 0.12;
                const d = Math.hypot(x / rx, y / ry);
                if (d > borde) continue;
                let l = (x / rx) * 0.55 - (y / ry) * 0.7 - d * 0.2 + (azar ? (azar() - 0.5) * 0.3 : 0);
                poner(cx + x, cy + y, l > 0.5 ? p[4] : l > 0.1 ? p[3] : l > -0.35 ? p[2] : p[1]);
            }
        }
    }

    function linea(x0, y0, x1, y1, tono, grosor = 1) {
        const pasos = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let i = 0; i <= pasos; i++) {
            const x = x0 + ((x1 - x0) * i) / pasos;
            const y = y0 + ((y1 - y0) * i) / pasos;
            for (let g = 0; g < grosor; g++) poner(x + g, y, tono);
        }
    }

    function rueda(cx, cy, r, oscura) {
        const p = oscura ? [madera[0], madera[0], madera[1], madera[2], madera[2]] : madera;
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
            const d = Math.hypot(x, y);
            if (d <= r && d > r - 3.2) poner(cx + x, cy + y, d > r - 1 ? p[1] : (x - y > 0 ? p[3] : p[2]));
        }
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + 0.3;
            linea(cx, cy, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), p[2]);
        }
        elipse(cx, cy, 3, 3, p);
    }

    function casilla(columna, fila) {
        return { x0: columna * CASILLA, y0: fila * CASILLA, cx: columna * CASILLA + CASILLA / 2, base: fila * CASILLA + CASILLA - 2 };
    }

    function carreta(columna, fila) {
        const azar = crearAzar(201);
        const { x0, y0, cx, base } = casilla(columna, fila);
        rueda(cx + 18, base - 18, 16, true);
        linea(cx - 46, base - 34, cx - 62, base - 4, madera[2], 2);
        linea(cx - 40, base - 32, cx - 56, base - 2, madera[1], 2);
        elipse(cx - 6, base - 52, 30, 9, paja, azar, 1);
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 78; x++) {
                let t = (Math.floor(y / 4) % 2) ? 2 : 3;
                if (x % 13 === 0) t = 1;
                if (y === 0) t = 4;
                if (y === 15) t = 1;
                poner(cx - 46 + x, base - 46 + y, madera[t]);
            }
        }
        rect(cx - 46, base - 50, 78, 3, madera[3]);
        rect(cx - 46, base - 50, 3, 6, madera[2]);
        rect(cx + 29, base - 50, 3, 6, madera[2]);
        rueda(cx - 18, base - 19, 19, false);
        contorno(x0, y0, madera[0], false);
        return { columna, fila };
    }

    function pozo(columna, fila) {
        const azar = crearAzar(202);
        const { x0, y0, cx, base } = casilla(columna, fila);
        rect(cx - 24, base - 78, 5, 50, madera[2]);
        rect(cx - 24, base - 78, 1, 50, madera[1]);
        rect(cx + 19, base - 78, 5, 50, madera[3]);
        rect(cx - 24, base - 71, 48, 4, madera[3]);
        linea(cx, base - 67, cx, base - 47, madera[0]);
        bloque(cx - 5, base - 47, 10, 9, madera, null);
        for (let fila2 = 0; fila2 < 5; fila2++) {
            const desfase = fila2 % 2 ? 5 : 0;
            for (let k = -3; k < 4; k++) {
                const x = cx - 26 + desfase + (k + 3) * 8;
                if (x + 7 > cx + 27) continue;
                bloque(x, base - 28 + fila2 * 6, 7, 5, piedra, azar);
            }
        }
        elipse(cx, base - 30, 27, 4, piedra, azar);
        elipse(cx, base - 30, 20, 2, pal(["#06080e", "#0e1626", "#16223a", "#1e2e4a", "#2a3e5e"]));
        for (let y = 0; y < 30; y++) {
            const medio = 6 + y * 1.25;
            for (let x = -medio; x <= medio; x++) {
                const t = (Math.floor(y / 4) % 2 ? 2 : 3) + (x > 0 ? 0 : -1);
                poner(cx + x, base - 106 + y, teja[Math.max(1, t)]);
            }
        }
        contorno(x0, y0, madera[0], false);
        return { columna, fila };
    }

    function lenas(columna, fila) {
        const { x0, y0, cx, base } = casilla(columna, fila);
        const anillo = (x, y) => {
            for (let yy = -9; yy <= 9; yy++) for (let xx = -9; xx <= 9; xx++) {
                const d = Math.hypot(xx, yy);
                if (d > 9) continue;
                poner(x + xx, y + yy, d > 7.5 ? madera[1] : (Math.floor(d / 2) % 2 ? madera[4] : madera[3]));
            }
            poner(x, y, madera[2]);
        };
        [[-38, 0], [-19, 0], [0, 0], [19, 0], [-28, -17], [-9, -17], [10, -17], [-19, -34], [0, -34]].forEach(([x, y]) => anillo(cx - 8 + x, base - 10 + y));
        bloque(cx + 30, base - 20, 22, 20, madera, null);
        elipse(cx + 41, base - 20, 11, 3, pal(["#4a2e1a", "#93683e", "#b88a58", "#d0a878", "#e0c090"]));
        linea(cx + 36, base - 22, cx + 24, base - 44, madera[3], 2);
        rect(cx + 20, base - 48, 8, 5, piedra[3]);
        contorno(x0, y0, madera[0], false);
        return { columna, fila };
    }

    function troncoCaido(columna, fila) {
        const azar = crearAzar(204);
        const { x0, y0, base } = casilla(columna, fila);
        const desde = x0 + 6;
        const hasta = x0 + 112;
        for (let x = desde; x < hasta; x++) {
            const roto = x < desde + 6 ? Math.floor(azar() * 6) : 0;
            for (let y = roto; y < 20; y++) {
                let t = y < 3 ? 3 : y > 16 ? 1 : 2;
                if (azar() < 0.18) t = Math.max(1, t - 1);
                if ((x * 7 + y * 3) % 11 === 0) t = 1;
                poner(x, base - 21 + y, madera[t]);
            }
        }
        elipse(hasta, base - 11, 5, 10, pal(["#4a2e1a", "#93683e", "#b88a58", "#d0a878", "#e0c090"]));
        for (let i = 0; i < 9; i++) {
            const x = desde + 10 + Math.floor(azar() * 90);
            elipse(x, base - 21, 4 + Math.floor(azar() * 5), 2, musgo, azar);
        }
        [[30, 14], [62, 10], [88, 12]].forEach(([dx, largo]) => linea(desde + dx, base - 21, desde + dx - 4, base - 21 - largo, madera[2], 2));
        rect(desde + 44, base - 25, 5, 3, pal(["#3a0808", "#8a1a14", "#c8302a", "#e85a40", "#f08a70"])[2]);
        rect(desde + 46, base - 23, 1, 2, piedra[4]);
        contorno(x0, y0, madera[0], false);
        return { columna, fila };
    }

    function hito(columna, fila) {
        const azar = crearAzar(205);
        const { x0, y0, cx, base } = casilla(columna, fila);
        elipse(cx - 28, base - 22, 10, 9, piedra, azar);
        bloque(cx - 38, base - 22, 21, 22, piedra, azar);
        rect(cx - 33, base - 16, 11, 1, piedra[1]);
        rect(cx - 2, base - 104, 5, 104, madera[2]);
        rect(cx - 2, base - 104, 1, 104, madera[1]);
        const tabla = (x, y, w, derecha) => {
            bloque(x, y, w, 9, madera.map((c) => c.map((v) => Math.min(255, v + 25))), null);
            for (let k = 0; k < 5; k++) {
                const px = derecha ? x + w + k : x - 1 - k;
                for (let yy = k; yy < 9 - k; yy++) poner(px, y + yy, madera[3]);
            }
            for (let k = 4; k < w - 4; k += 3) if (azar() < 0.7) poner(x + k, y + 4, madera[0]);
        };
        tabla(cx + 3, base - 96, 38, true);
        tabla(cx - 40, base - 82, 38, false);
        tabla(cx + 3, base - 68, 30, true);
        contorno(x0, y0, madera[0], false);
        return { columna, fila };
    }

    function banco(columna, fila) {
        const { x0, y0, cx, base } = casilla(columna, fila);
        [cx - 38, cx + 33].forEach((x) => rect(x, base - 54, 5, 54, madera[2]));
        [cx - 30, cx + 25].forEach((x) => rect(x, base - 24, 4, 24, madera[1]));
        bloque(cx - 42, base - 52, 84, 6, madera, null);
        bloque(cx - 42, base - 42, 84, 5, madera, null);
        bloque(cx - 44, base - 28, 88, 6, madera, null);
        contorno(x0, y0, madera[0], false);
        return { columna, fila };
    }

    function hornacina(columna, fila) {
        const azar = crearAzar(206);
        const { x0, y0, cx, base } = casilla(columna, fila);
        bloque(cx - 18, base - 10, 36, 10, piedra, azar);
        for (let y = 0; y < 52; y += 6) bloque(cx - 10 + ((y / 6) % 2 ? 2 : 0), base - 62 + y, 18, 6, piedra, azar);
        bloque(cx - 19, base - 94, 38, 32, piedra.map((c) => c.map((v) => Math.min(255, v + 18))), azar);
        for (let y = 0; y < 18; y++) {
            const medio = y < 4 ? Math.round(Math.sqrt(16 - (4 - y) ** 2) * 2.2) : 9;
            for (let x = -medio; x <= medio; x++) poner(cx + x, base - 88 + y, rgb("#141018"));
        }
        elipse(cx, base - 76, 3, 5, pal(["#2a2430", "#4a4250", "#6a6070", "#8a8090", "#a8a0b0"]));
        for (let y = 0; y < 22; y++) {
            const medio = 4 + y * 1.1;
            for (let x = -medio; x <= medio; x++) poner(cx + x, base - 116 + y, teja[(Math.floor(y / 4) % 2 ? 2 : 3) - (x < 0 ? 1 : 0)]);
        }
        rect(cx, base - 124, 1, 8, paja[3]);
        rect(cx - 3, base - 121, 7, 1, paja[3]);
        for (let i = 0; i < 10; i++) poner(cx - 22 + Math.floor(azar() * 44), base - 1 - Math.floor(azar() * 3), rgb(elegirColor(azar)));
        contorno(x0, y0, piedra[0], false);
        return { columna, fila };
    }

    function elegirColor(azar) {
        const lista = ["#ff9ccf", "#ffe28a", "#c8b8ff", "#ffffff"];
        return lista[Math.floor(azar() * lista.length)];
    }

    function roca(columna, fila, semilla, rx, ry, conMusgo) {
        const azar = crearAzar(semilla);
        const { x0, y0, cx, base } = casilla(columna, fila);
        elipse(cx, base - ry, rx, ry, piedra, azar, 1.5);
        if (semilla % 2) elipse(cx + rx * 0.7, base - ry * 0.5, rx * 0.45, ry * 0.5, piedra, azar, 1);
        for (let y = base; y < base + 3; y++) for (let x = cx - rx - 3; x <= cx + rx + 3; x++) if (y >= base) datos[(y * lienzo.width + x) * 4 + 3] = 0;
        if (conMusgo) for (let i = 0; i < 6; i++) elipse(cx - rx * 0.6 + azar() * rx * 1.2, base - ry * 2 + 3 + azar() * 4, 4 + azar() * 6, 2, musgo, azar);
        contorno(x0, y0, piedra[0], false);
        return { columna, fila };
    }

    function juncos(columna, fila, semilla) {
        const azar = crearAzar(semilla);
        const { x0, y0, cx, base } = casilla(columna, fila);
        for (let i = 0; i < 14; i++) {
            const x = cx - 26 + azar() * 52;
            const alto = 40 + azar() * 46;
            const inclina = (azar() - 0.5) * 18;
            linea(x, base, x + inclina, base - alto, musgo[1 + Math.floor(azar() * 3)], azar() < 0.4 ? 2 : 1);
            if (azar() < 0.4) rect(Math.round(x + inclina * 0.85) - 1, Math.round(base - alto * 0.85) - 6, 3, 9, madera[2]);
        }
        contorno(x0, y0, musgo[0], true);
        return { columna, fila };
    }

    const lista = [
        ["pino", () => pino(0, 0, "pino", 11)],
        ["pino", () => pino(1, 0, "pino", 23)],
        ["pino", () => pino(2, 0, "pinoAzul", 37)],
        ["pino", () => pino(3, 0, "pino", 51)],
        ["frondoso", () => copa(4, 0, "verde", 61, true, 118, 120)],
        ["frondoso", () => copa(5, 0, "verdeClaro", 73, true, 112, 116)],
        ["frondoso", () => copa(6, 0, "naranja", 89, true, 116, 120)],
        ["frondoso", () => copa(7, 0, "rojo", 97, true, 110, 112)],
        ["frondoso", () => copa(0, 1, "dorado", 101, true, 114, 118)],
        ["arbusto", () => copa(1, 1, "verde", 113, false, 56, 104)],
        ["arbusto", () => copa(2, 1, "verdeClaro", 127, false, 50, 96)],
        ["arbusto", () => copa(3, 1, "verde", 131, false, 54, 100, "#ff9ccf")],
        ["arbusto", () => copa(4, 1, "verdeClaro", 149, false, 52, 100, "#c8b8ff")],
        ["arbusto", () => copa(5, 1, "naranja", 151, false, 50, 96)],
        ["arbusto", () => copa(6, 1, "verde", 163, false, 56, 104, "#ffe28a")],
        ["carreta", () => carreta(7, 1)],
        ["pozo", () => pozo(0, 2)],
        ["lenas", () => lenas(1, 2)],
        ["tronco", () => troncoCaido(2, 2)],
        ["hito", () => hito(3, 2)],
        ["banco", () => banco(4, 2)],
        ["hornacina", () => hornacina(5, 2)],
        ["roca", () => roca(6, 2, 301, 40, 22, false)],
        ["roca", () => roca(7, 2, 302, 30, 18, true)],
        ["roca", () => roca(0, 3, 303, 44, 16, true)],
        ["juncos", () => juncos(1, 3, 401)],
        ["juncos", () => juncos(2, 3, 402)]
    ];

    lista.forEach(([tipo, pintar]) => {
        const { columna, fila } = pintar();
        variantes.push({
            tipo,
            u0: columna / COLUMNAS_ATLAS,
            u1: (columna + 1) / COLUMNAS_ATLAS,
            v0: 1 - (fila + 1) / FILAS_ATLAS,
            v1: 1 - fila / FILAS_ATLAS
        });
    });

    ctx.putImageData(imagen, 0, 0);
    return { lienzo, variantes };
}

const atlasArboles = crearAtlasArboles();
const texturaArboles = new THREE.CanvasTexture(atlasArboles.lienzo);
texturaArboles.colorSpace = THREE.SRGBColorSpace;
texturaArboles.magFilter = THREE.NearestFilter;
texturaArboles.minFilter = THREE.NearestMipmapLinearFilter;
const variantesPorTipo = { pino: [], frondosoVerde: [], frondosoOtono: [], arbusto: [], arbustoFlores: [] };
atlasArboles.variantes.forEach((v, i) => {
    if (v.tipo === "pino") variantesPorTipo.pino.push(i);
    else if (v.tipo === "frondoso") variantesPorTipo[i <= 5 ? "frondosoVerde" : "frondosoOtono"].push(i);
    else if (v.tipo === "arbusto") variantesPorTipo[[11, 12, 14].includes(i) ? "arbustoFlores" : "arbusto"].push(i);
    else (variantesPorTipo[v.tipo] = variantesPorTipo[v.tipo] || []).push(i);
});

// Cada árbol es un rectángulo que gira solo en vertical para mirar a la
// cámara. La copa se mece un poco con el viento.
const materialArboles = new THREE.ShaderMaterial({
    uniforms: {
        ...comunes,
        uAtlas: { value: texturaArboles }
    },
    vertexShader: `
        attribute vec2 aEsquina;
        attribute float aTam;
        uniform float uTiempo;
        uniform float uViento;
        varying vec2 vUv;
        varying vec3 vMundo;
        varying float vAltura;
        void main() {
            vec3 derecha = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
            // aTam negativo = objeto rígido (carreta, pozo...): no se mece
            float tam = abs(aTam);
            vec3 p = position + derecha * aEsquina.x * tam + vec3(0.0, aEsquina.y * tam, 0.0);
            float vaiven = sin(uTiempo * 1.3 + position.x * 0.4 + position.z * 0.3) * 0.03 * uViento * step(0.0, aTam);
            p += derecha * vaiven * aEsquina.y * aEsquina.y * tam;
            vUv = uv;
            vMundo = p;
            vAltura = aEsquina.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D uAtlas;
        uniform vec3 uLuz;
        uniform vec3 uAmbiente;
        uniform vec3 uNiebla;
        uniform float uNoche;
        varying vec2 vUv;
        varying vec3 vMundo;
        varying float vAltura;
        ${terrenoGLSL}
        void main() {
            vec4 c = texture2D(uAtlas, vUv);
            if (c.a < 0.5) discard;
            float d = length(vMundo - cameraPosition);
            if (smoothstep(36.0, 58.0, d) > tramado(gl_FragCoord.xy)) discard;
            vec3 color = c.rgb * (uAmbiente * 1.25 + uLuz * 0.6) * (1.0 - uNoche * 0.4);
            color += c.rgb * vec3(1.0, 0.6, 0.3) * luzFarolas(vMundo) * uNoche * (1.0 - vAltura) * 1.2;
            color = mix(color, uNiebla, smoothstep(14.0, 95.0, d) * 0.88);
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
        }
    `
});

// =====================================================================
// 10. ÁRBOLES, ROCAS Y PLANTAS
// =====================================================================

function pino(o, x, z, alto) {
    o.arbol(o.elegir(variantesPorTipo.pino), x, alturaTerreno(x, z) - 0.15, z, alto * 1.05);
}

function frondoso(o, x, z, alto) {
    const lista = o.aleatorio() < 0.35 ? variantesPorTipo.frondosoOtono : variantesPorTipo.frondosoVerde;
    o.arbol(o.elegir(lista), x, alturaTerreno(x, z) - 0.1, z, alto * 1.1);
}

function arbusto(o, x, z, tam, conFlores) {
    const lista = conFlores ? variantesPorTipo.arbustoFlores : variantesPorTipo.arbusto;
    o.arbol(o.elegir(lista), x, alturaTerreno(x, z) - 0.05, z, tam * 2.4);
}

function roca(o, x, z, tam) {
    o.arbol(o.elegir(variantesPorTipo.roca), x, alturaTerreno(x, z) - 0.05, z, tam * 3.6);
}

function juncos(o, x, z) {
    o.arbol(o.elegir(variantesPorTipo.juncos), x, alturaTerreno(x, z) - 0.05, z, entre(1.5, 2.1, o.aleatorio));
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
    const x = caminoX(z) + lado * SEPARACION_FAROLA;
    const y = alturaTerreno(x, z);
    o.en(x, y, z);
    o.poner(caja(0.14, 0.3, 0.14, 0, 0.15, 0), colores.piedraOscura, 0.1);
    o.poner(caja(0.1, 2.5, 0.1, 0, 1.4, 0), colores.maderaOscura, 0.1);
    o.poner(caja(0.6, 0.07, 0.07, -lado * 0.27, 2.6, 0), colores.maderaOscura, 0.1);
    o.poner(caja(0.03, 0.18, 0.03, -lado * BRAZO_FAROLA, 2.48, 0), colores.hierro, 0);
    o.poner(cono(0.22, 0.14, 4, -lado * BRAZO_FAROLA, 2.42, 0, Math.PI / 4), colores.hierro, 0);
    o.poner(caja(0.3, 0.05, 0.3, -lado * BRAZO_FAROLA, 2.04, 0), colores.hierro, 0);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => o.poner(caja(0.035, 0.32, 0.035, -lado * BRAZO_FAROLA + sx * 0.12, 2.2, sz * 0.12), colores.hierro, 0)));
    o.luz(caja(0.22, 0.28, 0.22, -lado * BRAZO_FAROLA, 2.2, 0), 2.4);
}

function carreta(o, x, z) {
    o.arbol(variantesPorTipo.carreta[0], x, alturaTerreno(x, z) - 0.05, z, 3.3);
}

function pozo(o, x, z) {
    o.arbol(variantesPorTipo.pozo[0], x, alturaTerreno(x, z) - 0.05, z, 3.1);
}

function lenas(o, x, z) {
    o.arbol(variantesPorTipo.lenas[0], x, alturaTerreno(x, z) - 0.05, z, 2.2);
}

function arbolCaido(o, x, z) {
    o.arbol(variantesPorTipo.tronco[0], x, alturaTerreno(x, z) - 0.1, z, 5.2);
}

function hito(o, x, z) {
    o.arbol(variantesPorTipo.hito[0], x, alturaTerreno(x, z) - 0.05, z, 2.7);
}

function banco(o, x, z) {
    o.arbol(variantesPorTipo.banco[0], x, alturaTerreno(x, z) - 0.05, z, 1.9);
}

function hornacina(o, x, z) {
    const base = o.arbol(variantesPorTipo.hornacina[0], x, alturaTerreno(x, z) - 0.05, z, 3.0);
    // La vela de dentro sigue siendo una luz de verdad, a la altura de la pintada
    o.en(x, base, z);
    o.luz(caja(0.06, 0.12, 0.06, 0, 1.83, 0.05), 0.9);
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
    if (o.arboles.length) grupo.add(mallaArboles(o.arboles));
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

function mallaArboles(lista) {
    const n = lista.length;
    const posiciones = new Float32Array(n * 12);
    const esquinas = new Float32Array(n * 8);
    const tamanos = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 8);
    const indices = [];
    const forma = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    lista.forEach((a, i) => {
        const v = atlasArboles.variantes[a.variante];
        const coordenadas = [[v.u0, v.v0], [v.u1, v.v0], [v.u1, v.v1], [v.u0, v.v1]];
        forma.forEach((e, k) => {
            const j = i * 4 + k;
            posiciones.set([a.x, a.y, a.z], j * 3);
            esquinas.set(e, j * 2);
            tamanos[j] = ["pino", "frondoso", "arbusto", "juncos"].includes(v.tipo) ? a.tam : -a.tam;
            uvs.set(coordenadas[k], j * 2);
        });
        const b = i * 4;
        indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("aEsquina", new THREE.BufferAttribute(esquinas, 2));
    geometria.setAttribute("aTam", new THREE.BufferAttribute(tamanos, 1));
    geometria.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometria.setIndex(indices);
    const malla = new THREE.Mesh(geometria, materialArboles);
    malla.frustumCulled = false;
    return malla;
}

// Pasa a los shaders los claros de los trozos más cercanos
function actualizarClaros() {
    const lista = [];
    trozos.forEach((grupo) => lista.push(...grupo.userData.claros));
    const z = camara.position.z;
    const cercania = (c) => (c.y > z + 6 ? 1000 : 0) + Math.abs(c.y - z);
    lista.sort((p, q) => cercania(p) - cercania(q));
    comunes.uClaros.value.forEach((v, i) => {
        if (lista[i]) v.copy(lista[i]);
        else v.set(9999, 9999, 1);
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
                if (objeto.geometry && !objeto.isSprite) objeto.geometry.dispose();
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
const materialPajaros = new THREE.LineBasicMaterial({ color: "#20142e", transparent: true, opacity: 1, fog: false });
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
        const y = 26 + b.y + Math.sin(t * 9 + b.fase) * 0.6;
        const z = cz + b.y * 1.5;
        const aleteo = Math.sin(tiempo * 8 + b.fase) * 0.6;
        const k = i * 12;
        const a = p.array;
        a[k] = x - 1.0; a[k + 1] = y + aleteo; a[k + 2] = z;
        a[k + 3] = x; a[k + 4] = y; a[k + 5] = z;
        a[k + 6] = x; a[k + 7] = y; a[k + 8] = z;
        a[k + 9] = x + 1.0; a[k + 10] = y + aleteo; a[k + 11] = z;
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
    botonCaminar.setAttribute("aria-pressed", "false");
    avanzar(evento.deltaY * 0.015);
}, { passive: false });

window.addEventListener("keydown", (evento) => {
    if (["ArrowUp", "w", "W"].includes(evento.key)) avanzar(1.5);
    if (["ArrowDown", "s", "S"].includes(evento.key)) avanzar(-1.5);
});

botonCaminar.addEventListener("click", () => {
    caminandoSolo = !caminandoSolo;
    botonCaminar.classList.toggle("activo", caminandoSolo);
    botonCaminar.setAttribute("aria-pressed", String(caminandoSolo));
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
let dedoId = null;

function moverPuntero(evento) {
    // Con dos dedos solo cuenta el primero
    if (evento.pointerType === "touch" && dedoId !== null && evento.pointerId !== dedoId) return;
    puntero.set((evento.clientX / window.innerWidth) * 2 - 1, -(evento.clientY / window.innerHeight) * 2 + 1);
    punteroDentro = true;
    if (evento.pointerType === "touch" && dedoY !== null) {
        avanzar((dedoY - evento.clientY) * 0.04);
        dedoY = evento.clientY;
    }
}

function soltarDedo(evento) {
    if (evento.pointerType !== "touch" || evento.pointerId !== dedoId) return;
    punteroDentro = false;
    dedoY = null;
    dedoId = null;
}

renderizador.domElement.addEventListener("pointermove", moverPuntero);
renderizador.domElement.addEventListener("pointerdown", (evento) => {
    if (evento.pointerType === "touch") {
        if (dedoId !== null) return;
        dedoId = evento.pointerId;
        dedoY = evento.clientY;
    }
    moverPuntero(evento);
});
renderizador.domElement.addEventListener("pointerleave", () => (punteroDentro = false));
renderizador.domElement.addEventListener("pointerup", soltarDedo);
renderizador.domElement.addEventListener("pointercancel", soltarDedo);

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
        caminoX(z) * 0.92 + punteroSuave.x * 0.25,
        ajustes.alturaOjos + alturaPuente(z) + Math.sin(metros * 2.4) * 0.035 * paso,
        z
    );
    const mirar = Math.atan2(caminoX(z - 10) - caminoX(z), 10) * (movil ? 0.5 : 0.3);
    camara.rotation.set(inclinacion + punteroSuave.y * 0.02, -punteroSuave.x * 0.04 - mirar, 0);
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
botonesMomento.forEach((b) => {
    b.classList.toggle("activo", momentos[b.dataset.momento] === momentoHasta);
    b.setAttribute("aria-pressed", String(momentos[b.dataset.momento] === momentoHasta));
});

botonesMomento.forEach((boton) => {
    boton.addEventListener("click", () => {
        mezclarMomentos(momentoDesde, actual, actual, 1);
        momentoHasta = momentos[boton.dataset.momento];
        progresoMomento = 0;
        botonesMomento.forEach((b) => {
            b.classList.toggle("activo", b === boton);
            b.setAttribute("aria-pressed", String(b === boton));
        });
    });
});

const botonPixel = document.getElementById("boton-pixel");
botonPixel.classList.toggle("activo", modoPixel);
botonPixel.setAttribute("aria-pressed", String(modoPixel));
botonPixel.addEventListener("click", () => {
    modoPixel = !modoPixel;
    botonPixel.classList.toggle("activo", modoPixel);
    botonPixel.setAttribute("aria-pressed", String(modoPixel));
    aplicarResolucion();
});

function aplicarMomento() {
    comunes.uNoche.value = actual.noche;
    comunes.uDia.value = actual.dia;
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
    luzSol.position.set(actual.luzX, actual.luzY, 20);
    materialMundo.emissive.setRGB(0.008 + actual.noche * 0.004, 0.012 + actual.noche * 0.008, 0.02 + actual.noche * 0.022);
    luzSol.intensity = actual.fuerzaSol;
    luzCielo.color.copy(actual.ambiente);
    luzCielo.intensity = actual.fuerzaCielo;
    materialFarol.color.setRGB(0.06 + actual.noche * 0.94, 0.04 + actual.noche * 0.7, 0.035 + actual.noche * 0.36);
    materialHalo.opacity = actual.noche * 0.75;
    materialFlores.color.setScalar(1 - actual.noche * 0.6);
}

// =====================================================================
// 16b. SONIDO (apagado hasta que se pulsa el botón)
// Todo se genera con Web Audio, sin archivos: viento (ruido filtrado),
// el arroyo cuando estás cerca, pájaros de día y grillos de noche.
// =====================================================================

let audio = null;

function crearSonido() {
    const ctx = new AudioContext();
    const largo = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let ultimo = 0;
    for (let i = 0; i < largo; i++) {
        const blanco = Math.random() * 2 - 1;
        ultimo = (ultimo + 0.02 * blanco) / 1.02;
        datos[i] = ultimo * 2.1 + blanco * 0.4;
    }
    const general = ctx.createGain();
    general.gain.value = 0.9;
    general.connect(ctx.destination);
    const canal = (tipo, frecuencia, q) => {
        const fuente = ctx.createBufferSource();
        fuente.buffer = buffer;
        fuente.loop = true;
        const filtro = ctx.createBiquadFilter();
        filtro.type = tipo;
        filtro.frequency.value = frecuencia;
        filtro.Q.value = q;
        const volumen = ctx.createGain();
        volumen.gain.value = 0;
        fuente.connect(filtro).connect(volumen).connect(general);
        fuente.start(0, Math.random() * 2);
        return { volumen, filtro };
    };
    return { ctx, general, viento: canal("lowpass", 420, 0.5), agua: canal("bandpass", 1100, 0.7), proximo: 0 };
}

// Un pájaro: dos o tres silbidos cortos que suben o bajan de tono
function pajaro(a) {
    const t = a.ctx.currentTime;
    const base = 2200 + Math.random() * 1800;
    const notas = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notas; i++) {
        const osc = a.ctx.createOscillator();
        const vol = a.ctx.createGain();
        const inicio = t + i * 0.13;
        osc.frequency.setValueAtTime(base * (1 + i * 0.08), inicio);
        osc.frequency.exponentialRampToValueAtTime(base * (Math.random() < 0.5 ? 1.35 : 0.75), inicio + 0.09);
        vol.gain.setValueAtTime(0, inicio);
        vol.gain.linearRampToValueAtTime(0.035, inicio + 0.015);
        vol.gain.exponentialRampToValueAtTime(0.0005, inicio + 0.11);
        osc.connect(vol).connect(a.general);
        osc.onended = () => {
            osc.disconnect();
            vol.disconnect();
        };
        osc.start(inicio);
        osc.stop(inicio + 0.12);
    }
}

// Un grillo: un tono agudo que se corta muy rápido varias veces
function grillo(a) {
    const t = a.ctx.currentTime;
    const osc = a.ctx.createOscillator();
    const vol = a.ctx.createGain();
    osc.frequency.value = 4300 + Math.random() * 500;
    vol.gain.value = 0;
    for (let i = 0; i < 4; i++) {
        vol.gain.setValueAtTime(0.012, t + i * 0.05);
        vol.gain.setValueAtTime(0, t + i * 0.05 + 0.025);
    }
    osc.connect(vol).connect(a.general);
    osc.onended = () => {
        osc.disconnect();
        vol.disconnect();
    };
    osc.start(t);
    osc.stop(t + 0.22);
}

function actualizarSonido() {
    if (!audio || audio.ctx.state !== "running") return;
    const ahora = audio.ctx.currentTime;
    const rafaga = 0.5 + 0.5 * Math.sin(ahora * 0.3) * Math.sin(ahora * 0.11);
    audio.viento.volumen.gain.setTargetAtTime((0.05 + rafaga * 0.07) * comunes.uViento.value, ahora, 0.3);
    audio.viento.filtro.frequency.setTargetAtTime(300 + rafaga * 300, ahora, 0.3);
    const z = camara.position.z;
    const cercaAgua = Math.max(0, 1 - Math.abs(arroyo(caminoX(z), z)) / 30);
    audio.agua.volumen.gain.setTargetAtTime(cercaAgua * cercaAgua * 0.22, ahora, 0.3);
    if (ahora > audio.proximo) {
        if (actual.noche > 0.5) {
            grillo(audio);
            audio.proximo = ahora + 0.4 + Math.random() * 1.2;
        } else {
            pajaro(audio);
            audio.proximo = ahora + 2 + Math.random() * 5;
        }
    }
}

const botonSonido = document.getElementById("boton-sonido");
botonSonido.addEventListener("click", async () => {
    if (!audio) {
        audio = crearSonido();
        await audio.ctx.resume();
    } else if (audio.ctx.state === "running") {
        await audio.ctx.suspend();
    } else {
        await audio.ctx.resume();
    }
    const sonando = audio.ctx.state === "running";
    botonSonido.classList.toggle("activo", sonando);
    botonSonido.setAttribute("aria-pressed", String(sonando));
});

// =====================================================================
// 17. RENDIMIENTO
// Si los FPS bajan se quita hierba; si sobran, se vuelve a poner.
// Las pantallas limitadas a 30 FPS (modo ahorro) no cuentan como lentas.
// =====================================================================

const marcadorFps = document.createElement("p");
marcadorFps.className = "fps";
if (parametros.get("fps") === "si") document.body.appendChild(marcadorFps);

let fotogramas = 0;
let inicioMedida = performance.now();
const inicioPagina = performance.now();
let calidadHierba = 1;
const ultimosFps = [];

document.addEventListener("visibilitychange", () => {
    fotogramas = 0;
    inicioMedida = performance.now();
});

function revisarRendimiento() {
    fotogramas++;
    const ahora = performance.now();
    const segundos = (ahora - inicioMedida) / 1000;
    if (segundos < 1) return;
    const fps = fotogramas / segundos;
    fotogramas = 0;
    inicioMedida = ahora;
    if (segundos > 1.5) return;
    marcadorFps.textContent = Math.round(fps) + " FPS · hierba " + Math.round(calidadHierba * 100) + "%";
    ultimosFps.push(fps);
    if (ultimosFps.length > 3) ultimosFps.shift();
    const limitada = ultimosFps.length === 3 && ultimosFps.every((f) => f > 28.5 && f < 31.5);
    if ((ahora - inicioPagina) / 1000 > 2 && !limitada) {
        if (fps < 45) calidadHierba = Math.max(0.3, calidadHierba - 0.1);
        else if (fps > 57) calidadHierba = Math.min(1, calidadHierba + 0.05);
        hierba.geometria.instanceCount = Math.floor(hierba.total * calidadHierba);
    }
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

const soloFondo = parametros.get("fondo") === "solo";
const reloj = new THREE.Clock();
let tiempo = 0;

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    if (!movimientoReducido) tiempo += delta;
    comunes.uTiempo.value = tiempo;

    if (progresoMomento < 1) {
        progresoMomento = Math.min(1, progresoMomento + delta / 5);
        mezclarMomentos(actual, momentoDesde, momentoHasta, progresoMomento);
    }

    if (caminandoSolo) metrosObjetivo += 1.4 * delta;
    metros += (metrosObjetivo - metros) * Math.min(1, delta * 2.5);

    actualizarRaton(delta);
    colocarCamara();
    aplicarMomento();
    actualizarTrozos();
    actualizarFondo(metros);
    if (actual.noche > 0.02) moverLuciernagas(tiempo);
    else materialLuciernagas.opacity = 0;
    petalos.visible = actual.noche < 0.98;
    if (petalos.visible) moverPetalos(delta, tiempo);
    moverPajaros(tiempo);
    actualizarSonido();

    renderizador.clear();
    renderizador.render(escenaFondo, camaraFondo);
    renderizador.clearDepth();
    if (!soloFondo) renderizador.render(escena, camara);

    revisarRendimiento();
}

new THREE.TextureLoader().loadAsync("capas/castillo.webp")
    .then((textura) => {
        crearFondo(textura);
        colocarCamara();
        actualizarTrozos(true);
        document.getElementById("cargando").classList.add("oculta");
        animar();
    })
    .catch((error) => {
        document.getElementById("cargando").textContent = "No se pudieron cargar las imágenes.";
        console.error(error);
    });
