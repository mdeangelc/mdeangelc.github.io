import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
// 1. AJUSTES
// Un trozo del Genal en miniatura sobre el suelo del estudio: una isla
// de tierra redondeada con una poza en medio, una cascada que sale de
// las rocas del fondo, un castaño en otoño, truchas, hojas flotando y
// luciérnagas de noche. Todo se mide en metros de maqueta y el agua
// está a la altura NIVEL.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.75,
    sombra: movil ? 1024 : 2048,
    anillos: movil ? 90 : 130,
    gajos: movil ? 240 : 360,
    matas: movil ? 700 : 1400,
    juncos: movil ? 22 : 38,
    flores: movil ? 40 : 80,
    hojas: movil ? 12 : 20,
    peces: 5,
    luciernagas: movil ? 34 : 56,
    ondas: movil ? 192 : 256,
    desenfoque: !movil
};
const NIVEL = 1.0;
const POZA = new THREE.Vector2(0.2, 0.45);
const TAM_ONDAS = 6.6;


// =====================================================================
// 2. RUIDO
// Ruido suave hecho a mano para dar forma a la isla, a las piedras y a
// las copas, y una textura de ruido que se repite para los shaders.
// =====================================================================

function hash(x, y, s) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

function ruido(x, y, s = 0) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi, s);
    const b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s);
    const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, s = 0, octavas = 4) {
    let total = 0;
    let amp = 0.5;
    let frec = 1;
    let suma = 0;
    for (let o = 0; o < octavas; o++) {
        total += amp * ruido(x * frec, y * frec, s + o * 17);
        suma += amp;
        amp *= 0.5;
        frec *= 2.03;
    }
    return total / suma;
}

function ruido3(x, y, z, s = 0) {
    return (ruido(x, y, s) + ruido(y + 3.1, z, s + 5) + ruido(z + 7.3, x, s + 9)) / 3;
}

const suave = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

function texturaRuido() {
    const n = 256;
    const celdas = 16;
    const capas = [0, 1, 2, 3].map(() => Array.from({ length: celdas * celdas }, () => Math.random()));
    const valor = (rejilla, x, y, c) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const fx = x - xi;
        const fy = y - yi;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v = (a, b) => rejilla[(((b % c) + c) % c) * celdas + (((a % c) + c) % c)];
        return v(xi, yi) * (1 - sx) * (1 - sy) + v(xi + 1, yi) * sx * (1 - sy) + v(xi, yi + 1) * (1 - sx) * sy + v(xi + 1, yi + 1) * sx * sy;
    };
    const datos = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            for (let k = 0; k < 4; k++) {
                let s = 0;
                let a = 0.5;
                for (let o = 0; o < 4; o++) {
                    const c = 4 << o;
                    s += a * valor(capas[k], (x / n) * c, (y / n) * c, c);
                    a *= 0.5;
                }
                datos[(y * n + x) * 4 + k] = Math.floor(Math.min(1, s / 0.94) * 255);
            }
        }
    }
    const t = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
}


// =====================================================================
// 3. LA FORMA DE LA ISLA
// Una meseta con el borde redondeado como una pieza de barro, una loma
// al fondo con la repisa de donde sale la cascada y la poza en medio.
// =====================================================================

function radioIsla(ang) {
    return 5.15 + (fbm(Math.cos(ang) * 1.2 + 10, Math.sin(ang) * 1.2 + 10, 3, 3) - 0.5) * 1.2;
}

function elipsePoza(x, z) {
    const dx = x - POZA.x;
    const dz = z - POZA.y;
    const c = Math.cos(0.35);
    const s = Math.sin(0.35);
    const u = (dx * c - dz * s) / 2.75;
    const v = (dx * s + dz * c) / 2.05;
    const borde = (fbm(x * 0.6 + 4, z * 0.6 + 9, 5, 3) - 0.5) * 0.35;
    return Math.hypot(u, v) * (1 + borde);
}

function repisaEn(x, z) {
    return Math.exp(-((x + 1.5) ** 2) / 1.6 - ((z + 2.85) ** 2) / 0.8);
}

function alturaTierra(x, z) {
    let h = 1.24 + (fbm(x * 0.32, z * 0.32, 1) - 0.5) * 0.35;
    h += suave(-0.6, -4.2, z) * 0.5;
    h += repisaEn(x, z) * 1.05;
    return h;
}

function perfilBorde(d) {
    if (d <= 0.8) return 1;
    const t = Math.min(1, (d - 0.8) / 0.2);
    return Math.sqrt(Math.max(0, 1 - t * t));
}

function alturaBase(x, z) {
    const e = elipsePoza(x, z);
    const tierra = alturaTierra(x, z);
    const fondo = NIVEL - 0.08 - 0.42 * suave(1.0, 0.15, e) + (fbm(x * 1.1, z * 1.1, 7) - 0.5) * 0.08;
    return fondo + (tierra - fondo) * suave(0.92, 1.4, e);
}

function alturaEn(x, z) {
    return alturaBase(x, z) * perfilBorde(Math.hypot(x, z) / radioIsla(Math.atan2(z, x)));
}

function profundidadEn(x, z) {
    if (elipsePoza(x, z) > 1.5) return 0;
    return Math.max(0, NIVEL - alturaEn(x, z));
}


// =====================================================================
// 4. RENDERIZADOR, ESCENA, LUCES Y CÁMARA
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
renderizador.shadowMap.autoUpdate = false;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
escena.background = new THREE.Color();
escena.environment = new THREE.PMREMGenerator(renderizador).fromScene(new RoomEnvironment(renderizador), 0.04).texture;

const camara = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 200);
const controles = new OrbitControls(camara, renderizador.domElement);
controles.target.set(0.4, 1.25, -0.2);
controles.enableDamping = true;
controles.dampingFactor = 0.05;
controles.enablePan = false;
controles.minDistance = 10;
controles.maxDistance = 30;
controles.minPolarAngle = 0.45;
controles.maxPolarAngle = 1.12;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.25;

const sol = new THREE.DirectionalLight(0xffffff, 2.5);
sol.position.set(-6, 12, 5);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
sol.shadow.radius = 6;
sol.shadow.bias = -0.0006;
sol.shadow.normalBias = 0.03;
Object.assign(sol.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
escena.add(sol);
const cielo = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
escena.add(cielo);

const tRuido = texturaRuido();
const comunes = {
    uTiempo: { value: 0 },
    uViento: { value: 1 },
    uCausticas: { value: new THREE.Color() },
    uLuzPez: { value: 1 }
};
const materialesConEntorno = [];

function entorno(material, fuerza) {
    material.userData.entorno = fuerza;
    materialesConEntorno.push(material);
    return material;
}


// =====================================================================
// 5. EL SUELO DEL ESTUDIO
// El fondo es un color liso y el suelo solo pinta las sombras, así no
// se ve ninguna línea de horizonte. Debajo de la isla hay una mancha
// oscura suave para que parezca que está apoyada.
// =====================================================================

const suelo = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: 0x1d1a22, opacity: 0.25, depthWrite: false }));
suelo.receiveShadow = true;
escena.add(suelo);

const contacto = (() => {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 256;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    d.addColorStop(0, "rgba(0, 0, 0, 1)");
    d.addColorStop(0.5, "rgba(0, 0, 0, 0.35)");
    d.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 256, 256);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lienzo), color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    m.position.y = 0.005;
    escena.add(m);
    return m;
})();


// =====================================================================
// 6. AGUA EN LOS MATERIALES
// Lo que queda por debajo del agua (el lecho, las piedras de la poza)
// se oscurece un poco, recibe cáusticas que se mueven y, justo encima
// del agua, una franja mojada.
// =====================================================================

const GLSL_CAUSTICAS = `
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
`;

function mojar(material, clave) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTiempo = comunes.uTiempo;
        shader.uniforms.uCausticas = comunes.uCausticas;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vMundoA;")
            .replace(
                "#include <worldpos_vertex>",
                `#include <worldpos_vertex>
                vec4 mundoA = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                mundoA = instanceMatrix * mundoA;
                #endif
                vMundoA = (modelMatrix * mundoA).xyz;`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", `#include <common>\nvarying vec3 vMundoA;\nuniform float uTiempo;\nuniform vec3 uCausticas;\n${GLSL_CAUSTICAS}`)
            .replace(
                "#include <opaque_fragment>",
                `float hondo = ${NIVEL.toFixed(2)} - vMundoA.y;
                float bajo = smoothstep(-0.01, 0.04, hondo);
                float franja = smoothstep(-0.1, 0.0, hondo) * (1.0 - bajo);
                outgoingLight *= 1.0 - bajo * 0.18 - franja * 0.28;
                float cau = causticas(vMundoA.xz * 0.8, uTiempo * 0.55) * bajo * smoothstep(0.0, 0.1, hondo);
                outgoingLight += diffuseColor.rgb * uCausticas * cau;
                #include <opaque_fragment>`
            );
    };
    material.customProgramCacheKey = () => "mojado" + clave;
    return material;
}


// =====================================================================
// 7. LA ISLA
// Una malla en círculos para que el borde salga redondo y limpio. El
// color va por vértice: hierba arriba, arena en la orilla, lecho de
// grava bajo el agua y tierra en los costados.
// =====================================================================

