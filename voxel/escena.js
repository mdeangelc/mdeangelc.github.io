import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES
// Opciones en la dirección:
//   ?calidad=alta | ligera   -> calidad (en móvil empieza en ligera)
//   ?ambiente=manana | atardecer | noche | lluvia
//   ?vista=1..4              -> cámara inicial
//   ?interfaz=no             -> sin botones (para capturas)
//   ?camara=x,y,z,ox,oy,oz   -> cámara libre en esa posición mirando a ese punto
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = window.innerWidth < 760 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let calidad = parametros.get("calidad") === "alta" || parametros.get("calidad") === "ligera" ? parametros.get("calidad") : movil ? "ligera" : "alta";

// Tamaño del cubo pequeño (el valle, las casas, el castillo)
const VOXEL = 0.5;

const cargando = document.getElementById("cargando");

// =====================================================================
// 2. AZAR Y RUIDO
// Números aleatorios con semilla (siempre sale el mismo valle) y ruido
// suave para dar forma al terreno.
// =====================================================================

function crearAzar(semilla) {
    return function () {
        semilla = (semilla + 0x6d2b79f5) | 0;
        let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

function ruido2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x, y, octavas = 4) {
    let suma = 0;
    let amplitud = 0.5;
    for (let i = 0; i < octavas; i++) {
        suma += ruido2(x, y) * amplitud;
        x = x * 2.03 + 1.7;
        y = y * 2.03 + 9.2;
        amplitud *= 0.5;
    }
    return suma;
}

function cresta2(x, y, octavas = 5) {
    let suma = 0;
    let amplitud = 0.5;
    for (let i = 0; i < octavas; i++) {
        const r = 1 - Math.abs(ruido2(x, y) * 2 - 1);
        suma += r * r * amplitud;
        x = x * 2.1 + 3.1;
        y = y * 2.1 + 1.3;
        amplitud *= 0.5;
    }
    return suma;
}

function suave(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function mezclar(a, b, t) {
    return a + (b - a) * t;
}

// =====================================================================
// 3. EL VALLE: RÍO, CAMINO Y ALTURAS
// El camino sale de delante de la cámara, cruza el río por un puente,
// pasa por la aldea y sube en zigzag hasta la puerta del castillo.
// =====================================================================

const NIVEL_AGUA = 0;
// Río arriba el valle está más alto: el río cae en una cascada
const X_CASCADA = -56;
const ALTO_CASCADA = 9;
const ANCHO_RIO = 3.6;
const CENTRO_CASTILLO = new THREE.Vector3(0, 24, -134);

// El río cruza el valle de izquierda a derecha: para cada x, su z
function rioZ(x) {
    return -30 + 0.32 * x + 7 * Math.sin(x * 0.045 + 0.8) + 2.5 * Math.sin(x * 0.13);
}

// Distancia aproximada al centro del río
function distanciaRio(x, z) {
    const pendiente = (rioZ(x + 0.5) - rioZ(x - 0.5));
    return Math.abs(z - rioZ(x)) / Math.sqrt(1 + pendiente * pendiente);
}

// Puntos por los que pasa el camino (x, z) y la altura en la subida
const puntosCamino = [
    [4, 62, null], [5, 42, null], [1, 22, null], [-3, 2, null], [1, -20, null],
    [7, -44, null], [5, -68, null], [1, -92, null],
    [-11, -99, 5], [9, -103, 11], [-8, -107, 16.5], [9, -110.5, 21.5], [0.25, -113.2, 24], [0.25, -119, 24], [0.25, -125, 24]
];

// Se suaviza con una curva y se guarda como una lista de puntos cada 0.5 m
const curvaCamino = new THREE.CatmullRomCurve3(puntosCamino.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal");
const muestrasCamino = curvaCamino.getSpacedPoints(Math.round(curvaCamino.getLength() / 0.5));
const alturasCamino = (() => {
    const fijos = puntosCamino.map(([x, z, h], i) => ({ i, h, punto: new THREE.Vector3(x, 0, z) })).filter((p) => p.h !== null);
    const primero = { indice: muestrasCamino.findIndex((m) => m.distanceTo(new THREE.Vector3(1, 0, -92)) < 0.6), h: 1.2 };
    const marcas = [primero, ...fijos.map((f) => {
        let mejor = 0;
        let distancia = Infinity;
        muestrasCamino.forEach((m, k) => {
            const d = m.distanceTo(f.punto);
            if (d < distancia) {
                distancia = d;
                mejor = k;
            }
        });
        return { indice: mejor, h: f.h };
    })];
    return muestrasCamino.map((m, k) => {
        if (k <= marcas[0].indice) return null;
        for (let j = 0; j < marcas.length - 1; j++) {
            const a = marcas[j];
            const b = marcas[j + 1];
            if (k >= a.indice && k <= b.indice) return mezclar(a.h, b.h, (k - a.indice) / (b.indice - a.indice));
        }
        return marcas[marcas.length - 1].h;
    });
})();

// Rejilla para buscar rápido el punto del camino más cercano
const rejillaCamino = new Map();
muestrasCamino.forEach((m, k) => {
    const clave = Math.floor(m.x / 4) + "," + Math.floor(m.z / 4);
    if (!rejillaCamino.has(clave)) rejillaCamino.set(clave, []);
    rejillaCamino.get(clave).push(k);
});

function cercaDelCamino(x, z) {
    const cx = Math.floor(x / 4);
    const cz = Math.floor(z / 4);
    let mejor = -1;
    let distancia = Infinity;
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const lista = rejillaCamino.get(cx + i + "," + (cz + j));
            if (!lista) continue;
            lista.forEach((k) => {
                const m = muestrasCamino[k];
                const d = (m.x - x) ** 2 + (m.z - z) ** 2;
                if (d < distancia) {
                    distancia = d;
                    mejor = k;
                }
            });
        }
    }
    return { distancia: Math.sqrt(distancia), indice: mejor };
}

function alturaNatural(x, z) {
    let h = 0.8 + 0.7 * fbm2(x * 0.03, z * 0.03);
    const lado = Math.abs(x);
    h += 20 * suave(42, 125, lado) * (0.6 + 0.8 * fbm2(x * 0.02 + 5, z * 0.02));
    h += 16 * suave(-150, -240, z) * (0.6 + 0.8 * fbm2(x * 0.015, z * 0.015 + 3));

    // La colina del castillo, con la cima plana
    let dc = Math.hypot(x - CENTRO_CASTILLO.x, (z - CENTRO_CASTILLO.z) * 0.9);
    const dcLimpio = dc;
    dc += 9 * (fbm2(x * 0.045 + 7, z * 0.045 - 3) - 0.5) * suave(16, 26, dc);
    const colina = 1 - suave(15, 46, dc);
    h = Math.max(h, 1 + 23.5 * colina * (0.94 + 0.12 * fbm2(x * 0.09, z * 0.09)));
    if (dcLimpio < 16) h = 24;

    // Pequeñas irregularidades para que las laderas no salgan en anillos
    h += 0.5 * (ruido2(x * 0.33, z * 0.33) - 0.5) * suave(1.4, 4, h);

    // Escalón de la cascada: brusco junto al río, suave lejos de él
    const dr = distanciaRio(x, z);
    const escalon = alturaEscalon(x, dr);
    h += escalon;

    // Cauce del río
    const orilla = suave(ANCHO_RIO - 0.8, ANCHO_RIO + 5 + Math.max(0, h - escalon - 3) * 0.6, dr);
    h = mezclar(-1.1 + escalon, h, orilla);
    return h;
}

function alturaEscalon(x, dr) {
    const ancho = mezclar(1.2, 22, suave(9, 34, dr));
    return ALTO_CASCADA * suave(X_CASCADA + ancho, X_CASCADA - ancho, x);
}

// Altura final: la natural, pero el camino se excava en la colina
function altura(x, z) {
    let h = alturaNatural(x, z);
    const c = cercaDelCamino(x, z);
    if (c.indice >= 0 && c.distancia < 3.2) {
        const hc = alturasCamino[c.indice];
        if (hc !== null) {
            const peso = 1 - suave(1.6, 3.2, c.distancia);
            h = mezclar(h, hc, peso);
        }
    }
    return h;
}

function esCamino(x, z) {
    const c = cercaDelCamino(x, z);
    return c.indice >= 0 && c.distancia < 1.45 + (hash2(Math.floor(x * 2), Math.floor(z * 2)) - 0.5) * 0.4;
}

// Dónde cruza el camino el río (para poner el puente)
const cruces = [];
for (let k = 1; k < muestrasCamino.length; k++) {
    const a = muestrasCamino[k - 1];
    const b = muestrasCamino[k];
    const da = a.z - rioZ(a.x);
    const db = b.z - rioZ(b.x);
    if (Math.sign(da) !== Math.sign(db)) cruces.push(k);
}

// =====================================================================
// 4. RENDERIZADOR, POSPROCESO Y LUCES
// Sombras suaves, tono cinematográfico (ACES) y un brillo (bloom)
// discreto para que las ventanas y faroles se vean encendidos.
// =====================================================================

let renderizador;
try {
    renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    if (!renderizador.capabilities.isWebGL2) throw new Error("WebGL2");
} catch (error) {
    cargando.textContent = "Tu navegador no puede mostrar esta escena 3D (hace falta WebGL 2).";
    throw error;
}

renderizador.outputColorSpace = THREE.SRGBColorSpace;
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
// La escena no se mueve: las sombras solo se recalculan cuando cambia la luz
renderizador.shadowMap.autoUpdate = false;
renderizador.shadowMap.needsUpdate = true;
document.body.prepend(renderizador.domElement);
renderizador.domElement.setAttribute("role", "img");
renderizador.domElement.setAttribute("aria-label", "Valle de cubos con un castillo en lo alto de una colina, un río con un puente de piedra y una aldea");

const escena = new THREE.Scene();
escena.fog = new THREE.FogExp2("#c9908a", 0.0045);

const camara = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.3, 2400);
// Capa 1: cosas que no hace falta que salgan en el reflejo del río
// (bosque lejano, lluvia, pájaros), para que el reflejo cueste menos
const CAPA_SIN_REFLEJO = 1;
camara.layers.enable(CAPA_SIN_REFLEJO);

const sol = new THREE.DirectionalLight("#ffb070", 2.2);
sol.castShadow = true;
sol.shadow.bias = -0.0004;
sol.shadow.normalBias = 0.04;
const camaraSombra = sol.shadow.camera;
camaraSombra.left = -110;
camaraSombra.right = 110;
camaraSombra.top = 110;
camaraSombra.bottom = -110;
camaraSombra.near = 1;
camaraSombra.far = 600;
sol.target.position.set(0, 0, -50);
escena.add(sol, sol.target);

const cielo = new THREE.HemisphereLight("#8a8fd0", "#5a4a3a", 0.7);
escena.add(cielo);

const objetivoRender = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { samples: 4, type: THREE.HalfFloatType });
const compositor = new EffectComposer(renderizador, objetivoRender);
compositor.addPass(new RenderPass(escena, camara));
const brillo = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 0.88);
compositor.addPass(brillo);
compositor.addPass(new OutputPass());

function aplicarCalidad() {
    const ratio = calidad === "alta" ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1);
    renderizador.setPixelRatio(ratio);
    renderizador.setSize(window.innerWidth, window.innerHeight);
    compositor.setPixelRatio(ratio);
    compositor.setSize(window.innerWidth, window.innerHeight);
    const lado = calidad === "alta" ? 4096 : 1536;
    if (sol.shadow.mapSize.x !== lado) {
        sol.shadow.mapSize.set(lado, lado);
        if (sol.shadow.map) {
            sol.shadow.map.dispose();
            sol.shadow.map = null;
        }
    }
    brillo.enabled = true;
    renderizador.shadowMap.needsUpdate = true;
}

// =====================================================================
// 5. CIELO
// Una esfera enorme con un shader: degradado, sol, luna, estrellas y
// nubes suaves. La niebla usa el mismo color que el horizonte.
// =====================================================================

const uniformesCielo = {
    uCenit: { value: new THREE.Color("#2c3a78") },
    uHorizonte: { value: new THREE.Color("#f2a07a") },
    uSuelo: { value: new THREE.Color("#3a3050") },
    uColorSol: { value: new THREE.Color("#ffc890") },
    uDireccionSol: { value: new THREE.Vector3(0.7, 0.12, -0.7).normalize() },
    uNoche: { value: 0 },
    uNubes: { value: 0.5 },
    uColorNubes: { value: new THREE.Color("#f0b8a8") },
    uTiempo: { value: 0 }
};

const esferaCielo = new THREE.Mesh(
    new THREE.SphereGeometry(2000, 48, 24),
    new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: uniformesCielo,
        vertexShader: `
            varying vec3 vDireccion;
            void main() {
                vDireccion = normalize(position);
                vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = p.xyww;
            }
        `,
        fragmentShader: `
            uniform vec3 uCenit;
            uniform vec3 uHorizonte;
            uniform vec3 uSuelo;
            uniform vec3 uColorSol;
            uniform vec3 uDireccionSol;
            uniform float uNoche;
            uniform float uNubes;
            uniform vec3 uColorNubes;
            uniform float uTiempo;
            varying vec3 vDireccion;

            float hash(vec3 p) {
                return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
            }
            float hash2(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            float ruido(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
            }
            float fbm(vec2 p) {
                float s = 0.0;
                float a = 0.5;
                for (int i = 0; i < 5; i++) {
                    s += ruido(p) * a;
                    p = p * 2.02 + 3.1;
                    a *= 0.5;
                }
                return s;
            }

            void main() {
                vec3 d = normalize(vDireccion);
                float alto = d.y;
                vec3 color = mix(uHorizonte, uCenit, pow(smoothstep(0.0, 0.6, alto), 0.7));
                color = mix(color, uSuelo, smoothstep(0.0, -0.15, alto));

                float alSol = max(dot(d, normalize(uDireccionSol)), 0.0);
                color += uColorSol * pow(alSol, 8.0) * 0.45 * (1.0 - uNoche);
                color += uColorSol * pow(alSol, 1200.0) * 6.0 * (1.0 - uNoche) * step(0.0, alto);

                // Nubes en una capa plana muy alta
                if (alto > 0.02) {
                    vec2 p = d.xz / (alto + 0.12) * 1.6 + vec2(uTiempo * 0.004, 0.0);
                    float n = fbm(p);
                    float nube = smoothstep(0.62 - uNubes * 0.3, 0.9, n) * smoothstep(0.02, 0.2, alto);
                    float borde = fbm(p + normalize(uDireccionSol.xz) * 0.05);
                    vec3 colorNube = mix(uColorNubes, uColorNubes * 0.6 + uCenit * 0.3, clamp((n - borde) * 6.0 + 0.4, 0.0, 1.0));
                    color = mix(color, colorNube, nube * 0.9);
                }

                // Estrellas y luna
                if (uNoche > 0.01 && alto > 0.0) {
                    vec3 celda = floor(d * 420.0);
                    float estrella = step(0.9975, hash(celda)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + hash(celda + 1.0) * 20.0));
                    color += vec3(estrella) * uNoche * smoothstep(0.05, 0.3, alto) * 1.5;
                    vec3 luna = normalize(vec3(-0.45, 0.42, -0.78));
                    float alLuna = dot(d, luna);
                    color += vec3(0.85, 0.9, 1.1) * smoothstep(0.9993, 0.9995, alLuna) * uNoche * 3.0;
                    color += vec3(0.25, 0.3, 0.5) * pow(max(alLuna, 0.0), 60.0) * uNoche * 0.6;
                }
                gl_FragColor = vec4(color, 1.0);
            }
        `
    })
);
esferaCielo.frustumCulled = false;
esferaCielo.renderOrder = -1;
escena.add(esferaCielo);

// =====================================================================
// 6. COLORES DEL VALLE
// =====================================================================

const color = (hex) => new THREE.Color(hex);
const paleta = {
    hierba: [color("#5f8f3e"), color("#6c9a43"), color("#7aa84b"), color("#577f37")],
    hierbaSeca: color("#9aa452"),
    tierra: color("#7b5a3e"),
    tierraOscura: color("#634631"),
    camino: [color("#b3a891"), color("#a39a84"), color("#958c78"), color("#bdb39c")],
    bordeCamino: color("#7c7462"),
    grava: [color("#8f8a78"), color("#7a7666"), color("#9c9784")],
    arena: color("#c2b48e"),
    roca: [color("#8c867c"), color("#7a756c"), color("#9a9488")],
    nieve: color("#eef2f8"),
    flores: [color("#f4a6c8"), color("#ffffff"), color("#ffe07a"), color("#b9a6ff")],
    bosque: [color("#2f4f3a"), color("#36593f"), color("#28452f")]
};

// =====================================================================
// 7. TERRENO DE CUBOS
// El terreno es un mapa de alturas: cada casilla es una columna de
// cubos. Solo se crean las caras que se ven (la de arriba y los lados
// que quedan al aire). Cada vértice se oscurece un poco si tiene
// vecinos más altos al lado (oclusión ambiental), que es lo que da el
// aspecto de maqueta de cubos bien iluminada.
// =====================================================================

const constructorMalla = () => ({ posiciones: [], normales: [], colores: [], indices: [] });

