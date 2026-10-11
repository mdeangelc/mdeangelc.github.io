import * as THREE from "three";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES
// El remanso visto desde la orilla, a la altura de los ojos: la poza
// verde, el banco de troncos, un árbol delante, rocas a la izquierda,
// el bosque detrás y el peñón al fondo. El agua se dibuja al final en
// una pasada a pantalla completa con reflejo, transparencia y ondas.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 2,
    sombra: movil ? 1024 : 2048,
    reflejo: movil ? 0.4 : 0.5,
    ondas: movil ? 0.75 : 1,
    terreno: movil ? 170 : 240,
    hojasPorArbol: movil ? 13 : 18,
    luciernagas: movil ? 40 : 60
};

let semilla = 11;
const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return (semilla - 1) / 2147483646;
};
const ruido = new SimplexNoise({ random: azar });
const suave = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};


// =====================================================================
// 2. EL TERRENO
// Una sola función da la altura en cualquier punto: la orilla de
// delante, las rocas de la izquierda, la playa de grava de la derecha
// y el bosque del fondo que sube hacia el monte. Bajo cero es agua.
// =====================================================================

const orillaCerca = (x) => 1.0 + 0.35 * Math.sin(x * 0.7 + 1.0) + 0.18 * Math.sin(x * 1.9 + 0.3);
const orillaLejos = (x) => -31 + 2.2 * Math.sin(x * 0.23 + 0.5) + 1.0 * Math.sin(x * 0.7);
const bordeIzquierdo = (z) => -5.6 + 1.7 * suave(-4, -9, z) - 3.2 * suave(-15, -24, z) + 0.5 * Math.sin(z * 0.5 + 1.2) + 0.3 * Math.sin(z * 1.1);
const bordeDerecho = (z) => 6.6 - 1.0 * suave(-6, -12, z) + 3.4 * suave(-17, -27, z) + 0.6 * Math.sin(z * 0.3 + 0.4) + 0.3 * Math.sin(z * 0.9 + 2.0);

const perfiles = [
    (d) => 0.42 * suave(0, 0.8, d) + Math.max(0, d - 6) * 0.15,
    (d) => 0.7 * suave(0, 1.5, d) + Math.max(0, d - 3) * 0.3,
    (d) => 2.4 * suave(0, 3.2, d) + Math.max(0, d - 3) * 0.45,
    (d) => 0.32 * suave(0, 3, d) + Math.max(0, d - 4) * 0.45
];

function zonas(x, z, h) {
    const dLejos = z - orillaLejos(x);
    const dIzq = x - bordeIzquierdo(z);
    const dDer = bordeDerecho(z) - x;
    const monte = Math.max(suave(0.8, 2.2, -dIzq), suave(1.0, 2.8, -dLejos), suave(5, 8, -dDer), suave(1.4, 2.6, h));
    const playa = suave(-0.6, 0.4, -dDer) * (1 - monte) * suave(1.5, -1.5, z);
    return [monte, playa];
}

function altura(x, z) {
    const d = [orillaCerca(x) - z, z - orillaLejos(x), x - bordeIzquierdo(z), bordeDerecho(z) - x];
    const minimo = Math.min(d[0], d[1], d[2], d[3]);
    let suma = 0;
    let total = 0;
    for (let i = 0; i < 4; i++) {
        const peso = Math.exp(-(d[i] - minimo) * 1.6);
        const valor = d[i] > 0 ? -2.3 * (1 - Math.exp(-d[i] * 0.75)) : perfiles[i](-d[i]);
        suma += peso * valor;
        total += peso;
    }
    let h = suma / total;
    const tierra = suave(-0.2, 0.6, -minimo);
    h += ruido.noise(x * 0.16, z * 0.16) * 0.5 * tierra * suave(1, 6, -minimo);
    h += ruido.noise(x * 0.9, z * 0.9) * 0.035 * tierra;
    h += Math.max(0, Math.abs(x - 1) - 16) * 0.55;
    h += Math.max(0, -z - 50) * 0.14;
    if (minimo > 0) h += ruido.noise(x * 0.5, z * 0.5) * 0.15 * suave(0, 2, minimo);
    return h;
}


// =====================================================================
// 3. RENDERIZADOR, CÁMARA Y LUCES
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
renderizador.shadowMap.autoUpdate = false;
renderizador.setClearColor(0x000000, 1);
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
escena.fog = new THREE.FogExp2(0xa8c2d6, 0.0042);

const camara = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1400);
const camaraReflejo = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1400);
const POSICION_BASE = new THREE.Vector3(0.15, 2.15, 5.0);
const objetivoVista = new THREE.Vector3();

const sol = new THREE.DirectionalLight(0xffffff, 3);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
Object.assign(sol.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 60 });
sol.shadow.bias = -0.0004;
sol.shadow.normalBias = 0.03;
sol.target.position.set(0, 0, 0);
escena.add(sol, sol.target);

const cielo = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a44, 1);
escena.add(cielo);

const comunes = {
    uTiempo: { value: 0 },
    uRecorte: { value: 0 },
    uSol: { value: new THREE.Vector3(0.45, 0.8, -0.4).normalize() },
    uColorSol: { value: new THREE.Color(1, 1, 1) },
    uCieloLuz: { value: new THREE.Color(0.6, 0.7, 0.9) },
    uSueloLuz: { value: new THREE.Color(0.3, 0.26, 0.2) },
    uNiebla: { value: escena.fog.color },
    uDensidad: { value: escena.fog.density },
    uNoche: { value: 0 }
};


// =====================================================================
// 4. TROZOS DE GLSL Y MATERIALES PROCEDURALES
// Los materiales de siempre de three.js (con su luz y sus sombras),
// pero con el color calculado en el shader a partir de la posición.
// =====================================================================

const GLSL_RUIDO = `
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}
float ruido(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ruido3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        s += a * ruido(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return s;
}
float sombraMoteada(vec3 p) {
    float zona = smoothstep(3.6, 1.2, length(p.xz - vec2(-1.6, 3.2)));
    zona = max(zona, smoothstep(-18.5, -21.0, p.z) * 0.85);
    zona = max(zona, smoothstep(-4.2, -6.0, p.x) * 0.7);
    if (zona <= 0.0) return 1.0;
    vec2 q = p.xz * 1.5 + vec2(sin(uTiempo * 0.6), cos(uTiempo * 0.47)) * 0.06;
    float n = ruido(q) * 0.6 + ruido(q * 2.7 + 3.0) * 0.4;
    float luz = smoothstep(0.44, 0.56, n);
    return mix(1.0, 0.16 + 0.84 * luz, zona);
}
`;

function materialProcedural(colorGLSL, opciones = {}) {
    const material = new THREE.MeshStandardMaterial({
        roughness: opciones.rugosidad ?? 0.95,
        metalness: 0,
        side: opciones.lado || THREE.FrontSide
    });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTiempo = comunes.uTiempo;
        const conZona = opciones.zona ? "attribute vec2 aZona;\nvarying vec2 vZona;\n" : "";
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vMundo;\nvarying vec3 vNormalMundo;\nvarying vec3 vLocal;\n" + conZona)
            .replace(
                "#include <worldpos_vertex>",
                `#include <worldpos_vertex>
                vec4 puntoMundo = vec4(transformed, 1.0);
                vec3 normalMundo = objectNormal;
                #ifdef USE_INSTANCING
                    puntoMundo = instanceMatrix * puntoMundo;
                    normalMundo = mat3(instanceMatrix) * normalMundo;
                #endif
                puntoMundo = modelMatrix * puntoMundo;
                vMundo = puntoMundo.xyz;
                vNormalMundo = normalize(mat3(modelMatrix) * normalMundo);
                vLocal = position;
                ${opciones.zona ? "vZona = aZona;" : ""}`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vMundo;\nvarying vec3 vNormalMundo;\nvarying vec3 vLocal;\nuniform float uTiempo;\n" + (opciones.zona ? "varying vec2 vZona;\n" : "") + GLSL_RUIDO + colorGLSL)
            .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= colorProcedural(vMundo, normalize(vNormalMundo), vLocal);")
            .replace(
                "#include <aomap_fragment>",
                `float moteado = sombraMoteada(vMundo);
                reflectedLight.directDiffuse *= moteado;
                reflectedLight.directSpecular *= moteado;
                #include <aomap_fragment>`
            );
    };
    return material;
}

const COLOR_TERRENO = `
vec3 colorProcedural(vec3 p, vec3 n, vec3 l) {
    float h = p.y;
    float pendiente = 1.0 - n.y;
    vec3 tierra = vec3(0.68, 0.58, 0.46) * (0.82 + 0.3 * fbm(p.xz * 1.1)) * (0.9 + 0.14 * ruido(p.xz * 22.0));
    vec2 celda = floor(p.xz * 22.0);
    float piedra = step(0.86, hash12(celda)) * smoothstep(0.4, 0.15, length(fract(p.xz * 22.0) - 0.5)) * smoothstep(0.2, 0.05, pendiente);
    tierra = mix(tierra, vec3(0.76, 0.73, 0.68) * (0.75 + 0.3 * hash12(celda + 3.0)), piedra * 0.6);
    vec2 cg = floor(p.xz * 9.0);
    float canto = smoothstep(0.5, 0.2, length(fract(p.xz * 9.0) - 0.3 - 0.4 * vec2(hash12(cg), hash12(cg + 5.0))));
    vec3 grava = mix(vec3(0.42, 0.41, 0.38), vec3(0.58, 0.56, 0.52), ruido(p.xz * 7.0)) * (0.82 + 0.22 * ruido(p.xz * 34.0));
    grava = mix(grava, vec3(0.66, 0.64, 0.6) * (0.75 + 0.3 * hash12(cg)), canto * 0.7);
    vec3 bosque = mix(vec3(0.22, 0.25, 0.12), vec3(0.42, 0.37, 0.24), fbm(p.xz * 0.35));
    vec3 roca = vec3(0.56, 0.54, 0.5) * (0.6 + 0.45 * fbm(p.xz * 0.6 + p.y * 0.8));
    vec3 lecho = mix(vec3(0.6, 0.58, 0.5), vec3(0.45, 0.48, 0.36), fbm(p.xz * 0.6)) * (0.78 + 0.3 * ruido(p.xz * 12.0));
    float playa = vZona.y;
    float monte = vZona.x;
    vec3 c = mix(tierra, grava, playa);
    c = mix(c, bosque, monte);
    c = mix(c, roca, smoothstep(0.32, 0.6, pendiente) * (0.35 + 0.65 * monte));
    float bajo = smoothstep(0.02, -0.25, h);
    c = mix(c, lecho, bajo);
    float mojado = smoothstep(0.12, 0.0, h) * (1.0 - bajo);
    c *= 1.0 - mojado * 0.4;
    return pow(c, vec3(2.2));
}
`;

