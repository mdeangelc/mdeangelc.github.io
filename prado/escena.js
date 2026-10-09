import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES GENERALES
// Opciones en la dirección:
//   ?calidad=baja  -> mucha menos hierba
//   ?fps=si        -> contador de fotogramas por segundo
//   ?tocar=no      -> la hierba no reacciona al ratón
//   ?momento=noche -> empezar de noche (o manana)
//   ?dof=si        -> empezar con el desenfoque activado
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = window.innerWidth < 760 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pantallaEstrecha = window.innerWidth < window.innerHeight;
const tocarHierba = parametros.get("tocar") !== "no";

const factorCalidad = (parametros.get("calidad") === "baja" ? 0.25 : 1) * (movil ? 0.4 : 1);

const ajustes = {
    hierbaCamino: Math.floor(110000 * factorCalidad),
    hierbaPrado: Math.floor(110000 * factorCalidad),
    rodalesFlores: Math.max(12, Math.floor(40 * Math.max(factorCalidad, 0.5))),
    luciernagas: movil ? 50 : 110,
    estrellas: 1800,
    pixeles: Math.min(window.devicePixelRatio, movil ? 1.25 : 1.5),
    tamanoTrozo: 14,
    distanciaHierba: 120
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

function suave(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

// =====================================================================
// 2. EL TERRENO Y EL CAMINO
// alturaTerreno() da la altura de cualquier punto del mundo.
// El castillo está sobre una colina con la cima plana, y el camino
// llega hasta su puerta. Tú solo recorres el primer tramo.
// =====================================================================

const castillo = { x: 0, z: -215 };

function alturaTerreno(x, z) {
    const ondas = 0.55 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.05 + 0.4)
                + 0.3 * Math.sin(x * 0.15 + z * 0.09);
    const laderas = 8 * suave(18, 55, Math.abs(x)) * (0.65 + 0.35 * Math.sin(z * 0.035 + x * 0.01));
    const rampa = 3 * suave(-30, -120, z);
    const dx = x - castillo.x;
    const dz = z - castillo.z;
    const radio = Math.sqrt(dx * dx + dz * dz);
    const colina = 26 * suave(40, 11, radio);
    const rocas = 1.6 * Math.sin(dx * 0.4) * Math.cos(dz * 0.35) * suave(40, 18, radio) * suave(8, 16, radio);
    return ondas + laderas + rampa + colina + rocas;
}

const camino = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 14),
    new THREE.Vector3(1.6, 0, 0),
    new THREE.Vector3(-2.4, 0, -14),
    new THREE.Vector3(1.4, 0, -30),
    new THREE.Vector3(4.2, 0, -46),
    new THREE.Vector3(0.5, 0, -62),
    new THREE.Vector3(-3.8, 0, -78),
    new THREE.Vector3(-1, 0, -96),
    new THREE.Vector3(5, 0, -116),
    new THREE.Vector3(1, 0, -136),
    new THREE.Vector3(-7, 0, -152),
    new THREE.Vector3(-3, 0, -168),
    new THREE.Vector3(6, 0, -180),
    new THREE.Vector3(3, 0, -193),
    new THREE.Vector3(0, 0, -202)
], false, "catmullrom", 0.5);

const largoCamino = camino.getLength();
const puntosCamino = camino.getSpacedPoints(600);

