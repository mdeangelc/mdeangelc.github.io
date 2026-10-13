import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { PaseBrillo, crearAcabado, crearZumbido } from "./cine.js?v=2";

// =====================================================================
// 1. AJUSTES GENERALES
// El camino rehecho al estilo de Gargantua: de noche y con
// aspecto de película. Una luna baja a un lado alumbra el camino y deja
// sombras largas de los árboles y las farolas. Hay charcos que reflejan
// la luna y las farolas, bancos de niebla, luciérnagas, polillas, hojas
// que caen, murciélagos y, de vez en cuando, un ciervo que cruza. A lo
// lejos, a la izquierda, asoma Gargantua tras las montañas.
// Opciones en la dirección:
//   ?sinentrada      -> sin la entrada (la luna ya arriba)
//   ?ciervo=si       -> el ciervo cruza enseguida
//   ?entrada=2       -> congela la entrada en ese segundo (para ajustarla)
//   ?metros=120      -> empieza más adelante en el camino
//   ?calidad=baja    -> modo ligero: menos hierba, sin desenfoque ni rayos
//   ?fps=si          -> contador de fotogramas
//   ?tocar=no        -> la hierba no reacciona al ratón
//   ?fondo=solo      -> solo el fondo, sin la escena 3D (para ajustarlo)
//   ?desde=gargantua -> se llega desde Gargantua: se abre desde negro
//   ?dentro=si       -> abierto dentro de Gargantua: volver lo cierra
// =====================================================================

const parametros = new URLSearchParams(location.search);

// Si se llega volando desde Gargantua, la pantalla sigue en negro y se
// abre despacio, como si se saliera del planeta
if (parametros.get("desde") === "gargantua") document.body.classList.add("desde-gargantua");

// Abierto dentro de Gargantua (sin cambiar de página): el botón de volver
// le avisa para que cierre el camino y vuelva a enseñarse
if (parametros.get("dentro") === "si" && window.parent !== window) {
    document.querySelector(".volver").addEventListener("click", (e) => {
        e.preventDefault();
        window.parent.postMessage("volver-gargantua", "*");
    });
}
const movil = window.innerWidth < 760 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tocarHierba = parametros.get("tocar") !== "no";
// Modo ligero: móviles con poca memoria o pocos núcleos, o ?calidad=baja.
// Sin el paso de cine (desenfoque y rayos de luna) y sombras más pequeñas
const ligero = parametros.get("calidad") === "baja" || (movil && ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4));
const factorCalidad = (parametros.get("calidad") === "baja" ? 0.4 : 1) * (movil ? 0.32 : 1);

// Carteles del portfolio a lo largo del camino (?carteles=no para quitarlos).
// Cada uno salta al pasar por su metro y se cierra al seguir andando.
const conCarteles = parametros.get("carteles") !== "no";
const CARTELES = [
    { metro: 14, id: "cartel-sobre-mi" },
    { metro: 40, id: "cartel-habilidades" },
    { metro: 68, id: "cartel-formacion" },
    { metro: 96, id: "cartel-contacto" }
];

// El final del camino: un mirador desde el que se ve Gargantua grande
const FIN = 130;

// Largo de cada trozo del mundo (en metros)
const LARGO_TROZO = 25;