const COLORES = {
    hierba: new THREE.Color(0x93c265),
    hierbaOscura: new THREE.Color(0x6f9f4d),
    musgo: new THREE.Color(0xa9c76c),
    arena: new THREE.Color(0xdcc69c),
    grava: new THREE.Color(0xb9a98b),
    lecho: new THREE.Color(0x9d8f76),
    tierra: new THREE.Color(0xb88a63),
    tierraOscura: new THREE.Color(0x8d654a),
    roca: new THREE.Color(0xaaa59c)
};

function crearIsla() {
    const dentro = Math.round(ajustes.anillos * 0.72);
    const nr = ajustes.anillos;
    const ns = ajustes.gajos;
    const posiciones = new Float32Array((nr + 1) * ns * 3);
    const colores = new Float32Array((nr + 1) * ns * 3);
    const c = new THREE.Color();
    const aux = new THREE.Color();
    for (let j = 0; j < ns; j++) {
        const ang = (j / ns) * Math.PI * 2;
        const radio = radioIsla(ang);
        for (let i = 0; i <= nr; i++) {
            const fi = i <= dentro ? 0 : ((i - dentro) / (nr - dentro)) * Math.PI * 0.5;
            const d = i <= dentro ? (i / dentro) * 0.8 : 0.8 + 0.2 * Math.sin(fi);
            const x = Math.cos(ang) * d * radio;
            const z = Math.sin(ang) * d * radio;
            const y = i === nr ? 0 : alturaBase(x, z) * Math.cos(fi);
            const k = (j * (nr + 1) + i) * 3;
            posiciones[k] = x;
            posiciones[k + 1] = y;
            posiciones[k + 2] = z;

            const manchas = fbm(x * 0.9 + 20, z * 0.9, 11, 3);
            const detalle = fbm(x * 4.0, z * 4.0, 13, 2);
            c.copy(COLORES.hierba).lerp(COLORES.hierbaOscura, suave(0.45, 0.7, manchas) * 0.8).lerp(COLORES.musgo, suave(0.55, 0.3, manchas) * 0.6);
            const repisa = repisaEn(x, z);
            c.lerp(aux.copy(COLORES.roca).lerp(COLORES.musgo, suave(0.4, 0.7, detalle) * 0.6), suave(0.35, 0.75, repisa));
            const sobreAgua = y - NIVEL;
            c.lerp(COLORES.arena, suave(0.2, 0.06, sobreAgua) * (1 - suave(0.9, 1.0, d)));
            if (sobreAgua < 0.02) {
                c.copy(COLORES.grava).lerp(COLORES.lecho, suave(0.02, -0.3, sobreAgua)).multiplyScalar(0.92 + detalle * 0.16);
            }
            const lado = suave(0.8, 0.88, d);
            const terrones = fbm(ang * 9.0, y * 3.2, 15, 3);
            const piedrecitas = suave(0.68, 0.74, fbm(ang * 26.0, y * 9.0, 17, 2));
            aux.copy(COLORES.tierra).lerp(COLORES.tierraOscura, Math.min(1, Math.max(0, suave(0.15, 1.15, 1 - y / 1.3) * 0.7 + (terrones - 0.5) * 0.9)));
            aux.lerp(COLORES.tierraOscura, piedrecitas * 0.35);
            c.lerp(aux, lado);
            c.multiplyScalar(0.94 + detalle * 0.12);
            colores[k] = c.r;
            colores[k + 1] = c.g;
            colores[k + 2] = c.b;
        }
    }
    const indices = [];
    for (let j = 0; j < ns; j++) {
        const jn = (j + 1) % ns;
        for (let i = 0; i < nr; i++) {
            const a = j * (nr + 1) + i;
            const b = jn * (nr + 1) + i;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const malla = new THREE.Mesh(geo, mojar(entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, envMapIntensity: 0.4 }), 0.4), "isla"));
    malla.castShadow = true;
    malla.receiveShadow = true;
    escena.add(malla);
    return malla;
}

const isla = crearIsla();


// =====================================================================
// 8. PIEDRAS
// Cantos rodados blanditos con musgo por arriba. Hay unas pocas formas
// que se reutilizan con distinto tamaño: las grandes de la cascada, las
// de la orilla, dos dentro de la poza y guijarros en el fondo.
// =====================================================================

function esferaSuave(detalle) {
    const geo = new THREE.IcosahedronGeometry(1, detalle);
    geo.deleteAttribute("normal");
    geo.deleteAttribute("uv");
    return mergeVertices(geo);
}

function geometriaPiedra(semilla) {
    const geo = esferaSuave(4);
    const pos = geo.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = (ruido3(v.x * 1.3 + semilla, v.y * 1.3, v.z * 1.3, semilla) - 0.5) * 0.45 + (ruido3(v.x * 3.2, v.y * 3.2 + semilla, v.z * 3.2, semilla + 3) - 0.5) * 0.12;
        v.multiplyScalar(1 + n);
        if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.35;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const nor = geo.getAttribute("normal");
    const colores = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const base = new THREE.Color().setHSL(0.08 + semilla * 0.012, 0.08 + (semilla % 3) * 0.03, 0.42 + (semilla % 4) * 0.025);
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const ny = nor.getY(i);
        const manchas = ruido3(v.x * 2.5, v.y * 2.5, v.z * 2.5, semilla + 7);
        c.copy(base).multiplyScalar(0.88 + manchas * 0.22);
        c.lerp(COLORES.musgo, suave(0.45, 0.8, ny) * suave(0.4, 0.62, manchas) * 0.85);
        c.multiplyScalar(0.8 + 0.2 * suave(-0.6, 0.4, ny));
        colores.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    return geo;
}

const formasPiedra = [1, 2, 3, 4, 5].map(geometriaPiedra);
const materialPiedra = mojar(entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, envMapIntensity: 0.6 }), 0.6), "piedra");
const piedras = [];

function ponerPiedra(x, z, tam, alto, giro, forma, hundir = 0.35) {
    const p = new THREE.Mesh(formasPiedra[forma % formasPiedra.length], materialPiedra);
    const y = alturaEn(x, z);
    p.scale.set(tam, tam * alto, tam * (0.8 + (forma % 3) * 0.12));
    p.rotation.y = giro;
    p.position.set(x, y + tam * alto * (0.35 - hundir), z);
    p.castShadow = true;
    p.receiveShadow = true;
    escena.add(p);
    piedras.push({ x, z, r: tam * 0.9 });
    return p;
}


// =====================================================================
// 9. LA CASCADA
// Sale de entre las rocas de la repisa y cae a la poza. Es una lámina
// curvada con franjas que bajan, espuma de burbujas abajo y gotas que
// van soltando ondas en el agua.
// =====================================================================

const cascada = (() => {
    const inicio = new THREE.Vector2(-1.5, -2.85);
    const hacia = new THREE.Vector2(POZA.x - inicio.x, POZA.y - inicio.y).normalize();
    const impacto = inicio.clone();
    for (let i = 0; i < 200 && profundidadEn(impacto.x, impacto.y) < 0.16; i++) impacto.addScaledVector(hacia, 0.04);
    const labio = inicio.clone();
    const alturaRepisa = alturaEn(inicio.x, inicio.y);
    for (let i = 0; i < 200 && alturaEn(labio.x, labio.y) > alturaRepisa - 0.18; i++) labio.addScaledVector(hacia, 0.03);
    labio.addScaledVector(hacia, -0.12);
    return { inicio, hacia, impacto, labio, arriba: alturaEn(labio.x, labio.y) + 0.06 };
})();

ponerPiedra(cascada.labio.x + cascada.hacia.y * 0.62, cascada.labio.y - cascada.hacia.x * 0.62, 0.58, 1.1, 0.4, 0, 0.12);
ponerPiedra(cascada.labio.x - cascada.hacia.y * 0.66, cascada.labio.y + cascada.hacia.x * 0.66, 0.66, 0.95, 1.7, 1, 0.12);
ponerPiedra(cascada.inicio.x - 0.25, cascada.inicio.y - 0.5, 0.75, 0.75, 2.6, 2, 0.15);
ponerPiedra(cascada.inicio.x + 0.75, cascada.inicio.y - 0.25, 0.45, 0.8, 0.9, 3, 0.2);
ponerPiedra(cascada.impacto.x + cascada.hacia.y * 0.75 + 0.1, cascada.impacto.y - cascada.hacia.x * 0.75, 0.55, 0.85, 0.9, 3, 0.25);
ponerPiedra(cascada.impacto.x - cascada.hacia.y * 0.7, cascada.impacto.y + cascada.hacia.x * 0.7 + 0.15, 0.48, 0.9, 3.3, 4, 0.25);

