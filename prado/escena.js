import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES GENERALES
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = window.innerWidth < 760 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pantallaEstrecha = window.innerWidth < window.innerHeight;

// Con ?calidad=baja en la dirección se dibuja mucha menos hierba
const factorCalidad = (parametros.get("calidad") === "baja" ? 0.25 : 1) * (movil ? 0.35 : 1);

const ajustes = {
    hierbaCamino: Math.floor(150000 * factorCalidad),
    hierbaPrado: Math.floor(170000 * factorCalidad),
    rodalesFlores: Math.max(12, Math.floor(45 * Math.max(factorCalidad, 0.5))),
    luciernagas: movil ? 50 : 120,
    estrellas: 1800,
    arboles: movil ? 110 : 190,
    pixeles: Math.min(window.devicePixelRatio, movil ? 1.5 : 2)
};

// Números aleatorios con semilla: el prado sale siempre igual al recargar
let semilla = 20261009;
function azar() {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function entre(a, b) {
    return a + azar() * (b - a);
}

// =====================================================================
// 2. EL TERRENO Y EL CAMINO
// alturaTerreno() da la altura de cualquier punto. La usan el suelo,
// la hierba, las piedras, los árboles, el castillo y la cámara.
// =====================================================================

const castillo = { x: 0, z: -126 };

function suave(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function alturaTerreno(x, z) {
    const ondas = 0.55 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.05 + 0.4)
                + 0.3 * Math.sin(x * 0.15 + z * 0.09);
    const laderas = 7 * suave(16, 48, Math.abs(x)) * (0.65 + 0.35 * Math.sin(z * 0.035 + x * 0.01));
    const rampa = 3.5 * suave(-25, -105, z);
    const dx = x - castillo.x;
    const dz = z - castillo.z;
    const pena = 17 * Math.exp(-(dx * dx + dz * dz) / (2 * 10.5 * 10.5));
    return ondas + laderas + rampa + pena;
}

const camino = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 14),
    new THREE.Vector3(1.6, 0, 0),
    new THREE.Vector3(-2.4, 0, -14),
    new THREE.Vector3(1.4, 0, -30),
    new THREE.Vector3(4.2, 0, -46),
    new THREE.Vector3(0.5, 0, -62),
    new THREE.Vector3(-3.8, 0, -76),
    new THREE.Vector3(-1.2, 0, -84),
    new THREE.Vector3(0.3, 0, -90)
], false, "catmullrom", 0.5);

const largoCamino = camino.getLength();
const puntosCamino = camino.getSpacedPoints(400);

function distanciaAlCamino(x, z) {
    let mejor = Infinity;
    for (let i = 0; i < puntosCamino.length; i++) {
        const dx = x - puntosCamino[i].x;
        const dz = z - puntosCamino[i].z;
        const d = dx * dx + dz * dz;
        if (d < mejor) mejor = d;
    }
    return Math.sqrt(mejor);
}