const ajustes = {
    hierba: Math.floor(150000 * factorCalidad),
    largoHierba: 70,
    anchoHierba: 26,
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
// El camino serpentea entre prados y bosques y no se acaba nunca. Cada 150 m
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

    // Ruido fino por píxel para desvanecer lo que está lejos
    float tramado(vec2 pixel) {
        return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    }

    float ruido(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    // Dónde está el farol de la farola del trozo de un punto
    vec3 posFarola(vec3 p) {
        float i = floor(-p.z / ${LARGO_TROZO.toFixed(1)});
        float zf = -(i + 0.5) * ${LARGO_TROZO.toFixed(1)};
        float lado = mod(i, 2.0) < 0.5 ? 1.0 : -1.0;
        float x = caminoX(zf) + lado * ${(SEPARACION_FAROLA - BRAZO_FAROLA).toFixed(2)};
        return vec3(x, alturaTerreno(x, zf) + 2.2, zf);
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
// =====================================================================

let renderizador;
try {
    renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
} catch (error) {
    // Sin 3D: una imagen fija del camino y los carteles uno debajo de otro
    document.body.classList.add("sin-3d");
    document.getElementById("cargando").classList.add("oculta");
    throw error;
}

renderizador.autoClear = false;
renderizador.outputColorSpace = THREE.SRGBColorSpace;
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = movil ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
document.body.prepend(renderizador.domElement);
renderizador.domElement.setAttribute("role", "img");
renderizador.domElement.setAttribute("aria-label", "Camino empedrado de noche, entre árboles y farolas, iluminado por una luna baja");

// Resolución: empieza a la del aparato (con tope) y, si aun quitando
// hierba no llega, se baja un poco (ver "17. RENDIMIENTO")
let resolucion = Math.min(window.devicePixelRatio || 1, 1.25);

function aplicarResolucion() {
    renderizador.setPixelRatio(resolucion);
    renderizador.setSize(window.innerWidth, window.innerHeight);
}
aplicarResolucion();

// =====================================================================
// 4. LA PALETA DE LA NOCHE
// Todos los colores de la escena y la fuerza de las luces. Los números
// se quedan como están y los textos se convierten en colores.
// =====================================================================

const actual = Object.fromEntries(Object.entries({
    noche: 1, fuerzaLuna: 1.25, fuerzaCielo: 0.55,
    niebla: "#141a2e", tierra: "#0c1416", tierraClara: "#16242a",
    hierbaBase: "#060c0e", hierbaPunta: "#34505a", luz: "#b4c6ee", ambiente: "#222c50",
    piedra: "#5c6278", juntas: "#0c0e16", barro: "#161a20", musgo: "#16282a",
    reflejoAlto: "#0a1024", reflejoBajo: "#3a4a78",
    cieloAlto: "#02040c", cieloMedio: "#081026", cieloBajo: "#1a2646",
    nubeLuz: "#8a98c0", nubeMedia: "#3a466e", nubeSombra: "#141a34",
    montanaLejos: "#151c3a", montanaCerca: "#0e1428", nieve: "#3a4262",
    bosqueLejos: "#0a0f1e", bosqueCerca: "#060912"
}).map(([n, v]) => [n, typeof v === "number" ? v : new THREE.Color(v)]));

const comunes = {
    uTiempo: { value: 0 },
    uCamara: { value: new THREE.Vector3() },
    uNiebla: { value: actual.niebla },
    uLuz: { value: actual.luz },
    uAmbiente: { value: actual.ambiente },
    uNoche: { value: actual.noche },
    uRaton: { value: new THREE.Vector2(999, 999) },
    uFuerzaRaton: { value: 0 },
    uViento: { value: movimientoReducido ? 0.25 : 1 },
    uClaros: { value: Array.from({ length: 8 }, () => new THREE.Vector3(9999, 9999, 1)) },
    uLuzLuna: { value: new THREE.Color(0, 0, 0) },
    uParpadeo: { value: 1 },
    uMapaSombra: { value: null },
    uMatrizSombra: { value: new THREE.Matrix4() },
    uConSombra: { value: 0 },
    uTamSombra: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uDirLuna: { value: new THREE.Vector3(0.5, 0.3, -0.8).normalize() },
    uDirLunaVista: { value: new THREE.Vector3(0.5, 0.3, -0.8).normalize() }
};

// Sombras de la luna en el suelo y la hierba (los árboles y objetos las
// reciben solos con three.js). Se lee el mapa de sombras de la luz.
const sombraGLSL = `
    #include <packing>
    uniform sampler2D uMapaSombra;
    uniform mat4 uMatrizSombra;
    uniform float uConSombra;
    uniform vec2 uTamSombra;
    float profundidadSombra(vec2 uv) {
        return unpackRGBAToDepth(texture2D(uMapaSombra, uv));
    }
    // 1 = le da la luna, 0 = en sombra. Con "suave" mira 5 puntos
    float sombraEn(vec3 p, bool suave) {
        if (uConSombra < 0.5) return 1.0;
        vec4 c = uMatrizSombra * vec4(p, 1.0);
        vec3 q = c.xyz / c.w;
        if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
        float z = q.z - 0.0012;
        float s = step(z, profundidadSombra(q.xy));
        if (suave) {
            vec2 t = uTamSombra * 1.3;
            s += step(z, profundidadSombra(q.xy + vec2(t.x, t.y)));
            s += step(z, profundidadSombra(q.xy + vec2(-t.x, t.y)));
            s += step(z, profundidadSombra(q.xy + vec2(t.x, -t.y)));
            s += step(z, profundidadSombra(q.xy - t));
            s /= 5.0;
        }
        return s;
    }
`;

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
// cielo por bandas, estrellas y Vía Láctea, la luna, dos cordilleras,
// nubes y dos colinas con bosque.
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

// La luna: dónde sale en el marco (x, y, radio) y hacia dónde queda en
// el mundo. Se coloca a la derecha y baja, y desde ahí se calcula la
// dirección de su luz (ver ajustarEncuadre)
const luna = new THREE.Vector3(1.4, 0.58, 0.05);
const DIR_LUNA = new THREE.Vector3(0.5, 0.3, -0.8).normalize();
// Gargantua, el agujero negro de la portada, a lo lejos a la izquierda
const gargantua = new THREE.Vector3(0.6, 0.66, 0.026);
const gargantuaBase = new THREE.Vector3();
const gargantuaFinal = new THREE.Vector3();

const escenaFondo = new THREE.Scene();
const camaraFondo = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const visible = new THREE.Vector2(1, 1);
const desplazamientoRaton = new THREE.Vector2();

const uniformesFondo = {
    uVisible: { value: visible },
    uRatonFondo: { value: desplazamientoRaton },
    uProgreso: { value: 0 },
    uTiempo: comunes.uTiempo,
    uNoche: comunes.uNoche,
    uNiebla: comunes.uNiebla,
    uAspectoMarco: { value: aspectoMarco },
    uLinea: { value: 1 - HORIZONTE_EN_MARCO },
    uLuna: { value: luna },
    uInvProy: { value: new THREE.Matrix4() },
    uGiroCamara: { value: new THREE.Matrix3() },
    uBase: { value: new THREE.Matrix3() },
    uTanMedio: { value: new THREE.Vector2(1, 1) },
    uCamPos: { value: new THREE.Vector3() },
    uInicio: { value: new THREE.Vector3() },
    uGargantua: { value: gargantua },
    uAmanecer: { value: 0 },
    uSubida: { value: 1 },
    uFugaz: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFugazT: { value: -1 }
};
["cieloAlto", "cieloMedio", "cieloBajo", "nubeLuz", "nubeMedia", "nubeSombra", "montanaLejos", "montanaCerca", "nieve", "bosqueLejos", "bosqueCerca"].forEach((n) => {
    uniformesFondo["u" + n[0].toUpperCase() + n.slice(1)] = { value: actual[n] };
});

const fragmentFondo = `
    uniform vec2 uVisible;
    uniform vec2 uRatonFondo;
    uniform float uProgreso;
    uniform float uTiempo;
    uniform float uNoche;
    uniform vec3 uNiebla;
    uniform float uAspectoMarco;
    uniform float uLinea;
    uniform vec3 uCieloAlto;
    uniform vec3 uCieloMedio;
    uniform vec3 uCieloBajo;
    uniform vec3 uNubeLuz;
    uniform vec3 uNubeMedia;
    uniform vec3 uNubeSombra;
    uniform vec3 uMontanaLejos;
    uniform vec3 uMontanaCerca;
    uniform vec3 uNieve;
    uniform vec3 uBosqueLejos;
    uniform vec3 uBosqueCerca;
    uniform vec3 uLuna;
    uniform mat4 uInvProy;
    uniform mat3 uGiroCamara;
    uniform mat3 uBase;
    uniform vec2 uTanMedio;
    uniform vec3 uCamPos;
    uniform vec3 uInicio;
    uniform vec3 uGargantua;
    uniform float uAmanecer;
    uniform float uSubida;
    uniform vec4 uFugaz;
    uniform float uFugazT;
    varying vec2 vUv;

    float hash(vec2 p) {
        // Sin senos: con números grandes el seno pierde precisión en la
        // tarjeta gráfica y las estrellas salían en un enrejado
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
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

    // Ruido fino por píxel
    float tramado() {
        return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    }

    // Montañas y colinas en 3D de verdad: cada fila es un plano de pie a su
    // distancia del principio del camino. Se busca dónde corta el rayo del
    // píxel (desde donde está la cámara ahora) y ese punto se lleva al
    // dibujo tal y como se ve desde el principio. Así al andar las colinas
    // cercanas crecen y se mueven más que las montañas lejanas.
    vec2 enPlano(vec3 dm, float distancia) {
        float zPlano = uInicio.z - distancia;
        float t = (zPlano - uCamPos.z) / min(dm.z, -0.0001);
        vec3 rel = uBase * (uCamPos + dm * t - uInicio);
        vec2 b = rel.xy / max(-rel.z, 0.05) / uTanMedio * 0.5 + 0.5;
        vec2 m = (b - 0.5) * uVisible + 0.5;
        return vec2(m.x * uAspectoMarco, m.y);
    }

    // Coordenadas del marco para una capa con su paralaje y su zoom al caminar
    vec2 enCapa(vec2 marco, float paralaje, float zoom) {
        marco += uRatonFondo * vec2(paralaje, paralaje * 0.5);
        vec2 centro = vec2(0.5, uLinea);
        marco = (marco - centro) / (1.0 + zoom * uProgreso) + centro;
        return vec2(marco.x * uAspectoMarco, marco.y);
    }

    // Centro de la luna: quieta en el cielo; al entrar la tapan nubes
    // que se van abriendo
    vec2 centroLuna() {
        return uLuna.xy;
    }

    // Cuánto ilumina la luna un punto del fondo (para nubes y crestas)
    float luzLuna(vec2 f) {
        vec2 g = (f - centroLuna()) * vec2(0.9, 1.3);
        return exp(-length(g) / 0.32) * uSubida;
    }

    vec3 cielo(vec2 f, float t) {
        float alto = clamp((f.y - uLinea) / (1.0 - uLinea), 0.0, 1.0);
        vec3 c = alto < 0.3 ? mix(uCieloBajo, uCieloMedio, alto / 0.3) : mix(uCieloMedio, uCieloAlto, (alto - 0.3) / 0.7);

        // Estrellas: puntos redondos y suaves que titilan
        vec2 rejilla = f * 260.0;
        vec2 celda = floor(rejilla);
        float h = hash(celda);
        vec2 centro = vec2(hash(celda + 7.1), hash(celda + 3.3)) * 0.6 + 0.2;
        float punto = smoothstep(0.32, 0.0, length(fract(rejilla) - centro));
        float estrella = step(0.993, h) * punto * (0.55 + 0.45 * sin(uTiempo * 2.0 + hash(celda + 3.0) * 30.0)) * (0.5 + 2.0 * pow(hash(celda + 9.0), 6.0));
        estrella *= smoothstep(0.1, 0.45, alto) * (1.0 - uAmanecer * 0.55);
        // Al final del camino empieza a clarear por el horizonte
        c += vec3(0.62, 0.34, 0.3) * exp(-alto / 0.22) * uAmanecer * 0.32 + vec3(0.05, 0.06, 0.1) * uAmanecer;
        c += vec3(0.85, 0.9, 1.0) * estrella * (1.0 - luzLuna(f) * 0.7);

        return c;
    }

    // Nubes: ruido estirado en horizontal; la luz depende de hacia dónde está la luna
    vec4 nubes(vec2 f, float t, float semilla, float desde, float hasta, float umbral, float estirar) {
        vec2 p = vec2(f.x * estirar + uTiempo * 0.004 + semilla, f.y * estirar * 3.2 + semilla * 3.0);
        float banda = smoothstep(desde, desde + 0.08, f.y) * (1.0 - smoothstep(hasta - 0.1, hasta, f.y));
        float n = fbm(p) * banda;
        if (n < umbral) return vec4(0.0);
        vec2 haciaLuna = normalize(centroLuna() - f + 0.0001) * 0.02;
        float n2 = fbm(p + vec2(haciaLuna.x * estirar, haciaLuna.y * estirar * 3.2)) * banda;
        float abajo = fbm(p - vec2(0.0, 0.035 * estirar * 3.2)) * banda;
        float luz = clamp((n - n2) * 14.0 + 0.62, 0.0, 1.0);
        luz = max(luz, (1.0 - smoothstep(umbral - 0.02, umbral + 0.03, abajo)) * 0.95);
        luz = mix(luz, 0.55, smoothstep(umbral + 0.08, umbral + 0.2, n) * 0.5);
        float q = clamp(luz, 0.0, 1.0);
        vec3 c = q < 0.5 ? mix(uNubeSombra, uNubeMedia, q * 2.0) : mix(uNubeMedia, uNubeLuz, q * 2.0 - 1.0);
        return vec4(c, smoothstep(umbral, umbral + 0.12, n) * 0.75);
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
        float ladoLuz = 1.0;
        vec2 pr = vec2(f.x * frecuencia * 7.0 + f.y * 9.0, f.y * frecuencia * 4.0 + semilla);
        float gx = relieve(pr + vec2(0.04, 0.0)) - relieve(pr - vec2(0.04, 0.0));
        float porRelieve = clamp(-gx * ladoLuz * 5.0 + 0.5, 0.0, 1.0);
        float porCresta = clamp(-pendiente * ladoLuz * 0.8 + 0.5, 0.0, 1.0);
        float iluminada = mix(porCresta, porRelieve, smoothstep(0.0, 0.05, h - f.y));
        float q = smoothstep(0.0, 1.0, iluminada);
        vec3 sombra = mix(color * 0.72, uCieloAlto, 0.2);
        vec3 luz = color * 1.12;
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
        float luz = clamp(ladoPino * 0.9 + 0.45, 0.0, 1.0);
        vec3 c = mix(color * 0.8, color * 1.25, luz);
        float casa = step(0.965, hash(vec2(floor(f.x * 140.0), semilla + 9.0))) * step(0.006, arriba - f.y) * step(f.y, suelo - 0.004) * step(suelo - 0.012, f.y);
        c = mix(c, vec3(1.0, 0.72, 0.38), casa * uNoche);
        c = mix(c, uCieloBajo, aire);
        return vec4(c, 1.0);
    }

    // La luna, baja y grande: mares oscuros, borde un poco apagado y un
    // halo que aclara el cielo de alrededor
    vec3 dibujarLuna(vec3 c, vec2 f) {
        vec2 centro = centroLuna();
        vec2 d = (f - centro) / uLuna.z;
        float r = length(d);
        c += vec3(0.45, 0.55, 0.8) * exp(-max(r - 1.0, 0.0) * 0.55) * 0.07 + vec3(0.7, 0.75, 0.9) * exp(-max(r - 1.0, 0.0) * 3.0) * 0.16;
        // Un anillo de halo muy suave, como cuando hay humedad en el aire
        c += vec3(0.6, 0.66, 0.8) * exp(-pow((r - 6.5) / 0.7, 2.0)) * 0.018 * uSubida;
        float borde = fwidth(r) * 1.5;
        float disco = smoothstep(1.0 + borde, 1.0 - borde, r);
        if (disco <= 0.0) return c;
        vec2 q = d * 2.2 + vec2(3.0, 1.0);
        float mares = smoothstep(0.45, 0.7, ruido(q) * 0.6 + ruido(q * 2.3 + 5.0) * 0.4);
        float crateres = smoothstep(0.75, 0.9, ruido(d * 9.0 + 2.0)) * 0.25;
        float limbo = sqrt(max(0.0, 1.0 - r * r));
        vec3 superficie = mix(vec3(1.0, 0.97, 0.9), vec3(0.6, 0.62, 0.68), mares * 0.7 + crateres) * (0.6 + 0.4 * limbo);
        superficie *= mix(vec3(1.0, 0.85, 0.7), vec3(1.0), smoothstep(uLinea, uLinea + 0.2, centro.y));
        return mix(c, superficie * 1.7, disco);
    }

    // Estrella fugaz: una raya que cruza el cielo en menos de un segundo,
    // con la cabeza brillante y la cola apagándose
    vec3 estrellaFugaz(vec3 c, vec2 f) {
        if (uFugazT < 0.0) return c;
        // Las derivadas se piden antes de cualquier salida para que todos
        // los píxeles vecinos las calculen igual
        float px = fwidth(f.y);
        vec2 cabeza = uFugaz.xy + uFugaz.zw * uFugazT;
        vec2 dir = normalize(uFugaz.zw);
        vec2 d = f - cabeza;
        float atras = -dot(d, dir);
        float largo = 0.12 * sin(uFugazT * 3.1416);
        if (atras < -0.03 || atras > largo + 0.03) return c;
        float lado = abs(d.x * dir.y - d.y * dir.x);
        float cola = 1.0 - clamp(atras / max(largo, 0.001), 0.0, 1.0);
        float raya = smoothstep(px * 1.6, 0.0, lado) * cola * cola;
        // Se queda por debajo del umbral del resplandor y del destello de
        // lente para que no deje rayas horizontales; lleva su propio brillo
        // suave en la cabeza
        float fuerza = sin(uFugazT * 3.1416);
        float halo = exp(-length(d) / 0.006) * 0.25;
        return min(c + vec3(0.85, 0.92, 1.0) * (raya * 1.8 + halo) * fuerza, vec3(0.58));
    }

    // Nubes finas que pasan por delante de la luna, oscuras y con el
    // borde plateado donde les da su luz. Al entrar son espesas y la tapan;
    // se van abriendo y la luna aparece
    vec3 nubesLuna(vec3 c, vec2 f) {
        float cubre = 1.0 - uSubida;
        vec2 centro = centroLuna();
        vec2 q = (f - centro) / uLuna.z;
        if (abs(q.y) > 3.0 || abs(q.x) > 9.0) return c;
        vec2 p = vec2(q.x * 0.28 - uTiempo * 0.05, q.y * 0.9);
        float n = fbm(p + vec2(3.0, 7.0)) * 0.7 + fbm(p * 2.3 + 11.0) * 0.3;
        float banda = smoothstep(3.0, 1.2, abs(q.y + 0.4)) * smoothstep(9.0, 5.0, abs(q.x));
        banda = max(banda, cubre * smoothstep(3.0, 1.4, length(q * vec2(0.4, 1.0))));
        float umbral = 0.5 - cubre * 0.2;
        float nube = smoothstep(umbral, umbral + 0.18, n) * banda;
        if (nube <= 0.0) return c;
        float r = length(q);
        float borde = smoothstep(umbral, umbral + 0.06, n) - smoothstep(umbral + 0.06, umbral + 0.16, n);
        vec3 color = vec3(0.05, 0.06, 0.1) + vec3(0.75, 0.8, 0.95) * borde * exp(-max(r - 1.0, 0.0) * 0.8) * 1.4;
        color += vec3(0.25, 0.28, 0.36) * exp(-r * 0.6) * 0.5;
        return mix(c, color, nube * (0.9 + cubre * 0.08));
    }

    // La Vía Láctea: una banda en diagonal con polvo oscuro en medio y
    // más estrellas dentro
    vec3 viaLactea(vec3 c, vec2 f, float alto) {
        vec2 n = normalize(vec2(-0.55, 1.0));
        float dist = dot(f - vec2(0.55, 0.62), n);
        float banda = exp(-dist * dist / 0.018);
        if (banda < 0.01) return c;
        float nubesV = fbm(f * 5.0 + 3.0);
        float polvo = smoothstep(0.45, 0.7, fbm(f * vec2(9.0, 14.0) + 7.0)) * exp(-dist * dist / 0.003);
        vec3 color = mix(vec3(0.3, 0.38, 0.62), vec3(0.75, 0.68, 0.6), exp(-dist * dist / 0.004));
        float fuerza = banda * (0.35 + 0.9 * smoothstep(0.35, 0.75, nubesV)) * (1.0 - polvo * 0.85);
        fuerza *= smoothstep(0.05, 0.35, alto) * (1.0 - luzLuna(f) * 0.8);
        vec2 rejilla = f * 420.0;
        vec2 celda = floor(rejilla);
        float h = hash(celda + 31.0);
        float punto = smoothstep(0.35, 0.0, length(fract(rejilla) - 0.5 - (vec2(hash(celda + 2.0), hash(celda + 6.0)) - 0.5) * 0.5));
        c += vec3(0.85, 0.9, 1.0) * step(1.0 - 0.06 * banda, h) * punto * 0.7 * smoothstep(0.05, 0.35, alto);
        return c + color * fuerza * 0.11;
    }

    // Gargantua a lo lejos, a la izquierda: el agujero negro de la
    // portada, pequeño y medio escondido tras las montañas. Se ve su
    // sombra negra, el anillo de luz, el arco del disco que se curva por
    // encima y el disco plano cruzando por delante
    float luzGargantua(vec2 f) {
        vec2 g = (f - uGargantua.xy) * vec2(0.55, 1.0);
        float tam = uGargantua.z / 0.028;
        return exp(-length(g) / (0.16 * tam)) * min(tam, 1.8);
    }

    vec3 gargantuaLejos(vec3 c, vec2 f) {
        vec2 d = (f - uGargantua.xy) / uGargantua.z;
        float r = length(d);
        float px = fwidth(r) * 1.2;
        if (abs(d.x) > 14.0 || abs(d.y) > 9.0) return c;
        vec3 calido = vec3(1.0, 0.68, 0.36);
        // Halo que aclara el cielo de alrededor
        c += calido * (exp(-max(r - 1.0, 0.0) * 0.45) * 0.05 + exp(-max(r - 1.0, 0.0) * 1.6) * 0.12);
        // La sombra tapa estrellas y halo
        c = mix(c, vec3(0.0), smoothstep(1.0 + px, 1.0 - px, r));
        // Anillo de fotones, fino y muy brillante
        c += vec3(1.0, 0.86, 0.66) * exp(-pow((r - 1.07) / max(0.05, px), 2.0)) * 0.7;
        // Arco del disco curvado por la gravedad: rodea la sombra por arriba
        float ang = atan(d.y, d.x);
        float arco = exp(-pow((r - 1.45) / 0.32, 2.0)) * smoothstep(-0.55, 0.35, d.y / r);
        float vetas = 0.75 + 0.25 * sin(r * 26.0 + ang * 2.0);
        float lado = 1.0 + 0.45 * clamp(-d.x / 1.6, -1.0, 1.0);
        c += calido * arco * vetas * lado * 0.65;
        // Disco plano por delante, un poco inclinado
        vec2 e = vec2(d.x, (d.y + d.x * 0.08 + 0.12) * 7.5);
        float re = length(e);
        float disco = smoothstep(1.25, 1.8, re) * exp(-max(re - 2.0, 0.0) * 0.35) * smoothstep(13.0, 8.0, re);
        float brillo = (0.7 + 0.3 * sin(re * 3.4)) * (1.0 + 0.5 * clamp(-d.x / 6.0, -1.0, 1.0));
        float delante = step(0.0, -(d.y + d.x * 0.08 + 0.12)) + step(1.0, r);
        c += calido * disco * brillo * 0.55 * min(delante, 1.0);
        return min(c, vec3(0.8));
    }

    void main() {
        float t = tramado();
        // El cielo está fijo en el mundo: se calcula hacia dónde mira cada
        // píxel y se lleva a la vista de partida de la cámara. Así al girar
        // o mirar con el ratón el cielo se queda en su sitio, como las
        // montañas de verdad, y no se mueve pegado a la pantalla
        vec4 v = uInvProy * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dm = uGiroCamara * normalize(v.xyz / v.w);
        vec3 dir = uBase * dm;
        vec2 enBase = dir.xy / max(-dir.z, 0.05) / uTanMedio * 0.5 + 0.5;
        vec2 marco = (enBase - 0.5) * uVisible + 0.5;
        // Muy por debajo del horizonte todo lo tapa el suelo 3D
        if (marco.y < uLinea - 0.09) {
            gl_FragColor = vec4(uNiebla, 1.0);
            #include <colorspace_fragment>
            return;
        }

        vec2 fc = enCapa(marco, 0.0, 0.0);
        vec3 c = cielo(fc, t);
        c = viaLactea(c, fc, clamp((fc.y - uLinea) / (1.0 - uLinea), 0.0, 1.0));
        vec2 fl = fc;
        c = estrellaFugaz(c, fc);
        vec2 fg = fc;
        c = gargantuaLejos(c, fg);
        c = dibujarLuna(c, fl);
        c = nubesLuna(c, fl);
        float luz = luzLuna(fl);

        vec4 capa = montana(enPlano(dm, 2600.0), t, 3.0, 0.03, 0.62, 1.25, uMontanaLejos, 0.16, 0.24);
        c = mix(c, capa.rgb, capa.a);

        capa = nubes(enPlano(dm, 1900.0), t, 7.0, uLinea + 0.1, uLinea + 0.3, 0.58, 2.2);
        c = mix(c, capa.rgb + vec3(0.6, 0.66, 0.85) * luz * 0.35 + vec3(1.0, 0.6, 0.3) * luzGargantua(fg) * 0.22, capa.a);

        capa = montana(enPlano(dm, 1100.0), t, 11.0, 0.0, 0.36, 2.0, uMontanaCerca, 0.05, 0.19);
        c = mix(c, capa.rgb, capa.a);

        capa = colina(enPlano(dm, 420.0), t, 21.0, 0.0, 0.05, 0.012, uBosqueLejos, 0.18);
        c = mix(c, capa.rgb, capa.a);

        capa = colina(enPlano(dm, 260.0), t, 33.0, -0.015, 0.045, 0.02, uBosqueCerca, 0.0);
        c = mix(c, capa.rgb, capa.a);

        c += vec3(0.5, 0.56, 0.75) * luz * 0.04;
        c += vec3(1.0, 0.62, 0.32) * luzGargantua(fg) * 0.035;
        c += vec3(0.5, 0.3, 0.3) * uAmanecer * 0.06 * (1.0 - smoothstep(0.0, 0.25, marco.y - uLinea));

        float sobre = marco.y - uLinea;
        float franjas = ruido(vec2(marco.x * 7.0 + uTiempo * 0.012, marco.y * 34.0)) * 0.7 + ruido(vec2(marco.x * 20.0 - uTiempo * 0.02, marco.y * 70.0)) * 0.3;
        float bruma = (1.0 - smoothstep(0.0, 0.07 + franjas * 0.08, sobre)) * 0.85;
        c = mix(c, uNiebla, bruma);

        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
    }
`;

let materialFondo = null;

// El fondo es lo que más cuesta por píxel, así que se pinta dentro de la
// escena, al final de lo opaco y pegado al fondo de la profundidad: solo
// se calcula donde no hay árboles, suelo ni hierba delante. Lo
// transparente (niebla, luciérnagas...) se pinta después, por encima.
function crearFondo() {
    materialFondo = new THREE.ShaderMaterial({
        depthTest: true,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
        uniforms: uniformesFondo,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 1.0, 1.0);
            }
        `,
        fragmentShader: fragmentFondo
    });
    const plano = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), materialFondo);
    plano.frustumCulled = false;
    plano.renderOrder = 100000;
    if (soloFondo) escenaFondo.add(plano);
    else escena.add(plano);
}

function actualizarFondo(metros) {
    uniformesFondo.uProgreso.value = 1 - Math.exp(-metros / 700);
}

// =====================================================================
// 5b. LA ENTRADA Y LA LUZ DE LA LUNA
// Al cargar, la luna está tapada por nubes que se van abriendo. Su luz en 3D sale de
// donde se ve en el fondo: cada fotograma se pasa a los shaders su
// dirección (en el mundo y vista desde la cámara) y su fuerza.
// =====================================================================

const contextoGl = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && !!(contextoGl.getExtension("EXT_color_buffer_float") || contextoGl.getExtension("EXT_color_buffer_half_float"));
const entrada = { t: movimientoReducido || parametros.has("sinentrada") ? 10 : 0, inicio: performance.now() };

function moverEntrada() {
    entrada.t = entrada.t >= 10 ? 10 : (performance.now() - entrada.inicio) / 1000;
    if (parametros.has("entrada")) entrada.t = parseFloat(parametros.get("entrada"));
    uniformesFondo.uSubida.value = THREE.MathUtils.smoothstep(entrada.t, 0.2, 6);
}

// Estrellas fugaces: de vez en cuando una cruza el cielo
const fugaz = { espera: 6, t: -1 };

function moverFugaz(delta) {
    const u = uniformesFondo;
    if (movimientoReducido) return;
    if (fugaz.t < 0) {
        fugaz.espera -= delta;
        if (fugaz.espera <= 0) {
            fugaz.t = 0;
            const x = 0.2 + Math.random() * 1.2;
            const y = 0.8 + Math.random() * 0.15;
            const ang = -0.5 - Math.random() * 0.6;
            const sentido = Math.random() < 0.5 ? -1 : 1;
            u.uFugaz.value.set(x, y, Math.cos(ang) * 0.35 * sentido, Math.sin(ang) * 0.35);
        }
    } else {
        fugaz.t += delta / 0.8;
        if (fugaz.t >= 1) {
            fugaz.t = -1;
            fugaz.espera = 8 + Math.random() * 14;
        }
    }
    u.uFugazT.value = fugaz.t;
}

const pantallaLuna = new THREE.Vector3();
const auxLuna = new THREE.Vector3();

function luzDeLaLuna() {
    camara.updateMatrixWorld();
    const subida = uniformesFondo.uSubida.value;
    // Mientras sale la luna la escena ya se ve un poco, no a oscuras
    const luz = 0.35 + 0.65 * subida;
    comunes.uDirLuna.value.copy(DIR_LUNA);
    comunes.uDirLunaVista.value.copy(DIR_LUNA).transformDirection(camara.matrixWorldInverse);
    comunes.uLuzLuna.value.setRGB(0.62, 0.72, 1.0).multiplyScalar(luz);
    pantallaLuna.copy(camara.position).addScaledVector(DIR_LUNA, 100).project(camara);
    paseCine.uniforms.uCentro.value.set(pantallaLuna.x * 0.5 + 0.5, pantallaLuna.y * 0.5 + 0.5);
    const uf = uniformesFondo;
    uf.uInvProy.value.copy(camara.projectionMatrixInverse);
    uf.uGiroCamara.value.setFromMatrix4(camara.matrixWorld);
    uf.uCamPos.value.copy(camara.position);
    uf.uInicio.value.set(caminoX(0) * 0.92, ajustes.alturaOjos + alturaPuente(0), 0);
    paseCine.uniforms.uHorizonte.value = (1 - HORIZONTE_EN_MARCO - 0.5) / visible.y + 0.5;
    paseCine.uniforms.uFuerza.value = subida;
    const adelante = auxLuna.set(0, 0, -1).transformDirection(camara.matrixWorld);
    hierba.material.uniforms.uAdelante.value.set(adelante.x, adelante.z).normalize();
    hierba.material.uniforms.uTanMedio.value = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)) * camara.aspect * 1.08;
    luzLunar.intensity = actual.fuerzaLuna * luz;

    // La caja de sombras, delante de la cámara y pegada a una rejilla
    // para que los bordes de las sombras no tiemblen al andar
    const centro = auxLuna.set(camara.position.x + adelante.x * 14, 0, camara.position.z + adelante.z * 14);
    centro.x = Math.round(centro.x / 0.25) * 0.25;
    centro.z = Math.round(centro.z / 0.25) * 0.25;
    centro.y = alturaTerreno(centro.x, centro.z);
    luzLunar.target.position.copy(centro);
    luzLunar.position.copy(centro).addScaledVector(DIR_LUNA, 80);
    if (luzLunar.shadow.map && luzLunar.castShadow) {
        comunes.uMapaSombra.value = luzLunar.shadow.map.texture;
        comunes.uConSombra.value = 1;
    }
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

    // La luna: a la derecha, a una altura fija del fondo para que quede
    // por encima de las montañas, y siempre dentro de la pantalla (en el
    // móvil en vertical, más al centro)
    const lunaX = aspecto < 0.8 ? 0.7 : 0.8;
    const lunaY = Math.min(0.88, (0.79 - 0.5) / visible.y + 0.5);
    luna.set(((lunaX - 0.5) * visible.x + 0.5) * aspectoMarco, (lunaY - 0.5) * visible.y + 0.5, aspecto < 0.8 ? 0.06 : 0.055);
    const gargantuaX = aspecto < 0.8 ? 0.3 : 0.4;
    gargantuaBase.set(((gargantuaX - 0.5) * visible.x + 0.5) * aspectoMarco, 0.655, aspecto < 0.8 ? 0.032 : 0.028);
    gargantuaFinal.set(((aspecto < 0.8 ? 0.27 : 0.47) - 0.5) * visible.x * aspectoMarco + 0.5 * aspectoMarco, aspecto < 0.8 ? 0.765 : 0.74, aspecto < 0.8 ? 0.05 : 0.085);
    gargantua.copy(gargantuaBase);
    const mitad = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
    // La vista de partida (sin girar y con la inclinación de siempre): el
    // cielo se dibuja tal cual se ve desde ahí y queda fijo en el mundo
    uniformesFondo.uTanMedio.value.set(mitad * aspecto, mitad);
    uniformesFondo.uBase.value.setFromMatrix4(new THREE.Matrix4().makeRotationX(inclinacion)).transpose();
    DIR_LUNA.set((lunaX * 2 - 1) * mitad * aspecto, (lunaY * 2 - 1) * mitad, -1).normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0), inclinacion);
    // La luz se gira un poco más hacia el lado y se baja: así las sombras
    // de los árboles cruzan el camino en vez de ir hacia la cámara
    DIR_LUNA.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.45);
    DIR_LUNA.y = 0.24;
    DIR_LUNA.normalize();
}

// La luna da sombras: su cámara de sombras es una caja que sigue a la
// cámara y cubre lo que hay delante
const luzLunar = new THREE.DirectionalLight("#b4c6ee", 1.25);
luzLunar.castShadow = true;
luzLunar.shadow.mapSize.setScalar(ligero ? 512 : movil ? 1024 : 2048);
Object.assign(luzLunar.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 160 });
luzLunar.shadow.bias = -0.0006;
luzLunar.shadow.normalBias = 0.05;
escena.add(luzLunar.target);
comunes.uMatrizSombra.value = luzLunar.shadow.matrix;
comunes.uTamSombra.value.setScalar(1 / luzLunar.shadow.mapSize.x);
const luzCielo = new THREE.HemisphereLight("#9a88d8", "#2a3a2a", 2.0);
escena.add(luzLunar, luzCielo);

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
    uniform vec3 uLuzLuna;
    uniform vec3 uDirLuna;
    uniform float uParpadeo;
    varying vec3 vMundo;
    ${terrenoGLSL}
    ${clarosGLSL}
    ${sombraGLSL}

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
        float grano = ruido(w * 7.0);
        vec3 color = pasto * (1.0 + (grano - 0.5) * 0.3 * detalle);

        // Tierra pisada junto al camino
        float borde = ${ANCHO_CAMINO.toFixed(2)} + (ruido(vec2(v * 0.9, u > 0.0 ? 7.0 : 3.0)) - 0.5) * 0.14;
        float finArcen = borde + 0.5 + ruido(w * 1.3) * 0.45;
        float arcen = 1.0 - smoothstep(borde + 0.1, finArcen, lado);
        vec3 barro = uBarro * (0.85 + grano * 0.3 * detalle);
        vec2 celdaG = floor(w * 9.0);
        float guijarro = step(0.93, hash(celdaG)) * smoothstep(0.32, 0.18, length(fract(w * 9.0) - 0.5)) * detalle;
        barro = mix(barro, uPiedra * 0.8, guijarro);
        color = mix(color, barro, arcen * 0.92);
        #ifndef PUENTE
        float pisado = 1.0 - enClaro(w);
        color = mix(color, mix(barro, pasto, ruido(w * 2.5) * 0.6), pisado * 0.85);
        #endif

        float mojado = 0.0;
        float charco = 0.0;
        // Relieve: cuánto mira cada punto hacia la luna (1 = suelo plano)
        float relieve = 1.0;
        vec3 normalPiedra = vec3(0.0, 1.0, 0.0);

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

                // Cada adoquín es una loma: cerca de la junta se inclina
                // hacia fuera y la cara que mira a la luna se ilumina
                float cercaJunta = 1.0 - smoothstep(0.02, 0.22, a.x);
                vec2 haciaFuera = normalize(-haciaCentro + 0.0001);
                normalPiedra = normalize(vec3(haciaFuera.x * cercaJunta * 1.4, 1.0, haciaFuera.y * cercaJunta * 1.4));
                float plano = max(uDirLuna.y, 0.15);
                relieve = mix(1.0, clamp(dot(normalPiedra, uDirLuna) / plano, 0.15, 2.6), detalle * junta);
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
            charco = smoothstep(0.66, 0.68, forma) * zona * dentro;
            mojado = smoothstep(0.54, 0.66, forma) * zona * dentro;

            color = empedrado * (1.0 - mojado * 0.3);
        }

        // La hierba se come el borde del camino a trozos
        #ifndef PUENTE
        float invade = smoothstep(0.58, 0.72, ruido(vec2(v * 1.7, u * 2.4) + 40.0));
        invade *= smoothstep(borde - 0.5, borde + 0.05, lado) * (1.0 - smoothstep(borde + 0.4, borde + 0.8, lado));
        color = mix(color, pasto, invade);
        #endif

        // Hojas secas caídas por aquí y por allá
        vec2 enHoja = fract(w * 8.0) - 0.5;
        float formaHoja = smoothstep(0.3, 0.15, length(enHoja * vec2(1.0, 1.8)));
        float hoja = step(0.988, hash(floor(w * 8.0) + 3.7)) * step(0.45, ruido(w * 0.2)) * formaHoja * detalle;
        color = mix(color, mix(vec3(0.62, 0.26, 0.1), vec3(0.75, 0.48, 0.14), hash(floor(w * 8.0))), hoja * (1.0 - charco));

        // Luz de la luna (con sombras y relieve) y del cielo
        float alaLuna = sombraEn(vMundo + vec3(0.0, 0.04, 0.0), d < 45.0);
        color *= uAmbiente * 1.15 + uLuz * (0.08 + 0.92 * alaLuna) * relieve * 0.85;
        #ifdef PUENTE
        vec3 normal = normalize(cross(dFdx(vMundo), dFdy(vMundo)));
        if (abs(normal.y) < 0.6) color *= 0.55;
        #endif
        vec3 rayoVista = normalize(vMundo - cameraPosition);
        // Piedras mojadas: brillo de la luna en las lomas
        color += uLuzLuna * pow(max(dot(reflect(rayoVista, normalPiedra), uDirLuna), 0.0), 40.0) * (mojado - charco + 0.08) * alaLuna * 0.6 * detalle;

        // Charco: refleja el cielo, la luna (un reguero de luz que tiembla
        // con las ondas) y el farol de la farola más cercana
        if (charco > 0.0) {
            vec3 cielo = mix(uReflejoAlto, uReflejoBajo, smoothstep(2.0, 30.0, d));
            vec2 ondas = vec2(ruido(w * 4.0 + uTiempo * 0.6), ruido(w * 4.0 - uTiempo * 0.5 + 9.0)) - 0.5;
            vec3 R = reflect(rayoVista, normalize(vec3(ondas.x * 0.05, 1.0, ondas.y * 0.05)));
            float alaLunaR = max(dot(R, uDirLuna), 0.0);
            cielo += uLuzLuna * (pow(alaLunaR, 1500.0) * 8.0 + pow(alaLunaR, 80.0) * 0.6 + pow(alaLunaR, 8.0) * 0.06);
            // Las farolas de este tramo y de los dos de al lado, para que el
            // reflejo no salte al pasar de un tramo a otro
            float alFarol = 0.0;
            for (int k = -1; k <= 1; k++) {
                vec3 farol = posFarola(vMundo + vec3(0.0, 0.0, float(k) * ${LARGO_TROZO.toFixed(1)}));
                float r = max(dot(R, normalize(farol - vMundo)), 0.0);
                alFarol += pow(r, 600.0) * 6.0 + pow(r, 120.0) * 0.08;
            }
            cielo += vec3(1.0, 0.62, 0.3) * alFarol * uNoche * uParpadeo;
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
            float destello = step(0.95, hash(floor(w * 5.0) + floor(uTiempo * 3.0))) * smoothstep(0.35, 0.1, length(fract(w * 5.0) - 0.5));
            rio += destello * uReflejoBajo * 0.5;
            rio *= 1.0 - smoothstep(1.0, 1.5, dz) * 0.35;
            // La luna reflejada en el agua, rota en trozos por la corriente
            vec2 ondasA = vec2(ruido(vec2(vMundo.x * 1.2 - uTiempo * 1.1, vMundo.z * 4.0)), ruido(vec2(vMundo.x * 1.7 - uTiempo * 0.8, vMundo.z * 5.0) + 7.0)) - 0.5;
            vec3 Ra = reflect(rayoVista, normalize(vec3(ondasA.x * 0.14, 1.0, ondasA.y * 0.14)));
            float alaLunaA = max(dot(Ra, uDirLuna), 0.0);
            rio += uLuzLuna * (pow(alaLunaA, 300.0) * 5.0 + pow(alaLunaA, 30.0) * 0.35);
            color = mix(color, rio, agua);
        }
        #endif

        // Farolas encendidas por la noche
        color += vec3(1.0, 0.62, 0.3) * luzFarolas(vMundo) * uNoche * uParpadeo * (0.34 - charco * 0.22);

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
// El suelo se pinta después de la hierba, los árboles y las piedras: así
// la tarjeta gráfica se salta los trozos de suelo que quedan tapados, que
// son muchos y su shader es caro
suelo.renderOrder = 10;
escena.add(suelo);

// =====================================================================
// 8. HIERBA
// Briznas repetidas con "instancing" en una franja alrededor del
// camino. Cuando una brizna se queda atrás, el shader la vuelve a
// colocar delante (operación módulo), así nunca se acaba la hierba.
// Unas pocas crecen en el bordillo.
// =====================================================================

function crearHierba() {
    // Cada brizna son 5 vértices: dos tramos y la punta
    const brizna = new THREE.BufferGeometry();
    brizna.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 0.45, 0, 0.5, 0.45, 0, 0, 1, 0], 3));
    brizna.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);

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
        if (tipo < 0.045) {
            x = signo * entre(1.25, 1.6);
            alto *= 0.75;
        } else {
            x = signo * (1.5 + Math.pow(azar(), 1.7) * ajustes.anchoHierba);
        }
        posiciones[i * 2] = x;
        posiciones[i * 2 + 1] = azar() * ajustes.largoHierba;
        datos[i * 4] = azar() * Math.PI * 2;
        datos[i * 4 + 1] = alto;
        datos[i * 4 + 2] = entre(0.06, 0.11) * (movil ? 1.25 : 1);
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
            uLargo: { value: ajustes.largoHierba },
            uAdelante: { value: new THREE.Vector2(0, -1) },
            uTanMedio: { value: 1 }
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
            uniform vec2 uAdelante;
            uniform float uTanMedio;
            ${clarosGLSL}
            varying float vAltura;
            varying float vAzar;
            varying float vMancha;
            varying float vSol;
            varying float vRafaga;
            varying vec3 vMundo;
            ${terrenoGLSL}
            ${sombraGLSL}

            void main() {
                float delante = mod(uCamara.z + 4.0 - aPosicion.y, uLargo);
                float z = uCamara.z + 4.0 - delante;
                float x = caminoX(z) + aPosicion.x;

                // Fuera de lo que ve la cámara: se descarta antes de calcular nada
                vec2 rel = vec2(x, z) - uCamara.xz;
                float alFrente = dot(rel, uAdelante);
                if (alFrente < -1.0 || abs(dot(rel, vec2(-uAdelante.y, uAdelante.x))) > alFrente * uTanMedio + 1.6) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    return;
                }

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
                // Ráfagas: manchas de viento que cruzan el prado como olas
                float rafaga = ruido(base.xz * 0.08 - vec2(uTiempo * 0.6, uTiempo * 0.2));
                float ola = smoothstep(0.55, 0.85, ruido(base.xz * vec2(0.05, 0.12) - vec2(uTiempo * 0.9, uTiempo * 0.15)));
                rafaga = min(1.0, rafaga + ola * 0.8);
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
                vRafaga = ola * uViento;
                vSol = sombraEn(base + vec3(0.0, alto * 0.6, 0.0), false);
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
            uniform vec3 uLuzLuna;
            uniform vec3 uDirLuna;
            uniform float uParpadeo;
            varying float vAltura;
            varying float vAzar;
            varying float vMancha;
            varying float vSol;
            varying float vRafaga;
            varying vec3 vMundo;
            ${terrenoGLSL}

            void main() {
                float d = length(vMundo - cameraPosition);
                if (smoothstep(40.0, 66.0, d) > tramado(gl_FragCoord.xy)) discard;
                vec3 punta = uPunta * (0.7 + vAzar * 0.55);
                if (vAzar > 0.93) punta *= vec3(1.35, 1.1, 0.6);
                punta = mix(punta, punta * vec3(1.18, 1.08, 0.72), smoothstep(0.6, 0.85, vMancha));
                punta = mix(punta, punta * vec3(0.78, 0.9, 1.0), 1.0 - smoothstep(0.15, 0.35, vMancha));
                vec3 color = mix(uBase, punta, vAltura * vAltura);
                color *= uAmbiente * 1.2 + uLuz * (0.2 + 0.65 * vAltura) * (0.1 + 0.9 * vSol);
                // Brillo de la luna en las briznas dobladas por la ráfaga
                color += uLuzLuna * vRafaga * vAltura * vAltura * 0.07 * vSol;
                // A contraluz de la luna las puntas se encienden
                vec3 rayoVista = normalize(vMundo - cameraPosition);
                float delante = max(dot(normalize(rayoVista.xz), normalize(uDirLuna.xz)), 0.0);
                color += uLuzLuna * pow(vAltura, 4.0) * pow(delante, 10.0) * vSol * 0.16;
                color += vec3(1.0, 0.55, 0.22) * luzFarolas(vMundo) * uNoche * uParpadeo * (0.03 + vAltura * 0.13);
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

// Filo de luz de la luna: lo que queda entre la cámara y la luna se ve
// a contraluz, con el borde encendido.
function contraluzLuna(shader) {
    shader.uniforms.uLuzLuna = comunes.uLuzLuna;
    shader.uniforms.uDirLunaVista = comunes.uDirLunaVista;
    shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uLuzLuna;\nuniform vec3 uDirLunaVista;")
        .replace(
            "#include <opaque_fragment>",
            `vec3 haciaOjo = normalize(vViewPosition);
            float filoG = pow(1.0 - clamp(dot(normal, haciaOjo), 0.0, 1.0), 3.0);
            float miraG = smoothstep(-0.1, 0.6, dot(normal, uDirLunaVista));
            float detrasG = pow(max(dot(-haciaOjo, uDirLunaVista), 0.0), 2.0);
            #ifdef HOJAS
            // En las hojas la luz que atraviesa sale verdosa y más suave
            outgoingLight += uLuzLuna * diffuseColor.rgb * 2.2 * filoG * miraG * (0.25 + 0.75 * detrasG);
            #else
            outgoingLight += uLuzLuna * filoG * miraG * (0.25 + 0.75 * detrasG) * 0.9;
            #endif
            #include <opaque_fragment>`
        );
}

// Lo que está lejos se desvanece con un ruido fino
// para fundirse con el fondo pintado, en vez de cortarse de golpe.
function desvanecerLejos(material, cerca, lejos) {
    material.onBeforeCompile = (shader) => {
        contraluzLuna(shader);
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <clipping_planes_fragment>",
            `#include <clipping_planes_fragment>
            float umbral = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (smoothstep(${cerca.toFixed(1)}, ${lejos.toFixed(1)}, length(vViewPosition)) > umbral) discard;`
        );
    };
    return material;
}

const materialMundo = desvanecerLejos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, emissive: "#141c26" }), 60, 95);
const materialFarol = new THREE.MeshBasicMaterial({ color: "#2a2230" });
// Las flores son puntos redondos (sin textura serían cuadrados)
function texturaRedonda() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 32;
    const ctx = lienzo.getContext("2d");
    const degradado = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    degradado.addColorStop(0, "rgba(255, 255, 255, 1)");
    degradado.addColorStop(0.55, "rgba(255, 255, 255, 1)");
    degradado.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(lienzo);
}
const materialFlores = new THREE.PointsMaterial({ size: 0.11, vertexColors: true, map: texturaRedonda(), alphaTest: 0.5 });

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
    const plantas = [];
    const hojas = [];
    const luces = [];
    const halos = [];
    const claros = [];
    const obstaculos = [];
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
        plantas,
        hojas,
        luces,
        halos,
        claros,
        obstaculos,
        flores,
        aleatorio,
        // Coloca el sistema de coordenadas del siguiente objeto (y apunta
        // dónde está, para que el ciervo no lo atraviese)
        en(x, y, z, angulo = 0) {
            matriz.makeTranslation(x, y, z).multiply(giro.makeRotationY(angulo));
            obstaculos.push(x, z);
            return this;
        },
        poner(geometria, color, variacion = 0.1) {
            const g = pintar(geometria, color, variacion);
            g.applyMatrix4(matriz);
            piezas.push(g);
            return g;
        },
        // Una planta ya pintada (árbol, arbusto, roca...) en la posición
        // actual; se mece con el viento según su atributo aVaiven
        planta(geometria) {
            geometria.applyMatrix4(matriz);
            plantas.push(geometria);
            if (geometria.userData.hojas) hojas.push(geometria.userData.hojas.applyMatrix4(matriz));
            return geometria;
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
        hojasSueltas(geometria) {
            hojas.push(geometria);
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
// 9b. PLANTAS EN 3D
// Árboles, arbustos, rocas y juncos hechos con formas suaves: conos y
// bolas abolladas pintadas con un degradado de oscuro abajo a claro
// arriba. Todas las de un trozo se juntan en una sola malla que se mece
// con el viento y recibe la luz de la farola.
// =====================================================================

const tonosPino = [["#06120f", "#1d4234"], ["#071210", "#1a3a3c"], ["#08140e", "#244a32"]];
const tonosHoja = [["#06100a", "#24482a"], ["#08120a", "#2e5428"], ["#071010", "#24443e"]];
const tonosOtono = [["#120804", "#5a2a12"], ["#140a04", "#5e4416"], ["#120606", "#4e1c1a"]];

// Oscurece cada bola de la copa por abajo y por dentro, como si las
// hojas de fuera taparan la luz a las de dentro
function sombrearBola(g, cx, cy, cz, r) {
    const pos = g.attributes.position;
    const col = g.attributes.color;
    for (let i = 0; i < pos.count; i++) {
        const ny = (pos.getY(i) - cy) / r;
        const fuera = Math.min(1, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) / r);
        const k = (0.45 + 0.55 * THREE.MathUtils.smoothstep(ny, -1, 0.9)) * (0.7 + 0.3 * fuera);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
    return g;
}

// Deforma un poco los vértices para que no parezcan formas perfectas
function abollar(geometria, fuerza, frecuencia, semilla) {
    const pos = geometria.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const k = 1 + fuerza * Math.sin(x * frecuencia + semilla) * Math.sin(y * frecuencia * 1.3 + semilla * 2.1) * Math.sin(z * frecuencia * 0.9 + semilla * 3.7);
        pos.setXYZ(i, x * k, y, z * k);
    }
    return geometria;
}

// Colores por vértice de abajo (oscuro) a arriba (claro) y cuánto se
// mece cada vértice (nada en el suelo, más en lo alto)
function tenir(geometria, abajo, arriba, desde, hasta, aleatorio, mecer = 1) {
    const g = geometria.index ? geometria.toNonIndexed() : geometria;
    g.deleteAttribute("uv");
    const pos = g.attributes.position;
    const n = pos.count;
    const color = new Float32Array(n * 3);
    const vaiven = new Float32Array(n);
    const ca = new THREE.Color(abajo);
    const cb = new THREE.Color(arriba);
    const c = new THREE.Color();
    const brillo = 0.85 + aleatorio() * 0.3;
    for (let i = 0; i < n; i++) {
        const t = THREE.MathUtils.clamp((pos.getY(i) - desde) / (hasta - desde), 0, 1);
        c.copy(ca).lerp(cb, Math.pow(t, 0.8)).multiplyScalar(brillo);
        c.toArray(color, i * 3);
        vaiven[i] = Math.pow(t, 2) * mecer;
    }
    g.setAttribute("color", new THREE.BufferAttribute(color, 3));
    g.setAttribute("aVaiven", new THREE.BufferAttribute(vaiven, 1));
    return g;
}

function juntar(lista) {
    const g = mergeGeometries(lista);
    g.computeVertexNormals();
    return g;
}

// Textura de las hojas: a la izquierda un racimo de hojas y a la
// derecha una rama de agujas de pino, en blanco sobre transparente (el
// color lo pone cada tarjeta)
function texturaHojas() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 512;
    lienzo.height = 256;
    const ctx = lienzo.getContext("2d");
    const a = crearAzar(77);
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 55; i++) {
        const ang = a() * Math.PI * 2;
        const r = Math.sqrt(a()) * 92;
        ctx.save();
        ctx.translate(128 + Math.cos(ang) * r, 128 + Math.sin(ang) * r);
        ctx.rotate(a() * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(0, 0, 13 + a() * 9, 6 + a() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.strokeStyle = "#fff";
    ctx.lineCap = "round";
    for (let rama = 0; rama < 3; rama++) {
        const x0 = 300 + rama * 30;
        const y0 = 230 - rama * 10;
        const x1 = 470 - rama * 20;
        const y1 = 30 + rama * 25;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.lineWidth = 4;
        for (let k = 0; k < 40; k++) {
            const t = k / 34;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;
            const largo = 26 * (1 - t * 0.5) + a() * 8;
            [-1, 1].forEach((s) => {
                const ang = Math.atan2(y1 - y0, x1 - x0) + s * (0.9 + a() * 0.4);
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.cos(ang) * largo, y + Math.sin(ang) * largo);
                ctx.stroke();
            });
        }
    }
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
}
const atlasHojas = texturaHojas();

// Tarjetas de hojas: cuadrados pequeños con la textura de hojas,
// repartidos por la superficie de la copa y girados al azar. Su normal
// apunta hacia fuera desde el centro de la copa, así la luz las trata
// como un volumen y no como planos sueltos.
function tarjetas(grupos, a) {
    const pos = [];
    const nor = [];
    const uvs = [];
    const col = [];
    const vai = [];
    const ind = [];
    const dir = new THREE.Vector3();
    const n = new THREE.Vector3();
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const oscuro = new THREE.Color();
    const claro = new THREE.Color();
    grupos.forEach((g) => {
        oscuro.set(g.oscuro);
        claro.set(g.claro);
        for (let k = 0; k < g.cuantas; k++) {
            if (g.cono) {
                // En los pinos, sobre la superficie del piso (un cono)
                const ang = a() * Math.PI * 2;
                const t = Math.pow(a(), 0.7);
                const radio = g.r * (1 - t) * (0.9 + a() * 0.25);
                dir.set(Math.cos(ang), 0.35, Math.sin(ang)).normalize();
                p.set(g.cx + Math.cos(ang) * radio, g.cy - g.alto * 0.5 + t * g.alto, g.cz + Math.sin(ang) * radio);
            } else {
                dir.set(a() * 2 - 1, a() * 2 - 1, a() * 2 - 1);
                if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
                dir.normalize();
                dir.y = Math.abs(dir.y) * 0.8 + dir.y * 0.2;
                dir.normalize();
                p.set(g.cx, g.cy, g.cz).addScaledVector(dir, g.r * (0.72 + a() * 0.38));
            }
            n.copy(dir).addScaledVector(new THREE.Vector3(a() - 0.5, a() - 0.5, a() - 0.5), 1.4).normalize();
            u.set(0, 1, 0).cross(n);
            if (u.lengthSq() < 0.01) u.set(1, 0, 0);
            u.normalize();
            v.crossVectors(n, u);
            const giro = a() * Math.PI * 2;
            const cg = Math.cos(giro);
            const sg = Math.sin(giro);
            const lado = g.tam * (0.75 + a() * 0.5) * 0.5;
            const eu = u.clone().multiplyScalar(cg * lado).addScaledVector(v, sg * lado);
            const ev = v.clone().multiplyScalar(cg * lado).addScaledVector(u, -sg * lado);
            const altoT = THREE.MathUtils.clamp((p.y - g.desde) / (g.hasta - g.desde), 0, 1);
            const fuera = 0.55 + 0.45 * THREE.MathUtils.smoothstep(dir.y, -0.6, 0.8);
            c.copy(oscuro).lerp(claro, Math.pow(altoT, 0.8) * (0.6 + a() * 0.4)).multiplyScalar(fuera * (0.85 + a() * 0.3));
            const base = pos.length / 3;
            const u0 = g.agujas ? 0.5 : 0;
            [[-1, -1, 0, 0], [1, -1, 1, 0], [-1, 1, 0, 1], [1, 1, 1, 1]].forEach(([su, sv, tu, tv]) => {
                pos.push(p.x + eu.x * su + ev.x * sv, p.y + eu.y * su + ev.y * sv, p.z + eu.z * su + ev.z * sv);
                nor.push(dir.x, dir.y, dir.z);
                uvs.push(u0 + tu * 0.5, tv);
                col.push(c.r, c.g, c.b);
                vai.push(altoT * altoT * g.mecer);
            });
            ind.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("aVaiven", new THREE.Float32BufferAttribute(vai, 1));
    geo.setIndex(ind);
    return geo.toNonIndexed();
}

function geometriaPino(alto, a) {
    const [oscuro, claro] = tonosPino[Math.floor(a() * tonosPino.length)];
    const partes = [tenir(new THREE.CylinderGeometry(0.03 * alto, 0.045 * alto, 0.3 * alto, 7).translate(0, 0.15 * alto, 0), "#120c08", "#2a1e16", 0, alto, a, 0.3)];
    const pisos = 7;
    const grupos = [];
    for (let i = 0; i < pisos; i++) {
        const t = i / pisos;
        const radio = 0.25 * alto * (1 - t * 0.8) * (0.88 + a() * 0.24);
        const altoPiso = 0.24 * alto * (1 - t * 0.3);
        const cono = abollar(new THREE.ConeGeometry(radio, altoPiso, 13, 3), 0.16, 11 / alto, a() * 10);
        cono.rotateY(a() * 6.28);
        const y0 = 0.2 * alto + t * 0.7 * alto + altoPiso / 2;
        cono.translate(0, y0, 0);
        const g = tenir(cono, oscuro, claro, 0.1 * alto, alto * 1.05, a);
        // La parte de abajo de cada piso queda en sombra
        const pos = g.attributes.position;
        const col = g.attributes.color;
        for (let k = 0; k < pos.count; k++) {
            const f = 0.55 + 0.45 * THREE.MathUtils.smoothstep(pos.getY(k), y0 - altoPiso * 0.5, y0 + altoPiso * 0.2);
            col.setXYZ(k, col.getX(k) * f, col.getY(k) * f, col.getZ(k) * f);
        }
        partes.push(g);
        grupos.push({ cono: true, cx: 0, cy: y0, cz: 0, r: radio * 1.12, alto: altoPiso, cuantas: Math.round(14 + radio * 12), tam: 0.13 * alto, oscuro, claro, desde: 0.1 * alto, hasta: alto * 1.05, mecer: 1, agujas: true });
    }
    const geometria = juntar(partes);
    geometria.userData.hojas = tarjetas(grupos, a);
    return geometria;
}

function geometriaFrondoso(alto, a, otono) {
    const lista = otono ? tonosOtono : tonosHoja;
    const [oscuro, claro] = lista[Math.floor(a() * lista.length)];
    const partes = [tenir(new THREE.CylinderGeometry(0.035 * alto, 0.06 * alto, 0.55 * alto, 7).translate(0, 0.275 * alto, 0), "#140e0a", "#33261c", 0, alto, a, 0.3)];
    // Dos ramas que salen del tronco
    for (let i = 0; i < 2; i++) {
        const rama = new THREE.CylinderGeometry(0.012 * alto, 0.025 * alto, 0.32 * alto, 5).translate(0, 0.16 * alto, 0);
        rama.rotateZ((i ? 1 : -1) * (0.6 + a() * 0.3)).rotateY(a() * 6.28).translate(0, 0.45 * alto, 0);
        partes.push(tenir(rama, "#140e0a", "#2a1e16", 0, alto, a, 0.4));
    }
    // La copa: muchas bolas abolladas de tamaños distintos, más
    // apretadas arriba, con huecos entre ellas
    const copas = 11;
    const grupos = [];
    for (let i = 0; i < copas; i++) {
        const ang = i * 2.39996 + a();
        const altura = 0.52 + (i / copas) * 0.38 + (a() - 0.5) * 0.08;
        const r = 0.16 * alto * (0.65 + a() * 0.55) * (1.15 - (i / copas) * 0.35);
        const bola = abollar(new THREE.IcosahedronGeometry(r * 0.78, 1), 0.2, 6 / alto, a() * 10);
        const lejos = (i === 0 ? 0 : 0.21 * alto) * (1.05 - (i / copas) * 0.5);
        const cx = Math.cos(ang) * lejos;
        const cy = altura * alto;
        const cz = Math.sin(ang) * lejos;
        bola.translate(cx, cy, cz);
        // El centro de cada bola, oscuro, tapa los huecos entre hojas
        partes.push(sombrearBola(tenir(bola, oscuro, claro, 0.4 * alto, 0.98 * alto, a), cx, cy, cz, r));
        grupos.push({ cx, cy, cz, r, cuantas: Math.round(10 + r * 7), tam: 0.13 * alto, oscuro, claro, desde: 0.4 * alto, hasta: 0.98 * alto, mecer: 1 });
    }
    const geometria = juntar(partes);
    geometria.userData.hojas = tarjetas(grupos, a);
    return geometria;
}

function geometriaArbusto(tam, a, conFlores) {
    const [oscuro, claro] = tonosHoja[Math.floor(a() * tonosHoja.length)];
    const partes = [];
    const grupos = [];
    for (let i = 0; i < 3; i++) {
        const r = 0.45 * tam * (0.7 + a() * 0.5);
        const bola = abollar(new THREE.IcosahedronGeometry(r * 0.8, 1), 0.2, 8 / tam, a() * 10);
        const cx = (a() - 0.5) * 0.7 * tam;
        const cz = (a() - 0.5) * 0.7 * tam;
        bola.scale(1, 0.8, 1).translate(cx, r * 0.6, cz);
        partes.push(sombrearBola(tenir(bola, oscuro, claro, 0, tam * 1.1, a, 0.4), cx, r * 0.6, cz, r));
        grupos.push({ cx, cy: r * 0.6, cz, r, cuantas: 9, tam: 0.42 * tam, oscuro, claro, desde: 0, hasta: tam * 1.1, mecer: 0.4 });
    }
    if (conFlores) {
        const color = coloresFlor[Math.floor(a() * coloresFlor.length)].getHexString();
        for (let i = 0; i < 9; i++) {
            const f = new THREE.IcosahedronGeometry(0.05 * tam + 0.02, 0).translate((a() - 0.5) * tam, 0.55 * tam + a() * 0.35 * tam, (a() - 0.5) * tam);
            partes.push(tenir(f, "#" + color, "#" + color, 0, 1, a, 0.4));
        }
    }
    const geometria = juntar(partes);
    geometria.userData.hojas = tarjetas(grupos, a);
    return geometria;
}

function geometriaRoca(tam, a) {
    const g = abollar(new THREE.IcosahedronGeometry(tam, 1), 0.25, 4 / tam, a() * 10);
    g.scale(1.2, 0.6, 1).translate(0, tam * 0.25, 0);
    return juntar([tenir(g, "#1a1c24", a() < 0.4 ? "#3a4a3a" : "#5a6070", -tam * 0.2, tam * 0.85, a, 0)]);
}

function geometriaJuncos(a) {
    const partes = [];
    for (let i = 0; i < 12; i++) {
        const alto = 1.0 + a() * 0.9;
        const x = (a() - 0.5) * 1.2;
        const z = (a() - 0.5) * 1.2;
        const tallo = new THREE.CylinderGeometry(0.012, 0.022, alto, 4).translate(0, alto / 2, 0);
        tallo.rotateZ((a() - 0.5) * 0.3).rotateX((a() - 0.5) * 0.3).translate(x, 0, z);
        partes.push(tenir(tallo, "#0c160e", "#3a5230", 0, 2, a));
        if (a() < 0.4) partes.push(tenir(new THREE.CapsuleGeometry(0.035, 0.16, 2, 6).translate(x, alto * 0.88, z), "#2a1a10", "#4a2e1a", 0, 2, a));
    }
    return juntar(partes);
}

// Material de las plantas: se mecen con el viento y les llega la luz
// de la farola del trozo
const materialPlantas = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, emissive: "#05080e" });
function prepararPlantas(shader) {
    shader.uniforms.uTiempo = comunes.uTiempo;
    shader.uniforms.uViento = comunes.uViento;
    shader.uniforms.uNoche = comunes.uNoche;
    shader.uniforms.uParpadeo = comunes.uParpadeo;
    shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aVaiven;\nuniform float uTiempo;\nuniform float uViento;\nvarying vec3 vMundoP;")
        .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float vaiven = sin(uTiempo * 1.3 + position.x * 0.4 + position.z * 0.3) + 0.4 * sin(uTiempo * 2.7 + position.x);
            transformed.x += vaiven * 0.12 * aVaiven * uViento;
            transformed.z += vaiven * 0.05 * aVaiven * uViento;
            vMundoP = transformed;`
        );
    shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNoche;\nuniform float uParpadeo;\nvarying vec3 vMundoP;\n" + terrenoGLSL)
        .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.6, 0.3) * luzFarolas(vMundoP) * uNoche * uParpadeo * 2.5;`
        )
        .replace(
            "#include <clipping_planes_fragment>",
            `#include <clipping_planes_fragment>
            if (smoothstep(60.0, 95.0, length(vViewPosition)) > tramado(gl_FragCoord.xy)) discard;`
        );
    contraluzLuna(shader);
}
materialPlantas.onBeforeCompile = prepararPlantas;
materialPlantas.customProgramCacheKey = () => "plantas";

// Las hojas usan lo mismo, con su textura recortada. Su normal no se da
// la vuelta por detrás: es la de la copa entera.
const materialHojas = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: "#05080e", map: atlasHojas, alphaTest: 0.5, side: THREE.DoubleSide });
materialHojas.defines = { HOJAS: "" };
materialHojas.onBeforeCompile = (shader) => {
    prepararPlantas(shader);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
};
materialHojas.customProgramCacheKey = () => "hojas";