const COLOR_CALIZA = `
vec3 colorProcedural(vec3 p, vec3 n, vec3 l) {
    float estratos = sin(p.y * 5.0 + fbm(p.xz * 0.7) * 4.0) * 0.5 + 0.5;
    vec3 c = mix(vec3(0.76, 0.75, 0.72), vec3(0.58, 0.57, 0.55), estratos * 0.6);
    c *= 0.65 + 0.45 * ruido3(p * 1.4) * (0.7 + 0.3 * ruido3(p * 6.0));
    float churrete = smoothstep(0.55, 0.8, ruido(vec2((p.x + p.z) * 2.6, p.y * 0.35)));
    c = mix(c, vec3(0.3, 0.29, 0.27), churrete * 0.55 * (1.0 - abs(n.y)));
    float oxido = smoothstep(0.62, 0.8, ruido3(p * 0.35 + 7.0));
    c = mix(c, vec3(0.72, 0.5, 0.32), oxido * 0.4);
    float musgo = smoothstep(0.55, 0.85, n.y) * smoothstep(0.45, 0.7, ruido3(p * 0.8));
    c = mix(c, vec3(0.34, 0.4, 0.17), musgo * 0.65);
    c *= 1.0 - smoothstep(0.3, 0.0, p.y) * 0.45;
    return pow(c, vec3(2.2));
}
`;

const COLOR_PENON = `
vec3 colorProcedural(vec3 p, vec3 n, vec3 l) {
    float estratos = sin(p.y * 0.55 + fbm(p.xy * 0.03) * 6.0) * 0.5 + 0.5;
    vec3 c = mix(vec3(0.8, 0.76, 0.68), vec3(0.66, 0.6, 0.52), estratos * 0.6);
    c *= 0.72 + 0.4 * fbm(p.xy * 0.08);
    float grieta = smoothstep(0.6, 0.85, ruido(vec2(p.x * 0.25, p.y * 0.02)));
    c = mix(c, vec3(0.32, 0.3, 0.28), grieta * 0.6);
    float oxido = smoothstep(0.55, 0.8, fbm(p.xy * 0.02 + 5.0));
    c = mix(c, vec3(0.78, 0.55, 0.36), oxido * 0.45);
    float matas = smoothstep(0.35, 0.7, n.y) * smoothstep(0.4, 0.65, ruido(p.xy * 0.12));
    matas = max(matas, smoothstep(14.0, 0.0, p.y) * 0.85);
    c = mix(c, vec3(0.26, 0.3, 0.15), matas);
    return pow(c, vec3(2.2));
}
`;

const COLOR_TABLA = `
vec3 colorProcedural(vec3 p, vec3 n, vec3 l) {
    vec3 c = vec3(0.6, 0.53, 0.44);
    float veta = sin(l.y * 90.0 + fbm(l.xz * vec2(1.5, 18.0)) * 8.0) * 0.5 + 0.5;
    c *= 0.82 + 0.18 * veta;
    float grieta = smoothstep(0.82, 0.9, ruido(vec2(l.x * 2.0, l.z * 40.0)));
    c *= 1.0 - grieta * 0.55;
    float lado = step(0.7, abs(l.x) / 0.75);
    float anillos = sin(length(l.yz) * 160.0) * 0.5 + 0.5;
    c = mix(c, vec3(0.66, 0.56, 0.42) * (0.8 + 0.2 * anillos), lado * step(0.995, abs(l.x) / 0.75));
    c *= 0.85 + 0.25 * fbm(l.xz * 6.0);
    return pow(c, vec3(2.2));
}
`;

const COLOR_TRONCO = `
vec3 colorProcedural(vec3 p, vec3 n, vec3 l) {
    vec3 c = vec3(0.56, 0.48, 0.38);
    float veta = sin(atan(l.y, l.x) * 26.0 + fbm(l.xz * vec2(6.0, 2.0)) * 5.0) * 0.5 + 0.5;
    c *= 0.78 + 0.22 * veta;
    float tapa = step(0.205, abs(l.z));
    float anillos = sin(length(l.xy) * 140.0) * 0.5 + 0.5;
    c = mix(c, vec3(0.7, 0.6, 0.45) * (0.82 + 0.18 * anillos), tapa);
    return pow(c, vec3(2.2));
}
`;

const COLOR_CORTEZA = `
vec3 colorProcedural(vec3 p, vec3 n, vec3 l) {
    vec3 c = mix(vec3(0.46, 0.4, 0.33), vec3(0.62, 0.58, 0.52), ruido(vec2(atan(l.z, l.x) * 3.0, l.y * 9.0)));
    c *= 0.8 + 0.25 * ruido(vec2(atan(l.z, l.x) * 12.0, l.y * 40.0));
    return pow(c, vec3(2.2));
}
`;


// =====================================================================
// 5. SUELO, ROCAS, PEÑÓN Y BANCO
// =====================================================================

function crearTerreno() {
    const n = ajustes.terreno;
    const geometria = new THREE.PlaneGeometry(1, 1, n, n);
    geometria.rotateX(-Math.PI / 2);
    const pos = geometria.attributes.position;
    const zona = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) * 2;
        const v = pos.getZ(i) + 0.5;
        const x = 1 + Math.sign(u) * Math.pow(Math.abs(u), 1.6) * 60;
        const z = 9 - Math.pow(1 - v, 1.7) * 160;
        const h = altura(x, z);
        pos.setXYZ(i, x, h, z);
        zona.set(zonas(x, z, h), i * 2);
    }
    geometria.setAttribute("aZona", new THREE.BufferAttribute(zona, 2));
    geometria.computeVertexNormals();
    const suelo = new THREE.Mesh(geometria, materialProcedural(COLOR_TERRENO, { zona: true }));
    suelo.receiveShadow = true;
    escena.add(suelo);
}

function piedraBlanda(detalle, fuerza, frecuencia) {
    const base = new THREE.IcosahedronGeometry(1, detalle);
    base.deleteAttribute("normal");
    base.deleteAttribute("uv");
    const geometria = mergeVertices(base);
    const pos = geometria.attributes.position;
    const v = new THREE.Vector3();
    const semillaPiedra = azar() * 100;
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let k = 1 + ruido.noise3d(v.x * frecuencia + semillaPiedra, v.y * frecuencia, v.z * frecuencia) * fuerza;
        k += ruido.noise3d(v.x * 2.4, v.y * 2.4 + semillaPiedra, v.z * 2.4) * fuerza * 0.18;
        v.multiplyScalar(k);
        if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.4;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geometria.computeVertexNormals();
    return geometria;
}

function crearRocas() {
    const material = materialProcedural(COLOR_CALIZA, { rugosidad: 0.85 });
    const rocas = [
        [-5.5, -0.7, 1.8, 1.4, 1.5, 0.3],
        [-7.4, -0.9, 2.2, 1.9, 1.9, 1.1],
        [-9.6, -0.5, 1.6, 1.2, 1.4, 2.2],
        [-11.4, -1.0, 2.3, 1.7, 1.9, 1.7],
        [-13.2, -0.6, 2.0, 1.5, 1.7, 0.2],
        [-8.4, -2.4, 2.6, 2.8, 2.3, 2.6],
        [-12.0, -2.6, 2.4, 2.6, 2.2, 0.9],
        [-4.0, -0.2, 0.9, 0.55, 0.8, 1.4],
        [-15.5, -0.4, 1.4, 0.9, 1.2, 2.9]
    ].map(([z, dx, sx, sy, sz, giro]) => [bordeIzquierdo(z) + dx, z, sx, sy, sz, giro]);
    rocas.push([bordeDerecho(-12) + 0.3, -12, 0.7, 0.35, 0.6, 0.5], [bordeDerecho(-16) + 0.6, -16, 1.0, 0.5, 0.8, 1.9], [-1.5, -31.5, 1.3, 0.8, 1.1, 0.9]);
    rocas.forEach(([x, z, sx, sy, sz, giro]) => {
        const roca = new THREE.Mesh(piedraBlanda(movil ? 14 : 22, 0.22, 0.8), material);
        roca.scale.set(sx, sy, sz);
        roca.rotation.y = giro;
        roca.position.set(x, Math.min(altura(x, z), 0.3) + sy * 0.25, z);
        roca.castShadow = true;
        roca.receiveShadow = true;
        escena.add(roca);
    });
}

function crearPenon() {
    const ancho = movil ? 150 : 220;
    const alto = movil ? 70 : 100;
    const geometria = new THREE.PlaneGeometry(1, 1, ancho, alto);
    const pos = geometria.attributes.position;
    const cima = (x) => 32 + 38 * Math.exp(-(((x - 15) / 11) ** 2)) + 18 * Math.exp(-(((x + 20) / 18) ** 2)) + 8 * Math.exp(-(((x - 42) / 12) ** 2)) + ruido.noise(x * 0.1, 3) * 4;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * 190 + 8;
        const t = pos.getY(i) + 0.5;
        const techo = cima(x);
        const y = -4 + t * (techo + 4);
        const saliente = ruido.noise(x * 0.05, y * 0.05) * 6 + ruido.noise(x * 0.2, y * 0.12) * 2;
        const z = -112 - saliente - Math.pow(t, 3) * 8 + Math.abs(x - 15) * 0.1;
        pos.setXYZ(i, x + ruido.noise(y * 0.06, x * 0.02) * 2.5, y, z);
    }
    geometria.computeVertexNormals();
    const penon = new THREE.Mesh(geometria, materialProcedural(COLOR_PENON));
    escena.add(penon);
}