// Hasta dónde se puede caminar (en fracción del camino)
function fraccionHastaZ(zLimite) {
    for (let i = 0; i < puntosCamino.length; i++) {
        if (puntosCamino[i].z < zLimite) return i / (puntosCamino.length - 1);
    }
    return 1;
}
const finCaminable = fraccionHastaZ(-72);
const finHierba = fraccionHastaZ(-150);

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
escena.fog = new THREE.Fog("#f3cfaa", 140, 950);

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
        montana: "#7d9cb4", luna: "#e8eefc",
        dirSol: [0.42, 0.36, -0.83], dirDisco: [0.42, 0.36, -0.83], alturaLuna: -0.3,
        intensidad: 1.0, translucidez: 0.35, noche: 0, solVisible: 1, brillo: 0.25
    },
    atardecer: {
        cenit: "#8f9fcb", medio: "#f0b48c", horizonte: "#fde0b8",
        sol: "#ffe6b0", luz: "#ffe0bb", ambiente: "#6a6466", niebla: "#f3cfaa",
        nubeLuz: "#ffe8d0", nubeSombra: "#cf8f82", nubes: 0.7,
        verdeBase: "#173a0b", verdePunta: "#7fb52f", amarillo: "#d2bd48",
        montana: "#9c8aa6", luna: "#e8eefc",
        dirSol: [0.42, 0.13, -0.9], dirDisco: [0.42, 0.13, -0.9], alturaLuna: -0.3,
        intensidad: 1.0, translucidez: 1.0, noche: 0, solVisible: 1, brillo: 0.35
    },
    noche: {
        cenit: "#030817", medio: "#0b1631", horizonte: "#1b2c52",
        sol: "#ffe6b0", luz: "#9fb6f0", ambiente: "#253254", niebla: "#13213f",
        nubeLuz: "#34466e", nubeSombra: "#111a32", nubes: 0.4,
        verdeBase: "#081a12", verdePunta: "#3f6e5c", amarillo: "#4c5c48",
        montana: "#1f2c4c", luna: "#eef2fc",
        dirSol: [-0.38, 0.32, -0.87], dirDisco: [0.42, -0.3, -0.9], alturaLuna: 0.32,
        intensidad: 0.45, translucidez: 0.12, noche: 1, solVisible: 0, brillo: 0.75
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

const momentosCrudos = momentos;
const datosVacios = { ...momentosCrudos.atardecer };
Object.keys(momentos).forEach((clave) => (momentos[clave] = prepararMomento(momentos[clave])));

const actual = prepararMomento(datosVacios);

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

// Luces normales para el castillo y las piedras
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

    float fbm2(vec2 p) {
        return ruido(p) * 0.65 + ruido(p * 2.03) * 0.35;
    }

    float manchas(vec2 xz) {
        return smoothstep(0.42, 0.64, fbm(xz * 0.05 + vec2(3.1, 7.2)));
    }
`;

const nieblaGLSL = `
    vec3 aplicarNiebla(vec3 color, float distancia) {
        float n = smoothstep(55.0, 460.0, distancia);
        return mix(color, uNiebla, n * 0.8);
    }
`;

// =====================================================================
// 6. CIELO: degradado, sol, luna y nubes en un solo shader
// =====================================================================

const materialCielo = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
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
escena.add(new THREE.Points(geometriaEstrellas, materialEstrellas));

// =====================================================================
// 8. MONTAÑAS DEL FONDO (low poly)
// Conos con pocas caras y los vértices movidos al azar. Con
// "flatShading" cada cara se ilumina por separado: eso da el aspecto
// facetado. La niebla las va aclarando con la distancia.
// =====================================================================

const materialMontana = new THREE.MeshStandardMaterial({ color: "#a98a95", roughness: 1, flatShading: true });
const materialNieve = new THREE.MeshStandardMaterial({ color: "#f4f1f6", roughness: 1, flatShading: true });

function crearMontana(x, z, radio, alto, conNieve) {
    const geometria = new THREE.ConeGeometry(radio, alto, 7, 4).toNonIndexed();
    const vertices = geometria.attributes.position;
    const desplazados = new Map();
    for (let i = 0; i < vertices.count; i++) {
        const clave = vertices.getX(i).toFixed(2) + "," + vertices.getY(i).toFixed(2) + "," + vertices.getZ(i).toFixed(2);
        if (!desplazados.has(clave)) {
            const cima = vertices.getY(i) > alto / 2 - 0.01;
            const fuerza = cima ? 0.04 : 0.16;
            desplazados.set(clave, [entre(-1, 1) * radio * fuerza, entre(-1, 1) * alto * fuerza * 0.6, entre(-1, 1) * radio * fuerza]);
        }
        const [dx, dy, dz] = desplazados.get(clave);
        vertices.setXYZ(i, vertices.getX(i) + dx, vertices.getY(i) + dy, vertices.getZ(i) + dz);
    }
    geometria.computeVertexNormals();

    const montana = new THREE.Mesh(geometria, materialMontana);
    montana.position.set(x, alto / 2 - 6, z);
    montana.rotation.y = entre(0, Math.PI * 2);
    escena.add(montana);

    if (conNieve) {
        const nieve = new THREE.Mesh(new THREE.ConeGeometry(radio * 0.27, alto * 0.27, 7, 1), materialNieve);
        nieve.position.set(x, alto - 6 - alto * 0.135 + 0.6, z);
        nieve.rotation.y = montana.rotation.y;
        escena.add(nieve);
    }
}

const listaMontanas = [
    [-430, -560, 190, 170, true], [-250, -620, 170, 210, true], [-60, -700, 220, 240, true],
    [150, -640, 180, 200, true], [360, -580, 200, 180, true], [560, -520, 160, 140, false],
    [-600, -480, 150, 130, false], [-330, -420, 110, 95, false], [-150, -470, 120, 120, false],
    [110, -450, 110, 105, false], [280, -410, 120, 90, false], [470, -400, 100, 85, false]
];
listaMontanas.forEach(([x, z, r, a, nieve]) => crearMontana(x, z, r, a, nieve));

// =====================================================================
// 9. SUELO
// Cada vértice guarda cuánto está "dentro del camino" para pintar la
// tierra del sendero. Las laderas muy inclinadas se pintan de roca.
// =====================================================================

const geometriaSuelo = new THREE.PlaneGeometry(600, 600, 380, 380);
geometriaSuelo.rotateX(-Math.PI / 2);
geometriaSuelo.translate(0, 0, -140);
const verticesSuelo = geometriaSuelo.attributes.position;
const tierraCamino = new Float32Array(verticesSuelo.count);
for (let i = 0; i < verticesSuelo.count; i++) {
    const x = verticesSuelo.getX(i);
    const z = verticesSuelo.getZ(i);
    verticesSuelo.setY(i, alturaTerreno(x, z));
    if (Math.abs(x) < 16 && z < 20 && z > -210) {
        const ancho = 1.6 + 1.6 * suave(-95, -150, z);
        tierraCamino[i] = 1 - suave(ancho * 0.7, ancho, distanciaAlCamino(x, z));
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
            vec3 normal = normalize(vNormal);
            float m = smoothstep(0.42, 0.64, fbm2(vMundo.xz * 0.05 + vec2(3.1, 7.2)));
            vec3 color = mix(mix(uVerdeBase, uVerdePunta, 0.45), mix(uVerdeBase, uAmarillo, 0.45), m * 0.6);
            color *= 0.6 + ruido(vMundo.xz * 0.7) * 0.2;

            float roca = smoothstep(0.45, 0.28, normal.y) * (0.6 + 0.4 * ruido(vMundo.xz * 0.3));
            vec3 colorRoca = vec3(0.24, 0.22, 0.23) * (0.75 + ruido(vMundo.xz * 1.3 + vMundo.y) * 0.4);
            color = mix(color, colorRoca, roca);

            vec3 tierra = vec3(0.42, 0.33, 0.24) * (0.8 + ruido(vMundo.xz * 2.0) * 0.3);
            color = mix(color, tierra, vCamino);

            vec3 faceta = normalize(cross(dFdx(vMundo), dFdy(vMundo)));
            if (faceta.y < 0.0) faceta = -faceta;
            float difusa = max(dot(faceta, uDirSol), 0.0);
            color *= uAmbiente + uLuz * (0.35 + difusa * 0.65);
            color = aplicarNiebla(color, length(vMundo - cameraPosition));
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
});

escena.add(new THREE.Mesh(geometriaSuelo, materialSuelo));

// =====================================================================
// 10. PIEDRAS DEL CAMINO (solo en el tramo cercano; lejos basta la tierra)
// =====================================================================

function crearPiedrasCamino() {
    const losa = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true });
    const posiciones = [];
    const paso = 0.62;
    const hasta = largoCamino * Math.min(1, finCaminable + 0.12);

    for (let s = 0; s < hasta; s += paso) {
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
// Cada brizna es un plano estrecho repetido miles de veces con
// "instancing". Para ir rápido, la hierba se divide en trozos
// cuadrados: solo se dibujan los que están delante de la cámara y
// cerca. Lo que queda detrás o muy lejos no se calcula.
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

        float rafaga = fbm2(aPosicion.xz * 0.05 - uViento * uTiempo * 0.75);
        float ola = sin(dot(aPosicion.xz, uViento) * 0.32 - uTiempo * 2.0 + aAzar * 1.3);
        float viento = (0.12 + rafaga * rafaga * 1.3) * (0.6 + 0.4 * ola) * uFuerzaViento;
        mundo.xz += uViento * viento * curva * aAlto;
        mundo.y -= viento * viento * 0.22 * curva * aAlto;

        if (uFuerzaRaton > 0.001) {
            vec2 alejar = aPosicion.xz - uRaton;
            float distancia = length(alejar);
            float empuje = (1.0 - smoothstep(0.0, 1.6, distancia)) * uFuerzaRaton;
            mundo.xz += normalize(alejar + 0.0001) * empuje * curva * aAlto * 1.8;
            mundo.y -= empuje * curva * aAlto * 0.75;
        }

        vAlturaBrizna = y;
        vAzar = aAzar;
        vMancha = smoothstep(0.42, 0.64, fbm2(aPosicion.xz * 0.05 + vec2(3.1, 7.2)));
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

const trozosHierba = [];

function crearHierba(cantidad, segmentos, tMax, distanciaMin, distanciaMax, potencia, alto, ancho) {
    const brizna = new THREE.PlaneGeometry(1, 1, 1, segmentos);
    brizna.translate(0, 0.5, 0);

    // Primero se calculan todas las briznas y se reparten por trozos
    const cajones = new Map();
    for (let i = 0; i < cantidad; i++) {
        const t = entre(-0.01, tMax);
        const punto = camino.getPointAt(Math.max(0, t));
        const tangente = camino.getTangentAt(Math.max(0, t));
        const lado = azar() < 0.5 ? -1 : 1;
        const distancia = distanciaMin + Math.pow(azar(), potencia) * (distanciaMax - distanciaMin);
        const x = punto.x - tangente.z * distancia * lado;
        const z = punto.z + tangente.x * distancia * lado;

        const clave = Math.floor(x / ajustes.tamanoTrozo) + "," + Math.floor(z / ajustes.tamanoTrozo);
        if (!cajones.has(clave)) cajones.set(clave, []);
        cajones.get(clave).push([x, alturaTerreno(x, z) - 0.02, z, azar() * Math.PI * 2, entre(alto[0], alto[1]), entre(ancho[0], ancho[1]), azar()]);
    }

    // Después se crea una malla por trozo, con su esfera para descartarla si no se ve
    cajones.forEach((briznas) => {
        const n = briznas.length;
        const posiciones = new Float32Array(n * 3);
        const angulos = new Float32Array(n);
        const altos = new Float32Array(n);
        const anchos = new Float32Array(n);
        const azares = new Float32Array(n);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

        briznas.forEach(([x, y, z, angulo, a, w, r], i) => {
            posiciones[i * 3] = x;
            posiciones[i * 3 + 1] = y;
            posiciones[i * 3 + 2] = z;
            angulos[i] = angulo;
            altos[i] = a;
            anchos[i] = w;
            azares[i] = r;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        });

        const geometria = new THREE.InstancedBufferGeometry();
        geometria.index = brizna.index;
        geometria.setAttribute("position", brizna.attributes.position);
        geometria.setAttribute("uv", brizna.attributes.uv);
        geometria.setAttribute("aPosicion", new THREE.InstancedBufferAttribute(posiciones, 3));
        geometria.setAttribute("aAngulo", new THREE.InstancedBufferAttribute(angulos, 1));
        geometria.setAttribute("aAlto", new THREE.InstancedBufferAttribute(altos, 1));
        geometria.setAttribute("aAncho", new THREE.InstancedBufferAttribute(anchos, 1));
        geometria.setAttribute("aAzar", new THREE.InstancedBufferAttribute(azares, 1));
        geometria.instanceCount = n;

        const centro = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        const radio = new THREE.Vector3(maxX - minX, maxY - minY + 2, maxZ - minZ).length() / 2 + 2.5;
        geometria.boundingSphere = new THREE.Sphere(centro, radio);
        geometria.boundingBox = new THREE.Box3(new THREE.Vector3(minX - 2.5, minY - 1, minZ - 2.5), new THREE.Vector3(maxX + 2.5, maxY + 2, maxZ + 2.5));

        const malla = new THREE.Mesh(geometria, materialHierba);
        malla.frustumCulled = true;
        escena.add(malla);
        trozosHierba.push({ malla, geometria, total: n, centro });
    });
}

crearHierba(ajustes.hierbaCamino, 4, finCaminable + 0.06, 1.25, 7, 1.4, [0.22, 0.48], [0.026, 0.045]);
crearHierba(ajustes.hierbaPrado, 2, finCaminable + 0.12, 7, 40, 1.6, [0.3, 0.6], [0.05, 0.08]);
crearHierba(Math.floor(ajustes.hierbaPrado * 0.35), 1, 1, 1.6, 30, 1.3, [0.35, 0.65], [0.07, 0.1]);

let calidadHierba = 1;

function actualizarTrozos() {
    const lejos = ajustes.distanciaHierba;
    trozosHierba.forEach((trozo) => {
        const distancia = trozo.centro.distanceTo(camara.position);
        trozo.malla.visible = distancia < lejos;
        if (trozo.malla.visible) {
            const cercania = distancia < 40 ? 1 : 0.55;
            trozo.geometria.instanceCount = Math.floor(trozo.total * calidadHierba * cercania);
        }
    });
}

// =====================================================================
// 12. FLORES
// Pocas y agrupadas en rodales. Cada flor es un cuadrado que siempre
// mira a la cámara; los pétalos se dibujan con matemáticas.
// =====================================================================

const coloresFlor = ["#f0782f", "#f0782f", "#e0473f", "#4a6fd8", "#f2c84b", "#f6f1e4"].map((c) => new THREE.Color(c));

function crearFlores() {
    const datos = [];
    for (let r = 0; r < ajustes.rodalesFlores; r++) {
        const t = entre(0.0, finCaminable + 0.1);
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

                float rafaga = fbm2(aPosicion.xz * 0.05 - uViento * uTiempo * 0.75);
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
// 13. EL CASTILLO (low poly de cuento)
// Muros color crema, tejados azules muy puntiagudos y caras planas.
// Está lejos, sobre la colina, y el camino entra por su puerta.
// De noche se encienden las ventanas y la puerta.
// =====================================================================

const castilloGrupo = new THREE.Group();
const materialVentanas = new THREE.MeshBasicMaterial({ color: "#2a2430" });
const materialPuertaLuz = new THREE.MeshBasicMaterial({ color: "#2a2430" });
const luzPuerta = new THREE.PointLight("#ffb766", 0, 40, 1.5);
const banderas = [];
const baseCastillo = alturaTerreno(castillo.x, castillo.z);

function crearCastillo() {
    const muroClaro = new THREE.MeshStandardMaterial({ color: "#e8dcc4", roughness: 0.9, flatShading: true });
    const muroSombra = new THREE.MeshStandardMaterial({ color: "#cdbd9f", roughness: 0.9, flatShading: true });
    const tejado = new THREE.MeshStandardMaterial({ color: "#3b67b8", roughness: 0.7, flatShading: true });
    const remate = new THREE.MeshStandardMaterial({ color: "#d9a640", roughness: 0.6, flatShading: true });
    const roca = new THREE.MeshStandardMaterial({ color: "#7d7468", roughness: 1, flatShading: true });
    const bandera = new THREE.MeshStandardMaterial({ color: "#d1453b", side: THREE.DoubleSide, flatShading: true });
    const ventanas = [];
    const almenas = [];

    function anadirVentanas(x, z, radio, desde, hasta, columnas) {
        for (let y = desde; y <= hasta; y += 3.4) {
            for (let c = 0; c < columnas; c++) {
                const angulo = columnas === 1 ? 0 : (c / (columnas - 1) - 0.5) * 1.2;
                if (azar() < 0.2) continue;
                ventanas.push({ x: x + Math.sin(angulo) * (radio + 0.04), y, z: z + Math.cos(angulo) * (radio + 0.04), giro: angulo, ancho: 0.6, alto: 1.2 });
            }
        }
    }

    function torre(x, z, radio, alto, altoTejado, base = 0, conBandera = false) {
        const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio * 1.05, alto + 14, 8), muroClaro);
        cuerpo.position.set(x, base + (alto - 14) / 2, z);
        const corona = new THREE.Mesh(new THREE.CylinderGeometry(radio * 1.22, radio * 1.02, 1.2, 8), muroSombra);
        corona.position.set(x, base + alto + 0.3, z);
        const techo = new THREE.Mesh(new THREE.ConeGeometry(radio * 1.38, altoTejado, 8), tejado);
        techo.position.set(x, base + alto + 0.9 + altoTejado / 2, z);
        const bola = new THREE.Mesh(new THREE.OctahedronGeometry(radio * 0.18, 0), remate);
        bola.position.set(x, base + alto + 0.9 + altoTejado + radio * 0.1, z);
        castilloGrupo.add(cuerpo, corona, techo, bola);

        if (conBandera) {
            const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 4), remate);
            mastil.position.set(x, base + alto + altoTejado + 2.1, z);
            const tela = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9, 3, 1), bandera);
            tela.position.set(x + 0.9, base + alto + altoTejado + 2.9, z);
            castilloGrupo.add(mastil, tela);
            banderas.push(tela);
        }

        anadirVentanas(x, z, radio, base + 2.8, base + alto - 2.2, radio > 1.8 ? 3 : 2);
    }

    function bloque(x, z, ancho, alto, fondo, base = 0) {
        const caja = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto + 14, fondo), muroClaro);
        caja.position.set(x, base + (alto - 14) / 2, z);
        castilloGrupo.add(caja);
        const cornisa = new THREE.Mesh(new THREE.BoxGeometry(ancho + 0.5, 0.7, fondo + 0.5), muroSombra);
        cornisa.position.set(x, base + alto, z);
        castilloGrupo.add(cornisa);
        for (let i = -ancho / 2 + 0.6; i < ancho / 2; i += 1.4) {
            almenas.push([x + i, base + alto + 0.7, z + fondo / 2 + 0.05]);
        }
        for (let y = base + 2.8; y < base + alto - 1.8; y += 3.4) {
            for (let c = -1; c <= 1; c++) {
                if (azar() < 0.15) continue;
                ventanas.push({ x: x + c * ancho * 0.28, y, z: z + fondo / 2 + 0.04, giro: 0, ancho: 0.8, alto: 1.4 });
            }
        }
    }

    bloque(0, -2, 13, 19, 10);
    bloque(0, -3, 8.5, 11, 7, 19);
    torre(0, -3, 2.5, 21, 13, 30, true);

    torre(-8, -1, 2.2, 28, 12, 0, true);
    torre(8, -1, 2.2, 25, 11, 0, true);
    torre(-5, -8, 1.8, 34, 13, 0, true);
    torre(5.5, -8.5, 1.8, 31, 12);
    torre(-11.5, 4, 1.6, 15, 8);
    torre(11.5, 4, 1.6, 14, 8);

    torre(-4.6, 0.6, 0.9, 5, 5, 25);
    torre(4.6, 0.6, 0.9, 5, 5, 25);
    torre(-4.6, -6.6, 0.9, 6, 5, 25);
    torre(4.6, -6.6, 0.9, 6, 5, 25);

    const muro = new THREE.Mesh(new THREE.BoxGeometry(22, 8 + 14, 1.4), muroSombra);
    muro.position.set(0, (8 - 14) / 2, 5.5);
    castilloGrupo.add(muro);
    for (let i = -10.4; i <= 10.4; i += 1.4) almenas.push([i, 8.35, 5.5]);
    torre(-3.2, 6.2, 1.7, 11, 6, 0, true);
    torre(3.2, 6.2, 1.7, 11, 6, 0, true);

    const arco = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.6), materialPuertaLuz);
    arco.position.set(0, 2.3, 6.25);
    const dintel = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 8, 1, false, -Math.PI / 2, Math.PI), materialPuertaLuz);
    dintel.rotation.x = Math.PI / 2;
    dintel.position.set(0, 4.6, 6.25);
    castilloGrupo.add(arco, dintel);
    luzPuerta.position.set(0, 3, 10);
    castilloGrupo.add(luzPuerta);

    const mallaAlmenas = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.9, 0.6), muroSombra, almenas.length);
    const ayudante = new THREE.Object3D();
    almenas.forEach(([x, y, z], i) => {
        ayudante.position.set(x, y, z);
        ayudante.rotation.set(0, 0, 0);
        ayudante.scale.set(1, 1, 1);
        ayudante.updateMatrix();
        mallaAlmenas.setMatrixAt(i, ayudante.matrix);
    });
    castilloGrupo.add(mallaAlmenas);

    const mallaVentanas = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), materialVentanas, ventanas.length);
    ventanas.forEach((v, i) => {
        ayudante.position.set(v.x, v.y, v.z);
        ayudante.rotation.set(0, v.giro, 0);
        ayudante.scale.set(v.ancho, v.alto, 1);
        ayudante.updateMatrix();
        mallaVentanas.setMatrixAt(i, ayudante.matrix);
    });
    castilloGrupo.add(mallaVentanas);

    const geometriaRoca = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
        const angulo = (i / 16) * Math.PI * 2 + entre(-0.1, 0.1);
        if (Math.abs(angulo - Math.PI / 2) < 0.35) continue;
        const r = entre(12, 15);
        const roca1 = new THREE.Mesh(geometriaRoca, roca);
        roca1.position.set(Math.cos(angulo) * r, entre(-2.5, -0.5), Math.sin(angulo) * r * 0.85);
        roca1.scale.set(entre(2.2, 3.6), entre(1.6, 2.8), entre(2.2, 3.6));
        roca1.rotation.set(entre(0, 3), entre(0, 3), entre(0, 3));
        castilloGrupo.add(roca1);
    }

    castilloGrupo.position.set(castillo.x, baseCastillo, castillo.z + 2);
    escena.add(castilloGrupo);
}

crearCastillo();

// =====================================================================
// 13b. ÁRBOLES LOW POLY
// Copa hecha con tres icosaedros juntos (bolas facetadas) y un tronco
// de cinco caras. Se dibujan todos de una vez con "instancing".
// =====================================================================

function bolaFacetada(radio, x, y, z) {
    const bola = new THREE.IcosahedronGeometry(radio, 0);
    const vertices = bola.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
        const factor = 1 + Math.sin(vertices.getX(i) * 7.1 + vertices.getY(i) * 3.7 + vertices.getZ(i) * 5.3) * 0.12;
        vertices.setXYZ(i, vertices.getX(i) * factor + x, vertices.getY(i) * factor * 0.9 + y, vertices.getZ(i) * factor + z);
    }
    return bola;
}

function crearArboles() {
    const copa = mergeGeometries([
        bolaFacetada(1.25, 0, 2.6, 0),
        bolaFacetada(0.95, 0.75, 2.2, 0.35),
        bolaFacetada(0.9, -0.6, 3.1, -0.3)
    ]);
    copa.computeVertexNormals();
    const tronco = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 5).translate(0, 1.1, 0);

    const lugares = [];
    let intentos = 0;
    const cuantos = movil ? 60 : 130;
    while (lugares.length < cuantos && intentos < 30000) {
        intentos++;
        let x;
        let z;
        let escala;
        const tipo = azar();
        if (tipo < 0.12) {
            x = (azar() < 0.5 ? -1 : 1) * entre(20, 34);
            z = entre(-25, -70);
            escala = entre(1.6, 2.4);
        } else if (tipo < 0.55) {
            const angulo = entre(0, Math.PI * 2);
            const radio = entre(30, 60);
            x = castillo.x + Math.cos(angulo) * radio;
            z = castillo.z + Math.sin(angulo) * radio * 0.8;
            escala = entre(1.8, 2.8);
        } else {
            x = entre(-110, 110);
            z = entre(-60, -200);
            escala = entre(1.6, 2.8);
        }
        if (distanciaAlCamino(x, z) < 9) continue;
        if (Math.abs(x - castillo.x) < 16 && z < -70) continue;
        if (Math.abs(x) < 12 && z > -60) continue;
        lugares.push({ x, z, escala });
    }

    const materialCopa = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, flatShading: true });
    const materialTronco = new THREE.MeshStandardMaterial({ color: "#6b4a30", roughness: 1, flatShading: true });
    const copas = new THREE.InstancedMesh(copa, materialCopa, lugares.length);
    const troncos = new THREE.InstancedMesh(tronco, materialTronco, lugares.length);
    const ayudante = new THREE.Object3D();
    const color = new THREE.Color();

    lugares.forEach(({ x, z, escala }, i) => {
        ayudante.position.set(x, alturaTerreno(x, z) - 0.15, z);
        ayudante.rotation.set(0, entre(0, Math.PI * 2), 0);
        ayudante.scale.set(escala * entre(0.9, 1.1), escala * entre(0.9, 1.15), escala * entre(0.9, 1.1));
        ayudante.updateMatrix();
        copas.setMatrixAt(i, ayudante.matrix);
        troncos.setMatrixAt(i, ayudante.matrix);
        copas.setColorAt(i, color.setHSL(entre(0.24, 0.33), entre(0.5, 0.68), entre(0.3, 0.42)));
    });

    escena.add(copas, troncos);
}

crearArboles();

// =====================================================================
// 13c. ROCAS LOW POLY junto al camino
// =====================================================================

function crearRocas() {
    const geometria = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true });
    const lugares = [];
    let intentos = 0;
    while (lugares.length < 45 && intentos < 5000) {
        intentos++;
        const t = entre(0, finCaminable + 0.15);
        const punto = camino.getPointAt(t);
        const tangente = camino.getTangentAt(t);
        const lado = azar() < 0.5 ? -1 : 1;
        const distancia = entre(2.2, 14);
        const x = punto.x - tangente.z * distancia * lado;
        const z = punto.z + tangente.x * distancia * lado;
        if (distanciaAlCamino(x, z) < 2) continue;
        lugares.push({ x, z, escala: distancia < 5 ? entre(0.2, 0.45) : entre(0.35, 0.9) });
    }

    const rocas = new THREE.InstancedMesh(geometria, material, lugares.length);
    const ayudante = new THREE.Object3D();
    const color = new THREE.Color();
    lugares.forEach(({ x, z, escala }, i) => {
        ayudante.position.set(x, alturaTerreno(x, z) + escala * 0.2, z);
        ayudante.rotation.set(entre(0, 3), entre(0, 3), entre(0, 3));
        ayudante.scale.set(escala * entre(1, 1.5), escala * entre(0.6, 0.9), escala * entre(1, 1.4));
        ayudante.updateMatrix();
        rocas.setMatrixAt(i, ayudante.matrix);
        const gris = entre(0.22, 0.3);
        rocas.setColorAt(i, color.setRGB(gris, gris * 1.03, gris * 0.96));
    });
    escena.add(rocas);
}

crearRocas();

// =====================================================================
// 14. LUCIÉRNAGAS
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
    const t = entre(0, finCaminable + 0.05);
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
// 15. POSTPROCESADO
// 1) la escena se dibuja en una textura que guarda también la
//    profundidad; 2) el DOF desenfoca según la distancia; 3) el
//    "bloom" hace brillar lo más luminoso; 4) se pasa a pantalla.
// Cuando cambia el tamaño, la textura se crea de nuevo (si solo se
// redimensiona, la profundidad se rompe y la pantalla sale negra).
// =====================================================================

function tamanoReal() {
    return new THREE.Vector2(
        Math.floor(window.innerWidth * renderizador.getPixelRatio()),
        Math.floor(window.innerHeight * renderizador.getPixelRatio())
    );
}

let tamano = tamanoReal();
let destinoEscena = null;

function crearDestino() {
    if (destinoEscena) {
        destinoEscena.depthTexture.dispose();
        destinoEscena.dispose();
    }
    destinoEscena = new THREE.WebGLRenderTarget(tamano.x, tamano.y, {
        type: THREE.HalfFloatType,
        samples: movil ? 0 : 4,
        depthTexture: new THREE.DepthTexture(tamano.x, tamano.y)
    });
}

crearDestino();

const compositor = new EffectComposer(renderizador);
compositor.setPixelRatio(renderizador.getPixelRatio());
compositor.setSize(window.innerWidth, window.innerHeight);
const paseEscena = new TexturePass(destinoEscena.texture);
compositor.addPass(paseEscena);

const paseDesenfoque = new ShaderPass({
    uniforms: {
        tDiffuse: { value: null },
        tProfundidad: { value: destinoEscena.depthTexture },
        uResolucion: { value: tamano.clone() },
        uCerca: { value: camara.near },
        uLejos: { value: camara.far },
        uFoco: { value: 7 },
        uRadio: { value: movil ? 6 : 10 }
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
            if (radio < 0.5) {
                gl_FragColor = suma;
                return;
            }
            for (int i = 0; i < 20; i++) {
                float f = float(i);
                float r = sqrt((f + 0.5) / 20.0) * radio;
                float a = f * 2.39996;
                vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uResolucion;
                float suyo = desenfoqueEn(distanciaEn(uv));
                float peso = max(smoothstep(0.0, 1.0, suyo * uRadio - r + 1.0), 0.15);
                suma += texture2D(tDiffuse, uv) * peso;
                pesos += peso;
            }
            gl_FragColor = suma / pesos;
        }
    `
});
paseDesenfoque.enabled = false;
compositor.addPass(paseDesenfoque);