function cara(m, puntos, normal, col, sombras) {
    const base = m.posiciones.length / 3;
    puntos.forEach((p, i) => {
        m.posiciones.push(p[0], p[1], p[2]);
        m.normales.push(normal[0], normal[1], normal[2]);
        const s = sombras ? sombras[i] : 1;
        m.colores.push(col.r * s, col.g * s, col.b * s);
    });
    // Se gira la diagonal según la oclusión para que no salgan rayas
    if (sombras && sombras[0] + sombras[2] < sombras[1] + sombras[3]) {
        m.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    } else {
        m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
}

function geometriaDe(m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.posiciones, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(m.normales, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(m.colores, 3));
    g.setIndex(m.indices);
    g.computeBoundingSphere();
    return g;
}

const OSCURECER = [0.56, 0.72, 0.87, 1];
// En el terreno los escalones de un cubo se marcan menos (si no, salen anillos)
const OSCURECER_SUELO = [0.7, 0.81, 0.91, 1];

function crearTerreno({ x0, z0, ancho, fondo, paso, hueco, alturaDe, colorDe }) {
    const nx = Math.round(ancho / paso);
    const nz = Math.round(fondo / paso);
    const niveles = new Int32Array((nx + 2) * (nz + 2));
    const indice = (i, j) => (j + 1) * (nx + 2) + (i + 1);
    for (let j = -1; j <= nz; j++) {
        for (let i = -1; i <= nx; i++) {
            const x = x0 + (i + 0.5) * paso;
            const z = z0 + (j + 0.5) * paso;
            niveles[indice(i, j)] = Math.round(alturaDe(x, z) / paso);
        }
    }
    const nivel = (i, j) => niveles[indice(Math.max(-1, Math.min(nx, i)), Math.max(-1, Math.min(nz, j)))];
    const m = constructorMalla();
    const sombra = [0, 0, 0, 0];

    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const x = x0 + i * paso;
            const z = z0 + j * paso;
            if (hueco && hueco(x + paso / 2, z + paso / 2)) continue;
            const n = nivel(i, j);
            const y = n * paso;
            const pendiente = Math.max(Math.abs(nivel(i + 1, j) - n), Math.abs(nivel(i - 1, j) - n), Math.abs(nivel(i, j + 1) - n), Math.abs(nivel(i, j - 1) - n));
            const arriba = colorDe(x + paso / 2, z + paso / 2, y, pendiente, 0, i, j);

            // Cara de arriba: cada esquina mira sus tres vecinos
            const esquinas = [[0, 0], [1, 0], [1, 1], [0, 1]];
            esquinas.forEach(([ei, ej], k) => {
                const di = ei ? 1 : -1;
                const dj = ej ? 1 : -1;
                const a = nivel(i + di, j) > n ? 1 : 0;
                const b = nivel(i, j + dj) > n ? 1 : 0;
                const c = nivel(i + di, j + dj) > n ? 1 : 0;
                sombra[k] = OSCURECER_SUELO[a && b ? 0 : 3 - (a + b + c)];
            });
            cara(m, [[x, y, z], [x, y, z + paso], [x + paso, y, z + paso], [x + paso, y, z]].map((p) => p), [0, 1, 0], arriba, [sombra[0], sombra[3], sombra[2], sombra[1]]);

            // Lados que quedan al aire
            const lados = [
                [1, 0, [1, 0, 0]],
                [-1, 0, [-1, 0, 0]],
                [0, 1, [0, 0, 1]],
                [0, -1, [0, 0, -1]]
            ];
            lados.forEach(([di, dj, normal]) => {
                let vecino = nivel(i + di, j + dj);
                const fuera = (i + di < 0 || i + di >= nx || j + dj < 0 || j + dj >= nz) || (hueco && hueco(x + paso / 2 + di * paso, z + paso / 2 + dj * paso));
                if (fuera) vecino = Math.min(vecino, n) - 6;
                if (vecino >= n) return;
                for (let k = n; k > vecino; k--) {
                    const yArriba = k * paso;
                    const yAbajo = (k === vecino + 1 || n - k > 5) ? vecino * paso : (k - 1) * paso;
                    const profundidad = n - k;
                    const col = colorDe(x + paso / 2, z + paso / 2, yArriba, pendiente, profundidad + 1, i, j);
                    const abajo = k === vecino + 1 || n - k > 5 ? (n - vecino === 1 ? 0.88 : 0.74) : 1;
                    let puntos;
                    if (di === 1) puntos = [[x + paso, yAbajo, z + paso], [x + paso, yAbajo, z], [x + paso, yArriba, z], [x + paso, yArriba, z + paso]];
                    if (di === -1) puntos = [[x, yAbajo, z], [x, yAbajo, z + paso], [x, yArriba, z + paso], [x, yArriba, z]];
                    if (dj === 1) puntos = [[x, yAbajo, z + paso], [x + paso, yAbajo, z + paso], [x + paso, yArriba, z + paso], [x, yArriba, z + paso]];
                    if (dj === -1) puntos = [[x + paso, yAbajo, z], [x, yAbajo, z], [x, yArriba, z], [x + paso, yArriba, z]];
                    cara(m, puntos, normal, col, [abajo, abajo, 1, 1]);
                    if (n - k > 5) break;
                }
            });
        }
    }
    return geometriaDe(m);
}

function colorValle(x, z, y, pendiente, profundidad, i, j) {
    const h = hash2(i * 1.31 + 0.7, j * 0.77 + 3.1);
    const dr = distanciaRio(x, z);
    if (profundidad > 0) {
        if (pendiente > 4 || (y > 14 && pendiente > 2)) return paleta.roca[Math.floor(h * 3)].clone().multiplyScalar(0.92 + h * 0.12);
        if (profundidad === 1 && y > 0.6) return paleta.hierba[3].clone().multiplyScalar(0.85);
        return (profundidad > 2 ? paleta.tierraOscura : paleta.tierra).clone().multiplyScalar(0.9 + h * 0.15);
    }
    if (esCamino(x, z)) {
        const c = cercaDelCamino(x, z);
        if (c.distancia > 1.1) return paleta.bordeCamino.clone().multiplyScalar(0.9 + h * 0.2);
        return paleta.camino[Math.floor(h * 4)].clone().multiplyScalar(0.92 + hash2(i * 3.1, j * 1.7) * 0.12);
    }
    if (y < -0.2) return paleta.grava[Math.floor(h * 3)].clone();
    if (dr < ANCHO_RIO + 1.6 && y < 0.8) return paleta.arena.clone().multiplyScalar(0.9 + h * 0.15);
    if (pendiente >= 4 || (y > 12 && pendiente >= 3)) return paleta.roca[Math.floor(h * 3)].clone().multiplyScalar(0.9 + h * 0.15);
    if (y > 70) return paleta.nieve.clone();
    const manchas = fbm2(x * 0.05, z * 0.05);
    let c = paleta.hierba[Math.floor(h * 3)].clone().lerp(paleta.hierbaSeca, suave(0.55, 0.75, manchas) * 0.6);
    if (y > 30) c.lerp(paleta.bosque[Math.floor(h * 3)], 0.6);
    if (h > 0.985 && y < 6) c = paleta.flores[Math.floor(hash2(i, j) * 4)].clone();
    return c.multiplyScalar(0.9 + hash2(i * 2.1, j * 4.3) * 0.16);
}

// Montañas lejanas con cubos grandes (más baratos y se ven igual de lejos)
function alturaLejana(x, z) {
    let h = alturaNatural(x, z);
    const lejos = suave(-250, -460, z);
    const lados = suave(150, 330, Math.abs(x));
    const montes = 190 * cresta2(x * 0.005 + 4, z * 0.005 - 2) * Math.max(lejos, lados * 0.7);
    return h + montes;
}

function colorLejano(x, z, y, pendiente, profundidad, i, j) {
    const h = hash2(i * 1.7, j * 2.3);
    const lineaNieve = 95 + fbm2(x * 0.02, z * 0.02) * 40;
    if (y > lineaNieve && pendiente < 3) return paleta.nieve.clone().multiplyScalar(0.94 + h * 0.06);
    if (y > lineaNieve * 0.82 || pendiente > 2) return paleta.roca[Math.floor(h * 3)].clone().multiplyScalar(0.8 + h * 0.15);
    if (profundidad > 0) return paleta.tierraOscura.clone();
    return paleta.bosque[Math.floor(h * 3)].clone().multiplyScalar(0.85 + h * 0.2);
}

// Altura real del suelo de cubos en un punto (la del cubo que lo contiene)
function sueloCubos(x, z) {
    const i = Math.floor((x - VALLE.x0) / VOXEL);
    const j = Math.floor((z - VALLE.z0) / VOXEL);
    return Math.round(altura(VALLE.x0 + (i + 0.5) * VOXEL, VALLE.z0 + (j + 0.5) * VOXEL) / VOXEL) * VOXEL;
}

// El punto más bajo del suelo alrededor (para apoyar cosas sin que floten)
function sueloMasBajo(x, z, radio = 1) {
    let minimo = Infinity;
    let maximo = -Infinity;
    for (let i = -radio; i <= radio; i++) {
        for (let j = -radio; j <= radio; j++) {
            const h = sueloCubos(x + i * VOXEL, z + j * VOXEL);
            minimo = Math.min(minimo, h);
            maximo = Math.max(maximo, h);
        }
    }
    return { minimo, desnivel: maximo - minimo };
}

const materialCubos = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });

// Zona fina (valle) y zona gruesa (montañas)
const VALLE = { x0: -84, z0: -182, ancho: 168, fondo: 252 };

function crearValle() {
    const fino = crearTerreno({ ...VALLE, paso: VOXEL, alturaDe: altura, colorDe: colorValle });
    const malla = new THREE.Mesh(fino, materialCubos);
    malla.castShadow = true;
    malla.receiveShadow = true;
    escena.add(malla);

    // Alrededor del valle, cubos de 2 m; más lejos, de 4 m (en calidad ligera, todo de 4 m)
    const dentro = (x, z) => x > VALLE.x0 && x < VALLE.x0 + VALLE.ancho && z > VALLE.z0 && z < VALLE.z0 + VALLE.fondo;
    const MEDIO = { x0: -264, z0: -424, ancho: 528, fondo: 520 };
    const enMedio = (x, z) => x > MEDIO.x0 && x < MEDIO.x0 + MEDIO.ancho && z > MEDIO.z0 && z < MEDIO.z0 + MEDIO.fondo;
    const conMedio = calidad === "alta";
    if (conMedio) {
        const medio = crearTerreno({ ...MEDIO, paso: 2, hueco: dentro, alturaDe: alturaLejana, colorDe: colorLejano });
        const malla = new THREE.Mesh(medio, materialCubos);
        malla.receiveShadow = true;
        escena.add(malla);
    }
    const grueso = crearTerreno({ x0: -720, z0: -900, ancho: 1440, fondo: 1000, paso: 4, hueco: conMedio ? enMedio : dentro, alturaDe: alturaLejana, colorDe: colorLejano });
    const lejos = new THREE.Mesh(grueso, materialCubos);
    lejos.receiveShadow = true;
    escena.add(lejos);
}

// =====================================================================
// 8. AGUA
// La superficie del río refleja de verdad lo que hay alrededor (se
// vuelve a dibujar la escena desde una cámara espejo). Encima se mueven
// ondas suaves, y con lluvia, círculos de gotas.
// =====================================================================