const laminaCascada = (() => {
    const largo = cascada.labio.distanceTo(cascada.impacto);
    const caida = cascada.arriba - NIVEL;
    const geo = new THREE.PlaneGeometry(1, 1, 6, 28);
    const pos = geo.getAttribute("position");
    const lateral = new THREE.Vector2(-cascada.hacia.y, cascada.hacia.x);
    for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i);
        const t = 0.5 - pos.getY(i);
        const ancho = 0.4 + 0.14 * t;
        const avance = largo * (0.25 * t + 0.75 * Math.sqrt(t));
        const x = cascada.labio.x + cascada.hacia.x * avance + lateral.x * u * ancho;
        const z = cascada.labio.y + cascada.hacia.y * avance + lateral.y * u * ancho;
        const y = cascada.arriba - caida * Math.pow(t, 1.6) + Math.sin(u * Math.PI) * 0.03;
        pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    const material = new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, tRuido: { value: tRuido }, uColor: { value: new THREE.Color() } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTiempo;
            uniform sampler2D tRuido;
            uniform vec3 uColor;
            varying vec2 vUv;
            void main() {
                float t = 1.0 - vUv.y;
                float u = vUv.x;
                float rayas = texture2D(tRuido, vec2(u * 1.6, t * 0.7 - uTiempo * 0.9)).r;
                float finas = texture2D(tRuido, vec2(u * 4.0 + 0.3, t * 1.6 - uTiempo * 1.6)).g;
                float a = 0.45 + smoothstep(0.4, 0.75, rayas) * 0.35 + smoothstep(0.55, 0.8, finas) * 0.25;
                a *= smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.82, u);
                a *= smoothstep(0.0, 0.05, t);
                vec3 c = mix(uColor * 0.82, uColor * 1.15, smoothstep(0.4, 0.8, finas));
                c = mix(c, uColor * 1.25, smoothstep(0.75, 1.0, t));
                gl_FragColor = vec4(c, clamp(a, 0.0, 0.92));
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(geo, material);
    m.renderOrder = 4;
    escena.add(m);
    return m;
})();

const espuma = (() => {
    const n = 46;
    const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), entorno(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, transparent: true, opacity: 0.9, envMapIntensity: 0.8 }), 0.8), n);
    m.renderOrder = 5;
    const burbujas = Array.from({ length: n }, () => ({ vida: Math.random(), dur: 0.8 + Math.random() * 1.2, ang: 0, dist: 0, tam: 0 }));
    escena.add(m);
    return { m, burbujas };
})();

const auxM = new THREE.Matrix4();
const auxQ = new THREE.Quaternion();
const auxV = new THREE.Vector3();
const auxE = new THREE.Vector3();
const auxEuler = new THREE.Euler();

function moverEspuma(delta) {
    espuma.burbujas.forEach((b, i) => {
        b.vida += delta / b.dur;
        if (b.vida >= 1) {
            b.vida = 0;
            b.dur = 0.8 + Math.random() * 1.2;
            b.ang = Math.random() * Math.PI * 2;
            b.dist = Math.random() * 0.12;
            b.tam = 0.03 + Math.random() * 0.05;
        }
        const r = b.dist + b.vida * 0.32;
        auxV.set(cascada.impacto.x + Math.cos(b.ang) * r, NIVEL + 0.005, cascada.impacto.y + Math.sin(b.ang) * r);
        const s = b.tam * Math.sin(Math.PI * Math.min(1, b.vida * 1.4)) * (1 - b.vida * 0.4);
        auxM.compose(auxV, auxQ, auxE.set(s, s * 0.55, s));
        espuma.m.setMatrixAt(i, auxM);
    });
    espuma.m.instanceMatrix.needsUpdate = true;
}


// =====================================================================
// 10. PIEDRAS DE LA ORILLA, DE LA POZA Y GUIJARROS
// =====================================================================

(() => {
    const sitios = [
        [2.9, 0.5, 0.45, 0.8], [2.5, 1.9, 0.38, 0.75], [1.2, 2.75, 0.5, 0.7], [-0.6, 2.7, 0.34, 0.8], [-2.3, 1.6, 0.55, 0.75],
        [-2.75, 0.2, 0.42, 0.9], [2.2, -1.3, 0.4, 0.85], [0.9, -1.55, 0.3, 0.8], [3.4, -0.4, 0.3, 0.7], [-1.7, 2.4, 0.26, 0.8],
        [-3.5, -1.2, 0.5, 0.8], [3.3, 2.6, 0.32, 0.8], [-0.2, -2.2, 0.36, 0.8]
    ];
    sitios.forEach(([x, z, t, a], i) => {
        const e = elipsePoza(x, z);
        const xx = e < 0.98 ? POZA.x + (x - POZA.x) * (1.02 / e) : x;
        const zz = e < 0.98 ? POZA.y + (z - POZA.y) * (1.02 / e) : z;
        ponerPiedra(xx, zz, t, a, i * 1.7, i, 0.3);
    });
    ponerPiedra(POZA.x + 0.9, POZA.y + 0.4, 0.42, 0.75, 0.3, 2, 0.15);
    ponerPiedra(POZA.x - 0.8, POZA.y + 1.0, 0.28, 0.85, 1.2, 4, 0.1);

    const n = movil ? 50 : 90;
    const guijarros = new THREE.InstancedMesh(formasPiedra[2], materialPiedra, n);
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < 600 && k < n; i++) {
        const x = POZA.x + (Math.random() - 0.5) * 6;
        const z = POZA.y + (Math.random() - 0.5) * 5;
        const prof = profundidadEn(x, z);
        if (prof <= 0.005 && !(elipsePoza(x, z) < 1.25 && Math.random() < 0.5)) continue;
        if (elipsePoza(x, z) > 1.25) continue;
        const s = 0.05 + Math.random() * 0.09;
        auxEuler.set(0, Math.random() * 6.28, 0);
        auxQ.setFromEuler(auxEuler);
        auxM.compose(auxV.set(x, alturaEn(x, z) + s * 0.1, z), auxQ, auxE.set(s * 1.3, s * 0.55, s));
        guijarros.setMatrixAt(k, auxM);
        guijarros.setColorAt(k, c.setHSL(0.07 + Math.random() * 0.05, 0.12 + Math.random() * 0.15, 0.55 + Math.random() * 0.3));
        k++;
    }
    guijarros.count = k;
    guijarros.receiveShadow = true;
    escena.add(guijarros);
})();


// =====================================================================
// 11. EL CASTAÑO
// Tronco torcido con raíces, unas ramas y la copa hecha de bolas
// blanditas en colores de otoño. Se mece un poco con el viento.
// =====================================================================

const PIE_CASTANO = new THREE.Vector3(2.65, 0, -2.55);
PIE_CASTANO.y = alturaEn(PIE_CASTANO.x, PIE_CASTANO.z) - 0.05;
const castano = new THREE.Group();
castano.position.copy(PIE_CASTANO);
castano.scale.setScalar(0.82);
escena.add(castano);
const copa = new THREE.Group();
castano.add(copa);

(() => {
    const materialCorteza = entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMapIntensity: 0.4 }), 0.4);
    const tronco = new THREE.CylinderGeometry(0.17, 0.3, 2.3, 16, 14, true);
    tronco.translate(0, 1.15, 0);
    const pos = tronco.getAttribute("position");
    const colores = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        const y = pos.getY(i);
        let z = pos.getZ(i);
        const ang = Math.atan2(z, x);
        const raiz = 1 + 0.55 * Math.exp(-y * 4) * (0.7 + 0.3 * Math.sin(ang * 5));
        x = x * raiz + 0.16 * Math.sin(y * 1.3) - 0.1 * (y / 2.3) ** 2;
        z = z * raiz + 0.08 * (y / 2.3) ** 2;
        pos.setXYZ(i, x, y, z);
        const vetas = 0.8 + 0.2 * Math.sin(ang * 9 + y * 2.0) + (ruido(ang * 3, y * 6, 4) - 0.5) * 0.3;
        c.setRGB(0.48, 0.35, 0.27).multiplyScalar(vetas);
        colores.set([c.r, c.g, c.b], i * 3);
    }
    tronco.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    tronco.computeVertexNormals();
    const ramas = [
        [-0.1, 1.75, 0.8, -0.8, 0.9],
        [0.0, 1.95, -0.7, -0.4, 0.8],
        [0.05, 2.1, 0.3, 0.9, 0.7],
        [-0.05, 1.6, -0.2, 0.7, 0.75]
    ].map(([x, y, ax, az, largo]) => {
        const g = new THREE.CylinderGeometry(0.045, 0.1, largo, 8, 1, true);
        g.translate(0, largo / 2, 0);
        g.rotateZ(ax * 0.8);
        g.rotateX(az * 0.8);
        g.translate(x, y, 0);
        const n = g.getAttribute("position").count;
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).map((_, k) => [0.42, 0.31, 0.24][k % 3]), 3));
        return g;
    });
    const madera = new THREE.Mesh(mergeGeometries([tronco, ...ramas]), materialCorteza);
    madera.castShadow = true;
    madera.receiveShadow = true;
    castano.add(madera);

    const materialCopa = entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, envMapIntensity: 0.45 }), 0.45);
    const tonos = [0xe0a243, 0xd9822e, 0xc9a74a, 0xa9b85e, 0xd46f31, 0xe6b955, 0xb7a24c, 0xcf8a3a];
    const bolas = [
        [0, 3.25, 0, 1.15], [0.85, 2.95, 0.25, 0.85], [-0.85, 2.85, -0.2, 0.9], [0.2, 2.75, 0.85, 0.85],
        [-0.25, 2.8, -0.85, 0.82], [0.55, 3.75, -0.35, 0.75], [-0.55, 3.65, 0.4, 0.7], [0.95, 2.55, -0.6, 0.6]
    ];
    bolas.forEach(([x, y, z, r], k) => {
        const g = esferaSuave(movil ? 4 : 5);
        const p = g.getAttribute("position");
        const v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i);
            const n = (ruido3(v.x * 1.6 + k, v.y * 1.6, v.z * 1.6, k) - 0.5) * 0.35 + (ruido3(v.x * 5.0, v.y * 5.0 + k, v.z * 5.0, k + 2) - 0.5) * 0.16;
            v.multiplyScalar(1 + n);
            p.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        const nor = g.getAttribute("normal");
        const col = new Float32Array(p.count * 3);
        const base = new THREE.Color(tonos[k % tonos.length]);
        const otro = new THREE.Color(tonos[(k + 3) % tonos.length]);
        for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i);
            const m = ruido3(v.x * 2.2, v.y * 2.2, v.z * 2.2, k + 30);
            c.copy(base).lerp(otro, suave(0.45, 0.7, m) * 0.7);
            c.multiplyScalar(0.72 + 0.28 * suave(-0.7, 0.6, nor.getY(i)));
            col.set([c.r, c.g, c.b], i * 3);
        }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const bola = new THREE.Mesh(g, materialCopa);
        bola.position.set(x, y, z);
        bola.scale.setScalar(r);
        bola.castShadow = true;
        bola.receiveShadow = true;
        copa.add(bola);
    });

    const erizo = new THREE.IcosahedronGeometry(0.07, 1);
    const pinchos = new THREE.InstancedMesh(erizo, entorno(new THREE.MeshStandardMaterial({ color: 0x9a8a3c, roughness: 0.7, flatShading: true, envMapIntensity: 0.5 }), 0.5), 7);
    for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.6 + Math.random() * 0.9;
        const x = PIE_CASTANO.x + Math.cos(a) * r;
        const z = PIE_CASTANO.z + Math.sin(a) * r;
        if (alturaEn(x, z) < NIVEL + 0.1) continue;
        auxEuler.set(Math.random() * 3, Math.random() * 3, 0);
        auxQ.setFromEuler(auxEuler);
        auxM.compose(auxV.set(x, alturaEn(x, z) + 0.04, z), auxQ, auxE.setScalar(0.8 + Math.random() * 0.5));
        pinchos.setMatrixAt(i, auxM);
    }
    pinchos.castShadow = true;
    escena.add(pinchos);
})();