// =====================================================================
// 3. RENDERIZADOR, ESCENA Y CÁMARA
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderizador.setPixelRatio(ajustes.pixeles);
renderizador.setSize(window.innerWidth, window.innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.05;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
escena.fog = new THREE.Fog("#f3cfaa", 70, 520);

const camara = new THREE.PerspectiveCamera(pantallaEstrecha ? 64 : 50, window.innerWidth / window.innerHeight, 0.1, 1400);

// =====================================================================
// 4. MOMENTOS DEL DÍA
// Cada momento es una lista de colores y valores. Al cambiar, se
// mezclan poco a poco los del momento actual con los del nuevo.
// =====================================================================

const momentos = {
    manana: {
        cenit: "#3f8fdc", medio: "#8cc4ef", horizonte: "#e3f1f8",
        sol: "#fff4dc", luz: "#fff1dc", ambiente: "#6f8796", niebla: "#d4e7ef",
        nubeLuz: "#ffffff", nubeSombra: "#b9cbda", nubes: 0.85,
        verdeBase: "#1d4612", verdePunta: "#86c03c", amarillo: "#d2c858",
        montana: "#6f8fa6", luna: "#e8eefc",
        dirSol: [0.42, 0.36, -0.83], dirDisco: [0.42, 0.36, -0.83], alturaLuna: -0.3,
        intensidad: 1.0, translucidez: 0.35, noche: 0, solVisible: 1, brillo: 0.25
    },
    atardecer: {
        cenit: "#8f9fcb", medio: "#f0b48c", horizonte: "#fde0b8",
        sol: "#ffe6b0", luz: "#ffe0bb", ambiente: "#6a6466", niebla: "#f3cfaa",
        nubeLuz: "#ffe8d0", nubeSombra: "#cf8f82", nubes: 0.7,
        verdeBase: "#173a0b", verdePunta: "#7fb52f", amarillo: "#d2bd48",
        montana: "#a98a95", luna: "#e8eefc",
        dirSol: [0.42, 0.13, -0.9], dirDisco: [0.42, 0.13, -0.9], alturaLuna: -0.3,
        intensidad: 1.0, translucidez: 1.0, noche: 0, solVisible: 1, brillo: 0.35
    },
    noche: {
        cenit: "#030817", medio: "#0b1631", horizonte: "#1b2c52",
        sol: "#ffe6b0", luz: "#9fb6f0", ambiente: "#253254", niebla: "#13213f",
        nubeLuz: "#34466e", nubeSombra: "#111a32", nubes: 0.4,
        verdeBase: "#081a12", verdePunta: "#3f6e5c", amarillo: "#4c5c48",
        montana: "#16233f", luna: "#eef2fc",
        dirSol: [-0.38, 0.32, -0.87], dirDisco: [0.42, -0.3, -0.9], alturaLuna: 0.32,
        intensidad: 0.45, translucidez: 0.12, noche: 1, solVisible: 0, brillo: 0.7
    }
};

const nombresColor = ["cenit", "medio", "horizonte", "sol", "luz", "ambiente", "niebla", "nubeLuz", "nubeSombra",
    "verdeBase", "verdePunta", "amarillo", "montana", "luna"];
const nombresNumero = ["nubes", "intensidad", "translucidez", "noche", "solVisible", "alturaLuna", "brillo"];

function prepararMomento(datos) {
    const dirSol = [...datos.dirSol];
    const dirDisco = [...datos.dirDisco];
    if (pantallaEstrecha) {
        dirSol[0] *= 0.55;
        dirDisco[0] *= 0.55;
    }
    const preparado = {
        dirSol: new THREE.Vector3(...dirSol).normalize(),
        dirDisco: new THREE.Vector3(...dirDisco).normalize()
    };
    nombresColor.forEach((n) => (preparado[n] = new THREE.Color(datos[n])));
    nombresNumero.forEach((n) => (preparado[n] = datos[n]));
    return preparado;
}

Object.keys(momentos).forEach((clave) => (momentos[clave] = prepararMomento(momentos[clave])));

const actual = prepararMomento({ ...momentos.atardecer, ...Object.fromEntries(nombresColor.map((n) => [n, "#000000"])), dirSol: [0, 1, 0], dirDisco: [0, 1, 0] });

function copiarMomento(destino, origen) {
    nombresColor.forEach((n) => destino[n].copy(origen[n]));
    nombresNumero.forEach((n) => (destino[n] = origen[n]));
    destino.dirSol.copy(origen.dirSol);
    destino.dirDisco.copy(origen.dirDisco);
}

function mezclarMomentos(destino, a, b, t) {
    nombresColor.forEach((n) => destino[n].lerpColors(a[n], b[n], t));
    nombresNumero.forEach((n) => (destino[n] = a[n] + (b[n] - a[n]) * t));
    destino.dirSol.lerpVectors(a.dirSol, b.dirSol, t).normalize();
    destino.dirDisco.lerpVectors(a.dirDisco, b.dirDisco, t).normalize();
}

// Uniformes compartidos por todos los shaders
const comunes = {
    uTiempo: { value: 0 },
    uNiebla: { value: actual.niebla },
    uLuz: { value: new THREE.Color() },
    uAmbiente: { value: actual.ambiente },
    uDirSol: { value: actual.dirSol },
    uVerdeBase: { value: actual.verdeBase },
    uVerdePunta: { value: actual.verdePunta },
    uAmarillo: { value: actual.amarillo },
    uTranslucidez: { value: 0 },
    uRaton: { value: new THREE.Vector2(999, 999) },
    uFuerzaRaton: { value: 0 },
    uViento: { value: new THREE.Vector2(0.8, -0.6).normalize() },
    uFuerzaViento: { value: movimientoReducido ? 0.25 : 1 }
};

// Luces normales para los objetos con material estándar (castillo, piedras, árboles)
const luzSol = new THREE.DirectionalLight("#ffffff", 2);
const luzCielo = new THREE.HemisphereLight("#ffffff", "#3a4a2a", 0.8);
escena.add(luzSol, luzSol.target, luzCielo);

// =====================================================================
// 5. FUNCIONES DE RUIDO Y NIEBLA PARA LOS SHADERS
// =====================================================================

const ruidoGLSL = `
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
        float total = 0.0;
        float amplitud = 0.5;
        for (int i = 0; i < 4; i++) {
            total += ruido(p) * amplitud;
            p *= 2.03;
            amplitud *= 0.5;
        }
        return total;
    }

    float manchas(vec2 xz) {
        return smoothstep(0.42, 0.64, fbm(xz * 0.05 + vec2(3.1, 7.2)));
    }
`;

const nieblaGLSL = `
    vec3 aplicarNiebla(vec3 color, float distancia) {
        float n = smoothstep(55.0, 420.0, distancia);
        return mix(color, uNiebla, n * 0.8);
    }
`;

// =====================================================================
// 6. CIELO: degradado, sol, luna y nubes en un solo shader
// =====================================================================

const materialCielo = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
        ...comunes,
        uCenit: { value: actual.cenit },
        uMedio: { value: actual.medio },
        uHorizonte: { value: actual.horizonte },
        uColorSol: { value: actual.sol },
        uColorLuna: { value: actual.luna },
        uNubeLuz: { value: actual.nubeLuz },
        uNubeSombra: { value: actual.nubeSombra },
        uNubes: { value: 0 },
        uSolVisible: { value: 1 },
        uLunaVisible: { value: 0 },
        uDirDisco: { value: actual.dirDisco },
        uDirLuna: { value: new THREE.Vector3(-0.38, 0.32, -0.87).normalize() }
    },
    vertexShader: `
        varying vec3 vDireccion;
        void main() {
            vDireccion = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
        }
    `,
    fragmentShader: `
        uniform float uTiempo;
        uniform vec3 uCenit;
        uniform vec3 uMedio;
        uniform vec3 uHorizonte;
        uniform vec3 uColorSol;
        uniform vec3 uColorLuna;
        uniform vec3 uNubeLuz;
        uniform vec3 uNubeSombra;
        uniform float uNubes;
        uniform float uSolVisible;
        uniform float uLunaVisible;
        uniform vec3 uDirDisco;
        uniform vec3 uDirLuna;
        varying vec3 vDireccion;
        ${ruidoGLSL}

        void main() {
            vec3 d = normalize(vDireccion);
            float h = d.y;

            vec3 color = mix(uHorizonte, uMedio, smoothstep(0.0, 0.2, h));
            color = mix(color, uCenit, smoothstep(0.18, 0.75, h));

            float sol = max(dot(d, uDirDisco), 0.0);
            color += uColorSol * (pow(sol, 8.0) * 0.12 + pow(sol, 60.0) * 0.22 + pow(sol, 600.0) * 0.5) * uSolVisible;
            color = mix(color, vec3(1.0, 0.97, 0.9) * 3.0, smoothstep(0.99905, 0.9994, sol) * uSolVisible);

            float luna = max(dot(d, uDirLuna), 0.0);
            color += uColorLuna * (pow(luna, 60.0) * 0.03 + pow(luna, 600.0) * 0.12) * uLunaVisible;
            float discoLuna = smoothstep(0.99962, 0.99972, luna);
            float sombraLuna = 0.85 + 0.15 * ruido(d.xy * 900.0);
            color = mix(color, uColorLuna * sombraLuna * 1.4, discoLuna * uLunaVisible);

            if (h > 0.0) {
                vec2 uv = d.xz / (h + 0.15) * 1.1 + vec2(uTiempo * 0.012, uTiempo * 0.004);
                float n = fbm(uv * 0.8);
                float nube = smoothstep(0.52, 0.82, n) * smoothstep(0.02, 0.3, h) * uNubes;
                vec3 colorNube = mix(uNubeSombra, uNubeLuz, smoothstep(0.5, 0.95, n));
                colorNube += uColorSol * pow(sol, 4.0) * 0.35 * uSolVisible;
                color = mix(color, colorNube, nube);
            }

            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
});

const cielo = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), materialCielo);
cielo.frustumCulled = false;
escena.add(cielo);

// =====================================================================
// 7. ESTRELLAS
// =====================================================================

const posicionesEstrellas = [];
for (let i = 0; i < ajustes.estrellas; i++) {
    const angulo = azar() * Math.PI * 2;
    const y = 0.05 + Math.pow(azar(), 0.7) * 0.95;
    const horizontal = Math.sqrt(1 - y * y);
    posicionesEstrellas.push(Math.cos(angulo) * horizontal * 900, y * 900, Math.sin(angulo) * horizontal * 900);
}
const geometriaEstrellas = new THREE.BufferGeometry();
geometriaEstrellas.setAttribute("position", new THREE.Float32BufferAttribute(posicionesEstrellas, 3));
const materialEstrellas = new THREE.PointsMaterial({
    color: "#ffffff", size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false
});
const estrellas = new THREE.Points(geometriaEstrellas, materialEstrellas);
escena.add(estrellas);

// =====================================================================
// 8. MONTAÑAS DEL FONDO (con picos y difuminadas con la distancia)
// =====================================================================

const montanas = [];

function crearCordillera(distancia, alturaBase, alturaPicos, fase, bruma) {
    const forma = new THREE.Shape();
    const ancho = 1600;
    forma.moveTo(-ancho / 2, -20);
    for (let x = -ancho / 2; x <= ancho / 2; x += 3) {
        const pico1 = 1 - Math.abs(Math.sin(x * 0.009 + fase));
        const pico2 = 1 - Math.abs(Math.sin(x * 0.023 + fase * 1.7));
        const detalle = Math.sin(x * 0.11 + fase * 3.1);
        const y = alturaBase + alturaPicos * (0.65 * Math.pow(pico1, 2.2) + 0.3 * Math.pow(pico2, 1.6)) + detalle * 1.2;
        forma.lineTo(x, y);
    }
    forma.lineTo(ancho / 2, -20);
    forma.closePath();

    const material = new THREE.ShaderMaterial({
        fog: false,
        uniforms: {
            uColor: { value: actual.montana },
            uNiebla: comunes.uNiebla,
            uBruma: { value: bruma },
            uAltura: { value: alturaBase + alturaPicos }
        },
        vertexShader: `
            varying float vAltura;
            void main() {
                vAltura = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uNiebla;
            uniform float uBruma;
            uniform float uAltura;
            varying float vAltura;
            void main() {
                float abajo = 1.0 - smoothstep(0.0, uAltura, vAltura);
                float arriba = smoothstep(uAltura * 0.75, uAltura, vAltura);
                vec3 color = mix(uColor, uNiebla, clamp(uBruma + abajo * 0.5, 0.0, 1.0));
                color = mix(color, color * 1.18, arriba);
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });

    const malla = new THREE.Mesh(new THREE.ShapeGeometry(forma), material);
    malla.position.z = -distancia;
    escena.add(malla);
    montanas.push(malla);
}

