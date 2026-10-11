import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// =====================================================================
// 1. AJUSTES
// Un estanque con una casa japonesa, todo hecho de cubos como en
// Minecraft. Cada bloque se genera con código; luego solo se dibujan las
// caras que tocan el aire, con sombra en las esquinas. El agua refleja
// la escena y los peces koi nadan por debajo.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.25,
    sombra: movil ? 1024 : 2048,
    reflejo: movil ? 0.4 : 0.5,
    peces: 7,
    nenufares: movil ? 22 : 30,
    flores: movil ? 260 : 420
};
const AGUA = 1.8;

let semilla = 21;
const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return (semilla - 1) / 2147483646;
};

function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

function ruido2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x, y, octavas = 4) {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < octavas; i++) {
        s += a * ruido2(x * f, y * f);
        f *= 2;
        a *= 0.5;
    }
    return s;
}

const color = (c) => new THREE.Color(c);


// =====================================================================
// 2. LOS BLOQUES
// Cada tipo tiene su color (y a veces otro para la cara de arriba).
// "hoja" se mece con el viento y "luz" brilla de noche.
// =====================================================================

const B = {
    hierba: { c: [color("#5f7d3a"), color("#587538")], arriba: [color("#6fa84a"), color("#79b052"), color("#649d43"), color("#83b85a")] },
    tierra: { c: color("#7a5a3e") },
    piedra: { c: [color("#8c8c8c"), color("#7f7f7f"), color("#959595")] },
    piedraMusgo: { c: [color("#6f7d5a"), color("#7d8a66"), color("#8a8a86")] },
    arena: { c: [color("#d9cf9f"), color("#cfc492")] },
    grava: { c: [color("#8d8781"), color("#9a948e"), color("#7e7974")] },
    arcilla: { c: [color("#8f99a3"), color("#9ca5ae")] },
    maderaOscura: { c: color("#4a3222") },
    tablones: { c: [color("#b08452"), color("#a67b4a")] },
    yeso: { c: [color("#ece5d8"), color("#e4dccd")] },
    teja: { c: [color("#3b3f47"), color("#43474f"), color("#363a41")] },
    tejaBorde: { c: color("#2b2d33") },
    tronco: { c: color("#5c4331"), arriba: color("#8a6a48") },
    ladrillo: { c: [color("#8e5a45"), color("#9a644d")] },
    losa: { c: [color("#a9a49b"), color("#b4afa6")] },
    hojaRoble: { c: [color("#3f7a2e"), color("#4a8735"), color("#376d28"), color("#56923d")], hoja: true },
    hojaCerezo: { c: [color("#f1a7c4"), color("#f6bad2"), color("#e894b5"), color("#fbcde0")], hoja: true },
    hojaAbeto: { c: [color("#2c5a3a"), color("#335f40"), color("#274f33")], hoja: true },
    hojaBambu: { c: [color("#6dbb3d"), color("#7fcb45"), color("#5ea835")], hoja: true },
    bambu: { c: [color("#8fcf4a"), color("#82c241")], hoja: true },
    enredadera: { c: [color("#3d7a2a"), color("#4b8c33")], hoja: true },
    ventana: { c: color("#ffd28a"), luz: true },
    farol: { c: color("#ffcf7a"), luz: true },
    nieve: { c: color("#f2f4f6") }
};


// =====================================================================
// 3. MOTOR DE CUBOS
// =====================================================================

const OSCURECER = [0.5, 0.68, 0.84, 1];

class Cubos {
    constructor(tam = 1) {
        this.tam = tam;
        this.mapa = new Map();
    }

    clave(x, y, z) {
        return ((x + 2048) * 1024 + (y + 512)) * 4096 + (z + 2048);
    }

    poner(x, y, z, bloque, vaiven = null) {
        this.mapa.set(this.clave(x, y, z), { x, y, z, b: bloque, v: vaiven });
    }

    quitar(x, y, z) {
        this.mapa.delete(this.clave(x, y, z));
    }

    hay(x, y, z) {
        return this.mapa.has(this.clave(x, y, z));
    }

    que(x, y, z) {
        const v = this.mapa.get(this.clave(x, y, z));
        return v ? v.b : null;
    }

    caja(x0, y0, z0, x1, y1, z1, bloque) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
            for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
                for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.poner(x, y, z, bloque);
    }

    mallas() {
        const grupos = { solida: nuevaMalla(), hojas: nuevaMalla(), luces: nuevaMalla() };
        const t = this.tam;
        const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        const esquinas = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        this.mapa.forEach((v) => {
            const b = v.b;
            const g = b.luz ? grupos.luces : b.hoja ? grupos.hojas : grupos.solida;
            const h = hash2(v.x * 0.37 + v.z * 1.13, v.y * 0.71 + v.z * 0.17);
            const variar = b.luz ? 1 : 0.94 + h * 0.12;
            const base = Array.isArray(b.c) ? b.c[Math.floor(h * b.c.length)] : b.c;
            dirs.forEach((n) => {
                const vecino = this.que(v.x + n[0], v.y + n[1], v.z + n[2]);
                if (vecino && !(b.hoja && !vecino.hoja && false) && !(vecino.luz && !b.luz)) return;
                const u = n[0] !== 0 ? [0, 1, 0] : [1, 0, 0];
                const w = n[2] !== 0 ? [0, 1, 0] : [0, 0, 1];
                const centro = [v.x + 0.5 + n[0] * 0.5, v.y + 0.5 + n[1] * 0.5, v.z + 0.5 + n[2] * 0.5];
                let sombras = esquinas.map(([su, sw]) => {
                    if (b.luz) return 1;
                    const a = this.hay(v.x + n[0] + u[0] * su, v.y + n[1] + u[1] * su, v.z + n[2] + u[2] * su) ? 1 : 0;
                    const c = this.hay(v.x + n[0] + w[0] * sw, v.y + n[1] + w[1] * sw, v.z + n[2] + w[2] * sw) ? 1 : 0;
                    const d = this.hay(v.x + n[0] + u[0] * su + w[0] * sw, v.y + n[1] + u[1] * su + w[1] * sw, v.z + n[2] + u[2] * su + w[2] * sw) ? 1 : 0;
                    return OSCURECER[a && c ? 0 : 3 - (a + c + d)];
                });
                let puntos = esquinas.map(([su, sw]) => [
                    (centro[0] + (u[0] * su + w[0] * sw) * 0.5) * t,
                    (centro[1] + (u[1] * su + w[1] * sw) * 0.5) * t,
                    (centro[2] + (u[2] * su + w[2] * sw) * 0.5) * t
                ]);
                const e1 = puntos[1].map((p, i) => p - puntos[0][i]);
                const e2 = puntos[2].map((p, i) => p - puntos[0][i]);
                const cruz = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
                if (cruz[0] * n[0] + cruz[1] * n[1] + cruz[2] * n[2] < 0) {
                    puntos = [puntos[0], puntos[3], puntos[2], puntos[1]];
                    sombras = [sombras[0], sombras[3], sombras[2], sombras[1]];
                }
                let col = base;
                if (n[1] === 1 && b.arriba) col = Array.isArray(b.arriba) ? b.arriba[Math.floor(h * b.arriba.length)] : b.arriba;
                const lado = n[1] === 0 ? (n[0] !== 0 ? 0.86 : 0.93) : n[1] < 0 ? 0.7 : 1;
                const vaiven = v.v ?? (b.hoja ? 1 : 0);
                cara(g, puntos, n, col, sombras, variar * (b.luz ? 1 : lado), vaiven);
            });
        });
        return {
            solida: geometria(grupos.solida),
            hojas: geometria(grupos.hojas),
            luces: geometria(grupos.luces)
        };
    }
}

function nuevaMalla() {
    return { p: [], n: [], c: [], v: [], i: [] };
}

function cara(m, puntos, n, col, sombras, factor, vaiven) {
    const base = m.p.length / 3;
    for (let k = 0; k < 4; k++) {
        m.p.push(...puntos[k]);
        m.n.push(...n);
        const s = sombras[k] * factor;
        m.c.push(col.r * s, col.g * s, col.b * s);
        m.v.push(vaiven);
    }
    if (sombras[0] + sombras[2] > sombras[1] + sombras[3]) m.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else m.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
}