const sombreadorAgua = {
    name: "Agua",
    uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uTiempo: { value: 0 },
        uHondo: { value: new THREE.Color("#1d3a4a") },
        uClaro: { value: new THREE.Color("#4f7f8a") },
        uLluvia: { value: 0 },
        uNiebla: { value: new THREE.Color("#c9908a") },
        uDensidad: { value: 0.0045 }
    },
    vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vMundo;
        void main() {
            vUv = textureMatrix * vec4(position, 1.0);
            vec4 mundo = modelMatrix * vec4(position, 1.0);
            vMundo = mundo.xyz;
            gl_Position = projectionMatrix * viewMatrix * mundo;
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTiempo;
        uniform vec3 uHondo;
        uniform vec3 uClaro;
        uniform float uLluvia;
        uniform vec3 uNiebla;
        uniform float uDensidad;
        varying vec4 vUv;
        varying vec3 vMundo;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float ruido(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        // Anillos de gotas de lluvia
        vec2 gotas(vec2 p, float t) {
            vec2 celda = floor(p);
            vec2 f = fract(p) - 0.5;
            float fase = fract(t * 0.8 + hash(celda) * 7.0);
            vec2 centro = (vec2(hash(celda + 1.3), hash(celda + 4.1)) - 0.5) * 0.5;
            float d = length(f - centro);
            float anillo = sin((d - fase * 0.45) * 60.0) * smoothstep(0.45 * fase + 0.06, 0.45 * fase, d) * (1.0 - fase);
            return normalize(f - centro + 0.0001) * anillo;
        }

        void main() {
            vec2 p = vMundo.xz;
            vec2 onda = vec2(ruido(p * 0.55 + vec2(uTiempo * 0.35, uTiempo * 0.1)) - 0.5, ruido(p * 0.55 + vec2(-uTiempo * 0.2, uTiempo * 0.3) + 7.0) - 0.5);
            onda += vec2(ruido(p * 2.1 + uTiempo * 0.6) - 0.5, ruido(p * 2.1 - uTiempo * 0.5 + 3.0) - 0.5) * 0.4;
            onda += gotas(p * 1.4, uTiempo) * uLluvia * 0.8;

            vec4 uv = vUv;
            uv.xy += onda * 0.032 * uv.w;
            vec3 reflejo = texture2DProj(tDiffuse, uv).rgb;

            vec3 vista = normalize(cameraPosition - vMundo);
            float fresnel = 0.25 + 0.75 * pow(1.0 - max(vista.y, 0.0), 4.0);
            vec3 agua = mix(uHondo, uClaro, ruido(p * 0.2) * 0.5);
            vec3 c = mix(agua, reflejo, fresnel * 0.92);

            float d = length(vMundo - cameraPosition);
            float niebla = 1.0 - exp(-uDensidad * uDensidad * d * d);
            c = mix(c, uNiebla, niebla);
            gl_FragColor = vec4(c, 1.0);
        }
    `
};

let agua = null;

// Cinta plana que sigue el río entre dos x (en el plano XY, como pide Reflector)
function cintaRio(desde, hasta, pasos) {
    const puntos = [];
    const indices = [];
    for (let k = 0; k <= pasos; k++) {
        const x = desde + ((hasta - desde) * k) / pasos;
        const z = rioZ(x);
        const pendiente = rioZ(x + 0.5) - rioZ(x - 0.5);
        const largo = Math.sqrt(1 + pendiente * pendiente);
        const nx = -pendiente / largo;
        const nz = 1 / largo;
        const ancho = ANCHO_RIO + 3.5;
        puntos.push(x - nx * ancho, -(z - nz * ancho), 0, x + nx * ancho, -(z + nz * ancho), 0);
        if (k > 0) {
            const b = k * 2;
            indices.push(b - 2, b - 1, b + 1, b - 2, b + 1, b);
        }
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.Float32BufferAttribute(puntos, 3));
    geometria.setIndex(indices);
    geometria.computeVertexNormals();
    return geometria;
}

function crearAgua() {
    const escalaReflejo = calidad === "alta" ? 0.75 : 0.4;
    agua = new Reflector(cintaRio(X_CASCADA + 0.4, VALLE.x0 + VALLE.ancho + 40, 200), {
        shader: sombreadorAgua,
        textureWidth: Math.round(window.innerWidth * escalaReflejo),
        textureHeight: Math.round(window.innerHeight * escalaReflejo),
        clipBias: 0.003,
        multisample: calidad === "alta" ? 4 : 0
    });
    agua.rotation.x = -Math.PI / 2;
    agua.position.y = NIVEL_AGUA + 0.02;
    escena.add(agua);
    crearCascada();
}

// =====================================================================
// 8b. LA CASCADA
// Río arriba el agua va 9 m más alta (sin reflejo, para no gastar) y
// cae por el escalón en una cortina con rayas que bajan. Abajo hay
// espuma que se abre en círculos y bruma que sube.
// =====================================================================

const aguaViva = {
    uTiempo: { value: 0 },
    uHondo: { value: new THREE.Color("#1d3a4a") },
    uClaro: { value: new THREE.Color("#4f7f8a") },
    uCielo: { value: new THREE.Color("#f2a07a") },
    uNiebla: { value: new THREE.Color("#c9908a") },
    uDensidad: { value: 0.0045 },
    uBrillo: { value: 1 }
};

const ruidoGLSL = `
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float ruido(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    vec3 conNiebla(vec3 c, vec3 mundo, vec3 niebla, float densidad) {
        float d = length(mundo - cameraPosition);
        return mix(c, niebla, 1.0 - exp(-densidad * densidad * d * d));
    }
`;

function crearCascada() {
    // Agua de arriba
    const alta = new THREE.Mesh(
        cintaRio(X_CASCADA - 110, X_CASCADA - 0.9, 60),
        new THREE.ShaderMaterial({
            uniforms: aguaViva,
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
                uniform vec3 uHondo;
                uniform vec3 uClaro;
                uniform vec3 uCielo;
                uniform vec3 uNiebla;
                uniform float uDensidad;
                varying vec3 vMundo;
                ${ruidoGLSL}
                void main() {
                    vec2 p = vMundo.xz;
                    float onda = ruido(p * 0.6 + vec2(uTiempo * 0.9, 0.0)) * 0.6 + ruido(p * 2.0 + vec2(uTiempo * 1.6, uTiempo * 0.3)) * 0.4;
                    vec3 vista = normalize(cameraPosition - vMundo);
                    float fresnel = 0.3 + 0.7 * pow(1.0 - max(vista.y, 0.0), 3.0);
                    vec3 c = mix(mix(uHondo, uClaro, onda), uCielo, fresnel * 0.55);
                    c += vec3(0.9) * step(0.82, onda) * 0.15;
                    gl_FragColor = vec4(conNiebla(c, vMundo, uNiebla, uDensidad), 1.0);
                }
            `
        })
    );
    alta.rotation.x = -Math.PI / 2;
    alta.position.y = NIVEL_AGUA + ALTO_CASCADA + 0.02;
    escena.add(alta);

    // Cortina que cae: arriba en el borde del escalón y abajo un poco hacia delante
    const columnas = 28;
    const filas = 24;
    const puntos = [];
    const uvs = [];
    const indices = [];
    const zCentro = rioZ(X_CASCADA);
    const anchoCortina = ANCHO_RIO + 0.6;
    for (let j = 0; j <= filas; j++) {
        const v = j / filas;
        for (let i = 0; i <= columnas; i++) {
            const u = i / columnas;
            const x = X_CASCADA - 1.3 + 2.8 * Math.sqrt(v) + Math.sin(u * 9) * 0.08;
            const y = NIVEL_AGUA + ALTO_CASCADA + 0.05 - v * (ALTO_CASCADA + 0.05);
            const z = zCentro + (u - 0.5) * 2 * anchoCortina * (1 - v * 0.08);
            puntos.push(x, y, z);
            uvs.push(u, v);
            if (i > 0 && j > 0) {
                const a = j * (columnas + 1) + i;
                const b = a - 1;
                const c = a - (columnas + 1);
                const d = c - 1;
                indices.push(d, b, a, d, a, c);
            }
        }
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.Float32BufferAttribute(puntos, 3));
    geometria.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometria.setIndex(indices);
    const cortina = new THREE.Mesh(
        geometria,
        new THREE.ShaderMaterial({
            uniforms: aguaViva,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vMundo;
                void main() {
                    vUv = uv;
                    vec4 m = modelMatrix * vec4(position, 1.0);
                    vMundo = m.xyz;
                    gl_Position = projectionMatrix * viewMatrix * m;
                }
            `,
            fragmentShader: `
                uniform float uTiempo;
                uniform vec3 uClaro;
                uniform vec3 uNiebla;
                uniform float uDensidad;
                uniform float uBrillo;
                varying vec2 vUv;
                varying vec3 vMundo;
                ${ruidoGLSL}
                void main() {
                    float rayas = ruido(vec2(vUv.x * 30.0, vUv.y * 3.0 - uTiempo * 2.6)) * 0.6 + ruido(vec2(vUv.x * 70.0, vUv.y * 9.0 - uTiempo * 4.5)) * 0.4;
                    vec3 blanco = vec3(0.9, 0.95, 1.0) * uBrillo;
                    vec3 c = mix(uClaro * 1.15, blanco, smoothstep(0.32, 0.78, rayas));
                    c = mix(c, blanco, smoothstep(0.72, 1.0, vUv.y) * 0.8);
                    float a = 0.72 + rayas * 0.28;
                    a *= smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.93, 1.0, vUv.x));
                    a *= smoothstep(0.0, 0.03, vUv.y);
                    gl_FragColor = vec4(conNiebla(c, vMundo, uNiebla, uDensidad), a);
                }
            `
        })
    );
    cortina.renderOrder = 2;
    escena.add(cortina);

    // Espuma en el pozo de abajo
    const espuma = new THREE.Mesh(
        new THREE.CircleGeometry(1, 40),
        new THREE.ShaderMaterial({
            uniforms: aguaViva,
            transparent: true,
            depthWrite: false,
            vertexShader: `
                varying vec2 vLocal;
                varying vec3 vMundo;
                void main() {
                    vLocal = position.xy;
                    vec4 m = modelMatrix * vec4(position, 1.0);
                    vMundo = m.xyz;
                    gl_Position = projectionMatrix * viewMatrix * m;
                }
            `,
            fragmentShader: `
                uniform float uTiempo;
                uniform vec3 uNiebla;
                uniform float uDensidad;
                uniform float uBrillo;
                varying vec2 vLocal;
                varying vec3 vMundo;
                ${ruidoGLSL}
                void main() {
                    float r = length(vLocal);
                    vec2 dir = vLocal / max(r, 0.001);
                    float n = ruido(dir * 3.0 + vec2(r * 6.0 - uTiempo * 1.5)) * 0.6 + ruido(vMundo.xz * 3.0 + uTiempo) * 0.4;
                    float a = smoothstep(0.45, 0.75, n) * (1.0 - smoothstep(0.55, 1.0, r)) * 0.85;
                    gl_FragColor = vec4(conNiebla(vec3(0.92, 0.96, 1.0) * uBrillo, vMundo, uNiebla, uDensidad), a);
                }
            `
        })
    );
    espuma.rotation.x = -Math.PI / 2;
    espuma.scale.set(5.5, 3.6, 1);
    espuma.position.set(X_CASCADA + 3, NIVEL_AGUA + 0.06, zCentro);
    espuma.renderOrder = 3;
    escena.add(espuma);
}

// =====================================================================
// 9. MOTOR DE CUBOS PARA OBJETOS
// Casas, castillo, puente y árboles se construyen cubo a cubo en una
// rejilla. Al final solo se dibujan las caras que tocan el aire, con
// su oclusión ambiental. Los cubos "luz" (ventanas, faroles) van aparte
// para que brillen por la noche.
// =====================================================================

class Cubos {
    constructor(tam = VOXEL) {
        this.tam = tam;
        this.mapa = new Map();
    }

    clave(x, y, z) {
        return ((x + 2048) * 1024 + (y + 256)) * 4096 + (z + 2048);
    }

    poner(x, y, z, col, luz = false) {
        this.mapa.set(this.clave(x, y, z), { x, y, z, col, luz });
    }

    quitar(x, y, z) {
        this.mapa.delete(this.clave(x, y, z));
    }

    hay(x, y, z) {
        return this.mapa.has(this.clave(x, y, z));
    }

    caja(x0, y0, z0, x1, y1, z1, col, luz = false) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
                for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
                    this.poner(x, y, z, typeof col === "function" ? col(x, y, z) : col, luz);
    }

    // Convierte los cubos en dos geometrías: sólida y luces
    geometrias() {
        const solida = constructorMalla();
        const luces = constructorMalla();
        const t = this.tam;
        const direcciones = [
            [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
        ];
        this.mapa.forEach((v) => {
            const variar = 0.94 + hash2(v.x * 0.37 + v.z * 1.13, v.y * 0.71) * 0.12;
            direcciones.forEach((n) => {
                if (this.hay(v.x + n[0], v.y + n[1], v.z + n[2])) return;
                // Ejes de la cara
                const u = n[0] !== 0 ? [0, 1, 0] : [1, 0, 0];
                const w = n[2] !== 0 ? [0, 1, 0] : n[1] !== 0 ? [0, 0, 1] : [0, 0, 1];
                const centro = [v.x + 0.5 + n[0] * 0.5, v.y + 0.5 + n[1] * 0.5, v.z + 0.5 + n[2] * 0.5];
                const esquinas = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
                const sombras = esquinas.map(([su, sw]) => {
                    if (v.luz) return 1;
                    const a = this.hay(v.x + n[0] + u[0] * su, v.y + n[1] + u[1] * su, v.z + n[2] + u[2] * su) ? 1 : 0;
                    const b = this.hay(v.x + n[0] + w[0] * sw, v.y + n[1] + w[1] * sw, v.z + n[2] + w[2] * sw) ? 1 : 0;
                    const c = this.hay(v.x + n[0] + u[0] * su + w[0] * sw, v.y + n[1] + u[1] * su + w[1] * sw, v.z + n[2] + u[2] * su + w[2] * sw) ? 1 : 0;
                    return OSCURECER[a && b ? 0 : 3 - (a + b + c)];
                });
                let puntos = esquinas.map(([su, sw]) => [
                    (centro[0] + (u[0] * su + w[0] * sw) * 0.5) * t,
                    (centro[1] + (u[1] * su + w[1] * sw) * 0.5) * t,
                    (centro[2] + (u[2] * su + w[2] * sw) * 0.5) * t
                ]);
                let s = sombras;
                // Orden de los vértices para que la cara mire hacia fuera
                const e1 = puntos[1].map((p, i) => p - puntos[0][i]);
                const e2 = puntos[2].map((p, i) => p - puntos[0][i]);
                const cruz = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
                if (cruz[0] * n[0] + cruz[1] * n[1] + cruz[2] * n[2] < 0) {
                    puntos = [puntos[0], puntos[3], puntos[2], puntos[1]];
                    s = [s[0], s[3], s[2], s[1]];
                }
                const col = v.col.clone().multiplyScalar(v.luz ? 1 : variar);
                cara(v.luz ? luces : solida, puntos, n, col, s);
            });
        });
        return { solida: geometriaDe(solida), luces: luces.indices.length ? geometriaDe(luces) : null };
    }
}

// Colores de construcción
const piedras = [color("#c9c2b6"), color("#bdb5a8"), color("#ada597"), color("#d4cec3")];
const piedrasOscuras = [color("#8d8679"), color("#7d776c"), color("#9a9386")];
const colores = {
    tejaCastillo: [color("#4a5590"), color("#3f4a80"), color("#55619c")],
    teja: [color("#a5503a"), color("#93452f"), color("#b65d42")],
    tejaGris: [color("#5c6070"), color("#6a6e7e")],
    yeso: color("#ece4d2"),
    yesoSombra: color("#dcd2bd"),
    madera: color("#6b4a33"),
    maderaClara: color("#8d6a4a"),
    maderaOscura: color("#4a3426"),
    oro: color("#e2b44c"),
    bandera: color("#c23b3b"),
    banderaAzul: color("#3f63c8"),
    ventana: color("#ffbf66"),
    ventanaFria: color("#2a3348"),
    farol: color("#ffcf7a"),
    hojas: [color("#4f7f3a"), color("#5d8e41"), color("#447233"), color("#6b9c48")],
    otono: [color("#d4782c"), color("#e09238"), color("#c25e26"), color("#eab04a")],
    rojo: [color("#b8402e"), color("#cc5536"), color("#a33427")],
    pino: [color("#2e5a3e"), color("#356545"), color("#284f36")],
    tronco: color("#5a4030"),
    paja: color("#d1b46a")
};

const elegir = (lista, azar) => lista[Math.floor(azar() * lista.length)];

// Todas las piezas se juntan aquí y al final se crean dos mallas
const piezasSolidas = [];
const piezasLuz = [];

function colocar(cubos, x, y, z, giro = 0) {
    const { solida, luces } = cubos.geometrias();
    [solida, luces].forEach((g) => {
        if (!g) return;
        g.rotateY(giro);
        g.translate(x, y, z);
    });
    piezasSolidas.push(solida);
    if (luces) piezasLuz.push(luces);
}

// ---------------------------------------------------------------------
// Formas útiles
// ---------------------------------------------------------------------

function torreRedonda(c, cx, cz, y0, alto, radio, azar, conVentanas = true) {
    for (let y = y0; y < y0 + alto; y++) {
        for (let x = -radio - 1; x <= radio + 1; x++) {
            for (let z = -radio - 1; z <= radio + 1; z++) {
                const d = Math.hypot(x, z);
                if (d > radio + 0.3 || d < radio - 1.3) continue;
                let col = elegir(piedras, azar);
                if ((y - y0) % 7 === 0) col = piedrasOscuras[0];
                const esVentana = conVentanas && (y - y0) % 9 >= 5 && (y - y0) % 9 <= 6 && y > y0 + 6 && y < y0 + alto - 3 && Math.abs(Math.atan2(z, x) % (Math.PI / 2)) < 0.12 && d > radio - 0.6;
                if (esVentana) c.poner(cx + x, y, cz + z, azar() < 0.75 ? colores.ventana : colores.ventanaFria, azar() < 0.75);
                else c.poner(cx + x, y, cz + z, col);
            }
        }
    }
    // Almenas
    for (let x = -radio - 1; x <= radio + 1; x++) {
        for (let z = -radio - 1; z <= radio + 1; z++) {
            const d = Math.hypot(x, z);
            if (d > radio + 0.8 || d < radio - 0.5) continue;
            c.poner(cx + x, y0 + alto, cz + z, elegir(piedras, azar));
            if ((Math.round(Math.atan2(z, x) * radio) & 1) === 0) c.poner(cx + x, y0 + alto + 1, cz + z, elegir(piedras, azar));
        }
    }
}

function tejadoCono(c, cx, cz, y0, radio, alto, lista, azar, punta = true) {
    for (let k = 0; k < alto; k++) {
        const r = (radio + 1) * (1 - k / alto);
        for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
            for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
                if (Math.hypot(x, z) <= r) c.poner(cx + x, y0 + k, cz + z, (k % 3 === 0 ? lista[1] : lista[0]).clone().multiplyScalar(0.95 + azar() * 0.1));
            }
        }
    }
    if (punta) {
        c.caja(cx, y0 + alto, cz, cx, y0 + alto + 3, cz, colores.oro);
        // La tela de la bandera se añade aparte para que ondee
        if (c.banderas) c.banderas.push({ x: cx, y: y0 + alto + 3, z: cz });
    }
}

// Tejado a dos aguas a lo largo de x
function tejadoDosAguas(c, x0, x1, z0, z1, y0, lista, azar) {
    const ancho = z1 - z0;
    const mitad = Math.ceil(ancho / 2) + 1;
    for (let k = 0; k <= mitad; k++) {
        for (let x = x0 - 1; x <= x1 + 1; x++) {
            [z0 - 1 + k, z1 + 1 - k].forEach((z) => {
                const fila = lista[(k + (x & 1)) % lista.length];
                c.poner(x, y0 + k, z, fila.clone().multiplyScalar(0.93 + azar() * 0.12));
            });
        }
        // Rellenar los hastiales
        if (z0 - 1 + k <= z1 + 1 - k) {
            for (let z = z0 + k; z <= z1 - k; z++) {
                c.poner(x0, y0 + k, z, colores.yesoSombra);
                c.poner(x1, y0 + k, z, colores.yesoSombra);
            }
        }
    }
}

// ---------------------------------------------------------------------
// El castillo
// ---------------------------------------------------------------------

function crearCastillo() {
    const azar = crearAzar(77);
    const c = new Cubos();
    const piedra = () => elegir(piedras, azar);

    // Muralla rectangular con camino de ronda y almenas
    const mx = 26;
    const mz = 22;
    const altoMuro = 12;
    for (let x = -mx; x <= mx; x++) {
        for (let z = -mz; z <= mz; z++) {
            const borde = Math.abs(x) >= mx - 1 || Math.abs(z) >= mz - 1;
            if (!borde) continue;
            for (let y = 0; y < altoMuro; y++) c.poner(x, y, z, y === 0 ? piedrasOscuras[1] : piedra());
            if ((x + z) % 2 === 0) c.poner(x, altoMuro, z, piedra());
        }
    }
    c.banderas = [];

    // Patio empedrado
    c.caja(-mx + 2, -1, -mz + 2, mx - 2, -1, mz - 2, () => elegir([piedrasOscuras[2], piedrasOscuras[0], color("#a39a84"), color("#8f8676")], azar));

    // Torres de las esquinas
    [[-mx, -mz], [mx, -mz], [-mx, mz], [mx, mz]].forEach(([x, z], i) => {
        const alto = 22 + (i % 2) * 4;
        torreRedonda(c, x, z, 0, alto, 4, azar);
        tejadoCono(c, x, z, alto + 2, 5, 13 + (i % 2) * 3, colores.tejaCastillo, azar);
    });

    // Puerta: dos torres cuadradas y un arco
    [-6, 6].forEach((x) => {
        c.caja(x - 3, 0, mz - 2, x + 3, 18, mz + 3, () => piedra());
        for (let y = 0; y < 3; y++) for (let k = x - 3; k <= x + 3; k += 2) c.poner(k, 19 + (y > 0 ? 0 : 0), mz + 3, piedra());
        tejadoCono(c, x, mz, 19, 4, 9, colores.tejaCastillo, azar, x > 0);
        c.poner(x, 12, mz + 4, colores.ventana, true);
        c.poner(x, 13, mz + 4, colores.ventana, true);
    });
    c.caja(-3, 0, mz - 1, 3, 13, mz + 2, () => piedra());
    // Hueco del arco
    for (let x = -2; x <= 2; x++) {
        const altoArco = 6 + Math.round(Math.sqrt(Math.max(0, 9 - x * x)));
        for (let y = 0; y < altoArco; y++) for (let z = mz - 2; z <= mz + 2; z++) c.quitar(x, y, z);
    }
    // Rastrillo levantado: solo asoma la parte de abajo dentro del arco
    for (let x = -2; x <= 2; x++) c.poner(x, 7, mz - 2, color("#3a3a42"));
    c.poner(-3, 7, mz + 3, colores.farol, true);
    c.poner(3, 7, mz + 3, colores.farol, true);
    // Estandartes a los lados de la puerta
    [-10, 10].forEach((x) => c.caja(x, 4, mz + 1, x + 1, 10, mz + 1, colores.bandera));
    [-10, 10].forEach((x) => c.caja(x, 3, mz + 1, x + 1, 3, mz + 1, colores.oro));

    // Torre del homenaje: un edificio grande con tejado y dos torres altas
    c.caja(-12, 0, -14, 12, 26, 2, (x, y, z) => {
        const ventana = y > 4 && y % 6 >= 3 && y % 6 <= 4 && (x % 4 === 0) && (z === 2 || z === -14);
        return ventana ? colores.ventana : piedra();
    });
    // Ventanas encendidas como luces
    for (let x = -12; x <= 12; x += 4) {
        for (let y = 7; y < 26; y += 6) {
            if (azar() < 0.7) {
                c.poner(x, y, 3, colores.ventana, true);
                c.poner(x, y + 1, 3, colores.ventana, true);
            }
        }
    }
    tejadoDosAguas(c, -12, 12, -14, 2, 27, colores.tejaCastillo, azar);
    torreRedonda(c, -6, -6, 0, 52, 5, azar);
    tejadoCono(c, -6, -6, 54, 6, 22, colores.tejaCastillo, azar);
    torreRedonda(c, 7, -10, 0, 42, 4, azar);
    tejadoCono(c, 7, -10, 44, 5, 16, colores.tejaCastillo, azar);
    torreRedonda(c, 9, 0, 20, 18, 3, azar);
    tejadoCono(c, 9, 0, 40, 4, 12, colores.tejaCastillo, azar);
    // Capilla del patio con vidriera
    c.caja(-22, 0, 4, -14, 9, 14, () => piedra());
    tejadoDosAguas(c, -22, -14, 4, 14, 10, colores.tejaCastillo, azar);
    c.caja(-18, 4, 15, -17, 7, 15, colores.ventana, true);

    patioCastillo(c, azar);

    // Cimientos: todo lo que toca el suelo baja 5 m, por si la colina no es plana
    const apoyos = [];
    c.mapa.forEach((v) => {
        if (v.y === 0) apoyos.push([v.x, v.z]);
    });
    apoyos.forEach(([x, z]) => {
        for (let y = -10; y < 0; y++) if (!c.hay(x, y, z)) c.poner(x, y, z, elegir(piedrasOscuras, azar));
    });

    const origen = new THREE.Vector3(CENTRO_CASTILLO.x, CENTRO_CASTILLO.y, CENTRO_CASTILLO.z + 4);
    colocar(c, origen.x, origen.y, origen.z, 0);
    c.banderas.forEach((b) => banderasCastillo.push(new THREE.Vector3(origen.x + (b.x + 0.5) * VOXEL, origen.y + (b.y + 0.5) * VOXEL, origen.z + (b.z + 0.5) * VOXEL)));
    // Bisagra del puente levadizo: al pie de la puerta, por fuera
    bisagraPuerta.set(origen.x + 0.25, origen.y, origen.z + (mz + 4) * VOXEL);
    lucesCalidas.push(new THREE.Vector3(origen.x, origen.y + 3, origen.z + (mz + 5) * VOXEL), new THREE.Vector3(origen.x + 3, origen.y + 2, origen.z + 9 * VOXEL));
}

const banderasCastillo = [];
const bisagraPuerta = new THREE.Vector3();

// Cosas del patio: puestos de mercado, pozo, barriles, heno, un muñeco
// de entrenamiento, un árbol y antorchas en la fachada
function patioCastillo(c, azar) {
    const toldo = (x0, z0, colorA, colorB) => {
        [[x0, z0], [x0 + 6, z0], [x0, z0 + 4], [x0 + 6, z0 + 4]].forEach(([x, z]) => c.caja(x, 0, z, x, 5, z, colores.madera));
        for (let x = x0 - 1; x <= x0 + 7; x++) for (let z = z0 - 1; z <= z0 + 5; z++) c.poner(x, 6 + (z === z0 - 1 || z === z0 + 5 ? -1 : 0), z, (x & 1) ? colorA : colorB);
        c.caja(x0, 2, z0 + 1, x0 + 6, 2, z0 + 3, colores.maderaClara);
        for (let x = x0 + 1; x < x0 + 6; x += 2) c.poner(x, 3, z0 + 2, elegir([color("#d24a3a"), color("#e8b23a"), color("#7cae3a"), color("#e07a2a")], azar));
    };
    toldo(7, 12, color("#c23b3b"), color("#efe6d6"));
    toldo(15, 4, color("#3f63c8"), color("#e8c84a"));
    // Pozo
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) === 2 || Math.abs(z) === 2) c.caja(-8 + x, 0, 10 + z, -8 + x, 1, 10 + z, elegir(piedras, azar));
    c.caja(-9, 0, 9, -7, 0, 11, color("#2a3a5a"));
    c.caja(-10, 2, 10, -10, 5, 10, colores.madera);
    c.caja(-6, 2, 10, -6, 5, 10, colores.madera);
    c.caja(-10, 6, 9, -6, 6, 11, colores.tejaCastillo[0]);
    // Barriles y heno junto a la muralla
    [[20, 17], [22, 17], [21, 15], [-20, 17], [22, -6]].forEach(([x, z]) => {
        c.caja(x, 0, z, x + 1, 2, z + 1, colores.maderaClara);
        c.caja(x, 1, z, x + 1, 1, z + 1, colores.maderaOscura);
    });
    c.caja(-22, 0, 16, -18, 2, 19, colores.paja);
    // Muñeco de entrenamiento
    c.caja(19, 0, -12, 19, 6, -12, colores.madera);
    c.caja(17, 4, -12, 21, 4, -12, colores.madera);
    c.caja(18, 5, -12, 20, 7, -12, colores.paja);
    // Árbol del patio
    for (let y = 0; y < 6; y++) c.poner(-16, y, -4, colores.tronco);
    for (let x = -3; x <= 3; x++) for (let y = -2; y <= 3; y++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, y * 1.3, z) < 3.2 && azar() > 0.1) c.poner(-16 + x, 8 + y, -4 + z, elegir(colores.hojas, azar));
    // Antorchas en la fachada de la torre del homenaje
    [-10, 10].forEach((x) => {
        c.poner(x, 6, 3, colores.maderaOscura);
        c.poner(x, 7, 3, colores.farol, true);
    });
}

// ---------------------------------------------------------------------
// Casas de la aldea: cada una con su uso y su tamaño
// ---------------------------------------------------------------------

function casa(tipo, semilla) {
    const azar = crearAzar(semilla);
    const c = new Cubos();
    const piedra = () => elegir(piedrasOscuras, azar);
    const tejas = tipo === "capilla" ? colores.tejaGris : colores.teja;

    const medidas = {
        casita: [7, 6, 7],
        taberna: [11, 8, 13],
        molino: [8, 7, 9],
        granero: [10, 7, 8],
        capilla: [7, 6, 12]
    }[tipo];
    const [ax, az, alto] = [Math.floor(medidas[0] / 2), Math.floor(medidas[1] / 2), medidas[2]];

    // Zócalo de piedra (baja bajo tierra por si el suelo no es plano)
    c.caja(-ax, -6, -az, ax, 1, az, () => piedra());
    // Paredes: yeso con entramado de madera (o madera en el granero)
    for (let y = 2; y < alto; y++) {
        for (let x = -ax; x <= ax; x++) {
            for (let z = -az; z <= az; z++) {
                if (Math.abs(x) !== ax && Math.abs(z) !== az) continue;
                let col = colores.yeso;
                const esquina = Math.abs(x) === ax && Math.abs(z) === az;
                const viga = esquina || y === 2 || y === alto - 1 || y === Math.floor(alto / 2) + 1 || (x % 3 === 0 && Math.abs(z) === az) || (z % 3 === 0 && Math.abs(x) === ax);
                if (tipo === "granero") col = (x + z) % 2 === 0 ? colores.madera : colores.maderaClara;
                else if (tipo === "capilla") col = elegir(piedras, azar);
                else if (viga) col = colores.madera;
                c.poner(x, y, z, col);
            }
        }
    }
    // Ventanas con postigos
    const ventanas = [];
    for (let x = -ax + 2; x <= ax - 2; x += 3) ventanas.push([x, az + 1, "z"], [x, -az - 1, "z"]);
    for (let z = -az + 2; z <= az - 2; z += 3) ventanas.push([ax + 1, z, "x"], [-ax - 1, z, "x"]);
    ventanas.forEach(([x, z, eje]) => {
        if (tipo === "granero") return;
        const y = 4;
        const xi = eje === "z" ? x : x - Math.sign(x);
        const zi = eje === "z" ? z - Math.sign(z) : z;
        const encendida = azar() < 0.7;
        c.poner(xi, y, zi, encendida ? colores.ventana : colores.ventanaFria, encendida);
        c.poner(xi, y + 1, zi, encendida ? colores.ventana : colores.ventanaFria, encendida);
        if (alto > 8) {
            c.poner(xi, y + 4, zi, encendida ? colores.ventana : colores.ventanaFria, encendida);
            c.poner(xi, y + 5, zi, encendida ? colores.ventana : colores.ventanaFria, encendida);
        }
        // Postigos
        if (eje === "z") {
            c.poner(xi - 1, y, z, colores.maderaOscura);
            c.poner(xi - 1, y + 1, z, colores.maderaOscura);
            c.poner(xi + 1, y, z, colores.maderaOscura);
            c.poner(xi + 1, y + 1, z, colores.maderaOscura);
        }
    });
    // Puerta delante (z positivo)
    c.caja(0, 2, az, 1, 4, az, colores.maderaOscura);
    c.caja(-1, 1, az + 1, 2, 1, az + 2, piedrasOscuras[0]);
    // Tejado
    tejadoDosAguas(c, -ax, ax, -az, az, alto, tejas, azar);
    // Chimenea
    if (tipo !== "capilla" && tipo !== "granero") {
        c.caja(ax - 2, alto, -az + 1, ax - 1, alto + az + 3, -az + 2, () => piedra());
        // Boca de la chimenea (para el humo), en metros respecto al centro de la casa
        c.chimenea = new THREE.Vector3((ax - 1) * VOXEL, (alto + az + 4) * VOXEL, (2 - az) * VOXEL);
    }

    if (tipo === "taberna") {
        // Cartel colgado
        c.caja(ax + 1, 8, az - 1, ax + 3, 8, az - 1, colores.maderaOscura);
        c.caja(ax + 2, 6, az - 1, ax + 3, 7, az - 1, colores.oro);
        c.poner(-ax - 1, 6, az + 1, colores.farol, true);
    }
    if (tipo === "capilla") {
        // Campanario
        c.caja(-2, alto, az - 4, 1, alto + 8, az - 1, () => elegir(piedras, azar));
        c.caja(-1, alto + 5, az - 4, 0, alto + 6, az - 1, colores.maderaOscura);
        c.poner(-1, alto + 5, az - 2, colores.oro);
        tejadoCono(c, -1, az - 3, alto + 9, 2, 7, colores.tejaGris, azar, false);
        c.caja(-1, alto + 16, az - 3, -1, alto + 18, az - 3, colores.oro);
        c.caja(-1, 6, az + 1, 0, 9, az + 1, colores.ventana, true);
    }
    return c;
}

// Rueda del molino: gira en el bucle principal
let ruedaMolino = null;

function crearRueda() {
    const c = new Cubos();
    const radio = 7;
    for (let a = 0; a < 360; a += 2) {
        const r = (a * Math.PI) / 180;
        for (const rr of [radio, radio - 1]) {
            const x = Math.round(Math.cos(r) * rr);
            const y = Math.round(Math.sin(r) * rr);
            c.poner(x, y, 0, colores.madera);
            c.poner(x, y, 2, colores.madera);
        }
    }
    for (let k = 0; k < 8; k++) {
        const r = (k / 8) * Math.PI * 2;
        for (let d = 1; d <= radio; d++) {
            c.poner(Math.round(Math.cos(r) * d), Math.round(Math.sin(r) * d), 1, colores.maderaOscura);
        }
        c.caja(Math.round(Math.cos(r) * radio), Math.round(Math.sin(r) * radio), 0, Math.round(Math.cos(r) * radio), Math.round(Math.sin(r) * radio), 2, colores.maderaClara);
    }
    c.caja(0, 0, -1, 0, 0, 3, colores.maderaOscura);
    const { solida } = c.geometrias();
    solida.translate(-0.25, -0.25, -0.75);
    ruedaMolino = new THREE.Mesh(solida, materialCubos);
    ruedaMolino.castShadow = false;
    ruedaMolino.receiveShadow = true;
    escena.add(ruedaMolino);
}

// ---------------------------------------------------------------------
// Puente de piedra con arco
// ---------------------------------------------------------------------

function crearPuente(k) {
    const azar = crearAzar(5);
    const c = new Cubos();
    const largo = 14;
    const ancho = 4;
    const radio = 11;
    for (let x = -largo * 2; x <= largo * 2; x++) {
        const t = x / (largo * 2);
        const tablero = Math.round(2 + 5 * Math.cos((t * Math.PI) / 2));
        const arco = Math.abs(x) < radio ? Math.round((Math.sqrt(radio * radio - x * x) * 6) / radio) - 1 : -3;
        for (let z = -ancho; z <= ancho; z++) {
            for (let y = arco; y <= tablero; y++) {
                const borde = Math.abs(z) === ancho;
                c.poner(x, y, z, y === tablero && !borde ? elegir([color("#b3a891"), color("#a39a84"), color("#958c78")], azar) : elegir(piedras, azar));
            }
            if (Math.abs(z) === ancho) {
                c.poner(x, tablero + 1, z, elegir(piedrasOscuras, azar));
                if (x % 2 === 0) c.poner(x, tablero + 2, z, elegir(piedras, azar));
            }
        }
    }
    // Faroles en los extremos
    [-largo * 2, largo * 2].forEach((x) => {
        [-ancho, ancho].forEach((z) => {
            c.caja(x, 3, z, x, 7, z, colores.maderaOscura);
            c.poner(x, 8, z, colores.farol, true);
            c.poner(x, 9, z, colores.maderaOscura);
        });
    });
    const centro = muestrasCamino[k];
    const antes = muestrasCamino[Math.max(0, k - 4)];
    const despues = muestrasCamino[Math.min(muestrasCamino.length - 1, k + 4)];
    const giro = Math.atan2(-(despues.z - antes.z), despues.x - antes.x);
    colocar(c, centro.x, NIVEL_AGUA - 0.75, centro.z, giro);
    return { x: centro.x, z: centro.z, giro };
}

// ---------------------------------------------------------------------
// Árboles: unos cuantos modelos que se repiten con giros y tamaños
// ---------------------------------------------------------------------

function modeloPino(semilla, alto) {
    const azar = crearAzar(semilla);
    const c = new Cubos();
    // El tronco sigue bajo tierra para que nunca se vea flotando en una ladera
    c.caja(0, -6, 0, 0, Math.round(alto * 0.25), 0, colores.tronco);
    for (let y = Math.round(alto * 0.15); y < alto; y++) {
        const t = (y - alto * 0.15) / (alto * 0.85);
        const escalon = ((y % 4) / 4) * 0.8;
        const r = (1 - t) * alto * 0.24 + 0.6 - escalon;
        for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
            for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
                if (Math.hypot(x, z) <= r + (azar() - 0.5) * 0.6) c.poner(x, y, z, elegir(colores.pino, azar).clone().multiplyScalar(0.85 + t * 0.3));
            }
        }
    }
    c.poner(0, alto, 0, colores.pino[1]);
    return c;
}

function modeloFrondoso(semilla, alto, lista) {
    const azar = crearAzar(semilla);
    const c = new Cubos();
    const tronco = Math.round(alto * 0.45);
    c.caja(0, -6, 0, 1, tronco, 1, colores.tronco);
    // Ramas
    for (let r = 0; r < 3; r++) {
        const ang = (r / 3) * Math.PI * 2 + azar();
        for (let d = 1; d < alto * 0.25; d++) c.poner(Math.round(Math.cos(ang) * d), tronco - 2 + Math.round(d * 0.7), Math.round(Math.sin(ang) * d), colores.tronco);
    }
    // Copa: varias bolas irregulares con huecos
    const bolas = 6 + Math.floor(azar() * 3);
    for (let b = 0; b < bolas; b++) {
        const ang = azar() * Math.PI * 2;
        const d = azar() * alto * 0.22;
        const cx = Math.round(Math.cos(ang) * d);
        const cz = Math.round(Math.sin(ang) * d);
        const cy = Math.round(tronco + alto * 0.12 + azar() * alto * 0.28);
        const r = alto * (0.17 + azar() * 0.1);
        for (let x = -Math.ceil(r); x <= Math.ceil(r); x++)
            for (let y = -Math.ceil(r); y <= Math.ceil(r); y++)
                for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
                    const dd = Math.hypot(x, y * 1.2, z);
                    if (dd > r + (azar() - 0.5) * 1.2) continue;
                    if (dd > r - 1.5 && azar() < 0.12) continue;
                    const luz = (y / r) * 0.12;
                    c.poner(cx + x, cy + y, cz + z, elegir(lista, azar).clone().multiplyScalar(0.88 + luz + azar() * 0.08));
                }
    }
    return c;
}

const modelosArbol = [];

function prepararModelos() {
    const lista = [
        { cubos: modeloPino(1, 18), peso: 3, tipo: "pino" },
        { cubos: modeloPino(2, 24), peso: 3, tipo: "pino" },
        { cubos: modeloPino(3, 14), peso: 2, tipo: "pino" },
        { cubos: modeloFrondoso(4, 16, colores.hojas), peso: 2, tipo: "frondoso" },
        { cubos: modeloFrondoso(5, 14, colores.hojas), peso: 2, tipo: "frondoso" },
        { cubos: modeloFrondoso(6, 15, colores.otono), peso: 1, tipo: "otono" },
        { cubos: modeloFrondoso(7, 13, colores.rojo), peso: 1, tipo: "otono" }
    ];
    lista.forEach((m) => {
        m.geometria = m.cubos.geometrias().solida;
        modelosArbol.push(m);
    });
}

// Coloca árboles como "instancias": una sola llamada de dibujo por modelo
function plantarBosque(huecosOcupados) {
    const azar = crearAzar(2026);
    const sitios = modelosArbol.map(() => []);
    const pesoTotal = modelosArbol.reduce((s, m) => s + m.peso, 0);
    const cuantos = calidad === "alta" ? 1400 : 700;
    let intentos = 0;
    while (sitios.reduce((s, l) => s + l.length, 0) < cuantos && intentos < cuantos * 12) {
        intentos++;
        const x = VALLE.x0 + 2 + azar() * (VALLE.ancho - 4);
        const z = VALLE.z0 + 2 + azar() * (VALLE.fondo - 4);
        const densidad = fbm2(x * 0.03 + 11, z * 0.03 - 4);
        const h = altura(x, z);
        const lado = Math.abs(x);
        // Más bosque en las laderas y detrás; poco en el prado central
        let quiero = suave(0.4, 0.65, densidad) * 0.8 + suave(30, 60, lado) * 0.7 + suave(-120, -170, z) * 0.6;
        if (Math.hypot(x - CENTRO_CASTILLO.x, z - CENTRO_CASTILLO.z) < 50 && h > 2) quiero += 0.8;
        if (z > 10 && lado < 30) quiero *= 0.25;
        if (azar() > quiero) continue;
        if (h < 0.6 || h > 23) continue;
        if (distanciaRio(x, z) < ANCHO_RIO + 3) continue;
        if (cercaDelCamino(x, z).distancia < 4) continue;
        if (Math.hypot(x - CENTRO_CASTILLO.x, z - CENTRO_CASTILLO.z) < 19) continue;
        if (huecosOcupados.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) continue;
        let elegido = azar() * pesoTotal;
        let indice = 0;
        while (elegido > modelosArbol[indice].peso) {
            elegido -= modelosArbol[indice].peso;
            indice++;
        }
        if (h > 9 && modelosArbol[indice].tipo !== "pino" && azar() < 0.6) indice = Math.floor(azar() * 3);
        // Se apoya en el cubo más bajo de alrededor; si es un cortado, no se planta
        const suelo = sueloMasBajo(x, z, 2);
        if (suelo.desnivel > 2.5) continue;
        sitios[indice].push({ x, y: suelo.minimo - 0.05, z, giro: Math.floor(azar() * 4) * (Math.PI / 2), escala: 0.75 + azar() * 0.5 });
    }
    const matriz = new THREE.Matrix4();
    const cuaternion = new THREE.Quaternion();
    const eje = new THREE.Vector3(0, 1, 0);
    modelosArbol.forEach((modelo, i) => {
        const lista = sitios[i];
        if (!lista.length) return;
        const malla = new THREE.InstancedMesh(modelo.geometria, materialCubos, lista.length);
        lista.forEach((s, k) => {
            cuaternion.setFromAxisAngle(eje, s.giro);
            matriz.compose(new THREE.Vector3(s.x, s.y, s.z), cuaternion, new THREE.Vector3(s.escala, s.escala, s.escala));
            malla.setMatrixAt(k, matriz);
        });
        malla.castShadow = true;
        malla.receiveShadow = true;
        escena.add(malla);
    });
}

// Bosque lejano en las montañas: pinos de cubos grandes
function plantarBosqueLejano() {
    const azar = crearAzar(99);
    const c = new Cubos(2);
    c.caja(0, -2, 0, 0, 1, 0, colores.tronco);
    for (let y = 1; y < 7; y++) {
        const r = (7 - y) * 0.45;
        for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.hypot(x, z) <= r) c.poner(x, y, z, elegir(colores.pino, azar).clone().multiplyScalar(0.8));
    }
    const geometria = c.geometrias().solida;
    const sitios = [];
    const cuantos = calidad === "alta" ? 3000 : 1200;
    let intentos = 0;
    while (sitios.length < cuantos && intentos < cuantos * 10) {
        intentos++;
        const x = -600 + azar() * 1200;
        const z = -700 + azar() * 760;
        if (x > VALLE.x0 - 4 && x < VALLE.x0 + VALLE.ancho + 4 && z > VALLE.z0 - 4) continue;
        const h = alturaLejana(x, z);
        const lineaNieve = 95 + fbm2(x * 0.02, z * 0.02) * 40;
        if (h > lineaNieve * 0.78 || fbm2(x * 0.01, z * 0.01) < 0.4) continue;
        sitios.push({ x, y: Math.floor(h / 2) * 2 - 0.5, z, escala: 0.8 + azar() * 0.6, giro: azar() * 6 });
    }
    const malla = new THREE.InstancedMesh(geometria, materialCubos, sitios.length);
    const matriz = new THREE.Matrix4();
    const cuaternion = new THREE.Quaternion();
    sitios.forEach((s, k) => {
        cuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.giro);
        matriz.compose(new THREE.Vector3(s.x, s.y, s.z), cuaternion, new THREE.Vector3(s.escala, s.escala * 1.2, s.escala));
        malla.setMatrixAt(k, matriz);
    });
    malla.receiveShadow = true;
    malla.layers.set(CAPA_SIN_REFLEJO);
    escena.add(malla);
}

// ---------------------------------------------------------------------
// El árbol viejo del primer plano, rocas, faroles y hojas caídas
// ---------------------------------------------------------------------

function arbolViejo(x, z) {
    // Con cubos de 25 cm: es lo más cercano a la cámara y pide más detalle
    const azar = crearAzar(4242);
    const c = new Cubos(0.25);
    const corteza = () => colores.tronco.clone().multiplyScalar(0.78 + azar() * 0.3);
    // Tronco grueso que se retuerce
    let px = 0;
    let pz = 0;
    for (let y = -8; y < 44; y++) {
        const grosor = y < 6 ? 6.5 - Math.max(0, y) * 0.3 : y < 20 ? 4.6 : 3.6;
        px += Math.sin(y * 0.17) * 0.18;
        pz += Math.cos(y * 0.12) * 0.1;
        for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) if (Math.hypot(dx, dz) <= grosor + (azar() - 0.5) * 0.6) c.poner(Math.round(px + dx), y, Math.round(pz + dz), corteza());
    }
    // Raíces que salen y se hunden
    for (let r = 0; r < 7; r++) {
        const ang = (r / 7) * Math.PI * 2 + azar() * 0.5;
        for (let d = 4; d < 15; d++) {
            const y = Math.max(0, 3 - Math.floor(d / 3));
            c.poner(Math.round(Math.cos(ang) * d), y, Math.round(Math.sin(ang) * d), corteza());
            c.poner(Math.round(Math.cos(ang) * d + 1), y, Math.round(Math.sin(ang) * d), corteza());
        }
    }
    // Ramas grandes con ramitas
    const puntas = [];
    const rama = (bx, by, bz, ang, subir, largo, grosor) => {
        for (let d = 0; d < largo; d++) {
            bx += Math.cos(ang) * 0.9;
            bz += Math.sin(ang) * 0.9;
            by += subir + Math.sin(d * 0.3) * 0.25;
            for (let g = 0; g < grosor; g++) {
                c.poner(Math.round(bx), Math.round(by) - g, Math.round(bz), corteza());
                if (g > 0) c.poner(Math.round(bx) + 1, Math.round(by) - g + 1, Math.round(bz), corteza());
            }
        }
        return [bx, by, bz];
    };
    for (let r = 0; r < 6; r++) {
        const ang = (r / 6) * Math.PI * 2 + azar() * 0.8;
        const fin = rama(px, 24 + Math.floor(azar() * 16), pz, ang, 0.4, 16 + azar() * 12, 3);
        puntas.push(fin);
        for (let k = 0; k < 2; k++) puntas.push(rama(fin[0], fin[1], fin[2], ang + (azar() - 0.5) * 1.6, 0.6, 6 + azar() * 5, 1));
    }
    puntas.push([px, 48, pz]);
    // Racimos de hojas de otoño en las puntas, con huecos para ver las ramas
    puntas.forEach(([bx, by, bz], indice) => {
        const r = (indice % 3 === 0 ? 8 : 6) + azar() * 4;
        for (let dx = -14; dx <= 14; dx++)
            for (let dy = -8; dy <= 10; dy++)
                for (let dz = -14; dz <= 14; dz++) {
                    const d = Math.hypot(dx, dy * 1.5, dz);
                    if (d > r + (ruido2(dx * 0.4 + indice, dz * 0.4 + dy * 0.3) - 0.5) * 4) continue;
                    if (azar() < 0.14) continue;
                    c.poner(Math.round(bx + dx), Math.round(by + dy), Math.round(bz + dz), elegir(colores.otono, azar).clone().multiplyScalar(0.82 + (dy / 10) * 0.22 + azar() * 0.1));
                }
    });
    colocar(c, x, altura(x, z) - 0.6, z, 0.3);
}

function roca(c, cx, cy, cz, r, azar) {
    for (let x = -r; x <= r; x++)
        for (let y = -2; y <= r; y++)
            for (let z = -r; z <= r; z++) {
                const d = Math.hypot(x, Math.max(0, y) * 1.4, z);
                if (d > r + (azar() - 0.5)) continue;
                const musgo = y >= r - 1 && azar() < 0.5;
                c.poner(cx + x, cy + y, cz + z, musgo ? colores.hojas[2] : elegir(piedrasOscuras, azar));
            }
}

function farol(x, z) {
    const c = new Cubos();
    c.caja(0, -4, 0, 0, 0, 0, piedrasOscuras[0]);
    c.caja(0, 1, 0, 0, 7, 0, colores.maderaOscura);
    c.caja(-1, 8, -1, 1, 8, 1, colores.maderaOscura);
    c.caja(0, 9, 0, 0, 10, 0, colores.farol, true);
    c.caja(-1, 11, -1, 1, 11, 1, colores.maderaOscura);
    colocar(c, x, sueloMasBajo(x, z).minimo - 0.25, z, 0);
}

// =====================================================================
// 10. LA ALDEA Y LOS DETALLES
// =====================================================================

const ocupados = [];
const chimeneas = [];
const lucesCalidas = [];
let puente = null;

function puntoCamino(z) {
    let mejor = muestrasCamino[0];
    muestrasCamino.forEach((m) => {
        if (Math.abs(m.z - z) < Math.abs(mejor.z - z) && m.z > -95) mejor = m;
    });
    return mejor;
}

function ponerCasa(tipo, semilla, z, lado, separacion) {
    const p = puntoCamino(z);
    const antes = puntoCamino(z + 2);
    const dx = p.x - antes.x;
    const dz = p.z - antes.z;
    const largo = Math.hypot(dx, dz) || 1;
    // Perpendicular al camino
    const x = p.x + (-dz / largo) * lado * separacion;
    const zz = p.z + (dx / largo) * lado * separacion;
    if (distanciaRio(x, zz) < ANCHO_RIO + 6) return;
    const c = casa(tipo, semilla);
    const giro = Math.atan2(p.x - x, p.z - zz);
    const y = Math.min(altura(x, zz), altura(x + 2, zz), altura(x - 2, zz), altura(x, zz + 2), altura(x, zz - 2)) - 0.5;
    colocar(c, x, y, zz, giro);
    ocupados.push({ x, z: zz, r: 9 });
    if (c.chimenea) chimeneas.push(c.chimenea.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), giro).add(new THREE.Vector3(x, y, zz)));
    if (tipo === "taberna" || tipo === "capilla") lucesCalidas.push(new THREE.Vector3(x, y + 3, zz).add(new THREE.Vector3(0, 0, 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), giro)));
}

function crearAldea() {
    ponerCasa("taberna", 11, -40, 1, 9);
    ponerCasa("casita", 12, -48, -1, 8);
    ponerCasa("casita", 13, -58, 1, 8.5);
    ponerCasa("granero", 14, -64, -1, 11);
    ponerCasa("capilla", 15, -76, 1, 10);
    ponerCasa("casita", 16, -84, -1, 9);
    ponerCasa("casita", 17, 6, -1, 13);

    // Molino junto al río, con la rueda en el agua
    const xm = -26;
    const zr = rioZ(xm);
    const c = casa("molino", 18);
    colocar(c, xm, 0.4, zr - 8, 0);
    ocupados.push({ x: xm, z: zr - 8, r: 9 });
    chimeneas.push(c.chimenea.clone().add(new THREE.Vector3(xm, 0.4, zr - 8)));
    crearRueda();
    ruedaMolino.position.set(xm + 0.5, 1.2, zr - 3.6);

    // Faroles a lo largo del camino
    let lado = 1;
    for (let z = 52; z > -92; z -= 15) {
        const p = puntoCamino(z);
        const x = p.x + lado * 2.8;
        const cercaPuente = puente && Math.hypot(x - puente.x, p.z - puente.z) < 18;
        if (distanciaRio(x, p.z) > ANCHO_RIO + 3 && !cercaPuente) {
            farol(x, p.z);
            if (Math.abs(z - 52) < 1) lucesCalidas.push(new THREE.Vector3(x, altura(x, p.z) + 5, p.z));
        }
        lado = -lado;
    }

    // Árbol viejo y rocas del primer plano
    arbolViejo(-16, 6);
    ocupados.push({ x: -16, z: 6, r: 12 });
    const azar = crearAzar(31);
    const rocas = new Cubos();
    [[-10, 13, 3], [-22, 0, 4], [14, 12, 2], [-8, 18, 2], [18, -4, 3], [-26, 12, 3]].forEach(([x, z, r]) => {
        roca(rocas, Math.round(x / VOXEL), Math.round((sueloMasBajo(x, z, 2).minimo - 0.4) / VOXEL), Math.round(z / VOXEL), r, azar);
        ocupados.push({ x, z, r: r * 0.6 + 1 });
    });
    // Rocas a los lados de la cascada, arriba y abajo
    const zc = rioZ(X_CASCADA);
    [[-58, -6.8, 4], [-58, 7, 4], [-53.5, -7.5, 3], [-53, 7.8, 3], [-60, -5.5, 2], [-51, -6.5, 2]].forEach(([x, dz, r]) => {
        roca(rocas, Math.round(x / VOXEL), Math.round((sueloMasBajo(x, zc + dz, 2).minimo - 0.4) / VOXEL), Math.round((zc + dz) / VOXEL), r, azar);
    });
    colocar(rocas, 0, 0, 0, 0);

    // Hojas caídas bajo el árbol viejo (cubitos pequeños)
    const hojas = new Cubos(0.125);
    for (let i = 0; i < 900; i++) {
        const ang = azar() * Math.PI * 2;
        const d = Math.sqrt(azar()) * 13;
        const x = -16 + Math.cos(ang) * d;
        const z = 6 + Math.sin(ang) * d * 0.8;
        const y = Math.round(altura(x, z) / VOXEL) * VOXEL;
        hojas.poner(Math.round(x / 0.125), Math.round(y / 0.125), Math.round(z / 0.125), elegir(colores.otono, azar));
    }
    colocar(hojas, 0, 0, 0, 0);
}

// =====================================================================
// 11. AMBIENTES
// Cada ambiente cambia el cielo, la luz, la niebla, el agua y los
// efectos (lluvia, luciérnagas). Al cambiar se mezclan poco a poco.
// =====================================================================

const ambientes = {
    manana: {
        cenit: "#3f78d0", horizonte: "#dfe6ee", suelo: "#6a7a88", colorSol: "#fff2d8", dirSol: [-0.7, 0.45, 0.25],
        luzSol: "#fff0dc", fuerzaSol: 3.0, cieloArriba: "#a8c4ee", cieloAbajo: "#6a7a5a", fuerzaCielo: 0.95,
        niebla: "#c6d4e4", densidad: 0.0016, noche: 0, nubes: 0.35, colorNubes: "#ffffff", exposicion: 0.95,
        luces: 0, brillo: 0.18, lluvia: 0, hondo: "#24485a", claro: "#5f98a8"
    },
    atardecer: {
        cenit: "#2c3a78", horizonte: "#f2a07a", suelo: "#3a3050", colorSol: "#ffc890", dirSol: [0.85, 0.24, -0.2],
        luzSol: "#ffb070", fuerzaSol: 3.2, cieloArriba: "#9a9ad8", cieloAbajo: "#6a5440", fuerzaCielo: 1.15,
        niebla: "#c9908a", densidad: 0.0017, noche: 0, nubes: 0.5, colorNubes: "#f0b8a8", exposicion: 1.1,
        luces: 0.55, brillo: 0.4, lluvia: 0, hondo: "#1d3a4a", claro: "#4f7f8a"
    },
    noche: {
        cenit: "#050818", horizonte: "#1c2850", suelo: "#0a0e1c", colorSol: "#9ab0ff", dirSol: [-0.45, 0.42, -0.78],
        luzSol: "#9ab0f0", fuerzaSol: 1.4, cieloArriba: "#4a5aa0", cieloAbajo: "#1a2030", fuerzaCielo: 1.2,
        niebla: "#18213c", densidad: 0.002, noche: 1, nubes: 0.3, colorNubes: "#2a3460", exposicion: 1.35,
        luces: 1, brillo: 0.85, lluvia: 0, hondo: "#08121e", claro: "#1a2c44"
    },
    lluvia: {
        cenit: "#4a5262", horizonte: "#8d949e", suelo: "#3a3e44", colorSol: "#c8ccd4", dirSol: [0.3, 0.6, -0.5],
        luzSol: "#b8c0cc", fuerzaSol: 0.8, cieloArriba: "#9aa2ae", cieloAbajo: "#4a4e44", fuerzaCielo: 1.05,
        niebla: "#7f8792", densidad: 0.0055, noche: 0, nubes: 1, colorNubes: "#6a707a", exposicion: 1.0,
        luces: 0.5, brillo: 0.3, lluvia: 1, hondo: "#2a3438", claro: "#4a5a60"
    }
};

const clavesColor = ["cenit", "horizonte", "suelo", "colorSol", "luzSol", "cieloArriba", "cieloAbajo", "niebla", "colorNubes", "hondo", "claro"];
const clavesNumero = ["fuerzaSol", "fuerzaCielo", "densidad", "noche", "nubes", "exposicion", "luces", "brillo", "lluvia"];

function prepararAmbiente(a) {
    const r = { dirSol: new THREE.Vector3(...a.dirSol).normalize() };
    clavesColor.forEach((k) => (r[k] = new THREE.Color(a[k])));
    clavesNumero.forEach((k) => (r[k] = a[k]));
    return r;
}
Object.keys(ambientes).forEach((k) => (ambientes[k] = prepararAmbiente(ambientes[k])));

const ambienteActual = prepararAmbiente({ ...Object.fromEntries(clavesColor.map((k) => [k, "#000000"])), ...Object.fromEntries(clavesNumero.map((k) => [k, 0])), dirSol: [0, 1, 0] });
let ambienteDesde = prepararAmbiente({ ...Object.fromEntries(clavesColor.map((k) => [k, "#000000"])), ...Object.fromEntries(clavesNumero.map((k) => [k, 0])), dirSol: [0, 1, 0] });
let ambienteHasta = ambientes[ambientes[parametros.get("ambiente")] ? parametros.get("ambiente") : "atardecer"];
let progresoAmbiente = 1;

function copiarAmbiente(destino, origen) {
    destino.dirSol.copy(origen.dirSol);
    clavesColor.forEach((k) => destino[k].copy(origen[k]));
    clavesNumero.forEach((k) => (destino[k] = origen[k]));
}

function mezclarAmbientes(t) {
    const s = t * t * (3 - 2 * t);
    ambienteActual.dirSol.copy(ambienteDesde.dirSol).lerp(ambienteHasta.dirSol, s).normalize();
    clavesColor.forEach((k) => ambienteActual[k].lerpColors(ambienteDesde[k], ambienteHasta[k], s));
    clavesNumero.forEach((k) => (ambienteActual[k] = mezclar(ambienteDesde[k], ambienteHasta[k], s)));
}

const materialLuces = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
const focos = [];

function aplicarAmbiente() {
    const a = ambienteActual;
    const u = uniformesCielo;
    u.uCenit.value.copy(a.cenit);
    u.uHorizonte.value.copy(a.horizonte);
    u.uSuelo.value.copy(a.suelo);
    u.uColorSol.value.copy(a.colorSol);
    u.uDireccionSol.value.copy(a.dirSol);
    u.uNoche.value = a.noche;
    u.uNubes.value = a.nubes;
    u.uColorNubes.value.copy(a.colorNubes);

    sol.color.copy(a.luzSol);
    sol.intensity = a.fuerzaSol;
    sol.position.copy(sol.target.position).addScaledVector(a.dirSol, 320);
    renderizador.shadowMap.needsUpdate = true;
    cielo.color.copy(a.cieloArriba);
    cielo.groundColor.copy(a.cieloAbajo);
    cielo.intensity = a.fuerzaCielo;
    escena.fog.color.copy(a.niebla);
    escena.fog.density = a.densidad;
    renderizador.toneMappingExposure = a.exposicion;
    brillo.strength = a.brillo;

    materialLuces.color.setScalar(0.18 + a.luces * 3.2);
    focos.forEach((f) => (f.intensity = a.luces * 22));
    materialCubos.roughness = 0.92 - a.lluvia * 0.35;

    if (agua) {
        const w = agua.material.uniforms;
        w.uHondo.value.copy(a.hondo);
        w.uClaro.value.copy(a.claro);
        w.uLluvia.value = a.lluvia;
        w.uNiebla.value.copy(a.niebla);
        w.uDensidad.value = a.densidad;
    }
    aguaViva.uHondo.value.copy(a.hondo);
    aguaViva.uClaro.value.copy(a.claro);
    aguaViva.uCielo.value.copy(a.horizonte);
    aguaViva.uNiebla.value.copy(a.niebla);
    aguaViva.uDensidad.value = a.densidad;
    aguaViva.uBrillo.value = (0.3 + 0.7 * (1 - a.noche)) * (1 - a.lluvia * 0.25);
}

// =====================================================================
// 12. PARTÍCULAS: HOJAS, LUCIÉRNAGAS, LLUVIA, HUMO Y PÁJAROS
// =====================================================================

function texturaRedonda(suave) {
    const lienzo = document.createElement("canvas");
    lienzo.width = 64;
    lienzo.height = 64;
    const ctx = lienzo.getContext("2d");
    const degradado = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    degradado.addColorStop(0, "rgba(255,255,255,1)");
    degradado.addColorStop(suave, "rgba(255,255,255,0.5)");
    degradado.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(lienzo);
}

const particulas = {};

function crearParticulas() {
    // Hojas que caen del árbol viejo
    const nHojas = 160;
    const hojas = { datos: [], geometria: new THREE.BufferGeometry() };
    const posH = new Float32Array(nHojas * 3);
    const colH = new Float32Array(nHojas * 3);
    for (let i = 0; i < nHojas; i++) {
        const dato = { x: -16 + (Math.random() - 0.5) * 18, y: Math.random() * 14 + 2, z: 6 + (Math.random() - 0.5) * 14, v: 0.4 + Math.random() * 0.6, fase: Math.random() * 6 };
        dato.suelo = altura(dato.x, dato.z);
        hojas.datos.push(dato);
        colores.otono[i % 4].toArray(colH, i * 3);
    }
    hojas.geometria.setAttribute("position", new THREE.BufferAttribute(posH, 3));
    hojas.geometria.setAttribute("color", new THREE.BufferAttribute(colH, 3));
    const puntosHojas = new THREE.Points(hojas.geometria, new THREE.PointsMaterial({ size: 0.16, vertexColors: true }));
    puntosHojas.frustumCulled = false;
    escena.add(puntosHojas);
    particulas.hojas = hojas;

    // Luciérnagas
    const nLuc = 260;
    const luc = { datos: [], geometria: new THREE.BufferGeometry() };
    for (let i = 0; i < nLuc; i++) {
        const x = (Math.random() - 0.5) * 90;
        const z = 50 - Math.random() * 140;
        luc.datos.push({ x, z, y: altura(x, z) + 0.4 + Math.random() * 2, fase: Math.random() * 6, v: 0.3 + Math.random() * 0.6 });
    }
    luc.geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nLuc * 3), 3));
    luc.material = new THREE.PointsMaterial({ size: 0.35, map: texturaRedonda(0.25), color: new THREE.Color(3, 3.2, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const puntosLuc = new THREE.Points(luc.geometria, luc.material);
    puntosLuc.frustumCulled = false;
    escena.add(puntosLuc);
    particulas.luciernagas = luc;

    // Lluvia: rayitas alrededor de la cámara
    const nLluvia = calidad === "alta" ? 6000 : 2500;
    const lluvia = { datos: new Float32Array(nLluvia * 3), geometria: new THREE.BufferGeometry() };
    for (let i = 0; i < nLluvia; i++) {
        lluvia.datos[i * 3] = (Math.random() - 0.5) * 80;
        lluvia.datos[i * 3 + 1] = Math.random() * 40;
        lluvia.datos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    lluvia.geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nLluvia * 6), 3));
    lluvia.material = new THREE.LineBasicMaterial({ color: "#c8d0dc", transparent: true, opacity: 0 });
    lluvia.lineas = new THREE.LineSegments(lluvia.geometria, lluvia.material);
    lluvia.lineas.frustumCulled = false;
    lluvia.lineas.layers.set(CAPA_SIN_REFLEJO);
    escena.add(lluvia.lineas);
    particulas.lluvia = lluvia;

    // Humo de las chimeneas
    const porChimenea = 34;
    const humo = { datos: [], geometria: new THREE.BufferGeometry() };
    chimeneas.forEach((c, k) => {
        for (let i = 0; i < porChimenea; i++) humo.datos.push({ base: c, t: i / porChimenea, fase: k * 1.7 + i });
    });
    humo.geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(humo.datos.length * 3), 3));
    humo.geometria.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(humo.datos.length), 1));
    // Cada bocanada crece y se desvanece al subir
    humo.material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uMapa: { value: texturaRedonda(0.3) },
            uColor: { value: new THREE.Color("#d8d4d0") },
            uOpacidad: { value: 0.3 },
            uTam: { value: 500 }
        },
        vertexShader: `
            attribute float aT;
            uniform float uTam;
            varying float vT;
            void main() {
                vT = aT;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = (0.8 + aT * 3.5) * uTam / -mv.z;
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform sampler2D uMapa;
            uniform vec3 uColor;
            uniform float uOpacidad;
            varying float vT;
            void main() {
                float a = texture2D(uMapa, gl_PointCoord).a * uOpacidad * smoothstep(0.0, 0.12, vT) * (1.0 - vT);
                gl_FragColor = vec4(uColor, a);
            }
        `
    });
    const puntosHumo = new THREE.Points(humo.geometria, humo.material);
    puntosHumo.frustumCulled = false;
    escena.add(puntosHumo);
    particulas.humo = humo;

    // Bruma al pie de la cascada (mismo sombreado que el humo, más grande)
    const nBruma = 46;
    const bruma = { datos: [], geometria: new THREE.BufferGeometry() };
    for (let i = 0; i < nBruma; i++) bruma.datos.push({ t: i / nBruma, x: Math.random() - 0.5, z: Math.random() - 0.5 });
    bruma.geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nBruma * 3), 3));
    bruma.geometria.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(nBruma), 1));
    bruma.material = humo.material.clone();
    const puntosBruma = new THREE.Points(bruma.geometria, bruma.material);
    puntosBruma.frustumCulled = false;
    escena.add(puntosBruma);
    particulas.bruma = bruma;

    // Pájaros: una bandada que da vueltas a lo lejos
    const nPajaros = 9;
    const pajaros = { geometria: new THREE.BufferGeometry(), datos: [] };
    for (let i = 0; i < nPajaros; i++) pajaros.datos.push({ desfase: i * 0.06 + Math.random() * 0.03, alto: Math.random() * 4, lado: (Math.random() - 0.5) * 6 });
    pajaros.geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nPajaros * 12), 3));
    pajaros.material = new THREE.LineBasicMaterial({ color: "#1e1a24", transparent: true, opacity: 1 });
    const lineasPajaros = new THREE.LineSegments(pajaros.geometria, pajaros.material);
    lineasPajaros.frustumCulled = false;
    lineasPajaros.layers.set(CAPA_SIN_REFLEJO);
    escena.add(lineasPajaros);
    particulas.pajaros = pajaros;
}

const colorHumo = new THREE.Color("#e4e0dc");

function moverParticulas(delta, tiempo) {
    const a = ambienteActual;
    const lento = movimientoReducido ? 0.3 : 1;

    const h = particulas.hojas;
    const pos = h.geometria.attributes.position;
    h.datos.forEach((d, i) => {
        d.y -= delta * d.v * 0.8 * lento;
        d.x += delta * (0.6 + Math.sin(tiempo + d.fase) * 0.5) * lento;
        if (d.y < 0) {
            d.y = 10 + Math.random() * 8;
            d.x = -16 + (Math.random() - 0.5) * 16;
            d.z = 6 + (Math.random() - 0.5) * 12;
            d.suelo = altura(d.x, d.z);
        }
        pos.setXYZ(i, d.x + Math.sin(tiempo * 2 + d.fase) * 0.4, d.suelo + d.y, d.z + Math.cos(tiempo * 1.5 + d.fase) * 0.4);
    });
    pos.needsUpdate = true;

    const l = particulas.luciernagas;
    l.material.opacity = a.noche;
    if (a.noche > 0.02) {
        const p = l.geometria.attributes.position;
        l.datos.forEach((d, i) => {
            const t = tiempo * d.v + d.fase;
            p.setXYZ(i, d.x + Math.sin(t * 0.7) * 1.5, d.y + Math.sin(t) * 0.4, d.z + Math.cos(t * 0.5) * 1.5);
        });
        p.needsUpdate = true;
    }

    const ll = particulas.lluvia;
    ll.material.opacity = a.lluvia * 0.55;
    ll.lineas.visible = a.lluvia > 0.01;
    if (ll.lineas.visible) {
        const p = ll.geometria.attributes.position.array;
        const n = ll.datos.length / 3;
        for (let i = 0; i < n; i++) {
            let y = ll.datos[i * 3 + 1] - delta * 26;
            if (y < 0) y += 40;
            ll.datos[i * 3 + 1] = y;
            const x = camara.position.x + ll.datos[i * 3];
            const z = camara.position.z + ll.datos[i * 3 + 2];
            const yy = camara.position.y - 12 + y;
            const k = i * 6;
            p[k] = x;
            p[k + 1] = yy;
            p[k + 2] = z;
            p[k + 3] = x - 0.05;
            p[k + 4] = yy - 0.7;
            p[k + 5] = z;
        }
        ll.geometria.attributes.position.needsUpdate = true;
    }

    const hu = particulas.humo;
    const ph = hu.geometria.attributes.position;
    const th = hu.geometria.attributes.aT;
    hu.datos.forEach((d, i) => {
        d.t = (d.t + delta * 0.05 * lento) % 1;
        ph.setXYZ(i, d.base.x + d.t * 4 + Math.sin(d.t * 6 + d.fase) * 0.5, d.base.y + d.t * 8, d.base.z + Math.cos(d.t * 5 + d.fase) * 0.4);
        th.setX(i, d.t);
    });
    ph.needsUpdate = true;
    th.needsUpdate = true;
    const uh = hu.material.uniforms;
    uh.uColor.value.copy(a.niebla).lerp(colorHumo, 0.6).multiplyScalar(1 - a.noche * 0.6);
    uh.uOpacidad.value = 0.32 * (1 - a.lluvia * 0.5);
    uh.uTam.value = (renderizador.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));

    const br = particulas.bruma;
    const pb = br.geometria.attributes.position;
    const tb = br.geometria.attributes.aT;
    const zCascada = rioZ(X_CASCADA);
    br.datos.forEach((d, i) => {
        d.t = (d.t + delta * 0.11 * lento) % 1;
        pb.setXYZ(i, X_CASCADA + 2.5 + d.x * (2 + d.t * 6), NIVEL_AGUA + 0.2 + d.t * 4.5, zCascada + d.z * (5 + d.t * 6));
        tb.setX(i, d.t);
    });
    pb.needsUpdate = true;
    tb.needsUpdate = true;
    const ub = br.material.uniforms;
    ub.uColor.value.setRGB(0.9, 0.94, 1).multiplyScalar(aguaViva.uBrillo.value);
    ub.uOpacidad.value = 0.28;
    ub.uTam.value = uh.uTam.value * 1.6;

    const pj = particulas.pajaros;
    const pp = pj.geometria.attributes.position.array;
    pj.material.opacity = 1 - a.noche;
    pj.datos.forEach((d, i) => {
        const t = tiempo * 0.035 * lento + d.desfase;
        const cx = Math.cos(t * Math.PI * 2) * 70 + 10;
        const cz = Math.sin(t * Math.PI * 2) * 40 - 100;
        const cy = 42 + d.alto + Math.sin(t * 20) * 1.5;
        const ala = Math.sin(tiempo * 9 + i) * 0.5;
        const k = i * 12;
        const zp = cz + d.lado;
        pp[k] = cx - 0.9; pp[k + 1] = cy + ala; pp[k + 2] = zp;
        pp[k + 3] = cx; pp[k + 4] = cy; pp[k + 5] = zp;
        pp[k + 6] = cx; pp[k + 7] = cy; pp[k + 8] = zp;
        pp[k + 9] = cx + 0.9; pp[k + 10] = cy + ala; pp[k + 11] = zp;
    });
    pj.geometria.attributes.position.needsUpdate = true;
}

// =====================================================================
// 13. CÁMARAS
// Cuatro vistas pensadas, y además se puede girar con el ratón o el dedo.
// =====================================================================

const controles = new OrbitControls(camara, renderizador.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.06;
controles.minDistance = 4;
controles.maxDistance = 260;
controles.maxPolarAngle = Math.PI * 0.62;
controles.autoRotateSpeed = 0.25;

let vistas = [];
let viaje = null;

function prepararVistas() {
    const enAldea = puntoCamino(-57);
    const antesPuente = muestrasCamino[Math.max(0, cruces[0] - 46)];
    vistas = [
        { nombre: "Valle", posicion: new THREE.Vector3(6, 20, 24), objetivo: new THREE.Vector3(-1, 14, -112) },
        { nombre: "Río", posicion: new THREE.Vector3(34, 1.7, rioZ(34) + 5.5), objetivo: new THREE.Vector3(puente.x - 8, 9, puente.z - 34) },
        { nombre: "Camino", posicion: new THREE.Vector3(antesPuente.x, altura(antesPuente.x, antesPuente.z) + 2.8, antesPuente.z), objetivo: new THREE.Vector3(enAldea.x - 1, 13, -118) },
        { nombre: "Colina", posicion: new THREE.Vector3(-42, 64, -96), objetivo: new THREE.Vector3(2, 20, -126) }
    ];
}

function irAVista(i, inmediato = false) {
    const v = vistas[i];
    if (inmediato || movimientoReducido) {
        camara.position.copy(v.posicion);
        controles.target.copy(v.objetivo);
        controles.update();
        return;
    }
    viaje = {
        t: 0,
        desdePos: camara.position.clone(),
        desdeObj: controles.target.clone(),
        hastaPos: v.posicion.clone(),
        hastaObj: v.objetivo.clone()
    };
}

function moverViaje(delta) {
    if (!viaje) return;
    viaje.t = Math.min(1, viaje.t + delta / 2.6);
    const s = viaje.t < 0.5 ? 4 * viaje.t ** 3 : 1 - (-2 * viaje.t + 2) ** 3 / 2;
    camara.position.lerpVectors(viaje.desdePos, viaje.hastaPos, s);
    // Un pequeño arco hacia arriba para que el viaje no atraviese nada
    camara.position.y += Math.sin(s * Math.PI) * Math.min(18, viaje.desdePos.distanceTo(viaje.hastaPos) * 0.15);
    controles.target.lerpVectors(viaje.desdeObj, viaje.hastaObj, s);
    if (viaje.t >= 1) viaje = null;
}

// =====================================================================
// 14. SONIDO (apagado hasta que se pulse)
// Ruido generado: río, viento y, si llueve, lluvia. Sin archivos.
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
        datos[i] = ultimo * 3.5 * 0.6 + blanco * 0.4;
    }
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
        fuente.connect(filtro).connect(volumen).connect(ctx.destination);
        fuente.start(0, Math.random() * 2);
        return volumen;
    };
    return { ctx, rio: canal("bandpass", 900, 0.6), viento: canal("lowpass", 380, 0.4), lluvia: canal("highpass", 2400, 0.3) };
}

function actualizarSonido() {
    if (!audio || audio.ctx.state !== "running") return;
    const a = ambienteActual;
    const cercaRio = Math.max(0, 1 - distanciaRio(camara.position.x, camara.position.z) / 70);
    audio.rio.gain.value = 0.05 + cercaRio * 0.12;
    audio.viento.gain.value = 0.08 + Math.min(0.12, camara.position.y * 0.002);
    audio.lluvia.gain.value = a.lluvia * 0.12;
}

// =====================================================================
// 14b. EL CASTILLO SE MUEVE: BANDERAS Y PUENTE LEVADIZO
// Las banderas son telas que ondean en el shader. El puente levadizo
// baja de día y se sube de noche, colgado de dos cadenas.
// =====================================================================

const tiempoVivo = { value: 0 };
let levadizo = null;
let cadenas = null;
let anguloLevadizo = 0;

function crearBanderas() {
    const material = new THREE.MeshStandardMaterial({ color: "#c23b3b", roughness: 0.85, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTiempo = tiempoVivo;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTiempo;")
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                float semilla = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.21;
                float largo = position.x;
                transformed.z += sin(uTiempo * 3.2 - largo * 2.6 + semilla) * largo * 0.22;
                transformed.y += sin(uTiempo * 2.1 - largo * 1.9 + semilla) * largo * 0.05;`
            );
    };
    const geometria = new THREE.PlaneGeometry(1.8, 1.0, 10, 3);
    geometria.translate(0.9, -0.5, 0);
    banderasCastillo.forEach((p) => {
        const bandera = new THREE.Mesh(geometria, material);
        bandera.position.copy(p);
        bandera.castShadow = false;
        bandera.layers.set(CAPA_SIN_REFLEJO);
        escena.add(bandera);
    });
}