function crearBanco() {
    const banco = new THREE.Group();
    const tabla = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.38, 12, 2, 4), materialProcedural(COLOR_TABLA, { rugosidad: 0.9 }));
    tabla.position.y = 0.44;
    const pie = new THREE.CylinderGeometry(0.17, 0.17, 0.42, 20);
    pie.rotateX(Math.PI / 2);
    const materialPie = materialProcedural(COLOR_TRONCO, { rugosidad: 0.95 });
    [-0.55, 0.55].forEach((x) => {
        const p = new THREE.Mesh(pie, materialPie);
        p.position.set(x, 0.2, 0);
        p.rotation.z = (azar() - 0.5) * 0.4;
        p.castShadow = p.receiveShadow = true;
        banco.add(p);
    });
    tabla.castShadow = tabla.receiveShadow = true;
    banco.add(tabla);
    banco.position.set(0.75, altura(0.75, 2.3) - 0.02, 2.3);
    banco.rotation.y = 0.38;
    escena.add(banco);
}


// =====================================================================
// 6. LOS ÁRBOLES
// Cada copa son muchas "matas" de hojas: cuadrados que miran siempre a
// la cámara, con una textura de hojas pintada en un lienzo. Se iluminan
// como si la copa fuera una bola, con luz que atraviesa a contraluz.
// =====================================================================

function texturaHojas() {
    const lado = 512;
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = lado;
    const g = lienzo.getContext("2d");
    for (let cuadro = 0; cuadro < 4; cuadro++) {
        const ox = (cuadro % 2) * 256 + 128;
        const oy = Math.floor(cuadro / 2) * 256 + 128;
        const n = 210;
        for (let i = 0; i < n; i++) {
            const r = Math.pow(azar(), 0.6) * 108;
            const a = azar() * Math.PI * 2;
            const largo = 6 + azar() * 6;
            const tono = 0.55 + (i / n) * 0.45 + (azar() - 0.5) * 0.15;
            g.save();
            g.translate(ox + Math.cos(a) * r, oy + Math.sin(a) * r);
            g.rotate(azar() * Math.PI * 2);
            g.fillStyle = `rgb(${Math.round(175 * tono)}, ${Math.round(215 * tono)}, ${Math.round(120 * tono)})`;
            g.beginPath();
            g.ellipse(0, 0, largo, largo * 0.5, 0, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = "rgba(70, 90, 40, 0.45)";
            g.lineWidth = 1.2;
            g.beginPath();
            g.moveTo(-largo * 0.9, 0);
            g.lineTo(largo * 0.9, 0);
            g.stroke();
            g.restore();
        }
    }
    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    return textura;
}

const matas = { centros: [], datos: [], copas: [] };
const troncos = [];

function arbol(x, z, alto, radio, tono, opciones = {}) {
    const y0 = opciones.y ?? altura(x, z);
    const estirado = opciones.estirado ?? 1;
    const copa = new THREE.Vector3(x, y0 + alto - radio * estirado * 0.9, z);
    const n = Math.max(5, Math.min(48, Math.round(ajustes.hojasPorArbol * (opciones.densidad ?? 1) * Math.pow(radio / 2.2, 1.3) * estirado)));
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        v.randomDirection();
        const r = 0.5 + 0.5 * Math.sqrt(azar());
        v.multiplyScalar(r);
        v.y *= estirado * 0.9;
        const p = copa.clone().addScaledVector(v, radio);
        matas.centros.push(p.x, p.y, p.z);
        matas.datos.push(radio * (0.55 + azar() * 0.35), azar(), Math.max(0, Math.min(1, tono + (azar() - 0.5) * 0.12)), (r - 0.5) * 2);
        matas.copas.push(copa.x, copa.y - radio * 0.3, copa.z);
    }
    if (!opciones.sinTronco) troncos.push({ x, y: y0, z, alto: Math.max(1, alto - radio * estirado * 1.5), r: Math.max(0.08, radio * 0.06) });
}

function repartirArboles() {
    const intentar = (n, zona, medidas) => {
        for (let i = 0, puestos = 0; i < n * 6 && puestos < n; i++) {
            const x = zona.x[0] + azar() * (zona.x[1] - zona.x[0]);
            const z = zona.z[0] + azar() * (zona.z[1] - zona.z[0]);
            if (altura(x, z) < (zona.minimo ?? 0.25)) continue;
            medidas(x, z);
            puestos++;
        }
    };
    intentar(movil ? 36 : 50, { x: [-26, -5], z: [2, -36], minimo: 0.7 }, (x, z) => {
        const r = 2.2 + azar() * 1.8;
        arbol(x, z, 6 + azar() * 6, r, 0.25 + azar() * 0.35);
    });
    intentar(movil ? 46 : 64, { x: [-22, 30], z: [-32, -54], minimo: 0.4 }, (x, z) => {
        const centro = x > -5 && x < 14;
        const alamo = azar() < 0.4;
        const r = centro ? 1.7 + azar() * 1.2 : 2 + azar() * 1.6;
        const alto = centro ? 5 + azar() * 3.5 : 9 + azar() * 7;
        arbol(x, z, alto, r, alamo ? 0.55 + azar() * 0.3 : 0.3 + azar() * 0.35, { estirado: alamo ? 1.7 : 1 });
    });
    intentar(movil ? 20 : 28, { x: [8, 30], z: [0, -32], minimo: 0.5 }, (x, z) => {
        arbol(x, z, 7 + azar() * 8, 1.8 + azar() * 1.5, 0.45 + azar() * 0.4, { estirado: azar() < 0.5 ? 1.6 : 1 });
    });
    intentar(movil ? 40 : 60, { x: [-45, 50], z: [-54, -95], minimo: 0.5 }, (x, z) => {
        arbol(x, z, 5 + azar() * 4, 2.6 + azar() * 1.6, 0.08 + azar() * 0.25, { densidad: 0.7 });
    });
    for (let i = 0; i < (movil ? 40 : 60); i++) {
        const z = 1 - azar() * 32;
        const x = bordeIzquierdo(z) - 1 - azar() * 5;
        arbol(x, z, 1.2 + azar() * 1.4, 0.8 + azar() * 0.8, 0.15 + azar() * 0.5, { sinTronco: true, densidad: 1.5, y: altura(x, z) - 0.3 });
    }
    intentar(movil ? 50 : 80, { x: [-14, 18], z: [3, -36], minimo: 0.35 }, (x, z) => {
        if (z > -1 && x > -3 && x < 5) return;
        arbol(x, z, 0.9 + azar() * 1.0, 0.7 + azar() * 0.6, 0.2 + azar() * 0.5, { sinTronco: true, densidad: 1.4, y: altura(x, z) - 0.2 });
    });
    arbol(9.2, -3.2, 7.5, 2.2, 0.85, { estirado: 1.3 });
    arbol(10.2, -6.4, 9, 2.4, 0.7, { estirado: 1.4 });
}

const ramas = [];

function arbolDelante() {
    const base = new THREE.Vector3(-1.05, altura(-1.05, 2.45) - 0.1, 2.45);
    const punta = new THREE.Vector3(-1.6, 7.2, 1.7);
    ramas.push({ desde: base, hasta: punta, r0: 0.075, r1: 0.035 });
    const brazos = [
        [0.42, new THREE.Vector3(1.9, 4.1, 0.1)],
        [0.55, new THREE.Vector3(0.7, 4.9, -0.9)],
        [0.62, new THREE.Vector3(-2.2, 5.0, 0.4)],
        [0.75, new THREE.Vector3(0.2, 6.6, 0.2)]
    ];
    brazos.forEach(([t, fin]) => {
        const inicio = base.clone().lerp(punta, t);
        ramas.push({ desde: inicio, hasta: fin, r0: 0.045, r1: 0.015 });
        for (let i = 0; i < (movil ? 11 : 20); i++) {
            const k = 0.12 + azar() * 0.95;
            const p = inicio.clone().lerp(fin, Math.min(1.05, k));
            p.x += (azar() - 0.5) * 0.9;
            p.y += (azar() - 0.3) * 0.7;
            p.z += (azar() - 0.5) * 0.9;
            matas.centros.push(p.x, p.y, p.z);
            matas.datos.push(0.55 + azar() * 0.4, azar(), 0.95 + azar() * 0.05, 0.55 + azar() * 0.45);
            matas.copas.push(p.x - 0.2, p.y - 0.6, p.z + 0.2);
        }
    });
    const material = materialProcedural(COLOR_CORTEZA, { rugosidad: 0.9 });
    ramas.forEach((r) => {
        const largo = r.desde.distanceTo(r.hasta);
        const geo = new THREE.CylinderGeometry(r.r1, r.r0, largo, 10, 4);
        geo.translate(0, largo / 2, 0);
        const malla = new THREE.Mesh(geo, material);
        malla.position.copy(r.desde);
        malla.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.hasta.clone().sub(r.desde).normalize());
        malla.castShadow = true;
        escena.add(malla);
    });
}

let materialMatas = null;