function geometria(m) {
    if (!m.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(m.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(m.c, 3));
    g.setAttribute("aVaiven", new THREE.Float32BufferAttribute(m.v, 1));
    g.setIndex(m.i.length > 65535 * 3 ? new THREE.Uint32BufferAttribute(m.i, 1) : m.i);
    return g;
}


// =====================================================================
// 4. RENDERIZADOR, ESCENA, CÁMARA Y LUCES
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: !movil, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.05;
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
renderizador.shadowMap.autoUpdate = false;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
escena.fog = new THREE.Fog(0xb8d4ea, 60, 260);

const camara = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 1200);
camara.position.set(20, 7.2, 20.5);
const controles = new OrbitControls(camara, renderizador.domElement);
controles.target.set(-3, 5, -14);
controles.enableDamping = true;
controles.dampingFactor = 0.06;
controles.enablePan = false;
controles.minDistance = 8;
controles.maxDistance = 75;
controles.minPolarAngle = Math.PI * 0.18;
controles.maxPolarAngle = Math.PI * 0.49;
controles.rotateSpeed = 0.5;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.25;

const sol = new THREE.DirectionalLight(0xffffff, 2.6);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
Object.assign(sol.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 220 });
sol.shadow.bias = -0.0006;
sol.shadow.normalBias = 0.04;
escena.add(sol, sol.target);
const cielo = new THREE.HemisphereLight(0xbcd8ff, 0x5a4a38, 1.1);
escena.add(cielo);

const comunes = {
    uTiempo: { value: 0 },
    uNoche: { value: 0 },
    uSol: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uColorSol: { value: new THREE.Color(1, 1, 1) }
};


// =====================================================================
// 5. MATERIALES
// Todos los bloques llevan una textura de 16 × 16 "píxeles" calculada en
// el shader a partir de la posición, como las texturas de Minecraft.
// Las hojas, el bambú y las enredaderas se mecen.
// =====================================================================