// =====================================================================
// 12. HIERBA, JUNCOS Y FLORES
// Matas de hojas finas repartidas por la isla, juncos con su espiga en
// la orilla y florecillas. Todo se mueve con el viento en el shader.
// =====================================================================

function moverConViento(material, clave, fuerza) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTiempo = comunes.uTiempo;
        shader.uniforms.uViento = comunes.uViento;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTiempo;\nuniform float uViento;")
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                vec3 raiz = vec3(0.0);
                #ifdef USE_INSTANCING
                raiz = instanceMatrix[3].xyz;
                #endif
                float alto = max(position.y, 0.0);
                float viento = sin(uTiempo * 1.5 + raiz.x * 0.9 + raiz.z * 0.7) * 0.6 + sin(uTiempo * 2.9 + raiz.x * 2.3 - raiz.z) * 0.3;
                transformed.x += viento * alto * alto * ${fuerza.toFixed(2)} * uViento;
                transformed.z += viento * alto * alto * ${(fuerza * 0.4).toFixed(2)} * uViento;`
            );
    };
    material.customProgramCacheKey = () => "viento" + clave;
    return material;
}

function geometriaMata() {
    const hojas = [];
    for (let i = 0; i < 7; i++) {
        const alto = 0.11 + Math.random() * 0.1;
        const g = new THREE.PlaneGeometry(0.05, alto, 1, 3);
        g.translate(0, alto / 2, 0);
        const p = g.getAttribute("position");
        const col = new Float32Array(p.count * 3);
        for (let k = 0; k < p.count; k++) {
            const t = p.getY(k) / alto;
            p.setX(k, p.getX(k) * (1 - t * 0.9));
            p.setZ(k, t * t * 0.05);
            const c = new THREE.Color(0x4f7d35).lerp(new THREE.Color(0xc4dc82), t);
            col.set([c.r, c.g, c.b], k * 3);
        }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        g.rotateX(-0.12 - Math.random() * 0.25);
        g.rotateY(Math.random() * Math.PI * 2);
        g.translate((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06);
        hojas.push(g);
    }
    const geo = mergeGeometries(hojas);
    geo.computeVertexNormals();
    return geo;
}

function sitioLibre(x, z, margen) {
    return !piedras.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + margen) && Math.hypot(x - PIE_CASTANO.x, z - PIE_CASTANO.z) > 0.38;
}

function repartir(instancias, cuantos, valido, colocar) {
    let k = 0;
    for (let i = 0; i < cuantos * 30 && k < cuantos; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radioIsla(ang) * 0.8;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const y = alturaEn(x, z);
        if (!valido(x, y, z)) continue;
        colocar(k, x, y, z);
        k++;
    }
    instancias.count = k;
}

(() => {
    const matas = new THREE.InstancedMesh(geometriaMata(), moverConViento(entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.5 }), 0.5), "mata", 1.2), ajustes.matas);
    const c = new THREE.Color();
    repartir(matas, ajustes.matas, (x, y, z) => y > NIVEL + 0.1 && repisaEn(x, z) < 0.45 && sitioLibre(x, z, 0.05), (k, x, y, z) => {
        auxEuler.set(0, Math.random() * 6.28, 0);
        auxQ.setFromEuler(auxEuler);
        const s = 0.8 + Math.random() * 0.6;
        auxM.compose(auxV.set(x, y - 0.01, z), auxQ, auxE.set(s, s * (0.7 + Math.random() * 0.6), s));
        matas.setMatrixAt(k, auxM);
        matas.setColorAt(k, c.setHSL(0.24 + Math.random() * 0.06, 0.35 + Math.random() * 0.2, 0.62 + Math.random() * 0.2));
    });
    matas.receiveShadow = true;
    escena.add(matas);

    const tallo = new THREE.CylinderGeometry(0.008, 0.016, 0.8, 5, 4);
    tallo.translate(0, 0.4, 0);
    const espiga = new THREE.CapsuleGeometry(0.03, 0.12, 4, 8);
    espiga.translate(0, 0.66, 0);
    const pintar = (geo, hex) => {
        const g = geo.index ? geo.toNonIndexed() : geo;
        const n = g.getAttribute("position").count;
        const c2 = new THREE.Color(hex);
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).map((_, k) => [c2.r, c2.g, c2.b][k % 3]), 3));
        return g;
    };
    const junco = mergeGeometries([pintar(tallo, 0x5f8c3e), pintar(espiga, 0x7b5332)]);
    const juncos = new THREE.InstancedMesh(junco, moverConViento(entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, envMapIntensity: 0.5 }), 0.5), "junco", 0.25), ajustes.juncos);
    repartir(juncos, ajustes.juncos, (x, y, z) => y > NIVEL - 0.06 && y < NIVEL + 0.12 && sitioLibre(x, z, 0.02) && (x < -0.8 || z > 1.6), (k, x, y, z) => {
        auxEuler.set((Math.random() - 0.5) * 0.25, Math.random() * 6.28, (Math.random() - 0.5) * 0.25);
        auxQ.setFromEuler(auxEuler);
        const s = 0.6 + Math.random() * 0.6;
        auxM.compose(auxV.set(x, y - 0.02, z), auxQ, auxE.setScalar(s));
        juncos.setMatrixAt(k, auxM);
    });
    juncos.castShadow = true;
    escena.add(juncos);

    const tallo2 = pintar(new THREE.CylinderGeometry(0.005, 0.007, 0.16, 4, 2).translate(0, 0.08, 0), 0x5c8a3a);
    const cabeza = pintar(new THREE.IcosahedronGeometry(0.032, 1).translate(0, 0.17, 0), 0xffffff);
    const flores = new THREE.InstancedMesh(mergeGeometries([tallo2, cabeza]), moverConViento(entorno(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, envMapIntensity: 0.5 }), 0.5), "flor", 1.6), ajustes.flores);
    const tonos = [0xffffff, 0xfff1a8, 0xffc2d4, 0xd9c8ff, 0xffffff];
    repartir(flores, ajustes.flores, (x, y, z) => y > NIVEL + 0.15 && repisaEn(x, z) < 0.4 && sitioLibre(x, z, 0.05), (k, x, y, z) => {
        auxEuler.set(0, Math.random() * 6.28, 0);
        auxQ.setFromEuler(auxEuler);
        auxM.compose(auxV.set(x, y, z), auxQ, auxE.setScalar(0.8 + Math.random() * 0.5));
        flores.setMatrixAt(k, auxM);
        flores.setColorAt(k, c.set(tonos[k % tonos.length]));
    });
    escena.add(flores);
})();


// =====================================================================
// 13. LAS ONDAS
// La ecuación de ondas en una textura que cubre la poza. Cada toque y
// cada gota de la cascada suelta una gota; la orilla hace de pared.
// =====================================================================

const MAX_GOTAS = 8;
const gotasPendientes = [];
const pasoOndas = new THREE.Vector2(1 / ajustes.ondas, 1 / ajustes.ondas);

const tProfundidad = (() => {
    const n = 128;
    const datos = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const x = POZA.x + ((i + 0.5) / n - 0.5) * TAM_ONDAS;
            const z = POZA.y + ((j + 0.5) / n - 0.5) * TAM_ONDAS;
            datos[j * n + i] = Math.round(Math.min(1, profundidadEn(x, z) / 0.6) * 255);
        }
    }
    const t = new THREE.DataTexture(datos, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
})();

const gl = renderizador.getContext();
const hayOndas = renderizador.capabilities.isWebGL2 && !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
const ondas = [0, 1].map(() => new THREE.WebGLRenderTarget(ajustes.ondas, ajustes.ondas, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));

const materialOndas = new THREE.ShaderMaterial({
    uniforms: {
        tPrevio: { value: null },
        tProf: { value: tProfundidad },
        uPaso: { value: pasoOndas },
        uGotas: { value: Array.from({ length: MAX_GOTAS }, () => new THREE.Vector4()) },
        uCentro: { value: POZA },
        uTam: { value: TAM_ONDAS }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tPrevio;
        uniform sampler2D tProf;
        uniform vec2 uPaso;
        uniform vec4 uGotas[${MAX_GOTAS}];
        uniform vec2 uCentro;
        uniform float uTam;
        varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tPrevio, vUv);
            float s = texture2D(tPrevio, vUv + vec2(uPaso.x, 0.0)).r + texture2D(tPrevio, vUv - vec2(uPaso.x, 0.0)).r
                    + texture2D(tPrevio, vUv + vec2(0.0, uPaso.y)).r + texture2D(tPrevio, vUv - vec2(0.0, uPaso.y)).r;
            float n = (s * 0.5 - c.g) * 0.986;
            vec2 l = uCentro + (vUv - 0.5) * uTam;
            for (int i = 0; i < ${MAX_GOTAS}; i++) {
                vec4 g = uGotas[i];
                if (g.w == 0.0) continue;
                vec2 d = l - g.xy;
                n += g.w * exp(-dot(d, d) / (g.z * g.z));
            }
            n *= smoothstep(0.0, 0.04, texture2D(tProf, vUv).r);
            gl_FragColor = vec4(n, c.r, 0.0, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaOndas = new THREE.Scene();
const cuadroOndas = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), materialOndas);
cuadroOndas.frustumCulled = false;
escenaOndas.add(cuadroOndas);
const camaraOndas = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function soltarGota(x, z, radio, fuerza) {
    if (gotasPendientes.length >= 24) gotasPendientes.shift();
    gotasPendientes.push([x, z, radio, fuerza]);
}

let restoOndas = 0;

function simularOndas(delta) {
    if (!hayOndas) return;
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
        renderizador.render(escenaOndas, camaraOndas);
        ondas.reverse();
    }
    renderizador.setRenderTarget(null);
}


// =====================================================================
// 14. EL AGUA DE LA POZA
// Un material de three con el color según lo honda que es la poza,
// transparente en la orilla y más opaco en lo hondo. La normal sale de
// las ondas, de un ruido que da vueltas despacio (el remolino del
// remanso) y del revuelo bajo la cascada.
// =====================================================================

const materialAgua = entorno(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 1 }), 1);
const usosAgua = {
    tOndas: { value: ondas[0].texture },
    tProf: { value: tProfundidad },
    tRuido: { value: tRuido },
    uPasoOndas: { value: pasoOndas },
    uCentro: { value: POZA },
    uTam: { value: TAM_ONDAS },
    uImpacto: { value: cascada.impacto },
    uSomero: { value: new THREE.Color() },
    uHondo: { value: new THREE.Color() },
    uHayOndas: { value: hayOndas ? 1 : 0 }
};

materialAgua.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, usosAgua, { uTiempo: comunes.uTiempo });
    shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vXZ;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
        .replace(
            "#include <common>",
            `#include <common>
            varying vec2 vXZ;
            uniform sampler2D tOndas;
            uniform sampler2D tProf;
            uniform sampler2D tRuido;
            uniform vec2 uPasoOndas;
            uniform vec2 uCentro;
            uniform float uTam;
            uniform vec2 uImpacto;
            uniform vec3 uSomero;
            uniform vec3 uHondo;
            uniform float uHayOndas;
            uniform float uTiempo;
            float profAgua;
            vec2 gradAgua;`
        )
        .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
            vec2 uvP = (vXZ - uCentro) / uTam + 0.5;
            profAgua = texture2D(tProf, uvP).r * 0.6;
            if (profAgua < 0.002) discard;
            float oI = texture2D(tOndas, uvP - vec2(uPasoOndas.x, 0.0)).r;
            float oD = texture2D(tOndas, uvP + vec2(uPasoOndas.x, 0.0)).r;
            float oB = texture2D(tOndas, uvP - vec2(0.0, uPasoOndas.y)).r;
            float oA = texture2D(tOndas, uvP + vec2(0.0, uPasoOndas.y)).r;
            vec2 rel = vXZ - uCentro;
            float r = length(rel);
            float giro = uTiempo * 0.035 / (0.6 + r * 0.4);
            mat2 rot = mat2(cos(giro), -sin(giro), sin(giro), cos(giro));
            vec2 q = rot * rel;
            vec2 n1 = texture2D(tRuido, q * 0.32 + 0.2).rg - 0.5;
            vec2 n2 = texture2D(tRuido, vXZ * 0.9 + vec2(uTiempo * 0.03, uTiempo * 0.021)).ba - 0.5;
            float cerca = exp(-dot(vXZ - uImpacto, vXZ - uImpacto) / 0.35);
            vec2 n3 = texture2D(tRuido, vXZ * 2.2 - vec2(0.0, uTiempo * 0.4)).rg - 0.5;
            gradAgua = vec2(oD - oI, oA - oB) * 6.0 * uHayOndas + n1 * 0.12 + n2 * 0.08 + n3 * cerca * 0.5;
            float k = 1.0 - exp(-profAgua * 5.5);
            diffuseColor.rgb = mix(uSomero, uHondo, k);
            diffuseColor.a = mix(0.12, 0.68, k);
            float orilla = smoothstep(0.035, 0.0, profAgua);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), orilla * 0.35);
            diffuseColor.a = max(diffuseColor.a, orilla * 0.35);
            float revuelo = smoothstep(0.45, 0.7, texture2D(tRuido, vXZ * 3.0 + vec2(uTiempo * 0.2, -uTiempo * 0.3)).a) * cerca;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), revuelo * 0.6);
            diffuseColor.a = max(diffuseColor.a, revuelo * 0.7);`
        )
        .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>
            normal = normalize((viewMatrix * vec4(normalize(vec3(-gradAgua.x, 1.0, -gradAgua.y)), 0.0)).xyz);`
        )
        .replace(
            "#include <opaque_fragment>",
            `#include <opaque_fragment>
            float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
            float brilloAgua = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(0.33));
            gl_FragColor.a = clamp(max(gl_FragColor.a + fres * 0.5, brilloAgua * 1.4), 0.0, 1.0);`
        );
};
materialAgua.customProgramCacheKey = () => "agua";

const agua = new THREE.Mesh(new THREE.CircleGeometry(TAM_ONDAS / 2, 128).rotateX(-Math.PI / 2), materialAgua);
agua.position.set(POZA.x, NIVEL, POZA.y);
agua.renderOrder = 3;
escena.add(agua);


// =====================================================================
// 15. LAS TRUCHAS
// Cada trucha es un plano bajo el agua que se dobla con la cola, con su
// sombra en el fondo de la poza. Dan vueltas, se paran contra la
// corriente y huyen si tocas el agua cerca.
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

const FRAGMENTO_PEZ = `
uniform float uSombra;
uniform float uTono;
uniform float uLuz;
varying vec2 vLocal;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float elipse(vec2 q, vec2 c, vec2 r, float a) {
    q -= c;
    q = vec2(cos(a) * q.x + sin(a) * q.y, -sin(a) * q.x + cos(a) * q.y);
    return 1.0 - length(q / r);
}