// Para la sombra se usa el mismo vaivén: así la sombra de cada árbol se
// mece con él en vez de quedarse quieta
const profundidadPlantas = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
function vaivenSombra(shader) {
    shader.uniforms.uTiempo = comunes.uTiempo;
    shader.uniforms.uViento = comunes.uViento;
    shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aVaiven;\nuniform float uTiempo;\nuniform float uViento;")
        .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float vaiven = sin(uTiempo * 1.3 + position.x * 0.4 + position.z * 0.3) + 0.4 * sin(uTiempo * 2.7 + position.x);
            transformed.x += vaiven * 0.12 * aVaiven * uViento;
            transformed.z += vaiven * 0.05 * aVaiven * uViento;`
        );
}
profundidadPlantas.onBeforeCompile = vaivenSombra;
profundidadPlantas.customProgramCacheKey = () => "profundidadPlantas";
const profundidadHojas = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasHojas, alphaTest: 0.5 });
profundidadHojas.onBeforeCompile = vaivenSombra;
profundidadHojas.customProgramCacheKey = () => "profundidadHojas";

// =====================================================================
// 10. ÁRBOLES, ROCAS Y PLANTAS
// =====================================================================

function pino(o, x, z, alto) {
    // Se apunta dónde está cada pino (para posar el búho en uno)
    (o.pinos = o.pinos || []).push(x, z, alto);
    o.en(x, alturaTerreno(x, z) - 0.15, z, o.aleatorio() * 6.28).planta(geometriaPino(alto, o.aleatorio));
}

function frondoso(o, x, z, alto) {
    o.en(x, alturaTerreno(x, z) - 0.1, z, o.aleatorio() * 6.28).planta(geometriaFrondoso(alto * 1.1, o.aleatorio, o.aleatorio() < 0.35));
}

function arbusto(o, x, z, tam, conFlores) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, o.aleatorio() * 6.28).planta(geometriaArbusto(tam * 1.4, o.aleatorio, conFlores));
}

function roca(o, x, z, tam) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, o.aleatorio() * 6.28).planta(geometriaRoca(tam * 1.6, o.aleatorio));
}

function juncos(o, x, z) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, o.aleatorio() * 6.28).planta(geometriaJuncos(o.aleatorio));
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

// Hacia dónde mira algo que está a un lado del camino
const haciaCamino = (lado) => (lado > 0 ? -Math.PI / 2 : Math.PI / 2);

function carreta(o, x, z, angulo = 0) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z) - 0.05, z, angulo);
    o.poner(caja(1.7, 0.12, 1.0, 0, 0.75, 0), colores.madera, 0.12);
    [-1, 1].forEach((s) => o.poner(caja(1.7, 0.35, 0.06, 0, 0.98, s * 0.5), colores.madera, 0.15));
    [-1, 1].forEach((s) => o.poner(caja(0.06, 0.35, 1.0, s * 0.85, 0.98, 0), colores.maderaOscura, 0.12));
    [-1, 1].forEach((s) => {
        o.poner(cilindro(0.45, 0.45, 0.09, 16, 0.15, 0.45, s * 0.6, Math.PI / 2), colores.maderaOscura, 0.1);
        o.poner(cilindro(0.09, 0.09, 0.14, 8, 0.15, 0.45, s * 0.6, Math.PI / 2), colores.hierro, 0);
        o.poner(caja(1.5, 0.06, 0.06, 1.45, 0.55, s * 0.3, 0, 0, 0.28), colores.madera, 0.1);
    });
    o.poner(bola(0.6, -0.2, 1.15, 0, 0.55), colores.heno, 0.15);
    if (a() < 0.5) o.poner(bola(0.4, 0.4, 1.1, 0.15, 0.6), colores.heno, 0.15);
}

function pozo(o, x, z) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, o.aleatorio() * 6.28);
    for (let i = 0; i < 12; i++) {
        const t = (i / 12) * Math.PI * 2;
        o.poner(caja(0.4, 0.75, 0.24, Math.cos(t) * 0.75, 0.37, Math.sin(t) * 0.75, 0, -t + Math.PI / 2), colores.piedra, 0.18);
    }
    o.poner(cilindro(0.66, 0.66, 0.05, 16, 0, 0.55, 0), colores.agua, 0);
    [-1, 1].forEach((s) => o.poner(caja(0.12, 1.7, 0.12, s * 0.78, 1.3, 0), colores.maderaOscura, 0.1));
    o.poner(caja(1.7, 0.09, 0.09, 0, 1.95, 0), colores.maderaOscura, 0.1);
    o.poner(cono(1.15, 0.75, 4, 0, 2.45, 0, Math.PI / 4), colores.tejado, 0.1);
    o.poner(cilindro(0.15, 0.12, 0.22, 8, 0, 1.5, 0), colores.madera, 0.1);
}

function lenas(o, x, z, angulo = 0) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, angulo);
    for (let fila = 0; fila < 3; fila++) {
        const n = 4 - fila;
        for (let i = 0; i < n; i++) o.poner(cilindro(0.13, 0.13, 1.3, 8, (i - (n - 1) / 2) * 0.27, 0.13 + fila * 0.23, 0, Math.PI / 2), i % 2 ? colores.maderaClara : colores.madera, 0.15);
    }
}

function arbolCaido(o, x, z, angulo = 0) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z) - 0.1, z, angulo);
    o.poner(cilindro(0.32, 0.38, 4.6, 10, 0, 0.32, 0, 0, 0, Math.PI / 2), colores.tronco, 0.1);
    o.poner(bola(0.75, -2.4, 0.55, 0, 0.9), colores.tronco, 0.1);
    o.poner(cilindro(0.06, 0.1, 1.4, 6, 0.8, 0.8, 0.3, 0.6, 0, 0.9), colores.tronco, 0.1);
    for (let i = 0; i < 4; i++) o.poner(bola(entre(0.15, 0.3, a), entre(-1.8, 1.8, a), 0.62, entre(-0.2, 0.2, a), 0.5), colores.musgo, 0.2);
}

function hito(o, x, z, lado = 1) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, haciaCamino(lado));
    o.poner(caja(0.45, 1.15, 0.28, 0, 0.57, 0), colores.piedra, 0.12);
    o.poner(cono(0.34, 0.28, 4, 0, 1.28, 0, Math.PI / 4), colores.piedraOscura, 0.1);
    o.poner(bola(0.18, 0.15, 0.1, 0.12, 0.6), colores.musgo, 0.2);
}

function banco(o, x, z, lado = 1) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, haciaCamino(lado));
    o.poner(caja(1.5, 0.08, 0.42, 0, 0.47, 0), colores.madera, 0.12);
    o.poner(caja(1.5, 0.32, 0.06, 0, 0.82, -0.2), colores.madera, 0.12);
    [-1, 1].forEach((s) => o.poner(caja(0.12, 0.47, 0.4, s * 0.62, 0.23, 0), colores.piedraOscura, 0.1));
}

function hornacina(o, x, z, lado = 1) {
    o.en(x, alturaTerreno(x, z) - 0.05, z, haciaCamino(lado));
    o.poner(caja(0.95, 2.2, 0.6, 0, 1.1, 0), colores.piedra, 0.12);
    o.poner(caja(0.5, 0.65, 0.05, 0, 1.85, 0.29), "#120e16", 0);
    o.poner(cono(0.75, 0.45, 4, 0, 2.42, 0, Math.PI / 4), colores.tejado, 0.1);
    o.luz(caja(0.06, 0.12, 0.06, 0, 1.68, 0.24), 0.9);
}

// Ermita pequeña de piedra encalada, con espadaña y campana, la puerta
// mirando al camino y una vela encendida en la ventana
function ermita(o, x, z, lado = 1) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z) - 0.1, z, haciaCamino(lado));
    const cal = "#7e7a74";
    o.poner(caja(3.2, 0.3, 4.4, 0, 0.15, 0), colores.piedraOscura, 0.08);
    o.poner(caja(3.0, 2.6, 4.2, 0, 1.6, 0), cal, 0.06);
    // Tejado a dos aguas
    [-1, 1].forEach((s) => o.poner(caja(1.85, 0.12, 4.6, s * 0.82, 3.25, 0, 0, 0, -s * 0.5), colores.tejado, 0.1));
    o.poner(caja(0.2, 0.2, 4.6, 0, 3.68, 0), colores.tejado, 0.1);
    // Fachada: puerta en arco y escalón
    o.poner(caja(1.0, 1.7, 0.08, 0, 1.15, 2.12), colores.maderaOscura, 0.08);
    o.poner(cilindro(0.5, 0.5, 0.08, 10, 0, 2.0, 2.12, Math.PI / 2), colores.maderaOscura, 0.08);
    o.poner(caja(1.6, 0.16, 0.5, 0, 0.3, 2.45), colores.piedra, 0.1);
    // Espadaña con la campana encima de la fachada
    o.poner(caja(1.2, 1.4, 0.35, 0, 3.6, 2.0), cal, 0.06);
    o.poner(caja(0.45, 0.6, 0.4, 0, 3.75, 2.0), "#0a0a10", 0);
    o.poner(cono(0.17, 0.3, 8, 0, 3.75, 2.0), colores.hierro, 0.05);
    o.poner(cono(0.75, 0.35, 4, 0, 4.47, 2.0, Math.PI / 4), colores.tejado, 0.1);
    o.poner(caja(0.06, 0.4, 0.06, 0, 4.85, 2.0), colores.hierro, 0);
    o.poner(caja(0.25, 0.06, 0.06, 0, 4.92, 2.0), colores.hierro, 0);
    // Ventana lateral con una vela
    const ventana = lado > 0 ? -1.52 : 1.52;
    o.poner(caja(0.06, 0.5, 0.36, ventana, 1.9, 0.6), "#0a0a10", 0);
    o.luz(caja(0.05, 0.12, 0.05, ventana * 0.98, 1.78, 0.6), 1.3);
    for (let i = 0; i < 5; i++) roca(o, x + entre(-3, 3, a), z + entre(-3.5, 3.5, a), entre(0.2, 0.4, a));
}

// Muro de piedra seca a lo largo del camino, con hiedra por encima
function muro(o, z, lado) {
    const a = o.aleatorio;
    const desde = z + 5;
    const hasta = z - 5;
    const hiedra = [];
    for (let zz = desde; zz > hasta; zz -= 0.55) {
        const x = caminoX(zz) + lado * 2.4;
        o.en(x, alturaTerreno(x, zz) - 0.05, zz, anguloCamino(zz));
        for (let f = 0; f < 3; f++) {
            if (f === 2 && a() < 0.3) continue;
            o.poner(caja(0.3, 0.26 + a() * 0.06, 0.5 + a() * 0.12, entre(-0.04, 0.04, a), 0.15 + f * 0.27, entre(-0.06, 0.06, a), 0, entre(-0.15, 0.15, a), entre(-0.05, 0.05, a)), a() < 0.2 ? colores.piedraOscura : colores.piedra, 0.18);
        }
        if (a() < 0.7) hiedra.push({ cx: x, cy: alturaTerreno(x, zz) + 0.75, cz: zz, r: 0.35, cuantas: 5, tam: 0.35, oscuro: "#06120a", claro: "#2a4a26", desde: alturaTerreno(x, zz), hasta: alturaTerreno(x, zz) + 1.0, mecer: 0.2 });
    }
    o.hojasSueltas(tarjetas(hiedra, a));
}

// Mirador: un pretil de piedra bajo con un banco mirando al valle y un
// farolillo
function mirador(o, x, z, lado = 1) {
    const a = o.aleatorio;
    o.en(x, alturaTerreno(x, z) - 0.05, z, haciaCamino(lado) + Math.PI);
    for (let i = -4; i <= 4; i++) {
        const ang = i * 0.16;
        o.poner(caja(0.55, 0.55, 0.4, Math.sin(ang) * 3.2, 0.27, Math.cos(ang) * 3.2 - 3.2 + 1.6, 0, ang, 0), colores.piedra, 0.15);
    }
    o.poner(caja(1.5, 0.08, 0.42, 0, 0.47, 0.2), colores.madera, 0.12);
    o.poner(caja(1.5, 0.32, 0.06, 0, 0.82, 0.4), colores.madera, 0.12);
    [-1, 1].forEach((s) => o.poner(caja(0.12, 0.47, 0.4, s * 0.62, 0.23, 0.2), colores.piedraOscura, 0.1));
    o.poner(caja(0.1, 1.6, 0.1, 1.4, 0.8, 0.6), colores.maderaOscura, 0.1);
    o.luz(caja(0.16, 0.2, 0.16, 1.4, 1.7, 0.6), 1.2);
    for (let i = 0; i < 3; i++) arbusto(o, x + entre(-3, 3, a), z + entre(-3, 3, a), entre(0.5, 0.8, a), a() < 0.5);
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

// =====================================================================
// 11b. POSTES DEL PORTFOLIO
// Postes de madera junto al camino con el nombre de cada parte grabado.
// Tienen un farolillo, y al acercarte las letras se encienden y se abre
// el cartel con el texto.
// =====================================================================

const materialesPoste = new Map();

function texturaTablilla(texto, encendido) {
    const lienzo = document.createElement("canvas");
    lienzo.width = 512;
    lienzo.height = 160;
    const ctx = lienzo.getContext("2d");
    const a = crearAzar(texto.length * 31 + (encendido ? 7 : 0));
    if (encendido) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 512, 160);
    } else {
        ctx.fillStyle = "#4a3424";
        ctx.fillRect(0, 0, 512, 160);
        // Vetas de la madera
        for (let i = 0; i < 40; i++) {
            ctx.strokeStyle = `rgba(${a() < 0.5 ? "30, 18, 10" : "110, 80, 54"}, ${0.15 + a() * 0.25})`;
            ctx.lineWidth = 1 + a() * 3;
            ctx.beginPath();
            const y = a() * 160;
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(170, y + (a() - 0.5) * 20, 340, y + (a() - 0.5) * 20, 512, y + (a() - 0.5) * 10);
            ctx.stroke();
        }
        ctx.strokeStyle = "rgba(20, 12, 6, 0.8)";
        ctx.lineWidth = 6;
        ctx.strokeRect(6, 6, 500, 148);
    }
    ctx.font = "italic 400 76px Fraunces, Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (encendido) {
        ctx.fillStyle = "#ffffff";
        ctx.fillText(texto, 256, 84);
    } else {
        // Letras grabadas: hueco oscuro con un filo claro debajo
        ctx.fillStyle = "rgba(150, 110, 70, 0.7)";
        ctx.fillText(texto, 256, 87);
        ctx.fillStyle = "#1a0f08";
        ctx.fillText(texto, 256, 84);
    }
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

function materialPoste(id) {
    if (!materialesPoste.has(id)) {
        const titulo = document.querySelector(`#${id} h2`);
        const texto = titulo ? titulo.textContent : id;
        const m = new THREE.MeshStandardMaterial({ map: texturaTablilla(texto, false), emissiveMap: texturaTablilla(texto, true), emissive: "#ffb066", emissiveIntensity: 0, roughness: 0.85 });
        m.onBeforeCompile = (shader) => contraluzLuna(shader);
        materialesPoste.set(id, m);
    }
    return materialesPoste.get(id);
}

