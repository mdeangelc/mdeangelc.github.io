import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Un remanso del río Genal visto desde arriba. El suelo (piedras,
// rocas, hojarasca) se pinta una sola vez en una textura; cada fotograma
// solo se dibuja el agua encima, las ondas, las truchas y las hojas.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const MUNDO = 11;
const LADO_SUELO = Number(parametros.get("lado")) || (movil ? 1536 : 2048);
const LADO_MAPA = 256;
const VISTA = 9;
const ALTURA_CAMARA = 7;
const ajustes = {
    peces: movil ? 4 : 5,
    hojas: movil ? 30 : 40,
    helechos: movil ? 18 : 26,
    matas: movil ? 22 : 32,
    luciernagas: movil ? 30 : 44,
    ondas: movil ? 256 : 320,
    resolucionMax: movil ? 1.5 : 2,
    trozosPorFotograma: movil ? 2 : 4
};


// =====================================================================
// 2. RENDERIZADOR, VISTA Y CÁMARA
// La cámara mira hacia abajo y gira un poco para que el río cruce la
// pantalla en diagonal, tanto en horizontal como en vertical.
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderizador.setClearColor(0x000000, 0);
document.body.prepend(renderizador.domElement);

const gl = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && (gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
const TIPO_HDR = hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType;

const vista = {
    centro: new THREE.Vector2(0.25, 0),
    tam: new THREE.Vector2(VISTA, 5),
    giro: new THREE.Vector2(1, 0),
    ang: 0
};

const camara = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
camara.position.z = 5;

let escalaResolucion = 1;

function colocarVista() {
    const aspecto = innerWidth / innerHeight;
    if (aspecto >= 1) vista.tam.set(VISTA, VISTA / aspecto);
    else vista.tam.set(VISTA * aspecto, VISTA);
    vista.ang = aspecto >= 1 ? 0.22 : 0.52;
    vista.giro.set(Math.cos(vista.ang), Math.sin(vista.ang));
    vista.centro.set(aspecto >= 1 ? 0.25 : 0.45, aspecto >= 1 ? 0 : 0.1);
    camara.left = -vista.tam.x / 2;
    camara.right = vista.tam.x / 2;
    camara.top = vista.tam.y / 2;
    camara.bottom = -vista.tam.y / 2;
    camara.position.set(vista.centro.x, vista.centro.y, 5);
    camara.rotation.set(0, 0, vista.ang);
    camara.updateProjectionMatrix();
    camara.updateMatrixWorld();
}

function aMundo(u, v, destino) {
    const lx = (u - 0.5) * vista.tam.x;
    const ly = (v - 0.5) * vista.tam.y;
    destino.x = vista.centro.x + lx * vista.giro.x - ly * vista.giro.y;
    destino.y = vista.centro.y + lx * vista.giro.y + ly * vista.giro.x;
    return destino;
}

function aPantalla(x, y, destino) {
    const lx = x - vista.centro.x;
    const ly = y - vista.centro.y;
    destino.x = (lx * vista.giro.x + ly * vista.giro.y) / vista.tam.x + 0.5;
    destino.y = (-lx * vista.giro.y + ly * vista.giro.x) / vista.tam.y + 0.5;
    return destino;
}

function aLocal(x, y, destino) {
    aPantalla(x, y, destino);
    destino.x = (destino.x - 0.5) * vista.tam.x;
    destino.y = (destino.y - 0.5) * vista.tam.y;
    return destino;
}


// =====================================================================
// 3. TEXTURA DE RUIDO
// Una textura pequeña que se repite: en rojo y verde la pendiente de un
// ruido (para las ondulaciones del agua), en azul un ruido suave (para
// la sombra de los árboles) y en alfa un ruido fino (para la espuma).
// =====================================================================

function hashEntero(x, y, s) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function ruidoRepetido(x, y, periodo, semilla) {
    const fx = x * periodo;
    const fy = y * periodo;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let ux = fx - ix;
    let uy = fy - iy;
    ux = ux * ux * (3 - 2 * ux);
    uy = uy * uy * (3 - 2 * uy);
    const x0 = ((ix % periodo) + periodo) % periodo;
    const y0 = ((iy % periodo) + periodo) % periodo;
    const x1 = (x0 + 1) % periodo;
    const y1 = (y0 + 1) % periodo;
    const a = hashEntero(x0, y0, semilla);
    const b = hashEntero(x1, y0, semilla);
    const c = hashEntero(x0, y1, semilla);
    const d = hashEntero(x1, y1, semilla);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmRepetido(x, y, periodo, octavas, semilla) {
    let suma = 0;
    let amplitud = 0.5;
    let total = 0;
    for (let o = 0; o < octavas; o++) {
        suma += amplitud * ruidoRepetido(x, y, periodo << o, semilla + o * 17);
        total += amplitud;
        amplitud *= 0.5;
    }
    return suma / total;
}

function crearRuido() {
    const lado = 256;
    const campo = new Float32Array(lado * lado);
    for (let y = 0; y < lado; y++) {
        for (let x = 0; x < lado; x++) campo[y * lado + x] = fbmRepetido(x / lado, y / lado, 8, 4, 3);
    }
    const datos = new Uint8Array(lado * lado * 4);
    for (let y = 0; y < lado; y++) {
        for (let x = 0; x < lado; x++) {
            const i = y * lado + x;
            const dx = campo[y * lado + ((x + 1) % lado)] - campo[y * lado + ((x + lado - 1) % lado)];
            const dy = campo[((y + 1) % lado) * lado + x] - campo[((y + lado - 1) % lado) * lado + x];
            datos[i * 4] = Math.max(0, Math.min(255, 128 + dx * 2600));
            datos[i * 4 + 1] = Math.max(0, Math.min(255, 128 + dy * 2600));
            datos[i * 4 + 2] = fbmRepetido(x / lado, y / lado, 5, 5, 41) * 255;
            datos[i * 4 + 3] = fbmRepetido(x / lado, y / lado, 12, 3, 77) * 255;
        }
    }
    const textura = new THREE.DataTexture(datos, lado, lado, THREE.RGBAFormat);
    textura.wrapS = textura.wrapT = THREE.RepeatWrapping;
    textura.magFilter = THREE.LinearFilter;
    textura.minFilter = THREE.LinearFilter;
    textura.needsUpdate = true;
    return textura;
}

const texturaRuido = crearRuido();


// =====================================================================
// 4. UNIFORMES COMUNES Y TROZOS DE GLSL
// =====================================================================

const comunes = {
    tRuido: { value: texturaRuido },
    uTiempo: { value: 0 },
    uSalida: { value: hayFlotantes ? 1 : 0.25 },
    uCentro: { value: vista.centro },
    uTam: { value: vista.tam },
    uGiro: { value: vista.giro },
    uSol: { value: new THREE.Vector3(-0.5, 0.4, 0.7).normalize() },
    uColorSol: { value: new THREE.Vector3(1, 1, 1) },
    uAmbiente: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
    uCielo: { value: new THREE.Vector3(0.6, 0.7, 0.8) },
    uAbsorcion: { value: new THREE.Vector3(1, 0.3, 0.4) },
    uColorAgua: { value: new THREE.Vector3(0.05, 0.2, 0.2) },
    uBrilloDir: { value: new THREE.Vector3(0, 0, 1) },
    uNoche: { value: 0 }
};

const GLSL_COMUN = `
#define MUNDO ${MUNDO.toFixed(1)}
#define PI 3.14159265

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float ruido(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
        s += a * ruido(p);
        p = m * p;
        a *= 0.5;
    }
    return s;
}

float centroCauce(float x) {
    return 0.45 * sin(x * 0.5 + 0.4) + 0.15 * sin(x * 1.3 + 2.0);
}

float anchoCauce(float x) {
    float k = x - 0.2;
    return 1.65 + 0.85 * exp(-k * k / 4.5);
}

float distCauce(vec2 p) {
    return (p.y - centroCauce(p.x)) / anchoCauce(p.x);
}

vec2 corriente(vec2 p) {
    float d = distCauce(p);
    float pendiente = 0.225 * cos(p.x * 0.5 + 0.4) + 0.195 * cos(p.x * 1.3 + 2.0);
    vec2 t = normalize(vec2(1.0, pendiente));
    float v = 0.3 * (1.65 / anchoCauce(p.x)) * clamp(1.0 - d * d, 0.05, 1.0);
    vec2 q = p - vec2(1.1, 1.35);
    float r2 = dot(q, q);
    vec2 giro = vec2(-q.y, q.x) * 0.16 * exp(-r2 / 0.8);
    return t * v + giro;
}

vec3 colorHoja(float id) {
    vec3 a = vec3(0.88, 0.66, 0.16);
    vec3 b = vec3(0.82, 0.40, 0.10);
    vec3 c = vec3(0.50, 0.28, 0.11);
    vec3 d = vec3(0.64, 0.62, 0.20);
    if (id < 0.3) return mix(a, b, id / 0.3);
    if (id < 0.65) return mix(b, c, (id - 0.3) / 0.35);
    if (id < 0.85) return mix(c, a, (id - 0.65) / 0.4);
    return mix(d, a, (id - 0.85) / 0.3);
}

float hojaCastano(vec2 q, out float vena) {
    float t = clamp((q.x + 0.85) / 1.85, 0.0, 1.0);
    float w = 0.34 * pow(sin(PI * pow(t, 0.8)), 0.8);
    float diente = fract(t * 15.0);
    w += 0.035 * (1.0 - diente) * smoothstep(0.06, 0.22, t) * smoothstep(1.0, 0.82, t);
    float dentro = w - abs(q.y);
    if (q.x < -0.85) dentro = 0.014 - abs(q.y);
    dentro = min(dentro, min(1.0 - q.x, q.x + 1.0));
    float central = smoothstep(0.014, 0.0, abs(q.y));
    float lateral = abs(fract((q.x - abs(q.y) * 1.3) * 8.5) - 0.5);
    vena = max(central, smoothstep(0.07, 0.0, lateral) * 0.55 * smoothstep(0.015, 0.05, abs(q.y)));
    return dentro;
}
`;

const GLSL_VISTA = `
uniform vec2 uCentro;
uniform vec2 uTam;
uniform vec2 uGiro;

vec2 aMundo(vec2 uv) {
    vec2 l = (uv - 0.5) * uTam;
    return uCentro + vec2(l.x * uGiro.x - l.y * uGiro.y, l.x * uGiro.y + l.y * uGiro.x);
}

vec2 aPantalla(vec2 w) {
    vec2 l = w - uCentro;
    l = vec2(l.x * uGiro.x + l.y * uGiro.y, -l.x * uGiro.y + l.y * uGiro.x);
    return l / uTam + 0.5;
}

vec2 giroAMundo(vec2 v) {
    return vec2(v.x * uGiro.x - v.y * uGiro.y, v.x * uGiro.y + v.y * uGiro.x);
}

vec2 aSuelo(vec2 w) {
    return w / MUNDO + 0.5;
}

float descodificar(vec4 r) {
    return (r.b + r.a / 255.0) * 3.0 - 1.5;
}
`;

const GLSL_LUZ = `
uniform sampler2D tRuido;
uniform float uTiempo;
uniform float uSalida;
uniform vec3 uSol;
uniform vec3 uColorSol;
uniform vec3 uAmbiente;
uniform vec3 uCielo;
uniform float uNoche;

float dosel(vec2 w) {
    float d = abs(distCauce(w));
    vec2 vaiven = vec2(sin(uTiempo * 0.37), cos(uTiempo * 0.29)) * 0.03 + vec2(sin(uTiempo * 1.3), sin(uTiempo * 1.1)) * 0.006;
    float a = texture2D(tRuido, w * 0.085 + vaiven).b;
    float b = texture2D(tRuido, w * 0.23 - vaiven * 1.7 + 0.37).b;
    float n = a * 0.62 + b * 0.38;
    float umbral = mix(0.44, 0.6, smoothstep(0.55, 1.35, d));
    return 1.0 - smoothstep(umbral - 0.035, umbral + 0.035, n);
}
`;


// =====================================================================
// 5. EL SUELO HORNEADO
// Un shader pinta el lecho del río y las orillas en dos texturas: una
// con el color y la oclusión, otra con la normal y la altura. Se hace
// por trozos, unos pocos en cada fotograma, para no trabar el móvil.
// =====================================================================

const ROCAS = [
    [-2.7, 0.95, 0.58, 0.9],
    [1.7, 2.75, 0.85, 0.85],
    [3.4, -1.75, 0.62, 0.75],
    [-1.3, -2.45, 0.75, 0.7],
    [4.6, 1.35, 0.5, 0.65],
    [-4.3, -0.55, 0.5, 0.62],
    [0.9, -0.75, 0.36, 0.32],
    [-0.7, 1.05, 0.3, 0.26],
    [2.5, 0.55, 0.28, 0.22],
    [-3.6, 1.9, 0.6, 0.6]
];

const GLSL_HORNO = `
uniform float uModo;
uniform float uPaso;
uniform vec4 uRocas[10];
uniform sampler2D tRelieve;
varying vec2 vUv;

float terreno(vec2 p, out float d) {
    d = distCauce(p);
    float ad = abs(d) + (fbm(p * 0.55 + 3.1) - 0.5) * 0.3;
    float kx = p.x - 0.2;
    float poza = exp(-kx * kx / 3.2);
    float fondo = -0.34 - 0.95 * poza;
    float lecho = fondo * (1.0 - smoothstep(0.12, 1.0, ad) * 0.95);
    lecho += (fbm(p * 1.3) - 0.5) * 0.12;
    float orilla = 0.03 + (ad - 1.0) * 0.6 + (fbm(p * 0.8 + 7.0) - 0.45) * 0.25 * smoothstep(1.0, 1.4, ad);
    return mix(lecho, orilla, smoothstep(0.9, 1.06, ad));
}

float perfilRoca(vec2 p, vec2 c, float radio, float alto, float semilla, float base) {
    float dd = length(p - c) / radio;
    if (dd > 1.6) return -9.0;
    dd += (fbm(p * 2.2 / max(radio, 0.3) + semilla) - 0.5) * 0.45;
    float perfil = sqrt(max(0.0, 1.0 - dd * dd));
    if (perfil <= 0.0) return -9.0;
    return base + alto * pow(perfil, 0.7) + (ruido(p * 9.0 + semilla) - 0.5) * 0.03 * perfil;
}

float rocas(vec2 p, float base) {
    float alto = base;
    for (int i = 0; i < 10; i++) {
        vec4 r = uRocas[i];
        alto = max(alto, perfilRoca(p, r.xy, r.z, r.w, float(i) * 5.3, base));
    }
    vec2 c = p / 1.15;
    vec2 ic = floor(c);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = ic + vec2(float(i), float(j));
            if (hash12(id + 4.7) < 0.5) continue;
            vec2 centro = (id + 0.2 + 0.6 * hash22(id)) * 1.15;
            float dc = abs(distCauce(centro));
            if (dc < 0.82 || dc > 1.7) continue;
            float radio = 0.16 + 0.26 * hash12(id + 9.1);
            alto = max(alto, perfilRoca(p, centro, radio, radio * 0.85, hash12(id) * 40.0, base));
        }
    }
    return alto;
}

vec3 guijarros(vec2 p, float escala, float densidad, float semilla) {
    vec2 c = p / escala;
    vec2 ic = floor(c);
    vec2 fc = fract(c);
    float mejor = 9.0;
    float idm = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 id = ic + g + semilla;
            if (hash12(id + 1.3) > densidad) continue;
            vec2 q = g + 0.25 + 0.5 * hash22(id) - fc;
            float a = hash12(id + 2.9) * 6.2832;
            float ca = cos(a);
            float sa = sin(a);
            q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
            q.x /= 1.0 + 0.7 * hash12(id + 5.1);
            float radio = 0.32 + 0.2 * hash12(id + 6.7);
            float dd = length(q) / radio;
            if (dd < mejor) {
                mejor = dd;
                idm = hash12(id + 8.3);
            }
        }
    }
    return vec3(sqrt(max(0.0, 1.0 - mejor * mejor)), idm, mejor);
}

struct Suelo {
    float h;
    float base;
    float roca;
    float d;
    float piedra;
    float idPiedra;
    float arena;
};

Suelo calcular(vec2 p) {
    Suelo s;
    float d;
    float base = terreno(p, d);
    s.d = d;
    s.base = base;
    float conRocas = rocas(p, base);
    s.roca = smoothstep(0.0, 0.03, conRocas - base);
    s.arena = smoothstep(-0.55, -0.95, base) * smoothstep(0.35, 0.6, fbm(p * 0.6 + 11.0));
    float zona1 = smoothstep(0.16, 0.02, base) * (1.0 - s.arena);
    float zona2 = smoothstep(0.24, 0.06, base) * (1.0 - s.arena * 0.6);
    vec3 g1 = guijarros(p, 0.16, 0.72, 0.0);
    vec3 g2 = guijarros(p, 0.06, 0.85, 31.0);
    float a1 = g1.x * zona1 * 0.05;
    float a2 = g2.x * zona2 * 0.02;
    if (a1 >= a2) {
        s.piedra = g1.x * zona1;
        s.idPiedra = g1.y;
    } else {
        s.piedra = g2.x * zona2;
        s.idPiedra = g2.y;
    }
    s.h = max(conRocas, base + max(a1, a2) * (1.0 - s.roca));
    return s;
}

vec3 colorPiedra(float id, vec2 p) {
    vec3 c = mix(vec3(0.58, 0.57, 0.54), vec3(0.42, 0.41, 0.39), fract(id * 7.3));
    if (id < 0.1) c = vec3(0.70, 0.52, 0.36);
    else if (id < 0.26) c = vec3(0.84, 0.82, 0.77);
    else if (id < 0.38) c = vec3(0.28, 0.31, 0.27);
    else if (id < 0.48) c = vec3(0.56, 0.43, 0.33);
    c *= 0.86 + 0.28 * fract(id * 13.7);
    c *= 0.9 + 0.2 * ruido(p * 220.0 + id * 50.0);
    return c;
}

vec3 colorRoca(vec2 p, float h) {
    float foliacion = sin(dot(p, vec2(0.6, 0.8)) * 48.0 + fbm(p * 2.0) * 9.0);
    vec3 c = vec3(0.56, 0.56, 0.55) * (0.8 + 0.3 * fbm(p * 5.0 + 2.0)) * (0.94 + 0.06 * foliacion);
    c = mix(c, vec3(0.58, 0.5, 0.4), smoothstep(0.55, 0.75, fbm(p * 1.7 + 9.0)) * 0.6);
    float liquen = smoothstep(0.8, 0.86, fbm(p * 14.0 + 3.0)) * step(0.06, h);
    c = mix(c, vec3(0.74, 0.76, 0.6), liquen * 0.7);
    float musgo = smoothstep(0.48, 0.7, fbm(p * 3.0 + 13.0)) * smoothstep(0.03, 0.14, h);
    c = mix(c, vec3(0.24, 0.35, 0.11) * (0.75 + 0.5 * ruido(p * 60.0)), musgo * 0.85);
    c = mix(c, c * vec3(0.72, 0.7, 0.48), smoothstep(0.0, -0.12, h) * 0.7);
    return c;
}

vec4 hojarasca(vec2 p) {
    vec4 res = vec4(0.0);
    for (int capa = 0; capa < 3; capa++) {
        vec2 c = p / 0.16 + float(capa) * vec2(17.3, 9.1);
        vec2 ic = floor(c);
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 id = ic + vec2(float(i), float(j)) + float(capa) * 100.0;
                if (hash12(id + 0.7) > 0.75) continue;
                vec2 q = c - (ic + vec2(float(i), float(j)) + hash22(id));
                float a = hash12(id + 3.3) * 6.2832;
                q = vec2(cos(a) * q.x + sin(a) * q.y, -sin(a) * q.x + cos(a) * q.y);
                float largo = 0.6 + 0.35 * hash12(id + 5.5);
                vec2 lq = q / largo;
                if (abs(lq.x) > 1.0 || abs(lq.y) > 0.48) continue;
                float vena;
                float dentro = hojaCastano(lq, vena);
                float alfa = smoothstep(0.0, 0.025, dentro);
                if (alfa <= 0.0) continue;
                float tono = hash12(id + 7.7);
                vec3 col = colorHoja(tono * 0.9 + 0.1) * vec3(0.78, 0.74, 0.7);
                col = mix(col, vec3(0.36, 0.24, 0.13), smoothstep(0.4, 0.8, ruido(lq * 4.0 + id)) * 0.6);
                col *= 1.0 - vena * 0.22;
                col *= 0.85 + 0.15 * smoothstep(0.0, 0.08, dentro);
                res.rgb = mix(res.rgb * (1.0 - alfa * 0.35), col, alfa);
                res.a = max(res.a, alfa);
            }
        }
    }
    return res;
}

vec4 erizos(vec2 p) {
    vec2 c = p / 0.5;
    vec2 ic = floor(c);
    if (hash12(ic + 21.0) > 0.28) return vec4(0.0);
    vec2 q = (fract(c) - 0.25 - 0.5 * hash22(ic + 3.0)) * 0.5;
    float r = length(q);
    float radio = 0.026 + 0.014 * hash12(ic + 2.0);
    float ang = atan(q.y, q.x);
    float puas = smoothstep(0.55, 1.0, 0.5 + 0.5 * cos(ang * 38.0 + ruido(q * 300.0) * 3.0));
    float anillo = (1.0 - smoothstep(radio * 0.7, radio * 1.45, r)) * puas;
    float cuerpo = smoothstep(radio * 0.78, radio * 0.68, r);
    vec3 col = vec3(0.6, 0.5, 0.22);
    if (hash12(ic + 9.0) < 0.45) {
        float castana = smoothstep(radio * 0.55, radio * 0.45, length(q - vec2(radio * 0.12, 0.0)));
        col = mix(vec3(0.5, 0.42, 0.24), vec3(0.32, 0.16, 0.07) * (0.8 + 0.5 * smoothstep(0.3, 0.0, length(q / radio - vec2(0.2, 0.15)))), castana);
    }
    return vec4(col, max(anillo * 0.8, cuerpo));
}

vec3 albedo(vec2 p, Suelo s) {
    vec3 arena = vec3(0.72, 0.64, 0.5) * (0.85 + 0.25 * ruido(p * 60.0)) * (0.92 + 0.12 * ruido(p * 300.0));
    vec3 grava = mix(vec3(0.5, 0.47, 0.42), vec3(0.64, 0.58, 0.5), ruido(p * 140.0)) * (0.85 + 0.2 * ruido(p * 400.0));
    vec3 lecho = mix(grava, arena, s.arena);
    lecho = mix(lecho, vec3(0.44, 0.41, 0.33), smoothstep(-0.6, -1.1, s.base) * 0.5);
    vec3 piedra = colorPiedra(s.idPiedra, p) * (0.72 + 0.28 * s.piedra);
    lecho = mix(lecho, piedra, smoothstep(0.0, 0.2, s.piedra));
    float bajo = smoothstep(0.02, -0.12, s.h);
    lecho = mix(lecho, lecho * vec3(0.86, 0.84, 0.6) + vec3(0.02, 0.03, 0.0), bajo * 0.6);
    float algas = smoothstep(0.6, 0.72, fbm(p * 1.4 + 31.0)) * smoothstep(-0.05, -0.25, s.h) * smoothstep(-0.9, -0.5, s.h);
    lecho = mix(lecho, vec3(0.24, 0.31, 0.1) * (0.7 + 0.5 * ruido(p * vec2(30.0, 90.0))), algas * 0.7);
    float playa = smoothstep(-0.01, 0.06, s.h);
    lecho = mix(lecho, lecho * 1.12 + 0.03, playa);

    vec3 tierra = vec3(0.3, 0.22, 0.15) * (0.75 + 0.45 * fbm(p * 3.0));
    float musgo = smoothstep(0.45, 0.62, fbm(p * 2.2 + 21.0)) * (0.5 + 0.5 * smoothstep(0.5, 0.1, s.base));
    vec3 verde = vec3(0.25, 0.37, 0.12) * (0.7 + 0.5 * ruido(p * 70.0)) * (0.85 + 0.3 * fbm(p * 9.0));
    tierra = mix(tierra, verde, musgo * 0.85);
    float giro = ruido(floor(p * 3.0)) * 6.2832;
    vec2 pg = vec2(cos(giro) * p.x + sin(giro) * p.y, -sin(giro) * p.x + cos(giro) * p.y);
    float briznas = ruido(pg * vec2(14.0, 160.0));
    float hierba = smoothstep(0.5, 0.68, fbm(p * 1.1 + 40.0));
    tierra = mix(tierra, vec3(0.34, 0.46, 0.16) * (0.55 + 0.75 * briznas), hierba * 0.8);
    vec4 hojas = hojarasca(p);
    float cubre = smoothstep(0.04, 0.2, s.base) * (0.55 + 0.45 * smoothstep(0.3, 0.6, fbm(p * 0.9 + 5.0)));
    tierra = mix(tierra, hojas.rgb, hojas.a * cubre);
    vec4 erizo = erizos(p);
    tierra = mix(tierra * (1.0 - erizo.a * 0.3), erizo.rgb, erizo.a * smoothstep(0.08, 0.2, s.base));

    float seco = smoothstep(0.04, 0.12, s.base);
    vec3 col = mix(lecho, tierra, seco);
    col = mix(col, colorRoca(p, s.h), s.roca);
    float mojado = smoothstep(0.06, 0.0, s.h) * smoothstep(-0.04, 0.0, s.h);
    col *= 1.0 - mojado * 0.35;
    return col;
}

float oclusion(vec2 uv, float h) {
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float r = 0.04 + 0.03 * float(i);
        vec2 o = vec2(cos(a), sin(a)) * r / MUNDO;
        float hn = descodificar(texture2D(tRelieve, uv + o));
        occ += clamp((hn - h) / r, 0.0, 1.0);
    }
    return clamp(1.0 - occ / 12.0 * 1.3, 0.3, 1.0);
}

void main() {
    vec2 p = (vUv - 0.5) * MUNDO;
    if (uModo > 1.5) {
        Suelo s = calcular(p);
        gl_FragColor = vec4(s.roca, clamp(s.d * 0.25 + 0.5, 0.0, 1.0), 0.0, 1.0);
        return;
    }
    if (uModo > 0.5) {
        float e = uPaso * MUNDO;
        float h = calcular(p).h;
        float hx = calcular(p + vec2(e, 0.0)).h;
        float hy = calcular(p + vec2(0.0, e)).h;
        vec3 n = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0));
        float h01 = clamp((h + 1.5) / 3.0, 0.0, 0.9999);
        float alto = floor(h01 * 255.0) / 255.0;
        float bajo = fract(h01 * 255.0);
        gl_FragColor = vec4(n.xy * 0.5 + 0.5, alto, bajo);
        return;
    }
    Suelo s = calcular(p);
    float h = descodificar(texture2D(tRelieve, vUv));
    float ao = oclusion(vUv, h);
    ao *= 0.7 + 0.3 * sqrt(max(s.piedra, 1.0 - smoothstep(0.0, 0.2, s.piedra)));
    gl_FragColor = vec4(clamp(albedo(p, s), 0.0, 1.0), ao);
}
`;

const VERTICE_PANTALLA = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function objetivo(ancho, alto, opciones = {}) {
    return new THREE.WebGLRenderTarget(ancho, alto, {
        type: opciones.tipo || THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: opciones.filtro || THREE.LinearFilter,
        magFilter: opciones.filtro || THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false
    });
}

const sueloColor = objetivo(LADO_SUELO, LADO_SUELO);
const sueloRelieve = objetivo(LADO_SUELO, LADO_SUELO);
const mapaRelieve = objetivo(LADO_MAPA, LADO_MAPA, { filtro: THREE.NearestFilter });
const mapaRoca = objetivo(LADO_MAPA, LADO_MAPA, { filtro: THREE.NearestFilter });

const materialHorno = new THREE.ShaderMaterial({
    uniforms: {
        uModo: { value: 1 },
        uPaso: { value: 1 / LADO_SUELO },
        uRocas: { value: ROCAS.map((r) => new THREE.Vector4(...r)) },
        tRelieve: { value: null }
    },
    vertexShader: VERTICE_PANTALLA,
    fragmentShader: GLSL_COMUN + GLSL_VISTA + GLSL_HORNO,
    depthTest: false,
    depthWrite: false
});

const planoPantalla = new THREE.PlaneGeometry(2, 2);
const escenaHorno = new THREE.Scene();
const cuadroHorno = new THREE.Mesh(planoPantalla, materialHorno);
cuadroHorno.frustumCulled = false;
escenaHorno.add(cuadroHorno);

const TROZOS = 4;
const tareasHorno = [];
for (let modo = 1; modo >= 0; modo--) {
    for (let ty = 0; ty < TROZOS; ty++) {
        for (let tx = 0; tx < TROZOS; tx++) tareasHorno.push({ modo, tx, ty, destino: modo === 1 ? sueloRelieve : sueloColor, lado: LADO_SUELO });
    }
}
tareasHorno.push({ modo: 1, destino: mapaRelieve, lado: LADO_MAPA });
tareasHorno.push({ modo: 2, destino: mapaRoca, lado: LADO_MAPA });
const totalTareas = tareasHorno.length;

function hornearTrozo() {
    const t = tareasHorno.shift();
    if (!t) return false;
    materialHorno.uniforms.uModo.value = t.modo;
    materialHorno.uniforms.uPaso.value = 1 / t.lado;
    materialHorno.uniforms.tRelieve.value = t.modo === 0 ? sueloRelieve.texture : null;
    if (t.tx === undefined) {
        t.destino.scissorTest = false;
    } else {
        const paso = t.lado / TROZOS;
        t.destino.scissor.set(t.tx * paso, t.ty * paso, paso, paso);
        t.destino.scissorTest = true;
    }
    renderizador.setRenderTarget(t.destino);
    renderizador.render(escenaHorno, camara);
    renderizador.setRenderTarget(null);
    t.destino.scissorTest = false;
    return true;
}


// =====================================================================
// 6. MAPA EN EL PROCESADOR
// Se lee una versión pequeña del relieve para saber, desde JavaScript,
// dónde hay agua honda, dónde orilla y dónde roca.
// =====================================================================

const alturas = new Float32Array(LADO_MAPA * LADO_MAPA);
const hayRoca = new Float32Array(LADO_MAPA * LADO_MAPA);

function leerMapas() {
    const buffer = new Uint8Array(LADO_MAPA * LADO_MAPA * 4);
    renderizador.readRenderTargetPixels(mapaRelieve, 0, 0, LADO_MAPA, LADO_MAPA, buffer);
    for (let i = 0; i < alturas.length; i++) alturas[i] = (buffer[i * 4 + 2] / 255 + buffer[i * 4 + 3] / 255 / 255) * 3 - 1.5;
    renderizador.readRenderTargetPixels(mapaRoca, 0, 0, LADO_MAPA, LADO_MAPA, buffer);
    for (let i = 0; i < hayRoca.length; i++) hayRoca[i] = buffer[i * 4] / 255;
}

function muestra(mapa, x, y) {
    const u = (x / MUNDO + 0.5) * LADO_MAPA - 0.5;
    const v = (y / MUNDO + 0.5) * LADO_MAPA - 0.5;
    const i = Math.max(0, Math.min(LADO_MAPA - 2, Math.floor(u)));
    const j = Math.max(0, Math.min(LADO_MAPA - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i));
    const fv = Math.max(0, Math.min(1, v - j));
    const a = mapa[j * LADO_MAPA + i];
    const b = mapa[j * LADO_MAPA + i + 1];
    const c = mapa[(j + 1) * LADO_MAPA + i];
    const d = mapa[(j + 1) * LADO_MAPA + i + 1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}

const alturaEn = (x, y) => muestra(alturas, x, y);
const rocaEn = (x, y) => muestra(hayRoca, x, y);
const profundidadEn = (x, y) => Math.max(0, -alturaEn(x, y));

function centroCauce(x) {
    return 0.45 * Math.sin(x * 0.5 + 0.4) + 0.15 * Math.sin(x * 1.3 + 2.0);
}

function anchoCauce(x) {
    const k = x - 0.2;
    return 1.65 + 0.85 * Math.exp((-k * k) / 4.5);
}

function distCauce(x, y) {
    return (y - centroCauce(x)) / anchoCauce(x);
}

function corriente(x, y, destino) {
    const d = distCauce(x, y);
    const pendiente = 0.225 * Math.cos(x * 0.5 + 0.4) + 0.195 * Math.cos(x * 1.3 + 2.0);
    const largo = Math.hypot(1, pendiente);
    const v = 0.3 * (1.65 / anchoCauce(x)) * Math.max(0.05, Math.min(1, 1 - d * d));
    const qx = x - 1.1;
    const qy = y - 1.35;
    const giro = 0.16 * Math.exp(-(qx * qx + qy * qy) / 0.8);
    destino.x = (v / largo) - qy * giro;
    destino.y = (v * pendiente / largo) + qx * giro;
    return destino;
}


// =====================================================================
// 7. LAS ONDAS
// Una simulación de la ecuación de ondas en la pantalla. Cada toque
// suelta una gota; las orillas hacen de pared y las ondas rebotan.
// =====================================================================

const MAX_GOTAS = 8;
const gotasPendientes = [];
let ondas = [];
let pasoOndas = new THREE.Vector2();

const materialOndas = new THREE.ShaderMaterial({
    uniforms: {
        tPrevio: { value: null },
        tRelieve: { value: sueloRelieve.texture },
        uPaso: { value: pasoOndas },
        uGotas: { value: Array.from({ length: MAX_GOTAS }, () => new THREE.Vector4()) },
        uCentro: comunes.uCentro,
        uTam: comunes.uTam,
        uGiro: comunes.uGiro
    },
    vertexShader: VERTICE_PANTALLA,
    fragmentShader: GLSL_COMUN + GLSL_VISTA + `
        uniform sampler2D tPrevio;
        uniform sampler2D tRelieve;
        uniform vec2 uPaso;
        uniform vec4 uGotas[${MAX_GOTAS}];
        varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tPrevio, vUv);
            float s = texture2D(tPrevio, vUv + vec2(uPaso.x, 0.0)).r + texture2D(tPrevio, vUv - vec2(uPaso.x, 0.0)).r
                    + texture2D(tPrevio, vUv + vec2(0.0, uPaso.y)).r + texture2D(tPrevio, vUv - vec2(0.0, uPaso.y)).r;
            float n = (s * 0.5 - c.g) * 0.985;
            vec2 l = (vUv - 0.5) * uTam;
            for (int i = 0; i < ${MAX_GOTAS}; i++) {
                vec4 g = uGotas[i];
                if (g.w == 0.0) continue;
                vec2 d = l - g.xy;
                n += g.w * exp(-dot(d, d) / (g.z * g.z));
            }
            float h = descodificar(texture2D(tRelieve, aSuelo(aMundo(vUv))));
            n *= smoothstep(0.012, -0.02, h);
            vec2 borde = min(vUv, 1.0 - vUv);
            n *= smoothstep(0.0, 0.02, min(borde.x, borde.y));
            gl_FragColor = vec4(n, c.r, 0.0, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaOndas = new THREE.Scene();
const cuadroOndas = new THREE.Mesh(planoPantalla, materialOndas);
cuadroOndas.frustumCulled = false;
escenaOndas.add(cuadroOndas);

function crearOndas() {
    ondas.forEach((o) => o.dispose());
    const aspecto = innerWidth / innerHeight;
    const ancho = aspecto >= 1 ? ajustes.ondas : Math.round(ajustes.ondas * aspecto);
    const alto = aspecto >= 1 ? Math.round(ajustes.ondas / aspecto) : ajustes.ondas;
    const tipo = hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType;
    ondas = [objetivo(ancho, alto, { tipo }), objetivo(ancho, alto, { tipo })];
    pasoOndas.set(1 / ancho, 1 / alto);
    ondas.forEach((o) => {
        renderizador.setRenderTarget(o);
        renderizador.clear();
    });
    renderizador.setRenderTarget(null);
}

function soltarGota(lx, ly, radio, fuerza) {
    if (gotasPendientes.length >= 24) gotasPendientes.shift();
    gotasPendientes.push([lx, ly, radio, fuerza]);
}

const auxLocal = new THREE.Vector2();

function gotaEnMundo(x, y, radio, fuerza) {
    aLocal(x, y, auxLocal);
    soltarGota(auxLocal.x, auxLocal.y, radio, fuerza);
}

let restoOndas = 0;

function simularOndas(delta) {
    if (!hayFlotantes) return;
    restoOndas += delta * 50;
    let pasos = Math.min(3, Math.floor(restoOndas));
    restoOndas -= pasos;
    if (restoOndas > 3) restoOndas = 0;
    const gotas = materialOndas.uniforms.uGotas.value;
    for (let p = 0; p < pasos; p++) {
        for (let i = 0; i < MAX_GOTAS; i++) {
            const g = p === 0 ? gotasPendientes.shift() : null;
            if (g) gotas[i].set(g[0], g[1], g[2], g[3]);
            else gotas[i].set(0, 0, 1, 0);
        }
        materialOndas.uniforms.tPrevio.value = ondas[0].texture;
        renderizador.setRenderTarget(ondas[1]);
        renderizador.render(escenaOndas, camara);
        ondas.reverse();
    }
    renderizador.setRenderTarget(null);
}


// =====================================================================
// 8. EL AGUA
// El shader principal: lecho visto a través del agua (refracción,
// cáusticas, color de la poza), las truchas, las sombras, los reflejos
// de las copas y el brillo del sol o de la luna en las ondas.
// =====================================================================

const materialAgua = new THREE.ShaderMaterial({
    uniforms: {
        ...comunes,
        tSuelo: { value: sueloColor.texture },
        tRelieve: { value: sueloRelieve.texture },
        tOndas: { value: null },
        tPeces: { value: null },
        tSombras: { value: null },
        uPasoOndas: { value: pasoOndas }
    },
    vertexShader: VERTICE_PANTALLA,
    fragmentShader: GLSL_COMUN + GLSL_VISTA + GLSL_LUZ + `
        uniform sampler2D tSuelo;
        uniform sampler2D tRelieve;
        uniform sampler2D tOndas;
        uniform sampler2D tPeces;
        uniform sampler2D tSombras;
        uniform vec2 uPasoOndas;
        uniform vec3 uAbsorcion;
        uniform vec3 uColorAgua;
        uniform vec3 uBrilloDir;
        varying vec2 vUv;

        float causticas(vec2 p, float t) {
            vec2 q = mod(p * 6.2832, 6.2832) - 250.0;
            vec2 i = q;
            float c = 1.0;
            float fuerza = 0.005;
            for (int n = 0; n < 4; n++) {
                float tt = t * (1.0 - (3.5 / float(n + 1)));
                i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
                c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / fuerza), q.y / (cos(i.y + tt) / fuerza)));
            }
            c /= 4.0;
            c = 1.17 - pow(c, 1.4);
            return pow(abs(c), 7.0);
        }

        float sombraRelieve(vec2 w, float h) {
            vec2 paso = uSol.xy / max(uSol.z, 0.25);
            float s = 0.0;
            for (int i = 1; i <= 5; i++) {
                float t = float(i) * float(i) * 0.03;
                float hn = descodificar(texture2D(tRelieve, aSuelo(w + paso * t)));
                s = max(s, smoothstep(0.0, 0.05, hn - h - t));
            }
            return s;
        }

        void main() {
            vec2 w = aMundo(vUv);
            float h = descodificar(texture2D(tRelieve, aSuelo(w)));
            float agua = smoothstep(0.004, -0.008, h);

            float oI = texture2D(tOndas, vUv - vec2(uPasoOndas.x, 0.0)).r;
            float oD = texture2D(tOndas, vUv + vec2(uPasoOndas.x, 0.0)).r;
            float oB = texture2D(tOndas, vUv - vec2(0.0, uPasoOndas.y)).r;
            float oA = texture2D(tOndas, vUv + vec2(0.0, uPasoOndas.y)).r;
            float oC = texture2D(tOndas, vUv).r;
            float foco = clamp((4.0 * oC - oI - oD - oB - oA) * 6.0, -0.7, 1.5);
            vec2 gradOndas = giroAMundo(vec2(oD - oI, oA - oB)) * 4.0;

            vec2 vel = corriente(w);
            float f1 = fract(uTiempo * 0.16);
            float f2 = fract(uTiempo * 0.16 + 0.5);
            vec2 n1 = texture2D(tRuido, (w - vel * f1 * 6.25) * 0.45).rg - 0.5;
            vec2 n2 = texture2D(tRuido, (w - vel * f2 * 6.25) * 0.45 + 0.5).rg - 0.5;
            vec2 gradFlujo = mix(n2, n1, 1.0 - abs(1.0 - 2.0 * f1));
            vec2 viento = vec2(uTiempo * 0.05, uTiempo * 0.031);
            vec2 n3 = texture2D(tRuido, w * 1.9 + viento * 3.0).rg - 0.5;
            float rafaga = smoothstep(0.5, 0.78, texture2D(tRuido, w * 0.06 + viento * 0.4).b);
            float calma = mix(0.3, 1.0, clamp(length(vel) / 0.28, 0.0, 1.0));
            vec2 grad = gradOndas + gradFlujo * 0.16 * calma + n3 * 0.07 * (0.2 + rafaga);
            grad *= agua;
            vec3 n = normalize(vec3(-grad, 1.0));

            float prof = max(0.0, -h);
            vec2 wf = w - grad * (0.04 + prof * 0.35);
            vec4 relF = texture2D(tRelieve, aSuelo(wf));
            float hF = descodificar(relF);
            float profF = max(0.0, -hF);
            vec4 suelo = texture2D(tSuelo, aSuelo(wf));
            vec3 alb = pow(suelo.rgb, vec3(2.2));
            float ao = suelo.a;
            vec2 nxy = relF.rg * 2.0 - 1.0;
            vec3 nS = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
            float lambert = max(0.0, dot(nS, uSol));

            vec2 alSol = uSol.xy / max(uSol.z, 0.25);
            float sombraArboles = dosel(wf + alSol * profF);
            float sombraCosas = texture2D(tSombras, aPantalla(wf)).r;
            float sombraRoca = sombraRelieve(wf, hF);
            float luz = (1.0 - sombraArboles * 0.86) * (1.0 - sombraCosas * 0.8) * (1.0 - sombraRoca * 0.85);

            float mojado = smoothstep(0.05, 0.0, h) * (1.0 - agua);
            alb *= 1.0 - mojado * 0.4;
            float cau = causticas(wf * 0.55 + grad * 0.5, uTiempo * 0.5) * smoothstep(0.02, 0.25, profF) * agua;
            vec3 lecho = alb * (uAmbiente * ao + uColorSol * lambert * luz * mix(1.0, 0.8, agua) * (1.0 + foco * agua));
            lecho += alb * uColorSol * cau * luz * (1.6 - uNoche) * (0.4 + 0.6 * ao);

            vec3 T = exp(-uAbsorcion * profF * 2.0);
            float luzAgua = 1.0 - dosel(w) * 0.7;
            vec3 dispersion = uColorAgua * (uAmbiente * 1.6 + uColorSol * 0.55 * luzAgua);
            vec3 bajoAgua = lecho * T + dispersion * (1.0 - T);

            vec4 pez = texture2D(tPeces, aPantalla(w - grad * (0.03 + prof * 0.12)));
            vec3 colPez = pez.rgb * (uAmbiente * 1.2 + uColorSol * 0.9 * luzAgua);
            vec3 Tp = exp(-uAbsorcion * 0.45);
            bajoAgua = bajoAgua * (1.0 - pez.a) + colPez * Tp + dispersion * (1.0 - Tp) * pez.a;

            vec3 V = normalize(vec3(uCentro - w, ${ALTURA_CAMARA.toFixed(1)}));
            vec3 R = reflect(-V, n);
            float fres = 0.04 + 0.5 * pow(1.0 - max(dot(n, V), 0.0), 3.0) + min(0.3, length(gradOndas) * 0.35);
            float copas = 1.0 - smoothstep(0.38, 0.5, texture2D(tRuido, (w + R.xy * 4.0) * 0.11 + 0.21).b * 0.6 + texture2D(tRuido, (w + R.xy * 4.0) * 0.3).b * 0.4);
            copas = max(copas, smoothstep(0.7, 1.4, abs(distCauce(w + R.xy * 2.5))));
            vec3 reflejo = mix(uCielo, uCielo * vec3(0.12, 0.16, 0.1), copas * 0.88);
            vec3 colAgua = mix(bajoAgua, reflejo, fres * 0.9);
            float alinea = max(dot(R, uBrilloDir), 0.0);
            float esp = pow(alinea, 2500.0) * 3.5 + pow(alinea, 260.0) * 0.06;
            esp += uNoche * (smoothstep(0.99965, 0.9999, alinea) * 1.4 + pow(alinea, 700.0) * 0.05);
            colAgua += uColorSol * esp * (1.0 - copas * 0.75) * luzAgua;

            float rapido = smoothstep(0.22, 0.34, length(vel));
            float orilla = smoothstep(-0.07, -0.005, h) * smoothstep(0.1, 0.3, length(vel));
            vec2 fe1 = (w - vel * f1 * 6.25) * 1.3;
            vec2 fe2 = (w - vel * f2 * 6.25) * 1.3 + 0.37;
            float ruidoEspuma = mix(texture2D(tRuido, fe2).a, texture2D(tRuido, fe1).a, 1.0 - abs(1.0 - 2.0 * f1));
            float espuma = smoothstep(0.62, 0.8, ruidoEspuma) * (orilla * 0.9 + rapido * 0.35);
            espuma += smoothstep(0.8, 0.86, ruidoEspuma) * 0.18 * (1.0 - rapido);
            colAgua = mix(colAgua, (uAmbiente * 1.5 + uColorSol * luzAgua) * 0.85, clamp(espuma, 0.0, 0.8) * agua);

            vec3 col = mix(lecho, colAgua, agua);
            gl_FragColor = vec4(col * uSalida, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});


// =====================================================================
// 9. LAS TRUCHAS
// Cada trucha es un plano que se dobla con la cola. Se dibujan en una
// textura aparte para que el agua las tiña y las mueva; su sombra cae
// en el lecho, más lejos cuanto más hondo es el agua.
// =====================================================================

const VERTICE_PEZ = `
uniform float uFase;
uniform float uOndula;
uniform float uCurva;
varying vec2 vLocal;
void main() {
    vec3 p = position;
    float cola = pow(0.5 - p.x, 1.6);
    p.y += sin(p.x * 7.0 - uFase) * uOndula * (0.12 + cola);
    p.y += uCurva * (0.5 - p.x) * (0.5 - p.x);
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENTO_PEZ = GLSL_COMUN + `
uniform float uSombra;
uniform float uBorde;
uniform float uTono;
varying vec2 vLocal;

float elipse(vec2 q, vec2 c, vec2 r, float a) {
    q -= c;
    q = vec2(cos(a) * q.x + sin(a) * q.y, -sin(a) * q.x + cos(a) * q.y);
    return 1.0 - length(q / r);
}

void main() {
    float x = vLocal.x;
    float y = vLocal.y;
    float t = clamp((x + 0.31) / 0.81, 0.0, 1.0);
    float semi = 0.017 + 0.078 * pow(sin(PI * pow(t, 1.1)), 0.7);
    semi *= sqrt(clamp((0.5 - x) / 0.07, 0.0, 1.0));
    float cuerpo = x < -0.31 ? -1.0 : semi - abs(y);
    float tc = clamp((-0.29 - x) / 0.21, 0.0, 1.0);
    float semiCola = 0.02 + 0.09 * tc;
    float corte = -0.5 + 0.03 * (1.0 - pow(abs(y) / 0.11, 2.0));
    float cola = x > -0.28 ? -1.0 : min(semiCola - abs(y), x - corte);
    float pecho = elipse(vec2(x, abs(y)), vec2(0.25, 0.075), vec2(0.06, 0.018), 0.65);
    float vientre = elipse(vec2(x, abs(y)), vec2(-0.08, 0.045), vec2(0.04, 0.012), 0.5);
    float aletas = max(max(pecho, vientre) * 0.06, cola);
    float b = uBorde;
    float aCuerpo = smoothstep(-b, b, cuerpo);
    float aAletas = smoothstep(-b, b, aletas) * 0.6;
    float alfa = max(aCuerpo, aAletas);
    if (alfa < 0.003) discard;
    if (uSombra > 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, alfa * 0.55);
        return;
    }
    float lado = clamp(abs(y) / max(semi, 0.001), 0.0, 1.0);
    vec3 dorso = mix(vec3(0.07, 0.07, 0.04), vec3(0.12, 0.1, 0.05), uTono);
    vec3 flanco = mix(vec3(0.42, 0.36, 0.17), vec3(0.5, 0.4, 0.2), uTono);
    vec3 col = mix(dorso, flanco, smoothstep(0.25, 0.95, lado));
    vec2 celda = floor(vLocal * vec2(46.0, 60.0));
    vec2 dentro = fract(vLocal * vec2(46.0, 60.0)) - 0.5;
    float h = hash12(celda + uTono * 13.0);
    float mancha = step(0.62, h) * smoothstep(0.32, 0.18, length(dentro));
    col = mix(col, vec3(0.05, 0.04, 0.03), mancha * smoothstep(-0.3, 0.0, x) * 0.85);
    float roja = step(0.9, h) * smoothstep(0.5, 0.75, lado) * smoothstep(0.3, 0.15, length(dentro));
    col = mix(col, vec3(0.62, 0.16, 0.08), roja);
    col = mix(col, dorso * 0.6, smoothstep(0.012, 0.0, abs(y)) * step(-0.05, x) * step(x, 0.16) * 0.7);
    float ojo = smoothstep(0.012, 0.008, length(vec2(x - 0.415, abs(y) - 0.032)));
    col = mix(col, vec3(0.02), ojo);
    vec3 colAleta = vec3(0.42, 0.36, 0.2) * (0.8 + 0.2 * sin(atan(y, x + 0.3) * 60.0));
    col = mix(colAleta, col, aCuerpo);
    gl_FragColor = vec4(pow(col, vec3(2.2)), alfa);
}
`;

const geometriaPez = new THREE.PlaneGeometry(1, 0.28, 24, 1);
const escenaPeces = new THREE.Scene();
const escenaSombras = new THREE.Scene();
const peces = [];

function crearPeces() {
    for (let i = 0; i < ajustes.peces; i++) {
        const comun = { uFase: { value: 0 }, uOndula: { value: 0.02 }, uCurva: { value: 0 }, uTono: { value: Math.random() } };
        const material = new THREE.ShaderMaterial({
            uniforms: { ...comun, uSombra: { value: 0 }, uBorde: { value: 0.004 } },
            vertexShader: VERTICE_PEZ,
            fragmentShader: FRAGMENTO_PEZ,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const materialSombra = material.clone();
        Object.assign(materialSombra.uniforms, comun, { uSombra: { value: 1 }, uBorde: { value: 0.02 } });
        const cuerpo = new THREE.Mesh(geometriaPez, material);
        const sombra = new THREE.Mesh(geometriaPez, materialSombra);
        cuerpo.frustumCulled = sombra.frustumCulled = false;
        escenaPeces.add(cuerpo);
        escenaSombras.add(sombra);
        const largo = 0.34 + Math.random() * 0.16;
        cuerpo.scale.setScalar(largo);
        sombra.scale.setScalar(largo);
        const pez = {
            cuerpo,
            sombra,
            comun,
            largo,
            x: 0,
            y: 0,
            rumbo: Math.random() * Math.PI * 2,
            vel: 0,
            giro: 0,
            estado: "nadar",
            tiempo: 0,
            objetivo: new THREE.Vector2(),
            hondura: 0.15 + Math.random() * 0.2
        };
        buscarSitio(pez, pez.objetivo);
        pez.x = pez.objetivo.x;
        pez.y = pez.objetivo.y;
        buscarSitio(pez, pez.objetivo);
        peces.push(pez);
    }
}

const auxSitio = new THREE.Vector2();

function buscarSitio(pez, destino, lejosDe) {
    for (let intento = 0; intento < 60; intento++) {
        aMundo(0.1 + Math.random() * 0.8, 0.12 + Math.random() * 0.76, auxSitio);
        if (profundidadEn(auxSitio.x, auxSitio.y) < 0.42) continue;
        if (lejosDe && Math.hypot(auxSitio.x - lejosDe.x, auxSitio.y - lejosDe.y) < 1.4) continue;
        const ocupado = peces.some((o) => o !== pez && Math.hypot(o.objetivo.x - auxSitio.x, o.objetivo.y - auxSitio.y) < 0.7);
        if (ocupado && intento < 50) continue;
        destino.copy(auxSitio);
        return;
    }
    destino.set(0.2, 0);
}

function diferenciaAngulo(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

const auxCorriente = new THREE.Vector2();

function moverPeces(delta) {
    const alSolX = comunes.uSol.value.x / Math.max(comunes.uSol.value.z, 0.25);
    const alSolY = comunes.uSol.value.y / Math.max(comunes.uSol.value.z, 0.25);
    peces.forEach((pez) => {
        pez.tiempo -= delta;
        const dx = pez.objetivo.x - pez.x;
        const dy = pez.objetivo.y - pez.y;
        const lejos = Math.hypot(dx, dy);
        corriente(pez.x, pez.y, auxCorriente);
        let rumboDeseado = Math.atan2(dy, dx);
        let velDeseada = 0.35;
        let giroMax = 2.2;
        if (pez.estado === "huir") {
            velDeseada = 1.8;
            giroMax = 7;
            rumboDeseado = pez.rumboHuida;
            if (pez.tiempo <= 0) {
                pez.estado = "nadar";
                buscarSitio(pez, pez.objetivo, { x: pez.x, y: pez.y });
            }
        } else if (pez.estado === "quieto") {
            rumboDeseado = Math.atan2(-auxCorriente.y, -auxCorriente.x) + Math.sin(pez.tiempo * 0.7) * 0.15;
            velDeseada = Math.min(0.12, lejos * 0.6);
            if (lejos > 0.12) rumboDeseado = Math.atan2(dy, dx);
            if (pez.tiempo <= 0) {
                pez.estado = "nadar";
                buscarSitio(pez, pez.objetivo);
            }
        } else if (lejos < 0.2) {
            pez.estado = "quieto";
            pez.tiempo = 4 + Math.random() * 9;
        } else {
            velDeseada = 0.25 + Math.min(0.3, lejos * 0.2);
        }
        const delanteX = pez.x + Math.cos(pez.rumbo) * 0.45;
        const delanteY = pez.y + Math.sin(pez.rumbo) * 0.45;
        if (profundidadEn(delanteX, delanteY) < 0.3) {
            const izq = profundidadEn(pez.x + Math.cos(pez.rumbo + 0.8) * 0.45, pez.y + Math.sin(pez.rumbo + 0.8) * 0.45);
            const der = profundidadEn(pez.x + Math.cos(pez.rumbo - 0.8) * 0.45, pez.y + Math.sin(pez.rumbo - 0.8) * 0.45);
            rumboDeseado = pez.rumbo + (izq > der ? 1.4 : -1.4);
            if (pez.estado === "huir") pez.rumboHuida = rumboDeseado;
        }
        peces.forEach((otro) => {
            if (otro === pez) return;
            const ox = pez.x - otro.x;
            const oy = pez.y - otro.y;
            const d = Math.hypot(ox, oy);
            if (d < 0.45 && d > 0.001) {
                const huida = Math.atan2(oy, ox);
                rumboDeseado += diferenciaAngulo(huida, rumboDeseado) * 0.3 * (1 - d / 0.45);
            }
        });
        const cambio = Math.max(-giroMax * delta, Math.min(giroMax * delta, diferenciaAngulo(rumboDeseado, pez.rumbo)));
        pez.rumbo += cambio;
        pez.giro += (cambio / Math.max(delta, 0.001) - pez.giro) * Math.min(1, delta * 6);
        pez.vel += (velDeseada - pez.vel) * Math.min(1, delta * (pez.estado === "huir" ? 8 : 1.5));
        pez.x += Math.cos(pez.rumbo) * pez.vel * delta;
        pez.y += Math.sin(pez.rumbo) * pez.vel * delta;
        if (profundidadEn(pez.x, pez.y) < 0.15) {
            pez.x -= Math.cos(pez.rumbo) * pez.vel * delta * 1.5;
            pez.y -= Math.sin(pez.rumbo) * pez.vel * delta * 1.5;
        }
        pez.comun.uFase.value += delta * (5 + pez.vel * 22);
        pez.comun.uOndula.value = 0.012 + Math.min(0.06, pez.vel * 0.04);
        pez.comun.uCurva.value = Math.max(-0.25, Math.min(0.25, -pez.giro * 0.06));
        pez.cuerpo.position.set(pez.x, pez.y, 0);
        pez.cuerpo.rotation.z = pez.rumbo;
        const caida = Math.max(0.05, profundidadEn(pez.x, pez.y) - pez.hondura);
        pez.sombra.position.set(pez.x - alSolX * caida, pez.y - alSolY * caida, 0);
        pez.sombra.rotation.z = pez.rumbo;
    });
}

function asustarPeces(x, y, radio) {
    peces.forEach((pez) => {
        const d = Math.hypot(pez.x - x, pez.y - y);
        if (d > radio) return;
        pez.estado = "huir";
        pez.tiempo = 0.6 + Math.random() * 0.5;
        pez.rumboHuida = Math.atan2(pez.y - y, pez.x - x) + (Math.random() - 0.5) * 0.6;
    });
}


// =====================================================================
// 10. LAS HOJAS DE CASTAÑO
// Caen de las copas dando vueltas, flotan río abajo y giran en el
// remolino del remanso. Cada una deja su sombra en el fondo.
// =====================================================================

const VERTICE_HOJA = `
attribute vec4 aDatos;
attribute vec4 aExtra;
attribute vec2 aSombra;
uniform float uModoSombra;
varying vec2 vLocal;
varying vec2 vMundo;
varying vec4 vExtra;
void main() {
    vec2 l = position.xy * vec2(1.0, max(abs(aExtra.y), 0.12));
    float esc = aDatos.w * (1.0 + aExtra.x * 0.22 * (1.0 - uModoSombra));
    float c = cos(aDatos.z);
    float s = sin(aDatos.z);
    vec2 p = aDatos.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c) * esc;
    p += aSombra * uModoSombra;
    vLocal = vec2(position.x * 2.0, position.y * 2.0);
    vMundo = p;
    vExtra = aExtra;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}
`;

const FRAGMENTO_HOJA = GLSL_COMUN + GLSL_LUZ + `
uniform float uModoSombra;
varying vec2 vLocal;
varying vec2 vMundo;
varying vec4 vExtra;
void main() {
    vec2 q = vLocal;
    float vena;
    float dentro = hojaCastano(q, vena);
    float borde = fwidth(dentro) * 1.2 + 0.002;
    float alfa = smoothstep(-borde, borde, dentro) * vExtra.w;
    if (alfa < 0.01) discard;
    if (uModoSombra > 0.5) {
        float suave = 1.0 - min(0.7, vExtra.x * 0.25);
        gl_FragColor = vec4(1.0, 1.0, 1.0, alfa * 0.5 * suave);
        return;
    }
    vec3 col = colorHoja(vExtra.z);
    col = mix(col, col * vec3(0.6, 0.45, 0.35), smoothstep(0.45, 0.8, ruido(q * 3.0 + vExtra.z * 40.0)) * 0.6);
    col = mix(col * 0.7, col, smoothstep(0.0, 0.06, dentro));
    col *= 1.0 - vena * 0.25;
    col = pow(col, vec3(2.2));
    float cara = vExtra.y < 0.0 ? 0.75 : 1.0;
    float luz = 1.0 - dosel(vMundo) * 0.85;
    vec3 c = col * cara * (uAmbiente * 1.3 + uColorSol * 0.95 * luz);
    gl_FragColor = vec4(c * uSalida, alfa);
}
`;

const hojas = [];
let geometriaHojas = null;
let datosHojas;
let extraHojas;
let sombraHojas;

function crearHojas(escenaFinal) {
    const n = ajustes.hojas;
    const plano = new THREE.PlaneGeometry(1, 0.5);
    geometriaHojas = new THREE.InstancedBufferGeometry();
    geometriaHojas.index = plano.index;
    geometriaHojas.setAttribute("position", plano.getAttribute("position"));
    datosHojas = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    extraHojas = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    sombraHojas = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    [datosHojas, extraHojas, sombraHojas].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometriaHojas.setAttribute("aDatos", datosHojas);
    geometriaHojas.setAttribute("aExtra", extraHojas);
    geometriaHojas.setAttribute("aSombra", sombraHojas);
    geometriaHojas.instanceCount = n;
    const material = new THREE.ShaderMaterial({
        uniforms: { ...comunes, uModoSombra: { value: 0 } },
        vertexShader: VERTICE_HOJA,
        fragmentShader: FRAGMENTO_HOJA,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        extensions: { derivatives: true }
    });
    const materialSombra = material.clone();
    materialSombra.uniforms = { ...comunes, uModoSombra: { value: 1 } };
    const malla = new THREE.Mesh(geometriaHojas, material);
    const sombra = new THREE.Mesh(geometriaHojas, materialSombra);
    malla.frustumCulled = sombra.frustumCulled = false;
    malla.renderOrder = 3;
    escenaFinal.add(malla);
    escenaSombras.add(sombra);
    for (let i = 0; i < n; i++) {
        const hoja = { x: 0, y: 0, ang: 0, tam: 0, altura: 0, giro: 1, color: Math.random(), alfa: 1, vx: 0, vy: 0, va: 0, fase: Math.random() * 10, estado: "flota", vida: 0 };
        if (i < n * 0.6) ponerHojaFlotando(hoja, true);
        else ponerHojaCayendo(hoja, Math.random() * 12);
        hojas.push(hoja);
    }
}

const auxHoja = new THREE.Vector2();

function ponerHojaFlotando(hoja, enCualquierSitio) {
    for (let intento = 0; intento < 40; intento++) {
        if (enCualquierSitio) aMundo(Math.random(), Math.random(), auxHoja);
        else {
            aMundo(Math.random() * 0.15 - 0.05, Math.random(), auxHoja);
            auxHoja.x -= 0.4;
        }
        if (alturaEn(auxHoja.x, auxHoja.y) < -0.05) break;
    }
    hoja.x = auxHoja.x;
    hoja.y = auxHoja.y;
    hoja.ang = Math.random() * Math.PI * 2;
    hoja.tam = 0.22 + Math.random() * 0.1;
    hoja.altura = 0;
    hoja.giro = Math.random() < 0.8 ? 1 : -1;
    hoja.color = Math.random();
    hoja.alfa = 1;
    hoja.estado = "flota";
    hoja.va = (Math.random() - 0.5) * 0.4;
}

function ponerHojaCayendo(hoja, espera = 0) {
    aMundo(0.05 + Math.random() * 0.9, 0.05 + Math.random() * 0.9, auxHoja);
    hoja.x = auxHoja.x;
    hoja.y = auxHoja.y;
    hoja.altura = 3 + Math.random() * 1.5;
    hoja.tam = 0.22 + Math.random() * 0.1;
    hoja.color = Math.random();
    hoja.estado = "espera";
    hoja.vida = espera;
    hoja.alfa = 0;
    hoja.va = (Math.random() - 0.5) * 3;
}

function moverHojas(delta) {
    if (!geometriaHojas) return;
    const alSolX = comunes.uSol.value.x / Math.max(comunes.uSol.value.z, 0.25);
    const alSolY = comunes.uSol.value.y / Math.max(comunes.uSol.value.z, 0.25);
    hojas.forEach((hoja, i) => {
        if (hoja.estado === "espera") {
            hoja.vida -= delta;
            if (hoja.vida <= 0) hoja.estado = "cae";
        } else if (hoja.estado === "cae") {
            hoja.fase += delta;
            hoja.alfa = Math.min(1, hoja.alfa + delta * 2);
            hoja.altura -= delta * 0.55;
            hoja.x += Math.sin(hoja.fase * 2.1) * 0.35 * delta + 0.05 * delta;
            hoja.y += Math.cos(hoja.fase * 1.7) * 0.25 * delta;
            hoja.ang += hoja.va * delta;
            hoja.giro = Math.cos(hoja.fase * 3.2);
            if (hoja.altura <= 0) {
                hoja.altura = 0;
                hoja.giro = hoja.giro < 0 ? -1 : 1;
                if (alturaEn(hoja.x, hoja.y) < -0.01) {
                    hoja.estado = "flota";
                    hoja.va = (Math.random() - 0.5) * 0.4;
                    gotaEnMundo(hoja.x, hoja.y, 0.05, 0.35);
                } else {
                    hoja.estado = "suelo";
                    hoja.vida = 14 + Math.random() * 10;
                }
            }
        } else if (hoja.estado === "suelo") {
            hoja.vida -= delta;
            if (hoja.vida < 2) hoja.alfa = Math.max(0, hoja.vida / 2);
            if (hoja.vida <= 0) ponerHojaCayendo(hoja, 2 + Math.random() * 6);
        } else {
            corriente(hoja.x, hoja.y, auxCorriente);
            hoja.vx *= Math.exp(-delta * 1.5);
            hoja.vy *= Math.exp(-delta * 1.5);
            hoja.x += (auxCorriente.x + hoja.vx) * delta;
            hoja.y += (auxCorriente.y + hoja.vy) * delta;
            hoja.ang += (hoja.va + (hoja.vx * 0.8 - hoja.vy * 0.5)) * delta;
            const h = alturaEn(hoja.x, hoja.y);
            if (h > -0.02) {
                const e = 0.08;
                const gx = alturaEn(hoja.x + e, hoja.y) - alturaEn(hoja.x - e, hoja.y);
                const gy = alturaEn(hoja.x, hoja.y + e) - alturaEn(hoja.x, hoja.y - e);
                const largo = Math.hypot(gx, gy) || 1;
                hoja.x -= (gx / largo) * delta * 0.3;
                hoja.y -= (gy / largo) * delta * 0.3;
            }
            aPantalla(hoja.x, hoja.y, auxHoja);
            if (auxHoja.x < -0.15 || auxHoja.x > 1.15 || auxHoja.y < -0.15 || auxHoja.y > 1.15) {
                if (Math.random() < 0.5) ponerHojaFlotando(hoja, false);
                else ponerHojaCayendo(hoja, Math.random() * 4);
            }
        }
        const hondo = hoja.estado === "flota" ? profundidadEn(hoja.x, hoja.y) : Math.max(0, profundidadEn(hoja.x, hoja.y));
        const caida = hoja.altura + hondo;
        datosHojas.setXYZW(i, hoja.x, hoja.y, hoja.ang, hoja.tam);
        extraHojas.setXYZW(i, hoja.altura, hoja.giro, hoja.color, hoja.estado === "espera" ? 0 : hoja.alfa);
        sombraHojas.setXY(i, -alSolX * caida, -alSolY * caida);
    });
    datosHojas.needsUpdate = true;
    extraHojas.needsUpdate = true;
    sombraHojas.needsUpdate = true;
}

function empujarHojas(x, y, radio, fuerza) {
    hojas.forEach((hoja) => {
        if (hoja.estado !== "flota") return;
        const dx = hoja.x - x;
        const dy = hoja.y - y;
        const d = Math.hypot(dx, dy);
        if (d > radio || d < 0.001) return;
        const k = fuerza * (1 - d / radio);
        hoja.vx += (dx / d) * k;
        hoja.vy += (dy / d) * k;
        hoja.va += (Math.random() - 0.5) * k * 4;
    });
}


// =====================================================================
// 11. HELECHOS Y MATAS DE HIERBA EN LAS ORILLAS
// Cada fronda es un plano que se curva y se mece con el viento. Las
// matas usan el mismo shader pero con briznas finas.
// =====================================================================

const VERTICE_PLANTA = `
attribute vec4 aPlanta;
attribute vec4 aForma;
uniform float uTiempo;
uniform vec2 uDesv;
varying vec2 vLocal;
varying vec2 vMundo;
varying vec4 vForma;
void main() {
    float x = position.x;
    float vaiven = sin(uTiempo * 1.3 + aPlanta.x * 2.1 + aPlanta.y * 1.7) * 0.06 + sin(uTiempo * 3.1 + aForma.w * 20.0) * 0.02;
    float a = aPlanta.z + (aForma.y + vaiven) * x * 0.5;
    vec2 l = vec2(x * aPlanta.w, position.y * aPlanta.w * aForma.x);
    vec2 p = aPlanta.xy + vec2(cos(a) * l.x - sin(a) * l.y, sin(a) * l.x + cos(a) * l.y);
    p += uDesv * (0.2 + x * 0.25);
    vLocal = position.xy;
    vMundo = p;
    vForma = aForma;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}
`;

const FRAGMENTO_PLANTA = GLSL_COMUN + GLSL_LUZ + `
uniform float uModoSombra;
varying vec2 vLocal;
varying vec2 vMundo;
varying vec4 vForma;
void main() {
    float x = vLocal.x;
    float ay = abs(vLocal.y) * 2.0;
    float alfa;
    vec3 col;
    if (vForma.z < 0.5) {
        float perfil = sin(PI * pow(x, 0.62)) * smoothstep(0.0, 0.1, x);
        float rel = ay / max(perfil, 0.001);
        float k = (x + ay * 0.1) * 17.0;
        float seg = abs(fract(k) - 0.5) * 2.0;
        float muesca = abs(fract(ay * 9.0 / max(perfil, 0.2)) - 0.5);
        float grosor = 0.62 * (1.0 - rel * 0.7) - muesca * 0.25;
        float pinna = smoothstep(grosor + 0.1, grosor - 0.1, seg) * smoothstep(1.0, 0.9, rel);
        float raquis = smoothstep(0.05, 0.02, ay) * step(x, 0.96);
        alfa = max(pinna * step(0.04, x), raquis);
        vec3 verde = mix(vec3(0.17, 0.33, 0.08), vec3(0.32, 0.46, 0.12), vForma.w);
        vec3 otono = mix(vec3(0.62, 0.4, 0.12), vec3(0.5, 0.26, 0.08), vForma.w);
        col = mix(verde, otono, step(0.62, vForma.w) * 0.9);
        col *= 0.75 + 0.35 * (1.0 - seg) + 0.15 * x;
        col = mix(col, col * 0.6, raquis * 0.5);
    } else {
        float perfil = pow(1.0 - x, 0.8) * smoothstep(0.0, 0.05, x);
        alfa = smoothstep(1.0, 0.75, ay / max(perfil, 0.001));
        col = mix(vec3(0.22, 0.34, 0.1), vec3(0.62, 0.62, 0.26), x * 0.8 + vForma.w * 0.3);
    }
    if (alfa < 0.02) discard;
    if (uModoSombra > 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, alfa * 0.45);
        return;
    }
    col = pow(col, vec3(2.2));
    float luz = 1.0 - dosel(vMundo) * 0.85;
    vec3 c = col * (uAmbiente * 1.25 + uColorSol * 0.95 * luz) + col * uColorSol * 0.15 * luz;
    gl_FragColor = vec4(c * uSalida, alfa);
}
`;

let materialSombraPlantas = null;

function crearPlantas(escenaFinal) {
    const datos = [];
    const forma = [];
    let helechos = 0;
    let matas = 0;
    for (let intento = 0; intento < 6000 && (helechos < ajustes.helechos || matas < ajustes.matas); intento++) {
        const x = (Math.random() - 0.5) * (MUNDO - 0.6);
        const y = (Math.random() - 0.5) * (MUNDO - 0.6);
        const h = alturaEn(x, y);
        const d = Math.abs(distCauce(x, y));
        if (h < 0.07 || h > 0.9 || rocaEn(x, y) > 0.2) continue;
        const cerca = d < 1.45;
        if (!cerca && Math.random() < 0.6) continue;
        if (helechos < ajustes.helechos && Math.random() < 0.5) {
            helechos++;
            const frondas = 4 + Math.floor(Math.random() * 4);
            const tono = Math.random();
            const largoBase = 0.42 + Math.random() * 0.35;
            const abanico = Math.PI * 2 * (0.55 + Math.random() * 0.4);
            const inicio = Math.random() * Math.PI * 2;
            for (let f = 0; f < frondas; f++) {
                datos.push(x, y, inicio + (f / frondas) * abanico + (Math.random() - 0.5) * 0.5, largoBase * (0.65 + Math.random() * 0.5));
                forma.push(0.36, (Math.random() - 0.5) * 0.9, 0, Math.min(0.99, tono + (Math.random() - 0.5) * 0.15));
            }
        } else if (matas < ajustes.matas) {
            matas++;
            const briznas = 9 + Math.floor(Math.random() * 8);
            const largoBase = 0.16 + Math.random() * 0.16;
            for (let b = 0; b < briznas; b++) {
                datos.push(x, y, Math.random() * Math.PI * 2, largoBase * (0.6 + Math.random() * 0.6));
                forma.push(0.07, (Math.random() - 0.5) * 1.6, 1, Math.random());
            }
        }
    }
    const n = datos.length / 4;
    const plano = new THREE.PlaneGeometry(1, 1, 6, 1);
    plano.translate(0.5, 0, 0);
    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = plano.index;
    geometria.setAttribute("position", plano.getAttribute("position"));
    geometria.setAttribute("aPlanta", new THREE.InstancedBufferAttribute(new Float32Array(datos), 4));
    geometria.setAttribute("aForma", new THREE.InstancedBufferAttribute(new Float32Array(forma), 4));
    geometria.instanceCount = n;
    const material = new THREE.ShaderMaterial({
        uniforms: { ...comunes, uModoSombra: { value: 0 }, uDesv: { value: new THREE.Vector2() } },
        vertexShader: VERTICE_PLANTA,
        fragmentShader: FRAGMENTO_PLANTA,
        transparent: true,
        depthTest: false,
        depthWrite: false
    });
    materialSombraPlantas = material.clone();
    materialSombraPlantas.uniforms = { ...comunes, uModoSombra: { value: 1 }, uDesv: { value: new THREE.Vector2() } };
    const malla = new THREE.Mesh(geometria, material);
    const sombra = new THREE.Mesh(geometria, materialSombraPlantas);
    malla.frustumCulled = sombra.frustumCulled = false;
    malla.renderOrder = 2;
    escenaFinal.add(malla);
    escenaSombras.add(sombra);
}


// =====================================================================
// 12. LUCIÉRNAGAS
// =====================================================================

let luciernagas = null;
const datosLuciernagas = [];

function crearLuciernagas(escenaFinal) {
    const n = ajustes.luciernagas;
    const posiciones = new Float32Array(n * 3);
    const fases = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let x = 0;
        let y = 0;
        for (let intento = 0; intento < 20; intento++) {
            x = (Math.random() - 0.5) * 9;
            y = (Math.random() - 0.5) * 9;
            if (Math.abs(distCauce(x, y)) > 0.75) break;
        }
        datosLuciernagas.push({ x, y, cx: x, cy: y, fase: Math.random() * 100, vel: 0.3 + Math.random() * 0.5 });
        fases[i] = Math.random() * 100;
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("aFase", new THREE.BufferAttribute(fases, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uNoche: comunes.uNoche, uSalida: comunes.uSalida, uTam: { value: 30 } },
        vertexShader: `
            attribute float aFase;
            uniform float uTiempo;
            uniform float uTam;
            varying float vBrillo;
            void main() {
                float ciclo = fract(uTiempo * 0.23 + aFase);
                vBrillo = smoothstep(0.0, 0.08, ciclo) * smoothstep(0.42, 0.18, ciclo);
                gl_PointSize = uTam * (0.6 + 0.4 * vBrillo);
                gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uNoche;
            uniform float uSalida;
            varying float vBrillo;
            void main() {
                vec2 d = gl_PointCoord - 0.5;
                float r = dot(d, d);
                float luz = exp(-r * 30.0) * 0.5 + exp(-r * 260.0) * 2.5;
                gl_FragColor = vec4(vec3(0.75, 1.0, 0.32) * luz * vBrillo * uNoche * uSalida, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
    });
    luciernagas = new THREE.Points(geometria, material);
    luciernagas.frustumCulled = false;
    luciernagas.renderOrder = 5;
    escenaFinal.add(luciernagas);
}