crearCordillera(560, 30, 95, 1.2, 0.42);
crearCordillera(420, 14, 70, 3.9, 0.28);
crearCordillera(300, 4, 38, 7.4, 0.14);

// =====================================================================
// 9. SUELO
// Cada vértice guarda cuánto está "dentro del camino" para pintar
// la tierra del sendero bajo las piedras.
// =====================================================================

const geometriaSuelo = new THREE.PlaneGeometry(520, 520, 360, 360);
geometriaSuelo.rotateX(-Math.PI / 2);
geometriaSuelo.translate(0, 0, -100);
const verticesSuelo = geometriaSuelo.attributes.position;
const tierraCamino = new Float32Array(verticesSuelo.count);
for (let i = 0; i < verticesSuelo.count; i++) {
    const x = verticesSuelo.getX(i);
    const z = verticesSuelo.getZ(i);
    verticesSuelo.setY(i, alturaTerreno(x, z));
    if (Math.abs(x) < 12 && z < 20 && z > -110) {
        tierraCamino[i] = 1 - suave(1.1, 2.0, distanciaAlCamino(x, z));
    }
}
geometriaSuelo.setAttribute("aCamino", new THREE.BufferAttribute(tierraCamino, 1));
geometriaSuelo.computeVertexNormals();

const materialSuelo = new THREE.ShaderMaterial({
    uniforms: comunes,
    vertexShader: `
        attribute float aCamino;
        varying vec3 vMundo;
        varying vec3 vNormal;
        varying float vCamino;
        void main() {
            vec4 mundo = modelMatrix * vec4(position, 1.0);
            vMundo = mundo.xyz;
            vNormal = normal;
            vCamino = aCamino;
            gl_Position = projectionMatrix * viewMatrix * mundo;
        }
    `,
    fragmentShader: `
        uniform vec3 uNiebla;
        uniform vec3 uLuz;
        uniform vec3 uAmbiente;
        uniform vec3 uDirSol;
        uniform vec3 uVerdeBase;
        uniform vec3 uVerdePunta;
        uniform vec3 uAmarillo;
        varying vec3 vMundo;
        varying vec3 vNormal;
        varying float vCamino;
        ${ruidoGLSL}
        ${nieblaGLSL}
        void main() {
            float m = manchas(vMundo.xz);
            vec3 color = mix(mix(uVerdeBase, uVerdePunta, 0.35), mix(uVerdeBase, uAmarillo, 0.45), m * 0.7);
            color *= 0.6 + ruido(vMundo.xz * 0.7) * 0.2;
            vec3 tierra = vec3(0.32, 0.24, 0.16) * (0.8 + ruido(vMundo.xz * 2.0) * 0.3);
            color = mix(color, tierra, vCamino);
            float difusa = max(dot(normalize(vNormal), uDirSol), 0.0);
            color *= uAmbiente + uLuz * (0.35 + difusa * 0.65);
            color = aplicarNiebla(color, length(vMundo - cameraPosition));
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
});

const suelo = new THREE.Mesh(geometriaSuelo, materialSuelo);
escena.add(suelo);

// =====================================================================
// 10. PIEDRAS DEL CAMINO
// Losas planas e irregulares colocadas a lo largo del sendero.
// =====================================================================

function crearPiedrasCamino() {
    const losa = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true });
    const posiciones = [];
    const paso = 0.62;

    for (let s = 0; s < largoCamino; s += paso) {
        const t = s / largoCamino;
        const punto = camino.getPointAt(t);
        const tangente = camino.getTangentAt(t);
        const lateral = new THREE.Vector3(-tangente.z, 0, tangente.x);
        const columnas = azar() < 0.5 ? [-0.55, 0.55] : [-0.75, 0, 0.75];
        columnas.forEach((c) => {
            if (azar() < 0.1) return;
            const p = punto.clone().addScaledVector(lateral, c + entre(-0.12, 0.12)).addScaledVector(tangente, entre(-0.15, 0.15));
            posiciones.push({ p, giro: Math.atan2(tangente.x, tangente.z) + entre(-0.4, 0.4) });
        });
    }

    const piedras = new THREE.InstancedMesh(losa, material, posiciones.length);
    const ayudante = new THREE.Object3D();
    const color = new THREE.Color();
    posiciones.forEach(({ p, giro }, i) => {
        ayudante.position.set(p.x, alturaTerreno(p.x, p.z) + 0.02, p.z);
        ayudante.rotation.set(entre(-0.06, 0.06), giro, entre(-0.06, 0.06));
        ayudante.scale.set(entre(0.26, 0.36), entre(0.05, 0.08), entre(0.22, 0.32));
        ayudante.updateMatrix();
        piedras.setMatrixAt(i, ayudante.matrix);
        const gris = entre(0.5, 0.72);
        piedras.setColorAt(i, color.setRGB(gris * 1.05, gris, gris * 0.92));
    });
    escena.add(piedras);
}

crearPiedrasCamino();

// =====================================================================
// 11. HIERBA
// Cada brizna es un plano estrecho que se dibuja miles de veces con
// "instancing". Cada copia tiene su posición, giro, altura y anchura.
// El viento, el ratón y la luz se calculan en el shader.
// =====================================================================

const vertexHierba = `
    attribute vec3 aPosicion;
    attribute float aAngulo;
    attribute float aAlto;
    attribute float aAncho;
    attribute float aAzar;

    uniform float uTiempo;
    uniform vec2 uRaton;
    uniform float uFuerzaRaton;
    uniform vec2 uViento;
    uniform float uFuerzaViento;

    varying float vAlturaBrizna;
    varying float vAzar;
    varying float vMancha;
    varying float vRafaga;
    varying float vMata;
    varying vec3 vMundo;
    varying vec3 vNormal;

    ${ruidoGLSL}

    void main() {
        float y = position.y;
        float ancho = aAncho * pow(1.0 - y, 0.7);
        float curvatura = 0.15 + aAzar * 0.4;
        vec3 local = vec3(position.x * ancho, y * aAlto, curvatura * y * y * aAlto);
        vec3 normalLocal = normalize(vec3(0.0, -2.0 * curvatura * y, 1.0));

        float c = cos(aAngulo);
        float s = sin(aAngulo);
        vec3 mundo = aPosicion + vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);
        vNormal = vec3(normalLocal.x * c - normalLocal.z * s, normalLocal.y, normalLocal.x * s + normalLocal.z * c);

        float curva = y * y;

        float rafaga = fbm(aPosicion.xz * 0.05 - uViento * uTiempo * 0.75);
        float ola = sin(dot(aPosicion.xz, uViento) * 0.32 - uTiempo * 2.0 + aAzar * 1.3);
        float viento = (0.12 + rafaga * rafaga * 1.3) * (0.6 + 0.4 * ola) * uFuerzaViento;
        mundo.xz += uViento * viento * curva * aAlto;
        mundo.y -= viento * viento * 0.22 * curva * aAlto;
        mundo.x += sin(uTiempo * 5.0 + aAzar * 25.0) * 0.008 * curva * uFuerzaViento;

        vec2 alejar = aPosicion.xz - uRaton;
        float distancia = length(alejar);
        float empuje = (1.0 - smoothstep(0.0, 1.6, distancia)) * uFuerzaRaton;
        mundo.xz += normalize(alejar + 0.0001) * empuje * curva * aAlto * 1.8;
        mundo.y -= empuje * curva * aAlto * 0.75;

        vAlturaBrizna = y;
        vAzar = aAzar;
        vMancha = manchas(aPosicion.xz);
        vRafaga = rafaga;
        vMata = ruido(aPosicion.xz * 0.9) * 0.6 + ruido(aPosicion.xz * 0.23 + 5.0) * 0.4;
        vMundo = mundo;

        gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
    }
`;

const fragmentHierba = `
    uniform vec3 uNiebla;
    uniform vec3 uLuz;
    uniform vec3 uAmbiente;
    uniform vec3 uDirSol;
    uniform vec3 uVerdeBase;
    uniform vec3 uVerdePunta;
    uniform vec3 uAmarillo;
    uniform float uTranslucidez;

    varying float vAlturaBrizna;
    varying float vAzar;
    varying float vMancha;
    varying float vRafaga;
    varying float vMata;
    varying vec3 vMundo;
    varying vec3 vNormal;

    ${nieblaGLSL}

    void main() {
        vec3 punta = mix(uVerdePunta, uAmarillo, vMancha * 0.7);
        punta *= 0.62 + vAzar * 0.5;
        punta *= mix(0.55, 1.1, smoothstep(0.25, 0.75, vMata));
        punta = mix(punta, punta * vec3(0.85, 1.0, 0.92), step(0.7, vAzar));
        vec3 color = mix(uVerdeBase, punta, smoothstep(0.0, 0.95, vAlturaBrizna));
        color *= mix(0.3, 1.0, smoothstep(0.0, 0.6, vAlturaBrizna));

        vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
        normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.45));
        float difusa = max(dot(normal, uDirSol), 0.0);
        color *= uAmbiente * 1.3 + uLuz * (0.25 + 0.75 * difusa) * (0.45 + 0.55 * vAlturaBrizna);

        vec3 vista = normalize(vMundo - cameraPosition);
        float brilloLuz = pow(max(dot(reflect(-uDirSol, normal), -vista), 0.0), 14.0);
        color += uLuz * brilloLuz * 0.12 * vAlturaBrizna;

        float contraluz = pow(max(dot(vista, uDirSol), 0.0), 6.0);
        color += uLuz * punta * contraluz * uTranslucidez * vAlturaBrizna * vAlturaBrizna * 0.45;
        color *= 1.0 + vRafaga * 0.08;

        color = aplicarNiebla(color, length(vMundo - cameraPosition));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const materialHierba = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: comunes,
    vertexShader: vertexHierba,
    fragmentShader: fragmentHierba
});

