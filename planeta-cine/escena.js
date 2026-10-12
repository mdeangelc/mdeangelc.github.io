import * as THREE from "three";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { texturaRuido, crearCielo, PaseBrillo, crearAcabado, crearZumbido } from "./cine.js";

// =====================================================================
// 1. AJUSTES
// El planeta pequeño visto desde el espacio, como en una película: el
// sol asoma por el borde y deja medio planeta de día y medio de noche.
// En la cara de día hay bosques, prados, mares que reflejan el sol y nubes
// finas; en la de noche se ven las farolas del camino, las casas, el
// castillo encendidos y tormentas con relámpagos. Tiene anillos que
// echan sombra, una aurora en el polo alrededor del castillo, cuatro
// lunas (cada una abre una parte del portfolio) y de vez en cuando pasa
// un cometa. La cámara solo se inclina un poco con el ratón.
// Opciones en la dirección:
//   ?sinentrada  -> sin la entrada
//   ?fijo        -> sin entrada ni cambios de resolución
//   ?ola=0.5     -> deja la ola de luz quieta en ese punto del camino
//   ?cometa=si   -> el cometa sale enseguida
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const pocoMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ajustes = {
    detalle: movil ? 64 : 96,
    casas: movil ? 40 : 60,
    resolucionMax: movil ? 1.5 : 1.75,
    resolucionMin: movil ? 0.75 : 1
};

let semilla = 7;
const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return (semilla - 1) / 2147483646;
};
const ruido = new SimplexNoise({ random: azar });

// El sol empieza detrás del planeta y acaba a un lado
const SOL_INICIO = new THREE.Vector3(-0.12, 0.12, -1).normalize();
const SOL_FINAL = new THREE.Vector3(-0.92, 0.34, -0.06).normalize();
const DIR_SOL = SOL_FINAL.clone();
const OBJETIVO = new THREE.Vector3(0, 0.12, 0);
const CENTRO = new THREE.Vector3(0, 0, 0);
const BASE_ALTURA = 0.24;


// =====================================================================
// 2. RENDERIZADOR, ESCENA Y CÁMARA
// =====================================================================

let renderizador;
try {
    renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (error) {
    document.getElementById("cargando").textContent = "Tu navegador no puede mostrar el planeta.";
    throw error;
}
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
document.body.prepend(renderizador.domElement);
renderizador.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
renderizador.domElement.addEventListener("webglcontextrestored", () => location.reload());

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 400);

const sol = new THREE.DirectionalLight(0xfff1dc, 3.2);
escena.add(sol);
const cielo = new THREE.HemisphereLight(0x5a6fa8, 0x0a0a12, 0.16);
escena.add(cielo);
const relleno = new THREE.DirectionalLight(0x8ea4e0, 0.22);
relleno.position.set(2, 3, 6);
escena.add(relleno);

const tRuido = { value: texturaRuido() };
const tiempo = { value: 0 };
const comunes = {
    uSol: { value: DIR_SOL },
    uTiempo: tiempo,
    tRuido,
    uOla: { value: -1 },
    uFuerzaSol: { value: 1 },
    uNormalAnillo: { value: new THREE.Vector3(0, 1, 0) },
    uTormentas: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }
};

// Radios del anillo (en radios del planeta) y cuánto polvo hay a cada
// distancia. Lo usan el anillo, el suelo y las nubes (para la sombra).
const ANILLO_DENTRO = 1.42;
const ANILLO_FUERA = 2.15;
const anilloGlsl = `
    uniform vec3 uNormalAnillo;
    float densidadAnillo(float r) {
        float x = (r - ${ANILLO_DENTRO.toFixed(2)}) / ${(ANILLO_FUERA - ANILLO_DENTRO).toFixed(2)};
        if (x < 0.0 || x > 1.0) return 0.0;
        float a = texture2D(tRuido, vec2(x * 0.7 + 0.05, 0.137)).r;
        float b = texture2D(tRuido, vec2(x * 2.9 + 0.3, 0.618)).r;
        float d = 0.12 + 0.88 * smoothstep(0.34, 0.64, a * 0.55 + b * 0.45);
        d *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.88, x);
        d *= 1.0 - 0.92 * smoothstep(0.035, 0.0, abs(x - 0.64));
        d *= 1.0 - 0.6 * smoothstep(0.018, 0.0, abs(x - 0.85));
        d *= mix(0.35, 1.0, smoothstep(0.04, 0.3, x));
        return d;
    }
    // 1 = sin sombra; el rayo hacia el sol corta el plano del anillo
    float sombraAnillo(vec3 p, vec3 sol) {
        float den = dot(uNormalAnillo, sol);
        if (abs(den) < 0.0001) return 1.0;
        float s = -dot(uNormalAnillo, p) / den;
        if (s <= 0.0) return 1.0;
        return 1.0 - densidadAnillo(length(p + sol * s)) * 0.82;
    }
`;


// =====================================================================
// 3. EL RELIEVE
// Colinas suaves de ruido; bajo el camino y en lo alto, donde está el
// castillo, el suelo se allana. En los huecos más bajos hay lagos.
// =====================================================================

const camino = [];
const PUNTOS_CAMINO = 420;
const NIVEL_AGUA = 0.991;