function crearLevadizo() {
    const c = new Cubos(0.25);
    for (let x = -7; x <= 7; x++) {
        for (let z = 0; z < 15; z++) {
            const herraje = z === 2 || z === 12;
            c.poner(x, 0, z, herraje ? color("#3a3a42") : ((x + 7) % 3 === 0 ? colores.maderaOscura : colores.madera));
        }
    }
    const { solida } = c.geometrias();
    solida.translate(0, -0.12, 0);
    levadizo = new THREE.Mesh(solida, materialCubos);
    levadizo.position.copy(bisagraPuerta);
    levadizo.castShadow = true;
    levadizo.receiveShadow = true;
    escena.add(levadizo);

    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    cadenas = new THREE.LineSegments(geometria, new THREE.LineBasicMaterial({ color: "#2a2a30" }));
    cadenas.frustumCulled = false;
    escena.add(cadenas);
}

const puntaLevadizo = new THREE.Vector3();
const ejeLevadizo = new THREE.Vector3(1, 0, 0);
let fotogramasLevadizo = 0;

function moverLevadizo(delta) {
    if (!levadizo) return;
    const objetivo = ambienteActual.noche > 0.5 ? -Math.PI / 2 : 0;
    const falta = objetivo - anguloLevadizo;
    if (Math.abs(falta) < 0.0001) return;
    // Gira a velocidad fija; la sombra se recalcula cada 8 fotogramas y al acabar
    const paso = Math.sign(falta) * Math.min(Math.abs(falta), delta * 0.45);
    anguloLevadizo += paso;
    fotogramasLevadizo++;
    if (Math.abs(objetivo - anguloLevadizo) < 0.0001 || fotogramasLevadizo % 8 === 0) renderizador.shadowMap.needsUpdate = true;
    levadizo.rotation.x = anguloLevadizo;
    // Cadenas desde lo alto de la puerta hasta la punta del puente
    const punta = puntaLevadizo.set(0, 0, 3.6).applyAxisAngle(ejeLevadizo, anguloLevadizo).add(bisagraPuerta);
    const p = cadenas.geometry.attributes.position.array;
    [-1.6, 1.6].forEach((dx, i) => {
        const k = i * 6;
        p[k] = bisagraPuerta.x + dx;
        p[k + 1] = bisagraPuerta.y + 5.5;
        p[k + 2] = bisagraPuerta.z - 0.1;
        p[k + 3] = punta.x + dx;
        p[k + 4] = punta.y;
        p[k + 5] = punta.z;
    });
    cadenas.geometry.attributes.position.needsUpdate = true;
}

