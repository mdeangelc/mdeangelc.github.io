import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES
// Un planeta diminuto con un castillo en lo alto y un camino que le da
// vueltas hasta la puerta. Las cuatro lunas son las tarjetas del
// portfolio.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    detalle: movil ? 48 : 72,
    arboles: movil ? 60 : 90,
    flores: movil ? 300 : 520,
    estrellas: movil ? 2200 : 4000,
    sombra: movil ? 1024 : 2048,
    resolucionMax: movil ? 1.75 : 2
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
const distanciaInicial = Math.max(5.2, 1.75 / (Math.tan(THREE.MathUtils.degToRad(17)) * (innerWidth / innerHeight)));
camara.position.set(0.7, 0.75, 1).normalize().multiplyScalar(distanciaInicial);

const controles = new OrbitControls(camara, renderizador.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.06;
controles.enablePan = false;
controles.rotateSpeed = 0.55;
controles.minDistance = 2.2;
controles.maxDistance = 14;
controles.target.set(0, 0.12, 0);

const DIR_SOL = new THREE.Vector3(1, 0.35, -0.75).normalize();
const sol = new THREE.DirectionalLight(0xffe2b8, 2.6);
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

const contraluz = new THREE.DirectionalLight(0x9fb2ff, 0.7);
contraluz.position.set(-3, 0.5, -3);
escena.add(contraluz);
escena.add(new THREE.HemisphereLight(0x9c8cff, 0x241a40, 0.45));


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
    let mejor = -1;
    for (let i = 0; i < PUNTOS_CAMINO; i++) {
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
    const cache = new Map();
    for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i).normalize();
        const clave = `${d.x.toFixed(5)},${d.y.toFixed(5)},${d.z.toFixed(5)}`;
        let datos = cache.get(clave);
        if (!datos) {
            const dc = distanciaCamino(d);
            datos = { dc, h: altura(d, dc) };
            cache.set(clave, datos);
        }
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
    const suelo = new THREE.Mesh(geometria, material);
    suelo.receiveShadow = true;
    suelo.castShadow = true;
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
    const cipres = blandito(new THREE.SphereGeometry(0.022, 24, 18), 0.06, 40);
    cipres.scale(1.1, 2.5, 1.1);
    cipres.translate(0, 0.07, 0);

    const materialTronco = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 });
    const materialHojas = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const troncos = [];
    const grupos = { redondo: [], pino: [], cipres: [] };
    const colores = { redondo: [], pino: [], cipres: [] };
    const paleta = {
        redondo: [0x4f9a3c, 0x67b04a, 0x3d8a3f, 0xe59a5b, 0xf0b8c8, 0x8cbf4f],
        pino: [0x2f6e4a, 0x2a6242, 0x3c7f55],
        cipres: [0x2e5e3a, 0x37703f]
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

    const final = camino[PUNTOS_CAMINO - 1];
    castillo.rotation.y = Math.atan2(final.x, final.z);
    castillo.position.set(0, altura(new THREE.Vector3(0, 1, 0)) - 0.005, 0);
    castillo.userData.ventana = ventana;
    castillo.userData.ventanas = ventanas;
    planeta.add(castillo);
    return castillo;
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
                vec3 color = mix(vec3(0.45, 0.35, 1.0), vec3(1.0, 0.75, 0.55), luz * 0.6) * (0.35 + luz * 0.9);
                gl_FragColor = vec4(color * halo * 0.55, 1.0);
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
    castillo.userData.ventanas.forEach((v) => {
        const p = v.getWorldPosition(new THREE.Vector3());
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
// =====================================================================

function crearEspacio() {
    const n = ajustes.estrellas;
    const posiciones = new Float32Array(n * 3);
    const datos = new Float32Array(n * 2);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        p.randomDirection().multiplyScalar(120);
        posiciones.set([p.x, p.y, p.z], i * 3);
        datos[i * 2] = 0.7 + Math.pow(Math.random(), 5) * 3.5;
        datos[i * 2 + 1] = Math.random() * 100;
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("aDatos", new THREE.BufferAttribute(datos, 2));
    const estrellas = new THREE.Points(geometria, new THREE.ShaderMaterial({
        uniforms: { uTiempo: { value: 0 }, uEscala: { value: renderizador.getPixelRatio() } },
        vertexShader: `
            attribute vec2 aDatos;
            uniform float uTiempo;
            uniform float uEscala;
            varying float vBrillo;
            varying float vTono;
            void main() {
                vBrillo = 0.55 + 0.45 * sin(uTiempo * (0.8 + fract(aDatos.y) * 2.5) + aDatos.y);
                vTono = fract(aDatos.y * 7.13);
                gl_PointSize = aDatos.x * uEscala;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying float vBrillo;
            varying float vTono;
            void main() {
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = smoothstep(1.0, 0.0, r);
                vec3 c = mix(vec3(1.0, 0.95, 0.88), vec3(0.75, 0.8, 1.0), step(0.6, vTono));
                gl_FragColor = vec4(c * a * a * vBrillo * 1.5, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }));
    estrellas.frustumCulled = false;
    escena.add(estrellas);

    const fondo = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vDir;
            float hash(vec3 p) {
                p = fract(p * 0.3183099 + 0.1);
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            float ruido(vec3 x) {
                vec3 i = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                           mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
            }
            void main() {
                vec3 d = normalize(vDir);
                float n = ruido(d * 2.5) * 0.55 + ruido(d * 6.0) * 0.3 + ruido(d * 14.0) * 0.15;
                vec3 base = mix(vec3(0.02, 0.015, 0.05), vec3(0.05, 0.03, 0.1), d.y * 0.5 + 0.5);
                vec3 nebulosa = mix(vec3(0.25, 0.08, 0.32), vec3(0.05, 0.2, 0.32), ruido(d * 1.5 + 4.0));
                vec3 color = base + nebulosa * smoothstep(0.45, 0.85, n) * 0.35;
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    }));
    escena.add(fondo);

    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 256;
    const ctx = lienzo.getContext("2d");
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255, 248, 230, 1)");
    g.addColorStop(0.07, "rgba(255, 226, 180, 0.9)");
    g.addColorStop(0.25, "rgba(255, 170, 110, 0.22)");
    g.addColorStop(1, "rgba(255, 140, 90, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    const brilloSol = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    brilloSol.position.copy(DIR_SOL).multiplyScalar(90);
    brilloSol.scale.setScalar(26);
    escena.add(brilloSol);

    return estrellas;
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
        boton.addEventListener("click", () => abrirTarjeta(boton.dataset.tarjeta));
    });
}

const auxPantalla = new THREE.Vector3();
const auxMundo = new THREE.Vector3();
const auxRayo = new THREE.Vector3();
let lunasVisibles = true;

function colocarEtiquetas() {
    lunas.forEach((l) => {
        l.luna.getWorldPosition(auxMundo);
        auxPantalla.copy(auxMundo).project(camara);
        const x = (auxPantalla.x * 0.5 + 0.5) * innerWidth;
        const y = (-auxPantalla.y * 0.5 + 0.5) * innerHeight;
        auxRayo.subVectors(auxMundo, camara.position);
        const largo = auxRayo.length();
        auxRayo.normalize();
        const t = -camara.position.dot(auxRayo);
        const cercania = camara.position.clone().addScaledVector(auxRayo, t).length();
        const tapada = t > 0 && t < largo && cercania < 1.08;
        const dentro = auxPantalla.z < 1 && x > -50 && x < innerWidth + 50 && y > -20 && y < innerHeight + 20;
        l.boton.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 14)}px)`;
        l.boton.classList.toggle("visible", listo && lunasVisibles && dentro && !tapada);
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

function lunaBajo(evento) {
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(auxRaton, camara);
    const corte = rayo.intersectObjects(lunas.map((l) => l.luna), false)[0];
    return corte ? lunas.find((l) => l.luna === corte.object) : null;
}

renderizador.domElement.addEventListener("pointermove", (evento) => {
    if (evento.pointerType === "touch" || !lunasVisibles) return;
    lunaEncima = lunaBajo(evento);
    renderizador.domElement.style.cursor = lunaEncima ? "pointer" : "";
    lunas.forEach((l) => l.boton.classList.toggle("encima", l === lunaEncima));
});

let inicioToque = null;
renderizador.domElement.addEventListener("pointerdown", (evento) => {
    inicioToque = { x: evento.clientX, y: evento.clientY };
    document.getElementById("pista").classList.add("oculta");
});

renderizador.domElement.addEventListener("pointerup", (evento) => {
    if (!inicioToque || !lunasVisibles) return;
    const movido = Math.hypot(evento.clientX - inicioToque.x, evento.clientY - inicioToque.y);
    inicioToque = null;
    if (movido > 8) return;
    const l = lunaBajo(evento);
    if (l) abrirTarjeta(l.boton.dataset.tarjeta);
});


// =====================================================================
// 12. ARRANQUE Y BUCLE
// =====================================================================

window.addEventListener("resize", () => {
    camara.aspect = innerWidth / innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
});

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
    estrellas = crearEspacio();
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
    controles.update();
    aplicarEncuadre(delta);
    colocarEtiquetas();
    renderizador.render(escena, camara);
}

requestAnimationFrame(() => {
    construir();
    animar();
});