function direccion(lat, lon, destino = new THREE.Vector3()) {
    return destino.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

for (let i = 0; i < PUNTOS_CAMINO; i++) {
    const t = i / (PUNTOS_CAMINO - 1);
    const lat = THREE.MathUtils.lerp(-1.05, 1.32, t) + Math.sin(t * 23) * 0.025;
    const lon = t * Math.PI * 2 * 2.2 + Math.sin(t * 17) * 0.08;
    camino.push(direccion(lat, lon));
}

// Distancia (en ángulo) al camino y en qué punto del camino cae
function cercaDelCamino(d) {
    let mejor = -2;
    let indice = 0;
    for (let i = 0; i < PUNTOS_CAMINO; i += 6) {
        const c = camino[i].dot(d);
        if (c > mejor) {
            mejor = c;
            indice = i;
        }
    }
    const desde = Math.max(0, indice - 6);
    const hasta = Math.min(PUNTOS_CAMINO - 1, indice + 6);
    for (let i = desde; i <= hasta; i++) {
        const c = camino[i].dot(d);
        if (c > mejor) {
            mejor = c;
            indice = i;
        }
    }
    return { distancia: Math.acos(Math.min(1, mejor)), indice };
}

const suave = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

function alturaBruta(d) {
    return ruido.noise3d(d.x * 1.7, d.y * 1.7, d.z * 1.7) * 0.034 + ruido.noise3d(d.x * 4.2 + 5, d.y * 4.2, d.z * 4.2) * 0.013 + ruido.noise3d(d.x * 9 + 2, d.y * 9, d.z * 9) * 0.0025;
}

function altura(d, dc = cercaDelCamino(d).distancia) {
    let h = alturaBruta(d);
    h = THREE.MathUtils.lerp(h * 0.3, h, suave(0.035, 0.11, dc));
    const cima = suave(0.9, 0.97, d.y);
    h = THREE.MathUtils.lerp(h, 0.012, cima);
    return 1 + h;
}


// =====================================================================
// 4. EL PLANETA
// Una esfera muy subdividida con colores por vértice: bosque oscuro,
// prados, roca y tierra junto al camino. Los lagos son lisos y brillan
// con el sol. Por encima se pinta el filo de la atmósfera, que se ve
// azul de día y naranja justo donde amanece.
// =====================================================================

const eje = new THREE.Group();
eje.rotation.z = 0.3;
escena.add(eje);
const planeta = new THREE.Group();
eje.add(planeta);

function crearSuelo() {
    const icosaedro = new THREE.IcosahedronGeometry(1, ajustes.detalle);
    icosaedro.deleteAttribute("normal");
    icosaedro.deleteAttribute("uv");
    const geometria = mergeVertices(icosaedro);
    const pos = geometria.attributes.position;
    const colores = new Float32Array(pos.count * 3);
    const agua = new Float32Array(pos.count);
    const d = new THREE.Vector3();
    const bosque = new THREE.Color(0.06, 0.12, 0.06);
    const prado = new THREE.Color(0.2, 0.27, 0.1);
    const seco = new THREE.Color(0.36, 0.32, 0.17);
    const roca = new THREE.Color(0.32, 0.3, 0.28);
    const tierra = new THREE.Color(0.42, 0.33, 0.22);
    const lago = new THREE.Color(0.02, 0.06, 0.09);
    const orilla = new THREE.Color(0.32, 0.3, 0.2);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i).normalize();
        const dc = cercaDelCamino(d).distancia;
        let h = altura(d, dc);
        const esAgua = suave(NIVEL_AGUA + 0.002, NIVEL_AGUA - 0.004, h) * suave(0.05, 0.07, dc);
        h = Math.max(h, NIVEL_AGUA - 0.001 * esAgua);
        pos.setXYZ(i, d.x * h, d.y * h, d.z * h);
        const manchas = ruido.noise3d(d.x * 5, d.y * 5, d.z * 5) * 0.5 + 0.5;
        const detalle = ruido.noise3d(d.x * 24, d.y * 24, d.z * 24) * 0.5 + 0.5;
        c.copy(bosque).lerp(prado, suave(0.45, 0.75, manchas));
        c.lerp(seco, Math.max(0, ruido.noise3d(d.x * 3 + 9, d.y * 3, d.z * 3)) * 0.5);
        c.lerp(roca, suave(1.03, 1.045, h) * 0.8);
        c.lerp(orilla, (1 - suave(NIVEL_AGUA, NIVEL_AGUA + 0.008, h)) * 0.7);
        c.lerp(tierra, 1 - suave(0.018, 0.04, dc));
        c.multiplyScalar(0.85 + detalle * 0.3);
        c.lerp(lago, esAgua);
        colores.set([c.r, c.g, c.b], i * 3);
        agua[i] = esAgua;
    }
    geometria.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    geometria.setAttribute("aAgua", new THREE.BufferAttribute(agua, 1));
    geometria.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, comunes);
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float aAgua;\nvarying float vAgua;\nvarying vec3 vNormalMundo;\nvarying vec3 vMundo;")
            .replace(
                "#include <worldpos_vertex>",
                `#include <worldpos_vertex>
                vAgua = aAgua;
                vNormalMundo = normalize(mat3(modelMatrix) * normal);
                vMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform vec3 uSol;\nuniform sampler2D tRuido;\nuniform float uTiempo;\nuniform float uFuerzaSol;\nvarying float vAgua;\nvarying vec3 vNormalMundo;\nvarying vec3 vMundo;\n" + anilloGlsl)
            .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.14, vAgua);")
            .replace(
                "#include <opaque_fragment>",
                `vec3 nM = normalize(vNormalMundo);
                vec3 vistaM = normalize(cameraPosition - vMundo);
                float luzM = dot(normalize(vMundo), uSol);
                float sombraA = sombraAnillo(vMundo, uSol);
                outgoingLight *= mix(1.0, sombraA, smoothstep(-0.1, 0.15, luzM));
                vec2 olas = vec2(texture2D(tRuido, vMundo.xz * 5.0 + uTiempo * 0.012).r, texture2D(tRuido, vMundo.zy * 5.0 - uTiempo * 0.01).r) - 0.5;
                vec3 nAgua = normalize(normalize(vMundo) + vec3(olas.x, 0.0, olas.y) * 0.22);
                float rs = max(dot(reflect(-vistaM, nAgua), uSol), 0.0);
                outgoingLight += vec3(1.0, 0.9, 0.74) * (pow(rs, 500.0) * 40.0 + pow(rs, 40.0) * 0.9 + pow(rs, 6.0) * 0.08) * vAgua * smoothstep(0.0, 0.15, luzM) * uFuerzaSol * sombraA;
                float borde = pow(1.0 - clamp(dot(nM, vistaM), 0.0, 1.0), 3.0);
                vec3 aire = mix(vec3(1.0, 0.45, 0.2), vec3(0.35, 0.6, 1.0), smoothstep(0.0, 0.35, luzM));
                outgoingLight += aire * borde * smoothstep(-0.15, 0.25, luzM) * 0.55;
                outgoingLight += vec3(0.008, 0.01, 0.02) * (1.0 - smoothstep(-0.2, 0.1, luzM));
                #include <opaque_fragment>`
            );
    };
    material.customProgramCacheKey = () => "suelo";
    const suelo = new THREE.Mesh(geometria, material);
    planeta.add(suelo);
    return suelo;
}