function materialBloques(tam, opciones = {}) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTiempo = comunes.uTiempo;
        shader.uniforms.uNoche = comunes.uNoche;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float aVaiven;\nuniform float uTiempo;\nvarying vec3 vMundoB;\nvarying vec3 vNormalB;")
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                vec3 pm = (modelMatrix * vec4(position, 1.0)).xyz;
                float onda = sin(uTiempo * 1.6 + pm.x * 0.45 + pm.z * 0.3) + sin(uTiempo * 2.7 + pm.z * 0.8 + pm.y * 0.5) * 0.5;
                transformed.x += onda * 0.06 * aVaiven;
                transformed.z += cos(uTiempo * 1.3 + pm.x * 0.6 + pm.y * 0.4) * 0.05 * aVaiven;
                transformed.y += sin(uTiempo * 2.1 + pm.x + pm.z) * 0.015 * aVaiven;
                vMundoB = pm;
                vNormalB = normal;`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vMundoB;\nvarying vec3 vNormalB;\nuniform float uNoche;\nfloat hashB(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }")
            .replace(
                "#include <color_fragment>",
                `#include <color_fragment>
                vec3 celda = floor((vMundoB - vNormalB * 0.01) * ${(16 / tam).toFixed(2)});
                float px = hashB(celda);
                diffuseColor.rgb *= ${opciones.contraste ?? "0.88"} + px * ${opciones.rango ?? "0.24"};`
            );
        if (opciones.luz) {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                "#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * (0.45 + uNoche * 1.1);"
            );
        }
    };
    material.customProgramCacheKey = () => "bloques" + tam + JSON.stringify(opciones);
    return material;
}

const materiales = {
    solida: materialBloques(1),
    hojas: materialBloques(1, { contraste: "0.72", rango: "0.5" }),
    luces: materialBloques(1, { luz: true, contraste: "0.85", rango: "0.3" }),
    finaSolida: materialBloques(0.25),
    finaHojas: materialBloques(0.25, { contraste: "0.75", rango: "0.45" }),
    finaLuces: materialBloques(0.25, { luz: true }),
    lejosSolida: materialBloques(3, { contraste: "0.9", rango: "0.2" }),
    lejosHojas: materialBloques(3, { contraste: "0.8", rango: "0.35" })
};

function añadir(cubos, prefijo, sombra = true) {
    const m = cubos.mallas();
    const lista = [];
    ["solida", "hojas", "luces"].forEach((tipo) => {
        if (!m[tipo]) return;
        const malla = new THREE.Mesh(m[tipo], materiales[prefijo + tipo[0].toUpperCase() + tipo.slice(1)] || materiales[tipo]);
        malla.castShadow = sombra && tipo !== "luces";
        malla.receiveShadow = true;
        escena.add(malla);
        lista.push(malla);
    });
    return lista;
}


// =====================================================================
// 6. EL TERRENO
// El estanque en el centro, la orilla con hierba y montes alrededor.
// =====================================================================

function estanque(x, z) {
    const dx = (x + 1) / 22;
    const dz = (z - 3) / 12.5;
    return dx * dx + dz * dz + (ruido2(x * 0.13, z * 0.13) - 0.5) * 0.45;
}

function alturaSuelo(x, z) {
    let h = 2;
    const e = estanque(x, z);
    if (e < 1) h = 2 - Math.min(3, Math.ceil((1 - e) * 6));
    const lados = Math.max(0, Math.abs(x + 2) - 33) * 0.75;
    const fondo = Math.max(0, -z - 33) * 0.9;
    const frente = Math.max(0, z - 38) * 0.6;
    let colina = lados + fondo + frente;
    colina += (fbm2(x * 0.07 + 3, z * 0.07) - 0.45) * 7 * Math.min(1, colina / 3);
    return h + Math.max(0, Math.round(colina));
}

const LADO = 46;
const mundo = new Cubos(1);
const alturas = new Map();
const alturaEn = (x, z) => alturas.get(x * 1000 + z) ?? alturaSuelo(x, z);

function crearTerreno() {
    for (let x = -LADO; x < LADO; x++) {
        for (let z = -LADO; z < LADO; z++) alturas.set(x * 1000 + z, alturaSuelo(x, z));
    }
    for (let x = -LADO; x < LADO; x++) {
        for (let z = -LADO; z < LADO; z++) {
            const h = alturaEn(x, z);
            let minimo = h;
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => (minimo = Math.min(minimo, alturaEn(x + a, z + b))));
            const desde = Math.max(-5, Math.min(h - 1, minimo - 1));
            const agua = h <= 1;
            for (let y = desde; y < h; y++) {
                let b = B.tierra;
                const arriba = y === h - 1;
                if (agua) b = arriba ? (ruido2(x * 0.3, z * 0.3) > 0.55 ? B.grava : ruido2(x * 0.2 + 9, z * 0.2) > 0.6 ? B.arcilla : B.arena) : B.tierra;
                else if (arriba) b = h > 7 && ruido2(x * 0.2, z * 0.2) > 0.6 ? B.piedraMusgo : B.hierba;
                else if (h - y > 3) b = B.piedra;
                if (!agua && h === 2 && arriba && estanque(x, z) < 1.12) b = ruido2(x * 0.5, z * 0.5) > 0.5 ? B.arena : B.hierba;
                mundo.poner(x, y, z, b);
            }
        }
    }
    for (let i = 0; i < 26; i++) {
        const a = azar() * Math.PI * 2;
        const x = Math.round(-1 + Math.cos(a) * 22 * (0.95 + azar() * 0.1));
        const z = Math.round(3 + Math.sin(a) * 12.5 * (0.95 + azar() * 0.1));
        if (x > 12 && z > 10) continue;
        const h = alturaEn(x, z);
        mundo.poner(x, h, z, azar() < 0.5 ? B.piedraMusgo : B.piedra);
        if (azar() < 0.4) mundo.poner(x + 1, h, z, B.piedra);
        if (azar() < 0.5) for (let k = 0; k < 4; k++) if (!mundo.hay(x + k - 1, h, z + 1)) mundo.poner(x + k - 1, h, z + 1, B.hojaRoble, 0.3);
    }
}


// =====================================================================
// 7. LA CASA JAPONESA
// Zócalo de piedra, pilares de madera oscura, paredes de yeso, ventanas
// de papel que se encienden de noche y tejados de teja con las esquinas
// levantadas.
// =====================================================================

const chimeneas = [];
const luces = [];

function paredes(x0, z0, x1, z1, y0, alto, puerta) {
    for (let y = y0; y < y0 + alto; y++) {
        for (let x = x0; x <= x1; x++) {
            for (let z = z0; z <= z1; z++) {
                const borde = x === x0 || x === x1 || z === z0 || z === z1;
                if (!borde) continue;
                const esquina = (x === x0 || x === x1) && (z === z0 || z === z1);
                const alongX = z === z0 || z === z1;
                const k = alongX ? x - x0 : z - z0;
                const largo = alongX ? x1 - x0 : z1 - z0;
                let b = B.yeso;
                if (esquina || k % 4 === 0 || k === largo) b = B.maderaOscura;
                else if (y === y0 || y === y0 + alto - 1) b = B.maderaOscura;
                else if (y >= y0 + 1 && y <= y0 + alto - 2 && (k % 4 === 1 || k % 4 === 2 || k % 4 === 3) && y !== y0 + alto - 2) b = (k + y) % 3 === 0 ? B.maderaOscura : B.ventana;
                if (puerta && z === z1 && Math.abs(x - puerta) <= 1 && y < y0 + alto - 1) b = y === y0 ? B.maderaOscura : B.ventana;
                mundo.poner(x, y, z, b);
            }
        }
    }
}

function tejado(x0, z0, x1, z1, y, niveles = 99) {
    for (let i = 0; i < niveles; i++) {
        const a0 = x0 + i;
        const a1 = x1 - i;
        const b0 = z0 + i;
        const b1 = z1 - i;
        if (a0 > a1 || b0 > b1) break;
        const natural = a0 + 1 >= a1 || b0 + 1 >= b1;
        const ultimo = natural || i === niveles - 1;
        for (let x = a0; x <= a1; x++) {
            for (let z = b0; z <= b1; z++) {
                const borde = x === a0 || x === a1 || z === b0 || z === b1;
                if (!borde && !ultimo) continue;
                mundo.poner(x, y + i, z, i === 0 ? B.tejaBorde : B.teja);
            }
        }
        if (i === 0) {
            [[a0, b0], [a1, b0], [a0, b1], [a1, b1]].forEach(([x, z]) => mundo.poner(x, y + 1, z, B.tejaBorde));
        }
        if (ultimo && !natural) break;
        if (ultimo) {
            const largoX = a1 - a0 >= b1 - b0;
            for (let x = a0; x <= a1; x++) for (let z = b0; z <= b1; z++) if ((largoX && z === Math.round((b0 + b1) / 2)) || (!largoX && x === Math.round((a0 + a1) / 2))) mundo.poner(x, y + i + 1, z, B.tejaBorde);
            [[a0, Math.round((b0 + b1) / 2)], [a1, Math.round((b0 + b1) / 2)]].forEach(([x, z]) => largoX && mundo.poner(x, y + i + 2, z, B.tejaBorde));
            break;
        }
    }
}

function casa(x0, z0, x1, z1, opciones = {}) {
    const y0 = 2;
    mundo.caja(x0 - 1, y0, z0 - 1, x1 + 1, y0, z1 + 1, B.piedra);
    mundo.caja(x0 - 1, y0, z1 + 1, x1 + 1, y0, z1 + 2, B.tablones);
    for (let x = x0 - 1; x <= x1 + 1; x += 4) mundo.caja(x, y0 + 1, z1 + 2, x, y0 + 5, z1 + 2, B.maderaOscura);
    mundo.caja(x1 + 1, y0 + 1, z1 + 2, x1 + 1, y0 + 5, z1 + 2, B.maderaOscura);
    for (let y = y0 - 1; y >= y0 - 4; y--) {
        for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 2; z++) if (!mundo.hay(x, y, z)) mundo.poner(x, y, z, B.piedra);
    }
    paredes(x0, z0, x1, z1, y0 + 1, 5, opciones.puerta);
    for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) mundo.poner(x, y0 + 5, z, B.maderaOscura);
    if (opciones.segundo) {
        const [a0, b0, a1, b1] = opciones.segundo;
        tejado(x0 - 2, z0 - 2, x1 + 2, z1 + 3, y0 + 6, 3);
        paredes(a0, b0, a1, b1, y0 + 8, 4);
        tejado(a0 - 2, b0 - 2, a1 + 2, b1 + 2, y0 + 12);
    } else {
        tejado(x0 - 2, z0 - 2, x1 + 2, z1 + 3, y0 + 6);
    }
    if (opciones.chimenea) {
        const [cx, cz, alto] = opciones.chimenea;
        for (let y = y0 + 6; y <= alto; y++) mundo.poner(cx, y, cz, B.ladrillo);
        chimeneas.push(new THREE.Vector3(cx + 0.5, alto + 1.2, cz + 0.5));
    }
}

function farolDePiedra(x, z) {
    const y = alturaEn(x, z);
    mundo.poner(x, y, z, B.piedra);
    mundo.poner(x, y + 1, z, B.losa);
    mundo.poner(x, y + 2, z, B.farol);
    mundo.caja(x - 1, y + 3, z - 1, x + 1, y + 3, z + 1, B.losa);
    mundo.poner(x, y + 4, z, B.losa);
    luces.push(new THREE.Vector3(x + 0.5, y + 2.5, z + 0.5));
}

function farolDeMadera(x, z) {
    const y = alturaEn(x, z);
    mundo.caja(x, y, z, x, y + 2, z, B.maderaOscura);
    mundo.poner(x, y + 3, z, B.farol);
    mundo.poner(x, y + 4, z, B.maderaOscura);
    luces.push(new THREE.Vector3(x + 0.5, y + 3.5, z + 0.5));
}

function crearCasas() {
    casa(-18, -30, 4, -20, { puerta: -7, segundo: [-15, -29, 0, -22], chimenea: [-4, -27, 23] });
    casa(11, -28, 23, -20, { puerta: 17, chimenea: [20, -26, 17] });
    for (let x = -10; x <= -4; x++) for (let z = -17; z <= -9; z++) mundo.poner(x, 2, z, B.tablones);
    [[-10, -9], [-4, -9], [-10, -12], [-4, -12]].forEach(([x, z]) => mundo.caja(x, -1, z, x, 1, z, B.maderaOscura));
    for (let z = -17; z <= -9; z++) mundo.poner(-7, 2, z, B.maderaOscura);
    for (let x = -20; x <= 26; x++) {
        if (alturaEn(x, -16) === 2 && !mundo.hay(x, 2, -16)) mundo.poner(x, 1, -16, B.losa);
    }
    farolDePiedra(-14, -14);
    farolDePiedra(4, -14);
    farolDeMadera(-23, 0);
    farolDeMadera(18, -10);
    farolDeMadera(-16, 15);
}


// =====================================================================
// 8. EL PORCHE DE DELANTE
// Tarima sobre el agua con barandilla y una pérgola con enredaderas.
// =====================================================================

const fino = new Cubos(0.25);

function crearPorche() {
    const x0 = 13;
    const x1 = 25;
    const z0 = 12;
    const z1 = 24;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) mundo.poner(x, 2, z, B.tablones);
    [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [x0, 18], [x1, 18]].forEach(([x, z]) => mundo.caja(x, -1, z, x, 1, z, B.maderaOscura));
    const barandilla = (fx, fz) => {
        for (let y = 12; y <= 16; y++) fino.poner(fx, y, fz, B.maderaOscura);
    };
    for (let x = x0 * 4; x <= x1 * 4 + 3; x++) {
        if (x % 6 === 0) barandilla(x, z0 * 4);
        fino.poner(x, 16, z0 * 4, B.maderaOscura);
        fino.poner(x, 14, z0 * 4, B.maderaOscura);
    }
    for (let z = z0 * 4; z <= z1 * 4 + 3; z++) {
        if (z % 6 === 0) barandilla(x0 * 4, z);
        fino.poner(x0 * 4, 16, z, B.maderaOscura);
        fino.poner(x0 * 4, 14, z, B.maderaOscura);
    }
    farolDeMadera(x1 - 1, z0 + 1);
}


// =====================================================================
// 9. ÁRBOLES, BAMBÚ Y MONTAÑAS LEJANAS
// =====================================================================

function copa(c, cx, cy, cz, rx, ry, rz, bloque, densidad = 1) {
    for (let x = -rx; x <= rx; x++)
        for (let y = -ry; y <= ry; y++)
            for (let z = -rz; z <= rz; z++) {
                const d = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz);
                if (d > 1 + (azar() - 0.5) * 0.35) continue;
                if (d > 0.6 && azar() > densidad) continue;
                if (!c.hay(cx + x, cy + y, cz + z)) c.poner(cx + x, cy + y, cz + z, bloque);
            }
}

function roble(x, z, alto = 5 + Math.floor(azar() * 3)) {
    const y = alturaEn(x, z);
    mundo.caja(x, y, z, x, y + alto, z, B.tronco);
    copa(mundo, x, y + alto, z, 3, 2, 3, B.hojaRoble, 0.85);
    copa(mundo, x + 1, y + alto + 2, z - 1, 2, 1, 2, B.hojaRoble, 0.8);
}

const petalosOrigen = [];

function cerezo(x, z) {
    const y = alturaEn(x, z);
    let cx = x;
    let cz = z;
    for (let i = 0; i < 6; i++) {
        mundo.poner(cx, y + i, cz, B.tronco);
        if (i === 3) cx += 1;
        if (i === 4) cz -= 1;
    }
    mundo.caja(cx - 2, y + 5, cz, cx + 2, y + 5, cz, B.tronco);
    copa(mundo, cx, y + 7, cz, 5, 2, 4, B.hojaCerezo, 0.9);
    copa(mundo, cx - 3, y + 6, cz + 2, 3, 2, 3, B.hojaCerezo, 0.85);
    copa(mundo, cx + 3, y + 7, cz - 2, 3, 2, 3, B.hojaCerezo, 0.85);
    petalosOrigen.push(new THREE.Vector3(cx, y + 7, cz));
}

function abeto(c, x, y, z, alto) {
    c.caja(x, y, z, x, y + alto, z, B.tronco);
    for (let i = 2; i <= alto + 1; i++) {
        const r = Math.max(0, Math.round((alto + 1 - i) * 0.45 + (i % 2) * 0.6));
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (Math.abs(a) + Math.abs(b) <= r + 0.5 && !c.hay(x + a, y + i, z + b)) c.poner(x + a, y + i, z + b, B.hojaAbeto);
    }
    c.poner(x, y + alto + 2, z, B.hojaAbeto);
}

function bambu(x, z, alto) {
    const base = alturaEn(Math.floor(x / 4), Math.floor(z / 4)) * 4;
    for (let y = 0; y < alto; y++) fino.poner(x, base + y, z, y % 7 === 0 ? B.hojaBambu : B.bambu, Math.pow(y / alto, 1.5) * 1.6);
    for (let k = 0; k < 4; k++) {
        const y = base + alto - 2 - Math.floor(azar() * alto * 0.4);
        const dx = azar() < 0.5 ? 1 : -1;
        const dz = azar() < 0.5 ? 1 : -1;
        for (let l = 1; l <= 3; l++) fino.poner(x + dx * l, y + (l === 3 ? 1 : 0), z + (azar() < 0.5 ? 0 : dz * l), B.hojaBambu, 1.6);
    }
}

function crearVegetacion() {
    [[-27, -18], [-33, -6], [30, -14], [32, 2], [-30, 16], [8, -33], [-24, -32], [28, -32], [-36, -26], [36, 20]].forEach(([x, z]) => roble(x, z));
    cerezo(-28, 6);
    cerezo(27, -6);
    for (let i = 0; i < 90; i++) {
        const x = Math.floor(-LADO + 2 + azar() * (LADO * 2 - 4));
        const z = Math.floor(-LADO + 2 + azar() * (LADO * 2 - 4));
        const h = alturaEn(x, z);
        if (h < 4) continue;
        if (z < -30 && x > -14 && x < 22 && azar() < 0.75) continue;
        abeto(mundo, x, h, z, 6 + Math.floor(azar() * 6));
    }
    for (let i = 0; i < (movil ? 22 : 34); i++) {
        const zona = i % 3;
        const x = zona === 0 ? -60 + Math.floor(azar() * 20) : zona === 1 ? 22 + Math.floor(azar() * 16) : 52 + Math.floor(azar() * 14);
        const z = -70 + Math.floor(azar() * 12);
        bambu(x, z, 18 + Math.floor(azar() * 14));
    }
}

const lejos = new Cubos(3);

function crearMontanas() {
    const r0 = LADO / 3;
    for (let x = -60; x <= 60; x++) {
        for (let z = -60; z <= 60; z++) {
            if (Math.abs(x) < r0 && Math.abs(z) < r0) continue;
            const wx = x * 3;
            const wz = z * 3;
            const d = Math.max(Math.abs(wx + 4), Math.abs(wz));
            let h = 4 + (d - 40) * 0.35 + fbm2(wx * 0.012, wz * 0.012) * 26 * Math.min(1, (d - 40) / 40);
            h += Math.max(0, -wz - 70) * 0.45 * (0.6 + 0.4 * fbm2(wx * 0.02, 3));
            const pico = Math.exp(-(((wx - 6) / 45) ** 2) - (((wz + 130) / 35) ** 2)) * 75;
            h += pico;
            const alto = Math.max(1, Math.round(h / 3));
            for (let y = Math.max(0, alto - 3); y < alto; y++) {
                const top = y === alto - 1;
                let b = top ? B.hierba : B.piedra;
                if (top && alto > 22) b = B.nieve;
                else if (top && alto > 15) b = B.piedra;
                lejos.poner(x, y, z, b);
            }
            if (alto < 13 && hash2(x * 1.7, z * 2.3) > 0.8) abeto(lejos, x, alto, z, 2 + Math.floor(hash2(x, z) * 2));
        }
    }
}


// =====================================================================
// 10. FLORES Y HIERBA ALTA
// Planos cruzados con texturas de 16 × 16 píxeles dibujadas a mano.
// =====================================================================

function atlasFlores() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 16 * 6;
    lienzo.height = 16;
    const g = lienzo.getContext("2d");
    const px = (i, x, y, c) => {
        g.fillStyle = c;
        g.fillRect(i * 16 + x, y, 1, 1);
    };
    for (let i = 0; i < 6; i++) {
        if (i === 0) {
            for (let k = 0; k < 9; k++) {
                const x = 1 + Math.floor(azar() * 14);
                const alto = 5 + Math.floor(azar() * 10);
                for (let y = 15; y > 15 - alto; y--) px(0, x + (y < 8 && k % 2 ? 1 : 0), y, ["#5e9c3a", "#6fae45", "#4f8a30"][(x + y) % 3]);
            }
            continue;
        }
        for (let y = 7; y < 16; y++) px(i, 7 + (y > 12 ? 1 : 0), y, "#4f8a30");
        px(i, 6, 11, "#4f8a30");
        px(i, 5, 10, "#4f8a30");
        px(i, 9, 12, "#4f8a30");
        px(i, 10, 11, "#4f8a30");
        const c = ["", "#e0402f", "#f5d533", "#5a7ff0", "#b768e8", "#f4f2ec"][i];
        const centro = ["", "#2a1a10", "#f09a20", "#f0e070", "#f0d0ff", "#f0c030"][i];
        [[7, 3], [6, 4], [8, 4], [7, 5], [6, 5], [8, 5], [7, 6], [5, 5], [9, 5]].forEach(([x, y], k) => px(i, x, y, k === 4 || k === 2 ? c : c));
        px(i, 7, 5, centro);
    }
    const t = new THREE.CanvasTexture(lienzo);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function crearFlores() {
    const datos = [];
    for (let i = 0, puestas = 0; i < ajustes.flores * 8 && puestas < ajustes.flores; i++) {
        const x = -40 + azar() * 80;
        const z = -40 + azar() * 80;
        const ix = Math.floor(x);
        const iz = Math.floor(z);
        const h = alturaEn(ix, iz);
        if (h !== 2 || mundo.hay(ix, 2, iz) || estanque(ix, iz) < 1.05) continue;
        const cerca = estanque(ix, iz) < 1.6 || (z > -14 && z < -11);
        if (!cerca && azar() < 0.65) continue;
        const tipo = azar() < 0.55 ? 0 : 1 + Math.floor(azar() * 5);
        datos.push(ix + 0.5, h, iz + 0.5, tipo + azar() * 0.9 * (tipo === 0 ? 1 : 0));
        puestas++;
    }
    const plano = new THREE.PlaneGeometry(1, 1);
    plano.translate(0, 0.5, 0);
    const otro = plano.clone().rotateY(Math.PI / 2);
    plano.rotateY(Math.PI / 4);
    otro.rotateY(Math.PI / 4);
    const pos = [...plano.attributes.position.array, ...otro.attributes.position.array];
    const uv = [...plano.attributes.uv.array, ...otro.attributes.uv.array];
    const indices = [...plano.index.array, ...otro.index.array.map((i) => i + 4)];
    const geometria = new THREE.InstancedBufferGeometry();
    geometria.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometria.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometria.setIndex(indices);
    geometria.setAttribute("aDatos", new THREE.InstancedBufferAttribute(new Float32Array(datos), 4));
    geometria.instanceCount = datos.length / 4;
    const material = new THREE.ShaderMaterial({
        uniforms: { ...comunes, tAtlas: { value: atlasFlores() }, uCieloLuz: { value: new THREE.Color() }, uFuerza: { value: 1 }, uNiebla: { value: escena.fog.color }, uCerca: { value: 60 }, uLejos: { value: 260 } },
        vertexShader: `
            attribute vec4 aDatos;
            uniform float uTiempo;
            varying vec2 vUv;
            varying float vDistancia;
            void main() {
                vec3 p = position + aDatos.xyz;
                p.x += sin(uTiempo * 2.0 + aDatos.x * 0.7 + aDatos.z * 0.5) * 0.08 * position.y;
                p.z += cos(uTiempo * 1.7 + aDatos.z * 0.6) * 0.06 * position.y;
                vUv = vec2((floor(aDatos.w) + uv.x) / 6.0, uv.y);
                vec4 vista = viewMatrix * vec4(p, 1.0);
                vDistancia = -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            uniform sampler2D tAtlas;
            uniform vec3 uColorSol;
            uniform vec3 uCieloLuz;
            uniform vec3 uNiebla;
            uniform float uCerca;
            uniform float uLejos;
            uniform float uFuerza;
            varying vec2 vUv;
            varying float vDistancia;
            void main() {
                vec4 t = texture2D(tAtlas, vUv);
                if (t.a < 0.5) discard;
                vec3 c = t.rgb * (uColorSol * 0.75 * uFuerza + uCieloLuz * 0.45);
                gl_FragColor = vec4(mix(c, uNiebla, smoothstep(uCerca, uLejos, vDistancia)), 1.0);
                #include <tonemapping_fragment>
            #include <colorspace_fragment>
            }
        `,
        side: THREE.DoubleSide
    });
    const malla = new THREE.Mesh(geometria, material);
    malla.frustumCulled = false;
    escena.add(malla);
    return material;
}


// =====================================================================
// 11. EL AGUA, LOS NENÚFARES Y LOS PECES KOI
// =====================================================================

const MAX_ONDAS = 8;
const ondas = Array.from({ length: MAX_ONDAS }, () => new THREE.Vector4(0, 0, 99, 0));
let siguienteOnda = 0;

function soltarOnda(x, z, fuerza) {
    ondas[siguienteOnda].set(x, z, 0, fuerza);
    siguienteOnda = (siguienteOnda + 1) % MAX_ONDAS;
}

const camaraReflejo = new THREE.PerspectiveCamera();
let objetivoReflejo = null;

const materialAgua = new THREE.ShaderMaterial({
    uniforms: {
        ...comunes,
        tReflejo: { value: null },
        uReflejoVP: { value: new THREE.Matrix4() },
        uOndas: { value: ondas },
        uColorAgua: { value: new THREE.Color(0.12, 0.42, 0.48) },
        uCieloLuz: { value: new THREE.Color() },
        uNiebla: { value: escena.fog.color },
        uCerca: { value: 60 },
        uLejos: { value: 260 }
    },
    vertexShader: `
        varying vec3 vMundo;
        varying float vDistancia;
        void main() {
            vec4 p = modelMatrix * vec4(position, 1.0);
            vMundo = p.xyz;
            vec4 vista = viewMatrix * p;
            vDistancia = -vista.z;
            gl_Position = projectionMatrix * vista;
        }
    `,
    fragmentShader: `
        uniform sampler2D tReflejo;
        uniform mat4 uReflejoVP;
        uniform vec4 uOndas[${MAX_ONDAS}];
        uniform float uTiempo;
        uniform float uNoche;
        uniform vec3 uSol;
        uniform vec3 uColorSol;
        uniform vec3 uColorAgua;
        uniform vec3 uCieloLuz;
        uniform vec3 uNiebla;
        uniform float uCerca;
        uniform float uLejos;
        varying vec3 vMundo;
        varying float vDistancia;
        void main() {
            vec2 p = vMundo.xz;
            vec2 g = vec2(0.0);
            g += vec2(cos(p.x * 1.3 + uTiempo * 1.1), cos(p.y * 1.7 + uTiempo * 0.9)) * 0.03;
            g += vec2(cos(p.x * 3.1 - p.y * 1.7 + uTiempo * 2.3), cos(p.y * 2.9 + p.x * 1.3 - uTiempo * 1.9)) * 0.018;
            g += vec2(cos(p.x * 7.0 + p.y * 3.0 + uTiempo * 3.1), cos(p.y * 6.3 - p.x * 2.2 + uTiempo * 2.7)) * 0.008;
            for (int i = 0; i < ${MAX_ONDAS}; i++) {
                vec4 o = uOndas[i];
                if (o.z > 4.0) continue;
                vec2 d = p - o.xy;
                float r = length(d);
                float frente = o.z * 2.2;
                float env = exp(-o.z * 1.2) * smoothstep(frente + 0.6, frente, r) * smoothstep(0.0, 0.3, r) * o.w;
                g += normalize(d + 1e-4) * cos(r * 9.0 - o.z * 18.0) * env * 0.35;
            }
            vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
            vec3 V = normalize(cameraPosition - vMundo);
            vec4 pr = uReflejoVP * vec4(vMundo, 1.0);
            vec2 uv = pr.xy / pr.w * 0.5 + 0.5 + n.xz * 0.05;
            vec3 reflejo = texture2D(tReflejo, clamp(uv, 0.001, 0.999)).rgb;
            float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
            vec3 base = uColorAgua * (uCieloLuz * 0.8 + uColorSol * 0.25);
            vec3 c = mix(base, reflejo, clamp(0.3 + fresnel * 0.9, 0.0, 1.0));
            vec3 H = normalize(uSol + V);
            float brillo = pow(max(dot(n, H), 0.0), 400.0) * 3.0 * (1.0 - uNoche * 0.6);
            c += uColorSol * brillo;
            float alfa = clamp(0.42 + fresnel * 0.7, 0.0, 0.96);
            gl_FragColor = vec4(mix(c, uNiebla, smoothstep(uCerca, uLejos, vDistancia)), alfa);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false
});