// La hierba se reparte alrededor del camino: más densa cerca y más
// clara lejos. En el propio camino no crece.
function crearHierba(cantidad, segmentos, distanciaMin, distanciaMax, potencia, alto, ancho) {
    const brizna = new THREE.PlaneGeometry(1, 1, 1, segmentos);
    brizna.translate(0, 0.5, 0);

    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = brizna.index;
    geometria.setAttribute("position", brizna.attributes.position);
    geometria.setAttribute("uv", brizna.attributes.uv);

    const posiciones = new Float32Array(cantidad * 3);
    const angulos = new Float32Array(cantidad);
    const altos = new Float32Array(cantidad);
    const anchos = new Float32Array(cantidad);
    const azares = new Float32Array(cantidad);

    for (let i = 0; i < cantidad; i++) {
        const t = Math.min(1, entre(-0.02, 1.06));
        const punto = camino.getPointAt(Math.max(0, t));
        const tangente = camino.getTangentAt(Math.max(0, t));
        const lado = azar() < 0.5 ? -1 : 1;
        const distancia = distanciaMin + Math.pow(azar(), potencia) * (distanciaMax - distanciaMin);
        let x = punto.x - tangente.z * distancia * lado;
        let z = punto.z + tangente.x * distancia * lado;
        if (t > 1) z -= (t - 1) * 120;

        posiciones[i * 3] = x;
        posiciones[i * 3 + 1] = alturaTerreno(x, z) - 0.02;
        posiciones[i * 3 + 2] = z;
        angulos[i] = azar() * Math.PI * 2;
        altos[i] = entre(alto[0], alto[1]);
        anchos[i] = entre(ancho[0], ancho[1]);
        azares[i] = azar();
    }

    geometria.setAttribute("aPosicion", new THREE.InstancedBufferAttribute(posiciones, 3));
    geometria.setAttribute("aAngulo", new THREE.InstancedBufferAttribute(angulos, 1));
    geometria.setAttribute("aAlto", new THREE.InstancedBufferAttribute(altos, 1));
    geometria.setAttribute("aAncho", new THREE.InstancedBufferAttribute(anchos, 1));
    geometria.setAttribute("aAzar", new THREE.InstancedBufferAttribute(azares, 1));
    geometria.instanceCount = cantidad;

    const malla = new THREE.Mesh(geometria, materialHierba);
    malla.frustumCulled = false;
    escena.add(malla);
    return geometria;
}

const hierbaCamino = crearHierba(ajustes.hierbaCamino, 4, 1.25, 7, 1.4, [0.22, 0.48], [0.026, 0.045]);
const hierbaPrado = crearHierba(ajustes.hierbaPrado, 2, 7, 42, 1.6, [0.3, 0.6], [0.05, 0.08]);

// =====================================================================
// 12. FLORES
// Pocas y agrupadas en rodales. Cada flor es un cuadrado que siempre
// mira a la cámara; los pétalos se dibujan con matemáticas.
// =====================================================================

const coloresFlor = ["#e0473f", "#4a6fd8", "#f2c84b", "#f6f1e4", "#e6779e"].map((c) => new THREE.Color(c));