void main() {
    float x = vLocal.x;
    float y = vLocal.y;
    float t = clamp((x + 0.31) / 0.81, 0.0, 1.0);
    float semi = 0.017 + 0.078 * pow(sin(3.14159 * pow(t, 1.1)), 0.7);
    semi *= sqrt(clamp((0.5 - x) / 0.07, 0.0, 1.0));
    float cuerpo = x < -0.31 ? -1.0 : semi - abs(y);
    float tc = clamp((-0.29 - x) / 0.21, 0.0, 1.0);
    float semiCola = 0.02 + 0.09 * tc;
    float corte = -0.5 + 0.03 * (1.0 - pow(abs(y) / 0.11, 2.0));
    float cola = x > -0.28 ? -1.0 : min(semiCola - abs(y), x - corte);
    float pecho = elipse(vec2(x, abs(y)), vec2(0.25, 0.075), vec2(0.06, 0.018), 0.65);
    float vientre = elipse(vec2(x, abs(y)), vec2(-0.08, 0.045), vec2(0.04, 0.012), 0.5);
    float aletas = max(max(pecho, vientre) * 0.06, cola);
    float b = uSombra > 0.5 ? 0.03 : 0.006;
    float aCuerpo = smoothstep(-b, b, cuerpo);
    float aAletas = smoothstep(-b, b, aletas) * 0.6;
    float alfa = max(aCuerpo, aAletas);
    if (alfa < 0.003) discard;
    if (uSombra > 0.5) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, alfa * 0.22 * uLuz);
        return;
    }
    float lado = clamp(abs(y) / max(semi, 0.001), 0.0, 1.0);
    vec3 dorso = mix(vec3(0.16, 0.15, 0.09), vec3(0.22, 0.18, 0.1), uTono);
    vec3 flanco = mix(vec3(0.66, 0.58, 0.36), vec3(0.74, 0.6, 0.38), uTono);
    vec3 col = mix(dorso, flanco, smoothstep(0.25, 0.95, lado));
    vec2 celda = floor(vLocal * vec2(46.0, 60.0));
    vec2 dentro = fract(vLocal * vec2(46.0, 60.0)) - 0.5;
    float h = hash12(celda + uTono * 13.0);
    float mancha = step(0.62, h) * smoothstep(0.32, 0.18, length(dentro));
    col = mix(col, vec3(0.08, 0.06, 0.04), mancha * smoothstep(-0.3, 0.0, x) * 0.85);
    float roja = step(0.9, h) * smoothstep(0.5, 0.75, lado) * smoothstep(0.3, 0.15, length(dentro));
    col = mix(col, vec3(0.85, 0.25, 0.12), roja);
    float ojo = smoothstep(0.012, 0.008, length(vec2(x - 0.415, abs(y) - 0.032)));
    col = mix(col, vec3(0.02), ojo);
    vec3 colAleta = vec3(0.6, 0.52, 0.32) * (0.8 + 0.2 * sin(atan(y, x + 0.3) * 60.0));
    col = mix(colAleta, col, aCuerpo);
    gl_FragColor = vec4(pow(col, vec3(2.2)) * uLuz, alfa);
}
`;

const geometriaPez = new THREE.PlaneGeometry(1, 0.28, 24, 1);
const peces = [];
const auxSitio = new THREE.Vector2();

function buscarSitio(pez, destino, lejosDe) {
    for (let intento = 0; intento < 80; intento++) {
        auxSitio.set(POZA.x + (Math.random() - 0.5) * 5.5, POZA.y + (Math.random() - 0.5) * 4.2);
        if (profundidadEn(auxSitio.x, auxSitio.y) < 0.3) continue;
        if (lejosDe && auxSitio.distanceTo(lejosDe) < 1.2) continue;
        const ocupado = peces.some((o) => o !== pez && o.objetivo.distanceTo(auxSitio) < 0.7);
        if (ocupado && intento < 60) continue;
        destino.copy(auxSitio);
        return;
    }
    destino.copy(POZA);
}

function crearPeces() {
    for (let i = 0; i < ajustes.peces; i++) {
        const comun = { uFase: { value: 0 }, uOndula: { value: 0.02 }, uCurva: { value: 0 }, uTono: { value: Math.random() }, uLuz: comunes.uLuzPez };
        const material = new THREE.ShaderMaterial({ uniforms: { ...comun, uSombra: { value: 0 } }, vertexShader: VERTICE_PEZ, fragmentShader: FRAGMENTO_PEZ, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const materialSombra = new THREE.ShaderMaterial({ uniforms: { ...comun, uSombra: { value: 1 } }, vertexShader: VERTICE_PEZ, fragmentShader: FRAGMENTO_PEZ, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const largo = 0.42 + Math.random() * 0.2;
        const hacer = (m, orden) => {
            const g = new THREE.Group();
            const malla = new THREE.Mesh(geometriaPez, m);
            malla.rotation.x = -Math.PI / 2;
            malla.renderOrder = orden;
            g.add(malla);
            g.scale.setScalar(largo);
            escena.add(g);
            return g;
        };
        const pez = {
            cuerpo: hacer(material, 2),
            sombra: hacer(materialSombra, 1),
            comun,
            pos: new THREE.Vector2(),
            rumbo: Math.random() * Math.PI * 2,
            vel: 0,
            giro: 0,
            estado: "nadar",
            tiempo: 0,
            objetivo: new THREE.Vector2(),
            hondura: 0.06 + Math.random() * 0.07,
            rumboHuida: 0
        };
        buscarSitio(pez, pez.objetivo);
        pez.pos.copy(pez.objetivo);
        buscarSitio(pez, pez.objetivo);
        peces.push(pez);
    }
}

function diferenciaAngulo(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function moverPeces(delta) {
    const alSolX = sol.position.x / sol.position.y;
    const alSolZ = sol.position.z / sol.position.y;
    peces.forEach((pez) => {
        pez.tiempo -= delta;
        const dx = pez.objetivo.x - pez.pos.x;
        const dz = pez.objetivo.y - pez.pos.y;
        const lejos = Math.hypot(dx, dz);
        let rumboDeseado = Math.atan2(dz, dx);
        let velDeseada = 0.3;
        let giroMax = 2.2;
        if (pez.estado === "huir") {
            velDeseada = 1.6;
            giroMax = 7;
            rumboDeseado = pez.rumboHuida;
            if (pez.tiempo <= 0) {
                pez.estado = "nadar";
                buscarSitio(pez, pez.objetivo, pez.pos);
            }
        } else if (pez.estado === "quieto") {
            const tangente = Math.atan2(pez.pos.y - POZA.y, pez.pos.x - POZA.x) - Math.PI / 2;
            rumboDeseado = tangente + Math.sin(pez.tiempo * 0.7) * 0.2;
            velDeseada = Math.min(0.08, lejos * 0.5);
            if (lejos > 0.15) rumboDeseado = Math.atan2(dz, dx);
            if (pez.tiempo <= 0) {
                pez.estado = "nadar";
                buscarSitio(pez, pez.objetivo);
            }
        } else if (lejos < 0.2) {
            pez.estado = "quieto";
            pez.tiempo = 3 + Math.random() * 7;
        } else {
            velDeseada = 0.22 + Math.min(0.28, lejos * 0.2);
        }
        const delanteX = pez.pos.x + Math.cos(pez.rumbo) * 0.4;
        const delanteZ = pez.pos.y + Math.sin(pez.rumbo) * 0.4;
        if (profundidadEn(delanteX, delanteZ) < 0.22) {
            const izq = profundidadEn(pez.pos.x + Math.cos(pez.rumbo + 0.8) * 0.4, pez.pos.y + Math.sin(pez.rumbo + 0.8) * 0.4);
            const der = profundidadEn(pez.pos.x + Math.cos(pez.rumbo - 0.8) * 0.4, pez.pos.y + Math.sin(pez.rumbo - 0.8) * 0.4);
            rumboDeseado = pez.rumbo + (izq > der ? 1.4 : -1.4);
            if (pez.estado === "huir") pez.rumboHuida = rumboDeseado;
        }
        peces.forEach((otro) => {
            if (otro === pez) return;
            const ox = pez.pos.x - otro.pos.x;
            const oz = pez.pos.y - otro.pos.y;
            const d = Math.hypot(ox, oz);
            if (d < 0.45 && d > 0.001) rumboDeseado += diferenciaAngulo(Math.atan2(oz, ox), rumboDeseado) * 0.3 * (1 - d / 0.45);
        });
        const cambio = Math.max(-giroMax * delta, Math.min(giroMax * delta, diferenciaAngulo(rumboDeseado, pez.rumbo)));
        pez.rumbo += cambio;
        pez.giro += (cambio / Math.max(delta, 0.001) - pez.giro) * Math.min(1, delta * 6);
        pez.vel += (velDeseada - pez.vel) * Math.min(1, delta * (pez.estado === "huir" ? 8 : 1.5));
        const px = pez.pos.x + Math.cos(pez.rumbo) * pez.vel * delta;
        const pz = pez.pos.y + Math.sin(pez.rumbo) * pez.vel * delta;
        if (profundidadEn(px, pz) > 0.12) pez.pos.set(px, pz);
        pez.comun.uFase.value += delta * (5 + pez.vel * 22);
        pez.comun.uOndula.value = 0.012 + Math.min(0.06, pez.vel * 0.04);
        pez.comun.uCurva.value = Math.max(-0.25, Math.min(0.25, -pez.giro * 0.06));
        const fondo = alturaEn(pez.pos.x, pez.pos.y);
        const y = Math.max(fondo + 0.05, NIVEL - pez.hondura);
        pez.cuerpo.position.set(pez.pos.x, y, pez.pos.y);
        pez.cuerpo.rotation.y = -pez.rumbo;
        const caida = y - fondo;
        pez.sombra.position.set(pez.pos.x - alSolX * caida, fondo + 0.012, pez.pos.y - alSolZ * caida);
        pez.sombra.rotation.y = -pez.rumbo;
    });
}

function asustarPeces(x, z, radio) {
    peces.forEach((pez) => {
        const d = Math.hypot(pez.pos.x - x, pez.pos.y - z);
        if (d > radio) return;
        pez.estado = "huir";
        pez.tiempo = 0.6 + Math.random() * 0.5;
        pez.rumboHuida = Math.atan2(pez.pos.y - z, pez.pos.x - x) + (Math.random() - 0.5) * 0.6;
    });
}

crearPeces();


// =====================================================================
// 16. LAS HOJAS DE CASTAÑO
// Caen de la copa dando vueltas. Si caen al agua flotan, giran con el
// remolino y se mecen con las ondas; si caen en la hierba se quedan un
// rato. Luego vuelven a la copa para caer otra vez.
// =====================================================================

function texturaHoja() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 256;
    lienzo.height = 96;
    const g = lienzo.getContext("2d");
    const largo = 220;
    const arriba = [];
    const abajo = [];
    for (let i = 0; i <= 44; i++) {
        const t = i / 44;
        const ancho = Math.sin(Math.PI * Math.pow(t, 0.75)) * 36 * (1 - 0.1 * t);
        const diente = i % 2 ? 1 : 0.84;
        arriba.push([24 + t * largo, 48 - ancho * diente]);
        abajo.push([24 + t * largo, 48 + ancho * diente]);
    }
    g.beginPath();
    g.moveTo(24, 48);
    arriba.forEach(([x, y]) => g.lineTo(x, y));
    abajo.reverse().forEach(([x, y]) => g.lineTo(x, y));
    g.closePath();
    const d = g.createLinearGradient(0, 0, 256, 0);
    d.addColorStop(0, "#f4ecd8");
    d.addColorStop(1, "#ffffff");
    g.fillStyle = d;
    g.fill();
    g.strokeStyle = "rgba(90, 60, 30, 0.35)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(4, 48);
    g.lineTo(244, 48);
    g.stroke();
    g.lineWidth = 1.5;
    for (let i = 1; i < 16; i++) {
        const x = 24 + (i / 16) * largo;
        const ancho = Math.sin(Math.PI * Math.pow(i / 16, 0.75)) * 32;
        g.beginPath();
        g.moveTo(x - 10, 48);
        g.lineTo(x + 6, 48 - ancho);
        g.moveTo(x - 10, 48);
        g.lineTo(x + 6, 48 + ancho);
        g.stroke();
    }
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

const hojas = (() => {
    const n = ajustes.hojas;
    const m = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.36, 0.135).rotateX(-Math.PI / 2),
        entorno(new THREE.MeshStandardMaterial({ map: texturaHoja(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.5 }), 0.5),
        n
    );
    m.renderOrder = 6;
    const tonos = [0xe39a3c, 0xd9732c, 0xe8c35a, 0xb98a4a, 0xc95b2a, 0xd0b04c];
    const lista = Array.from({ length: n }, (_, i) => {
        m.setColorAt(i, new THREE.Color(tonos[i % tonos.length]));
        return { estado: "espera", pos: new THREE.Vector3(), vel: new THREE.Vector2(), rumbo: Math.random() * 6.28, fase: Math.random() * 6.28, tiempo: Math.random() * 6, tam: 0.8 + Math.random() * 0.5, giro: (Math.random() - 0.5) * 0.6 };
    });
    escena.add(m);
    return { m, lista };
})();

function ponerHojaCayendo(hoja, espera = 0) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.0;
    hoja.estado = espera > 0 ? "espera" : "cae";
    hoja.tiempo = espera;
    hoja.pos.set(PIE_CASTANO.x + Math.cos(a) * r, PIE_CASTANO.y + 2.6 + Math.random() * 0.8, PIE_CASTANO.z + Math.sin(a) * r);
    hoja.vel.set(-0.25 - Math.random() * 0.2, 0.25 + Math.random() * 0.2);
}

function ponerHojaFlotando(hoja) {
    for (let i = 0; i < 40; i++) {
        const x = POZA.x + (Math.random() - 0.5) * 5;
        const z = POZA.y + (Math.random() - 0.5) * 3.8;
        if (profundidadEn(x, z) < 0.1) continue;
        hoja.pos.set(x, NIVEL + 0.004, z);
        hoja.estado = "flota";
        hoja.tiempo = 20 + Math.random() * 25;
        hoja.vel.set(0, 0);
        return;
    }
    ponerHojaCayendo(hoja, 1);
}

hojas.lista.forEach((h, i) => (i < hojas.lista.length * 0.55 ? ponerHojaFlotando(h) : ponerHojaCayendo(h, Math.random() * 10)));

function moverHojas(delta, t) {
    hojas.lista.forEach((h, i) => {
        h.tiempo -= delta;
        let inclina = 0;
        let alabeo = 0;
        let visible = 1;
        if (h.estado === "espera") {
            visible = 0;
            if (h.tiempo <= 0) ponerHojaCayendo(h);
        } else if (h.estado === "cae") {
            h.fase += delta * 3.2;
            h.pos.x += (h.vel.x + Math.cos(h.fase) * 0.35) * delta;
            h.pos.z += (h.vel.y + Math.sin(h.fase * 0.8) * 0.25) * delta;
            h.pos.y -= delta * (0.35 + 0.15 * Math.sin(h.fase * 2));
            h.rumbo += delta * 1.4;
            inclina = Math.sin(h.fase) * 0.7;
            alabeo = Math.cos(h.fase * 1.3) * 0.5;
            const suelo = alturaEn(h.pos.x, h.pos.z);
            if (h.pos.y <= Math.max(suelo, NIVEL) + 0.01) {
                if (profundidadEn(h.pos.x, h.pos.z) > 0.03) {
                    h.estado = "flota";
                    h.tiempo = 20 + Math.random() * 25;
                    h.pos.y = NIVEL + 0.004;
                    h.vel.set(0, 0);
                    soltarGota(h.pos.x, h.pos.z, 0.06, 0.08);
                } else {
                    h.estado = "suelo";
                    h.tiempo = 8 + Math.random() * 10;
                    h.pos.y = suelo + 0.02;
                }
            }
        } else if (h.estado === "flota") {
            const rx = h.pos.x - POZA.x;
            const rz = h.pos.z - POZA.y;
            const r = Math.hypot(rx, rz) + 0.001;
            const remolino = 0.09 * Math.min(1, r / 0.8);
            let vx = (-rz / r) * remolino;
            let vz = (rx / r) * remolino;
            const ix = h.pos.x - cascada.impacto.x;
            const iz = h.pos.z - cascada.impacto.y;
            const di = Math.hypot(ix, iz) + 0.001;
            const empuje = 0.35 * Math.exp(-di * 2.2);
            vx += (ix / di) * empuje + h.vel.x;
            vz += (iz / di) * empuje + h.vel.y;
            h.vel.multiplyScalar(Math.exp(-delta * 1.5));
            const nx = h.pos.x + vx * delta;
            const nz = h.pos.z + vz * delta;
            if (profundidadEn(nx, nz) > 0.03) {
                h.pos.x = nx;
                h.pos.z = nz;
            } else {
                h.vel.set(-rx / r, -rz / r).multiplyScalar(0.12);
            }
            h.rumbo += delta * (h.giro + (vx * rz - vz * rx) * 0.3);
            h.pos.y = NIVEL + 0.004 + Math.sin(t * 1.7 + i) * 0.003;
            inclina = Math.sin(t * 1.3 + i * 2.0) * 0.06;
            alabeo = Math.cos(t * 1.1 + i) * 0.06;
            if (h.tiempo <= 0) {
                visible = Math.max(0, 1 + h.tiempo);
                h.pos.y -= (1 - visible) * 0.08;
                if (visible <= 0) ponerHojaCayendo(h, 2 + Math.random() * 8);
            }
        } else if (h.estado === "suelo") {
            if (h.tiempo <= 0) {
                visible = Math.max(0, 1 + h.tiempo);
                if (visible <= 0) ponerHojaCayendo(h, 2 + Math.random() * 8);
            }
        }
        auxEuler.set(inclina, h.rumbo, alabeo, "YXZ");
        auxQ.setFromEuler(auxEuler);
        auxM.compose(h.pos, auxQ, auxE.setScalar(h.tam * visible + 0.0001));
        hojas.m.setMatrixAt(i, auxM);
    });
    hojas.m.instanceMatrix.needsUpdate = true;
}

function empujarHojas(x, z, radio, fuerza) {
    hojas.lista.forEach((h) => {
        if (h.estado !== "flota") return;
        const dx = h.pos.x - x;
        const dz = h.pos.z - z;
        const d = Math.hypot(dx, dz);
        if (d > radio || d < 0.001) return;
        h.vel.x += (dx / d) * fuerza * (1 - d / radio);
        h.vel.y += (dz / d) * fuerza * (1 - d / radio);
    });
}


// =====================================================================
// 17. LUCIÉRNAGAS
// Solo de noche: puntitos que se encienden y se apagan dando vueltas
// por encima de la poza y de la hierba.
// =====================================================================

function texturaPunto() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 64;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    d.addColorStop(0, "rgba(255, 255, 255, 1)");
    d.addColorStop(0.2, "rgba(255, 255, 255, 0.7)");
    d.addColorStop(0.5, "rgba(255, 255, 255, 0.12)");
    d.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(lienzo);
}

const luciernagas = (() => {
    const n = ajustes.luciernagas;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const brillo = new Float32Array(n);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aBrillo", new THREE.BufferAttribute(brillo, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { tPunto: { value: texturaPunto() }, uOpacidad: { value: 0 }, uEscala: { value: 1 } },
        vertexShader: `
            attribute float aBrillo;
            uniform float uEscala;
            varying float vBrillo;
            void main() {
                vBrillo = aBrillo;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = (20.0 + 44.0 * aBrillo) * uEscala / -mv.z * 10.0;
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform sampler2D tPunto;
            uniform float uOpacidad;
            varying float vBrillo;
            void main() {
                float a = texture2D(tPunto, gl_PointCoord).a * vBrillo * uOpacidad;
                gl_FragColor = vec4(vec3(1.0, 0.92, 0.45) * a * 2.2 + vec3(0.6, 1.0, 0.3) * a * 0.6, a);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const puntos = new THREE.Points(geo, material);
    puntos.renderOrder = 8;
    puntos.frustumCulled = false;
    escena.add(puntos);
    const bichos = Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 3.6;
        return { cx: Math.cos(a) * r, cz: Math.sin(a) * r, alto: 0.3 + Math.random() * 1.3, fase: Math.random() * 100, ritmo: 0.6 + Math.random() * 1.2, vuelo: 0.2 + Math.random() * 0.4 };
    });
    return { puntos, pos, brillo, bichos };
})();

