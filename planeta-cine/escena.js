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
// En la cara de día hay bosques, prados, lagos que reflejan el sol y nubes
// finas; en la de noche se ven las farolas del camino, las casas y el
// castillo encendidos. Alrededor, el filo azul de la atmósfera. La
// cámara solo se inclina un poco con el ratón, como en Gargantua.
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

const tRuido = { value: texturaRuido() };
const tiempo = { value: 0 };
const comunes = {
    uSol: { value: DIR_SOL },
    uTiempo: tiempo,
    tRuido,
    uOla: { value: -1 }
};


// =====================================================================
// 3. EL RELIEVE
// Colinas suaves de ruido; bajo el camino y en lo alto, donde está el
// castillo, el suelo se allana. En los huecos más bajos hay lagos.
// =====================================================================

const camino = [];
const PUNTOS_CAMINO = 420;
const NIVEL_AGUA = 0.985;

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
    return ruido.noise3d(d.x * 1.7, d.y * 1.7, d.z * 1.7) * 0.034 + ruido.noise3d(d.x * 4.2 + 5, d.y * 4.2, d.z * 4.2) * 0.013 + ruido.noise3d(d.x * 11 + 2, d.y * 11, d.z * 11) * 0.004;
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
            .replace("#include <common>", "#include <common>\nuniform vec3 uSol;\nvarying float vAgua;\nvarying vec3 vNormalMundo;\nvarying vec3 vMundo;")
            .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.14, vAgua);")
            .replace(
                "#include <opaque_fragment>",
                `vec3 nM = normalize(vNormalMundo);
                vec3 vistaM = normalize(cameraPosition - vMundo);
                float luzM = dot(normalize(vMundo), uSol);
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
    const piedra = new THREE.MeshStandardMaterial({ color: 0xb4ab9e, roughness: 0.9 });
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
            varying vec3 vLocal;
            varying vec3 vMundo;
            varying vec3 vNormalMundo;
            float plano(vec3 p, float escala) {
                vec3 w = pow(abs(p), vec3(4.0));
                w /= w.x + w.y + w.z;
                return texture2D(tRuido, p.yz * escala).r * w.x + texture2D(tRuido, p.xz * escala + 0.31).r * w.y + texture2D(tRuido, p.xy * escala + 0.67).r * w.z;
            }
            void main() {
                vec3 p = vLocal;
                float n = plano(p + vec3(uTiempo * 0.004, 0.0, 0.0), 0.55) * 0.65 + plano(p * 1.0, 1.7) * 0.35;
                float densidad = smoothstep(0.53, 0.74, n);
                densidad *= 1.0 - smoothstep(0.8, 0.95, p.y);
                if (densidad < 0.01) discard;
                vec3 n3 = normalize(vNormalMundo);
                float luz = dot(n3, uSol);
                vec3 dia = vec3(1.0, 0.98, 0.95) * smoothstep(-0.1, 0.5, luz) * 1.05;
                vec3 amanecer = vec3(1.0, 0.55, 0.3) * exp(-pow((luz - 0.02) / 0.12, 2.0)) * 0.8;
                vec3 color = dia + amanecer + vec3(0.01, 0.012, 0.02);
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
                float ola = exp(-pow((aOrden - uOla) / 0.035, 2.0)) * 2.5;
                vLuz = (noche * (0.8 + 0.2 * sin(uTiempo * 2.0 + aOrden * 90.0)) + ola) * aTam;
                vec4 vista = viewMatrix * mundo;
                gl_PointSize = (9.0 + ola * 8.0) * uEscala / -vista.z * aTam;
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
    puntero.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
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
// 13. MOVIMIENTO
// La entrada: primero las estrellas y el planeta de noche, a contraluz;
// después el sol asoma por el borde y amanece en medio planeta.
// =====================================================================

const reloj = new THREE.Clock();
const entrada = { t: pocoMovimiento || parametros.has("sinentrada") || parametros.has("fijo") ? 10 : 0 };
let listo = false;
let luces = null;
let nubes = null;

function moverEntrada(delta) {
    entrada.t += delta;
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
    const amanecer = moverEntrada(delta);
    colocarCamara(delta, t, 1 + 0.12 * Math.pow(1 - amanecer, 2));
    planeta.rotation.y += delta * 0.035;
    nubes.rotation.y += delta * 0.045;
    sol.position.copy(DIR_SOL).multiplyScalar(10);
    sol.intensity = 3.2 * THREE.MathUtils.smoothstep(amanecer, 0, 0.35);
    estrellaSol.position.copy(DIR_SOL).multiplyScalar(120);
    if (ola.activa) {
        ola.valor += delta * 0.32;
        if (ola.valor > 1.1) ola.activa = false;
    }
    comunes.uOla.value = ola.activa ? ola.valor : -1;
    compositor.render();
}

requestAnimationFrame(() => {
    suelo = crearSuelo();
    crearCamino();
    const castillo = crearCastillo();
    luces = crearLuces(castillo);
    nubes = crearNubes();
    crearAtmosfera();
    ajustarTamano();
    moverEntrada(0);
    colocarCamara(1, 0, 1);
    renderizador.compile(escena, camara);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 7000);
    reloj.getDelta();
    animar();
});