function crearFlores() {
    const datos = [];
    for (let r = 0; r < ajustes.rodalesFlores; r++) {
        const t = entre(0.0, 0.95);
        const punto = camino.getPointAt(t);
        const tangente = camino.getTangentAt(t);
        const lado = azar() < 0.5 ? -1 : 1;
        const distancia = entre(2, 12);
        const cx = punto.x - tangente.z * distancia * lado;
        const cz = punto.z + tangente.x * distancia * lado;
        const color = coloresFlor[Math.floor(azar() * coloresFlor.length)];
        const cuantas = Math.floor(entre(5, 14));
        for (let f = 0; f < cuantas; f++) {
            const x = cx + entre(-1.3, 1.3);
            const z = cz + entre(-1.3, 1.3);
            if (distanciaAlCamino(x, z) < 1.3) continue;
            datos.push({ x, z, color });
        }
    }

    const cuadro = new THREE.PlaneGeometry(1, 1);
    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = cuadro.index;
    geometria.setAttribute("position", cuadro.attributes.position);
    geometria.setAttribute("uv", cuadro.attributes.uv);

    const n = datos.length;
    const posiciones = new Float32Array(n * 3);
    const altos = new Float32Array(n);
    const tamanos = new Float32Array(n);
    const colores = new Float32Array(n * 3);
    const azares = new Float32Array(n);

    datos.forEach(({ x, z, color }, i) => {
        posiciones[i * 3] = x;
        posiciones[i * 3 + 1] = alturaTerreno(x, z);
        posiciones[i * 3 + 2] = z;
        altos[i] = entre(0.3, 0.52);
        tamanos[i] = entre(0.07, 0.11);
        colores[i * 3] = color.r;
        colores[i * 3 + 1] = color.g;
        colores[i * 3 + 2] = color.b;
        azares[i] = azar();
    });

    geometria.setAttribute("aPosicion", new THREE.InstancedBufferAttribute(posiciones, 3));
    geometria.setAttribute("aAlto", new THREE.InstancedBufferAttribute(altos, 1));
    geometria.setAttribute("aTamano", new THREE.InstancedBufferAttribute(tamanos, 1));
    geometria.setAttribute("aColor", new THREE.InstancedBufferAttribute(colores, 3));
    geometria.setAttribute("aAzar", new THREE.InstancedBufferAttribute(azares, 1));
    geometria.instanceCount = n;

    const material = new THREE.ShaderMaterial({
        uniforms: comunes,
        vertexShader: `
            attribute vec3 aPosicion;
            attribute float aAlto;
            attribute float aTamano;
            attribute vec3 aColor;
            attribute float aAzar;

            uniform float uTiempo;
            uniform vec2 uRaton;
            uniform float uFuerzaRaton;
            uniform vec2 uViento;
            uniform float uFuerzaViento;

            varying vec2 vUv;
            varying vec3 vColor;
            varying vec3 vMundo;
            varying float vAzar;

            ${ruidoGLSL}

            void main() {
                vec3 centro = aPosicion + vec3(0.0, aAlto, 0.0);

                float rafaga = fbm(aPosicion.xz * 0.05 - uViento * uTiempo * 0.75);
                float ola = sin(dot(aPosicion.xz, uViento) * 0.32 - uTiempo * 2.0 + aAzar * 1.3);
                float viento = (0.12 + rafaga * rafaga * 1.3) * (0.6 + 0.4 * ola) * uFuerzaViento;
                centro.xz += uViento * viento * aAlto * 0.8;

                vec2 alejar = aPosicion.xz - uRaton;
                float empuje = (1.0 - smoothstep(0.0, 1.6, length(alejar))) * uFuerzaRaton;
                centro.xz += normalize(alejar + 0.0001) * empuje * aAlto * 1.4;
                centro.y -= empuje * aAlto * 0.55;

                vec3 derecha = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                vec3 arriba = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                vec3 mundo = centro + (derecha * position.x + arriba * position.y) * aTamano;

                vUv = uv;
                vColor = aColor;
                vMundo = mundo;
                vAzar = aAzar;
                gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uNiebla;
            uniform vec3 uLuz;
            uniform vec3 uAmbiente;

            varying vec2 vUv;
            varying vec3 vColor;
            varying vec3 vMundo;
            varying float vAzar;

            ${nieblaGLSL}

            void main() {
                vec2 p = vUv - 0.5;
                float r = length(p) * 2.0;
                float angulo = atan(p.y, p.x) + vAzar * 6.28;
                float borde = 0.62 + 0.38 * abs(cos(angulo * 2.5));
                if (r > borde) discard;

                vec3 color = mix(vColor, vColor * 0.7, smoothstep(0.2, borde, r));
                color = mix(vec3(0.98, 0.82, 0.3), color, smoothstep(0.16, 0.24, r));
                color *= uAmbiente + uLuz * 0.85;
                color = aplicarNiebla(color, length(vMundo - cameraPosition));
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });

    const malla = new THREE.Mesh(geometria, material);
    malla.frustumCulled = false;
    escena.add(malla);
}

crearFlores();

// =====================================================================
// 13. PINOS
// Tres conos apilados y un tronco, repetidos con "instancing".
// =====================================================================

function crearArboles() {
    const copa = mergeGeometries([
        new THREE.ConeGeometry(1.0, 1.6, 7).translate(0, 1.6, 0),
        new THREE.ConeGeometry(0.8, 1.4, 7).translate(0, 2.4, 0),
        new THREE.ConeGeometry(0.55, 1.2, 7).translate(0, 3.15, 0)
    ]);
    const tronco = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6).translate(0, 0.6, 0);

    const lugares = [];
    let intentos = 0;
    while (lugares.length < ajustes.arboles && intentos < 20000) {
        intentos++;
        let x;
        let z;
        if (azar() < 0.45) {
            const angulo = entre(0, Math.PI * 2);
            const radio = entre(9, 26);
            x = castillo.x + Math.cos(angulo) * radio;
            z = castillo.z + Math.sin(angulo) * radio;
        } else {
            x = entre(-70, 70);
            z = entre(-150, -15);
        }
        if (distanciaAlCamino(x, z) < 10) continue;
        if (z > -28) continue;
        if (Math.abs(x) < 14 && z > -55) continue;
        const dx = x - castillo.x;
        const dz = z - castillo.z;
        if (dx * dx + dz * dz < 64) continue;
        if (dz > 0 && Math.abs(dx) < 7) continue;
        lugares.push({ x, z, escala: entre(1.2, 2.6) });
    }

    const materialCopa = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true });
    const materialTronco = new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 });
    const copas = new THREE.InstancedMesh(copa, materialCopa, lugares.length);
    const troncos = new THREE.InstancedMesh(tronco, materialTronco, lugares.length);
    const ayudante = new THREE.Object3D();
    const color = new THREE.Color();

    lugares.forEach(({ x, z, escala }, i) => {
        ayudante.position.set(x, alturaTerreno(x, z) - 0.1, z);
        ayudante.rotation.set(0, entre(0, Math.PI * 2), 0);
        ayudante.scale.set(escala * entre(0.85, 1.1), escala, escala * entre(0.85, 1.1));
        ayudante.updateMatrix();
        copas.setMatrixAt(i, ayudante.matrix);
        troncos.setMatrixAt(i, ayudante.matrix);
        copas.setColorAt(i, color.setHSL(entre(0.3, 0.38), entre(0.35, 0.5), entre(0.17, 0.26)));
    });

    escena.add(copas, troncos);
}

crearArboles();

// =====================================================================
// 14. EL CASTILLO
// Hecho con piezas sencillas: cajas, cilindros y conos. Las ventanas
// son planos que de noche brillan (y el "bloom" les da el resplandor).
// =====================================================================

const castilloGrupo = new THREE.Group();
const materialVentanas = new THREE.MeshBasicMaterial({ color: "#1c1a22", fog: true, toneMapped: true });
const luzCastillo = new THREE.PointLight("#ffb766", 0, 60, 1.6);

const baseCastillo = alturaTerreno(castillo.x, castillo.z) - 0.6;

function crearCastillo() {
    const piedra = new THREE.MeshStandardMaterial({ color: "#7d706c", roughness: 0.95, flatShading: true });
    const piedraOscura = new THREE.MeshStandardMaterial({ color: "#5f5452", roughness: 0.95, flatShading: true });
    const tejado = new THREE.MeshStandardMaterial({ color: "#363c5a", roughness: 0.8, flatShading: true });
    const puerta = new THREE.MeshStandardMaterial({ color: "#1d1512", roughness: 1 });
    const bandera = new THREE.MeshStandardMaterial({ color: "#b53a2e", side: THREE.DoubleSide, roughness: 0.9 });

    const ventanas = [];
    const almenas = [];

    function torre(x, z, radio, alto, altoTejado, base = 0) {
        const cimiento = base === 0 ? 7 : 0;
        const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio * 1.08, alto + cimiento, 10), piedra);
        cuerpo.position.set(x, base + (alto - cimiento) / 2, z);
        const borde = new THREE.Mesh(new THREE.CylinderGeometry(radio * 1.18, radio * 1.18, 0.35, 10), piedraOscura);
        borde.position.set(x, base + alto, z);
        const techo = new THREE.Mesh(new THREE.ConeGeometry(radio * 1.3, altoTejado, 10), tejado);
        techo.position.set(x, base + alto + altoTejado / 2 + 0.15, z);
        castilloGrupo.add(cuerpo, borde, techo);

        const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), piedraOscura);
        mastil.position.set(x, base + alto + altoTejado + 0.7, z);
        const tela = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), bandera);
        tela.position.set(x + 0.45, base + alto + altoTejado + 1.15, z);
        castilloGrupo.add(mastil, tela);
        banderas.push(tela);

        const pisos = Math.max(1, Math.floor(alto / 2.6));
        for (let p = 0; p < pisos; p++) {
            const y = base + 1.6 + p * 2.6;
            if (y > base + alto - 0.8) break;
            for (let a = -1; a <= 1; a++) {
                const angulo = a * 0.7 + entre(-0.1, 0.1);
                ventanas.push({
                    x: x + Math.sin(angulo) * (radio + 0.02),
                    y,
                    z: z + Math.cos(angulo) * (radio + 0.02),
                    giro: angulo,
                    ancho: 0.32,
                    alto: 0.6
                });
            }
        }
    }

    function muro(x1, z1, x2, z2, alto) {
        const largo = Math.hypot(x2 - x1, z2 - z1);
        const angulo = Math.atan2(x2 - x1, z2 - z1);
        const pared = new THREE.Mesh(new THREE.BoxGeometry(0.9, alto + 7, largo), piedraOscura);
        pared.position.set((x1 + x2) / 2, (alto - 7) / 2, (z1 + z2) / 2);
        pared.rotation.y = angulo;
        castilloGrupo.add(pared);
        const cuantas = Math.floor(largo / 0.9);
        for (let i = 0; i < cuantas; i += 2) {
            const t = (i + 0.5) / cuantas;
            almenas.push({ x: x1 + (x2 - x1) * t, y: alto + 0.25, z: z1 + (z2 - z1) * t, giro: angulo });
        }
    }

    const esquinas = [[-7, 6], [7, 6], [8, -5], [0, -9], [-8, -5]];
    for (let i = 0; i < esquinas.length; i++) {
        const [x1, z1] = esquinas[i];
        const [x2, z2] = esquinas[(i + 1) % esquinas.length];
        muro(x1, z1, x2, z2, 4.2);
        torre(x1, z1, 1.15, 6.5, 3.2);
    }

    const homenaje = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 5.5), piedra);
    homenaje.position.set(0, 5, -1.5);
    const homenajeAlto = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 3.8), piedra);
    homenajeAlto.position.set(0, 12.5, -1.5);
    const tejadoHomenaje = new THREE.Mesh(new THREE.ConeGeometry(3.4, 4.5, 4), tejado);
    tejadoHomenaje.position.set(0, 17.2, -1.5);
    tejadoHomenaje.rotation.y = Math.PI / 4;
    castilloGrupo.add(homenaje, homenajeAlto, tejadoHomenaje);

    for (let piso = 0; piso < 3; piso++) {
        for (let c = -1; c <= 1; c++) {
            ventanas.push({ x: c * 1.6, y: 2.2 + piso * 2.8, z: 1.27, giro: 0, ancho: 0.5, alto: 0.9 });
        }
    }
    ventanas.push({ x: -0.9, y: 12.8, z: 0.42, giro: 0, ancho: 0.45, alto: 0.8 });
    ventanas.push({ x: 0.9, y: 12.8, z: 0.42, giro: 0, ancho: 0.45, alto: 0.8 });

    torre(-2.6, -3.6, 0.8, 8, 3.4, 10);
    torre(2.6, -3.6, 0.8, 8, 3.4, 10);
    torre(0, -2.2, 1.1, 10, 5.5, 13);
    torre(3.4, 1.2, 0.6, 3, 2.4, 10);
    torre(-3.4, 1.2, 0.6, 3, 2.4, 10);

    const arco = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.3), puerta);
    arco.position.set(0, 1.3, 6.2);
    castilloGrupo.add(arco);

    const geometriaVentana = new THREE.PlaneGeometry(1, 1);
    const mallaVentanas = new THREE.InstancedMesh(geometriaVentana, materialVentanas, ventanas.length);
    const ayudante = new THREE.Object3D();
    ventanas.forEach((v, i) => {
        ayudante.position.set(v.x, v.y, v.z);
        ayudante.rotation.set(0, v.giro, 0);
        ayudante.scale.set(v.ancho, v.alto, 1);
        ayudante.updateMatrix();
        mallaVentanas.setMatrixAt(i, ayudante.matrix);
    });
    castilloGrupo.add(mallaVentanas);

    const mallaAlmenas = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.5, 0.55), piedraOscura, almenas.length);
    almenas.forEach((a, i) => {
        ayudante.position.set(a.x, a.y, a.z);
        ayudante.rotation.set(0, a.giro, 0);
        ayudante.scale.set(1, 1, 1);
        ayudante.updateMatrix();
        mallaAlmenas.setMatrixAt(i, ayudante.matrix);
    });
    castilloGrupo.add(mallaAlmenas);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 13, 9, 9), new THREE.MeshStandardMaterial({ color: "#5d5650", roughness: 1, flatShading: true }));
    base.position.y = -4.9;
    castilloGrupo.add(base);

    const rocas = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 14; i++) {
        const angulo = (i / 14) * Math.PI * 2;
        const roca = new THREE.Mesh(rocas, piedraOscura);
        const rx = Math.cos(angulo) * 8.5;
        const rz = Math.sin(angulo) * 7.5;
        const sueloRoca = (alturaTerreno(castillo.x + rx * 1.15, castillo.z + rz * 1.15) - baseCastillo) / 1.15;
        roca.position.set(rx, sueloRoca - 0.4, rz);
        roca.scale.set(entre(1.2, 2), entre(0.9, 1.5), entre(1.2, 2));
        roca.rotation.set(entre(0, 3), entre(0, 3), 0);
        castilloGrupo.add(roca);
    }

    luzCastillo.position.set(0, 8, 9);
    castilloGrupo.add(luzCastillo);

    castilloGrupo.position.set(castillo.x, baseCastillo, castillo.z);
    castilloGrupo.scale.setScalar(1.15);
    escena.add(castilloGrupo);
}

const banderas = [];
crearCastillo();

// =====================================================================
// 15. LUCIÉRNAGAS
// =====================================================================

function texturaBrillo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 64;
    lienzo.height = 64;
    const ctx = lienzo.getContext("2d");
    const degradado = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    degradado.addColorStop(0, "rgba(240, 255, 170, 1)");
    degradado.addColorStop(0.2, "rgba(220, 255, 120, 0.8)");
    degradado.addColorStop(1, "rgba(200, 255, 100, 0)");
    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(lienzo);
}

const luciernagas = [];
for (let i = 0; i < ajustes.luciernagas; i++) {
    const t = entre(0, 1);
    const punto = camino.getPointAt(t);
    const x = punto.x + entre(-9, 9);
    const z = punto.z + entre(-3, 3);
    luciernagas.push({ x, z, y: alturaTerreno(x, z) + entre(0.4, 2.2), fase: entre(0, 6.28), velocidad: entre(0.5, 1.3) });
}
const geometriaLuciernagas = new THREE.BufferGeometry();
geometriaLuciernagas.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(luciernagas.length * 3), 3));
const materialLuciernagas = new THREE.PointsMaterial({
    map: texturaBrillo(),
    color: new THREE.Color(2.5, 2.5, 2.5),
    size: 0.18,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const puntosLuciernagas = new THREE.Points(geometriaLuciernagas, materialLuciernagas);
puntosLuciernagas.frustumCulled = false;
escena.add(puntosLuciernagas);

function moverLuciernagas(tiempo, brillo) {
    const posiciones = geometriaLuciernagas.attributes.position;
    luciernagas.forEach((l, i) => {
        const t = tiempo * l.velocidad + l.fase;
        posiciones.setXYZ(i, l.x + Math.sin(t * 0.5) * 1.3, l.y + Math.sin(t * 1.1) * 0.35, l.z + Math.cos(t * 0.4) * 1.3);
    });
    posiciones.needsUpdate = true;
    materialLuciernagas.opacity = brillo * (0.75 + Math.sin(tiempo * 3) * 0.25);
}

// =====================================================================
// 16. POSTPROCESADO
// 1) la escena se dibuja en una textura que también guarda la
//    profundidad; 2) el pase DOF desenfoca según la distancia;
// 3) el "bloom" hace brillar lo más luminoso; 4) se pasa a pantalla.
// =====================================================================

function tamanoReal() {
    return new THREE.Vector2(window.innerWidth * renderizador.getPixelRatio(), window.innerHeight * renderizador.getPixelRatio());
}

let tamano = tamanoReal();
const destinoEscena = new THREE.WebGLRenderTarget(tamano.x, tamano.y, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture: new THREE.DepthTexture(tamano.x, tamano.y)
});

const compositor = new EffectComposer(renderizador);
compositor.setPixelRatio(renderizador.getPixelRatio());
compositor.setSize(window.innerWidth, window.innerHeight);
compositor.addPass(new TexturePass(destinoEscena.texture));

const paseDesenfoque = new ShaderPass({
    uniforms: {
        tDiffuse: { value: null },
        tProfundidad: { value: destinoEscena.depthTexture },
        uResolucion: { value: tamano.clone() },
        uCerca: { value: camara.near },
        uLejos: { value: camara.far },
        uFoco: { value: 7 },
        uRadio: { value: movil ? 6 : 11 }
    },
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
        uniform vec2 uResolucion;
        uniform float uCerca;
        uniform float uLejos;
        uniform float uFoco;
        uniform float uRadio;
        varying vec2 vUv;

        float distanciaEn(vec2 uv) {
            float z = texture2D(tProfundidad, uv).x * 2.0 - 1.0;
            return 2.0 * uCerca * uLejos / (uLejos + uCerca - z * (uLejos - uCerca));
        }

        float desenfoqueEn(float d) {
            if (d < uFoco) return clamp((uFoco - d) / uFoco * 1.3, 0.0, 1.0);
            return clamp((d - uFoco) / d * 0.38, 0.0, 0.38);
        }

        void main() {
            float centro = desenfoqueEn(distanciaEn(vUv));
            vec4 suma = texture2D(tDiffuse, vUv);
            float pesos = 1.0;
            float radio = centro * uRadio;
            for (int i = 0; i < 28; i++) {
                float f = float(i);
                float r = sqrt((f + 0.5) / 28.0) * radio;
                float a = f * 2.39996;
                vec2 desvio = vec2(cos(a), sin(a)) * r / uResolucion;
                vec2 uv = vUv + desvio;
                float suyo = desenfoqueEn(distanciaEn(uv));
                float peso = smoothstep(0.0, 1.0, suyo * uRadio - r + 1.0);
                peso = max(peso, 0.15 * step(r, radio));
                suma += texture2D(tDiffuse, uv) * peso;
                pesos += peso;
            }
            gl_FragColor = suma / pesos;
        }
    `
});
paseDesenfoque.enabled = false;
compositor.addPass(paseDesenfoque);

const paseBrillo = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.55, 0.9);
compositor.addPass(paseBrillo);
compositor.addPass(new OutputPass());