function moverLuciernagas(delta, tiempo) {
    if (!luciernagas) return;
    luciernagas.visible = comunes.uNoche.value > 0.01;
    if (!luciernagas.visible) return;
    const p = luciernagas.geometry.attributes.position.array;
    datosLuciernagas.forEach((l, i) => {
        l.fase += delta * l.vel;
        l.x = l.cx + Math.sin(l.fase * 0.9) * 0.6 + Math.sin(l.fase * 2.3) * 0.12;
        l.y = l.cy + Math.cos(l.fase * 0.7) * 0.5 + Math.cos(l.fase * 1.9) * 0.1;
        p[i * 3] = l.x;
        p[i * 3 + 1] = l.y;
    });
    luciernagas.geometry.attributes.position.needsUpdate = true;
    luciernagas.material.uniforms.uTam.value = 30 * renderizador.getPixelRatio();
}


// =====================================================================
// 13. ESCENA FINAL Y ACABADO
// Todo se dibuja en una textura con más rango de luz y al final se
// ajusta el tono, se oscurecen las esquinas y se añade un poco de grano.
// =====================================================================

const escenaFinal = new THREE.Scene();
const cuadroAgua = new THREE.Mesh(planoPantalla, materialAgua);
cuadroAgua.frustumCulled = false;
cuadroAgua.renderOrder = 0;
escenaFinal.add(cuadroAgua);

