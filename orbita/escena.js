import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { texturaRuido, crearCielo, crearGargantua, PaseBrillo, crearAcabado, crearZumbido } from "./cine.js";

// =====================================================================
// 1. AJUSTES
// Un planeta diminuto con un castillo en lo alto y un camino que le da
// vueltas hasta la puerta, girando junto a Gargantua. La luz que le
// llega es la del disco del agujero negro, así que casi siempre se ve
// la cara de noche con las farolas y las ventanas encendidas y un filo
// de luz cálida. Las cuatro lunas son las tarjetas del portfolio.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    detalle: movil ? 48 : 72,
    arboles: movil ? 60 : 90,
    flores: movil ? 300 : 520,
    estrellas: movil ? 2200 : 4000,
    sombra: movil ? 1024 : 2048,
    resolucionMax: movil ? 1.75 : 1.5
};

let semilla = 7;
const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return (semilla - 1) / 2147483646;
};
const ruido = new SimplexNoise({ random: azar });


// =====================================================================
// 2. RENDERIZADOR, ESCENA, CÁMARA Y LUCES
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.1;
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 300);
const distanciaInicial = Math.max(5.2, 1.2 / (Math.tan(THREE.MathUtils.degToRad(17)) * (innerWidth / innerHeight)));
camara.position.set(0.7, 0.75, 1).normalize().multiplyScalar(distanciaInicial);

const controles = new OrbitControls(camara, renderizador.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.06;
controles.enablePan = false;
controles.rotateSpeed = 0.55;
controles.minDistance = 2.2;
controles.maxDistance = 14;
controles.target.set(0, 0.12, 0);

// Gargantua se pone detrás del planeta, un poco a la derecha y arriba
// de donde mira la cámara al empezar, para que entre en el encuadre
const haciaCamara = camara.position.clone().normalize();
const derecha = new THREE.Vector3(0, 1, 0).cross(haciaCamara).normalize();
const vertical = innerWidth < innerHeight;
const DIR_SOL = haciaCamara.clone().negate().addScaledVector(derecha, vertical ? 0.06 : 0.42).addScaledVector(new THREE.Vector3(0, 1, 0), vertical ? 0.2 : 0.2).normalize();
const DISTANCIA_GARGANTUA = 70;
const ESCALA_GARGANTUA = 6;
const sol = new THREE.DirectionalLight(0xffd6a6, 2.8);
sol.position.copy(DIR_SOL).multiplyScalar(6);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
sol.shadow.camera.left = -1.6;
sol.shadow.camera.right = 1.6;
sol.shadow.camera.top = 1.6;
sol.shadow.camera.bottom = -1.6;
sol.shadow.camera.near = 3;
sol.shadow.camera.far = 9;
sol.shadow.bias = -0.0006;
sol.shadow.normalBias = 0.01;
escena.add(sol);

const contraluz = new THREE.DirectionalLight(0x8fa4ff, 0.8);
contraluz.position.copy(haciaCamara).multiplyScalar(5).add(new THREE.Vector3(0, 2, 0));
escena.add(contraluz);
escena.add(new THREE.HemisphereLight(0x9c8cff, 0x241a40, 0.5));

const tRuido = { value: texturaRuido() };
const tiempoCine = { value: 0 };
const gargantua = crearGargantua({ tRuido });
gargantua.grupo.position.copy(DIR_SOL).multiplyScalar(DISTANCIA_GARGANTUA);
gargantua.grupo.scale.setScalar(ESCALA_GARGANTUA);
escena.add(gargantua.grupo);


// =====================================================================
// 3. EL RELIEVE
// Colinas suaves de ruido; bajo el camino y en lo alto, donde está el
// castillo, el suelo se allana.
// =====================================================================

const camino = [];
const PUNTOS_CAMINO = 420;

function direccion(lat, lon, destino = new THREE.Vector3()) {
    return destino.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

for (let i = 0; i < PUNTOS_CAMINO; i++) {
    const t = i / (PUNTOS_CAMINO - 1);
    const lat = THREE.MathUtils.lerp(-1.05, 1.32, t) + Math.sin(t * 23) * 0.025;
    const lon = t * Math.PI * 2 * 2.2 + Math.sin(t * 17) * 0.08;
    camino.push(direccion(lat, lon));
}

function distanciaCamino(d) {
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
        if (c > mejor) mejor = c;
    }
    return Math.acos(Math.min(1, mejor));
}

function alturaBruta(d) {
    return ruido.noise3d(d.x * 1.7, d.y * 1.7, d.z * 1.7) * 0.03 + ruido.noise3d(d.x * 4.2 + 5, d.y * 4.2, d.z * 4.2) * 0.012;
}

const suave = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

function altura(d, dc = distanciaCamino(d)) {
    let h = alturaBruta(d);
    h = THREE.MathUtils.lerp(h * 0.3, h, suave(0.035, 0.11, dc));
    const cima = suave(0.9, 0.97, d.y);
    h = THREE.MathUtils.lerp(h, 0.012, cima);
    return 1 + h;
}


// =====================================================================
// 4. EL PLANETA
// Una esfera muy subdividida con colores por vértice: hierba de varios
// verdes, tierra en los bordes del camino y un poco de musgo en lo bajo.
// =====================================================================

const planeta = new THREE.Group();
let suelo = null;
planeta.rotation.z = 0.32;
escena.add(planeta);

function crearSuelo() {
    const icosaedro = new THREE.IcosahedronGeometry(1, ajustes.detalle);
    icosaedro.deleteAttribute("normal");
    icosaedro.deleteAttribute("uv");
    const geometria = mergeVertices(icosaedro);
    const pos = geometria.attributes.position;
    const colores = new Float32Array(pos.count * 3);
    const d = new THREE.Vector3();
    const verdeOscuro = new THREE.Color(0.16, 0.38, 0.17);
    const verdeClaro = new THREE.Color(0.42, 0.66, 0.26);
    const amarillo = new THREE.Color(0.72, 0.72, 0.3);
    const tierraColor = new THREE.Color(0.62, 0.47, 0.3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i).normalize();
        const dc = distanciaCamino(d);
        const datos = { dc, h: altura(d, dc) };
        pos.setXYZ(i, d.x * datos.h, d.y * datos.h, d.z * datos.h);
        const variacion = ruido.noise3d(d.x * 6, d.y * 6, d.z * 6) * 0.5 + 0.5;
        const loma = THREE.MathUtils.clamp((datos.h - 0.98) / 0.07, 0, 1);
        c.copy(verdeOscuro).lerp(verdeClaro, loma * 0.7 + variacion * 0.3);
        c.lerp(amarillo, Math.max(0, ruido.noise3d(d.x * 3 + 9, d.y * 3, d.z * 3)) * 0.35);
        c.lerp(tierraColor, 1 - suave(0.02, 0.05, datos.dc));
        colores.set([c.r, c.g, c.b], i * 3);
    }
    geometria.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    geometria.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    suelo = new THREE.Mesh(geometria, material);
    suelo.receiveShadow = true;
    planeta.add(suelo);
}