const paseBrillo = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.35, 0.55, 0.9);
compositor.addPass(paseBrillo);
compositor.addPass(new OutputPass());

// =====================================================================
// 16. CAMINAR POR EL CAMINO
// "avance" va de 0 (inicio) a 1 (fin del tramo que se puede andar).
// El camino sigue hasta la puerta del castillo, pero nunca se llega.
// =====================================================================

let avance = 0;
let avanceObjetivo = 0;
let caminandoSolo = false;
const velocidadSola = 0.014;
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
    moverAvance(evento.deltaY * 0.0004);
}, { passive: false });

window.addEventListener("keydown", (evento) => {
    if (["ArrowUp", "w", "W"].includes(evento.key)) moverAvance(0.03);
    if (["ArrowDown", "s", "S"].includes(evento.key)) moverAvance(-0.03);
});

botonCaminar.addEventListener("click", () => {
    if (avanceObjetivo >= 0.999) avanceObjetivo = 0;
    caminandoSolo = !caminandoSolo;
    botonCaminar.classList.toggle("activo", caminandoSolo);
    pista.classList.add("oculta");
});

const miradaCamara = new THREE.Vector3();
const objetivoVista = new THREE.Vector3(castillo.x, baseCastillo + 16, castillo.z);

function colocarCamara(paralaje) {
    const t = avance * finCaminable;
    const punto = camino.getPointAt(t);
    const delante = camino.getPointAt(Math.min(1, t + 0.03));
    const balanceo = Math.sin(t * largoCamino * 2.2) * 0.025 * Math.min(1, Math.abs(avanceObjetivo - avance) * 60);

    camara.position.set(
        punto.x + paralaje.x * 0.6,
        alturaTerreno(punto.x, punto.z) + 1.55 + balanceo + paralaje.y * 0.15,
        punto.z
    );

    miradaCamara.set(delante.x, alturaTerreno(delante.x, delante.z) + 1.3, delante.z);
    miradaCamara.lerp(objetivoVista, 0.55);
    miradaCamara.x += paralaje.x * 6;
    miradaCamara.y += paralaje.y * 3;
    camara.lookAt(miradaCamara);
}