function moverLuciernagas(t) {
    if (luciernagas.puntos.material.uniforms.uOpacidad.value <= 0.001) return;
    luciernagas.bichos.forEach((b, i) => {
        const x = b.cx + Math.sin(t * 0.21 * b.ritmo + b.fase) * 0.9 + Math.sin(t * 0.53 + b.fase * 2) * 0.25;
        const z = b.cz + Math.cos(t * 0.17 * b.ritmo + b.fase * 1.3) * 0.9;
        const suelo = Math.max(alturaEn(x, z), NIVEL);
        luciernagas.pos.set([x, suelo + b.alto + Math.sin(t * 0.9 + b.fase) * b.vuelo, z], i * 3);
        const ciclo = (t * 0.35 * b.ritmo + b.fase) % 3;
        luciernagas.brillo[i] = ciclo < 1 ? Math.sin(ciclo * Math.PI) : 0.05;
    });
    luciernagas.puntos.geometry.getAttribute("position").needsUpdate = true;
    luciernagas.puntos.geometry.getAttribute("aBrillo").needsUpdate = true;
}


// =====================================================================
// 18. EFECTOS: DESENFOQUE DE ESTUDIO
// Arriba y abajo de la imagen se desenfoca un poco, como en una foto
// de una maqueta.
// =====================================================================