const maderaPoste = new THREE.MeshStandardMaterial({ color: "#3a2a1e", roughness: 0.95 });
maderaPoste.onBeforeCompile = (shader) => contraluzLuna(shader);
const farolillo = new THREE.MeshBasicMaterial({ color: "#ffb870" });

// Si la letra Fraunces llega después de dibujar las tablillas, se
// vuelven a dibujar con ella
if (document.fonts) {
    document.fonts.ready.then(() => {
        materialesPoste.forEach((m, id) => {
            const titulo = document.querySelector(`#${id} h2`);
            const texto = titulo ? titulo.textContent : id;
            m.map.dispose();
            m.emissiveMap.dispose();
            m.map = texturaTablilla(texto, false);
            m.emissiveMap = texturaTablilla(texto, true);
            m.needsUpdate = true;
        });
    });
}

function crearPoste(id, x, z) {
    const poste = new THREE.Group();
    poste.position.set(x, alturaTerreno(x, z) - 0.05, z);
    poste.rotation.y = -0.64;
    const pieza = (geo, mat) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        poste.add(m);
        return m;
    };
    pieza(new THREE.BoxGeometry(0.14, 2.0, 0.14).translate(0, 1.0, -0.06), maderaPoste);
    const tabla = [maderaPoste, maderaPoste, maderaPoste, maderaPoste, materialPoste(id), maderaPoste];
    pieza(new THREE.BoxGeometry(1.35, 0.42, 0.06).translate(0, 1.55, 0.02), tabla);
    pieza(new THREE.BoxGeometry(0.5, 0.05, 0.05).translate(0.22, 1.98, -0.06), maderaPoste);
    const luz = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1).translate(0.42, 1.86, -0.06), farolillo);
    poste.add(luz);
    const halo = new THREE.Sprite(materialHalo);
    halo.position.set(0.42, 1.86, -0.06);
    halo.scale.set(1.1, 1.1, 1);
    poste.add(halo);
    poste.userData.id = id;
    return poste;
}