// =====================================================================
// 17. CAMINAR POR EL CAMINO
// La posición en el camino va de 0 (inicio) a 1 (pie del castillo).
// La rueda, el dedo, el teclado o el botón "Caminar" la cambian.
// =====================================================================

let avance = 0;
let avanceObjetivo = 0;
let caminandoSolo = false;
const velocidadSola = 0.011;
const botonCaminar = document.getElementById("boton-caminar");
const relleno = document.getElementById("relleno");
const pista = document.getElementById("pista");

if (movil) pista.textContent = "Desliza hacia arriba para caminar";

function moverAvance(cantidad) {
    avanceObjetivo = Math.min(1, Math.max(0, avanceObjetivo + cantidad));
    pista.classList.add("oculta");
}

window.addEventListener("wheel", (evento) => {
    evento.preventDefault();
    caminandoSolo = false;
    botonCaminar.classList.remove("activo");
    moverAvance(evento.deltaY * 0.00022);
}, { passive: false });

window.addEventListener("keydown", (evento) => {
    if (["ArrowUp", "w", "W"].includes(evento.key)) moverAvance(0.02);
    if (["ArrowDown", "s", "S"].includes(evento.key)) moverAvance(-0.02);
});

botonCaminar.addEventListener("click", () => {
    if (avanceObjetivo >= 0.999) avanceObjetivo = 0;
    caminandoSolo = !caminandoSolo;
    botonCaminar.classList.toggle("activo", caminandoSolo);
    pista.classList.add("oculta");
});