function crearCopas() {
    const n = matas.centros.length / 3;
    const plano = new THREE.PlaneGeometry(1, 1);
    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = plano.index;
    geometria.setAttribute("position", plano.getAttribute("position"));
    geometria.setAttribute("uv", plano.getAttribute("uv"));
    geometria.setAttribute("aCentro", new THREE.InstancedBufferAttribute(new Float32Array(matas.centros), 3));
    geometria.setAttribute("aDatos", new THREE.InstancedBufferAttribute(new Float32Array(matas.datos), 4));
    geometria.setAttribute("aCopa", new THREE.InstancedBufferAttribute(new Float32Array(matas.copas), 3));
    geometria.instanceCount = n;
    materialMatas = new THREE.ShaderMaterial({
        uniforms: { ...comunes, tHojas: { value: texturaHojas() } },
        vertexShader: `
            attribute vec3 aCentro;
            attribute vec4 aDatos;
            attribute vec3 aCopa;
            uniform float uTiempo;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec4 vDatos;
            varying vec3 vMundo;
            varying float vDistancia;
            void main() {
                vec3 derecha = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                vec3 arriba = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                float a = aDatos.y * 6.2832;
                vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy;
                float tam = aDatos.x;
                vec3 viento = vec3(sin(uTiempo * 1.3 + aDatos.y * 20.0), sin(uTiempo * 1.7 + aDatos.y * 9.0) * 0.4, cos(uTiempo * 1.1 + aDatos.y * 13.0)) * 0.035 * tam;
                vec3 p = aCentro + viento + (derecha * q.x + arriba * q.y) * tam;
                vMundo = p;
                vNormal = normalize(p - aCopa);
                vec2 cuadro = vec2(step(0.5, fract(aDatos.y * 7.0)), step(0.5, fract(aDatos.y * 13.0)));
                vUv = uv * 0.5 + cuadro * 0.5;
                vDatos = aDatos;
                vec4 vista = viewMatrix * vec4(p, 1.0);
                vDistancia = -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            uniform sampler2D tHojas;
            uniform vec3 uSol;
            uniform vec3 uColorSol;
            uniform vec3 uCieloLuz;
            uniform vec3 uSueloLuz;
            uniform vec3 uNiebla;
            uniform float uDensidad;
            uniform float uRecorte;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec4 vDatos;
            varying vec3 vMundo;
            varying float vDistancia;
            void main() {
                if (uRecorte > 0.5 && vMundo.y < 0.0) discard;
                vec4 t = texture2D(tHojas, vUv);
                float nivel = log2(max(max(fwidth(vUv.x), fwidth(vUv.y)) * 512.0, 1.0));
                if (t.a * (1.0 + 0.45 * nivel) < 0.5) discard;
                vec3 oscuro = vec3(0.05, 0.09, 0.035);
                vec3 medio = vec3(0.13, 0.22, 0.06);
                vec3 claro = vec3(0.32, 0.46, 0.12);
                vec3 tinte = vDatos.z < 0.5 ? mix(oscuro, medio, vDatos.z * 2.0) : mix(medio, claro, vDatos.z * 2.0 - 1.0);
                vec3 base = t.rgb * tinte * 2.2;
                vec3 n = normalize(vNormal);
                float directa = max(dot(n, uSol), 0.0);
                float atraviesa = pow(max(dot(-n, uSol), 0.0), 1.5) * 0.45 * (0.4 + vDatos.z);
                float hueco = mix(0.35, 1.0, vDatos.w);
                vec3 ambiente = mix(uSueloLuz, uCieloLuz, n.y * 0.5 + 0.5);
                vec3 color = base * (uColorSol * (directa * 0.9 + atraviesa) * hueco + ambiente * hueco * hueco * 0.6);
                float niebla = 1.0 - exp(-pow(uDensidad * vDistancia, 2.0));
                gl_FragColor = vec4(mix(color, uNiebla, niebla), 1.0);
            }
        `,
        extensions: { derivatives: true }
    });
    const malla = new THREE.Mesh(geometria, materialMatas);
    malla.frustumCulled = false;
    escena.add(malla);

    const tronco = new THREE.CylinderGeometry(0.6, 1, 1, 8);
    tronco.translate(0, 0.5, 0);
    const troncosMalla = new THREE.InstancedMesh(tronco, materialProcedural(COLOR_CORTEZA), troncos.length);
    const m = new THREE.Matrix4();
    troncos.forEach((t, i) => {
        m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), new THREE.Quaternion(), new THREE.Vector3(t.r, t.alto + 0.2, t.r));
        troncosMalla.setMatrixAt(i, m);
    });
    escena.add(troncosMalla);
}


// =====================================================================
// 7. JUNCOS Y HIERBA
// =====================================================================

function crearJuncos() {
    const matas = [
        [0.4, 1.12, 34, 0.85], [-1.7, 1.0, 20, 0.6], [2.7, 1.55, 18, 0.55], [-3.2, -1.6, 22, 0.75],
        [4.0, -2.4, 16, 0.6], [-0.35, 2.15, 14, 0.35], [-1.25, 2.7, 12, 0.3], [3.3, 2.6, 10, 0.3],
        [-3.0, -13.5, 20, 0.8], [2.0, -18.6, 26, 0.9], [-1.5, -19.2, 22, 0.8], [4.4, -15.8, 18, 0.7]
    ];
    const posiciones = [];
    const datos = [];
    matas.forEach(([x, z, n, alto]) => {
        const y = Math.max(-0.15, altura(x, z));
        for (let i = 0; i < n; i++) {
            const a = azar() * Math.PI * 2;
            const r = azar() * 0.12;
            posiciones.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
            datos.push(a, alto * (0.6 + azar() * 0.6), 0.25 + azar() * 0.5, azar());
        }
    });
    const n = posiciones.length / 3;
    const plano = new THREE.PlaneGeometry(0.02, 1, 1, 5);
    plano.translate(0, 0.5, 0);
    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = plano.index;
    geometria.setAttribute("position", plano.getAttribute("position"));
    geometria.setAttribute("aBase", new THREE.InstancedBufferAttribute(new Float32Array(posiciones), 3));
    geometria.setAttribute("aDatos", new THREE.InstancedBufferAttribute(new Float32Array(datos), 4));
    geometria.instanceCount = n;
    const material = new THREE.ShaderMaterial({
        uniforms: { ...comunes },
        vertexShader: `
            attribute vec3 aBase;
            attribute vec4 aDatos;
            uniform float uTiempo;
            varying float vAltura;
            varying vec3 vMundo;
            varying float vDistancia;
            varying float vTono;
            void main() {
                float t = position.y;
                float inclina = aDatos.z + sin(uTiempo * 1.6 + aDatos.w * 12.0) * 0.06 * t;
                vec3 dir = vec3(cos(aDatos.x), 0.0, sin(aDatos.x));
                vec3 p = aBase + dir * (sin(inclina) * t * t * aDatos.y) + vec3(0.0, cos(inclina * t) * t * aDatos.y, 0.0);
                vec3 lado = vec3(-dir.z, 0.0, dir.x);
                p += lado * position.x * (1.0 - t * 0.85) * 1.4;
                vAltura = t;
                vMundo = p;
                vTono = aDatos.w;
                vec4 vista = viewMatrix * vec4(p, 1.0);
                vDistancia = -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            uniform vec3 uColorSol;
            uniform vec3 uCieloLuz;
            uniform vec3 uSueloLuz;
            uniform vec3 uNiebla;
            uniform float uDensidad;
            uniform float uRecorte;
            varying float vAltura;
            varying vec3 vMundo;
            varying float vDistancia;
            varying float vTono;
            void main() {
                if (uRecorte > 0.5 && vMundo.y < 0.0) discard;
                vec3 base = mix(vec3(0.16, 0.24, 0.07), vec3(0.55, 0.6, 0.28), vAltura * 0.8 + vTono * 0.25);
                vec3 color = base * (uColorSol * 0.55 + mix(uSueloLuz, uCieloLuz, vAltura) * 0.9);
                float niebla = 1.0 - exp(-pow(uDensidad * vDistancia, 2.0));
                gl_FragColor = vec4(mix(color, uNiebla, niebla), 1.0);
            }
        `,
        side: THREE.DoubleSide
    });
    const malla = new THREE.Mesh(geometria, material);
    malla.frustumCulled = false;
    escena.add(malla);
}


// =====================================================================
// 8. EL CIELO
// Degradado, sol, nubes finas; de noche estrellas y luna.
// =====================================================================

const materialCielo = new THREE.ShaderMaterial({
    uniforms: {
        uSol: comunes.uSol,
        uNoche: comunes.uNoche,
        uTiempo: comunes.uTiempo,
        uArriba: { value: new THREE.Color() },
        uHorizonte: { value: new THREE.Color() },
        uLuna: { value: new THREE.Vector3(-0.35, 0.55, -0.75).normalize() }
    },
    vertexShader: `
        varying vec3 vDir;
        void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
        }
    `,
    fragmentShader: `
        uniform vec3 uSol;
        uniform float uNoche;
        uniform float uTiempo;
        uniform vec3 uArriba;
        uniform vec3 uHorizonte;
        uniform vec3 uLuna;
        varying vec3 vDir;
        ${GLSL_RUIDO.replace(/float sombraMoteada[\s\S]*$/, "")}
        void main() {
            vec3 d = normalize(vDir);
            float alto = clamp(d.y, 0.0, 1.0);
            vec3 c = mix(uHorizonte, uArriba, pow(alto, 0.55));
            float s = max(dot(d, uSol), 0.0);
            c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.35) * (1.0 - uNoche);
            vec2 q = d.xz / max(d.y + 0.15, 0.05);
            float nubes = smoothstep(0.55, 0.85, fbm(q * 0.9 + vec2(uTiempo * 0.004, 0.0))) * smoothstep(0.02, 0.25, d.y);
            c = mix(c, mix(vec3(1.0), uHorizonte, 0.3) * (1.0 - uNoche * 0.92), nubes * 0.5);
            vec2 celda = floor(d.xz / max(d.y, 0.1) * 120.0);
            float estrella = step(0.997, hash12(celda)) * smoothstep(0.05, 0.3, d.y);
            c += vec3(estrella) * uNoche * (0.6 + 0.4 * sin(uTiempo * 2.0 + hash12(celda) * 40.0));
            float luna = smoothstep(0.9993, 0.9996, dot(d, uLuna));
            c += vec3(0.9, 0.92, 1.0) * (luna * 2.5 + pow(max(dot(d, uLuna), 0.0), 60.0) * 0.12) * uNoche;
            gl_FragColor = vec4(c, 1.0);
        }
    `,
    side: THREE.BackSide,
    depthWrite: false
});
const cieloMalla = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), materialCielo);
cieloMalla.frustumCulled = false;
cieloMalla.renderOrder = -10;
escena.add(cieloMalla);