let agua = null;

function crearAgua() {
    agua = new THREE.Mesh(new THREE.PlaneGeometry(52, 32).rotateX(-Math.PI / 2), materialAgua);
    agua.position.set(-1, AGUA, 3);
    agua.renderOrder = 2;
    escena.add(agua);
}

function crearNenufares() {
    const plato = new Cubos(0.125);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= 10 && !(x > 0 && z === 0)) plato.poner(x, 0, z, x * x + z * z < 3 ? B.hojaRoble : B.hojaBambu);
    const flor = new Cubos(0.125);
    const rosa = { c: [color("#f4a6bd"), color("#fbc4d4"), color("#e98aa8")] };
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) flor.poner(x, 1, z, rosa);
    flor.poner(0, 2, 0, { c: color("#f5d533") });
    [[-2, 0], [2, 0], [0, 2], [0, -2]].forEach(([x, z]) => flor.poner(x, 2, z, rosa));
    const gPlato = plato.mallas().hojas;
    const gFlor = flor.mallas().solida;
    const n = ajustes.nenufares;
    const platos = new THREE.InstancedMesh(gPlato, materialBloques(0.125, { contraste: "0.85", rango: "0.3" }), n);
    const flores = new THREE.InstancedMesh(gFlor, materialBloques(0.125), n);
    const m = new THREE.Matrix4();
    let f = 0;
    for (let i = 0; i < n; i++) {
        let x;
        let z;
        do {
            x = -21 + azar() * 40;
            z = -8 + azar() * 22;
        } while (estanque(x, z) > 0.8 || (x > 12 && z > 11));
        const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azar() * 6);
        const tam = 0.8 + azar() * 0.6;
        m.compose(new THREE.Vector3(x, AGUA + 0.02, z), giro, new THREE.Vector3(tam, 1, tam));
        platos.setMatrixAt(i, m);
        if (azar() < 0.45) {
            m.compose(new THREE.Vector3(x + 0.1, AGUA, z - 0.1), giro, new THREE.Vector3(1, 1, 1));
            flores.setMatrixAt(f++, m);
        }
    }
    flores.count = f;
    platos.receiveShadow = true;
    flores.castShadow = true;
    escena.add(platos, flores);
}