const posicionCamara = new THREE.Vector3();
const miradaCamara = new THREE.Vector3();
const cimaCastillo = new THREE.Vector3(castillo.x, alturaTerreno(castillo.x, castillo.z) + 12, castillo.z);

function colocarCamara(paralaje) {
    const t = Math.min(avance, 1);
    const punto = camino.getPointAt(t);
    const delante = camino.getPointAt(Math.min(1, t + 0.05));
    const balanceo = Math.sin(t * largoCamino * 2.2) * 0.025 * Math.min(1, Math.abs(avanceObjetivo - avance) * 60);

    posicionCamara.set(punto.x + paralaje.x * 0.6, alturaTerreno(punto.x, punto.z) + 1.55 + balanceo + paralaje.y * 0.15, punto.z);

    miradaCamara.set(delante.x, alturaTerreno(delante.x, delante.z) + 1.3, delante.z);
    const haciaCastillo = 0.5 + 0.15 * t;
    miradaCamara.lerp(cimaCastillo, haciaCastillo);
    miradaCamara.x += paralaje.x * 6;
    miradaCamara.y += paralaje.y * 3;

    camara.position.copy(posicionCamara);
    camara.lookAt(miradaCamara);

    paseDesenfoque.uniforms.uFoco.value = 6 + t * 30;
}

// =====================================================================
// 18. RATÓN Y DEDO
// =====================================================================

const rayo = new THREE.Raycaster();
const puntero = new THREE.Vector2();
const objetivoRaton = new THREE.Vector2(999, 999);
const paralaje = new THREE.Vector2();
let punteroDentro = false;
let punteroMovido = false;
let dedoY = null;

function cortarTerreno(origen, direccion) {
    const punto = new THREE.Vector3();
    for (let distancia = 0.3; distancia < 60; distancia += distancia < 12 ? 0.08 : 0.4) {
        punto.copy(direccion).multiplyScalar(distancia).add(origen);
        if (punto.y <= alturaTerreno(punto.x, punto.z) + 0.25) return punto;
    }
    return null;
}