const compositor = new EffectComposer(renderizador);
compositor.addPass(new RenderPass(escena, camara));
const enfoque = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / innerWidth, 1 / innerHeight) } },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
            float d = smoothstep(0.2, 0.5, abs(vUv.y - 0.48));
            vec4 c = texture2D(tDiffuse, vUv);
            if (d > 0.001) {
                vec4 s = vec4(0.0);
                float giro = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
                for (int i = 0; i < 12; i++) {
                    float a = float(i) * 2.399 + giro;
                    float r = sqrt(float(i) + 0.5) / 3.5;
                    s += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * uTexel * 4.0 * d);
                }
                c = mix(c, s / 12.0, d);
            }
            gl_FragColor = c;
        }
    `
});
if (ajustes.desenfoque) compositor.addPass(enfoque);
compositor.addPass(new OutputPass());


// =====================================================================
// 19. DÍA Y NOCHE
// =====================================================================

const MODOS = {
    dia: {
        fondo: 0xc9cace, sol: 0xfff3e2, fuerzaSol: 2.1, cieloArriba: 0xeef3ff, cieloAbajo: 0xb8a68c, fuerzaCielo: 0.6, entorno: 0.6,
        somero: [0.62, 0.86, 0.8], hondo: [0.1, 0.38, 0.42], cascada: [0.86, 0.95, 1.0], causticas: [1.0, 0.96, 0.82], fuerzaCausticas: 0.9,
        sombra: 0.24, contacto: 0.28, pez: 1, luciernagas: 0
    },
    noche: {
        fondo: 0x1c2232, sol: 0x9db2ff, fuerzaSol: 0.7, cieloArriba: 0x3a4a7a, cieloAbajo: 0x16120f, fuerzaCielo: 0.5, entorno: 0.14,
        somero: [0.1, 0.18, 0.22], hondo: [0.012, 0.04, 0.07], cascada: [0.32, 0.4, 0.55], causticas: [0.55, 0.65, 1.0], fuerzaCausticas: 0.25,
        sombra: 0.5, contacto: 0.6, pez: 0.3, luciernagas: 1
    }
};

const botonModo = document.getElementById("boton-modo");
let modo = parametros.get("modo") === "noche" ? "noche" : "dia";

function aplicarModo() {
    const m = MODOS[modo];
    escena.background.set(m.fondo);
    sol.color.set(m.sol);
    sol.intensity = m.fuerzaSol;
    cielo.color.set(m.cieloArriba);
    cielo.groundColor.set(m.cieloAbajo);
    cielo.intensity = m.fuerzaCielo;
    materialesConEntorno.forEach((mat) => (mat.envMapIntensity = mat.userData.entorno * m.entorno));
    usosAgua.uSomero.value.setRGB(...m.somero);
    usosAgua.uHondo.value.setRGB(...m.hondo);
    laminaCascada.material.uniforms.uColor.value.setRGB(...m.cascada);
    espuma.m.material.color.setRGB(...m.cascada);
    comunes.uCausticas.value.setRGB(...m.causticas).multiplyScalar(m.fuerzaCausticas);
    suelo.material.opacity = m.sombra;
    contacto.material.opacity = m.contacto;
    comunes.uLuzPez.value = m.pez;
    luciernagas.puntos.material.uniforms.uOpacidad.value = m.luciernagas;
    document.body.classList.toggle("oscuro", modo === "noche");
    botonModo.textContent = modo === "noche" ? "Día" : "Noche";
    botonModo.setAttribute("aria-pressed", modo === "noche");
}

botonModo.addEventListener("click", () => {
    modo = modo === "noche" ? "dia" : "noche";
    aplicarModo();
});


// =====================================================================
// 20. TOCAR
// Tocar el agua suelta una onda, asusta a las truchas y aparta las
// hojas. Tocar el castaño lo sacude y caen hojas.
// =====================================================================

const rayo = new THREE.Raycaster();
const puntero = new THREE.Vector2();
const pista = document.getElementById("pista");
const toque = { x: 0, y: 0, t: 0 };
let sacudida = 0;

function tocar(e) {
    puntero.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    const enCopa = rayo.intersectObjects(copa.children, false)[0];
    const enAgua = rayo.intersectObject(agua, false)[0];
    const enIsla = rayo.intersectObject(isla, false)[0];
    if (enAgua && enIsla && enIsla.distance < enAgua.distance - 0.02 && !enCopa) return;
    if (enCopa && (!enAgua || enCopa.distance < enAgua.distance)) {
        sacudida = 1;
        let cuantas = 0;
        hojas.lista.forEach((h) => {
            if (cuantas < 5 && (h.estado === "espera" || h.estado === "suelo")) {
                ponerHojaCayendo(h, cuantas * 0.25);
                cuantas++;
            }
        });
        return;
    }
    if (enAgua && profundidadEn(enAgua.point.x, enAgua.point.z) > 0.01) {
        soltarGota(enAgua.point.x, enAgua.point.z, 0.14, 0.55);
        asustarPeces(enAgua.point.x, enAgua.point.z, 1.6);
        empujarHojas(enAgua.point.x, enAgua.point.z, 1.2, 0.5);
    }
}

renderizador.domElement.addEventListener("pointerdown", (e) => {
    controles.autoRotate = false;
    pista.classList.add("oculta");
    Object.assign(toque, { x: e.clientX, y: e.clientY, t: performance.now() });
});

renderizador.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 8 && performance.now() - toque.t < 400) tocar(e);
});


// =====================================================================
// 21. MOVIMIENTO
// =====================================================================

const reloj = new THREE.Clock();
let listo = false;
let goteo = 0;

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 42 : 30;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
    enfoque.uniforms.uTexel.value.set(1 / innerWidth, 1 / innerHeight);
    const escalaPunto = renderizador.getPixelRatio() * innerHeight / 900;
    luciernagas.puntos.material.uniforms.uEscala.value = escalaPunto;
}

window.addEventListener("resize", ajustarTamano);

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (comunes.uTiempo.value += delta);
    controles.update();
    goteo -= delta;
    if (goteo <= 0) {
        goteo = 0.07 + Math.random() * 0.08;
        soltarGota(cascada.impacto.x + (Math.random() - 0.5) * 0.25, cascada.impacto.y + (Math.random() - 0.5) * 0.25, 0.06, 0.05 + Math.random() * 0.05);
    }
    simularOndas(delta);
    usosAgua.tOndas.value = ondas[0].texture;
    sacudida *= Math.exp(-delta * 2.5);
    copa.rotation.z = Math.sin(t * 0.7) * 0.012 + Math.sin(t * 9) * sacudida * 0.03;
    copa.rotation.x = Math.sin(t * 0.55 + 1) * 0.01 + Math.cos(t * 8) * sacudida * 0.02;
    moverEspuma(delta);
    moverPeces(delta);
    moverHojas(delta, t);
    moverLuciernagas(t);
    compositor.render();
}

requestAnimationFrame(() => {
    ajustarTamano();
    aplicarModo();
    const lejos = camara.aspect < 1 ? 34 : 21;
    camara.position.setFromSphericalCoords(lejos, 0.92, 0.38).add(controles.target);
    controles.update();
    if (hayOndas) {
        ondas.forEach((o) => {
            renderizador.setRenderTarget(o);
            renderizador.clear();
        });
        renderizador.setRenderTarget(null);
    }
    renderizador.shadowMap.needsUpdate = true;
    renderizador.compile(escena, camara);
    moverEspuma(0);
    moverPeces(0.016);
    moverHojas(0, 0);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 7000);
    reloj.getDelta();
    animar();
});