const SUCESOS = ["carreta", "pozo", "lenas", "arbolCaido", "hornacina", "banco", "ruina", "estandartes", "arco", "hito", "ermita", "muro", "mirador"];
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
    if (tipo === "ermita") ermita(o, lugar(7, 8, 4.6), z, lado);
    if (tipo === "muro") {
        for (let zz = z + 5; zz > z - 5; zz -= 2) o.claro(base + lado * 2.4, zz, 1.4);
        muro(o, z, lado);
    }
    if (tipo === "mirador") mirador(o, lugar(3.4, 3.6, 3.4), z, lado);
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
    // En el trozo del final no hay otro suceso: está el mirador
    const trozoFin = Math.floor((FIN + 3) / largo) === indice;
    const tipo = trozoFin ? null : sucesoDeTrozo(indice);
    if (trozoFin) ponerSuceso(o, "mirador", -(FIN + 3), 1);
    if (tipo && huecos.length) {
        const lado = tipo === "hito" && indice === 0 ? 1 : a() < 0.5 ? -1 : 1;
        ponerSuceso(o, tipo, indice === 0 ? -9 : huecos[0], lado);
        if (huecos.length > 1 && a() < 0.5) ponerSuceso(o, o.elegir(PEQUENOS), huecos[1], -lado);
    }

    // Un poste con el nombre de cada parte del portfolio
    const postes = [];
    if (conCarteles) {
        CARTELES.forEach((c) => {
            const z = -c.metro - 6;
            if (Math.floor(-z / largo) !== indice) return;
            const x = caminoX(z) + 2.0;
            o.claro(x, z, 1.8);
            o.obstaculos.push(x, z);
            postes.push(crearPoste(c.id, x, z));
        });
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
        const malla = new THREE.Mesh(geometria, materialMundo);
        malla.castShadow = malla.receiveShadow = true;
        grupo.add(malla);
    }
    if (o.plantas.length) {
        const malla = new THREE.Mesh(mergeGeometries(o.plantas), materialPlantas);
        malla.castShadow = malla.receiveShadow = true;
        malla.customDepthMaterial = profundidadPlantas;
        grupo.add(malla);
    }
    if (o.hojas.length) {
        const malla = new THREE.Mesh(mergeGeometries(o.hojas), materialHojas);
        malla.castShadow = malla.receiveShadow = true;
        malla.customDepthMaterial = profundidadHojas;
        grupo.add(malla);
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

    postes.forEach((p) => grupo.add(p));
    grupo.userData.claros = o.claros;
    grupo.userData.obstaculos = o.obstaculos;
    grupo.userData.pinos = o.pinos || [];
    escena.add(grupo);
    return grupo;
}

const trozos = new Map();

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
    materialLuciernagas.opacity = 0.7 + Math.sin(tiempo * 3) * 0.3;
}

// =====================================================================
// 13b. HOJAS QUE LLEVA EL VIENTO
// =====================================================================