// =====================================================================
// 14c. VIDA EN EL VALLE
// Aldeanos que van y vienen por el camino (mueven piernas y brazos),
// ovejas que pastan y pasean, una barca en el río y peces que saltan.
// =====================================================================

// Altura para caminar: el suelo o, si es el puente, su tablero. Se
// calcula una vez por cada punto del camino y luego se interpola.
let alturasPaso = null;

function alturaPasoExacta(k) {
    const m = muestrasCamino[k];
    // Sobre el puente levadizo y dentro del patio, la altura del tablero
    if (m.z < bisagraPuerta.z + 3.75) return CENTRO_CASTILLO.y + 0.05;
    let h = sueloCubos(m.x, m.z);
    if (cruces.length) {
        const d = (k - cruces[0]) * 0.5;
        if (Math.abs(d) < 14) h = Math.max(h, -0.75 + (3 + 5 * Math.cos((d / 14) * (Math.PI / 2))) * VOXEL);
    }
    return h;
}

function alturaPaso(indice) {
    if (!alturasPaso) alturasPaso = muestrasCamino.map((m, k) => alturaPasoExacta(k));
    const i = Math.max(0, Math.min(muestrasCamino.length - 1, indice));
    const a = Math.floor(i);
    const b = Math.min(muestrasCamino.length - 1, a + 1);
    return mezclar(alturasPaso[a], alturasPaso[b], i - a);
}

