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
const factorCalidad = (parametros.get("calidad") === "baja" ? 0.4 : 1) * (movil ? 0.5 : 1);

const ajustes = {
    hierba: Math.floor(60000 * factorCalidad),
    largoHierba: 46,
    anchoHierba: 15,
    tamanoPixel: movil ? 2.5 : 3,
    largoTrozo: 25,
    trozosDelante: 3
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
// 2. EL CAMINO Y EL TERRENO
// El camino serpentea hacia el castillo y no se acaba nunca.
// Las mismas fórmulas existen en JavaScript y en los shaders.
// =====================================================================

function caminoX(z) {
    return 1.4 * Math.sin(z * 0.045) + 0.5 * Math.sin(z * 0.13 + 1.0);
}

function suave(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function alturaTerreno(x, z) {
    const lado = Math.abs(x - caminoX(z));
    return 1.8 * suave(4, 15, lado) * (0.6 + 0.4 * Math.sin(z * 0.07 + x * 0.1));
}

const terrenoGLSL = `
    float caminoX(float z) {
        return 1.4 * sin(z * 0.045) + 0.5 * sin(z * 0.13 + 1.0);
    }

    float alturaTerreno(float x, float z) {
        float lado = abs(x - caminoX(z));
        return 1.8 * smoothstep(4.0, 15.0, lado) * (0.6 + 0.4 * sin(z * 0.07 + x * 0.1));
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
        niebla: "#3c4470", tierra: "#22392b", tierraClara: "#3c5a33",
        hierbaBase: "#14281a", hierbaPunta: "#5c8a3c", luz: "#ffc9a0", ambiente: "#6a5f99",
        piedra: "#8a7f96", juntas: "#2b2238"
    },
    noche: {
        noche: 1,
        niebla: "#12152e", tierra: "#0d1520", tierraClara: "#18283a",
        hierbaBase: "#070d12", hierbaPunta: "#24405a", luz: "#7f95d6", ambiente: "#252b55",
        piedra: "#3b4466", juntas: "#0d0f1e"
    }
};

const nombresColor = ["niebla", "tierra", "tierraClara", "hierbaBase", "hierbaPunta", "luz", "ambiente", "piedra", "juntas"];

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
    uViento: { value: movimientoReducido ? 0.25 : 1 }
};

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
    { nombre: "montanas", x: 0, y: -40, escala: 1.0, paralaje: 0.008, zoom: 0.03 },
    { nombre: "nubes", x: 0, y: 40, escala: 1.0, paralaje: 0.012, zoom: 0.06, deriva: true },
    { nombre: "castillo", x: 0, y: -168.8, escala: 0.62, paralaje: 0.016, zoom: 0.12 },
    { nombre: "valle", x: 40, y: 150, escala: 0.78, paralaje: 0.026, zoom: 0.3 }
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

function actualizarCapas(metros) {
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
// La cámara mira un poco hacia arriba para que el horizonte del suelo
// 3D quede a la altura del final del valle pintado.
// =====================================================================

const escena = new THREE.Scene();
escena.fog = new THREE.Fog(actual.niebla, 12, 70);

const camara = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
camara.rotation.order = "YXZ";
let inclinacion = 0;

const HORIZONTE_EN_MARCO = 0.79;

function ajustarEncuadre() {
    const aspecto = window.innerWidth / window.innerHeight;
    if (aspecto > aspectoMarco) visible.set(1, aspectoMarco / aspecto);
    else visible.set(aspecto / aspectoMarco, 1);
    visible.multiplyScalar(0.94);

    camara.aspect = aspecto;
    camara.fov = aspecto < 0.8 ? 62 : 55;
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
// 7. SUELO CON EL CAMINO DE ADOQUINES
// Un plano grande que acompaña a la cámara. El shader pinta la hierba
// del suelo y, donde pasa el camino, adoquines con un patrón de
// celdas (Voronoi): cada celda es una piedra y los bordes, las juntas.
// =====================================================================

const materialSuelo = new THREE.ShaderMaterial({
    uniforms: {
        ...comunes,
        uTierra: { value: actual.tierra },
        uTierraClara: { value: actual.tierraClara },
        uPiedra: { value: actual.piedra },
        uJuntas: { value: actual.juntas }
    },
    vertexShader: `
        uniform vec3 uCamara;
        varying vec3 vMundo;
        ${terrenoGLSL}
        void main() {
            vec3 p = position;
            p.x += uCamara.x;
            p.z += uCamara.z;
            p.y = alturaTerreno(p.x, p.z);
            vMundo = p;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uNiebla;
        uniform vec3 uLuz;
        uniform vec3 uAmbiente;
        uniform vec3 uTierra;
        uniform vec3 uTierraClara;
        uniform vec3 uPiedra;
        uniform vec3 uJuntas;
        varying vec3 vMundo;
        ${terrenoGLSL}

        vec3 adoquines(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float d1 = 8.0;
            float d2 = 8.0;
            vec2 celda = vec2(0.0);
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    vec2 v = vec2(float(x), float(y));
                    vec2 punto = v + vec2(hash(i + v), hash(i + v + 17.0)) * 0.8 + 0.1;
                    float d = length(punto - f);
                    if (d < d1) { d2 = d1; d1 = d; celda = i + v; }
                    else if (d < d2) { d2 = d; }
                }
            }
            return vec3(d2 - d1, hash(celda), d1);
        }

        void main() {
            float distancia = abs(vMundo.x - caminoX(vMundo.z));
            float enCamino = 1.0 - smoothstep(0.78, 0.95, distancia + (ruido(vMundo.xz * 3.0) - 0.5) * 0.25);

            float manchas = ruido(vMundo.xz * 0.35) * 0.6 + ruido(vMundo.xz * 1.7) * 0.4;
            vec3 suelo = mix(uTierra, uTierraClara, manchas);

            vec3 a = adoquines(vMundo.xz * vec2(2.6, 2.0));
            float junta = smoothstep(0.05, 0.13, a.x);
            vec3 piedra = uPiedra * (0.75 + a.y * 0.4) * (1.0 - a.z * 0.35);
            vec3 camino = mix(uJuntas, piedra, junta);
            camino = mix(camino, mix(uTierra, uTierraClara, 0.5), smoothstep(0.55, 0.85, distancia) * 0.6);

            vec3 color = mix(suelo, camino, enCamino);
            color *= uAmbiente * 1.4 + uLuz * 0.55;

            float d = length(vMundo - cameraPosition);
            if (smoothstep(22.0, 38.0, d) > tramado(gl_FragCoord.xy)) discard;
            color = mix(color, uNiebla, smoothstep(10.0, 40.0, d) * 0.6);
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
        }
    `
});

const geometriaSuelo = new THREE.PlaneGeometry(320, 320, 200, 200);
geometriaSuelo.rotateX(-Math.PI / 2);
geometriaSuelo.translate(0, 0, -130);
const suelo = new THREE.Mesh(geometriaSuelo, materialSuelo);
suelo.frustumCulled = false;
escena.add(suelo);

// =====================================================================
// 8. HIERBA
// Briznas repetidas con "instancing" en una franja alrededor del
// camino. Cuando una brizna se queda atrás, el shader la vuelve a
// colocar delante (operación módulo), así nunca se acaba la hierba.
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
        const lado = azar() * 2 - 1;
        posiciones[i * 2] = Math.sign(lado) * (0.85 + Math.pow(Math.abs(lado), 1.3) * ajustes.anchoHierba);
        posiciones[i * 2 + 1] = azar() * ajustes.largoHierba;
        datos[i * 4] = azar() * Math.PI * 2;
        datos[i * 4 + 1] = entre(0.35, 0.75);
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
            varying float vAltura;
            varying float vAzar;
            varying vec3 vMundo;
            ${terrenoGLSL}

            void main() {
                float delante = mod(uCamara.z + 4.0 - aPosicion.y, uLargo);
                float z = uCamara.z + 4.0 - delante;
                float x = caminoX(z) + aPosicion.x;
                vec3 base = vec3(x, alturaTerreno(x, z), z);

                float y = position.y;
                float alto = aDatos.y * (1.0 + smoothstep(3.0, 10.0, abs(aPosicion.x)) * 0.5);
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
            varying float vAltura;
            varying float vAzar;
            varying vec3 vMundo;
            ${terrenoGLSL}

            void main() {
                float d0 = length(vMundo - cameraPosition);
                if (smoothstep(20.0, 34.0, d0) > tramado(gl_FragCoord.xy)) discard;
                vec3 punta = uPunta * (0.7 + vAzar * 0.55);
                vec3 color = mix(uBase, punta, vAltura);
                color *= uAmbiente * 1.3 + uLuz * (0.3 + 0.5 * vAltura);
                float d = length(vMundo - cameraPosition);
                color = mix(color, uNiebla, smoothstep(10.0, 40.0, d) * 0.6);
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
// 9. OBJETOS DEL CAMINO POR TROZOS
// El mundo se divide en trozos de 25 m. Cada trozo se genera siempre
// igual (su propia semilla) con pinos, valla, rocas, flores y farolas.
// Se crean los que hay delante y se borran los que quedan detrás.
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

const materialPino = desvanecerLejos(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, emissive: "#16232c" }), 26, 44);
const materialMadera = desvanecerLejos(new THREE.MeshStandardMaterial({ color: "#5a4030", roughness: 1, flatShading: true }), 22, 36);
const materialRoca = desvanecerLejos(new THREE.MeshStandardMaterial({ color: "#5a5470", roughness: 1, flatShading: true }), 22, 36);
const materialFarol = new THREE.MeshBasicMaterial({ color: "#2a2230" });
const materialFlores = new THREE.PointsMaterial({ size: 0.13, vertexColors: true });
const coloresFlor = ["#8c9cff", "#d8d4ff", "#ff9ccf", "#ffe28a"].map((c) => new THREE.Color(c));

function texturaBrillo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 32;
    lienzo.height = 32;
    const ctx = lienzo.getContext("2d");
    const degradado = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    degradado.addColorStop(0, "rgba(255, 210, 130, 1)");
    degradado.addColorStop(0.3, "rgba(255, 170, 80, 0.6)");
    degradado.addColorStop(1, "rgba(255, 150, 60, 0)");
    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(lienzo);
}
const materialHalo = new THREE.SpriteMaterial({ map: texturaBrillo(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

function geometriaPino(x, y, z, alto, color, aleatorio) {
    const piezas = [];
    const pisos = 5;
    for (let p = 0; p < pisos; p++) {
        const t = p / pisos;
        const radio = alto * 0.26 * (1 - t * 0.75);
        const cono = new THREE.ConeGeometry(radio, alto * 0.3, 7);
        cono.rotateY(aleatorio() * Math.PI);
        cono.translate(x, y + alto * (0.18 + t * 0.7), z);
        piezas.push(cono);
    }
    const tronco = new THREE.CylinderGeometry(alto * 0.03, alto * 0.04, alto * 0.25, 5);
    tronco.translate(x, y + alto * 0.12, z);
    piezas.push(tronco);

    piezas.forEach((pieza, indice) => {
        const n = pieza.attributes.position.count;
        const colores = new Float32Array(n * 3);
        const c = indice === piezas.length - 1 ? new THREE.Color("#2b2019") : color.clone().multiplyScalar(0.85 + aleatorio() * 0.3);
        for (let i = 0; i < n; i++) c.toArray(colores, i * 3);
        pieza.setAttribute("color", new THREE.BufferAttribute(colores, 3));
        pieza.deleteAttribute("uv");
        pieza.deleteAttribute("normal");
    });
    return piezas;
}

function crearTrozo(indice) {
    const aleatorio = crearAzar(indice * 7919 + 13);
    const grupo = new THREE.Group();
    const zInicio = -indice * ajustes.largoTrozo;
    const largo = ajustes.largoTrozo;

    // Pinos: grandes cerca de los lados del camino, más pequeños lejos
    const piezasPino = [];
    const colorPino = new THREE.Color("#2f5a44");
    const cuantos = movil ? 7 : 11;
    for (let i = 0; i < cuantos; i++) {
        const z = zInicio - aleatorio() * largo;
        const lado = aleatorio() < 0.5 ? -1 : 1;
        const separacion = 8 + Math.pow(aleatorio(), 1.2) * 16;
        const x = caminoX(z) + lado * separacion;
        const alto = entre(6, 12, aleatorio);
        piezasPino.push(...geometriaPino(x, alturaTerreno(x, z) - 0.2, z, alto, colorPino, aleatorio));
    }
    const geometriaPinos = mergeGeometries(piezasPino);
    geometriaPinos.computeVertexNormals();
    grupo.add(new THREE.Mesh(geometriaPinos, materialPino));

    // Valla de madera a los dos lados del camino (solo en algunos trozos)
    if (aleatorio() < 0.6) {
        const piezasValla = [];
        const desde = zInicio - aleatorio() * 6;
        const hasta = desde - entre(8, 18, aleatorio);
        [-1, 1].forEach((lado) => {
            let anterior = null;
            for (let z = desde; z > hasta; z -= 2.2) {
                const x = caminoX(z) + lado * 1.35;
                const y = alturaTerreno(x, z);
                const poste = new THREE.BoxGeometry(0.12, 0.95, 0.12);
                poste.rotateZ(entre(-0.08, 0.08, aleatorio));
                poste.translate(x, y + 0.45, z);
                piezasValla.push(poste);
                if (anterior) {
                    const largoTablon = Math.hypot(x - anterior.x, z - anterior.z);
                    const angulo = Math.atan2(x - anterior.x, z - anterior.z);
                    [0.35, 0.7].forEach((alturaTablon) => {
                        const tablon = new THREE.BoxGeometry(0.06, 0.08, largoTablon);
                        tablon.rotateY(angulo);
                        tablon.translate((x + anterior.x) / 2, y + alturaTablon, (z + anterior.z) / 2);
                        piezasValla.push(tablon);
                    });
                }
                anterior = { x, z };
            }
        });
        if (piezasValla.length) grupo.add(new THREE.Mesh(mergeGeometries(piezasValla), materialMadera));
    }

    // Rocas
    const piezasRoca = [];
    for (let i = 0; i < 5; i++) {
        const z = zInicio - aleatorio() * largo;
        const lado = aleatorio() < 0.5 ? -1 : 1;
        const x = caminoX(z) + lado * entre(1.2, 7, aleatorio);
        const tam = entre(0.2, 0.6, aleatorio);
        const roca = new THREE.DodecahedronGeometry(tam, 0);
        roca.scale(1.3, 0.7, 1.1);
        roca.rotateY(aleatorio() * 3);
        roca.translate(x, alturaTerreno(x, z) + tam * 0.2, z);
        piezasRoca.push(roca);
    }
    grupo.add(new THREE.Mesh(mergeGeometries(piezasRoca), materialRoca));

    // Flores en rodales pequeños, como puntos de color (en píxel parecen flores dibujadas)
    const puntos = [];
    const colores = [];
    for (let r = 0; r < 4; r++) {
        const zc = zInicio - aleatorio() * largo;
        const lado = aleatorio() < 0.5 ? -1 : 1;
        const xc = caminoX(zc) + lado * entre(1.3, 6, aleatorio);
        const color = coloresFlor[Math.floor(aleatorio() * coloresFlor.length)];
        for (let f = 0; f < 14; f++) {
            const x = xc + entre(-1.2, 1.2, aleatorio);
            const z = zc + entre(-1.2, 1.2, aleatorio);
            if (Math.abs(x - caminoX(z)) < 1.0) continue;
            puntos.push(x, alturaTerreno(x, z) + entre(0.25, 0.55, aleatorio), z);
            colores.push(color.r, color.g, color.b);
        }
    }
    const geometriaFlores = new THREE.BufferGeometry();
    geometriaFlores.setAttribute("position", new THREE.Float32BufferAttribute(puntos, 3));
    geometriaFlores.setAttribute("color", new THREE.Float32BufferAttribute(colores, 3));
    grupo.add(new THREE.Points(geometriaFlores, materialFlores));

    // Una farola por trozo, que se enciende de noche
    const zf = zInicio - largo * 0.5;
    const ladoF = indice % 2 === 0 ? 1 : -1;
    const xf = caminoX(zf) + ladoF * 1.6;
    const yf = alturaTerreno(xf, zf);
    const palo = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 0.1), materialMadera);
    palo.position.set(xf, yf + 1.1, zf);
    const farol = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.28), materialFarol);
    farol.position.set(xf, yf + 2.25, zf);
    const halo = new THREE.Sprite(materialHalo);
    halo.position.copy(farol.position);
    halo.scale.set(2.2, 2.2, 1);
    grupo.add(palo, farol, halo);

    escena.add(grupo);
    return grupo;
}

const trozos = new Map();

function actualizarTrozos() {
    const actualIndice = Math.floor(-camara.position.z / ajustes.largoTrozo);
    const desde = actualIndice - 1;
    const hasta = actualIndice + ajustes.trozosDelante;
    for (let i = desde; i <= hasta; i++) {
        if (!trozos.has(i)) trozos.set(i, crearTrozo(i));
    }
    trozos.forEach((grupo, i) => {
        if (i < desde || i > hasta) {
            grupo.traverse((objeto) => {
                if (objeto.geometry) objeto.geometry.dispose();
            });
            escena.remove(grupo);
            trozos.delete(i);
        }
    });
}

// =====================================================================
// 10. LUCIÉRNAGAS (de noche, alrededor de la cámara)
// =====================================================================

const cuantasLuciernagas = movil ? 40 : 80;
const datosLuciernagas = [];
for (let i = 0; i < cuantasLuciernagas; i++) {
    datosLuciernagas.push({ x: entre(-12, 12), z: entre(-3, -30), y: entre(0.3, 1.6), fase: entre(0, 6.28), v: entre(0.4, 1.1) });
}
const geometriaLuciernagas = new THREE.BufferGeometry();
geometriaLuciernagas.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(cuantasLuciernagas * 3), 3));
const materialLuciernagas = new THREE.PointsMaterial({ color: "#f2ffb0", size: 0.045, transparent: true, opacity: 0 });
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
// 11. CAMINAR
// "metros" es la distancia recorrida. El castillo nunca llega: lo que
// queda se calcula con una exponencial que se acerca a cero sin tocarlo.
// =====================================================================

let metros = 0;
let metrosObjetivo = 0;
let caminandoSolo = false;
let segundosCaminando = 0;
const botonCaminar = document.getElementById("boton-caminar");
const pista = document.getElementById("pista");
const textoDistancia = document.getElementById("distancia");
const textoTiempo = document.getElementById("tiempo");
const textoDestino = document.getElementById("destino");

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

function formatoTiempo(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const seg = Math.floor(s % 60);
    return h + ":" + String(m).padStart(2, "0") + ":" + String(seg).padStart(2, "0");
}

function actualizarMarcador() {
    textoDistancia.textContent = metros.toFixed(2) + " m";
    textoTiempo.textContent = formatoTiempo(segundosCaminando);
    const queda = 2000 * Math.exp(-metros / 2500);
    textoDestino.textContent = queda >= 1000 ? (queda / 1000).toFixed(2) + " km al castillo" : queda.toFixed(0) + " m al castillo";
}

// =====================================================================
// 12. RATÓN Y DEDO
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
        1.6 + Math.sin(metros * 2.4) * 0.035 * paso,
        z
    );
    camara.rotation.set(inclinacion + punteroSuave.y * 0.02, -punteroSuave.x * 0.04 + (caminoX(z - 8) - caminoX(z)) * 0.03, 0);
    comunes.uCamara.value.copy(camara.position);
}

// =====================================================================
// 13. BOTONES
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
    materialSuelo.uniforms.uTierra.value = actual.tierra;
    materialSuelo.uniforms.uTierraClara.value = actual.tierraClara;
    materialSuelo.uniforms.uPiedra.value = actual.piedra;
    materialSuelo.uniforms.uJuntas.value = actual.juntas;
    hierba.material.uniforms.uBase.value = actual.hierbaBase;
    hierba.material.uniforms.uPunta.value = actual.hierbaPunta;

    luzSol.color.copy(actual.luz);
    luzSol.intensity = 1.6 - actual.noche * 1.1;
    luzCielo.color.copy(actual.ambiente);
    luzCielo.intensity = 2.0 - actual.noche * 1.1;
    materialFarol.color.setRGB(0.16 + actual.noche * 0.84, 0.13 + actual.noche * 0.62, 0.19 + actual.noche * 0.2);
    materialHalo.opacity = actual.noche * 0.85;
    materialFlores.color.setScalar(1 - actual.noche * 0.6);
}

// =====================================================================
// 14. RENDIMIENTO
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
// 15. TAMAÑO DE LA VENTANA
// =====================================================================

window.addEventListener("resize", () => {
    aplicarResolucion();
    ajustarEncuadre();
});
ajustarEncuadre();

// =====================================================================
// 16. CARGA DE LAS CAPAS Y BUCLE PRINCIPAL
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
    const antes = metros;
    metros += (metrosObjetivo - metros) * Math.min(1, delta * 2.5);
    if (metros - antes > 0.002) segundosCaminando += delta;

    actualizarRaton(delta);
    colocarCamara();
    aplicarMomento();
    actualizarTrozos();
    actualizarCapas(metros);
    actualizarMarcador();
    if (actual.noche > 0.02) moverLuciernagas(tiempo);
    else materialLuciernagas.opacity = 0;

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
        document.getElementById("cargando").classList.add("oculta");
        animar();
    })
    .catch((error) => {
        document.getElementById("cargando").textContent = "No se pudieron cargar las imágenes.";
        console.error(error);
    });