const cuantosPetalos = movil ? 60 : 130;
const datosPetalos = [];
const coloresPetalo = ["#a8642a", "#c08a3a", "#8a3a1e", "#6a5a2a"].map((c) => new THREE.Color(c));
const posicionesPetalos = new Float32Array(cuantosPetalos * 3);
const coloresPetalos = new Float32Array(cuantosPetalos * 3);
for (let i = 0; i < cuantosPetalos; i++) {
    datosPetalos.push({ x: entre(-10, 10), y: entre(0.2, 3.5), z: entre(-1, -22), fase: entre(0, 6.28), v: entre(0.6, 1.4) });
    coloresPetalo[i % coloresPetalo.length].toArray(coloresPetalos, i * 3);
}
const geometriaPetalos = new THREE.BufferGeometry();
geometriaPetalos.setAttribute("position", new THREE.BufferAttribute(posicionesPetalos, 3));
geometriaPetalos.setAttribute("color", new THREE.BufferAttribute(coloresPetalos, 3));
const materialPetalos = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: texturaRedonda(), alphaTest: 0.5 });
const petalos = new THREE.Points(geometriaPetalos, materialPetalos);

// Polvo de luz: motas que suben despacio y brillan con la luna.
// Viven en una caja alrededor de la cámara y al salir vuelven a entrar.
const cuantoPolvo = movil ? 160 : 320;
const geometriaPolvo = new THREE.BufferGeometry();
const posicionesPolvo = new Float32Array(cuantoPolvo * 3);
const azarPolvo = new Float32Array(cuantoPolvo);
for (let i = 0; i < cuantoPolvo; i++) {
    posicionesPolvo.set([entre(-10, 10), entre(-2, 5), entre(-28, 2)], i * 3);
    azarPolvo[i] = azar();
}
geometriaPolvo.setAttribute("position", new THREE.BufferAttribute(posicionesPolvo, 3));
geometriaPolvo.setAttribute("aAzar", new THREE.BufferAttribute(azarPolvo, 1));
const materialPolvo = new THREE.ShaderMaterial({
    uniforms: { uTiempo: comunes.uTiempo, uCamara: comunes.uCamara, uLuzLuna: comunes.uLuzLuna, uEscala: { value: 1 } },
    vertexShader: `
        attribute float aAzar;
        uniform float uTiempo;
        uniform vec3 uCamara;
        uniform float uEscala;
        varying float vBrillo;
        void main() {
            vec3 caja = vec3(20.0, 7.0, 30.0);
            vec3 esquina = vec3(-10.0, -2.0, -28.0);
            vec3 p = position + vec3(sin(uTiempo * 0.3 + aAzar * 20.0) * 0.6, uTiempo * (0.08 + aAzar * 0.14), -uTiempo * (0.2 + aAzar * 0.2));
            vec3 rel = mod(p - uCamara - esquina, caja) + esquina;
            vec4 vista = viewMatrix * vec4(uCamara + rel, 1.0);
            float borde = smoothstep(-2.0, -0.5, rel.y) * smoothstep(5.0, 3.5, rel.y) * smoothstep(-28.0, -22.0, rel.z) * smoothstep(2.0, -0.5, rel.z) * smoothstep(10.0, 7.0, abs(rel.x));
            vBrillo = borde * (0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTiempo * (1.0 + aAzar * 2.0) + aAzar * 40.0), 3.0));
            gl_PointSize = uEscala * (0.5 + aAzar) / -vista.z;
            gl_Position = projectionMatrix * vista;
        }
    `,
    fragmentShader: `
        uniform vec3 uLuzLuna;
        varying float vBrillo;
        void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = exp(-r * r * 7.0);
            gl_FragColor = vec4((uLuzLuna * 0.8 + vec3(0.12, 0.1, 0.18)) * a * vBrillo * 1.5, 1.0);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const polvo = new THREE.Points(geometriaPolvo, materialPolvo);
polvo.frustumCulled = false;
escena.add(polvo);
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
}

// =====================================================================
// 13c. MURCIÉLAGOS
// Cuatro murciélagos dan vueltas sin orden cerca de la luna. Cada uno son
// dos alas (dos triángulos) que aletean muy rápido; se ven recortados
// contra el cielo.
// =====================================================================

const cuantosMurcielagos = 4;
const geometriaMurcielagos = new THREE.BufferGeometry();
geometriaMurcielagos.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cuantosMurcielagos * 6 * 3), 3));
const materialMurcielagos = new THREE.MeshBasicMaterial({ color: "#04040a", side: THREE.DoubleSide, fog: false });
const murcielagos = new THREE.Mesh(geometriaMurcielagos, materialMurcielagos);
murcielagos.frustumCulled = false;
murcielagos.visible = !movimientoReducido;
escena.add(murcielagos);
const auxMurcielago = new THREE.Vector3();
const derechaVista = new THREE.Vector3();

function moverMurcielagos(tiempo) {
    if (!murcielagos.visible) return;
    const a = geometriaMurcielagos.attributes.position.array;
    const centro = auxMurcielago.copy(camara.position).addScaledVector(DIR_LUNA, 26);
    derechaVista.set(1, 0, 0).applyQuaternion(camara.quaternion);
    for (let i = 0; i < cuantosMurcielagos; i++) {
        const t = tiempo * (0.7 + i * 0.13) + i * 2.1;
        const x = centro.x + Math.sin(t) * 7 + Math.sin(t * 2.7 + i) * 2;
        const y = centro.y - 4 + Math.sin(t * 1.3 + i) * 3 + Math.sin(t * 4.1) * 0.6;
        const z = centro.z + Math.cos(t * 0.8) * 6;
        const aleteo = Math.sin(tiempo * 24 + i * 3) * 0.32;
        const ala = 0.42;
        const k = i * 18;
        // Ala izquierda: delante y detrás del cuerpo y la punta
        const dx = derechaVista.x * ala;
        const dz = derechaVista.z * ala;
        const puntos = [
            [x, y + 0.06, z], [x, y - 0.06, z], [x - dx, y + aleteo, z - dz],
            [x, y + 0.06, z], [x, y - 0.06, z], [x + dx, y + aleteo, z + dz]
        ];
        puntos.forEach((q, j) => a.set(q, k + j * 3));
    }
    geometriaMurcielagos.attributes.position.needsUpdate = true;
}

// =====================================================================
// 13d. FAROLAS QUE PARPADEAN Y POLILLAS
// La llama de las farolas tiembla un poco. Alrededor de las tres farolas
// más cercanas revolotean unas polillas que brillan con su luz.
// =====================================================================

function posicionFarola(i, destino) {
    const zf = -(i + 0.5) * LARGO_TROZO;
    const lado = ((i % 2) + 2) % 2 === 0 ? 1 : -1;
    const x = caminoX(zf) + lado * (SEPARACION_FAROLA - BRAZO_FAROLA);
    return destino.set(x, alturaTerreno(x, zf) + 2.2, zf);
}

const POLILLAS_POR_FAROLA = 7;
const geometriaPolillas = new THREE.BufferGeometry();
geometriaPolillas.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * POLILLAS_POR_FAROLA * 3), 3));
const materialPolillas = new THREE.PointsMaterial({ size: 0.045, map: texturaRedonda(), color: "#ffe0b0", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const polillas = new THREE.Points(geometriaPolillas, materialPolillas);
polillas.frustumCulled = false;
escena.add(polillas);
const datosPolillas = Array.from({ length: 3 * POLILLAS_POR_FAROLA }, () => ({ r: entre(0.18, 0.6), v: entre(1.5, 3.5) * (azar() < 0.5 ? -1 : 1), fase: entre(0, 6.28), alto: entre(-0.35, 0.3) }));
const auxFarola = new THREE.Vector3();

function moverFarolas(tiempo) {
    const parpadeo = movimientoReducido ? 1 : 0.93 + 0.04 * Math.sin(tiempo * 11.3) * Math.sin(tiempo * 4.1) + 0.03 * Math.sin(tiempo * 23.7 + Math.sin(tiempo * 2.0) * 3.0);
    comunes.uParpadeo.value = parpadeo;
    const primera = Math.floor(-camara.position.z / LARGO_TROZO);
    const p = geometriaPolillas.attributes.position;
    for (let f = 0; f < 3; f++) {
        posicionFarola(primera + f, auxFarola);
        for (let k = 0; k < POLILLAS_POR_FAROLA; k++) {
            const d = datosPolillas[f * POLILLAS_POR_FAROLA + k];
            const t = tiempo * d.v + d.fase;
            const tiembla = Math.sin(tiempo * 17 + d.fase * 5) * 0.06;
            p.setXYZ(f * POLILLAS_POR_FAROLA + k, auxFarola.x + Math.cos(t) * d.r + tiembla, auxFarola.y + d.alto + Math.sin(t * 1.7) * 0.15, auxFarola.z + Math.sin(t) * d.r * 0.8);
        }
    }
    p.needsUpdate = true;
    materialPolillas.opacity = parpadeo;
    materialFarol.color.setRGB(parpadeo, 0.7 * parpadeo, 0.36 * parpadeo);
    materialHalo.opacity = 0.75 * parpadeo;
    return parpadeo;
}

// =====================================================================
// 13e. BANCOS DE NIEBLA
// Láminas de niebla blanda pegadas al suelo que van cruzando despacio.
// Viven en una caja alrededor de la cámara; cerca de las farolas se
// tiñen de su luz.
// =====================================================================

const cuantaNiebla = movil ? 12 : 22;
const geometriaNiebla = new THREE.BufferGeometry();
{
    const centros = [];
    const esquinas = [];
    const tams = [];
    const azares = [];
    const indices = [];
    for (let i = 0; i < cuantaNiebla; i++) {
        const c = [entre(-20, 20), 0, entre(-58, 2)];
        const tam = [entre(7, 14), entre(1.4, 2.6)];
        const a = azar();
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((e) => {
            centros.push(...c);
            esquinas.push(...e);
            tams.push(...tam);
            azares.push(a);
        });
        const b = i * 4;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    geometriaNiebla.setAttribute("position", new THREE.Float32BufferAttribute(centros, 3));
    geometriaNiebla.setAttribute("aEsquina", new THREE.Float32BufferAttribute(esquinas, 2));
    geometriaNiebla.setAttribute("aTam", new THREE.Float32BufferAttribute(tams, 2));
    geometriaNiebla.setAttribute("aAzar", new THREE.Float32BufferAttribute(azares, 1));
    geometriaNiebla.setIndex(indices);
}
const fragmentNiebla = `
        uniform float uTiempo;
        uniform float uNoche;
        uniform float uParpadeo;
        uniform vec3 uNiebla;
        uniform vec3 uLuzLuna;
        varying vec2 vEsquina;
        varying vec3 vMundo;
        varying float vFuerza;
        varying float vAzar;
        ${terrenoGLSL}
        void main() {
            float forma = 1.0 - smoothstep(0.2, 1.0, length(vEsquina * vec2(1.0, 1.1)));
            forma *= smoothstep(-1.0, -0.6, vEsquina.y);
            vec2 q = vMundo.xz * 0.35 + vec2(vEsquina.y * 0.8, vAzar * 20.0) + vec2(uTiempo * 0.04, 0.0);
            float jirones = ruido(q) * 0.6 + ruido(q * 2.3 + 5.0) * 0.4;
            float suelo = vMundo.y - alturaTerreno(vMundo.x, vMundo.z);
            float a = forma * smoothstep(0.25, 0.75, jirones) * vFuerza * 0.22 * smoothstep(0.0, 0.6, suelo);
            if (a < 0.003) discard;
            vec3 color = uNiebla * 2.4 + uLuzLuna * 0.28 + vec3(1.0, 0.6, 0.3) * luzFarolas(vMundo) * uNoche * uParpadeo * 0.7;
            gl_FragColor = vec4(color, a);
        }
    `;

const materialNiebla = new THREE.ShaderMaterial({
    uniforms: comunes,
    vertexShader: `
        attribute vec2 aEsquina;
        attribute vec2 aTam;
        attribute float aAzar;
        uniform vec3 uCamara;
        uniform float uTiempo;
        uniform float uViento;
        varying vec2 vEsquina;
        varying vec3 vMundo;
        varying float vFuerza;
        varying float vAzar;
        ${terrenoGLSL}
        void main() {
            vec3 caja = vec3(40.0, 1.0, 60.0);
            vec3 esquina = vec3(-20.0, 0.0, -58.0);
            vec3 p = position + vec3(uTiempo * (0.2 + aAzar * 0.25) * (0.4 + uViento * 0.6), 0.0, 0.0);
            vec3 rel = mod(p - uCamara - esquina, caja) + esquina;
            vec3 centro = uCamara + vec3(rel.x, 0.0, rel.z);
            centro.y = alturaTerreno(centro.x, centro.z) + aTam.y * 0.42;
            vec3 derecha = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
            vec3 mundo = centro + derecha * aEsquina.x * aTam.x * 0.5 + vec3(0.0, aEsquina.y * aTam.y * 0.5, 0.0);
            float lejos = length(centro.xz - uCamara.xz);
            vFuerza = smoothstep(3.0, 9.0, lejos) * (1.0 - smoothstep(42.0, 56.0, lejos)) * (1.0 - smoothstep(14.0, 20.0, abs(rel.x)));
            vEsquina = aEsquina;
            vMundo = mundo;
            vAzar = aAzar;
            gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
        }
    `,
    fragmentShader: fragmentNiebla,
    transparent: true,
    depthWrite: false
});
const niebla = new THREE.Mesh(geometriaNiebla, materialNiebla);
niebla.frustumCulled = false;
niebla.renderOrder = 5;
escena.add(niebla);

// Vaho sobre el arroyo más cercano: unas láminas bajas que siguen su
// curva y se mueven con la corriente
const geometriaVaho = new THREE.BufferGeometry();
{
    const centros = [];
    const esquinas = [];
    const tams = [];
    const azares = [];
    const indices = [];
    for (let i = 0; i < 9; i++) {
        const c = [-16 + i * 4 + entre(-1, 1), 0, 0];
        const tam = [entre(5, 8), entre(0.7, 1.1)];
        const a = azar();
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((e) => {
            centros.push(...c);
            esquinas.push(...e);
            tams.push(...tam);
            azares.push(a);
        });
        indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    geometriaVaho.setAttribute("position", new THREE.Float32BufferAttribute(centros, 3));
    geometriaVaho.setAttribute("aEsquina", new THREE.Float32BufferAttribute(esquinas, 2));
    geometriaVaho.setAttribute("aTam", new THREE.Float32BufferAttribute(tams, 2));
    geometriaVaho.setAttribute("aAzar", new THREE.Float32BufferAttribute(azares, 1));
    geometriaVaho.setIndex(indices);
}
const uniformesVaho = { ...comunes, uArroyoK: { value: 1 } };
const materialVaho = new THREE.ShaderMaterial({
    uniforms: uniformesVaho,
    vertexShader: `
        attribute vec2 aEsquina;
        attribute vec2 aTam;
        attribute float aAzar;
        uniform vec3 uCamara;
        uniform float uTiempo;
        uniform float uArroyoK;
        varying vec2 vEsquina;
        varying vec3 vMundo;
        varying float vFuerza;
        varying float vAzar;
        ${terrenoGLSL}
        void main() {
            float zc = -uArroyoK * ${PERIODO_ARROYO.toFixed(1)};
            float x = caminoX(zc) + position.x + sin(uTiempo * 0.3 + aAzar * 9.0) * 1.2;
            float z = zc + 4.0 * sin(x * 0.12 + uArroyoK * 1.7);
            vec3 centro = vec3(x, alturaTerreno(x, z) + aTam.y * 0.45, z);
            vec3 derecha = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
            vec3 mundo = centro + derecha * aEsquina.x * aTam.x * 0.5 + vec3(0.0, aEsquina.y * aTam.y * 0.5, 0.0);
            float lejos = length(centro.xz - uCamara.xz);
            vFuerza = smoothstep(2.0, 6.0, lejos) * (1.0 - smoothstep(55.0, 75.0, lejos)) * 1.4;
            vEsquina = aEsquina;
            vMundo = mundo;
            vAzar = aAzar;
            gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
        }
    `,
    fragmentShader: fragmentNiebla,
    transparent: true,
    depthWrite: false
});
const vaho = new THREE.Mesh(geometriaVaho, materialVaho);
vaho.frustumCulled = false;
vaho.renderOrder = 5;
escena.add(vaho);

function moverVaho() {
    const z = camara.position.z;
    const k = indiceArroyo(z - 40);
    const zc = -k * PERIODO_ARROYO;
    vaho.visible = k >= 1 && zc > z - 80 && zc < z + 6;
    uniformesVaho.uArroyoK.value = k;
}

// =====================================================================
// 13f. EL CIERVO
// De vez en cuando un ciervo cruza el camino a lo lejos. A mitad se
// para, gira la cabeza hacia ti y sigue andando.
// =====================================================================

const materialCiervo = new THREE.MeshStandardMaterial({ color: "#7a5e46", roughness: 0.9 });
materialCiervo.onBeforeCompile = (shader) => contraluzLuna(shader);
materialCiervo.customProgramCacheKey = () => "ciervo";

function crearCiervo() {
    const ciervo = new THREE.Group();
    const parte = (geometria, x, y, z, padre = ciervo) => {
        const m = new THREE.Mesh(geometria, materialCiervo);
        m.position.set(x, y, z);
        m.castShadow = true;
        padre.add(m);
        return m;
    };
    parte(new THREE.SphereGeometry(0.5, 14, 10).scale(0.62, 0.58, 1.25), 0, 1.05, 0);
    const cuello = new THREE.Group();
    cuello.position.set(0, 1.25, 0.5);
    ciervo.add(cuello);
    parte(new THREE.CylinderGeometry(0.11, 0.16, 0.6, 8).rotateX(-0.5), 0, 0.25, 0.1, cuello);
    const cabeza = new THREE.Group();
    cabeza.position.set(0, 0.55, 0.25);
    cuello.add(cabeza);
    parte(new THREE.ConeGeometry(0.11, 0.42, 8).rotateX(Math.PI / 2 + 0.25), 0, 0, 0.15, cabeza);
    parte(new THREE.SphereGeometry(0.13, 8, 6), 0, 0.03, -0.02, cabeza);
    [-1, 1].forEach((s) => {
        parte(new THREE.ConeGeometry(0.045, 0.16, 5).rotateZ(s * 1.0), s * 0.11, 0.1, -0.05, cabeza);
        // Cuernas: un tallo y dos puntas
        const asta = new THREE.Group();
        asta.position.set(s * 0.06, 0.12, -0.04);
        asta.rotation.z = -s * 0.35;
        cabeza.add(asta);
        parte(new THREE.CylinderGeometry(0.012, 0.02, 0.42, 4).translate(0, 0.21, 0), 0, 0, 0, asta);
        parte(new THREE.CylinderGeometry(0.008, 0.014, 0.2, 4).translate(0, 0.1, 0).rotateX(0.7), 0, 0.2, 0, asta);
        parte(new THREE.CylinderGeometry(0.008, 0.012, 0.18, 4).translate(0, 0.09, 0).rotateZ(-s * 0.7), 0, 0.32, 0, asta);
    });
    const patas = [];
    [[-0.17, 0.42], [0.17, 0.42], [-0.17, -0.45], [0.17, -0.45]].forEach(([x, z]) => {
        const pata = new THREE.Group();
        pata.position.set(x, 0.95, z);
        ciervo.add(pata);
        parte(new THREE.CylinderGeometry(0.045, 0.03, 0.95, 6).translate(0, -0.475, 0), 0, 0, 0, pata);
        patas.push(pata);
    });
    parte(new THREE.ConeGeometry(0.06, 0.16, 6).rotateX(-2.4), 0, 1.15, -0.62);
    ciervo.visible = false;
    escena.add(ciervo);
    return { grupo: ciervo, cabeza, cuello, patas, activo: false, espera: parametros.get("ciervo") === "si" ? 3 : entre(25, 45), t: 0 };
}

const ciervo = crearCiervo();

// Busca una línea que cruce el camino sin árboles, rocas ni objetos en
// medio, lejos del arroyo
function buscarPasoCiervo() {
    const obstaculos = [];
    trozos.forEach((g) => obstaculos.push(g.userData.obstaculos));
    for (let intento = 0; intento < 14; intento++) {
        const z = camara.position.z - entre(15, 24);
        if (Math.abs(arroyo(caminoX(z), z)) < 6) continue;
        const centro = caminoX(z);
        let libre = true;
        for (const lista of obstaculos) {
            for (let i = 0; i < lista.length && libre; i += 2) {
                if (Math.abs(lista[i + 1] - z) < 1.6 && Math.abs(lista[i] - centro) < 15) libre = false;
            }
            if (!libre) break;
        }
        if (libre) return z;
    }
    return null;
}

function moverCiervo(delta, tiempo) {
    const c = ciervo;
    if (!c.activo) {
        c.espera -= delta;
        if (c.espera > 0 || entrada.t < 6 || movimientoReducido) return;
        const z = buscarPasoCiervo();
        if (z === null) {
            c.espera = 4;
            return;
        }
        const lado = azar() < 0.5 ? -1 : 1;
        Object.assign(c, { activo: true, t: 0, z, desde: caminoX(z) + lado * 14, hasta: caminoX(z) - lado * 14, parada: entre(0.42, 0.55) });
        c.grupo.visible = true;
    }
    const largo = Math.abs(c.hasta - c.desde);
    const andar = 1.15;
    const duracion = largo / andar + 3.5;
    c.t += delta;
    const tParada = c.parada * (largo / andar);
    let recorrido;
    let parado = false;
    if (c.t < tParada) recorrido = c.t * andar;
    else if (c.t < tParada + 3.5) {
        recorrido = tParada * andar;
        parado = true;
    } else recorrido = (c.t - 3.5) * andar;
    const k = Math.min(1, recorrido / largo);
    const x = c.desde + (c.hasta - c.desde) * k;
    c.grupo.position.set(x, alturaTerreno(x, c.z), c.z);
    c.grupo.rotation.y = c.hasta > c.desde ? Math.PI / 2 : -Math.PI / 2;
    const paso = parado ? 0 : Math.sin(tiempo * 6.5);
    c.patas.forEach((p, i) => (p.rotation.x = paso * 0.45 * (i === 0 || i === 3 ? 1 : -1)));
    // Parado, gira el cuello hacia la cámara y la cabeza baja un poco al andar
    const mira = parado ? Math.sin(Math.min(1, (c.t - tParada) / 0.6) * Math.PI / 2) * (c.hasta > c.desde ? 1.1 : -1.1) * (c.t < tParada + 2.9 ? 1 : 0) : 0;
    c.cuello.rotation.y += (mira - c.cuello.rotation.y) * Math.min(1, delta * 4);
    c.cabeza.rotation.x = parado ? -0.1 : 0.15 + Math.sin(tiempo * 6.5 * 2) * 0.04;
    if (c.t > duracion) {
        c.activo = false;
        c.grupo.visible = false;
        c.espera = entre(50, 90);
    }
}

// =====================================================================
// 13g. EL ZORRO, EL BÚHO Y LAS RACHAS DE VIENTO
// Un zorro pequeño cruza al trote más cerca que el ciervo y sin pararse.
// De vez en cuando, en un pino junto al camino, se encienden los ojos de
// un búho que parpadea (y ulula si el sonido está puesto). Y alguna
// racha de viento mueve más los árboles y la hierba.
// =====================================================================

const materialZorro = new THREE.MeshStandardMaterial({ color: "#a4532a", roughness: 0.85 });
materialZorro.onBeforeCompile = (shader) => contraluzLuna(shader);
materialZorro.customProgramCacheKey = () => "zorro";
const materialZorroClaro = new THREE.MeshStandardMaterial({ color: "#e8dccb", roughness: 0.9 });

function crearZorro() {
    const zorro = new THREE.Group();
    const parte = (geometria, x, y, z, material = materialZorro, padre = zorro) => {
        const m = new THREE.Mesh(geometria, material);
        m.position.set(x, y, z);
        m.castShadow = true;
        padre.add(m);
        return m;
    };
    parte(new THREE.SphereGeometry(0.2, 12, 8).scale(0.75, 0.7, 1.6), 0, 0.42, 0);
    const cabeza = new THREE.Group();
    cabeza.position.set(0, 0.55, 0.36);
    zorro.add(cabeza);
    parte(new THREE.SphereGeometry(0.11, 10, 8), 0, 0, 0, materialZorro, cabeza);
    parte(new THREE.ConeGeometry(0.06, 0.2, 8).rotateX(Math.PI / 2), 0, -0.03, 0.13, materialZorroClaro, cabeza);
    [-1, 1].forEach((l) => parte(new THREE.ConeGeometry(0.045, 0.12, 4), l * 0.06, 0.1, -0.02, materialZorro, cabeza));
    const cola = new THREE.Group();
    cola.position.set(0, 0.45, -0.3);
    zorro.add(cola);
    parte(new THREE.SphereGeometry(0.09, 8, 6).scale(0.9, 0.9, 3.2).translate(0, 0, -0.26), 0, 0, 0, materialZorro, cola);
    parte(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0, -0.55), 0, 0, 0, materialZorroClaro, cola);
    const patas = [];
    [[-0.08, 0.16], [0.08, 0.16], [-0.08, -0.16], [0.08, -0.16]].forEach(([x, z]) => {
        const pata = new THREE.Group();
        pata.position.set(x, 0.36, z);
        zorro.add(pata);
        parte(new THREE.CylinderGeometry(0.025, 0.018, 0.36, 5).translate(0, -0.18, 0), 0, 0, 0, materialZorro, pata);
        patas.push(pata);
    });
    zorro.visible = false;
    escena.add(zorro);
    return { grupo: zorro, cola, patas, activo: false, espera: parametros.get("zorro") === "si" ? 3 : entre(40, 70), t: 0 };
}

const zorro = crearZorro();

function moverZorro(delta, tiempo) {
    const f = zorro;
    if (!f.activo) {
        f.espera -= delta;
        if (f.espera > 0 || entrada.t < 6 || movimientoReducido || ciervo.activo || metros > FIN - 12) return;
        const z = camara.position.z - entre(9, 15);
        if (Math.abs(arroyo(caminoX(z), z)) < 5) {
            f.espera = 3;
            return;
        }
        const lado = azar() < 0.5 ? -1 : 1;
        Object.assign(f, { activo: true, t: 0, z, desde: caminoX(z) + lado * 11, hasta: caminoX(z) - lado * 11 });
        f.grupo.visible = true;
    }
    const velocidad = 2.8;
    f.t += delta;
    const k = Math.min(1, (f.t * velocidad) / Math.abs(f.hasta - f.desde));
    const x = f.desde + (f.hasta - f.desde) * k;
    f.grupo.position.set(x, alturaTerreno(x, f.z) + Math.abs(Math.sin(tiempo * 11)) * 0.04, f.z);
    f.grupo.rotation.y = f.hasta > f.desde ? Math.PI / 2 : -Math.PI / 2;
    const trote = Math.sin(tiempo * 11);
    f.patas.forEach((p, i) => (p.rotation.x = trote * 0.6 * (i === 0 || i === 3 ? 1 : -1)));
    f.cola.rotation.y = Math.sin(tiempo * 5) * 0.25;
    if (k >= 1) {
        f.activo = false;
        f.grupo.visible = false;
        f.espera = entre(60, 110);
    }
}

// Los ojos del búho: dos puntos amarillos que parpadean
const materialOjo = new THREE.SpriteMaterial({ map: texturaBrillo(), color: "#ffd36a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const ojosBuho = new THREE.Group();
[-1, 1].forEach((l) => {
    const ojo = new THREE.Sprite(materialOjo);
    ojo.position.x = l * 0.07;
    ojo.scale.setScalar(0.16);
    ojosBuho.add(ojo);
});
ojosBuho.visible = false;
escena.add(ojosBuho);
const buhoVisto = { espera: entre(14, 24), t: -1 };

function moverBuho(delta, tiempo) {
    const b = buhoVisto;
    if (b.t < 0) {
        b.espera -= delta;
        if (b.espera > 0 || entrada.t < 6) return;
        b.espera = entre(22, 40);
        // Un pino de delante, a un lado del camino y no muy lejos
        const opciones = [];
        trozos.forEach((g) => {
            const p = g.userData.pinos || [];
            for (let i = 0; i < p.length; i += 3) {
                const dz = camara.position.z - p[i + 1];
                if (dz > 9 && dz < 30 && Math.abs(p[i] - camara.position.x) < 16) opciones.push(p.slice(i, i + 3));
            }
        });
        if (!opciones.length) return;
        const [x, z, alto] = opciones[Math.floor(azar() * opciones.length)];
        // Delante del tronco, del lado de la cámara
        const hacia = new THREE.Vector3(camara.position.x - x, 0, camara.position.z - z).normalize();
        ojosBuho.position.set(x + hacia.x * 1.3, alturaTerreno(x, z) + alto * 0.5, z + hacia.z * 1.3);
        ojosBuho.lookAt(camara.position.x, ojosBuho.position.y, camara.position.z);
        ojosBuho.visible = true;
        b.t = 0;
        if (audio && audio.ctx.state === "running") buho(audio);
    }
    b.t += delta;
    const parpadeo = Math.sin(b.t * 2.3) > 0.97 || Math.sin(b.t * 3.1 + 1) > 0.985 ? 0 : 1;
    materialOjo.opacity = Math.min(1, b.t * 1.5) * (1 - THREE.MathUtils.smoothstep(b.t, 5, 6)) * parpadeo * 0.9;
    if (b.t > 6) {
        b.t = -1;
        ojosBuho.visible = false;
    }
}

// Rachas de viento: cada cierto tiempo el viento sube unos segundos
const rachas = { espera: entre(12, 25), t: -1, base: comunes.uViento.value };

function moverRachas(delta) {
    if (movimientoReducido) return;
    const r = rachas;
    if (r.t < 0) {
        r.espera -= delta;
        if (r.espera <= 0) r.t = 0;
        comunes.uViento.value = r.base;
        return;
    }
    r.t += delta;
    const fuerza = Math.sin(Math.min(1, r.t / 5) * Math.PI);
    comunes.uViento.value = r.base * (1 + fuerza * fuerza * 1.4);
    if (r.t > 5) {
        r.t = -1;
        r.espera = entre(18, 35);
    }
}

// =====================================================================
// 14. CAMINAR
// "metros" es la distancia recorrida.
// =====================================================================

let metros = parseFloat(parametros.get("metros")) || 0;
let metrosObjetivo = metros;
let caminandoSolo = false;
const botonCaminar = document.getElementById("boton-caminar");
const pista = document.getElementById("pista");

if (movil) pista.textContent = "Desliza arriba para andar y de lado para mirar";

function avanzar(cantidad) {
    metrosObjetivo = THREE.MathUtils.clamp(metrosObjetivo + cantidad, 0, FIN);
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

// Para probar: ?metros=120 empieza ya caminado
if (parametros.has("metros")) {
    metros = metrosObjetivo = THREE.MathUtils.clamp(Number(parametros.get("metros")) || 0, 0, FIN);
}

// Al llegar al final, Gargantua sube y crece en el cielo y el botón de
// volver se pone en grande en el centro
const enlaceVolver = document.querySelector(".volver");
const textoVolver = enlaceVolver.textContent;
let alFinal = false;

function moverFinal() {
    const fin = THREE.MathUtils.smoothstep(metros, FIN - 40, FIN - 2);
    gargantua.lerpVectors(gargantuaBase, gargantuaFinal, fin * fin * (3 - 2 * fin));
    uniformesFondo.uAmanecer.value = fin;
    const ahora = metros > FIN - 3;
    if (ahora !== alFinal) {
        alFinal = ahora;
        document.body.classList.toggle("al-final", ahora);
        enlaceVolver.textContent = ahora ? "Volver volando a Gargantua" : textoVolver;
        if (ahora) {
            caminandoSolo = false;
            botonCaminar.classList.remove("activo");
            botonCaminar.setAttribute("aria-pressed", "false");
        }
    }
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
let dedoX = null;
let dedoId = null;
// En el móvil, arrastrar el dedo de lado gira la vista; al soltar vuelve
// despacio hacia delante
const giroDedo = { objetivo: 0, actual: 0, soltado: 0 };

function moverPuntero(evento) {
    // Con dos dedos solo cuenta el primero
    if (evento.pointerType === "touch" && dedoId !== null && evento.pointerId !== dedoId) return;
    puntero.set((evento.clientX / window.innerWidth) * 2 - 1, -(evento.clientY / window.innerHeight) * 2 + 1);
    punteroDentro = true;
    if (evento.pointerType === "touch" && dedoY !== null) {
        const dy = dedoY - evento.clientY;
        const dx = evento.clientX - dedoX;
        // Lo que más se mueva decide: andar (vertical) o mirar (de lado)
        if (Math.abs(dy) >= Math.abs(dx) * 0.8) avanzar(dy * 0.04);
        else giroDedo.objetivo = THREE.MathUtils.clamp(giroDedo.objetivo - (dx / window.innerWidth) * 1.6, -0.75, 0.75);
        dedoY = evento.clientY;
        dedoX = evento.clientX;
    }
}

function soltarDedo(evento) {
    if (evento.pointerType !== "touch" || evento.pointerId !== dedoId) return;
    punteroDentro = false;
    dedoY = null;
    dedoX = null;
    dedoId = null;
    giroDedo.soltado = 0;
}

renderizador.domElement.addEventListener("pointermove", moverPuntero);
renderizador.domElement.addEventListener("pointerdown", (evento) => {
    if (evento.pointerType === "touch") {
        if (dedoId !== null) return;
        dedoId = evento.pointerId;
        dedoY = evento.clientY;
        dedoX = evento.clientX;
    }
    moverPuntero(evento);
});
renderizador.domElement.addEventListener("pointerleave", () => (punteroDentro = false));
renderizador.domElement.addEventListener("pointerup", soltarDedo);
renderizador.domElement.addEventListener("pointercancel", soltarDedo);

function actualizarRaton(delta) {
    if (dedoId === null) {
        giroDedo.soltado += delta;
        if (giroDedo.soltado > 2) giroDedo.objetivo *= Math.exp(-delta * 0.8);
    }
    giroDedo.actual += (giroDedo.objetivo - giroDedo.actual) * Math.min(1, delta * 6);
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
    // Parado, la cámara respira muy despacio, como alguien de pie
    const respira = movimientoReducido ? 0 : 1;
    camara.position.set(
        caminoX(z) * 0.92 + punteroSuave.x * 0.25 + Math.sin(tiempo * 0.23) * 0.04 * respira,
        ajustes.alturaOjos + alturaPuente(z) + Math.sin(metros * 2.4) * 0.035 * paso + Math.sin(tiempo * 0.5) * 0.012 * respira,
        z
    );
    const mirar = Math.atan2(caminoX(z - 10) - caminoX(z), 10) * (movil ? 0.5 : 0.3);
    camara.rotation.set(inclinacion + punteroSuave.y * 0.02 + Math.sin(tiempo * 0.37) * 0.003 * respira, -punteroSuave.x * 0.04 - mirar + giroDedo.actual + Math.sin(tiempo * 0.19) * 0.006 * respira, Math.sin(tiempo * 0.29) * 0.002 * respira);
    comunes.uCamara.value.copy(camara.position);
}

// =====================================================================
// 16. COLORES Y LUCES DE LA ESCENA 3D
// Se ponen una vez al empezar; el parpadeo de las farolas va aparte.
// =====================================================================

function aplicarPaleta() {
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

    luzLunar.color.copy(actual.luz);
    materialMundo.emissive.setRGB(0.012, 0.02, 0.042);

    luzCielo.color.copy(actual.ambiente);
    luzCielo.intensity = actual.fuerzaCielo;
    materialFlores.color.setScalar(0.4);
    materialPetalos.color.setScalar(0.45);
}

// =====================================================================
// 16b. SONIDO (apagado hasta que se pulsa el botón)
// Todo se genera con Web Audio, sin archivos: viento (ruido filtrado),
// el arroyo cuando estás cerca, grillos y algún búho.
// =====================================================================

let audio = null;
const zumbido = crearZumbido();

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
        return { volumen, filtro, fuente };
    };
    return { ctx, general, viento: canal("lowpass", 420, 0.5), agua: canal("bandpass", 1100, 0.7), proximo: 0, buho: ctx.currentTime + 8, ultimoPaso: metros };
}

// Un paso: un golpe corto de ruido que cambia según el suelo. Sobre
// piedra suena seco, con un poco de grava que cruje después; en el
// puente de madera, más grave y hueco; junto al arroyo, la piedra mojada
// chapotea un poco. Cada pie suena algo distinto.
function paso(a, suelo) {
    const t = a.ctx.currentTime;
    a.pie = -(a.pie || 1);
    const tono = 1 + a.pie * 0.06 + (Math.random() - 0.5) * 0.08;
    const golpe = (tipo, frecuencia, q, volumen, largo, retraso = 0) => {
        const fuente = a.ctx.createBufferSource();
        fuente.buffer = a.viento.fuente.buffer;
        const filtro = a.ctx.createBiquadFilter();
        filtro.type = tipo;
        filtro.frequency.value = frecuencia * tono;
        filtro.Q.value = q;
        const vol = a.ctx.createGain();
        vol.gain.setValueAtTime(0.0001, t + retraso);
        vol.gain.linearRampToValueAtTime(volumen, t + retraso + 0.008);
        vol.gain.exponentialRampToValueAtTime(0.0005, t + retraso + largo);
        fuente.connect(filtro).connect(vol).connect(a.general);
        fuente.onended = () => {
            fuente.disconnect();
            vol.disconnect();
        };
        fuente.start(t + retraso, Math.random() * 1.5);
        fuente.stop(t + retraso + largo + 0.05);
    };
    if (suelo === "madera") {
        golpe("lowpass", 620, 5, 0.32, 0.17);
        golpe("bandpass", 210, 8, 0.12, 0.28, 0.01);
    } else if (suelo === "mojado") {
        golpe("bandpass", 1500, 0.9, 0.16, 0.08);
        golpe("highpass", 3200, 0.7, 0.07, 0.22, 0.03);
    } else {
        golpe("bandpass", 1900, 0.9, 0.2, 0.09);
        golpe("highpass", 4200, 0.6, 0.035, 0.14, 0.04);
    }
}

// Un búho a lo lejos: "uu... u-uuu", dos notas graves y suaves
function buho(a) {
    const t = a.ctx.currentTime;
    [[0, 0.5, 1], [0.75, 0.22, 0.85], [1.05, 0.7, 0.92]].forEach(([inicio, largo, tono]) => {
        const osc = a.ctx.createOscillator();
        const vol = a.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(390 * tono, t + inicio);
        osc.frequency.linearRampToValueAtTime(360 * tono, t + inicio + largo);
        vol.gain.setValueAtTime(0, t + inicio);
        vol.gain.linearRampToValueAtTime(0.03, t + inicio + 0.06);
        vol.gain.setValueAtTime(0.03, t + inicio + largo - 0.12);
        vol.gain.linearRampToValueAtTime(0, t + inicio + largo);
        osc.connect(vol).connect(a.general);
        osc.onended = () => {
            osc.disconnect();
            vol.disconnect();
        };
        osc.start(t + inicio);
        osc.stop(t + inicio + largo + 0.05);
    });
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
        grillo(audio);
        audio.proximo = ahora + 0.4 + Math.random() * 1.2;
    }
    if (Math.abs(metros - audio.ultimoPaso) > 0.75) {
        paso(audio, alturaPuente(-metros) > 0.02 ? "madera" : cercaAgua > 0.75 ? "mojado" : "piedra");
        audio.ultimoPaso = metros;
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
    if (zumbido.estado.activo !== sonando) zumbido.alternar();
    botonSonido.classList.toggle("activo", sonando);
    botonSonido.setAttribute("aria-pressed", String(sonando));
});

// =====================================================================
// 16c. CARTELES
// =====================================================================

let cartelAbierto = null;
const cartelesCerrados = new Set();

function mostrarCartel(c) {
    if (cartelAbierto === c) return;
    if (cartelAbierto) document.getElementById(cartelAbierto.id).classList.remove("visible");
    cartelAbierto = c;
    if (c) document.getElementById(c.id).classList.add("visible");
}

function actualizarCarteles() {
    // El cartel que toca es el último que has pasado, mientras no te alejes más de 18 m
    let toca = null;
    CARTELES.forEach((c) => {
        if (metros >= c.metro && metros < c.metro + 18 && !cartelesCerrados.has(c.id)) toca = c;
        // Las letras del poste se encienden al acercarte
        const m = materialesPoste.get(c.id);
        if (m) {
            const cerca = 1 - THREE.MathUtils.smoothstep(Math.abs(metros - (c.metro + 6)), 3, 16);
            m.emissiveIntensity = cerca * 1.6 * comunes.uParpadeo.value;
        }
    });
    mostrarCartel(toca);
}

// Al llegar a cada poste, del farolillo salen chispas de luz que suben
// en espiral y se apagan, como luciérnagas que despiertan
const CHISPAS = movil ? 30 : 48;
const chispas = (() => {
    const n = CARTELES.length * CHISPAS;
    const origen = new Float32Array(n * 3);
    const datos = new Float32Array(n * 4);
    const giro = new THREE.Vector3();
    CARTELES.forEach((c, j) => {
        const z = -c.metro - 6;
        const x = caminoX(z) + 2.0;
        giro.set(0.42, 1.86, -0.06).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.64);
        for (let i = 0; i < CHISPAS; i++) {
            const k = j * CHISPAS + i;
            origen.set([x + giro.x, alturaTerreno(x, z) - 0.05 + giro.y, z + giro.z], k * 3);
            datos.set([j, Math.random(), Math.random(), Math.random()], k * 4);
        }
    });
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(origen, 3));
    geometria.setAttribute("aDatos", new THREE.BufferAttribute(datos, 4));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uInicio: { value: new THREE.Vector4(-99, -99, -99, -99) }, uEscala: { value: 1 } },
        vertexShader: `
            attribute vec4 aDatos;
            uniform float uTiempo;
            uniform vec4 uInicio;
            uniform float uEscala;
            varying float vLuz;
            void main() {
                float inicio = aDatos.x < 0.5 ? uInicio.x : aDatos.x < 1.5 ? uInicio.y : aDatos.x < 2.5 ? uInicio.z : uInicio.w;
                float edad = uTiempo - inicio - aDatos.y * 0.8;
                if (edad < 0.0 || edad > 7.0) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    vLuz = 0.0;
                    return;
                }
                float ang = aDatos.z * 6.2832 + edad * (0.8 + aDatos.w);
                float radio = 0.15 + edad * (0.25 + aDatos.w * 0.35);
                vec3 p = position + vec3(cos(ang) * radio, edad * (0.25 + aDatos.z * 0.3) + sin(edad * 3.0 + aDatos.y * 9.0) * 0.08, sin(ang) * radio);
                vec4 vista = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * vista;
                vLuz = smoothstep(0.0, 0.4, edad) * (1.0 - smoothstep(4.0, 7.0, edad)) * (0.6 + 0.4 * sin(uTiempo * 9.0 + aDatos.y * 30.0));
                gl_PointSize = uEscala * (0.6 + aDatos.w) / -vista.z;
            }
        `,
        fragmentShader: `
            varying float vLuz;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.0, d);
                gl_FragColor = vec4(vec3(1.0, 0.82, 0.48) * a * vLuz * 1.4, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const puntos = new THREE.Points(geometria, material);
    puntos.frustumCulled = false;
    puntos.renderOrder = 6;
    escena.add(puntos);
    return { material, encendidos: new Set() };
})();