const peces = [];

function modeloKoi(colores) {
    const k = new Cubos(0.1);
    for (let x = -4; x <= 4; x++) {
        const ancho = x > 2 ? 1 : x < -2 ? 0 : 1;
        for (let z = -ancho; z <= ancho; z++) for (let y = 0; y <= (Math.abs(x) < 3 ? 1 : 0); y++) k.poner(x, y, z, colores[(x + 10 + (z === 0 ? 0 : 1) * 2) % colores.length]);
    }
    const cuerpo = k.mallas().solida;
    const c = new Cubos(0.1);
    for (let x = -3; x <= -1; x++) for (let z = -Math.abs(x) + 1; z <= Math.abs(x) - 1; z++) c.poner(x, 0, z, colores[0]);
    c.poner(-1, 0, 0, colores[0]);
    return { cuerpo, cola: c.mallas().solida };
}

function crearPeces() {
    const blanco = { c: color("#f4f1ea") };
    const naranja = { c: color("#f07a22") };
    const rojo = { c: color("#d8432a") };
    const oro = { c: color("#f2b632") };
    const negro = { c: color("#2b2b2b") };
    const paletas = [[naranja, blanco, naranja], [blanco, rojo, blanco], [oro, oro, naranja], [blanco, negro, naranja], [naranja, naranja, blanco]];
    const material = materialBloques(0.1, { contraste: "0.95", rango: "0.1" });
    for (let i = 0; i < ajustes.peces; i++) {
        const modelo = modeloKoi(paletas[i % paletas.length]);
        const grupo = new THREE.Group();
        const cuerpo = new THREE.Mesh(modelo.cuerpo, material);
        const cola = new THREE.Mesh(modelo.cola, material);
        cola.position.x = -0.4;
        grupo.add(cuerpo, cola);
        grupo.scale.setScalar(1.6 + azar() * 0.6);
        escena.add(grupo);
        const pez = { grupo, cola, x: -8 + azar() * 14, z: -2 + azar() * 10, rumbo: azar() * 6, vel: 0.6, objetivo: new THREE.Vector2(), tiempo: 0, huye: 0, fase: azar() * 6 };
        nuevoDestino(pez);
        peces.push(pez);
    }
}