function crearCamino() {
    const posiciones = [];
    const colores = [];
    const indices = [];
    const tangente = new THREE.Vector3();
    const lado = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < PUNTOS_CAMINO; i++) {
        const d = camino[i];
        const siguiente = camino[Math.min(PUNTOS_CAMINO - 1, i + 1)];
        const anterior = camino[Math.max(0, i - 1)];
        tangente.subVectors(siguiente, anterior).normalize();
        lado.crossVectors(tangente, d).normalize();
        const ancho = 0.026 * (i < 8 ? i / 8 : 1);
        for (const s of [-1, 1]) {
            p.copy(d).addScaledVector(lado, s * ancho).normalize();
            const h = altura(p) + 0.003;
            posiciones.push(p.x * h, p.y * h, p.z * h);
            const v = 0.9 + ruido.noise3d(p.x * 40, p.y * 40, p.z * 40) * 0.1;
            c.setRGB(0.86 * v, 0.74 * v, 0.55 * v);
            colores.push(c.r, c.g, c.b);
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
    const malla = new THREE.Mesh(geometria, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    malla.receiveShadow = true;
    planeta.add(malla);
}


// =====================================================================
// 5. ÁRBOLES, FLORES, PIEDRAS Y FAROLAS
// Formas redondas y suaves, sin aristas, repetidas con instancias.
// =====================================================================

const arriba = new THREE.Vector3(0, 1, 0);

function colocarEnSuperficie(d, elevacion, escala, giro, matriz) {
    const q = new THREE.Quaternion().setFromUnitVectors(arriba, d);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(arriba, giro));
    const p = d.clone().multiplyScalar(altura(d) + elevacion);
    return matriz.compose(p, q, new THREE.Vector3(escala, escala, escala));
}

function blandito(geometria, fuerza, frecuencia) {
    const pos = geometria.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const k = 1 + ruido.noise3d(v.x * frecuencia, v.y * frecuencia, v.z * frecuencia) * fuerza;
        pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    geometria.computeVertexNormals();
    return geometria;
}

function sitioLibre(minCamino) {
    const d = new THREE.Vector3();
    for (let intento = 0; intento < 200; intento++) {
        d.randomDirection();
        if (d.y > 0.86) continue;
        if (distanciaCamino(d) < minCamino) continue;
        return d.clone();
    }
    return d.clone();
}

function instancias(geometria, material, matrices, colores) {
    const malla = new THREE.InstancedMesh(geometria, material, matrices.length);
    matrices.forEach((m, i) => {
        malla.setMatrixAt(i, m);
        if (colores) malla.setColorAt(i, colores[i]);
    });
    malla.castShadow = true;
    malla.receiveShadow = true;
    planeta.add(malla);
    return malla;
}

function crearArboles() {
    const tronco = new THREE.CylinderGeometry(0.006, 0.009, 0.05, 10);
    tronco.translate(0, 0.025, 0);
    const copaRedonda = blandito(new THREE.SphereGeometry(0.04, 28, 20), 0.12, 30);
    copaRedonda.scale(1, 0.92, 1);
    copaRedonda.translate(0, 0.075, 0);
    const pino = mergeGeometries([0, 1, 2].map((k) => {
        const capa = blandito(new THREE.SphereGeometry(0.04 - k * 0.009, 24, 14), 0.08, 30);
        capa.scale(1, 0.75, 1);
        capa.translate(0, 0.05 + k * 0.032, 0);
        return capa;
    }));
    const cipres = blandito(new THREE.SphereGeometry(0.024, 24, 18), 0.07, 40);
    cipres.scale(1.1, 2.0, 1.1);
    cipres.translate(0, 0.085, 0);

    const materialTronco = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 });
    const materialHojas = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const troncos = [];
    const grupos = { redondo: [], pino: [], cipres: [] };
    const colores = { redondo: [], pino: [], cipres: [] };
    const paleta = {
        redondo: [0x4f9a3c, 0x67b04a, 0x3d8a3f, 0xe59a5b, 0xf0b8c8, 0x8cbf4f],
        pino: [0x2f6e4a, 0x2a6242, 0x3c7f55],
        cipres: [0x3f7a45, 0x4a8a4c]
    };
    const m = new THREE.Matrix4();
    for (let i = 0; i < ajustes.arboles; i++) {
        const d = sitioLibre(0.07);
        const tipo = azar() < 0.55 ? "redondo" : azar() < 0.6 ? "pino" : "cipres";
        const escala = 0.75 + azar() * 0.6;
        colocarEnSuperficie(d, -0.004, escala, azar() * Math.PI * 2, m);
        troncos.push(m.clone());
        grupos[tipo].push(m.clone());
        const lista = paleta[tipo];
        colores[tipo].push(new THREE.Color(lista[Math.floor(azar() * lista.length)]).multiplyScalar(0.9 + azar() * 0.2));
    }
    instancias(tronco, materialTronco, troncos);
    instancias(copaRedonda, materialHojas, grupos.redondo, colores.redondo);
    instancias(pino, materialHojas, grupos.pino, colores.pino);
    instancias(cipres, materialHojas, grupos.cipres, colores.cipres);
}

function crearFlores() {
    const geometria = new THREE.SphereGeometry(0.006, 8, 6);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x000000 });
    const paleta = [0xffffff, 0xffe066, 0xff9fc6, 0xc7a6ff, 0xffb070];
    const matrices = [];
    const colores = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < ajustes.flores; i++) {
        const d = sitioLibre(0.045);
        colocarEnSuperficie(d, 0.004, 0.7 + azar() * 0.7, 0, m);
        matrices.push(m.clone());
        colores.push(new THREE.Color(paleta[Math.floor(azar() * paleta.length)]));
    }
    const malla = instancias(geometria, material, matrices, colores);
    malla.castShadow = false;
}

function crearPiedras() {
    const geometria = blandito(new THREE.SphereGeometry(0.018, 16, 12), 0.25, 60);
    geometria.scale(1, 0.55, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xa9a2b4, roughness: 0.9 });
    const matrices = [];
    const m = new THREE.Matrix4();
    const lado = new THREE.Vector3();
    for (let i = 6; i < PUNTOS_CAMINO - 10; i += 9) {
        if (azar() < 0.45) continue;
        const d = camino[i];
        lado.crossVectors(camino[i + 1].clone().sub(camino[i - 1]), d).normalize();
        const p = d.clone().addScaledVector(lado, (azar() < 0.5 ? -1 : 1) * (0.04 + azar() * 0.02)).normalize();
        colocarEnSuperficie(p, 0.0, 0.6 + azar() * 0.8, azar() * 6, m);
        matrices.push(m.clone());
    }
    instancias(geometria, material, matrices);
}