function puntoEnCamino(indice, destino) {
    const i = Math.max(0, Math.min(muestrasCamino.length - 2, indice));
    const a = muestrasCamino[Math.floor(i)];
    const b = muestrasCamino[Math.floor(i) + 1];
    destino.lerpVectors(a, b, i - Math.floor(i));
    destino.y = alturaPaso(i);
    return destino;
}

const aldeanos = [];

// Las sombras de la escena no se recalculan cada fotograma, así que lo
// que se mueve lleva una sombra redonda debajo (como en muchos juegos)
const geometriaSombra = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
const materialSombra = new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

function modeloAldeano(azar) {
    const piel = elegir([color("#e8b896"), color("#c98f6a"), color("#8d5a3c"), color("#f0c8a8")], azar);
    const camisa = elegir([color("#4a6fa8"), color("#a8423a"), color("#5a8a4a"), color("#d8b04a"), color("#7a5aa0"), color("#e8e0d0")], azar);
    const pantalon = elegir([color("#4a3a2a"), color("#3a4050"), color("#5a4a3a")], azar);
    const pelo = elegir([color("#2a1a12"), color("#5a3a1a"), color("#c8a050"), color("#8a8a8a")], azar);
    const sombrero = azar() < 0.4;

    const cuerpo = new Cubos(0.125);
    cuerpo.caja(-2, 6, -1, 2, 11, 1, camisa);
    cuerpo.caja(-2, 6, -1, 2, 6, 1, colores.maderaOscura);
    cuerpo.caja(-1, 12, -1, 1, 14, 1, piel);
    cuerpo.caja(-1, 14, -1, 1, 14, 1, pelo);
    cuerpo.caja(-1, 12, -1, 1, 14, -1, pelo);
    cuerpo.poner(-1, 13, 1, color("#1a1a20"));
    cuerpo.poner(1, 13, 1, color("#1a1a20"));
    if (sombrero) cuerpo.caja(-2, 15, -2, 2, 15, 2, colores.paja);
    if (sombrero) cuerpo.caja(-1, 16, -1, 1, 16, 1, colores.paja);

    const pierna = new Cubos(0.125);
    pierna.caja(0, -6, -1, 1, -1, 0, pantalon);
    pierna.caja(0, -6, -1, 1, -6, 1, color("#2a2018"));

    const brazo = new Cubos(0.125);
    brazo.caja(0, -5, 0, 0, -1, 0, camisa);
    brazo.poner(0, -5, 0, piel);

    return {
        cuerpo: cuerpo.geometrias().solida,
        pierna: pierna.geometrias().solida,
        brazo: brazo.geometrias().solida
    };
}