function encenderChispas() {
    const inicio = chispas.material.uniforms.uInicio.value;
    chispas.material.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight * 0.065;
    CARTELES.forEach((c, j) => {
        // Se encienden al llegar al poste; si te alejas mucho, se pueden
        // volver a encender a la vuelta
        const cerca = metros > c.metro - 6 && metros < c.metro + 4;
        if (cerca && !chispas.encendidos.has(c.id)) {
            chispas.encendidos.add(c.id);
            inicio.setComponent(j, comunes.uTiempo.value);
        }
        if (Math.abs(metros - c.metro) > 30) chispas.encendidos.delete(c.id);
    });
}

// La barra del recorrido: un punto por poste y otro para el mirador del
// final. Se rellena según avanzas y, al tocar un punto, caminas hasta él
const recorrido = document.getElementById("recorrido");
const recorridoHecho = document.getElementById("recorrido-hecho");
const paradas = [...CARTELES.map((c) => ({ metro: c.metro + 2, nombre: document.querySelector(`#${c.id} h2`).textContent })), { metro: FIN, nombre: "Mirador" }];
const botonesParada = paradas.map((parada) => {
    const b = document.createElement("button");
    b.className = "parada";
    b.textContent = parada.nombre;
    b.title = parada.nombre;
    b.style.left = (parada.metro / FIN) * 100 + "%";
    b.addEventListener("click", () => {
        caminandoSolo = false;
        botonCaminar.classList.remove("activo");
        botonCaminar.setAttribute("aria-pressed", "false");
        cartelesCerrados.clear();
        avanzar(parada.metro - metrosObjetivo);
    });
    recorrido.appendChild(b);
    return b;
});
if (!conCarteles) recorrido.hidden = true;