const farolas = [];

function crearFarolas() {
    const poste = new THREE.CylinderGeometry(0.0025, 0.0035, 0.07, 8);
    poste.translate(0, 0.035, 0);
    const bombilla = new THREE.SphereGeometry(0.009, 14, 10);
    bombilla.translate(0, 0.074, 0);
    const matrices = [];
    const m = new THREE.Matrix4();
    const lado = new THREE.Vector3();
    for (let i = 14; i < PUNTOS_CAMINO - 14; i += 26) {
        const d = camino[i];
        lado.crossVectors(camino[i + 1].clone().sub(camino[i - 1]), d).normalize();
        const p = d.clone().addScaledVector(lado, (i % 52 === 14 ? -1 : 1) * 0.04).normalize();
        colocarEnSuperficie(p, 0, 1, 0, m);
        matrices.push(m.clone());
        farolas.push(p.clone().multiplyScalar(altura(p) + 0.074));
    }
    instancias(poste, new THREE.MeshStandardMaterial({ color: 0x3b3550, roughness: 0.6, metalness: 0.3 }), matrices);
    const luces = instancias(bombilla, new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb050, emissiveIntensity: 2.2 }), matrices);
    luces.castShadow = false;
}


// =====================================================================
// 6. EL CASTILLO
// En lo alto del planeta, con la puerta mirando al final del camino.
// =====================================================================

const banderas = [];

function crearCastillo() {
    const castillo = new THREE.Group();
    const piedra = new THREE.MeshStandardMaterial({ color: 0xece2d0, roughness: 0.85 });
    const piedraOscura = new THREE.MeshStandardMaterial({ color: 0xc9bca8, roughness: 0.9 });
    const tejaRoja = new THREE.MeshStandardMaterial({ color: 0xc8504a, roughness: 0.6 });
    const tejaAzul = new THREE.MeshStandardMaterial({ color: 0x4f63b8, roughness: 0.6 });
    const ventana = new THREE.MeshStandardMaterial({ color: 0x2a2238, emissive: 0xffb45a, emissiveIntensity: 0 });
    const ventanas = [];
    const oscuro = new THREE.MeshStandardMaterial({ color: 0x2a2238, roughness: 1 });
    const malla = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.fija = true;
        castillo.add(m);
        return m;
    };

    malla(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 48), piedraOscura, 0, 0.0, 0);

    const almenas = (radio, y, n, alto) => {
        const geo = new THREE.BoxGeometry(0.012, alto, 0.01);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const m = malla(geo, piedra, Math.cos(a) * radio, y, Math.sin(a) * radio);
            m.rotation.y = -a;
        }
    };

    const torres = [
        [0.13, 0.13, 0.2, tejaAzul],
        [-0.13, 0.13, 0.17, tejaRoja],
        [0.13, -0.13, 0.17, tejaRoja],
        [-0.13, -0.13, 0.2, tejaAzul]
    ];
    torres.forEach(([x, z, alto, teja]) => {
        malla(new THREE.CylinderGeometry(0.036, 0.04, alto, 32), piedra, x, alto / 2, z);
        almenas(0.036, alto + 0.008, 10, 0.016);
        const techo = malla(new THREE.ConeGeometry(0.048, 0.1, 32), teja, x, alto + 0.065, z);
        techo.castShadow = true;
        crearBandera(castillo, x, alto + 0.115, z, teja.color);
        const v = malla(new THREE.BoxGeometry(0.012, 0.022, 0.004), ventana, x, alto * 0.62, z);
        ventanas.push(v);
        const a = Math.atan2(x, z);
        v.position.x += Math.sin(a) * 0.038;
        v.position.z += Math.cos(a) * 0.038;
        v.rotation.y = a;
    });

    const muro = new THREE.BoxGeometry(0.26, 0.09, 0.022);
    [[0, 0.13, 0], [0, -0.13, 0], [0.13, 0, Math.PI / 2], [-0.13, 0, Math.PI / 2]].forEach(([x, z, r]) => {
        const m = malla(muro, piedra, x, 0.045, z);
        m.rotation.y = r;
        const geo = new THREE.BoxGeometry(0.014, 0.016, 0.024);
        for (let i = -4; i <= 4; i++) {
            const a = malla(geo, piedra, x + (r ? 0 : i * 0.028), 0.098, z + (r ? i * 0.028 : 0));
            a.rotation.y = r;
        }
    });

    malla(new THREE.BoxGeometry(0.12, 0.2, 0.12), piedra, 0, 0.1, -0.01);
    almenas(0.075, 0.207, 14, 0.018);
    malla(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 32), piedra, 0.0, 0.25, -0.01);
    malla(new THREE.ConeGeometry(0.05, 0.12, 32), tejaRoja, 0, 0.36, -0.01);
    crearBandera(castillo, 0, 0.42, -0.01, new THREE.Color(0xf0b860));
    [[0, 0.14, 0.051, 0], [0.061, 0.14, -0.01, Math.PI / 2], [-0.061, 0.14, -0.01, Math.PI / 2], [0, 0.27, 0.036, 0]].forEach(([x, y, z, r]) => {
        const v = malla(new THREE.BoxGeometry(0.014, 0.026, 0.004), ventana, x, y, z);
        v.rotation.y = r;
        ventanas.push(v);
    });

    const arco = new THREE.Shape();
    arco.moveTo(-0.025, 0);
    arco.lineTo(-0.025, 0.035);
    arco.absarc(0, 0.035, 0.025, Math.PI, 0, true);
    arco.lineTo(0.025, 0);
    const puerta = malla(new THREE.ShapeGeometry(arco, 16), oscuro, 0, 0.002, 0.1425);
    puerta.castShadow = false;

    juntarPiezas(castillo);
    castillo.userData.puntosVentana = ventanas.map((v) => v.position.clone());

    const final = camino[PUNTOS_CAMINO - 1];
    castillo.rotation.y = Math.atan2(final.x, final.z);
    castillo.position.set(0, altura(new THREE.Vector3(0, 1, 0)) - 0.005, 0);
    castillo.userData.ventana = ventana;
    castillo.userData.ventanas = ventanas;
    planeta.add(castillo);
    return castillo;
}

function juntarPiezas(grupo) {
    const porMaterial = new Map();
    grupo.children.filter((m) => m.userData.fija).forEach((m) => {
        m.updateMatrix();
        const geo = m.geometry.clone().applyMatrix4(m.matrix);
        geo.deleteAttribute("uv");
        if (!porMaterial.has(m.material)) porMaterial.set(m.material, { piezas: [], sombra: false });
        const grupoMat = porMaterial.get(m.material);
        grupoMat.piezas.push(geo.index ? geo.toNonIndexed() : geo);
        grupoMat.sombra = grupoMat.sombra || m.castShadow;
        grupo.remove(m);
    });
    porMaterial.forEach(({ piezas, sombra }, material) => {
        const junta = new THREE.Mesh(mergeGeometries(piezas), material);
        junta.castShadow = sombra;
        junta.receiveShadow = true;
        grupo.add(junta);
    });
}