// =====================================================================
// 9. LAS ONDAS
// La misma simulación que en la vista desde arriba, pero en un mapa
// del suelo de la poza. Las orillas hacen de pared.
// =====================================================================

const ZONA = { x: -9.5, z: -33.5, ancho: 21, largo: 35.5 };
const ondasAncho = Math.round(264 * ajustes.ondas);
const ondasLargo = Math.round(448 * ajustes.ondas);
const gl = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && (gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
const TIPO_HDR = hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType;

function objetivo(ancho, alto, opciones = {}) {
    return new THREE.WebGLRenderTarget(ancho, alto, {
        type: opciones.tipo || THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: !!opciones.profundidad,
        stencilBuffer: false,
        depthTexture: opciones.texturaProfundidad ? new THREE.DepthTexture(ancho, alto, THREE.UnsignedIntType) : null
    });
}

function crearMascaraAgua() {
    const datos = new Uint8Array(ondasAncho * ondasLargo * 4);
    for (let j = 0; j < ondasLargo; j++) {
        for (let i = 0; i < ondasAncho; i++) {
            const x = ZONA.x + ((i + 0.5) / ondasAncho) * ZONA.ancho;
            const z = ZONA.z + ((j + 0.5) / ondasLargo) * ZONA.largo;
            const agua = altura(x, z) < -0.02 ? 255 : 0;
            datos.set([agua, agua, agua, 255], (j * ondasAncho + i) * 4);
        }
    }
    const t = new THREE.DataTexture(datos, ondasAncho, ondasLargo, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
}

const ondas = [objetivo(ondasAncho, ondasLargo, { tipo: TIPO_HDR }), objetivo(ondasAncho, ondasLargo, { tipo: TIPO_HDR })];
const MAX_GOTAS = 8;
const gotasPendientes = [];
const VERTICE_PANTALLA = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const materialOndas = new THREE.ShaderMaterial({
    uniforms: {
        tPrevio: { value: null },
        tMascara: { value: null },
        uPaso: { value: new THREE.Vector2(1 / ondasAncho, 1 / ondasLargo) },
        uTam: { value: new THREE.Vector2(ZONA.ancho, ZONA.largo) },
        uGotas: { value: Array.from({ length: MAX_GOTAS }, () => new THREE.Vector4()) }
    },
    vertexShader: VERTICE_PANTALLA,
    fragmentShader: `
        uniform sampler2D tPrevio;
        uniform sampler2D tMascara;
        uniform vec2 uPaso;
        uniform vec2 uTam;
        uniform vec4 uGotas[${MAX_GOTAS}];
        varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tPrevio, vUv);
            float s = texture2D(tPrevio, vUv + vec2(uPaso.x, 0.0)).r + texture2D(tPrevio, vUv - vec2(uPaso.x, 0.0)).r
                    + texture2D(tPrevio, vUv + vec2(0.0, uPaso.y)).r + texture2D(tPrevio, vUv - vec2(0.0, uPaso.y)).r;
            float n = (s * 0.5 - c.g) * 0.986;
            vec2 l = vUv * uTam;
            for (int i = 0; i < ${MAX_GOTAS}; i++) {
                vec4 g = uGotas[i];
                if (g.w == 0.0) continue;
                vec2 d = l - g.xy;
                n += g.w * exp(-dot(d, d) / (g.z * g.z));
            }
            n *= smoothstep(0.3, 0.8, texture2D(tMascara, vUv).r);
            gl_FragColor = vec4(n, c.r, 0.0, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const planoPantalla = new THREE.PlaneGeometry(2, 2);
const escenaOndas = new THREE.Scene();
const cuadroOndas = new THREE.Mesh(planoPantalla, materialOndas);
cuadroOndas.frustumCulled = false;
escenaOndas.add(cuadroOndas);

function soltarGota(x, z, radio, fuerza) {
    if (gotasPendientes.length >= 24) gotasPendientes.shift();
    gotasPendientes.push([x - ZONA.x, z - ZONA.z, radio, fuerza]);
}

let restoOndas = 0;

function simularOndas(delta) {
    if (!hayFlotantes) return;
    restoOndas += delta * 50;
    const pasos = Math.min(3, Math.floor(restoOndas));
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
}


// =====================================================================
// 10. EL AGUA
// Pasada final a pantalla completa: para cada píxel se corta el rayo de
// la cámara con el plano del agua. Si el agua queda delante de lo que
// ya se ha dibujado, se mezcla el fondo refractado y teñido de verde
// con el reflejo, las cáusticas y el brillo del sol.
// =====================================================================

function crearRuidoAgua() {
    const lado = 256;
    const campo = new Float32Array(lado * lado);
    const valor = (x, y, periodo, s) => {
        const fx = x * periodo;
        const fy = y * periodo;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        let ux = fx - ix;
        let uy = fy - iy;
        ux = ux * ux * (3 - 2 * ux);
        uy = uy * uy * (3 - 2 * uy);
        const h = (a, b) => {
            let k = Math.imul(((a % periodo) + periodo) % periodo, 374761393) ^ Math.imul(((b % periodo) + periodo) % periodo, 668265263) ^ Math.imul(s, 1442695041);
            k = Math.imul(k ^ (k >>> 13), 1274126177);
            return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
        };
        const a = h(ix, iy);
        const b = h(ix + 1, iy);
        const c = h(ix, iy + 1);
        const d = h(ix + 1, iy + 1);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
    for (let y = 0; y < lado; y++) {
        for (let x = 0; x < lado; x++) {
            let s = 0;
            let amp = 0.5;
            for (let o = 0; o < 4; o++) {
                s += valor(x / lado, y / lado, 8 << o, 3 + o) * amp;
                amp *= 0.5;
            }
            campo[y * lado + x] = s;
        }
    }
    const datos = new Uint8Array(lado * lado * 4);
    for (let y = 0; y < lado; y++) {
        for (let x = 0; x < lado; x++) {
            const i = y * lado + x;
            const dx = campo[y * lado + ((x + 1) % lado)] - campo[y * lado + ((x + lado - 1) % lado)];
            const dy = campo[((y + 1) % lado) * lado + x] - campo[((y + lado - 1) % lado) * lado + x];
            datos.set([Math.max(0, Math.min(255, 128 + dx * 2600)), Math.max(0, Math.min(255, 128 + dy * 2600)), campo[i] * 255, 255], i * 4);
        }
    }
    const t = new THREE.DataTexture(datos, lado, lado, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
}

const materialAgua = new THREE.ShaderMaterial({
    uniforms: {
        ...comunes,
        tColor: { value: null },
        tProfundidad: { value: null },
        tReflejo: { value: null },
        tOndas: { value: null },
        tRuido: { value: crearRuidoAgua() },
        uProyeccionInversa: { value: new THREE.Matrix4() },
        uCamaraMundo: { value: new THREE.Matrix4() },
        uReflejoVP: { value: new THREE.Matrix4() },
        uCamaraPos: { value: new THREE.Vector3() },
        uCamaraDir: { value: new THREE.Vector3() },
        uCerca: { value: 0.1 },
        uLejos: { value: 1400 },
        uZona: { value: new THREE.Vector4(ZONA.x, ZONA.z, ZONA.ancho, ZONA.largo) },
        uPasoOndas: { value: new THREE.Vector2(1 / ondasAncho, 1 / ondasLargo) },
        uAbsorcion: { value: new THREE.Vector3(0.55, 0.16, 0.2) },
        uColorAgua: { value: new THREE.Color(0.2, 0.46, 0.4) },
        uExposicion: { value: 1 },
        uFundido: { value: 0 },
        uSalida: { value: 1 }
    },
    vertexShader: VERTICE_PANTALLA,
    fragmentShader: `
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tProfundidad;
        uniform sampler2D tReflejo;
        uniform sampler2D tOndas;
        uniform sampler2D tRuido;
        uniform mat4 uProyeccionInversa;
        uniform mat4 uCamaraMundo;
        uniform mat4 uReflejoVP;
        uniform vec3 uCamaraPos;
        uniform vec3 uCamaraDir;
        uniform float uCerca;
        uniform float uLejos;
        uniform vec4 uZona;
        uniform vec2 uPasoOndas;
        uniform vec3 uAbsorcion;
        uniform vec3 uColorAgua;
        uniform vec3 uSol;
        uniform vec3 uColorSol;
        uniform vec3 uCieloLuz;
        uniform vec3 uNiebla;
        uniform float uDensidad;
        uniform float uTiempo;
        uniform float uNoche;
        uniform float uExposicion;
        uniform float uFundido;
        uniform float uSalida;
        varying vec2 vUv;

        vec3 rayo(vec2 uv) {
            vec4 p = uProyeccionInversa * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
            p /= p.w;
            return normalize((uCamaraMundo * vec4(p.xyz, 0.0)).xyz);
        }

        float distanciaVista(vec2 uv) {
            return -perspectiveDepthToViewZ(texture2D(tProfundidad, uv).x, uCerca, uLejos);
        }

        float causticas(vec2 p, float t) {
            vec2 q = mod(p * 6.2832, 6.2832) - 250.0;
            vec2 i = q;
            float c = 1.0;
            for (int n = 0; n < 4; n++) {
                float tt = t * (1.0 - (3.5 / float(n + 1)));
                i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
                c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / 0.005), q.y / (cos(i.y + tt) / 0.005)));
            }
            c /= 4.0;
            c = 1.17 - pow(c, 1.4);
            return pow(abs(c), 7.0);
        }

        vec3 aces(vec3 x) {
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
            vec3 color = texture2D(tColor, vUv).rgb / uSalida;
            vec3 dir = rayo(vUv);
            if (dir.y < -0.0005 && uCamaraPos.y > 0.0) {
                float t = -uCamaraPos.y / dir.y;
                vec3 P = uCamaraPos + dir * t;
                float profundidadAgua = t * dot(dir, uCamaraDir);
                float profundidadEscena = distanciaVista(vUv);
                if (profundidadAgua < profundidadEscena) {
                    float lejania = 1.0 / (1.0 + t * 0.06);
                    vec2 uvO = (P.xz - uZona.xy) / uZona.zw;
                    vec2 grad = vec2(0.0);
                    if (uvO.x > 0.0 && uvO.x < 1.0 && uvO.y > 0.0 && uvO.y < 1.0) {
                        float oI = texture2D(tOndas, uvO - vec2(uPasoOndas.x, 0.0)).r;
                        float oD = texture2D(tOndas, uvO + vec2(uPasoOndas.x, 0.0)).r;
                        float oA = texture2D(tOndas, uvO - vec2(0.0, uPasoOndas.y)).r;
                        float oB = texture2D(tOndas, uvO + vec2(0.0, uPasoOndas.y)).r;
                        grad = vec2(oD - oI, oB - oA) * 1.4;
                    }
                    vec2 deriva = vec2(uTiempo * 0.015, uTiempo * 0.01);
                    grad += (texture2D(tRuido, P.xz * 0.22 + deriva).rg - 0.5) * 0.12 * lejania;
                    grad += (texture2D(tRuido, P.xz * 0.9 - deriva * 2.0).rg - 0.5) * 0.06 * lejania;
                    vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

                    vec2 desvio = n.xz * vec2(1.0, -1.0) * 0.06 * lejania;
                    vec2 uvR = clamp(vUv + desvio, 0.001, 0.999);
                    float profR = distanciaVista(uvR);
                    if (profR < profundidadAgua) {
                        uvR = vUv;
                        profR = profundidadEscena;
                    }
                    vec3 fondo = texture2D(tColor, uvR).rgb / uSalida;
                    vec3 rayoR = rayo(uvR);
                    vec3 Q = uCamaraPos + rayoR * (profR / dot(rayoR, uCamaraDir));
                    float hondo = max(0.0, -Q.y);
                    float camino = max(0.0, profR - profundidadAgua) * 0.55 + hondo * 0.6;
                    float cau = causticas(Q.xz * 0.45 + n.xz * 0.2, uTiempo * 0.5) * exp(-hondo * 0.5) * smoothstep(0.0, 0.3, hondo);
                    fondo += fondo * uColorSol * cau * 0.45 * (1.0 - uNoche);
                    vec3 T = exp(-uAbsorcion * camino);
                    vec3 luzAgua = uCieloLuz * 0.55 + uColorSol * 0.35 * max(uSol.y, 0.0);
                    vec3 bajo = fondo * T + uColorAgua * luzAgua * (1.0 - T);

                    vec4 pr = uReflejoVP * vec4(P, 1.0);
                    vec2 uvRef = pr.xy / pr.w * 0.5 + 0.5 + n.xz * vec2(1.0, -1.0) * 0.05 * lejania;
                    vec3 reflejo = texture2D(tReflejo, clamp(uvRef, 0.001, 0.999)).rgb / uSalida;
                    float coseno = max(dot(n, -dir), 0.0);
                    float fresnel = 0.02 + 0.98 * pow(1.0 - coseno, 5.0);
                    vec3 agua = mix(bajo, reflejo, fresnel);
                    vec3 medio = normalize(uSol - dir);
                    agua += uColorSol * (pow(max(dot(n, medio), 0.0), 900.0) * 6.0 + pow(max(dot(n, medio), 0.0), 120.0) * 0.15);

                    float orilla = smoothstep(0.0, 0.07, max(0.0, profundidadEscena - profundidadAgua));
                    float niebla = 1.0 - exp(-pow(uDensidad * t, 2.0));
                    agua = mix(agua, uNiebla, niebla);
                    color = mix(color, agua, orilla);
                }
            }
            color = aces(color * uExposicion);
            color = pow(color, vec3(1.0 / 2.2));
            vec2 d = vUv - 0.5;
            color *= 1.0 - dot(d, d) * 0.35;
            gl_FragColor = vec4(color * uFundido, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaFinal = new THREE.Scene();
const cuadroFinal = new THREE.Mesh(planoPantalla, materialAgua);
cuadroFinal.frustumCulled = false;
escenaFinal.add(cuadroFinal);


// =====================================================================
// 11. HOJAS QUE CAEN Y LUCIÉRNAGAS
// =====================================================================

const hojasCayendo = [];
let mallaHojas = null;

function texturaHoja() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 64;
    const g = lienzo.getContext("2d");
    g.translate(32, 32);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(0, 0, 28, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-28, 0);
    g.lineTo(28, 0);
    g.stroke();
    const t = new THREE.CanvasTexture(lienzo);
    return t;
}

function crearHojasCayendo() {
    const n = movil ? 10 : 16;
    const material = new THREE.MeshStandardMaterial({ map: texturaHoja(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    mallaHojas = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.05), material, n);
    mallaHojas.frustumCulled = false;
    const tonos = [0xb7c24a, 0xd9b84a, 0x8fae3c, 0xc98f3a];
    for (let i = 0; i < n; i++) {
        mallaHojas.setColorAt(i, new THREE.Color(tonos[i % tonos.length]));
        const hoja = { p: new THREE.Vector3(), estado: "espera", espera: azar() * 10, fase: azar() * 10, giro: new THREE.Euler(), vida: 0 };
        hojasCayendo.push(hoja);
    }
    escena.add(mallaHojas);
}

const auxMatriz = new THREE.Matrix4();
const auxCuaternio = new THREE.Quaternion();
const auxEscala = new THREE.Vector3(1, 1, 1);

function moverHojasCayendo(delta) {
    if (!mallaHojas) return;
    hojasCayendo.forEach((h, i) => {
        if (h.estado === "espera") {
            h.espera -= delta;
            auxEscala.setScalar(0.0001);
            if (h.espera <= 0) {
                const k = Math.floor(azar() * (matas.centros.length / 3));
                h.p.set(matas.centros[k * 3], matas.centros[k * 3 + 1], matas.centros[k * 3 + 2]);
                if (h.p.z > 3.2 || h.p.y < 2) {
                    h.p.set(-0.5 + azar() * 2.2, 4 + azar(), 0.5 - azar() * 1.5);
                }
                h.estado = "cae";
            }
        } else if (h.estado === "cae") {
            h.fase += delta;
            h.p.x += Math.sin(h.fase * 2.2) * 0.5 * delta + 0.08 * delta;
            h.p.z += Math.cos(h.fase * 1.7) * 0.3 * delta - 0.1 * delta;
            h.p.y -= delta * 0.55;
            h.giro.set(h.fase * 2.5, h.fase * 1.3, Math.sin(h.fase * 3.0) * 1.2);
            auxEscala.setScalar(1);
            const suelo = altura(h.p.x, h.p.z);
            if (h.p.y <= Math.max(0, suelo) + 0.01) {
                h.p.y = Math.max(0, suelo) + 0.005;
                h.giro.set(-Math.PI / 2, 0, azar() * 6);
                if (suelo < 0) {
                    h.estado = "flota";
                    soltarGota(h.p.x, h.p.z, 0.08, 0.35);
                } else h.estado = "suelo";
                h.vida = 18 + azar() * 10;
            }
        } else {
            h.vida -= delta;
            auxEscala.setScalar(Math.min(1, h.vida / 2));
            if (h.estado === "flota") {
                h.p.x -= delta * 0.04;
                h.p.z -= delta * 0.02;
                h.giro.z += delta * 0.05;
                h.p.y = 0.004;
            }
            if (h.vida <= 0) {
                h.estado = "espera";
                h.espera = 2 + azar() * 7;
            }
        }
        auxCuaternio.setFromEuler(h.giro);
        auxMatriz.compose(h.p, auxCuaternio, auxEscala);
        mallaHojas.setMatrixAt(i, auxMatriz);
    });
    mallaHojas.instanceMatrix.needsUpdate = true;
}

const libelula = { grupo: null, alas: [], desde: new THREE.Vector3(), hacia: new THREE.Vector3(), t: 1, espera: 0, rumbo: 0 };

function crearLibelula() {
    const grupo = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.07, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f6fb8, metalness: 0.4, roughness: 0.35, emissive: 0x0a2244 }));
    const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshStandardMaterial({ color: 0x24508a, metalness: 0.3, roughness: 0.4 }));
    cabeza.position.z = 0.04;
    grupo.add(cuerpo, cabeza);
    const materialAla = new THREE.MeshStandardMaterial({ color: 0xdfeeff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.2, depthWrite: false });
    const ala = new THREE.PlaneGeometry(0.055, 0.012).translate(0.0275, 0, 0).rotateX(-Math.PI / 2);
    [[1, 0.012], [-1, 0.012], [1, -0.004], [-1, -0.004]].forEach(([lado, z]) => {
        const a = new THREE.Mesh(ala, materialAla);
        a.scale.x = lado;
        a.position.z = z;
        grupo.add(a);
        libelula.alas.push(a);
    });
    grupo.position.set(0.5, 0.35, -2);
    libelula.desde.copy(grupo.position);
    libelula.hacia.copy(grupo.position);
    libelula.grupo = grupo;
    escena.add(grupo);
}