function crearAldeanos() {
    const azar = crearAzar(808);
    const inicio = Math.max(0, cruces[0] - 70);
    const fin = muestrasCamino.findIndex((m) => m.z < -90);
    const cuantos = calidad === "alta" ? 10 : 6;
    for (let i = 0; i < cuantos; i++) {
        const modelo = modeloAldeano(azar);
        const grupo = new THREE.Group();
        const cuerpo = new THREE.Mesh(modelo.cuerpo, materialCubos);
        grupo.add(cuerpo);
        const sombra = new THREE.Mesh(geometriaSombra, materialSombra);
        sombra.scale.set(0.42, 1, 0.32);
        sombra.position.y = 0.03;
        grupo.add(sombra);
        const partes = [];
        [[-0.25, 0.75, "pierna"], [0.0, 0.75, "pierna"], [-0.375, 1.5, "brazo"], [0.375, 1.5, "brazo"]].forEach(([x, y, tipo]) => {
            const pivote = new THREE.Group();
            pivote.position.set(x, y, 0);
            const malla = new THREE.Mesh(modelo[tipo], materialCubos);
            pivote.add(malla);
            grupo.add(pivote);
            partes.push(pivote);
        });
        escena.add(grupo);
        aldeanos.push({
            grupo,
            partes,
            indice: inicio + azar() * (fin - inicio),
            sentido: azar() < 0.5 ? 1 : -1,
            velocidad: 1.8 + azar() * 1.2,
            lado: (azar() - 0.5) * 1.6,
            fase: azar() * 6,
            inicio,
            fin,
            parado: 0
        });
    }
}

const auxPunto = new THREE.Vector3();
const auxDelante = new THREE.Vector3();

function moverAldeanos(delta, tiempo) {
    aldeanos.forEach((a) => {
        if (a.parado > 0) {
            a.parado -= delta;
        } else {
            a.indice += a.sentido * a.velocidad * delta;
            if (a.indice > a.fin || a.indice < a.inicio) {
                a.sentido *= -1;
                a.indice = Math.max(a.inicio, Math.min(a.fin, a.indice));
                a.parado = 2 + Math.random() * 4;
            } else if (Math.random() < delta * 0.02) {
                a.parado = 3 + Math.random() * 5;
            }
        }
        puntoEnCamino(a.indice, auxPunto);
        puntoEnCamino(a.indice + a.sentido * 2, auxDelante);
        const direccion = Math.atan2(auxDelante.x - auxPunto.x, auxDelante.z - auxPunto.z);
        const anda = a.parado > 0 ? 0 : 1;
        const paso = tiempo * a.velocidad * 2.6 + a.fase;
        // Se aparta a un lado del camino según hacia dónde va
        const lateral = a.lado + a.sentido * 0.45;
        a.grupo.position.set(auxPunto.x + Math.cos(direccion) * lateral, auxPunto.y + Math.abs(Math.sin(paso)) * 0.05 * anda, auxPunto.z - Math.sin(direccion) * lateral);
        a.grupo.rotation.y = direccion;
        const giro = Math.sin(paso) * 0.6 * anda;
        a.partes[0].rotation.x = giro;
        a.partes[1].rotation.x = -giro;
        a.partes[2].rotation.x = -giro * 0.8;
        a.partes[3].rotation.x = giro * 0.8;
    });
}

// Ovejas
let rebano = null;
let sombrasRebano = null;
const ovejas = [];
const ZONA_PASTO = [
    { x0: 14, x1: 40, z0: -84, z1: -46 },
    { x0: 16, x1: 44, z0: 4, z1: 30 }
];

function crearOvejas() {
    const azar = crearAzar(77);
    const c = new Cubos(0.125);
    const lana = [color("#f2efe6"), color("#e6e2d6"), color("#fbf8f0")];
    for (let x = -3; x <= 3; x++) for (let y = 3; y <= 7; y++) for (let z = -4; z <= 4; z++) {
        if (Math.hypot(x / 3.4, (y - 5) / 2.6, z / 4.6) < 1) c.poner(x, y, z, elegir(lana, azar));
    }
    c.caja(-1, 5, 5, 1, 7, 7, color("#2a2420"));
    c.caja(-2, 7, 5, -2, 7, 5, color("#2a2420"));
    c.caja(2, 7, 5, 2, 7, 5, color("#2a2420"));
    [[-2, -3], [2, -3], [-2, 3], [2, 3]].forEach(([x, z]) => c.caja(x, 0, z, x, 2, z, color("#2a2420")));
    const geometria = c.geometrias().solida;
    const cuantas = calidad === "alta" ? 18 : 10;
    rebano = new THREE.InstancedMesh(geometria, materialCubos, cuantas);
    rebano.receiveShadow = true;
    sombrasRebano = new THREE.InstancedMesh(geometriaSombra, materialSombra, cuantas);
    rebano.frustumCulled = false;
    sombrasRebano.frustumCulled = false;
    escena.add(sombrasRebano);
    for (let i = 0; i < cuantas; i++) {
        const zona = ZONA_PASTO[i % ZONA_PASTO.length];
        const o = { zona, x: 0, z: 0, angulo: azar() * 6, espera: azar() * 4, destino: null, fase: azar() * 6 };
        nuevoDestino(o, azar);
        o.x = o.destino.x;
        o.z = o.destino.z;
        ovejas.push(o);
    }
    escena.add(rebano);
}

function nuevoDestino(o, azar = Math.random) {
    for (let intento = 0; intento < 20; intento++) {
        const x = o.zona.x0 + azar() * (o.zona.x1 - o.zona.x0);
        const z = o.zona.z0 + azar() * (o.zona.z1 - o.zona.z0);
        if (distanciaRio(x, z) > ANCHO_RIO + 4 && cercaDelCamino(x, z).distancia > 4 && !ocupados.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 0.8)) {
            o.destino = { x, z };
            return;
        }
    }
    o.destino = { x: o.x || (o.zona.x0 + o.zona.x1) / 2, z: o.z || (o.zona.z0 + o.zona.z1) / 2 };
}

const matrizOveja = new THREE.Matrix4();
const cuaternionOveja = new THREE.Quaternion();
const ejeY = new THREE.Vector3(0, 1, 0);
const escalaUno = new THREE.Vector3(1, 1, 1);
const escalaSombraOveja = new THREE.Vector3(0.5, 1, 0.75);
const ejeX = new THREE.Vector3(1, 0, 0);
const cabeceoOveja = new THREE.Quaternion();

function moverOvejas(delta, tiempo) {
    if (!rebano) return;
    ovejas.forEach((o, i) => {
        let pasta = 0;
        if (o.espera > 0) {
            o.espera -= delta;
            pasta = 1;
        } else {
            const dx = o.destino.x - o.x;
            const dz = o.destino.z - o.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.3) {
                o.espera = 3 + Math.random() * 8;
                nuevoDestino(o);
            } else {
                const objetivo = Math.atan2(dx, dz);
                let diferencia = objetivo - o.angulo;
                diferencia = Math.atan2(Math.sin(diferencia), Math.cos(diferencia));
                o.angulo += diferencia * Math.min(1, delta * 2);
                o.x += Math.sin(o.angulo) * 0.45 * delta;
                o.z += Math.cos(o.angulo) * 0.45 * delta;
            }
        }
        const celda = Math.floor(o.x / VOXEL) * 10000 + Math.floor(o.z / VOXEL);
        if (o.celda !== celda) {
            o.celda = celda;
            o.suelo = sueloCubos(o.x, o.z);
        }
        cuaternionOveja.setFromAxisAngle(ejeY, o.angulo);
        cabeceoOveja.setFromAxisAngle(ejeX, pasta * (0.12 + Math.sin(tiempo * 2 + o.fase) * 0.05));
        cuaternionOveja.multiply(cabeceoOveja);
        matrizOveja.compose(auxPunto.set(o.x, o.suelo - 0.05, o.z), cuaternionOveja, escalaUno);
        rebano.setMatrixAt(i, matrizOveja);
        cuaternionOveja.setFromAxisAngle(ejeY, o.angulo);
        matrizOveja.compose(auxPunto.set(o.x, o.suelo + 0.03, o.z), cuaternionOveja, escalaSombraOveja);
        sombrasRebano.setMatrixAt(i, matrizOveja);
    });
    rebano.instanceMatrix.needsUpdate = true;
    sombrasRebano.instanceMatrix.needsUpdate = true;
}

// Barca con un pescador que va y viene río abajo del puente
let barca = null;
let posicionBarca = 0;

function crearBarca() {
    const c = new Cubos(0.125);
    for (let x = -12; x <= 12; x++) {
        const ancho = Math.round(4 * Math.sqrt(1 - (x / 13) ** 2));
        for (let z = -ancho; z <= ancho; z++) {
            c.poner(x, 0, z, colores.maderaOscura);
            if (Math.abs(z) === ancho) c.caja(x, 1, z, x, 2, z, colores.madera);
        }
        if (Math.abs(x) >= 11) c.caja(x, 1, -ancho, x, 2, ancho, colores.madera);
    }
    c.caja(-1, 1, -3, 1, 1, 3, colores.maderaClara);
    // Pescador sentado con su caña
    c.caja(-1, 2, -1, 1, 6, 1, color("#4a6fa8"));
    c.caja(-1, 7, -1, 1, 9, 1, color("#e8b896"));
    c.caja(-2, 10, -2, 2, 10, 2, colores.paja);
    c.caja(-1, 11, -1, 1, 11, 1, colores.paja);
    for (let k = 0; k < 16; k++) c.poner(2 + k, 5 + Math.round(k * 0.45), 2 + Math.round(k * 0.1), colores.maderaClara);
    barca = new THREE.Mesh(c.geometrias().solida, materialCubos);
    escena.add(barca);
}

function moverBarca(delta, tiempo) {
    if (!barca) return;
    posicionBarca += delta * 0.025;
    const t = (Math.sin(posicionBarca) + 1) / 2;
    const x = 14 + t * 46;
    const z = rioZ(x) + 0.6;
    const rumbo = Math.atan2(-(rioZ(x + 0.5) - rioZ(x - 0.5)), 1) - Math.PI / 2;
    const vuelta = Math.cos(posicionBarca) >= 0 ? 0 : Math.PI;
    barca.position.set(x, NIVEL_AGUA + 0.02 + Math.sin(tiempo * 1.7) * 0.04, z);
    barca.rotation.set(Math.sin(tiempo * 1.3) * 0.03, rumbo + vuelta + Math.PI / 2, Math.sin(tiempo * 1.1) * 0.04);
}

// Peces que saltan de vez en cuando y dejan un anillo en el agua
const peces = [];