function crearCamino() {
    const posiciones = [];
    const colores = [];
    const indices = [];
    const tangente = new THREE.Vector3();
    const lado = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < PUNTOS_CAMINO; i++) {
        const d = camino[i];
        tangente.subVectors(camino[Math.min(PUNTOS_CAMINO - 1, i + 1)], camino[Math.max(0, i - 1)]).normalize();
        lado.crossVectors(tangente, d).normalize();
        const ancho = 0.012 * (i < 8 ? i / 8 : 1);
        for (const s of [-1, 1]) {
            p.copy(d).addScaledVector(lado, s * ancho).normalize();
            const h = altura(p) + 0.002;
            posiciones.push(p.x * h, p.y * h, p.z * h);
            const v = 0.85 + ruido.noise3d(p.x * 40, p.y * 40, p.z * 40) * 0.15;
            colores.push(0.55 * v, 0.47 * v, 0.34 * v);
        }
        if (i > 0) {
            const a = (i - 1) * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
    geometria.setAttribute("color", new THREE.Float32BufferAttribute(colores, 3));
    geometria.setIndex(indices);
    geometria.computeVertexNormals();
    planeta.add(new THREE.Mesh(geometria, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));
}


// =====================================================================
// 5. COLOCAR COSAS EN LA SUPERFICIE
// =====================================================================

const arriba = new THREE.Vector3(0, 1, 0);

// =====================================================================
// 6. EL CASTILLO
// En lo alto del planeta, de piedra gris y tejados de pizarra, con la
// puerta mirando al final del camino. Sus ventanas se encienden de
// noche.
// =====================================================================

const ventanasCastillo = [];

function crearCastillo() {
    const castillo = new THREE.Group();
    const piedra = new THREE.MeshStandardMaterial({ color: 0xc4bbae, roughness: 0.85, emissive: 0x1a1410 });
    const piedraOscura = new THREE.MeshStandardMaterial({ color: 0x6a655f, roughness: 0.95 });
    const pizarra = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.7 });
    const pizarraRoja = new THREE.MeshStandardMaterial({ color: 0x4a2a26, roughness: 0.7 });
    const piezas = [];
    const pieza = (geo, mat, x, y, z, ry = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        piezas.push(m);
        return m;
    };
    pieza(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 40), piedraOscura, 0, 0, 0);
    [[0.13, 0.13, 0.2, pizarra], [-0.13, 0.13, 0.17, pizarraRoja], [0.13, -0.13, 0.17, pizarraRoja], [-0.13, -0.13, 0.2, pizarra]].forEach(([x, z, alto, teja]) => {
        pieza(new THREE.CylinderGeometry(0.036, 0.04, alto, 20), piedra, x, alto / 2, z);
        pieza(new THREE.ConeGeometry(0.046, 0.11, 20), teja, x, alto + 0.055, z);
        const a = Math.atan2(x, z);
        ventanasCastillo.push(new THREE.Vector3(x + Math.sin(a) * 0.04, alto * 0.62, z + Math.cos(a) * 0.04));
    });
    const muro = new THREE.BoxGeometry(0.26, 0.09, 0.022);
    [[0, 0.13, 0], [0, -0.13, 0], [0.13, 0, Math.PI / 2], [-0.13, 0, Math.PI / 2]].forEach(([x, z, r]) => pieza(muro, piedra, x, 0.045, z, r));
    pieza(new THREE.BoxGeometry(0.12, 0.2, 0.12), piedra, 0, 0.1, -0.01);
    pieza(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 20), piedra, 0, 0.25, -0.01);
    pieza(new THREE.ConeGeometry(0.05, 0.13, 20), pizarra, 0, 0.365, -0.01);
    [[0, 0.14, 0.062], [0.062, 0.14, -0.01], [-0.062, 0.14, -0.01], [0, 0.27, 0.037]].forEach(([x, y, z]) => ventanasCastillo.push(new THREE.Vector3(x, y, z)));

    const porMaterial = new Map();
    piezas.forEach((m) => {
        m.updateMatrix();
        const geo = m.geometry.clone().applyMatrix4(m.matrix);
        geo.deleteAttribute("uv");
        if (!porMaterial.has(m.material)) porMaterial.set(m.material, []);
        porMaterial.get(m.material).push(geo.index ? geo.toNonIndexed() : geo);
    });
    porMaterial.forEach((lista, material) => castillo.add(new THREE.Mesh(mergeGeometries(lista), material)));

    const final = camino[PUNTOS_CAMINO - 1];
    castillo.rotation.y = Math.atan2(final.x, final.z);
    castillo.position.set(0, altura(new THREE.Vector3(0, 1, 0)) - 0.005, 0);
    castillo.scale.setScalar(0.65);
    planeta.add(castillo);
    castillo.updateMatrix();
    return castillo;
}


// =====================================================================
// 7. NUBES Y ATMÓSFERA
// Las nubes son una capa de ruido fina que gira un poco más rápido que
// el planeta; se iluminan con el sol y de noche casi no se ven. La
// atmósfera es un halo que solo brilla en el borde del planeta.
// =====================================================================