function moverLibelula(delta, tiempo) {
    const l = libelula;
    if (!l.grupo) return;
    l.grupo.visible = comunes.uNoche.value < 0.5;
    if (l.t >= 1) {
        l.espera -= delta;
        if (l.espera <= 0) {
            l.desde.copy(l.grupo.position);
            for (let i = 0; i < 10; i++) {
                l.hacia.set(-3 + Math.random() * 7, 0.15 + Math.random() * 0.6, 0.5 - Math.random() * 9);
                if (altura(l.hacia.x, l.hacia.z) < -0.1 && l.hacia.distanceTo(l.desde) > 0.8) break;
            }
            l.t = 0;
            l.espera = 0.6 + Math.random() * 2.5;
        }
    } else {
        l.t = Math.min(1, l.t + delta * 0.9);
    }
    const k = l.t * l.t * (3 - 2 * l.t);
    l.grupo.position.lerpVectors(l.desde, l.hacia, k);
    l.grupo.position.y += Math.sin(tiempo * 9) * 0.006;
    const objetivoRumbo = Math.atan2(l.hacia.x - l.desde.x, l.hacia.z - l.desde.z);
    l.rumbo += Math.atan2(Math.sin(objetivoRumbo - l.rumbo), Math.cos(objetivoRumbo - l.rumbo)) * Math.min(1, delta * 6);
    l.grupo.rotation.y = l.rumbo;
    l.alas.forEach((a, i) => (a.rotation.z = Math.sin(tiempo * 60 + i * 1.3) * 0.45 * (i % 2 ? -1 : 1)));
}