function crearPeces() {
    const azar = crearAzar(3);
    const c = new Cubos(0.06);
    for (let x = -4; x <= 4; x++) {
        const alto = Math.round(1.6 * Math.sqrt(1 - (x / 5) ** 2));
        for (let y = -alto; y <= alto; y++) c.poner(x, y, 0, x > 2 ? color("#d8d8e0") : elegir([color("#e07a2a"), color("#f0a050"), color("#c85a20")], azar));
    }
    c.caja(-6, -2, 0, -5, 2, 0, color("#c85a20"));
    const geometria = c.geometrias().solida;
    const anillo = new THREE.RingGeometry(0.85, 1, 32);
    for (let i = 0; i < 4; i++) {
        const pez = new THREE.Mesh(geometria, materialCubos);
        pez.visible = false;
        escena.add(pez);
        const onda = new THREE.Mesh(anillo, new THREE.MeshBasicMaterial({ color: "#e8f0ff", transparent: true, opacity: 0, depthWrite: false }));
        onda.rotation.x = -Math.PI / 2;
        escena.add(onda);
        peces.push({ pez, onda, t: -azar() * 6, x: 0, z: 0, rumbo: 0, ondaT: 1 });
    }
}

// Dónde saltará el pez la próxima vez
function nuevoSalto(p) {
    p.x = X_CASCADA + 8 + Math.random() * 90;
    p.z = rioZ(p.x) + (Math.random() - 0.5) * 3;
    p.rumbo = Math.random() * Math.PI * 2;
}

function moverPeces(delta) {
    peces.forEach((p) => {
        p.t += delta;
        if (p.t < 0) p.pez.visible = false;
        const duracion = 0.9;
        if (p.t >= 0 && p.t <= duracion) {
            const s = p.t / duracion;
            p.pez.visible = true;
            p.pez.position.set(p.x + Math.cos(p.rumbo) * s * 1.2, NIVEL_AGUA + Math.sin(s * Math.PI) * 0.9 - 0.05, p.z + Math.sin(p.rumbo) * s * 1.2);
            p.pez.rotation.set(0, -p.rumbo, (0.5 - s) * 2.2);
            if (s > 0.92 && p.ondaT >= 1) {
                p.ondaT = 0;
                p.onda.position.set(p.pez.position.x, NIVEL_AGUA + 0.05, p.pez.position.z);
            }
        } else if (p.t > duracion) {
            p.pez.visible = false;
            p.t = -3 - Math.random() * 7;
            nuevoSalto(p);
        }
        if (p.ondaT < 1) {
            p.ondaT = Math.min(1, p.ondaT + delta * 0.8);
            const r = 0.2 + p.ondaT * 1.4;
            p.onda.scale.set(r, r, r);
            p.onda.material.opacity = (1 - p.ondaT) * 0.6;
        }
        p.onda.visible = p.ondaT < 1;
    });
}

function crearVida() {
    crearBanderas();
    crearLevadizo();
    crearAldeanos();
    crearOvejas();
    crearBarca();
    crearPeces();
    peces.forEach(nuevoSalto);
    // Lo que se mueve no sale en el reflejo del río: ahorra muchas llamadas de dibujo
    [...aldeanos.map((a) => a.grupo), levadizo, cadenas, ...peces.map((p) => p.onda)].forEach((objeto) => objeto.traverse((o) => o.layers.set(CAPA_SIN_REFLEJO)));
}

function moverVida(delta, tiempo) {
    tiempoVivo.value = tiempo;
    moverLevadizo(delta);
    moverAldeanos(delta, tiempo);
    moverOvejas(delta, tiempo);
    moverBarca(delta, tiempo);
    moverPeces(delta);
}

// =====================================================================
// 14d. A PIE
// Recorrer el camino en primera persona: la rueda, las flechas o el
// dedo hacia arriba avanzan; arrastrar mira alrededor.
// =====================================================================

const aPie = {
    activo: false,
    indice: 0,
    objetivo: 0,
    mirarX: 0,
    mirarY: 0,
    arrastre: null
};

function empezarAPie() {
    aPie.activo = true;
    viaje = null;
    controles.enabled = false;
    controles.autoRotate = false;
    const inicio = muestrasCamino.findIndex((m) => m.z < 30);
    aPie.indice = aPie.objetivo = Math.max(0, inicio);
    aPie.mirarX = 0;
    aPie.mirarY = 0.08;
    document.body.classList.add("a-pie");
}

function terminarAPie() {
    if (!aPie.activo) return;
    aPie.activo = false;
    aPie.arrastre = null;
    controles.enabled = true;
    document.body.classList.remove("a-pie");
    // La órbita sigue mirando hacia donde miraba el paseante
    const delante = new THREE.Vector3();
    camara.getWorldDirection(delante);
    controles.target.copy(camara.position).addScaledVector(delante, 30);
}

let finPatio = -1;
let finLevadizo = -1;

function avanzarAPie(cantidad) {
    if (finPatio < 0) {
        finPatio = muestrasCamino.findIndex((m) => m.z < bisagraPuerta.z + 3);
        finLevadizo = muestrasCamino.findIndex((m) => m.z < bisagraPuerta.z + 4.6);
    }
    const tope = anguloLevadizo < -0.3 ? finLevadizo : finPatio;
    aPie.objetivo = Math.max(0, Math.min(tope, aPie.objetivo + cantidad));
}

const auxMirada = new THREE.Vector3();

function moverAPie(delta, tiempo) {
    const antes = aPie.indice;
    aPie.indice += (aPie.objetivo - aPie.indice) * Math.min(1, delta * 2.2);
    const andando = Math.abs(aPie.indice - antes) > delta * 0.4 ? 1 : 0;
    puntoEnCamino(aPie.indice, auxPunto);
    puntoEnCamino(aPie.indice + 16, auxDelante);
    const rumbo = Math.atan2(auxDelante.x - auxPunto.x, auxDelante.z - auxPunto.z) + aPie.mirarX;
    // Al llegar a la puerta se levanta la mirada para ver las torres
    const enPuerta = suave(-108, -116, auxPunto.z);
    const subida = Math.atan2(auxDelante.y - auxPunto.y, 8) * 0.5 + 0.18 * enPuerta + aPie.mirarY;
    camara.position.set(auxPunto.x, auxPunto.y + 1.65 + Math.sin(aPie.indice * 1.3) * 0.04 * andando, auxPunto.z);
    auxMirada.set(Math.sin(rumbo) * Math.cos(subida), Math.sin(subida), Math.cos(rumbo) * Math.cos(subida)).add(camara.position);
    camara.lookAt(auxMirada);
}

renderizador.domElement.addEventListener("wheel", (evento) => {
    if (!aPie.activo) return;
    evento.preventDefault();
    avanzarAPie(evento.deltaY * 0.03);
}, { passive: false });

window.addEventListener("keydown", (evento) => {
    if (!aPie.activo) return;
    if (["ArrowUp", "w", "W"].includes(evento.key)) avanzarAPie(4);
    if (["ArrowDown", "s", "S"].includes(evento.key)) avanzarAPie(-4);
    if (["ArrowLeft", "a", "A"].includes(evento.key)) aPie.mirarX += 0.12;
    if (["ArrowRight", "d", "D"].includes(evento.key)) aPie.mirarX -= 0.12;
});

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    if (!aPie.activo || aPie.arrastre) return;
    aPie.arrastre = { id: evento.pointerId, x: evento.clientX, y: evento.clientY, tactil: evento.pointerType === "touch" };
    try {
        renderizador.domElement.setPointerCapture(evento.pointerId);
    } catch (error) {
        // Algunos navegadores no lo permiten; no pasa nada
    }
});

renderizador.domElement.addEventListener("pointermove", (evento) => {
    const a = aPie.arrastre;
    if (!aPie.activo || !a || a.id !== evento.pointerId) return;
    if (!a.tactil && evento.buttons === 0) {
        aPie.arrastre = null;
        return;
    }
    const dx = evento.clientX - a.x;
    const dy = evento.clientY - a.y;
    a.x = evento.clientX;
    a.y = evento.clientY;
    aPie.mirarX -= dx * 0.004;
    // Con el dedo, deslizar en vertical camina; con el ratón, mira arriba y abajo
    if (a.tactil) avanzarAPie(-dy * 0.06);
    else aPie.mirarY = Math.max(-0.6, Math.min(0.6, aPie.mirarY - dy * 0.003));
});

["pointerup", "pointercancel", "lostpointercapture"].forEach((tipo) => {
    renderizador.domElement.addEventListener(tipo, (evento) => {
        if (aPie.arrastre && aPie.arrastre.id === evento.pointerId) aPie.arrastre = null;
    });
});

// =====================================================================
// 15. BOTONES
// =====================================================================

const botonesVista = document.querySelectorAll("[data-vista]");
const botonesAmbiente = document.querySelectorAll("[data-ambiente]");
const botonPaseo = document.getElementById("boton-paseo");
const botonSonido = document.getElementById("boton-sonido");
const botonCalidad = document.getElementById("boton-calidad");
const pista = document.getElementById("pista");
let paseo = false;
let tiempoPaseo = 0;
let vistaActual = 0;

function marcarVista(i) {
    if (i >= 0) vistaActual = i;
    if (i >= 0 && botonAPie) {
        botonAPie.classList.remove("activo");
        botonAPie.setAttribute("aria-pressed", "false");
    }
    botonesVista.forEach((b) => {
        b.classList.toggle("activo", Number(b.dataset.vista) === i);
        b.setAttribute("aria-pressed", String(Number(b.dataset.vista) === i));
    });
}

botonesVista.forEach((boton) => {
    boton.addEventListener("click", () => {
        const i = Number(boton.dataset.vista);
        marcarVista(i);
        terminarAPie();
        irAVista(i);
        tiempoPaseo = 0;
    });
});

const botonAPie = document.getElementById("boton-a-pie");
botonAPie.addEventListener("click", () => {
    // Si ya vas a pie, el botón te devuelve a la vista que tenías
    if (aPie.activo) {
        terminarAPie();
        marcarVista(vistaActual);
        irAVista(vistaActual);
        return;
    }
    paseo = false;
    botonPaseo.classList.remove("activo");
    botonPaseo.setAttribute("aria-pressed", "false");
    marcarVista(-1);
    botonAPie.classList.add("activo");
    botonAPie.setAttribute("aria-pressed", "true");
    empezarAPie();
    pista.textContent = movil ? "Desliza arriba para caminar · a los lados para mirar" : "Rueda o flechas para caminar · arrastra para mirar";
    pista.classList.remove("oculta");
    setTimeout(() => pista.classList.add("oculta"), 5000);
});

botonesAmbiente.forEach((boton) => {
    boton.addEventListener("click", () => {
        copiarAmbiente(ambienteDesde, ambienteActual);
        ambienteHasta = ambientes[boton.dataset.ambiente];
        progresoAmbiente = 0;
        botonesAmbiente.forEach((b) => {
            b.classList.toggle("activo", b === boton);
            b.setAttribute("aria-pressed", String(b === boton));
        });
    });
});

botonPaseo.addEventListener("click", () => {
    if (aPie.activo) {
        terminarAPie();
        marcarVista(vistaActual);
        irAVista(vistaActual);
    }
    paseo = !paseo;
    botonPaseo.classList.toggle("activo", paseo);
    botonPaseo.setAttribute("aria-pressed", String(paseo));
    tiempoPaseo = 0;
    controles.autoRotate = paseo && !movimientoReducido;
});

botonSonido.addEventListener("click", async () => {
    if (!audio) {
        audio = crearSonido();
        await audio.ctx.resume();
        botonSonido.classList.add("activo");
        botonSonido.setAttribute("aria-pressed", "true");
        return;
    }
    if (audio.ctx.state === "running") {
        await audio.ctx.suspend();
        botonSonido.classList.remove("activo");
    } else {
        await audio.ctx.resume();
        botonSonido.classList.add("activo");
    }
    botonSonido.setAttribute("aria-pressed", String(botonSonido.classList.contains("activo")));
});

function textoCalidad() {
    botonCalidad.textContent = calidad === "alta" ? "Calidad alta" : "Calidad ligera";
}

// Cambiar la calidad vuelve a construir el valle (cambia el número de
// árboles, la lluvia y el reflejo), así que se recarga con la opción
botonCalidad.addEventListener("click", () => {
    const nuevos = new URLSearchParams(location.search);
    nuevos.set("calidad", calidad === "alta" ? "ligera" : "alta");
    nuevos.set("vista", String(vistaActual + 1));
    const ambiente = Object.keys(ambientes).find((k) => ambientes[k] === ambienteHasta);
    if (ambiente) nuevos.set("ambiente", ambiente);
    location.search = nuevos.toString();
});

document.getElementById("boton-centrar").addEventListener("click", () => {
    terminarAPie();
    marcarVista(0);
    irAVista(0);
});

document.getElementById("boton-ocultar").addEventListener("click", () => document.body.classList.add("sin-interfaz"));
document.getElementById("boton-mostrar").addEventListener("click", () => document.body.classList.remove("sin-interfaz"));
const botonMenu = document.getElementById("boton-menu");
botonMenu.addEventListener("click", () => {
    const abierto = document.body.classList.toggle("menu-abierto");
    botonMenu.setAttribute("aria-expanded", String(abierto));
});

document.getElementById("boton-guardar").addEventListener("click", () => {
    compositor.render();
    renderizador.domElement.toBlob((archivo) => {
        if (!archivo) return;
        const enlace = document.createElement("a");
        enlace.href = URL.createObjectURL(archivo);
        enlace.download = "camino-al-castillo.png";
        enlace.click();
        setTimeout(() => URL.revokeObjectURL(enlace.href), 2000);
    });
});

renderizador.domElement.addEventListener("pointerdown", () => {
    if (!aPie.activo) pista.classList.add("oculta");
    viaje = null;
});

if (parametros.get("interfaz") === "no") document.body.classList.add("sin-interfaz", "captura");

// =====================================================================
// 16. TAMAÑO DE LA VENTANA
// =====================================================================

function ajustarTamano() {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.fov = camara.aspect < 0.8 ? 60 : 42;
    camara.updateProjectionMatrix();
    aplicarCalidad();
    if (agua) {
        const escala = calidad === "alta" ? 0.75 : 0.4;
        agua.getRenderTarget().setSize(Math.round(window.innerWidth * escala), Math.round(window.innerHeight * escala));
    }
}
window.addEventListener("resize", ajustarTamano);

// =====================================================================
// 17. CONSTRUCCIÓN Y BUCLE PRINCIPAL
// =====================================================================

const reloj = new THREE.Clock();
let tiempo = 0;

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    tiempo += delta;

    if (progresoAmbiente < 1) {
        progresoAmbiente = Math.min(1, progresoAmbiente + delta / 2.5);
        mezclarAmbientes(progresoAmbiente);
        aplicarAmbiente();
    }
    uniformesCielo.uTiempo.value = tiempo;
    agua.material.uniforms.uTiempo.value = tiempo;
    aguaViva.uTiempo.value = tiempo;
    esferaCielo.position.copy(camara.position);
    if (ruedaMolino) ruedaMolino.rotation.z -= delta * (movimientoReducido ? 0.15 : 0.5);

    if (paseo) {
        tiempoPaseo += delta;
        if (tiempoPaseo > 16) {
            tiempoPaseo = 0;
            const siguiente = (vistaActual + 1) % vistas.length;
            marcarVista(siguiente);
            irAVista(siguiente);
        }
    }
    if (aPie.activo) {
        moverAPie(delta, tiempo);
    } else {
        moverViaje(delta);
        controles.update();
        const sueloCamara = altura(camara.position.x, camara.position.z) + 1.2;
        if (camara.position.y < sueloCamara) camara.position.y = sueloCamara;
    }
    moverVida(delta, tiempo);
    moverParticulas(delta, tiempo);
    actualizarSonido();
    compositor.render();
}

async function paso(texto) {
    cargando.textContent = texto;
    await new Promise((r) => setTimeout(r, 30));
}

async function construir() {
    try {
        textoCalidad();
        ajustarTamano();
        await paso("Levantando las montañas...");
        crearValle();
        crearAgua();
        agua.material.side = THREE.DoubleSide;

        await paso("Construyendo el castillo...");
        crearCastillo();
        puente = crearPuente(cruces[0]);
        ocupados.push({ x: puente.x, z: puente.z, r: 12 });

        await paso("Levantando la aldea...");
        crearAldea();
        const edificios = new THREE.Mesh(mergeGeometries(piezasSolidas), materialCubos);
        edificios.castShadow = true;
        edificios.receiveShadow = true;
        escena.add(edificios);
        if (piezasLuz.length) escena.add(new THREE.Mesh(mergeGeometries(piezasLuz), materialLuces));
        crearVida();
        // Cada luz encarece todos los materiales: en calidad ligera, menos
        lucesCalidas.slice(0, calidad === "alta" ? 8 : 4).forEach((p) => {
            const foco = new THREE.PointLight("#ffb060", 0, 16, 2);
            foco.position.copy(p);
            escena.add(foco);
            focos.push(foco);
        });

        await paso("Plantando el bosque...");
        prepararModelos();
        plantarBosque(ocupados);
        plantarBosqueLejano();
        crearParticulas();

        prepararVistas();
        const pedida = Number(parametros.get("vista")) - 1;
        const inicial = pedida >= 0 && pedida < vistas.length ? pedida : 0;
        marcarVista(inicial);
        irAVista(inicial, true);
        if (parametros.has("camara")) {
            const n = parametros.get("camara").split(",").map(Number);
            if (n.length === 6 && n.every(Number.isFinite)) {
                camara.position.set(n[0], n[1], n[2]);
                controles.target.set(n[3], n[4], n[5]);
                controles.update();
            }
        }
        copiarAmbiente(ambienteActual, ambienteHasta);
        aplicarAmbiente();
        botonesAmbiente.forEach((b) => {
            const activo = ambientes[b.dataset.ambiente] === ambienteHasta;
            b.classList.toggle("activo", activo);
            b.setAttribute("aria-pressed", String(activo));
        });

        cargando.classList.add("oculta");
        animar();
    } catch (error) {
        cargando.textContent = "Algo ha fallado al construir el valle. Prueba a recargar la página.";
        console.error(error);
    }
}

construir();