let objetivoFinal = null;
let objetivoPeces = null;
let objetivoSombras = null;

const materialAcabado = new THREE.ShaderMaterial({
    uniforms: {
        tFinal: { value: null },
        uSalida: comunes.uSalida,
        uTiempo: comunes.uTiempo,
        uExposicion: { value: 1 },
        uFundido: { value: 0 },
        uAspecto: { value: 1 }
    },
    vertexShader: VERTICE_PANTALLA,
    fragmentShader: `
        uniform sampler2D tFinal;
        uniform float uSalida;
        uniform float uTiempo;
        uniform float uExposicion;
        uniform float uFundido;
        uniform float uAspecto;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        float azar(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }
        void main() {
            vec3 c = texture2D(tFinal, vUv).rgb / uSalida * uExposicion;
            c = aces(c);
            c = pow(c, vec3(1.0 / 2.2));
            vec2 d = (vUv - 0.5) * vec2(uAspecto, 1.0);
            float v = smoothstep(1.2, 0.3, length(d) / max(1.0, uAspecto) * 1.6);
            c *= mix(0.7, 1.0, v);
            c += (azar(gl_FragCoord.xy + fract(uTiempo) * 91.0) - 0.5) * 0.02;
            gl_FragColor = vec4(c * uFundido, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaAcabado = new THREE.Scene();
const cuadroAcabado = new THREE.Mesh(planoPantalla, materialAcabado);
cuadroAcabado.frustumCulled = false;
escenaAcabado.add(cuadroAcabado);


// =====================================================================
// 14. MOMENTOS DEL DÍA
// =====================================================================

const MOMENTOS = {
    manana: {
        sol: [-0.36, 0.44, 0.82],
        colorSol: [1.3, 1.22, 1.06],
        ambiente: [0.3, 0.37, 0.43],
        cielo: [0.62, 0.78, 0.94],
        absorcion: [1.05, 0.3, 0.42],
        colorAgua: [0.05, 0.26, 0.24],
        brillo: [-0.3, 0.38, 0.88],
        noche: 0,
        exposicion: 1.0
    },
    atardecer: {
        sol: [-0.74, 0.3, 0.5],
        colorSol: [1.55, 0.95, 0.52],
        ambiente: [0.3, 0.26, 0.33],
        cielo: [0.98, 0.66, 0.48],
        absorcion: [1.1, 0.36, 0.46],
        colorAgua: [0.07, 0.2, 0.18],
        brillo: [-0.22, 0.12, 0.97],
        noche: 0,
        exposicion: 1.05
    },
    noche: {
        sol: [0.28, -0.2, 0.94],
        colorSol: [0.3, 0.4, 0.62],
        ambiente: [0.035, 0.05, 0.09],
        cielo: [0.07, 0.1, 0.18],
        absorcion: [1.2, 0.45, 0.4],
        colorAgua: [0.012, 0.04, 0.06],
        brillo: [0.13, -0.05, 0.99],
        noche: 1,
        exposicion: 1.35
    }
};

let momento = parametros.get("momento") in MOMENTOS ? parametros.get("momento") : "atardecer";
const vectoresMomento = ["sol", "colorSol", "ambiente", "cielo", "absorcion", "colorAgua", "brillo"];
const uniformeDe = { sol: "uSol", colorSol: "uColorSol", ambiente: "uAmbiente", cielo: "uCielo", absorcion: "uAbsorcion", colorAgua: "uColorAgua", brillo: "uBrilloDir" };
const auxVector = new THREE.Vector3();

function aplicarMomento(delta) {
    const m = MOMENTOS[momento];
    const k = delta < 0 ? 1 : 1 - Math.exp(-delta * 1.6);
    vectoresMomento.forEach((nombre) => {
        auxVector.fromArray(m[nombre]);
        if (nombre === "sol" || nombre === "brillo") auxVector.normalize();
        comunes[uniformeDe[nombre]].value.lerp(auxVector, k);
    });
    comunes.uSol.value.normalize();
    comunes.uBrilloDir.value.normalize();
    comunes.uNoche.value += (m.noche - comunes.uNoche.value) * k;
    materialAcabado.uniforms.uExposicion.value += (m.exposicion - materialAcabado.uniforms.uExposicion.value) * k;
}

function cambiarMomento(nuevo) {
    momento = nuevo;
    document.querySelectorAll("[data-momento]").forEach((boton) => {
        const activo = boton.dataset.momento === nuevo;
        boton.classList.toggle("activo", activo);
        boton.setAttribute("aria-pressed", activo);
    });
    actualizarSonido();
}


// =====================================================================
// 15. TOCAR EL AGUA
// Pulsar suelta una gota grande; pasar el ratón o el dedo deja una
// estela. Las truchas huyen y las hojas se apartan.
// =====================================================================

const puntero = { x: 0, y: 0, ultimo: null, pulsado: false };
const auxPuntero = new THREE.Vector2();
const pista = document.getElementById("pista");

function tocar(evento, fuerza, radio) {
    const u = evento.clientX / innerWidth;
    const v = 1 - evento.clientY / innerHeight;
    const lx = (u - 0.5) * vista.tam.x;
    const ly = (v - 0.5) * vista.tam.y;
    aMundo(u, v, auxPuntero);
    const enAgua = alturaEn(auxPuntero.x, auxPuntero.y) < 0;
    if (enAgua) soltarGota(lx, ly, radio, fuerza);
    return enAgua;
}

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    puntero.pulsado = true;
    puntero.ultimo = { x: evento.clientX, y: evento.clientY };
    if (tocar(evento, 0.9, 0.07)) {
        asustarPeces(auxPuntero.x, auxPuntero.y, 1.4);
        empujarHojas(auxPuntero.x, auxPuntero.y, 0.8, 0.5);
        sonarGota(0.6);
    }
    pista.classList.add("oculta");
});

renderizador.domElement.addEventListener("pointermove", (evento) => {
    const ultimo = puntero.ultimo;
    if (evento.pointerType === "touch" && !puntero.pulsado) return;
    const distancia = ultimo ? Math.hypot(evento.clientX - ultimo.x, evento.clientY - ultimo.y) : 99;
    if (distancia < 10) return;
    puntero.ultimo = { x: evento.clientX, y: evento.clientY };
    const fuerza = puntero.pulsado ? 0.35 : 0.14;
    if (tocar(evento, fuerza, 0.045)) {
        empujarHojas(auxPuntero.x, auxPuntero.y, 0.4, puntero.pulsado ? 0.25 : 0.1);
        if (puntero.pulsado) asustarPeces(auxPuntero.x, auxPuntero.y, 0.9);
    }
});

["pointerup", "pointercancel", "pointerleave"].forEach((tipo) => {
    renderizador.domElement.addEventListener(tipo, () => {
        puntero.pulsado = false;
        if (tipo !== "pointerup") puntero.ultimo = null;
    });
});

let siguienteBicho = 2;

function vidaDelRio(delta) {
    siguienteBicho -= delta;
    if (siguienteBicho > 0) return;
    siguienteBicho = 1.5 + Math.random() * 4;
    if (Math.random() < 0.3 && peces.length) {
        const pez = peces[Math.floor(Math.random() * peces.length)];
        if (pez.estado === "quieto") {
            gotaEnMundo(pez.x + Math.cos(pez.rumbo) * pez.largo * 0.4, pez.y + Math.sin(pez.rumbo) * pez.largo * 0.4, 0.06, 0.6);
            sonarGota(0.35);
            return;
        }
    }
    for (let intento = 0; intento < 10; intento++) {
        aMundo(Math.random(), Math.random(), auxPuntero);
        if (alturaEn(auxPuntero.x, auxPuntero.y) < -0.1) {
            gotaEnMundo(auxPuntero.x, auxPuntero.y, 0.03, 0.18);
            return;
        }
    }
}


// =====================================================================
// 16. SONIDO
// El agua es ruido filtrado con gorgoteos; de día cantan pájaros y de
// noche los grillos. Todo se genera en el navegador.
// =====================================================================

let audio = null;
let sonidoActivo = false;
const botonSonido = document.getElementById("boton-sonido");

function crearAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const general = ctx.createGain();
    general.gain.value = 0;
    general.connect(ctx.destination);
    const largo = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let ultimo = 0;
    for (let i = 0; i < largo; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        datos[i] = ultimo * 3.5;
    }
    const rio = ctx.createBufferSource();
    rio.buffer = buffer;
    rio.loop = true;
    const pasaBajos = ctx.createBiquadFilter();
    pasaBajos.type = "lowpass";
    pasaBajos.frequency.value = 900;
    const volumenRio = ctx.createGain();
    volumenRio.gain.value = 0.5;
    rio.connect(pasaBajos).connect(volumenRio).connect(general);
    const gorgoteo = ctx.createBufferSource();
    gorgoteo.buffer = buffer;
    gorgoteo.loop = true;
    const banda = ctx.createBiquadFilter();
    banda.type = "bandpass";
    banda.Q.value = 9;
    banda.frequency.value = 900;
    const volumenGorgoteo = ctx.createGain();
    volumenGorgoteo.gain.value = 0;
    gorgoteo.connect(banda).connect(volumenGorgoteo).connect(general);
    rio.start();
    gorgoteo.start();
    return { ctx, general, banda, volumenGorgoteo, siguientePajaro: 2, siguienteGrillo: 0 };
}

function actualizarSonido() {
    if (!audio) return;
    audio.general.gain.setTargetAtTime(sonidoActivo ? 0.5 : 0, audio.ctx.currentTime, 0.4);
}

botonSonido.addEventListener("click", () => {
    if (!audio) audio = crearAudio();
    audio.ctx.resume();
    sonidoActivo = !sonidoActivo;
    botonSonido.classList.toggle("activo", sonidoActivo);
    botonSonido.setAttribute("aria-pressed", sonidoActivo);
    actualizarSonido();
});

function pitido(frecuencia, final, duracion, volumen, retraso = 0, tipo = "sine") {
    const ctx = audio.ctx;
    const t = ctx.currentTime + retraso;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(frecuencia, t);
    osc.frequency.exponentialRampToValueAtTime(final, t + duracion);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(volumen, t + 0.01);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
    osc.connect(vol).connect(audio.general);
    osc.start(t);
    osc.stop(t + duracion + 0.02);
    osc.onended = () => {
        osc.disconnect();
        vol.disconnect();
    };
}

function sonarGota(fuerza) {
    if (!audio || !sonidoActivo) return;
    const base = 260 + Math.random() * 200;
    pitido(base, base * (2.5 + Math.random()), 0.08 + fuerza * 0.05, 0.12 * fuerza);
}

function moverSonido(delta) {
    if (!audio || !sonidoActivo) return;
    const t = audio.ctx.currentTime;
    if (Math.random() < delta * 6) {
        audio.banda.frequency.setTargetAtTime(500 + Math.random() * 1500, t, 0.05);
        audio.volumenGorgoteo.gain.setTargetAtTime(Math.random() * 0.5, t, 0.08);
    }
    if (momento === "noche") {
        audio.siguienteGrillo -= delta;
        if (audio.siguienteGrillo <= 0) {
            audio.siguienteGrillo = 0.7 + Math.random() * 0.6;
            const f = 4200 + Math.random() * 400;
            for (let i = 0; i < 3; i++) pitido(f, f * 0.98, 0.04, 0.025, i * 0.06);
        }
    } else {
        audio.siguientePajaro -= delta;
        if (audio.siguientePajaro <= 0) {
            audio.siguientePajaro = (momento === "manana" ? 3 : 6) + Math.random() * 6;
            const notas = 2 + Math.floor(Math.random() * 4);
            const base = 2200 + Math.random() * 1500;
            for (let i = 0; i < notas; i++) pitido(base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.8), 0.09 + Math.random() * 0.06, 0.04, i * 0.13);
        }
    }
}


// =====================================================================
// 17. LAS TARJETAS
// Se pueden cerrar una a una o todas a la vez para ver el paisaje.
// =====================================================================

const botonPaisaje = document.getElementById("boton-paisaje");
const tarjetas = [...document.querySelectorAll(".tarjeta")];

function mostrarTarjetas(mostrar) {
    document.body.classList.toggle("sin-tarjetas", !mostrar);
    botonPaisaje.textContent = mostrar ? "Ver el paisaje" : "Ver tarjetas";
    botonPaisaje.setAttribute("aria-pressed", !mostrar);
    if (mostrar) {
        tarjetas.forEach((t) => {
            t.classList.remove("oculta");
            requestAnimationFrame(() => t.classList.remove("cerrada"));
        });
    }
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

document.querySelectorAll("[data-momento]").forEach((boton) => {
    boton.addEventListener("click", () => cambiarMomento(boton.dataset.momento));
});

if (parametros.get("tarjetas") === "no") mostrarTarjetas(false);


// =====================================================================
// 18. TAMAÑO Y CALIDAD
// La resolución baja sola si el móvil no llega a buen ritmo.
// =====================================================================

let claveOndas = "";

function ajustarTamano() {
    colocarVista();
    const proporcion = Math.min(devicePixelRatio || 1, ajustes.resolucionMax) * escalaResolucion;
    renderizador.setPixelRatio(proporcion);
    renderizador.setSize(innerWidth, innerHeight, false);
    const ancho = Math.round(innerWidth * proporcion);
    const alto = Math.round(innerHeight * proporcion);
    [objetivoFinal, objetivoPeces, objetivoSombras].forEach((o) => o && o.dispose());
    objetivoFinal = objetivo(ancho, alto, { tipo: TIPO_HDR });
    objetivoPeces = objetivo(Math.ceil(ancho * 0.6), Math.ceil(alto * 0.6));
    objetivoSombras = objetivo(Math.ceil(ancho / 2), Math.ceil(alto / 2));
    materialAgua.uniforms.tPeces.value = objetivoPeces.texture;
    materialAgua.uniforms.tSombras.value = objetivoSombras.texture;
    materialAcabado.uniforms.tFinal.value = objetivoFinal.texture;
    materialAcabado.uniforms.uAspecto.value = innerWidth / innerHeight;
    const clave = innerWidth + "x" + innerHeight;
    if (clave !== claveOndas) {
        claveOndas = clave;
        crearOndas();
    }
}

let tamanoPendiente = null;
window.addEventListener("resize", () => {
    clearTimeout(tamanoPendiente);
    tamanoPendiente = setTimeout(ajustarTamano, 150);
});

const medida = { tiempo: 0, fotogramas: 0, deltas: [] };

function vigilarRitmo(delta) {
    medida.tiempo += delta;
    medida.fotogramas++;
    medida.deltas.push(delta);
    if (medida.tiempo < 2.5) return;
    const fps = medida.fotogramas / medida.tiempo;
    const media = medida.tiempo / medida.fotogramas;
    const desviacion = Math.sqrt(medida.deltas.reduce((s, d) => s + (d - media) ** 2, 0) / medida.deltas.length);
    const topeTreinta = fps > 27 && fps < 33 && desviacion < 0.003;
    medida.tiempo = 0;
    medida.fotogramas = 0;
    medida.deltas = [];
    if (topeTreinta) return;
    if (fps < 42 && escalaResolucion > 0.55) {
        escalaResolucion = Math.max(0.55, escalaResolucion - 0.15);
        ajustarTamano();
    } else if (fps > 58 && escalaResolucion < 1) {
        escalaResolucion = Math.min(1, escalaResolucion + 0.1);
        ajustarTamano();
    }
}


// =====================================================================
// 19. ARRANQUE Y BUCLE
// =====================================================================

const reloj = new THREE.Clock();
const cargando = document.getElementById("cargando");
let listo = false;

ajustarTamano();
aplicarMomento(-1);
cambiarMomento(momento);

function terminarCarga() {
    leerMapas();
    crearPeces();
    crearHojas(escenaFinal);
    crearPlantas(escenaFinal);
    crearLuciernagas(escenaFinal);
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
}

function dibujar() {
    renderizador.setRenderTarget(objetivoSombras);
    renderizador.clear();
    renderizador.render(escenaSombras, camara);
    renderizador.setRenderTarget(objetivoPeces);
    renderizador.clear();
    renderizador.render(escenaPeces, camara);
    renderizador.setRenderTarget(objetivoFinal);
    renderizador.clear();
    renderizador.render(escenaFinal, camara);
    renderizador.setRenderTarget(null);
    renderizador.render(escenaAcabado, camara);
}

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    if (!listo) {
        for (let i = 0; i < ajustes.trozosPorFotograma; i++) hornearTrozo();
        cargando.textContent = "Cargando el río... " + Math.round((1 - tareasHorno.length / totalTareas) * 100) + "%";
        if (!tareasHorno.length) terminarCarga();
        return;
    }
    comunes.uTiempo.value += delta;
    aplicarMomento(delta);
    if (materialSombraPlantas) {
        const s = comunes.uSol.value;
        materialSombraPlantas.uniforms.uDesv.value.set(-s.x / Math.max(s.z, 0.25), -s.y / Math.max(s.z, 0.25));
    }
    materialAcabado.uniforms.uFundido.value = Math.min(1, materialAcabado.uniforms.uFundido.value + delta * 0.8);
    vidaDelRio(delta);
    moverPeces(delta);
    moverHojas(delta);
    moverLuciernagas(delta);
    moverSonido(delta);
    simularOndas(delta);
    materialAgua.uniforms.tOndas.value = ondas[0].texture;
    dibujar();
    vigilarRitmo(delta);
}

animar();