let luciernagas = null;
const datosLuciernagas = [];

function crearLuciernagas() {
    const n = ajustes.luciernagas;
    const posiciones = new Float32Array(n * 3);
    const fases = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = -6 + azar() * 14;
        const z = 2.5 - azar() * 20;
        datosLuciernagas.push({ cx: x, cy: Math.max(0, altura(x, z)) + 0.4 + azar() * 1.6, cz: z, fase: azar() * 100, vel: 0.3 + azar() * 0.5 });
        fases[i] = azar() * 100;
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("aFase", new THREE.BufferAttribute(fases, 1));
    luciernagas = new THREE.Points(geometria, new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uNoche: comunes.uNoche, uTam: { value: 60 } },
        vertexShader: `
            attribute float aFase;
            uniform float uTiempo;
            uniform float uTam;
            varying float vBrillo;
            void main() {
                float ciclo = fract(uTiempo * 0.23 + aFase);
                vBrillo = smoothstep(0.0, 0.08, ciclo) * smoothstep(0.42, 0.18, ciclo);
                vec4 vista = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = uTam * (0.6 + 0.4 * vBrillo) / -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            uniform float uNoche;
            varying float vBrillo;
            void main() {
                vec2 d = gl_PointCoord - 0.5;
                float r = dot(d, d);
                float luz = exp(-r * 28.0) * 0.6 + exp(-r * 250.0) * 3.0;
                gl_FragColor = vec4(vec3(0.8, 1.0, 0.35) * luz * vBrillo * uNoche, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }));
    luciernagas.frustumCulled = false;
    escena.add(luciernagas);
}

function moverLuciernagas(delta) {
    if (!luciernagas) return;
    luciernagas.visible = comunes.uNoche.value > 0.01;
    if (!luciernagas.visible) return;
    const p = luciernagas.geometry.attributes.position.array;
    datosLuciernagas.forEach((l, i) => {
        l.fase += delta * l.vel;
        p[i * 3] = l.cx + Math.sin(l.fase * 0.9) * 0.7 + Math.sin(l.fase * 2.3) * 0.12;
        p[i * 3 + 1] = l.cy + Math.sin(l.fase * 1.3) * 0.25;
        p[i * 3 + 2] = l.cz + Math.cos(l.fase * 0.7) * 0.6;
    });
    luciernagas.geometry.attributes.position.needsUpdate = true;
    luciernagas.material.uniforms.uTam.value = 60 * renderizador.getPixelRatio();
}


// =====================================================================
// 12. MOMENTOS DEL DÍA
// =====================================================================

const MOMENTOS = {
    dia: {
        sol: [0.42, 0.88, -0.12], colorSol: [1.0, 0.95, 0.86], intensidad: 3.2,
        cieloLuz: [0.7, 0.8, 0.95], sueloLuz: [0.48, 0.42, 0.32], hemisferio: 1.35,
        niebla: [0.66, 0.76, 0.84], densidad: 0.0042, arriba: [0.24, 0.48, 0.84], horizonte: [0.74, 0.84, 0.92],
        agua: [0.24, 0.54, 0.45], noche: 0, exposicion: 1.12
    },
    atardecer: {
        sol: [0.82, 0.17, -0.55], colorSol: [1.0, 0.6, 0.34], intensidad: 2.8,
        cieloLuz: [0.5, 0.45, 0.55], sueloLuz: [0.3, 0.2, 0.15], hemisferio: 0.85,
        niebla: [0.86, 0.66, 0.54], densidad: 0.005, arriba: [0.24, 0.3, 0.55], horizonte: [1.0, 0.66, 0.44],
        agua: [0.2, 0.36, 0.32], noche: 0, exposicion: 1.05
    },
    noche: {
        sol: [-0.35, 0.55, -0.75], colorSol: [0.5, 0.6, 0.95], intensidad: 0.35,
        cieloLuz: [0.1, 0.13, 0.25], sueloLuz: [0.03, 0.03, 0.05], hemisferio: 0.6,
        niebla: [0.035, 0.045, 0.08], densidad: 0.006, arriba: [0.008, 0.012, 0.035], horizonte: [0.04, 0.06, 0.11],
        agua: [0.03, 0.08, 0.09], noche: 1, exposicion: 1.5
    }
};

let momento = parametros.get("momento") in MOMENTOS ? parametros.get("momento") : "dia";
const auxVector = new THREE.Vector3();
const auxColor = new THREE.Color();
let sombraPendiente = 2;

function aplicarMomento(delta) {
    const m = MOMENTOS[momento];
    const k = delta < 0 ? 1 : 1 - Math.exp(-delta * 1.6);
    const antes = comunes.uSol.value.clone();
    comunes.uSol.value.lerp(auxVector.fromArray(m.sol).normalize(), k).normalize();
    if (antes.distanceToSquared(comunes.uSol.value) > 1e-7) sombraPendiente = 2;
    const mezclarColor = (destino, valor, escala = 1) => destino.lerp(auxColor.setRGB(valor[0] * escala, valor[1] * escala, valor[2] * escala), k);
    mezclarColor(comunes.uColorSol.value, m.colorSol, m.intensidad / 3.2);
    mezclarColor(comunes.uCieloLuz.value, m.cieloLuz);
    mezclarColor(comunes.uSueloLuz.value, m.sueloLuz);
    mezclarColor(escena.fog.color, m.niebla);
    mezclarColor(materialCielo.uniforms.uArriba.value, m.arriba);
    mezclarColor(materialCielo.uniforms.uHorizonte.value, m.horizonte);
    mezclarColor(materialAgua.uniforms.uColorAgua.value, m.agua);
    escena.fog.density += (m.densidad - escena.fog.density) * k;
    comunes.uDensidad.value = escena.fog.density;
    comunes.uNoche.value += (m.noche - comunes.uNoche.value) * k;
    materialAgua.uniforms.uExposicion.value += (m.exposicion - materialAgua.uniforms.uExposicion.value) * k;
    sol.intensity += (m.intensidad - sol.intensity) * k;
    sol.color.copy(comunes.uColorSol.value).multiplyScalar(3.2 / Math.max(0.05, m.intensidad));
    cielo.color.copy(comunes.uCieloLuz.value);
    cielo.groundColor.copy(comunes.uSueloLuz.value);
    cielo.intensity += (m.hemisferio - cielo.intensity) * k;
    sol.position.copy(comunes.uSol.value).multiplyScalar(30).add(sol.target.position);
}

function cambiarMomento(nuevo) {
    momento = nuevo;
    document.querySelectorAll("[data-momento]").forEach((boton) => {
        const activo = boton.dataset.momento === nuevo;
        boton.classList.toggle("activo", activo);
        boton.setAttribute("aria-pressed", activo);
    });
}

document.querySelectorAll("[data-momento]").forEach((boton) => {
    boton.addEventListener("click", () => cambiarMomento(boton.dataset.momento));
});


// =====================================================================
// 13. MIRAR ALREDEDOR Y TOCAR EL AGUA
// La cámara se mueve un poco con el ratón o al inclinar el móvil, como
// si giraras la cabeza. Tocar la poza suelta una gota.
// =====================================================================

const mirada = { x: 0, y: 0, objetivoX: 0, objetivoY: 0 };
const planoAgua = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rayo = new THREE.Raycaster();
const auxRaton = new THREE.Vector2();
const auxCorte = new THREE.Vector3();
const pista = document.getElementById("pista");
let ultimoToque = null;

function tocarAgua(evento, fuerza, radio) {
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(auxRaton, camara);
    if (!rayo.ray.intersectPlane(planoAgua, auxCorte)) return false;
    if (altura(auxCorte.x, auxCorte.z) > -0.03) return false;
    soltarGota(auxCorte.x, auxCorte.z, radio, fuerza);
    return true;
}

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    pedirOrientacion();
    ultimoToque = { x: evento.clientX, y: evento.clientY, pulsado: true };
    if (tocarAgua(evento, 0.8, 0.2)) sonarGota(0.6);
    pista.classList.add("oculta");
});

renderizador.domElement.addEventListener("pointermove", (evento) => {
    if (evento.pointerType !== "touch") {
        mirada.objetivoX = (evento.clientX / innerWidth) * 2 - 1;
        mirada.objetivoY = (evento.clientY / innerHeight) * 2 - 1;
    }
    if (!ultimoToque) {
        ultimoToque = { x: evento.clientX, y: evento.clientY, pulsado: false };
        return;
    }
    if (evento.pointerType === "touch" && !ultimoToque.pulsado) return;
    if (Math.hypot(evento.clientX - ultimoToque.x, evento.clientY - ultimoToque.y) < 12) return;
    ultimoToque.x = evento.clientX;
    ultimoToque.y = evento.clientY;
    tocarAgua(evento, ultimoToque.pulsado ? 0.3 : 0.12, 0.13);
});

["pointerup", "pointercancel"].forEach((tipo) => {
    renderizador.domElement.addEventListener(tipo, () => {
        if (ultimoToque) ultimoToque.pulsado = false;
    });
});

let orientacionPedida = false;

function pedirOrientacion() {
    if (orientacionPedida) return;
    orientacionPedida = true;
    let referencia = null;
    const escuchar = () => window.addEventListener("deviceorientation", (e) => {
        if (e.gamma == null || e.beta == null) return;
        if (!referencia) referencia = { beta: e.beta, gamma: e.gamma };
        mirada.objetivoX = Math.max(-1, Math.min(1, (e.gamma - referencia.gamma) / 20));
        mirada.objetivoY = Math.max(-1, Math.min(1, (e.beta - referencia.beta) / 20));
    });
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().then((r) => r === "granted" && escuchar()).catch(() => {});
    } else escuchar();
}

if (movil && !(typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function")) pedirOrientacion();

let siguienteGota = 3;

function vidaDelAgua(delta) {
    siguienteGota -= delta;
    if (siguienteGota > 0) return;
    siguienteGota = 1.5 + Math.random() * 4;
    for (let i = 0; i < 10; i++) {
        const x = ZONA.x + Math.random() * ZONA.ancho;
        const z = ZONA.z + Math.random() * ZONA.largo;
        if (altura(x, z) < -0.2) {
            soltarGota(x, z, 0.1, 0.2 + Math.random() * 0.2);
            return;
        }
    }
}


// =====================================================================
// 14. SONIDO
// Agua tranquila, pájaros de día y grillos de noche.
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
    pasaBajos.frequency.value = 700;
    const volumenRio = ctx.createGain();
    volumenRio.gain.value = 0.32;
    rio.connect(pasaBajos).connect(volumenRio).connect(general);
    const gorgoteo = ctx.createBufferSource();
    gorgoteo.buffer = buffer;
    gorgoteo.loop = true;
    const banda = ctx.createBiquadFilter();
    banda.type = "bandpass";
    banda.Q.value = 9;
    const volumenGorgoteo = ctx.createGain();
    volumenGorgoteo.gain.value = 0;
    gorgoteo.connect(banda).connect(volumenGorgoteo).connect(general);
    rio.start();
    gorgoteo.start();
    return { ctx, general, banda, volumenGorgoteo, siguientePajaro: 2, siguienteGrillo: 0 };
}

botonSonido.addEventListener("click", () => {
    if (!audio) audio = crearAudio();
    audio.ctx.resume();
    sonidoActivo = !sonidoActivo;
    botonSonido.classList.toggle("activo", sonidoActivo);
    botonSonido.setAttribute("aria-pressed", sonidoActivo);
    audio.general.gain.setTargetAtTime(sonidoActivo ? 0.5 : 0, audio.ctx.currentTime, 0.4);
});

function pitido(frecuencia, final, duracion, volumen, retraso = 0) {
    const ctx = audio.ctx;
    const t = ctx.currentTime + retraso;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
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
    if (Math.random() < delta * 4) {
        audio.banda.frequency.setTargetAtTime(400 + Math.random() * 1200, t, 0.06);
        audio.volumenGorgoteo.gain.setTargetAtTime(Math.random() * 0.3, t, 0.1);
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
            audio.siguientePajaro = (momento === "dia" ? 3 : 6) + Math.random() * 6;
            const notas = 2 + Math.floor(Math.random() * 4);
            const base = 2200 + Math.random() * 1500;
            for (let i = 0; i < notas; i++) pitido(base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.8), 0.09 + Math.random() * 0.06, 0.04, i * 0.13);
        }
    }
}


// =====================================================================
// 15. LAS TARJETAS
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

if (parametros.get("tarjetas") === "no") mostrarTarjetas(false);


// =====================================================================
// 16. TAMAÑO Y CALIDAD
// =====================================================================

let escalaResolucion = 1;
let objetivoOpaco = null;
let objetivoReflejo = null;

function ajustarTamano() {
    const aspecto = innerWidth / innerHeight;
    camara.aspect = aspecto;
    camara.fov = aspecto < 1 ? 66 : 52;
    camara.updateProjectionMatrix();
    camaraReflejo.aspect = aspecto;
    camaraReflejo.fov = camara.fov + 8;
    camaraReflejo.updateProjectionMatrix();
    const proporcion = Math.min(devicePixelRatio || 1, ajustes.resolucionMax) * escalaResolucion;
    renderizador.setPixelRatio(proporcion);
    renderizador.setSize(innerWidth, innerHeight, false);
    const ancho = Math.round(innerWidth * proporcion);
    const alto = Math.round(innerHeight * proporcion);
    [objetivoOpaco, objetivoReflejo].forEach((o) => {
        if (!o) return;
        if (o.depthTexture) o.depthTexture.dispose();
        o.dispose();
    });
    objetivoOpaco = objetivo(ancho, alto, { tipo: TIPO_HDR, profundidad: true, texturaProfundidad: true });
    objetivoReflejo = objetivo(Math.round(ancho * ajustes.reflejo), Math.round(alto * ajustes.reflejo), { tipo: TIPO_HDR, profundidad: true });
    materialAgua.uniforms.tColor.value = objetivoOpaco.texture;
    materialAgua.uniforms.tProfundidad.value = objetivoOpaco.depthTexture;
    materialAgua.uniforms.tReflejo.value = objetivoReflejo.texture;
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
    if (fps < 40 && escalaResolucion > 0.55) {
        escalaResolucion = Math.max(0.55, escalaResolucion - 0.15);
        ajustarTamano();
    } else if (fps > 58 && escalaResolucion < 1) {
        escalaResolucion = Math.min(1, escalaResolucion + 0.1);
        ajustarTamano();
    }
}


// =====================================================================
// 17. ARRANQUE Y BUCLE
// =====================================================================

const reloj = new THREE.Clock();
const cargando = document.getElementById("cargando");
const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02);
const camaraPantalla = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const auxMira = new THREE.Vector3();
let listo = false;

function construir() {
    crearTerreno();
    crearRocas();
    crearPenon();
    crearBanco();
    repartirArboles();
    arbolDelante();
    crearCopas();
    crearJuncos();
    crearHojasCayendo();
    crearLuciernagas();
    crearLibelula();
    const mascara = crearMascaraAgua();
    materialOndas.uniforms.tMascara.value = mascara;
    ondas.forEach((o) => {
        renderizador.setRenderTarget(o);
        renderizador.clear();
    });
    renderizador.setRenderTarget(null);
    ajustarTamano();
    aplicarMomento(-1);
    cambiarMomento(momento);
    renderizador.compile(escena, camara);
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
}

function colocarCamara(delta) {
    mirada.x += (mirada.objetivoX - mirada.x) * Math.min(1, delta * 2.5);
    mirada.y += (mirada.objetivoY - mirada.y) * Math.min(1, delta * 2.5);
    const t = comunes.uTiempo.value;
    const aspecto = innerWidth / innerHeight;
    camara.position.copy(POSICION_BASE);
    camara.position.x += mirada.x * 0.45 + Math.sin(t * 0.21) * 0.04;
    camara.position.y += -mirada.y * 0.18 + Math.sin(t * 0.33) * 0.02;
    objetivoVista.set(0.6 + mirada.x * 1.5, aspecto < 1 ? -0.6 : 0.9, -12);
    objetivoVista.y -= mirada.y * 0.8;
    camara.lookAt(objetivoVista);
    camara.updateMatrixWorld();
    camaraReflejo.position.set(camara.position.x, -camara.position.y, camara.position.z);
    camaraReflejo.lookAt(auxMira.set(objetivoVista.x, -objetivoVista.y, objetivoVista.z));
    camaraReflejo.updateMatrixWorld();
}

let fotograma = 0;

function dibujar() {
    fotograma++;
    if (!movil || fotograma % 2 === 0 || fotograma < 3) {
        renderizador.setRenderTarget(objetivoReflejo);
        renderizador.clippingPlanes = [plano];
        comunes.uRecorte.value = 1;
        if (luciernagas) luciernagas.visible = false;
        if (mallaHojas) mallaHojas.visible = false;
        renderizador.render(escena, camaraReflejo);
        renderizador.clippingPlanes = [];
        comunes.uRecorte.value = 0;
        if (mallaHojas) mallaHojas.visible = true;
    }
    if (luciernagas) luciernagas.visible = comunes.uNoche.value > 0.01;
    if (sombraPendiente > 0) {
        renderizador.shadowMap.needsUpdate = true;
        sombraPendiente--;
    }
    renderizador.setRenderTarget(objetivoOpaco);
    renderizador.render(escena, camara);
    const u = materialAgua.uniforms;
    u.uProyeccionInversa.value.copy(camara.projectionMatrixInverse);
    u.uCamaraMundo.value.copy(camara.matrixWorld);
    u.uReflejoVP.value.multiplyMatrices(camaraReflejo.projectionMatrix, camaraReflejo.matrixWorldInverse);
    u.uCamaraPos.value.copy(camara.position);
    camara.getWorldDirection(u.uCamaraDir.value);
    u.tOndas.value = ondas[0].texture;
    renderizador.setRenderTarget(null);
    renderizador.render(escenaFinal, camaraPantalla);
}

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    comunes.uTiempo.value += delta;
    aplicarMomento(delta);
    materialAgua.uniforms.uFundido.value = Math.min(1, materialAgua.uniforms.uFundido.value + delta * 0.8);
    colocarCamara(delta);
    vidaDelAgua(delta);
    moverHojasCayendo(delta);
    moverLuciernagas(delta);
    moverLibelula(delta, comunes.uTiempo.value);
    moverSonido(delta);
    simularOndas(delta);
    dibujar();
    vigilarRitmo(delta);
}

requestAnimationFrame(() => {
    construir();
    reloj.getDelta();
    animar();
});