function moverRecorrido() {
    recorridoHecho.style.transform = `scaleX(${Math.min(1, metros / FIN)})`;
    paradas.forEach((parada, i) => botonesParada[i].classList.toggle("pasada", metros >= parada.metro - 1));
}

document.querySelectorAll(".cartel .cerrar").forEach((boton) => {
    boton.addEventListener("click", () => {
        cartelesCerrados.add(boton.closest(".cartel").id);
        mostrarCartel(null);
    });
});

// =====================================================================
// 17. RENDIMIENTO
// Si los FPS bajan se quita hierba; si sobran, se vuelve a poner. Si
// con la hierba al mínimo sigue lento, se baja la resolución.
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
        if (fps < 45 && resolucion > 1) {
            // Primero se baja la resolución a 1 (en pantallas con mucha
            // densidad casi no se nota con el resplandor y el desenfoque)
            resolucion = 1;
            aplicarResolucion();
            compositor.setPixelRatio(resolucion);
            compositor.setSize(innerWidth, innerHeight);
            materialPolvo.uniforms.uEscala.value = resolucion * innerHeight / 22;
        } else if (fps < 45) {
            // Casi lo último: sin desenfoque ni rayos de luna
            if (calidadHierba <= 0.3 && resolucion <= 0.75 && fps < 34 && paseCine.enabled) paseCine.enabled = false;
            // Último recurso: sin sombras
            else if (calidadHierba <= 0.3 && resolucion <= 0.75 && fps < 30 && luzLunar.castShadow) {
                luzLunar.castShadow = false;
                comunes.uConSombra.value = 0;
            }
            if (calidadHierba <= 0.3 && fps < 38 && resolucion > 0.75) {
                resolucion = Math.max(0.75, resolucion - 0.25);
                aplicarResolucion();
                compositor.setPixelRatio(resolucion);
                compositor.setSize(innerWidth, innerHeight);
                materialPolvo.uniforms.uEscala.value = resolucion * innerHeight / 22;
            }
            calidadHierba = Math.max(0.3, calidadHierba - 0.1);
        } else if (fps > 57) calidadHierba = Math.min(1, calidadHierba + 0.05);
        hierba.geometria.instanceCount = Math.floor(hierba.total * calidadHierba);
    }
}

// =====================================================================
// 18. TAMAÑO DE LA VENTANA
// =====================================================================

// Pasada de cine: desenfoca lo lejano (con la profundidad de la escena,
// sin que lo nítido de cerca manche lo de detrás) y añade los rayos de la
// luna: desde cada píxel se avanza hacia la luna sumando lo que brilla
// en el cielo; los árboles tapan esa luz y dejan haces entre ellos.
class PaseCine extends Pass {
    constructor() {
        super();
        this.uniforms = {
            tDiffuse: { value: null },
            tProfundidad: { value: null },
            uCentro: { value: new THREE.Vector2(0.8, 0.6) },
            uHorizonte: { value: 0.4 },
            uFuerza: { value: 0 },
            uPixel: { value: new THREE.Vector2(1 / innerWidth, 1 / innerHeight) },
            uRadio: { value: 3 },
            uCerca: { value: 0.1 },
            uLejos: { value: 400 }
        };
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform sampler2D tProfundidad;
                uniform vec2 uCentro;
                uniform float uHorizonte;
                uniform float uFuerza;
                uniform vec2 uPixel;
                uniform float uRadio;
                uniform float uCerca;
                uniform float uLejos;
                varying vec2 vUv;
                #define TOMAS ${movil ? 6 : 8}
                #define PASOS ${movil ? 9 : 12}

                float distancia(vec2 uv) {
                    float z = texture2D(tProfundidad, uv).x * 2.0 - 1.0;
                    return 2.0 * uCerca * uLejos / (uLejos + uCerca - z * (uLejos - uCerca));
                }

                // Cuánto se emborrona algo según su distancia
                float emborronar(float d) {
                    return smoothstep(16.0, 70.0, d) * (d > 300.0 ? 0.45 : 0.9);
                }

                void main() {
                    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                    vec3 color = texture2D(tDiffuse, vUv).rgb;
                    float radio = emborronar(distancia(vUv)) * uRadio;
                    if (radio > 0.4) {
                        vec3 suma = color;
                        float pesos = 1.0;
                        for (int i = 0; i < TOMAS; i++) {
                            float a = float(i) * 2.39996 + j * 6.2831;
                            float r = sqrt((float(i) + 0.5) / float(TOMAS)) * radio;
                            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uPixel;
                            float suyo = emborronar(distancia(uv)) * uRadio;
                            float w = clamp(suyo / max(r, 0.5), 0.0, 1.0);
                            suma += texture2D(tDiffuse, uv).rgb * w;
                            pesos += w;
                        }
                        color = suma / pesos;
                    }

                    if (uFuerza > 0.01) {
                        vec2 paso = (uCentro - vUv) / float(PASOS);
                        vec2 p = vUv + paso * j * 0.7;
                        vec3 rayos = vec3(0.0);
                        float peso = 1.0;
                        for (int i = 0; i < PASOS; i++) {
                            vec3 c = texture2D(tDiffuse, p).rgb;
                            float l = dot(c, vec3(0.3, 0.5, 0.2));
                            rayos += c * smoothstep(0.5, 1.4, l) * smoothstep(uHorizonte, uHorizonte + 0.04, p.y) * peso;
                            peso *= 0.93;
                            p += paso;
                        }
                        float lejos = length((vUv - uCentro) * vec2(1.6, 1.0));
                        color += rayos / float(PASOS) * uFuerza * 0.35 * (1.0 - smoothstep(0.1, 0.7, lejos) * 0.85);
                    }
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            depthTest: false,
            depthWrite: false
        });
        this.cuadro = new FullScreenQuad(this.material);
    }

    setSize(ancho, alto) {
        this.uniforms.uPixel.value.set(1 / ancho, 1 / alto);
        this.uniforms.uRadio.value = 2.6 * ancho / Math.max(innerWidth, 1) * (movil ? 1.2 : 1);
    }

    render(renderizador, escribir, leer) {
        this.uniforms.tDiffuse.value = leer.texture;
        this.uniforms.tProfundidad.value = leer.depthTexture;
        this.uniforms.uCerca.value = camara.near;
        this.uniforms.uLejos.value = camara.far;
        renderizador.setRenderTarget(this.renderToScreen ? null : escribir);
        this.cuadro.render(renderizador);
    }

    dispose() {
        this.material.dispose();
        this.cuadro.dispose();
    }
}
const paseCine = new PaseCine();
paseCine.enabled = !ligero;

// El compositor limpia cada pasada él solo
renderizador.autoClear = true;
const destinoEscena = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType });
destinoEscena.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
const compositor = new EffectComposer(renderizador, destinoEscena);
// La copia del compositor compartiría la misma textura de profundidad
// (y leerla mientras se escribe da error): se le pone una propia
compositor.renderTarget2.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
const paseFondo = new RenderPass(escenaFondo, camaraFondo);
const paseEscena = new RenderPass(escena, camara);
paseEscena.clearDepth = true;
compositor.addPass(paseFondo);
compositor.addPass(paseEscena);
compositor.addPass(paseCine);
compositor.addPass(new PaseBrillo({ flotantes: hayFlotantes, escala: movil ? 3 : 2, umbral: 0.62, umbralRaya: 0.85, fuerza: 0.5, raya: 0.18 }));
compositor.addPass(new OutputPass());
compositor.addPass(crearAcabado(comunes.uTiempo));

window.addEventListener("resize", () => {
    aplicarResolucion();
    compositor.setPixelRatio(renderizador.getPixelRatio());
    compositor.setSize(innerWidth, innerHeight);
    ajustarEncuadre();
    materialPolvo.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight / 22;
});
ajustarEncuadre();
materialPolvo.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight / 22;

// =====================================================================
// 19. CARGA DE LAS CAPAS Y BUCLE PRINCIPAL
// =====================================================================

const soloFondo = parametros.get("fondo") === "solo";
if (parametros.has("depurar")) window.__camino = { comunes, luzLunar, escena, camara, renderizador, sucesoDeTrozo };
const reloj = new THREE.Clock();
let tiempo = 0;
let cuadroSombra = -1;
renderizador.shadowMap.autoUpdate = false;
renderizador.shadowMap.needsUpdate = true;

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    if (!movimientoReducido) tiempo += delta;
    comunes.uTiempo.value = tiempo;


    if (caminandoSolo) metrosObjetivo = Math.min(FIN, metrosObjetivo + 1.4 * delta);
    moverFinal(delta);
    metros += (metrosObjetivo - metros) * Math.min(1, delta * 2.5);

    actualizarRaton(delta);
    colocarCamara();
    actualizarTrozos();
    actualizarFondo(metros);
    moverLuciernagas(tiempo);
    moverPetalos(delta, tiempo);
    moverMurcielagos(tiempo);
    moverFarolas(tiempo);
    moverVaho();
    moverCiervo(delta, tiempo);
    moverZorro(delta, tiempo);
    moverBuho(delta, tiempo);
    moverRachas(delta);
    actualizarSonido();
    if (conCarteles) {
        actualizarCarteles();
        encenderChispas();
        moverRecorrido();
    }

    moverEntrada();
    luzDeLaLuna();
    moverFugaz(delta);
    paseEscena.enabled = !soloFondo;
    paseFondo.enabled = soloFondo;
    // Las sombras se repintan cada dos fotogramas (cada tres en el móvil):
    // casi no se nota y es de lo que más cuesta
    cuadroSombra = (cuadroSombra + 1) % (movil ? 3 : 2);
    if (cuadroSombra === 0) renderizador.shadowMap.needsUpdate = true;
    compositor.render();

    revisarRendimiento();
}

Promise.resolve()
    .then(() => {
        crearFondo();
        aplicarPaleta();
        entrada.inicio = performance.now();
        colocarCamara();
        actualizarTrozos(true);
        document.getElementById("cargando").classList.add("oculta");
        animar();
    })
    .catch((error) => {
        document.getElementById("cargando").textContent = "No se pudieron cargar las imágenes.";
        console.error(error);
    });