function crearNubes() {
    const material = new THREE.ShaderMaterial({
        uniforms: comunes,
        vertexShader: `
            varying vec3 vLocal;
            varying vec3 vMundo;
            varying vec3 vNormalMundo;
            void main() {
                vLocal = normalize(position);
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                vNormalMundo = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform sampler2D tRuido;
            uniform vec3 uSol;
            uniform float uTiempo;
            uniform vec4 uTormentas[8];
            varying vec3 vLocal;
            varying vec3 vMundo;
            varying vec3 vNormalMundo;
            ${anilloGlsl}
            float plano(vec3 p, float escala) {
                vec3 w = pow(abs(p), vec3(4.0));
                w /= w.x + w.y + w.z;
                return texture2D(tRuido, p.yz * escala).r * w.x + texture2D(tRuido, p.xz * escala + 0.31).r * w.y + texture2D(tRuido, p.xy * escala + 0.67).r * w.z;
            }
            void main() {
                vec3 p = vLocal;
                float n = plano(p + vec3(uTiempo * 0.004, 0.0, 0.0), 0.55) * 0.65 + plano(p * 1.0, 1.7) * 0.35;
                float masa = 0.0;
                float rayo = 0.0;
                for (int i = 0; i < 8; i++) {
                    float c = dot(p, uTormentas[i].xyz);
                    masa = max(masa, smoothstep(0.975, 0.997, c));
                    rayo += (exp(-(1.0 - c) * 160.0) + exp(-(1.0 - c) * 30.0) * 0.12) * uTormentas[i].w;
                }
                float densidad = smoothstep(0.56, 0.76, n + masa * 0.16);
                densidad *= 1.0 - smoothstep(0.8, 0.95, p.y);
                if (densidad < 0.01) discard;
                vec3 n3 = normalize(vNormalMundo);
                float luz = dot(n3, uSol);
                vec3 dia = vec3(1.0, 0.98, 0.95) * smoothstep(-0.1, 0.5, luz) * 1.05;
                vec3 amanecer = vec3(1.0, 0.55, 0.3) * exp(-pow((luz - 0.02) / 0.12, 2.0)) * 0.8;
                vec3 color = (dia + amanecer) * sombraAnillo(vMundo, uSol) + vec3(0.01, 0.012, 0.02);
                color += vec3(0.7, 0.78, 1.0) * rayo * (0.35 + n) * 5.0;
                float vista = abs(dot(n3, normalize(cameraPosition - vMundo)));
                gl_FragColor = vec4(color, densidad * 0.75 * smoothstep(0.0, 0.25, vista));
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false
    });
    const nubes = new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 64), material);
    nubes.name = "nubes";
    nubes.renderOrder = 2;
    eje.add(nubes);
    return nubes;
}

function crearAtmosfera() {
    const material = new THREE.ShaderMaterial({
        uniforms: comunes,
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vPosicion;
            void main() {
                vNormal = normalize(mat3(modelMatrix) * normal);
                vec4 p = modelMatrix * vec4(position, 1.0);
                vPosicion = p.xyz;
                gl_Position = projectionMatrix * viewMatrix * p;
            }
        `,
        fragmentShader: `
            uniform vec3 uSol;
            varying vec3 vNormal;
            varying vec3 vPosicion;
            void main() {
                vec3 n = normalize(vNormal);
                vec3 V = normalize(cameraPosition - vPosicion);
                float halo = pow(clamp(-dot(n, V) / 0.42, 0.0, 1.0), 3.2);
                float luz = dot(normalize(vPosicion), uSol);
                vec3 color = mix(vec3(1.0, 0.42, 0.18), vec3(0.32, 0.58, 1.0), smoothstep(-0.05, 0.35, luz));
                float fuerza = smoothstep(-0.35, 0.2, luz) + pow(max(0.0, dot(-V, uSol)), 6.0) * 2.0 * smoothstep(-0.6, 0.0, luz);
                gl_FragColor = vec4(color * halo * fuerza * 1.6, 1.0);
            }
        `,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material);
    halo.scale.setScalar(1.12);
    halo.renderOrder = 3;
    escena.add(halo);
}


// =====================================================================
// 7b. LOS ANILLOS
// Un disco de polvo con bandas y huecos, como los de Saturno. Brilla
// más cuando el sol está detrás (la luz atraviesa el polvo), el planeta
// le echa sombra y él echa sombra sobre el planeta y las nubes.
// =====================================================================

function crearAnillos() {
    const geometria = new THREE.RingGeometry(ANILLO_DENTRO, ANILLO_FUERA, 256, 1);
    const material = new THREE.ShaderMaterial({
        uniforms: comunes,
        vertexShader: `
            varying vec3 vMundo;
            varying vec2 vLocal;
            void main() {
                vLocal = position.xy;
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform sampler2D tRuido;
            uniform vec3 uSol;
            uniform float uTiempo;
            uniform float uFuerzaSol;
            varying vec3 vMundo;
            varying vec2 vLocal;
            ${anilloGlsl}
            void main() {
                float r = length(vLocal);
                float d = densidadAnillo(r);
                float x = (r - ${ANILLO_DENTRO.toFixed(2)}) / ${(ANILLO_FUERA - ANILLO_DENTRO).toFixed(2)};
                float angulo = atan(vLocal.y, vLocal.x) / 6.2831853;
                d *= 0.8 + 0.4 * texture2D(tRuido, vec2(x * 9.0, 0.37)).r;
                d *= 0.9 + 0.2 * texture2D(tRuido, vec2(angulo * 6.0 + uTiempo * 0.003, x * 3.0)).r;
                if (d < 0.004) discard;

                vec3 V = normalize(cameraPosition - vMundo);
                float deFrente = dot(uNormalAnillo, uSol) * dot(uNormalAnillo, V);
                float b = dot(vMundo, uSol);
                float lejos = sqrt(max(dot(vMundo, vMundo) - b * b, 0.0));
                float sombra = b < 0.0 ? smoothstep(0.97, 1.05, lejos) : 1.0;
                float cara = deFrente > 0.0 ? 0.35 + 0.65 * abs(dot(uNormalAnillo, uSol)) : 0.3 * (1.0 - d * 0.5);
                float contraluz = pow(max(dot(-V, uSol), 0.0), 5.0) * 1.6;
                float tono = texture2D(tRuido, vec2(x * 1.7, 0.83)).r;
                vec3 polvo = mix(vec3(0.42, 0.33, 0.25), vec3(0.85, 0.76, 0.62), smoothstep(0.3, 0.9, d));
                polvo = mix(polvo, polvo * vec3(0.8, 0.85, 1.0), smoothstep(0.4, 0.65, tono));
                vec3 color = polvo * (cara + contraluz) * sombra * uFuerzaSol * 0.85 + polvo * 0.01;
                gl_FragColor = vec4(color, d * 0.7);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const anillos = new THREE.Mesh(geometria, material);
    anillos.rotation.x = -Math.PI / 2;
    anillos.renderOrder = 4;
    eje.add(anillos);
    eje.updateMatrixWorld(true);
    comunes.uNormalAnillo.value.set(0, 1, 0).transformDirection(eje.matrixWorld);
    return anillos;
}


// =====================================================================
// 7c. LA AURORA
// Una cortina de luz verde y violeta alrededor del polo, donde está el
// castillo. Se pliega y ondula despacio, y se ve más en la cara de noche.
// =====================================================================

function crearAurora() {
    const geometria = new THREE.CylinderGeometry(0.66, 0.5, 0.3, 200, 1, true);
    geometria.translate(0, 0.15, 0);
    const material = new THREE.ShaderMaterial({
        uniforms: comunes,
        vertexShader: `
            uniform float uTiempo;
            varying vec2 vUv;
            varying vec3 vMundo;
            void main() {
                vUv = uv;
                vec3 p = position;
                float a = uv.x * 6.2831853;
                p.xz *= 1.0 + sin(a * 5.0 + uTiempo * 0.15) * 0.06 + sin(a * 11.0 - uTiempo * 0.23) * 0.025;
                vec4 m = modelMatrix * vec4(p, 1.0);
                vMundo = m.xyz;
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform sampler2D tRuido;
            uniform float uTiempo;
            uniform vec3 uSol;
            varying vec2 vUv;
            varying vec3 vMundo;
            void main() {
                float x = vUv.x;
                float h = vUv.y;
                float tramo = texture2D(tRuido, vec2(x * 2.0 + uTiempo * 0.004, 0.21)).r;
                tramo = 0.25 + 0.75 * smoothstep(0.3, 0.62, tramo);
                float rayos = texture2D(tRuido, vec2(x * 22.0 + h * 0.06 - uTiempo * 0.012, 0.73)).r;
                rayos = pow(smoothstep(0.25, 0.78, rayos), 1.5) * 1.2 + 0.3;
                float base = smoothstep(0.0, 0.12, h) * exp(-h * 2.6) * (1.0 - smoothstep(0.6, 1.0, h));
                vec3 color = mix(vec3(0.15, 1.0, 0.5), vec3(0.6, 0.28, 1.0), smoothstep(0.2, 0.85, h));
                color = mix(color, vec3(1.0, 0.3, 0.5), smoothstep(0.85, 1.0, h) * 0.5);
                float noche = smoothstep(0.35, -0.2, dot(normalize(vMundo), uSol));
                float latido = 0.7 + 0.3 * sin(uTiempo * 0.6 + x * 25.0);
                gl_FragColor = vec4(color * rayos * tramo * base * (0.5 + noche) * latido * 3.2, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const aurora = new THREE.Mesh(geometria, material);
    aurora.position.y = 0.87;
    aurora.renderOrder = 4;
    eje.add(aurora);
}


// =====================================================================
// 7d. TORMENTAS
// Unos cuantos sitios fijos en las nubes. Cada poco cae un relámpago
// en uno que esté en la cara de noche: un fogonazo con parpadeo.
// =====================================================================

const tormentas = [];
for (let i = 0; i < 8; i++) {
    const y = -0.6 + (i / 7) * 1.2;
    const angulo = i * 2.39996;
    const r = Math.sqrt(1 - y * y);
    tormentas.push({ dir: new THREE.Vector3(Math.cos(angulo) * r, y, Math.sin(angulo) * r), t: 99 });
}
const auxTormenta = new THREE.Vector3();
let proximoRelampago = 3;

function moverTormentas(delta) {
    tormentas.forEach((t) => (t.t += delta));
    proximoRelampago -= delta;
    if (proximoRelampago <= 0 && !pocoMovimiento) {
        proximoRelampago = 0.8 + Math.random() * 2.5;
        const deNoche = tormentas.filter((t) => auxTormenta.copy(t.dir).transformDirection(nubes.matrixWorld).dot(DIR_SOL) < -0.08);
        if (deNoche.length) deNoche[Math.floor(Math.random() * deNoche.length)].t = 0;
    }
    tormentas.forEach((t, i) => {
        const k = t.t;
        let fuerza = 0;
        if (k < 1.5) fuerza = Math.exp(-k * 6) * (0.55 + 0.45 * Math.sin(k * 70)) + (k > 0.18 ? 0.8 * Math.exp(-(k - 0.18) * 8) : 0);
        comunes.uTormentas.value[i].set(t.dir.x, t.dir.y, t.dir.z, Math.max(0, fuerza));
    });
}


// =====================================================================
// 8. LUCES DE NOCHE
// Farolas a lo largo del camino, casitas cerca de él y las ventanas del
// castillo. Solo se encienden en la cara de noche. Al tocar el planeta
// una ola de luz recorre el camino desde abajo hasta el castillo.
// =====================================================================

function crearLuces(castillo) {
    const puntos = [];
    const orden = [];
    const tam = [];
    const lado = new THREE.Vector3();
    for (let i = 6; i < PUNTOS_CAMINO - 6; i += 7) {
        const d = camino[i];
        lado.crossVectors(camino[i + 1].clone().sub(camino[i - 1]), d).normalize();
        const p = d.clone().addScaledVector(lado, (i % 14 === 6 ? -1 : 1) * 0.016).normalize();
        puntos.push(p.multiplyScalar(altura(p) + 0.006));
        orden.push(i / PUNTOS_CAMINO);
        tam.push(0.6);
    }
    const d = new THREE.Vector3();
    let casas = 0;
    for (let i = 0; i < 4000 && casas < ajustes.casas; i++) {
        d.randomDirection();
        const cerca = cercaDelCamino(d);
        if (cerca.distancia < 0.03 || cerca.distancia > 0.1 || d.y > 0.9) continue;
        if (altura(d, cerca.distancia) < NIVEL_AGUA + 0.002) continue;
        puntos.push(d.clone().multiplyScalar(altura(d, cerca.distancia) + 0.004));
        orden.push(cerca.indice / PUNTOS_CAMINO);
        tam.push(0.45 + azar() * 0.5);
        casas++;
    }
    ventanasCastillo.forEach((v) => {
        puntos.push(v.clone().applyMatrix4(castillo.matrix));
        orden.push(1);
        tam.push(0.8);
    });
    const geometria = new THREE.BufferGeometry().setFromPoints(puntos);
    geometria.setAttribute("aOrden", new THREE.Float32BufferAttribute(orden, 1));
    geometria.setAttribute("aTam", new THREE.Float32BufferAttribute(tam, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { ...comunes, uEscala: { value: 1 } },
        vertexShader: `
            attribute float aOrden;
            attribute float aTam;
            uniform vec3 uSol;
            uniform float uTiempo;
            uniform float uOla;
            uniform float uEscala;
            varying float vLuz;
            void main() {
                vec4 mundo = modelMatrix * vec4(position, 1.0);
                vec3 normal = normalize(mundo.xyz);
                float noche = smoothstep(0.12, -0.18, dot(normal, uSol));
                float ola = exp(-pow((aOrden - uOla) / 0.04, 2.0)) * 4.0;
                vLuz = (noche * (0.8 + 0.2 * sin(uTiempo * 2.0 + aOrden * 90.0)) + ola) * aTam;
                vec4 vista = viewMatrix * mundo;
                gl_PointSize = (9.0 + ola * 6.0) * uEscala / -vista.z * aTam;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            varying float vLuz;
            void main() {
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = exp(-r * r * 7.0) * 0.6 + exp(-r * r * 50.0);
                gl_FragColor = vec4(vec3(1.0, 0.66, 0.32) * a * vLuz * 4.0, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const luces = new THREE.Points(geometria, material);
    luces.renderOrder = 1;
    planeta.add(luces);
    return luces;
}


// =====================================================================
// 9. EL SOL Y EL ESPACIO
// El cielo de estrellas de Gargantua (sin lente) y un sol pequeño y muy
// brillante: el resplandor le saca el destello horizontal.
// =====================================================================

function texturaSol() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 256;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    d.addColorStop(0, "rgba(255, 255, 255, 1)");
    d.addColorStop(0.05, "rgba(255, 250, 235, 1)");
    d.addColorStop(0.12, "rgba(255, 220, 170, 0.35)");
    d.addColorStop(0.4, "rgba(255, 170, 110, 0.06)");
    d.addColorStop(1, "rgba(255, 150, 90, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(lienzo);
}

const espacio = crearCielo({ tRuido, uTiempo: tiempo, centro: new THREE.Vector3().copy(DIR_SOL).multiplyScalar(300) });
espacio.material.uniforms.uRadioLente.value = 0.0001;
escena.add(espacio);

const estrellaSol = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaSol(), color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
estrellaSol.scale.setScalar(18);
escena.add(estrellaSol);

// El sol queda fuera de la pantalla, así que en el borde del planeta
// que mira al sol se pone un destello: es la luz que asoma por detrás
const destello = new THREE.Sprite(new THREE.SpriteMaterial({ map: estrellaSol.material.map, color: new THREE.Color(1, 0.85, 0.65).multiplyScalar(2.2), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
destello.renderOrder = 5;
escena.add(destello);
const auxVista = new THREE.Vector3();
const auxBorde = new THREE.Vector3();

function colocarDestello() {
    auxVista.copy(camara.position).normalize();
    auxBorde.copy(DIR_SOL).addScaledVector(auxVista, -DIR_SOL.dot(auxVista));
    if (auxBorde.lengthSq() < 1e-6) auxBorde.set(-1, 0, 0);
    auxBorde.normalize().multiplyScalar(1.09);
    destello.position.copy(auxBorde);
    const detras = Math.max(0, -DIR_SOL.dot(auxVista));
    const fuerza = THREE.MathUtils.smoothstep(detras, -0.2, 0.9);
    destello.material.opacity = 0.25 + fuerza * 0.75;
    destello.scale.setScalar(0.8 + fuerza * 1.6);
}


// =====================================================================
// 9b. EL COMETA
// De vez en cuando cruza un cometa por detrás del planeta, hacia el sol,
// con la cola apuntando al lado contrario.
// =====================================================================

const cometa = {
    t: 0,
    duracion: 9,
    espera: parametros.get("cometa") === "si" ? 1 : 14 + Math.random() * 12,
    activo: false,
    desde: new THREE.Vector3(),
    hasta: new THREE.Vector3()
};

const geometriaCola = new THREE.BufferGeometry();
geometriaCola.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
geometriaCola.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
geometriaCola.setIndex([0, 2, 1, 1, 2, 3]);
const materialCola = new THREE.ShaderMaterial({
    uniforms: { uOpacidad: { value: 0 } },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uOpacidad;
        varying vec2 vUv;
        void main() {
            float largo = vUv.x;
            float y = (vUv.y - 0.5) * 2.0;
            float nucleo = exp(-y * y * 30.0 / (0.05 + largo)) * pow(1.0 - largo, 1.3);
            float polvo = exp(-y * y * 4.0) * pow(1.0 - largo, 1.1) * smoothstep(0.0, 0.25, largo) * 0.5;
            vec3 color = vec3(0.6, 0.8, 1.0) * nucleo * 3.0 + vec3(1.0, 0.78, 0.5) * polvo * 1.6;
            gl_FragColor = vec4(color * uOpacidad, 1.0);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
});
const cola = new THREE.Mesh(geometriaCola, materialCola);
cola.frustumCulled = false;
cola.visible = false;
escena.add(cola);
const cabeza = new THREE.Sprite(new THREE.SpriteMaterial({ map: estrellaSol.material.map, color: new THREE.Color(0.75, 0.88, 1).multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
cabeza.scale.setScalar(1.6);
cabeza.visible = false;
escena.add(cabeza);

const auxDerecha = new THREE.Vector3();
const auxArriba = new THREE.Vector3();
const auxDelante = new THREE.Vector3();
const auxCola = new THREE.Vector3();
const auxLado = new THREE.Vector3();

function lanzarCometa() {
    camara.matrixWorld.extractBasis(auxDerecha, auxArriba, auxDelante);
    const lejos = 34;
    const centro = OBJETIVO.clone().addScaledVector(auxDelante, -lejos);
    const ancho = (lejos + vista.radio) * Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)) * camara.aspect;
    const alto = (lejos + vista.radio) * Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
    const lado = DIR_SOL.dot(auxDerecha) < 0 ? 1 : -1;
    const y1 = (0.15 + Math.random() * 0.6) * alto;
    const y2 = y1 - (0.2 + Math.random() * 0.4) * alto;
    cometa.desde.copy(centro).addScaledVector(auxDerecha, lado * ancho * 1.25).addScaledVector(auxArriba, y1);
    cometa.hasta.copy(centro).addScaledVector(auxDerecha, -lado * ancho * 1.25).addScaledVector(auxArriba, y2);
    cometa.t = 0;
    cometa.activo = true;
}

function moverCometa(delta) {
    if (!cometa.activo) {
        cometa.espera -= delta;
        if (cometa.espera <= 0 && entrada.t > 6 && !pocoMovimiento) lanzarCometa();
        cola.visible = cabeza.visible = false;
        return;
    }
    cometa.t += delta / cometa.duracion;
    if (cometa.t >= 1) {
        cometa.activo = false;
        cometa.espera = 25 + Math.random() * 30;
        return;
    }
    const opacidad = THREE.MathUtils.smoothstep(cometa.t, 0, 0.15) * (1 - THREE.MathUtils.smoothstep(cometa.t, 0.85, 1));
    cabeza.position.lerpVectors(cometa.desde, cometa.hasta, cometa.t);
    cabeza.material.opacity = opacidad;
    materialCola.uniforms.uOpacidad.value = opacidad;
    camara.matrixWorld.extractBasis(auxDerecha, auxArriba, auxDelante);
    auxCola.copy(DIR_SOL).multiplyScalar(-1).addScaledVector(auxDelante, -DIR_SOL.dot(auxDelante) * -1).normalize();
    auxLado.crossVectors(auxCola, auxDelante).normalize();
    const largo = 9;
    const p = geometriaCola.attributes.position;
    const h = cabeza.position;
    p.setXYZ(0, h.x - auxLado.x * 0.3, h.y - auxLado.y * 0.3, h.z - auxLado.z * 0.3);
    p.setXYZ(1, h.x + auxLado.x * 0.3, h.y + auxLado.y * 0.3, h.z + auxLado.z * 0.3);
    const f = auxLuna.copy(h).addScaledVector(auxCola, largo);
    p.setXYZ(2, f.x - auxLado.x * 1.6, f.y - auxLado.y * 1.6, f.z - auxLado.z * 1.6);
    p.setXYZ(3, f.x + auxLado.x * 1.6, f.y + auxLado.y * 1.6, f.z + auxLado.z * 1.6);
    p.needsUpdate = true;
    cola.visible = cabeza.visible = true;
}


// =====================================================================
// 10. EFECTOS: RESPLANDOR Y ACABADO DE CINE
// =====================================================================

const contexto = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && !!(contexto.getExtension("EXT_color_buffer_float") || contexto.getExtension("EXT_color_buffer_half_float"));
const compositor = new EffectComposer(renderizador, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType }));
compositor.addPass(new RenderPass(escena, camara));
compositor.addPass(new PaseBrillo({ flotantes: hayFlotantes, escala: movil ? 3 : 2, umbral: 1.0, umbralRaya: 3.0, fuerza: 0.55, raya: 0.25 }));
compositor.addPass(new OutputPass());
compositor.addPass(crearAcabado(tiempo));


// =====================================================================
// 11. LA VISTA
// El ratón (o el dedo arrastrando) solo inclina un poco la cámara, y
// cuando no tocas nada se mece sola muy despacio. El planeta gira.
// =====================================================================

const vista = { giro: 0, altura: 0, objGiro: 0, objAltura: 0, radio: 7.5, arrastrando: false, x: 0, y: 0 };

function colocarCamara(delta, t, acercar) {
    const k = Math.min(1, delta * 2.5);
    vista.giro += (vista.objGiro - vista.giro) * k;
    vista.altura += (vista.objAltura - vista.altura) * k;
    const balanceo = pocoMovimiento ? 0 : 1;
    const giro = vista.giro + Math.sin(t * 0.11) * 0.05 * balanceo;
    const alt = BASE_ALTURA + vista.altura + Math.sin(t * 0.08) * 0.02 * balanceo;
    camara.position.set(Math.sin(giro) * Math.cos(alt), Math.sin(alt), Math.cos(giro) * Math.cos(alt)).multiplyScalar(vista.radio * acercar).add(OBJETIVO);
    camara.lookAt(OBJETIVO);
}

// Aleja la cámara lo justo para que el planeta quepa, sobre todo con el
// móvil en vertical
function encuadrar() {
    const mitadAlto = THREE.MathUtils.degToRad(camara.fov / 2);
    const mitadAncho = Math.atan(Math.tan(mitadAlto) * camara.aspect);
    const mitad = Math.min(mitadAlto, mitadAncho);
    vista.radio = Math.min(16, Math.max(6.2, 1.2 / Math.tan(mitad)));
}


// =====================================================================
// 12. TOCAR Y SONIDO
// =====================================================================

const pista = document.getElementById("pista");
const lienzo = renderizador.domElement;
const toque = { x: 0, y: 0, t: 0 };
const rayo = new THREE.Raycaster();
const puntero = new THREE.Vector2();
const ola = { activa: false, valor: -1 };
const zumbido = crearZumbido();
const botonSonido = document.getElementById("boton-sonido");
let suelo = null;

botonSonido.addEventListener("click", () => {
    const activo = zumbido.alternar();
    botonSonido.classList.toggle("activo", activo);
    botonSonido.setAttribute("aria-pressed", activo);
});

function tocar(e) {
    const luna = lunaBajo(e);
    if (luna) {
        abrirCartel(luna.boton.dataset.cartel);
        return;
    }
    if (!rayo.intersectObject(suelo, false)[0]) return;
    ola.activa = true;
    ola.valor = -0.05;
    zumbido.despertar();
}

lienzo.addEventListener("pointerdown", (e) => {
    pista.classList.add("oculta");
    Object.assign(toque, { x: e.clientX, y: e.clientY, t: performance.now() });
    vista.arrastrando = e.pointerType !== "mouse";
    vista.x = e.clientX;
    vista.y = e.clientY;
});

lienzo.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
        if (listo) lienzo.style.cursor = lunaBajo(e) ? "pointer" : "";
        vista.objGiro = -(e.clientX / innerWidth - 0.5) * 0.6;
        vista.objAltura = (e.clientY / innerHeight - 0.5) * 0.3;
        return;
    }
    if (!vista.arrastrando) return;
    vista.objGiro = Math.max(-0.35, Math.min(0.35, vista.objGiro - ((e.clientX - vista.x) / innerWidth) * 0.9));
    vista.objAltura = Math.max(-0.15, Math.min(0.15, vista.objAltura + ((e.clientY - vista.y) / innerHeight) * 0.35));
    vista.x = e.clientX;
    vista.y = e.clientY;
});

const soltar = (e) => {
    vista.arrastrando = false;
    if (e.type === "pointerup" && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 8 && performance.now() - toque.t < 400) tocar(e);
};
lienzo.addEventListener("pointerup", soltar);
lienzo.addEventListener("pointercancel", soltar);
document.addEventListener("pointerleave", () => {
    vista.objGiro = 0;
    vista.objAltura = 0;
});


// =====================================================================
// 8b. LAS LUNAS
// Cuatro lunas distintas (de roca, de hielo, volcánica y de arena), cada
// una con el nombre de una parte del portfolio. Al tocar la luna o su
// nombre se abre el cartel.
// =====================================================================

const lunas = [];
const botonesLuna = [...document.querySelectorAll(".luna")];

function crearLunas() {
    const tipos = [
        { tam: 0.075, radio: 2.65, inclinacion: 0.2, nodo: 0.4, velocidad: 0.1, fase: 0.5, claro: [0.52, 0.5, 0.48], oscuro: [0.22, 0.21, 0.2], brasa: 0 },
        { tam: 0.06, radio: 2.95, inclinacion: -0.32, nodo: 1.6, velocidad: 0.085, fase: 2.4, claro: [0.78, 0.86, 0.95], oscuro: [0.36, 0.46, 0.6], brasa: 0 },
        { tam: 0.085, radio: 3.3, inclinacion: 0.12, nodo: 2.7, velocidad: 0.07, fase: 4.0, claro: [0.42, 0.3, 0.24], oscuro: [0.12, 0.08, 0.07], brasa: 1 },
        { tam: 0.065, radio: 3.65, inclinacion: -0.18, nodo: 4.2, velocidad: 0.058, fase: 5.6, claro: [0.72, 0.56, 0.38], oscuro: [0.4, 0.28, 0.18], brasa: 0 }
    ];
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    botonesLuna.forEach((boton, i) => {
        const tipo = tipos[i];
        const geometria = new THREE.IcosahedronGeometry(1, 24);
        geometria.deleteAttribute("uv");
        const pos = geometria.attributes.position;
        const colores = new Float32Array(pos.count * 3);
        const brasas = new Float32Array(pos.count);
        for (let k = 0; k < pos.count; k++) {
            v.fromBufferAttribute(pos, k).normalize();
            const n = ruido.noise3d(v.x * 2 + i * 7, v.y * 2, v.z * 2) * 0.5 + 0.5;
            const crater = Math.abs(ruido.noise3d(v.x * 6 + i * 3, v.y * 6, v.z * 6));
            const hueco = crater < 0.08 ? (0.08 - crater) / 0.08 : 0;
            const radio = 1 + n * 0.06 - hueco * 0.05 + ruido.noise3d(v.x * 14, v.y * 14 + i, v.z * 14) * 0.012;
            pos.setXYZ(k, v.x * radio, v.y * radio, v.z * radio);
            c.setRGB(...tipo.oscuro).lerp(new THREE.Color(...tipo.claro), suave(0.3, 0.75, n)).multiplyScalar(1 - hueco * 0.35);
            colores.set([c.r, c.g, c.b], k * 3);
            brasas[k] = tipo.brasa * suave(0.14, 0.02, Math.abs(ruido.noise3d(v.x * 2.2 + 3, v.y * 2.2, v.z * 2.2)));
        }
        geometria.setAttribute("color", new THREE.BufferAttribute(colores, 3));
        geometria.setAttribute("aBrasa", new THREE.BufferAttribute(brasas, 1));
        geometria.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTiempo = tiempo;
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nattribute float aBrasa;\nvarying float vBrasa;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBrasa = aBrasa;");
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nuniform float uTiempo;\nvarying float vBrasa;")
                .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * vBrasa * (1.1 + 0.3 * sin(uTiempo * 1.7));");
        };
        material.customProgramCacheKey = () => "luna";
        const luna = new THREE.Mesh(geometria, material);
        luna.scale.setScalar(tipo.tam);
        const orbita = new THREE.Group();
        orbita.rotation.set(tipo.inclinacion, tipo.nodo, 0);
        orbita.add(luna);
        escena.add(orbita);
        lunas.push({ luna, boton, ...tipo, angulo: tipo.fase });
        boton.addEventListener("click", () => abrirCartel(boton.dataset.cartel));
    });
}

function moverLunas(delta) {
    lunas.forEach((l) => {
        l.angulo += delta * l.velocidad;
        l.luna.position.set(Math.cos(l.angulo) * l.radio, 0, Math.sin(l.angulo) * l.radio);
        l.luna.rotation.y += delta * 0.15;
    });
}

// Los nombres siguen a su luna en la pantalla y se esconden cuando la
// luna pasa por detrás del planeta o se sale de la pantalla
const auxLuna = new THREE.Vector3();
const auxPantalla = new THREE.Vector3();
const auxRayoLuna = new THREE.Vector3();

function colocarNombres() {
    lunas.forEach((l) => {
        l.luna.getWorldPosition(auxLuna);
        auxPantalla.copy(auxLuna).project(camara);
        const x = (auxPantalla.x * 0.5 + 0.5) * innerWidth;
        const y = (-auxPantalla.y * 0.5 + 0.5) * innerHeight;
        auxRayoLuna.subVectors(auxLuna, camara.position);
        const largo = auxRayoLuna.length();
        auxRayoLuna.normalize();
        const t = -camara.position.dot(auxRayoLuna);
        const cerca = Math.sqrt(Math.max(0, camara.position.lengthSq() - t * t));
        const tapada = t > 0 && t < largo && cerca < 1.1;
        const dentro = auxPantalla.z < 1 && x > 20 && x < innerWidth - 20 && y > 20 && y < innerHeight - 20;
        l.boton.classList.toggle("visible", listo && entrada.t > 5 && dentro && !tapada);
        if (!l.ancho) l.ancho = l.boton.offsetWidth;
        const bx = Math.max(8, Math.min(innerWidth - (l.ancho || 90) - 8, x + 12));
        l.boton.style.transform = `translate(${Math.round(bx)}px, ${Math.round(y - 30)}px)`;
    });
}

function lunaBajo(e) {
    puntero.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    const corte = rayo.intersectObjects(lunas.map((l) => l.luna), false)[0];
    return corte ? lunas.find((l) => l.luna === corte.object) : null;
}


// =====================================================================
// 8c. LOS CARTELES
// =====================================================================

const carteles = [...document.querySelectorAll(".cartel")];

function abrirCartel(id) {
    carteles.forEach((c) => c.classList.toggle("visible", c.id === id));
    botonesLuna.forEach((b) => b.classList.toggle("elegida", b.dataset.cartel === id));
    pista.classList.add("oculta");
    zumbido.despertar();
}

carteles.forEach((c) => {
    c.querySelector(".cerrar").addEventListener("click", () => {
        c.classList.remove("visible");
        botonesLuna.forEach((b) => b.classList.remove("elegida"));
    });
});


// =====================================================================
// 13. MOVIMIENTO
// La entrada: primero las estrellas y el planeta de noche, a contraluz;
// después el sol asoma por el borde y amanece en medio planeta.
// =====================================================================

const reloj = new THREE.Clock();
const entrada = { t: pocoMovimiento || parametros.has("sinentrada") || parametros.has("fijo") ? 10 : 0, inicio: performance.now() };
let listo = false;
let luces = null;
let nubes = null;

function moverEntrada() {
    entrada.t = entrada.t >= 10 ? 10 : (performance.now() - entrada.inicio) / 1000;
    const amanecer = THREE.MathUtils.smoothstep(entrada.t, 0.8, 6.5);
    DIR_SOL.copy(SOL_INICIO).lerp(SOL_FINAL, amanecer).normalize();
    espacio.material.uniforms.uAparece.value = THREE.MathUtils.smoothstep(entrada.t, 0.1, 1.6);
    return amanecer;
}

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 40 : 30;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
    if (luces) luces.material.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight / 75;
    OBJETIVO.x = camara.aspect > 1.2 ? -0.5 : 0;
    encuadrar();
}

window.addEventListener("resize", ajustarTamano);

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

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const real = reloj.getDelta();
    const delta = Math.min(real, 0.1);
    const t = (tiempo.value += delta);
    if (real < 0.5) adaptarResolucion(real);
    const amanecer = moverEntrada();
    colocarCamara(delta, t, 1 + 0.12 * Math.pow(1 - amanecer, 2));
    planeta.rotation.y += delta * 0.035;
    nubes.rotation.y += delta * 0.045;
    sol.position.copy(DIR_SOL).multiplyScalar(10);
    sol.intensity = 3.2 * THREE.MathUtils.smoothstep(amanecer, 0, 0.35);
    estrellaSol.position.copy(DIR_SOL).multiplyScalar(120);
    colocarDestello();
    if (parametros.has("ola") && !ola.activa && ola.valor < 0) {
        ola.activa = true;
        ola.valor = parseFloat(parametros.get("ola")) || 0.5;
        ola.fija = true;
    }
    if (ola.fija) ola.valor -= delta * 0.32;
    if (ola.activa) {
        ola.valor += delta * 0.32;
        if (ola.valor > 1.1) ola.activa = false;
    }
    comunes.uOla.value = ola.activa ? ola.valor : -1;
    comunes.uFuerzaSol.value = sol.intensity / 3.2;
    moverTormentas(delta);
    moverLunas(delta);
    moverCometa(delta);
    camara.updateMatrixWorld();
    colocarNombres();
    compositor.render();
}

requestAnimationFrame(() => {
    suelo = crearSuelo();
    crearCamino();
    const castillo = crearCastillo();
    luces = crearLuces(castillo);
    nubes = crearNubes();
    crearAtmosfera();
    crearAnillos();
    crearAurora();
    crearLunas();
    moverLunas(0);
    ajustarTamano();
    entrada.inicio = performance.now();
    moverEntrada();
    colocarCamara(1, 0, 1);
    renderizador.compile(escena, camara);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 7000);
    reloj.getDelta();
    animar();
});