function nuevoDestino(pez) {
    for (let i = 0; i < 30; i++) {
        const x = -19 + Math.random() * 36;
        const z = -7 + Math.random() * 20;
        if (estanque(x, z) < 0.6 && !(x > 12 && z > 11)) {
            pez.objetivo.set(x, z);
            return;
        }
    }
    pez.objetivo.set(-1, 3);
}

function moverPeces(delta) {
    peces.forEach((p) => {
        const dx = p.objetivo.x - p.x;
        const dz = p.objetivo.y - p.z;
        const lejos = Math.hypot(dx, dz);
        if (lejos < 0.8) nuevoDestino(p);
        let deseado = Math.atan2(dz, dx);
        let velocidad = 0.7;
        if (p.huye > 0) {
            p.huye -= delta;
            deseado = p.rumboHuida;
            velocidad = 3.5;
        }
        const ax = p.x + Math.cos(p.rumbo) * 1.2;
        const az = p.z + Math.sin(p.rumbo) * 1.2;
        if (estanque(ax, az) > 0.75) deseado = Math.atan2(3 - p.z, -1 - p.x);
        const giro = Math.atan2(Math.sin(deseado - p.rumbo), Math.cos(deseado - p.rumbo));
        p.rumbo += Math.max(-delta * 2.5, Math.min(delta * 2.5, giro));
        p.vel += (velocidad - p.vel) * Math.min(1, delta * 3);
        p.x += Math.cos(p.rumbo) * p.vel * delta;
        p.z += Math.sin(p.rumbo) * p.vel * delta;
        p.fase += delta * (4 + p.vel * 6);
        p.grupo.position.set(p.x, AGUA - 0.55 + Math.sin(p.fase * 0.3) * 0.08, p.z);
        p.grupo.rotation.y = -p.rumbo;
        p.cola.rotation.y = Math.sin(p.fase) * 0.5;
    });
}

function asustarPeces(x, z) {
    peces.forEach((p) => {
        if (Math.hypot(p.x - x, p.z - z) > 5) return;
        p.huye = 0.8;
        p.rumboHuida = Math.atan2(p.z - z, p.x - x);
    });
}


// =====================================================================
// 12. PARTÍCULAS: HUMO, PÉTALOS, LUCIÉRNAGAS Y LUZ DE LOS FAROLES
// =====================================================================