function moverPuntero(evento) {
    puntero.x = (evento.clientX / window.innerWidth) * 2 - 1;
    puntero.y = -(evento.clientY / window.innerHeight) * 2 + 1;
    punteroDentro = true;
    punteroMovido = true;

    if (evento.pointerType === "touch" && dedoY !== null) {
        moverAvance((dedoY - evento.clientY) * 0.0006);
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
    if (punteroMovido) {
        rayo.setFromCamera(puntero, camara);
        const punto = cortarTerreno(rayo.ray.origin, rayo.ray.direction);
        if (punto) objetivoRaton.set(punto.x, punto.z);
        punteroMovido = false;
    }

    const actualRaton = comunes.uRaton.value;
    if (actualRaton.x > 900) actualRaton.copy(objetivoRaton);
    else actualRaton.lerp(objetivoRaton, Math.min(1, delta * 12));

    const fuerzaObjetivo = punteroDentro && objetivoRaton.x < 900 ? 1 : 0;
    comunes.uFuerzaRaton.value += (fuerzaObjetivo - comunes.uFuerzaRaton.value) * Math.min(1, delta * 4);

    const paralajeObjetivo = punteroDentro && !movil ? puntero : new THREE.Vector2();
    paralaje.lerp(paralajeObjetivo, Math.min(1, delta * 2.5));
}

// =====================================================================
// 19. BOTONES: MOMENTO DEL DÍA Y DOF
// =====================================================================

const botonesMomento = document.querySelectorAll("#momentos button");
const momentoPedido = parametros.get("momento");
const momentoInicial = momentos[momentoPedido] ? momentoPedido : "atardecer";
const momentoDesde = prepararMomento({ ...momentos.atardecer, ...Object.fromEntries(nombresColor.map((n) => [n, "#000000"])), dirSol: [0, 1, 0], dirDisco: [0, 1, 0] });
let momentoHasta = momentos[momentoInicial];
let progreso = 1;

copiarMomento(momentoDesde, momentoHasta);
copiarMomento(actual, momentoHasta);
botonesMomento.forEach((b) => b.classList.toggle("activo", b.dataset.momento === momentoInicial));

function cambiarMomento(nombre) {
    copiarMomento(momentoDesde, actual);
    momentoHasta = momentos[nombre];
    progreso = 0;
    botonesMomento.forEach((b) => b.classList.toggle("activo", b.dataset.momento === nombre));
}

botonesMomento.forEach((boton) => boton.addEventListener("click", () => cambiarMomento(boton.dataset.momento)));

const botonDof = document.getElementById("boton-dof");
function cambiarDof(activo) {
    paseDesenfoque.enabled = activo;
    botonDof.classList.toggle("activo", activo);
}
botonDof.addEventListener("click", () => cambiarDof(!paseDesenfoque.enabled));
if (parametros.get("dof") === "si") cambiarDof(true);

function suavizar(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const direccionLuz = new THREE.Vector3();
const colorVentanaApagada = new THREE.Color("#1c1a22");
const colorVentanaEncendida = new THREE.Color("#ffb45c").multiplyScalar(5);

function aplicarMomento() {
    comunes.uLuz.value.copy(actual.luz).multiplyScalar(actual.intensidad);
    comunes.uTranslucidez.value = actual.translucidez;

    const u = materialCielo.uniforms;
    u.uNubes.value = actual.nubes;
    u.uSolVisible.value = actual.solVisible;
    u.uLunaVisible.value = actual.noche;
    u.uDirLuna.value.set(pantallaEstrecha ? -0.21 : -0.38, actual.alturaLuna, -0.87).normalize();

    materialEstrellas.opacity = Math.max(0, actual.noche * 1.25 - 0.25);
    escena.fog.color.copy(actual.niebla);

    luzSol.color.copy(actual.luz);
    luzSol.intensity = 2.2 * actual.intensidad;
    direccionLuz.set(actual.dirSol.x, Math.max(actual.dirSol.y, 0.35), 0.45).normalize();
    luzSol.position.copy(direccionLuz).multiplyScalar(100).add(camara.position);
    luzSol.target.position.copy(camara.position);
    luzCielo.color.copy(actual.horizonte);
    luzCielo.groundColor.copy(actual.verdeBase);
    luzCielo.intensity = 0.6 + actual.intensidad * 0.9;

    materialVentanas.color.lerpColors(colorVentanaApagada, colorVentanaEncendida, Math.pow(actual.noche, 1.5));
    luzCastillo.intensity = actual.noche * 35;

    paseBrillo.strength = actual.brillo;
    renderizador.toneMappingExposure = 1.05 + actual.noche * 0.25;
}

// =====================================================================
// 20. RENDIMIENTO
// Si los primeros segundos van lentos, se quita hierba y se baja la
// resolución.
// =====================================================================

let fotogramas = 0;
let tiempoMedido = 0;
let calidadRevisada = false;

function revisarCalidad(delta) {
    if (calidadRevisada) return;
    fotogramas++;
    tiempoMedido += delta;
    if (fotogramas < 90) return;

    const fps = fotogramas / tiempoMedido;
    if (fps < 40) {
        hierbaCamino.instanceCount = Math.floor(hierbaCamino.instanceCount * 0.6);
        hierbaPrado.instanceCount = Math.floor(hierbaPrado.instanceCount * 0.5);
        renderizador.setPixelRatio(1);
        ajustarTamano();
    }
    calidadRevisada = true;
}

// =====================================================================
// 21. TAMAÑO DE LA VENTANA
// =====================================================================

function ajustarTamano() {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(window.innerWidth, window.innerHeight);
    tamano = tamanoReal();
    destinoEscena.setSize(tamano.x, tamano.y);
    compositor.setPixelRatio(renderizador.getPixelRatio());
    compositor.setSize(window.innerWidth, window.innerHeight);
    paseDesenfoque.uniforms.uResolucion.value.copy(tamano);
}

window.addEventListener("resize", ajustarTamano);

// =====================================================================
// 22. BUCLE PRINCIPAL
// =====================================================================

const reloj = new THREE.Clock();
let tiempo = 0;
let primerFotograma = true;

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);

    if (!movimientoReducido) tiempo += delta;
    comunes.uTiempo.value = tiempo;

    if (progreso < 1) {
        progreso = Math.min(1, progreso + delta / 2.2);
        mezclarMomentos(actual, momentoDesde, momentoHasta, suavizar(progreso));
    }

    if (caminandoSolo) {
        avanceObjetivo = Math.min(1, avanceObjetivo + velocidadSola * delta);
        if (avanceObjetivo >= 1) {
            caminandoSolo = false;
            botonCaminar.classList.remove("activo");
        }
    }
    avance += (avanceObjetivo - avance) * Math.min(1, delta * 2.2);
    relleno.style.width = (avance * 100).toFixed(1) + "%";

    actualizarRaton(delta);
    colocarCamara(paralaje);
    aplicarMomento();

    banderas.forEach((b, i) => (b.rotation.y = Math.sin(tiempo * 3 + i) * 0.35));
    if (actual.noche > 0.02) moverLuciernagas(tiempo, actual.noche);
    else materialLuciernagas.opacity = 0;

    renderizador.setRenderTarget(destinoEscena);
    renderizador.render(escena, camara);
    renderizador.setRenderTarget(null);
    compositor.render(delta);

    revisarCalidad(delta);

    if (primerFotograma) {
        primerFotograma = false;
        document.getElementById("cargando").classList.add("oculta");
    }
}

animar();