// =====================================================================
// 17. RATÓN Y DEDO
// =====================================================================

const rayo = new THREE.Raycaster();
const puntero = new THREE.Vector2();
const objetivoRaton = new THREE.Vector2(999, 999);
const paralaje = new THREE.Vector2();
const paralajeCero = new THREE.Vector2();
let punteroDentro = false;
let punteroMovido = false;
let dedoY = null;

function cortarTerreno(origen, direccion) {
    const punto = new THREE.Vector3();
    for (let distancia = 0.3; distancia < 40; distancia += distancia < 12 ? 0.1 : 0.5) {
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
        moverAvance((dedoY - evento.clientY) * 0.0009);
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
    if (tocarHierba && punteroMovido) {
        rayo.setFromCamera(puntero, camara);
        const punto = cortarTerreno(rayo.ray.origin, rayo.ray.direction);
        if (punto) objetivoRaton.set(punto.x, punto.z);
        punteroMovido = false;
    }

    const actualRaton = comunes.uRaton.value;
    if (actualRaton.x > 900) actualRaton.copy(objetivoRaton);
    else actualRaton.lerp(objetivoRaton, Math.min(1, delta * 12));

    const fuerzaObjetivo = tocarHierba && punteroDentro && objetivoRaton.x < 900 ? 1 : 0;
    comunes.uFuerzaRaton.value += (fuerzaObjetivo - comunes.uFuerzaRaton.value) * Math.min(1, delta * 4);
    if (comunes.uFuerzaRaton.value < 0.002) comunes.uFuerzaRaton.value = 0;

    paralaje.lerp(punteroDentro && !movil ? puntero : paralajeCero, Math.min(1, delta * 2.5));
}

// =====================================================================
// 18. BOTONES: MOMENTO DEL DÍA Y DOF
// =====================================================================

const botonesMomento = document.querySelectorAll("#momentos button");
const momentoPedido = parametros.get("momento");
const momentoInicial = momentos[momentoPedido] ? momentoPedido : "atardecer";
const momentoDesde = prepararMomento(datosVacios);
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
const colorApagado = new THREE.Color("#1c1a22");
const colorEncendido = new THREE.Color("#ffb45c").multiplyScalar(6);

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
    materialMontana.color.copy(actual.montana);

    direccionLuz.set(actual.dirSol.x, Math.max(actual.dirSol.y, 0.35), 0.45).normalize();
    luzSol.color.copy(actual.luz);
    luzSol.intensity = 2.2 * actual.intensidad;
    luzSol.position.copy(direccionLuz).multiplyScalar(100).add(camara.position);
    luzSol.target.position.copy(camara.position);
    luzCielo.color.copy(actual.horizonte);
    luzCielo.groundColor.copy(actual.verdeBase);
    luzCielo.intensity = 0.6 + actual.intensidad * 0.9;

    const encendido = Math.pow(actual.noche, 1.5);
    materialVentanas.color.lerpColors(colorApagado, colorEncendido, encendido);
    materialPuertaLuz.color.lerpColors(colorApagado, colorEncendido, encendido);
    luzPuerta.intensity = actual.noche * 30;

    paseBrillo.strength = actual.brillo;
    renderizador.toneMappingExposure = 1.05 + actual.noche * 0.25;
}