function particulas(n, opciones) {
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometria.setAttribute("aDatos", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTam: { value: opciones.tam }, uColor: { value: opciones.color }, uNoche: comunes.uNoche, uColorSol: comunes.uColorSol },
        vertexShader: `
            attribute vec2 aDatos;
            uniform float uTam;
            varying vec2 vDatos;
            void main() {
                vDatos = aDatos;
                vec4 vista = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = uTam * aDatos.y / -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uNoche;
            uniform vec3 uColorSol;
            varying vec2 vDatos;
            void main() {
                vec2 d = abs(gl_PointCoord - 0.5);
                ${opciones.forma === "cuadro" ? "if (max(d.x, d.y) > 0.32) discard; float a = vDatos.x;" : "float r = length(d) * 2.0; float a = (exp(-r * r * 4.0) * 0.6 + exp(-r * r * 30.0)) * vDatos.x;"}
                vec3 c = uColor * ${opciones.ilumina ? "(uColorSol * 0.7 + 0.35)" : "1.0"};
                gl_FragColor = vec4(c * ${opciones.aditivo ? "a" : "1.0"}, ${opciones.aditivo ? "1.0" : "a"});
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: opciones.aditivo ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    const puntos = new THREE.Points(geometria, material);
    puntos.frustumCulled = false;
    puntos.renderOrder = 3;
    escena.add(puntos);
    return { puntos, pos: geometria.attributes.position, datos: geometria.attributes.aDatos, vida: new Float32Array(n), vel: Array.from({ length: n }, () => new THREE.Vector3()) };
}

let humo;
let petalos;
let luciernagas;
let brillos;

function crearParticulas() {
    humo = particulas(70, { tam: 1500, color: new THREE.Color(0.85, 0.86, 0.88), forma: "cuadro", ilumina: true });
    petalos = particulas(80, { tam: 120, color: new THREE.Color(1, 0.72, 0.82), forma: "cuadro", ilumina: true });
    luciernagas = particulas(50, { tam: 260, color: new THREE.Color(0.75, 1, 0.35), aditivo: true });
    brillos = particulas(luces.length, { tam: 2400, color: new THREE.Color(1, 0.7, 0.35), aditivo: true });
    for (let i = 0; i < 70; i++) {
        const c = chimeneas[i % chimeneas.length];
        const v = (i + 0.5) / 70;
        const edad = (1 - v) / 0.16;
        humo.vida[i] = v;
        humo.vel[i].set(0.25 + Math.random() * 0.2, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2);
        humo.pos.setXYZ(i, c.x + humo.vel[i].x * edad, c.y + humo.vel[i].y * edad, c.z + humo.vel[i].z * edad);
    }
    for (let i = 0; i < 80; i++) {
        const o = petalosOrigen[i % petalosOrigen.length];
        const v = (i + 0.5) / 80;
        petalos.vida[i] = v;
        petalos.vel[i].set(0.6 + Math.random() * 0.4, -0.7 - Math.random() * 0.3, 0.3 * (Math.random() - 0.5));
        const edad = (1 - v) / 0.12;
        petalos.pos.setXYZ(i, o.x + (Math.random() - 0.5) * 9 + petalos.vel[i].x * edad, Math.max(AGUA + 0.02, o.y + petalos.vel[i].y * edad), o.z + (Math.random() - 0.5) * 7);
    }
    luces.forEach((l, i) => brillos.pos.setXYZ(i, l.x, l.y, l.z));
    brillos.pos.needsUpdate = true;
    for (let i = 0; i < 50; i++) {
        luciernagas.vel[i].set(-20 + Math.random() * 38, 2.5 + Math.random() * 3, -10 + Math.random() * 24);
        luciernagas.vida[i] = Math.random() * 100;
    }
}

function moverParticulas(delta, t) {
    for (let i = 0; i < 70; i++) {
        humo.vida[i] -= delta * 0.16;
        if (humo.vida[i] <= 0) {
            const c = chimeneas[i % chimeneas.length];
            humo.vida[i] = 1;
            humo.pos.setXYZ(i, c.x + (Math.random() - 0.5) * 0.4, c.y, c.z + (Math.random() - 0.5) * 0.4);
            humo.vel[i].set(0.25 + Math.random() * 0.2, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2);
        }
        humo.pos.setXYZ(i, humo.pos.getX(i) + humo.vel[i].x * delta, humo.pos.getY(i) + humo.vel[i].y * delta, humo.pos.getZ(i) + humo.vel[i].z * delta);
        const v = humo.vida[i];
        humo.datos.setXY(i, Math.sin(v * Math.PI) * 0.35, 0.4 + (1 - v) * 1.8);
    }
    for (let i = 0; i < 80; i++) {
        petalos.vida[i] -= delta * 0.12;
        if (petalos.vida[i] <= 0) {
            const o = petalosOrigen[i % petalosOrigen.length];
            petalos.vida[i] = 1;
            petalos.pos.setXYZ(i, o.x + (Math.random() - 0.5) * 9, o.y + Math.random() * 2, o.z + (Math.random() - 0.5) * 7);
            petalos.vel[i].set(0.6 + Math.random() * 0.4, -0.7 - Math.random() * 0.3, 0.3 * (Math.random() - 0.5));
        }
        const fase = t * 2 + i;
        petalos.pos.setXYZ(i, petalos.pos.getX(i) + (petalos.vel[i].x + Math.sin(fase) * 0.6) * delta, Math.max(AGUA + 0.02, petalos.pos.getY(i) + petalos.vel[i].y * delta), petalos.pos.getZ(i) + (petalos.vel[i].z + Math.cos(fase * 0.7) * 0.4) * delta);
        petalos.datos.setXY(i, Math.max(0, Math.min(1, petalos.vida[i] * 4)), 1);
    }
    const noche = comunes.uNoche.value;
    luciernagas.puntos.visible = noche > 0.02;
    if (noche > 0.02) {
        for (let i = 0; i < 50; i++) {
            const c = luciernagas.vel[i];
            const f = t * 0.5 + luciernagas.vida[i];
            luciernagas.pos.setXYZ(i, c.x + Math.sin(f * 0.9) * 1.5, c.y + Math.sin(f * 1.3) * 0.6, c.z + Math.cos(f * 0.7) * 1.5);
            luciernagas.datos.setXY(i, Math.max(0, Math.sin(t * 1.4 + i * 2.1)) * noche, 1);
        }
        luciernagas.pos.needsUpdate = true;
        luciernagas.datos.needsUpdate = true;
    }
    for (let i = 0; i < luces.length; i++) brillos.datos.setXY(i, (0.15 + noche * 0.85) * (0.92 + 0.08 * Math.sin(t * 9 + i)), 1);
    brillos.datos.needsUpdate = true;
    [humo, petalos].forEach((p) => {
        p.pos.needsUpdate = true;
        p.datos.needsUpdate = true;
    });
}


// =====================================================================
// 13. EL CIELO Y LOS MOMENTOS DEL DÍA
// =====================================================================

const materialCielo = new THREE.ShaderMaterial({
    uniforms: { uSol: comunes.uSol, uNoche: comunes.uNoche, uTiempo: comunes.uTiempo, uArriba: { value: new THREE.Color() }, uHorizonte: { value: new THREE.Color() } },
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
        varying vec3 vDir;
        float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float ruido(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        void main() {
            vec3 d = normalize(vDir);
            vec3 c = mix(uHorizonte, uArriba, pow(clamp(d.y, 0.0, 1.0), 0.6));
            float s = max(dot(d, uSol), 0.0);
            c += vec3(1.0, 0.9, 0.7) * (smoothstep(0.9985, 0.999, s) * 4.0 + pow(s, 10.0) * 0.3) * (1.0 - uNoche);
            vec2 q = floor(d.xz / max(d.y + 0.08, 0.05) * 6.0 + vec2(uTiempo * 0.15, 0.0));
            float nube = step(0.62, ruido(q * 0.35)) * smoothstep(0.03, 0.2, d.y);
            c = mix(c, mix(vec3(1.0), uHorizonte, 0.2) * (1.0 - uNoche * 0.9), nube * 0.8);
            vec2 e = floor(d.xz / max(d.y, 0.1) * 90.0);
            c += step(0.996, hash(e)) * uNoche * smoothstep(0.05, 0.3, d.y);
            vec3 luna = normalize(vec3(-0.4, 0.6, -0.7));
            c += vec3(0.9, 0.92, 1.0) * step(0.9994, dot(d, luna)) * uNoche * 2.0;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `,
    side: THREE.BackSide,
    depthWrite: false
});
const bovedaCielo = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), materialCielo);
bovedaCielo.frustumCulled = false;
bovedaCielo.renderOrder = -10;
escena.add(bovedaCielo);

const MOMENTOS = {
    dia: { sol: [0.45, 0.82, 0.35], colorSol: [1, 0.96, 0.88], intensidad: 2.6, cielo: [0.72, 0.84, 1], suelo: [0.42, 0.36, 0.28], hemi: 1.15, arriba: [0.32, 0.56, 0.92], horizonte: [0.78, 0.88, 0.98], niebla: [0.74, 0.85, 0.96], agua: [0.12, 0.45, 0.5], noche: 0, exposicion: 1.05 },
    atardecer: { sol: [0.72, 0.3, 0.62], colorSol: [1, 0.62, 0.36], intensidad: 2.6, cielo: [0.66, 0.56, 0.66], suelo: [0.36, 0.25, 0.2], hemi: 1.0, arriba: [0.3, 0.32, 0.6], horizonte: [1, 0.66, 0.45], niebla: [0.92, 0.7, 0.58], agua: [0.18, 0.32, 0.4], noche: 0.15, exposicion: 1.08 },
    noche: { sol: [-0.3, 0.65, 0.6], colorSol: [0.5, 0.6, 0.95], intensidad: 0.55, cielo: [0.2, 0.25, 0.42], suelo: [0.06, 0.06, 0.09], hemi: 0.85, arriba: [0.01, 0.015, 0.05], horizonte: [0.05, 0.07, 0.14], niebla: [0.05, 0.07, 0.13], agua: [0.03, 0.08, 0.12], noche: 1, exposicion: 1.35 }
};