function crearBandera(padre, x, y, z, color) {
    const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0x4a4050 }));
    asta.position.set(x, y + 0.02, z);
    padre.add(asta);
    const geometria = new THREE.PlaneGeometry(0.045, 0.024, 10, 1);
    geometria.translate(0.0225, 0, 0);
    const material = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.7 });
    const tela = new THREE.Mesh(geometria, material);
    tela.position.set(x, y + 0.033, z);
    tela.castShadow = true;
    tela.userData.base = geometria.attributes.position.array.slice();
    tela.userData.fase = azar() * 6;
    padre.add(tela);
    banderas.push(tela);
}

function moverBanderas(tiempo) {
    banderas.forEach((b) => {
        const pos = b.geometry.attributes.position;
        const base = b.userData.base;
        for (let i = 0; i < pos.count; i++) {
            const x = base[i * 3];
            pos.array[i * 3 + 2] = Math.sin(tiempo * 5 - x * 140 + b.userData.fase) * x * 0.25;
        }
        pos.needsUpdate = true;
    });
}


// =====================================================================
// 7. NUBES, ATMÓSFERA Y LUCES DE NOCHE
// =====================================================================

const nubes = [];

function crearNubes() {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x6a5c99, emissiveIntensity: 0.35 });
    const bola = new THREE.SphereGeometry(0.05, 20, 14);
    for (let i = 0; i < 6; i++) {
        const nube = new THREE.Group();
        const n = 4 + Math.floor(azar() * 3);
        for (let k = 0; k < n; k++) {
            const b = new THREE.Mesh(bola, material);
            const t = (k / (n - 1) - 0.5) * 2;
            b.position.set(t * 0.06, (1 - t * t) * 0.025, (azar() - 0.5) * 0.04);
            b.scale.setScalar(0.65 + (1 - t * t) * 0.6 + azar() * 0.2);
            b.scale.y *= 0.8;
            b.castShadow = true;
            nube.add(b);
        }
        const eje = new THREE.Vector3().randomDirection();
        const pivote = new THREE.Group();
        pivote.quaternion.setFromUnitVectors(arriba, eje);
        nube.position.set(0, 1.32 + azar() * 0.1, 0);
        const orbita = new THREE.Group();
        orbita.add(nube);
        orbita.rotation.x = Math.PI / 2;
        orbita.rotation.y = azar() * Math.PI * 2;
        pivote.add(orbita);
        escena.add(pivote);
        nubes.push({ orbita, velocidad: (0.03 + azar() * 0.04) * (azar() < 0.5 ? 1 : -1) });
    }
}