// =====================================================================
// 19. RENDIMIENTO
// Se miden los FPS todo el rato. Si bajan de 50, se quita hierba
// poco a poco; si sobran, se vuelve a poner.
// =====================================================================

const marcadorFps = document.createElement("p");
marcadorFps.className = "fps";
if (parametros.get("fps") === "si") document.body.appendChild(marcadorFps);

let fotogramas = 0;
let inicioMedida = performance.now();
const inicioPagina = performance.now();

function revisarRendimiento() {
    fotogramas++;
    const ahora = performance.now();
    const tiempoMedido = (ahora - inicioMedida) / 1000;
    if (tiempoMedido < 1) return;

    const fps = fotogramas / tiempoMedido;
    const arranque = (ahora - inicioPagina) / 1000;
    marcadorFps.textContent = Math.round(fps) + " FPS · hierba " + Math.round(calidadHierba * 100) + "%";

    if (arranque > 2) {
        if (fps < 50) calidadHierba = Math.max(0.25, calidadHierba - 0.12);
        else if (fps > 58) calidadHierba = Math.min(1, calidadHierba + 0.04);
    }
    fotogramas = 0;
    inicioMedida = ahora;
}

// =====================================================================
// 20. TAMAÑO DE LA VENTANA
// =====================================================================

function ajustarTamano() {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(window.innerWidth, window.innerHeight);
    tamano = tamanoReal();
    crearDestino();
    paseEscena.map = destinoEscena.texture;
    paseDesenfoque.uniforms.tProfundidad.value = destinoEscena.depthTexture;
    paseDesenfoque.uniforms.uResolucion.value.copy(tamano);
    compositor.setPixelRatio(renderizador.getPixelRatio());
    compositor.setSize(window.innerWidth, window.innerHeight);
    paseBrillo.setSize(window.innerWidth / 2, window.innerHeight / 2);
}

window.addEventListener("resize", ajustarTamano);

// =====================================================================
// 21. BUCLE PRINCIPAL
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
    actualizarTrozos();

    banderas.forEach((b, i) => (b.rotation.y = Math.sin(tiempo * 3 + i) * 0.35));
    if (actual.noche > 0.02) moverLuciernagas(tiempo, actual.noche);
    else materialLuciernagas.opacity = 0;

    renderizador.setRenderTarget(destinoEscena);
    renderizador.render(escena, camara);
    renderizador.setRenderTarget(null);
    compositor.render(delta);

    revisarRendimiento();

    if (primerFotograma) {
        primerFotograma = false;
        document.getElementById("cargando").classList.add("oculta");
    }
}

animar();