let momento = parametros.get("momento") in MOMENTOS ? parametros.get("momento") : "dia";
let sombraPendiente = 3;
const aux = new THREE.Vector3();
const auxColor = new THREE.Color();
let materialFlores = null;

function aplicarMomento(delta) {
    const m = MOMENTOS[momento];
    const k = delta < 0 ? 1 : 1 - Math.exp(-delta * 1.5);
    const antes = comunes.uSol.value.clone();
    comunes.uSol.value.lerp(aux.fromArray(m.sol).normalize(), k).normalize();
    if (antes.distanceToSquared(comunes.uSol.value) > 1e-6) sombraPendiente = 2;
    const mezclar = (destino, valor) => destino.lerp(auxColor.setRGB(...valor), k);
    mezclar(comunes.uColorSol.value, m.colorSol);
    mezclar(cielo.color, m.cielo);
    mezclar(cielo.groundColor, m.suelo);
    mezclar(escena.fog.color, m.niebla);
    mezclar(materialCielo.uniforms.uArriba.value, m.arriba);
    mezclar(materialCielo.uniforms.uHorizonte.value, m.horizonte);
    mezclar(materialAgua.uniforms.uColorAgua.value, m.agua);
    materialAgua.uniforms.uCieloLuz.value.copy(cielo.color);
    if (materialFlores) {
        materialFlores.uniforms.uCieloLuz.value.copy(cielo.color).multiplyScalar(cielo.intensity);
        materialFlores.uniforms.uFuerza.value = sol.intensity / 2.6;
    }
    sol.color.copy(comunes.uColorSol.value);
    sol.intensity += (m.intensidad - sol.intensity) * k;
    cielo.intensity += (m.hemi - cielo.intensity) * k;
    comunes.uNoche.value += (m.noche - comunes.uNoche.value) * k;
    renderizador.toneMappingExposure += (m.exposicion - renderizador.toneMappingExposure) * k;
    sol.position.copy(comunes.uSol.value).multiplyScalar(110);
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
// 14. TOCAR EL AGUA
// =====================================================================

const rayo = new THREE.Raycaster();
const auxRaton = new THREE.Vector2();
const planoAgua = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AGUA);
const auxCorte = new THREE.Vector3();
const pista = document.getElementById("pista");
let pulsado = null;

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    pulsado = { x: evento.clientX, y: evento.clientY };
    controles.autoRotate = false;
    pista.classList.add("oculta");
});

renderizador.domElement.addEventListener("pointerup", (evento) => {
    if (!pulsado) return;
    const movido = Math.hypot(evento.clientX - pulsado.x, evento.clientY - pulsado.y);
    pulsado = null;
    if (movido > 8) return;
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(auxRaton, camara);
    if (!rayo.ray.intersectPlane(planoAgua, auxCorte)) return;
    if (estanque(auxCorte.x, auxCorte.z) > 0.95) return;
    soltarOnda(auxCorte.x, auxCorte.z, 1);
    asustarPeces(auxCorte.x, auxCorte.z);
    sonarGota(0.6);
});

let siguientePez = 3;

function vidaDelAgua(delta) {
    ondas.forEach((o) => (o.z += delta));
    siguientePez -= delta;
    if (siguientePez > 0 || !peces.length) return;
    siguientePez = 2.5 + Math.random() * 4;
    const p = peces[Math.floor(Math.random() * peces.length)];
    soltarOnda(p.x, p.z, 0.45);
}


// =====================================================================
// 15. SONIDO
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
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 450;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    s.connect(f).connect(g).connect(general);
    s.start();
    return { ctx, general, siguiente: 1 };
}

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
    const base = 280 + Math.random() * 200;
    pitido(base, base * (2.5 + Math.random()), 0.08 + fuerza * 0.05, 0.12 * fuerza);
}

function moverSonido(delta) {
    if (!audio || !sonidoActivo) return;
    audio.siguiente -= delta;
    if (audio.siguiente > 0) return;
    if (momento === "noche") {
        audio.siguiente = 0.7 + Math.random() * 0.6;
        const f = 4200 + Math.random() * 400;
        for (let i = 0; i < 3; i++) pitido(f, f * 0.98, 0.04, 0.025, i * 0.06);
    } else {
        audio.siguiente = 3 + Math.random() * 6;
        const notas = 2 + Math.floor(Math.random() * 4);
        const base = 2200 + Math.random() * 1500;
        for (let i = 0; i < notas; i++) pitido(base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.8), 0.09 + Math.random() * 0.06, 0.04, i * 0.13);
    }
}

botonSonido.addEventListener("click", () => {
    if (!audio) audio = crearAudio();
    audio.ctx.resume();
    sonidoActivo = !sonidoActivo;
    botonSonido.classList.toggle("activo", sonidoActivo);
    botonSonido.setAttribute("aria-pressed", sonidoActivo);
    audio.general.gain.setTargetAtTime(sonidoActivo ? 0.5 : 0, audio.ctx.currentTime, 0.4);
});


// =====================================================================
// 16. LAS TARJETAS
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
// 17. TAMAÑO, CARGA Y BUCLE
// =====================================================================

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 62 : 48;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    const tam = renderizador.getDrawingBufferSize(new THREE.Vector2());
    if (objetivoReflejo) objetivoReflejo.dispose();
    objetivoReflejo = new THREE.WebGLRenderTarget(Math.round(tam.x * ajustes.reflejo), Math.round(tam.y * ajustes.reflejo), { type: THREE.HalfFloatType });
    materialAgua.uniforms.tReflejo.value = objetivoReflejo.texture;
}

window.addEventListener("resize", ajustarTamano);

const cargando = document.getElementById("cargando");
const reloj = new THREE.Clock();
const planoRecorte = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AGUA + 0.05);
let listo = false;
let fotograma = 0;

function construir() {
    crearTerreno();
    crearCasas();
    crearPorche();
    crearVegetacion();
    crearMontanas();
    añadir(mundo, "");
    añadir(fino, "fina");
    añadir(lejos, "lejos", false);
    crearAgua();
    crearNenufares();
    crearPeces();
    materialFlores = crearFlores();
    crearParticulas();
    ajustarTamano();
    aplicarMomento(-1);
    cambiarMomento(momento);
    if (camara.aspect < 1) camara.position.set(22, 8, 27);
    renderizador.compile(escena, camara);
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
}

function dibujar() {
    fotograma++;
    if (!movil || fotograma % 2 === 1) {
        camaraReflejo.copy(camara);
        camaraReflejo.position.y = 2 * AGUA - camara.position.y;
        const mira = controles.target.clone();
        mira.y = 2 * AGUA - mira.y;
        camaraReflejo.up.set(0, 1, 0);
        camaraReflejo.lookAt(mira);
        camaraReflejo.updateMatrixWorld();
        materialAgua.uniforms.uReflejoVP.value.multiplyMatrices(camaraReflejo.projectionMatrix, camaraReflejo.matrixWorldInverse);
        agua.visible = false;
        renderizador.clippingPlanes = [planoRecorte];
        renderizador.setRenderTarget(objetivoReflejo);
        renderizador.render(escena, camaraReflejo);
        renderizador.setRenderTarget(null);
        renderizador.clippingPlanes = [];
        agua.visible = true;
    }
    if (sombraPendiente > 0) {
        renderizador.shadowMap.needsUpdate = true;
        sombraPendiente--;
    }
    renderizador.render(escena, camara);
}

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (comunes.uTiempo.value += delta);
    aplicarMomento(delta);
    controles.update();
    vidaDelAgua(delta);
    moverPeces(delta);
    moverParticulas(delta, t);
    moverSonido(delta);
    dibujar();
}

requestAnimationFrame(() => {
    setTimeout(() => {
        construir();
        reloj.getDelta();
        animar();
    }, 30);
});