function crearAtmosfera() {
    const material = new THREE.ShaderMaterial({
        uniforms: { uSol: { value: DIR_SOL } },
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
                float halo = pow(clamp(-dot(n, V) / 0.47, 0.0, 1.0), 2.6);
                float luz = smoothstep(-0.6, 0.6, dot(n, uSol));
                vec3 color = mix(vec3(0.3, 0.26, 0.7), vec3(1.0, 0.68, 0.4), luz) * (0.25 + luz * 1.4);
                gl_FragColor = vec4(color * halo * 0.3, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
    halo.scale.setScalar(1.13);
    escena.add(halo);
}

let brillos = null;

function crearBrillos(castillo) {
    const puntos = [...farolas];
    planeta.updateMatrixWorld(true);
    castillo.userData.puntosVentana.forEach((v) => {
        const p = castillo.localToWorld(v.clone());
        puntos.push(planeta.worldToLocal(p));
    });
    const geometria = new THREE.BufferGeometry().setFromPoints(puntos);
    const material = new THREE.ShaderMaterial({
        uniforms: { uSol: { value: DIR_SOL }, uTam: { value: 70 * renderizador.getPixelRatio() }, uTiempo: { value: 0 } },
        vertexShader: `
            uniform vec3 uSol;
            uniform float uTam;
            uniform float uTiempo;
            varying float vLuz;
            void main() {
                vec4 mundo = modelMatrix * vec4(position, 1.0);
                vec3 normal = normalize(mundo.xyz);
                vLuz = smoothstep(0.25, -0.25, dot(normal, uSol)) * (0.85 + 0.15 * sin(uTiempo * 3.0 + position.x * 40.0));
                vec4 vista = viewMatrix * mundo;
                gl_PointSize = uTam / -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            varying float vLuz;
            void main() {
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = exp(-r * r * 6.0) * 0.7 + exp(-r * r * 40.0);
                gl_FragColor = vec4(vec3(1.0, 0.72, 0.36) * a * vLuz, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    brillos = new THREE.Points(geometria, material);
    planeta.add(brillos);
}


// =====================================================================
// 8. EL ESPACIO
// El cielo de estrellas de Gargantua: alrededor del agujero la luz se
// dobla y las estrellas se estiran.
// =====================================================================

function crearEspacio() {
    const cielo = crearCielo({ tRuido, uTiempo: tiempoCine, centro: gargantua.grupo.position });
    escena.add(cielo);
    return cielo;
}

function crearFugaz() {
    const geometria = new THREE.PlaneGeometry(1, 0.012);
    geometria.translate(-0.5, 0, 0);
    const material = new THREE.ShaderMaterial({
        uniforms: { uVida: { value: 0 } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uVida;
            varying vec2 vUv;
            void main() {
                float a = pow(vUv.x, 3.0) * (1.0 - abs(vUv.y - 0.5) * 2.0) * sin(uVida * 3.14159);
                gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * a * 2.0, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
    });
    const malla = new THREE.Mesh(geometria, material);
    malla.visible = false;
    malla.renderOrder = -1;
    escena.add(camara);
    camara.add(malla);
    return { malla, vida: 1, espera: 3, x: 0, y: 0, angulo: 0 };
}

function moverFugaz(f, delta) {
    if (f.vida >= 1) {
        f.espera -= delta;
        f.malla.visible = false;
        if (f.espera > 0) return;
        f.vida = 0;
        f.espera = 5 + Math.random() * 9;
        f.x = (Math.random() - 0.5) * 50;
        f.y = Math.random() * 15 + 2;
        f.angulo = Math.PI + (Math.random() - 0.5) * 0.8 + (f.x < 0 ? Math.PI : 0);
        f.malla.visible = true;
    }
    f.vida = Math.min(1, f.vida + delta / 1.1);
    const avance = f.vida * 14;
    f.malla.position.set(f.x + Math.cos(f.angulo) * avance, f.y + Math.sin(f.angulo) * avance, -60);
    f.malla.rotation.z = f.angulo;
    f.malla.scale.set(9, 9, 1);
    f.malla.material.uniforms.uVida.value = f.vida;
}


// =====================================================================
// 8b. EL CAMINANTE
// Un viajero pequeño con gorro y farol que sube por el camino hasta el
// castillo. Al llegar entra por la puerta y vuelve a salir abajo.
// =====================================================================

const alturasCamino = [];
const caminante = { grupo: null, piernas: [], farol: null, brillo: null, s: 0, escala: 0, salto: 0, fase: 0 };

function crearCaminante() {
    camino.forEach((d) => alturasCamino.push(altura(d)));
    const grupo = new THREE.Group();
    const tela = new THREE.MeshStandardMaterial({ color: 0x3f8f8a, roughness: 0.8 });
    const piel = new THREE.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.7 });
    const gorro = new THREE.MeshStandardMaterial({ color: 0xd9a33f, roughness: 0.7 });
    const oscuro = new THREE.MeshStandardMaterial({ color: 0x3a2f45, roughness: 0.9 });
    const pieza = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        grupo.add(m);
        return m;
    };
    pieza(new THREE.CapsuleGeometry(0.0075, 0.012, 6, 14), tela, 0, 0.019, 0);
    pieza(new THREE.SphereGeometry(0.0072, 16, 12), piel, 0, 0.0345, 0);
    const sombrero = pieza(new THREE.ConeGeometry(0.0085, 0.019, 16), gorro, 0, 0.047, -0.001);
    sombrero.rotation.x = -0.25;
    pieza(new THREE.TorusGeometry(0.0072, 0.0018, 8, 20), gorro, 0, 0.0385, 0).rotation.x = Math.PI / 2;
    [-0.0035, 0.0035].forEach((x) => {
        const pierna = new THREE.Group();
        pierna.position.set(x, 0.009, 0);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.009, 8), oscuro);
        m.position.y = -0.0045;
        m.castShadow = true;
        pierna.add(m);
        grupo.add(pierna);
        caminante.piernas.push(pierna);
    });
    caminante.farol = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb24a, emissiveIntensity: 1 });
    pieza(new THREE.SphereGeometry(0.0035, 12, 8), caminante.farol, 0.011, 0.016, 0.004);
    const brillo = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.011, 0.016, 0.004)]),
        new THREE.ShaderMaterial({
            uniforms: { uLuz: { value: 0 }, uTam: { value: 90 * renderizador.getPixelRatio() } },
            vertexShader: `
                uniform float uTam;
                void main() {
                    vec4 vista = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = uTam / -vista.z;
                    gl_Position = projectionMatrix * vista;
                }
            `,
            fragmentShader: `
                uniform float uLuz;
                void main() {
                    float r = length(gl_PointCoord - 0.5) * 2.0;
                    float a = exp(-r * r * 5.0) * 0.6 + exp(-r * r * 40.0);
                    gl_FragColor = vec4(vec3(1.0, 0.75, 0.38) * a * uLuz, 1.0);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
    grupo.add(brillo);
    caminante.brillo = brillo;
    caminante.grupo = grupo;
    planeta.add(grupo);
}

const auxA = new THREE.Vector3();
const auxB = new THREE.Vector3();
const auxDelante = new THREE.Vector3();
const auxDerecha = new THREE.Vector3();
const auxArriba = new THREE.Vector3();
const auxBase = new THREE.Matrix4();

function moverCaminante(delta) {
    const c = caminante;
    if (!c.grupo) return;
    const fin = PUNTOS_CAMINO - 2;
    if (c.s < fin) {
        c.s = Math.min(fin, c.s + delta * 6.5);
        c.escala = Math.min(1, c.escala + delta * 2);
    } else {
        c.escala -= delta * 1.5;
        if (c.escala <= 0) {
            c.s = 1;
            c.escala = 0;
        }
    }
    c.fase += delta * 9;
    c.salto = Math.max(0, c.salto - delta * 1.8);
    const i = Math.floor(c.s);
    const t = c.s - i;
    auxArriba.lerpVectors(camino[i], camino[i + 1], t).normalize();
    const h = alturasCamino[i] + (alturasCamino[i + 1] - alturasCamino[i]) * t;
    auxA.copy(camino[Math.max(0, i - 2)]);
    auxB.copy(camino[Math.min(PUNTOS_CAMINO - 1, i + 3)]);
    auxDelante.subVectors(auxB, auxA);
    auxDelante.addScaledVector(auxArriba, -auxDelante.dot(auxArriba)).normalize();
    auxDerecha.crossVectors(auxArriba, auxDelante).normalize();
    auxBase.makeBasis(auxDerecha, auxArriba, auxDelante);
    c.grupo.quaternion.setFromRotationMatrix(auxBase);
    const bote = Math.abs(Math.sin(c.fase)) * 0.0015 + Math.sin(c.salto * Math.PI) * 0.03;
    c.grupo.position.copy(auxArriba).multiplyScalar(h + 0.002 + bote);
    c.grupo.scale.setScalar(Math.max(0.001, c.escala) * 1.15);
    c.piernas[0].rotation.x = Math.sin(c.fase) * 0.6;
    c.piernas[1].rotation.x = -Math.sin(c.fase) * 0.6;
    auxArriba.applyQuaternion(planeta.quaternion);
    const noche = THREE.MathUtils.smoothstep(-auxArriba.dot(DIR_SOL), -0.25, 0.25);
    c.farol.emissiveIntensity = 0.4 + noche * 2.6;
    c.brillo.material.uniforms.uLuz.value = noche * c.escala;
}


// =====================================================================
// 8c. FUEGOS ARTIFICIALES Y FLORES
// Al tocar el castillo salen fuegos; al tocar la hierba crece una flor.
// =====================================================================

const MAX_CHISPAS = 480;
const chispas = { puntos: null, vel: [], vida: new Float32Array(MAX_CHISPAS), siguiente: 0 };

function crearChispas() {
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_CHISPAS * 3), 3));
    geometria.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(MAX_CHISPAS * 3), 3));
    geometria.setAttribute("aVida", new THREE.BufferAttribute(chispas.vida, 1));
    for (let i = 0; i < MAX_CHISPAS; i++) chispas.vel.push(new THREE.Vector3());
    const material = new THREE.ShaderMaterial({
        uniforms: { uTam: { value: 40 * renderizador.getPixelRatio() } },
        vertexShader: `
            attribute vec3 aColor;
            attribute float aVida;
            uniform float uTam;
            varying vec3 vColor;
            varying float vVida;
            void main() {
                vColor = aColor;
                vVida = aVida;
                vec4 vista = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aVida > 0.0 ? uTam * (0.4 + aVida) / -vista.z : 0.0;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vVida;
            void main() {
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = exp(-r * r * 8.0) * min(1.0, vVida * 2.0);
                gl_FragColor = vec4(vColor * a * 2.2, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    chispas.puntos = new THREE.Points(geometria, material);
    chispas.puntos.frustumCulled = false;
    escena.add(chispas.puntos);
}

const coloresFuego = [0xffd166, 0xff6b9a, 0x7ad7ff, 0xb48cff, 0x9effa0].map((c) => new THREE.Color(c));

function lanzarFuegos() {
    const origen = new THREE.Vector3();
    castillo.localToWorld(origen.set(0, 0.3, 0));
    const arribaCastillo = new THREE.Vector3(0, 1, 0).applyQuaternion(planeta.quaternion);
    const pos = chispas.puntos.geometry.attributes.position;
    const col = chispas.puntos.geometry.attributes.aColor;
    for (let r = 0; r < 3; r++) {
        const centro = origen.clone().addScaledVector(arribaCastillo, 0.12 + r * 0.07).add(new THREE.Vector3().randomDirection().multiplyScalar(0.1));
        const color = coloresFuego[Math.floor(Math.random() * coloresFuego.length)];
        for (let k = 0; k < 120; k++) {
            const i = chispas.siguiente;
            chispas.siguiente = (i + 1) % MAX_CHISPAS;
            pos.setXYZ(i, centro.x, centro.y, centro.z);
            chispas.vel[i].randomDirection().multiplyScalar(0.25 + Math.random() * 0.12);
            chispas.vida[i] = 1 + r * 0.35;
            col.setXYZ(i, color.r, color.g, color.b);
        }
    }
    col.needsUpdate = true;
    pos.needsUpdate = true;
}

function moverChispas(delta) {
    if (!chispas.puntos) return;
    const pos = chispas.puntos.geometry.attributes.position;
    let activas = false;
    for (let i = 0; i < MAX_CHISPAS; i++) {
        if (chispas.vida[i] <= 0) continue;
        activas = true;
        chispas.vida[i] = Math.max(0, chispas.vida[i] - delta * 0.7);
        const v = chispas.vel[i];
        auxA.fromBufferAttribute(pos, i);
        v.multiplyScalar(1 - delta * 1.6).addScaledVector(auxA, -delta * 0.12 / Math.max(0.5, auxA.lengthSq()));
        auxA.addScaledVector(v, delta);
        pos.setXYZ(i, auxA.x, auxA.y, auxA.z);
    }
    if (activas) {
        pos.needsUpdate = true;
        chispas.puntos.geometry.attributes.aVida.needsUpdate = true;
    }
}

const floresPlantadas = [];
let piezasFlor = null;

function plantarFlor(puntoMundo) {
    if (!piezasFlor) {
        piezasFlor = {
            tallo: new THREE.CylinderGeometry(0.0012, 0.0016, 0.02, 6).translate(0, 0.01, 0),
            petalo: new THREE.SphereGeometry(0.0045, 10, 8).scale(1, 0.35, 0.6),
            centro: new THREE.SphereGeometry(0.0028, 10, 8),
            verde: new THREE.MeshStandardMaterial({ color: 0x4f9a3c, roughness: 0.8 }),
            amarillo: new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.6 }),
            colores: [0xff8fb8, 0xffffff, 0xb48cff, 0xff9b5c, 0x7ad7ff].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }))
        };
    }
    const d = planeta.worldToLocal(puntoMundo.clone()).normalize();
    if (d.y > 0.9 || distanciaCamino(d) < 0.03) return false;
    const flor = new THREE.Group();
    flor.add(new THREE.Mesh(piezasFlor.tallo, piezasFlor.verde));
    const color = piezasFlor.colores[Math.floor(Math.random() * piezasFlor.colores.length)];
    for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const p = new THREE.Mesh(piezasFlor.petalo, color);
        p.position.set(Math.cos(a) * 0.0042, 0.021, Math.sin(a) * 0.0042);
        p.rotation.y = -a;
        flor.add(p);
    }
    const centro = new THREE.Mesh(piezasFlor.centro, piezasFlor.amarillo);
    centro.position.y = 0.022;
    flor.add(centro);
    flor.position.copy(d).multiplyScalar(altura(d) - 0.001);
    flor.quaternion.setFromUnitVectors(arriba, d).multiply(new THREE.Quaternion().setFromAxisAngle(arriba, Math.random() * 6));
    flor.scale.setScalar(0.001);
    flor.userData.crece = 0;
    flor.userData.tam = 3 + Math.random() * 1.2;
    planeta.add(flor);
    floresPlantadas.push(flor);
    if (floresPlantadas.length > 40) planeta.remove(floresPlantadas.shift());
    return true;
}

function crecerFlores(delta) {
    floresPlantadas.forEach((f) => {
        if (f.userData.crece >= 1) return;
        f.userData.crece = Math.min(1, f.userData.crece + delta * 1.8);
        const k = f.userData.crece;
        const rebote = 1 + Math.sin(k * Math.PI) * 0.25;
        f.scale.setScalar(Math.max(0.001, k * rebote * f.userData.tam));
    });
}


// =====================================================================
// 8d. VUELOS DE CÁMARA
// Al tocar una luna la cámara gira hasta verla delante del planeta.
// =====================================================================

let vuelo = null;

function volarHacia(direccionMundo) {
    const inicio = camara.position.clone();
    const distancia = inicio.distanceTo(controles.target);
    const destino = direccionMundo.clone().normalize().multiplyScalar(0.75).add(inicio.clone().normalize().multiplyScalar(0.25)).normalize().multiplyScalar(distancia);
    vuelo = { inicio, destino, t: 0 };
}

function moverVuelo(delta) {
    if (!vuelo) return;
    vuelo.t = Math.min(1, vuelo.t + delta / 1.6);
    const k = vuelo.t < 0.5 ? 4 * vuelo.t ** 3 : 1 - (-2 * vuelo.t + 2) ** 3 / 2;
    const largo = THREE.MathUtils.lerp(vuelo.inicio.length(), vuelo.destino.length(), k);
    camara.position.copy(vuelo.inicio).normalize().lerp(auxA.copy(vuelo.destino).normalize(), k).normalize().multiplyScalar(largo);
    if (vuelo.t >= 1) vuelo = null;
}


// =====================================================================
// 9. LAS LUNAS
// Cada luna lleva el nombre de una tarjeta. Al tocarla se abre la
// tarjeta correspondiente.
// =====================================================================

const lunas = [];
const botonesLuna = [...document.querySelectorAll(".luna")];

function crearLunas() {
    const tonos = [0xd9c8ff, 0xffcfae, 0xb8f0d8, 0xa9d4ff];
    botonesLuna.forEach((boton, i) => {
        const geometria = blandito(new THREE.SphereGeometry(0.12 + i * 0.015, 48, 32), 0.05, 7);
        const pos = geometria.attributes.position;
        const colores = new Float32Array(pos.count * 3);
        const base = new THREE.Color(tonos[i]);
        const c = new THREE.Color();
        const v = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) {
            v.fromBufferAttribute(pos, k).normalize();
            const crater = ruido.noise3d(v.x * 5 + i * 10, v.y * 5, v.z * 5);
            c.copy(base).multiplyScalar(0.8 + 0.2 * Math.abs(crater) + (crater > 0.55 ? -0.18 : 0));
            colores.set([c.r, c.g, c.b], k * 3);
        }
        geometria.setAttribute("color", new THREE.BufferAttribute(colores, 3));
        const luna = new THREE.Mesh(geometria, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: base, emissiveIntensity: 0.05 }));
        luna.castShadow = true;
        const orbita = new THREE.Group();
        orbita.rotation.set([0.35, -0.5, 0.18, -0.28][i], i * 0.9, [0.1, -0.2, 0.3, 0][i]);
        const giro = new THREE.Group();
        giro.rotation.y = [0.3, 2.0, 3.7, 5.2][i];
        luna.position.set(1.9 + i * 0.36, 0, 0);
        giro.add(luna);
        orbita.add(giro);
        escena.add(orbita);
        lunas.push({ luna, giro, boton, velocidad: 0.09 - i * 0.012, encima: false });
        boton.addEventListener("click", () => elegirLuna(lunas[i]));
    });
}

function elegirLuna(l) {
    abrirTarjeta(l.boton.dataset.tarjeta);
    l.luna.getWorldPosition(auxMundo);
    volarHacia(auxMundo);
}

const auxPantalla = new THREE.Vector3();
const auxCerca = new THREE.Vector3();
const etiquetas = [];
const auxMundo = new THREE.Vector3();
const auxRayo = new THREE.Vector3();
let lunasVisibles = true;

function colocarEtiquetas() {
    etiquetas.length = 0;
    lunas.forEach((l) => {
        l.luna.getWorldPosition(auxMundo);
        auxPantalla.copy(auxMundo).project(camara);
        const x = (auxPantalla.x * 0.5 + 0.5) * innerWidth;
        const y = (-auxPantalla.y * 0.5 + 0.5) * innerHeight;
        auxRayo.subVectors(auxMundo, camara.position);
        const largo = auxRayo.length();
        auxRayo.normalize();
        const t = -camara.position.dot(auxRayo);
        const cercania = auxCerca.copy(camara.position).addScaledVector(auxRayo, t).length();
        const tapada = t > 0 && t < largo && cercania < 1.08;
        const dentro = auxPantalla.z < 1 && x > -50 && x < innerWidth + 50 && y > -20 && y < innerHeight + 20;
        const visible = listo && lunasVisibles && dentro && !tapada;
        l.boton.classList.toggle("visible", visible);
        etiquetas.push({ l, x: x + 14, y: y - 14, visible });
    });
    etiquetas.sort((a, b) => a.y - b.y);
    const puestas = [];
    etiquetas.forEach((e) => {
        if (e.visible) {
            puestas.forEach((o) => {
                if (Math.abs(o.x - e.x) < 110 && e.y - o.y < 30) e.y = o.y + 30;
            });
            puestas.push(e);
        }
        if (!e.l.ancho) e.l.ancho = e.l.boton.offsetWidth;
        const ancho = e.l.ancho || 90;
        const x = Math.max(8, Math.min(innerWidth - ancho - 8, e.x));
        e.l.boton.style.transform = `translate(${Math.round(x)}px, ${Math.round(e.y)}px)`;
    });
}


// =====================================================================
// 10. LAS TARJETAS Y EL ENCUADRE
// =====================================================================

const botonPaisaje = document.getElementById("boton-paisaje");
const tarjetas = [...document.querySelectorAll(".tarjeta")];
const encuadre = { valor: 1, objetivo: 1 };

function mostrarTarjetas(mostrar) {
    document.body.classList.toggle("sin-tarjetas", !mostrar);
    botonPaisaje.textContent = mostrar ? "Ver el paisaje" : "Ver tarjetas";
    botonPaisaje.setAttribute("aria-pressed", !mostrar);
    encuadre.objetivo = mostrar ? 1 : 0;
    if (mostrar) {
        tarjetas.forEach((t) => {
            t.classList.remove("oculta");
            requestAnimationFrame(() => t.classList.remove("cerrada"));
        });
    }
}

function abrirTarjeta(id) {
    const tarjeta = document.getElementById(id);
    if (!tarjeta) return;
    mostrarTarjetas(true);
    tarjetas.forEach((t) => t.classList.toggle("destacada", t === tarjeta));
    setTimeout(() => tarjeta.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 60);
    clearTimeout(abrirTarjeta.espera);
    abrirTarjeta.espera = setTimeout(() => tarjeta.classList.remove("destacada"), 2500);
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

if (parametros.get("tarjetas") === "no") {
    mostrarTarjetas(false);
    encuadre.valor = 0;
}

function aplicarEncuadre(delta) {
    encuadre.valor += (encuadre.objetivo - encuadre.valor) * Math.min(1, delta * 3);
    const estrecho = innerWidth <= 900;
    const dx = estrecho ? 0 : 200 * encuadre.valor;
    const dy = estrecho ? innerHeight * 0.14 * encuadre.valor : 0;
    if (dx < 0.5 && dy < 0.5) camara.clearViewOffset();
    else camara.setViewOffset(innerWidth, innerHeight, dx, dy, innerWidth, innerHeight);
}


// =====================================================================
// 11. CONTROLES Y PUNTERO
// =====================================================================

let girando = true;
const botonGirar = document.getElementById("boton-girar");
const botonLunas = document.getElementById("boton-lunas");

botonGirar.addEventListener("click", () => {
    girando = !girando;
    botonGirar.classList.toggle("activo", girando);
    botonGirar.setAttribute("aria-pressed", girando);
});

botonLunas.addEventListener("click", () => {
    lunasVisibles = !lunasVisibles;
    botonLunas.classList.toggle("activo", lunasVisibles);
    botonLunas.setAttribute("aria-pressed", lunasVisibles);
    lunas.forEach((l) => (l.luna.visible = lunasVisibles));
});

const rayo = new THREE.Raycaster();
const auxRaton = new THREE.Vector2();
let lunaEncima = null;

function apuntar(evento) {
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(auxRaton, camara);
}

function lunaBajo(evento) {
    if (!lunasVisibles) return null;
    apuntar(evento);
    const corte = rayo.intersectObjects(lunas.map((l) => l.luna), false)[0];
    return corte ? lunas.find((l) => l.luna === corte.object) : null;
}

function queHayBajo(evento, conSuelo) {
    const luna = lunaBajo(evento);
    if (luna) return { tipo: "luna", luna };
    apuntar(evento);
    const objetos = conSuelo ? [castillo, caminante.grupo, suelo] : [castillo, caminante.grupo];
    const corte = rayo.intersectObjects(objetos, true)[0];
    if (!corte) return null;
    let o = corte.object;
    while (o) {
        if (o === castillo) return { tipo: "castillo" };
        if (o === caminante.grupo) return { tipo: "caminante" };
        o = o.parent;
    }
    return { tipo: "suelo", punto: corte.point };
}

renderizador.domElement.addEventListener("pointermove", (evento) => {
    if (evento.pointerType === "touch" || evento.buttons || !listo) return;
    const cosa = queHayBajo(evento, false);
    lunaEncima = cosa && cosa.tipo === "luna" ? cosa.luna : null;
    renderizador.domElement.style.cursor = cosa ? "pointer" : "";
    lunas.forEach((l) => l.boton.classList.toggle("encima", l === lunaEncima));
});

let inicioToque = null;
renderizador.domElement.addEventListener("pointerdown", (evento) => {
    inicioToque = { x: evento.clientX, y: evento.clientY };
    document.getElementById("pista").classList.add("oculta");
});

renderizador.domElement.addEventListener("pointerup", (evento) => {
    if (!inicioToque || !listo) return;
    const movido = Math.hypot(evento.clientX - inicioToque.x, evento.clientY - inicioToque.y);
    inicioToque = null;
    if (movido > 8) return;
    const cosa = queHayBajo(evento, true);
    if (!cosa && tocaGargantua(evento)) return;
    if (!cosa) return;
    if (cosa.tipo === "luna") elegirLuna(cosa.luna);
    else if (cosa.tipo === "castillo") {
        lanzarFuegos();
        abrirTarjeta("tarjeta-hola");
    } else if (cosa.tipo === "caminante") caminante.salto = 1;
    else plantarFlor(cosa.punto);
});

renderizador.domElement.addEventListener("pointerdown", () => {
    vuelo = null;
});


// =====================================================================
// 12. ARRANQUE Y BUCLE
// =====================================================================

// Resplandor y acabado de cine, como en Gargantua
const contexto = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && !!(contexto.getExtension("EXT_color_buffer_float") || contexto.getExtension("EXT_color_buffer_half_float"));
const compositor = new EffectComposer(renderizador, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType }));
compositor.addPass(new RenderPass(escena, camara));
compositor.addPass(new PaseBrillo({ flotantes: hayFlotantes, escala: movil ? 3 : 2, umbral: 1.4, umbralRaya: 3.5, fuerza: 0.6, raya: 0.2 }));
compositor.addPass(new OutputPass());
compositor.addPass(crearAcabado(tiempoCine));

window.addEventListener("resize", () => {
    camara.aspect = innerWidth / innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
});

// La entrada: aparecen las estrellas y luego Gargantua se enciende en
// espiral, y con él la luz que llega al planeta
const pocoMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
const entrada = { t: pocoMovimiento || parametros.has("sinentrada") ? 10 : 0 };

function moverEntrada(delta) {
    entrada.t += delta;
    const gas = THREE.MathUtils.smoothstep(entrada.t, 0.6, 4.8);
    estrellas.material.uniforms.uAparece.value = THREE.MathUtils.smoothstep(entrada.t, 0.1, 1.4);
    gargantua.comunes.uEncendido.value = gas;
    sol.intensity = 2.8 * (0.15 + 0.85 * gas);
}

// El sonido y tocar Gargantua
const zumbido = crearZumbido();
const botonSonido = document.getElementById("boton-sonido");
botonSonido.addEventListener("click", () => {
    const activo = zumbido.alternar();
    botonSonido.classList.toggle("activo", activo);
    botonSonido.setAttribute("aria-pressed", activo);
});

function tocaGargantua(evento) {
    apuntar(evento);
    const corte = rayo.intersectObject(gargantua.sombra, false)[0];
    if (!corte) {
        auxMundo.copy(gargantua.grupo.position).project(camara);
        const dx = (auxMundo.x * 0.5 + 0.5) * innerWidth - evento.clientX;
        const dy = (-auxMundo.y * 0.5 + 0.5) * innerHeight - evento.clientY;
        if (auxMundo.z > 1 || Math.hypot(dx, dy) > 70) return false;
    }
    gargantua.despertar();
    zumbido.despertar();
    return true;
}

// El tamaño de la lente del cielo según lo lejos que está Gargantua
function lenteCielo() {
    const distancia = camara.position.distanceTo(gargantua.grupo.position);
    estrellas.material.uniforms.uRadioLente.value = Math.asin(ESCALA_GARGANTUA / distancia) * 2.1;
}

const cargando = document.getElementById("cargando");
let listo = false;
let castillo = null;
let estrellas = null;
const fugaz = crearFugaz();

function construir() {
    crearSuelo();
    crearCamino();
    crearArboles();
    crearFlores();
    crearPiedras();
    crearFarolas();
    castillo = crearCastillo();
    crearBrillos(castillo);
    crearNubes();
    crearAtmosfera();
    crearLunas();
    crearCaminante();
    crearChispas();
    estrellas = crearEspacio();
    moverEntrada(0);
    renderizador.compile(escena, camara);
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => document.getElementById("pista").classList.add("oculta"), 7000);
}

const reloj = new THREE.Clock();
const auxNormal = new THREE.Vector3();

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const tiempo = reloj.elapsedTime;
    if (girando) planeta.rotateY(delta * 0.07);
    nubes.forEach((n) => (n.orbita.rotation.z += n.velocidad * delta));
    lunas.forEach((l) => {
        const lento = l.boton.classList.contains("encima") ? 0.15 : 1;
        l.giro.rotation.y += l.velocidad * delta * lento;
        l.luna.rotation.y += delta * 0.2;
    });
    planeta.updateMatrixWorld();
    auxNormal.set(0, 1, 0).applyQuaternion(planeta.quaternion);
    castillo.userData.ventana.emissiveIntensity = THREE.MathUtils.smoothstep(-auxNormal.dot(DIR_SOL), -0.3, 0.3) * 2.5;
    brillos.material.uniforms.uTiempo.value = tiempo;
    estrellas.material.uniforms.uTiempo.value = tiempo;
    moverBanderas(tiempo);
    moverFugaz(fugaz, delta);
    moverCaminante(delta);
    moverChispas(delta);
    crecerFlores(delta);
    moverVuelo(delta);
    controles.update();
    aplicarEncuadre(delta);
    colocarEtiquetas();
    tiempoCine.value = tiempo;
    moverEntrada(delta);
    gargantua.orientar(camara);
    gargantua.actualizar(delta, tiempo);
    lenteCielo();
    compositor.render();
}

requestAnimationFrame(() => {
    construir();
    animar();
});
