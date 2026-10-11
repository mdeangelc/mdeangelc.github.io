import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Gaucín hecho de cubos visto desde la plaza: delante la iglesia con su
// campanario y la fuente, alrededor el pueblo blanco, arriba el castillo
// del Águila en la peña y abajo el valle del Genal con los castaños de
// otoño. A lo lejos, la Serranía, Sierra Bermeja, el mar y el Peñón.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.25,
    sombra: 2048,
    reflejo: movil ? 0.4 : 0.5,
    truchas: 6,
    palomas: movil ? 8 : 11,
    arboles: movil ? 75 : 115,
    flores: movil ? 420 : 700
};

const MITAD = 56;
const AGUA = 3.6;
const CIMA = 46;

let semilla = 7;
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

function ruidoCiclico(x, y, periodo) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const m = (v) => ((v % periodo) + periodo) % periodo;
    const a = hash2(m(ix), iy);
    const b = hash2(m(ix + 1), iy);
    const c = hash2(m(ix), iy + 1);
    const d = hash2(m(ix + 1), iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const color = (c) => new THREE.Color(c);
const suave = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
};


// =====================================================================
// 2. LOS BLOQUES
// "hoja" se mece con el viento, "luz" brilla siempre un poco y
// "ventana" es un cristal oscuro de día que se enciende de noche.
// =====================================================================

const B = {
    hierba: { c: [color("#6e5a3c"), color("#76603f")], arriba: [color("#7d9a48"), color("#87a04e"), color("#93a556"), color("#a3a65c"), color("#71903f")] },
    hierbaSeca: { c: [color("#7a6440"), color("#806a44")], arriba: [color("#a8a060"), color("#b4a868"), color("#9a9858"), color("#8f9a52")] },
    tierra: { c: [color("#8a5a3c"), color("#94623f"), color("#7f5236")] },
    tierraOscura: { c: [color("#6a4a34"), color("#5f4330")] },
    piedra: { c: [color("#8d8a84"), color("#7f7c77"), color("#97938c")] },
    piedraOscura: { c: [color("#6f6c68"), color("#66635f"), color("#77736d")] },
    caliza: { c: [color("#bdb8ac"), color("#b0aa9e"), color("#c6c0b2"), color("#a9a08c")] },
    calizaMancha: { c: [color("#b89c76"), color("#a98d68"), color("#a3a096")] },
    grava: { c: [color("#9a958c"), color("#a8a399"), color("#8a857e")] },
    arena: { c: [color("#d2c49a"), color("#c8b98e")] },
    canto: { c: [color("#a9a49b"), color("#938e86"), color("#bab4a8")] },
    empedrado: { c: [color("#9b958b"), color("#aaa498"), color("#8c867d")] },
    losa: { c: [color("#c4bba8"), color("#b8af9c")] },
    muro: { c: [color("#9a9182"), color("#8c8476"), color("#a69d8d")] },
    cal: { c: [color("#f4f1ea"), color("#efebe3"), color("#f7f4ee")] },
    calCrema: { c: [color("#f1e6cc"), color("#ece0c4")] },
    zocalo: { c: [color("#8f8a80"), color("#9a9488")] },
    zocaloOcre: { c: [color("#c99a52"), color("#c08f4a")] },
    zocaloAzul: { c: [color("#5f7f9a"), color("#587894")] },
    puerta: { c: [color("#5a3a24"), color("#4f3320")] },
    puertaVerde: { c: [color("#2f5a42"), color("#2a523c")] },
    puertaAzul: { c: [color("#2e4c6c"), color("#294564")] },
    ventana: { c: color("#ffc978"), ventana: true },
    ventanaOscura: { c: [color("#3b4448"), color("#343b3f")] },
    teja: [
        { c: [color("#b4583a"), color("#a84f33")] },
        { c: [color("#c06844"), color("#b25e3c")] },
        { c: [color("#9e5034"), color("#94492f")] },
        { c: [color("#a8623e"), color("#9a5a3a")] }
    ],
    cumbrera: { c: [color("#8e4a30"), color("#86452c")] },
    sillar: { c: [color("#b5a385"), color("#a8967a"), color("#c1b093"), color("#9d8c72")] },
    ladrillo: { c: [color("#b8743e"), color("#a96a38")] },
    madera: { c: [color("#7a5636"), color("#6e4d30")] },
    hierro: { c: color("#2a2a2c") },
    bronce: { c: [color("#a07c3c"), color("#8f6c32")] },
    tronco: { c: [color("#5a4532"), color("#523f2e")], arriba: color("#7d6246") },
    corcho: { c: [color("#a04a2c"), color("#924428")] },
    troncoOlivo: { c: [color("#6a6050"), color("#5e5546")] },
    hojaCobre: { c: [color("#c8692a"), color("#d27a30"), color("#b85a22"), color("#da8a3a")], hoja: true },
    hojaDorada: { c: [color("#d9a03a"), color("#e3b04a"), color("#c98e30"), color("#cfa848")], hoja: true },
    hojaRojiza: { c: [color("#a8461f"), color("#b85428"), color("#984020")], hoja: true },
    hojaVerdosa: { c: [color("#8a9a3a"), color("#9aa444"), color("#7a8c34")], hoja: true },
    hojaAlcornoque: { c: [color("#3c5a2e"), color("#456633"), color("#35512a")], hoja: true },
    hojaOlivo: { c: [color("#7d8a62"), color("#8a966e"), color("#6f7c56")], hoja: true },
    hojaNaranjo: { c: [color("#2f6a2a"), color("#377530"), color("#2a5f26")], hoja: true },
    naranja: { c: [color("#f08a1c"), color("#f59a2a")], hoja: true },
    adelfa: { c: [color("#3f6a35"), color("#4a7a3c"), color("#45723a"), color("#3a6232"), color("#e88aa8")], hoja: true },
    matorral: { c: [color("#5a6a38"), color("#66753f"), color("#4f5e32")], hoja: true },
    geranio: { c: [color("#d8323a"), color("#e8505a")], hoja: true },
    geranioRosa: { c: [color("#e86aa0"), color("#f084b4")], hoja: true },
    tallo: { c: [color("#3f6a30"), color("#4a7a38")], hoja: true },
    maceta: { c: [color("#b0582e"), color("#a4502a")] },
    macetaAzul: { c: [color("#3a62a8"), color("#3058a0")] },
    farol: { c: color("#ffcf7a"), luz: true },
    banderaVerde: { c: color("#1f8a4a"), hoja: true },
    banderaBlanca: { c: color("#f4f4f0"), hoja: true },
    chorro: { c: [color("#9fd4e8"), color("#b8e2f0")], hoja: true },
    aguaFuente: { c: [color("#4a8aa0"), color("#5598ac")] },
    monte: { c: [color("#56683a"), color("#5f7040"), color("#4e6034")] },
    peridotita: { c: [color("#8a4f34"), color("#9a5a3c"), color("#7e4830")] },
    pinsapo: { c: [color("#2c4a3a"), color("#30503e")], hoja: true },
    nieve: { c: color("#f2f4f6") },
    nube: { c: [color("#ffffff"), color("#f6f8fb")] }
};
const ESTRATOS = [B.piedra, B.piedraOscura, B.caliza, B.piedra, B.tierraOscura];


// =====================================================================
// 3. MOTOR DE CUBOS
// Guarda los bloques en un mapa y solo dibuja las caras que tocan el
// aire, con sombra en las esquinas (oclusión ambiental).
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

    mallas(sinFondo = false) {
        const grupos = { solida: nuevaMalla(), hojas: nuevaMalla(), luces: nuevaMalla(), ventanas: nuevaMalla() };
        const t = this.tam;
        const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        const esquinas = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        this.mapa.forEach((v) => {
            const b = v.b;
            const g = b.ventana ? grupos.ventanas : b.luz ? grupos.luces : b.hoja ? grupos.hojas : grupos.solida;
            const h = hash2(v.x * 0.37 + v.z * 1.13, v.y * 0.71 + v.z * 0.17);
            const variar = b.luz ? 1 : 0.94 + h * 0.12;
            const base = Array.isArray(b.c) ? b.c[Math.floor(h * b.c.length)] : b.c;
            dirs.forEach((n) => {
                if (sinFondo && n[1] === -1) return;
                const vecino = this.que(v.x + n[0], v.y + n[1], v.z + n[2]);
                if (vecino && !(vecino.luz && !b.luz)) return;
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
            luces: geometria(grupos.luces),
            ventanas: geometria(grupos.ventanas)
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
    g.setIndex(m.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(m.i, 1) : m.i);
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
escena.fog = new THREE.Fog(0xc8d8ea, 90, movil ? 300 : 390);

const camara = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1600);
camara.rotation.order = "YXZ";
camara.layers.enable(1);
const orbita = { centro: new THREE.Vector3(9, 28, -11), radio: 40, theta: 0.4, phi: 1.45, objetivoRadio: 40, objetivoTheta: 0.4, objetivoPhi: 1.45, base: 0.4, auto: true, reloj: 0, alzado: 0, fov: 50 };

const sol = new THREE.DirectionalLight(0xffffff, 2.6);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
Object.assign(sol.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 280 });
sol.shadow.bias = -0.0006;
sol.shadow.normalBias = 0.05;
sol.target.position.set(6, 16, -8);
escena.add(sol, sol.target);
const cielo = new THREE.HemisphereLight(0xbcd8ff, 0x5a4a38, 1.1);
escena.add(cielo);

const comunes = {
    uTiempo: { value: 0 },
    uNoche: { value: 0 },
    uSol: { value: new THREE.Vector3(0.4, 0.75, 0.5).normalize() },
    uColorSol: { value: new THREE.Color(1, 1, 1) }
};


// =====================================================================
// 5. MATERIALES
// Cada bloque lleva una textura de 16 × 16 "píxeles" calculada en el
// shader, como las de Minecraft. Las ventanas dibujan su marco y se
// encienden con la noche.
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
                diffuseColor.rgb *= ${opciones.contraste ?? "0.88"} + px * ${opciones.rango ?? "0.24"};
                ${opciones.ventana ? `
                vec3 dentro = fract((vMundoB - vNormalB * 0.01) / ${tam.toFixed(2)});
                vec2 uvB = abs(vNormalB.x) > 0.5 ? dentro.zy : abs(vNormalB.z) > 0.5 ? dentro.xy : dentro.xz;
                vec2 pxl = floor(uvB * 16.0);
                float marco = (pxl.x < 2.0 || pxl.x > 13.0 || pxl.y < 2.0 || pxl.y > 13.0 || pxl.x == 7.0 || pxl.x == 8.0 || pxl.y == 8.0) ? 1.0 : 0.0;
                vec3 cristal = mix(vec3(0.13, 0.16, 0.18) * (0.8 + px * 0.4), diffuseColor.rgb, uNoche);
                diffuseColor.rgb = mix(cristal, vec3(0.36, 0.25, 0.16), marco);
                float luzVentana = (1.0 - marco) * uNoche;` : ""}`
            );
        if (opciones.luz) {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                "#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * (0.3 + uNoche * 1.2);"
            );
        }
        if (opciones.ventana) {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                "#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * luzVentana * 1.5;"
            );
        }
    };
    if (opciones.focos) {
        const anterior = material.onBeforeCompile;
        material.onBeforeCompile = (shader) => {
            anterior(shader);
            shader.uniforms.uFocos = { value: focos };
            shader.fragmentShader = shader.fragmentShader
                .replace("uniform float uNoche;", "uniform float uNoche;\nuniform vec4 uFocos[2];")
                .replace(
                    "#include <emissivemap_fragment>",
                    `#include <emissivemap_fragment>
                    float foco = 0.0;
                    for (int i = 0; i < 2; i++) {
                        vec3 d = (vMundoB - uFocos[i].xyz) / uFocos[i].w;
                        foco += smoothstep(1.0, 0.2, length(d * vec3(1.0, 0.7, 1.0))) * smoothstep(-1.0, 0.0, d.y + 0.6);
                    }
                    totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.42) * foco * uNoche * 0.55;`
                );
        };
    }
    if (opciones.bruma) {
        const anterior = material.onBeforeCompile;
        material.onBeforeCompile = (shader) => {
            anterior(shader);
            shader.fragmentShader = shader.fragmentShader.replace("#include <fog_fragment>", "#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(40.0, 300.0, vFogDepth) * 0.55);");
        };
    }
    material.customProgramCacheKey = () => "bloques" + tam + JSON.stringify(opciones);
    return material;
}

const focos = [new THREE.Vector4(-16, 46, -19, 14), new THREE.Vector4(11, 30, -10, 9)];

const materiales = {
    solida: materialBloques(1, { focos: true }),
    hojas: materialBloques(1, { contraste: "0.72", rango: "0.5" }),
    luces: materialBloques(1, { luz: true, contraste: "0.85", rango: "0.3" }),
    ventanas: materialBloques(1, { ventana: true, contraste: "0.9", rango: "0.2" }),
    medioSolida: materialBloques(0.5, { focos: true }),
    medioHojas: materialBloques(0.5, { contraste: "0.75", rango: "0.45" }),
    medioVentanas: materialBloques(0.5, { ventana: true, contraste: "0.9", rango: "0.2" }),
    finaSolida: materialBloques(0.25),
    finaHojas: materialBloques(0.25, { contraste: "0.8", rango: "0.4" }),
    finaLuces: materialBloques(0.25, { luz: true }),
    lejosSolida: materialBloques(4, { contraste: "0.9", rango: "0.2", bruma: true }),
    lejosHojas: materialBloques(4, { contraste: "0.8", rango: "0.35", bruma: true })
};

const mallasMundo = [];

function añadir(cubos, prefijo, sombra = true, sinFondo = false) {
    const m = cubos.mallas(sinFondo);
    const lista = [];
    ["solida", "hojas", "luces", "ventanas"].forEach((tipo) => {
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
// La ladera sube desde el río hasta la peña del castillo. El trozo
// termina en un corte recto que deja ver las capas de roca.
// =====================================================================

function centroRio(x) {
    return 20 + Math.sin(x * 0.1 + 0.5) * 2.6 + Math.sin(x * 0.27 + 1.3) * 0.9;
}

function anchoRio(x) {
    return 2.2 + Math.exp(-(((x - 8) / 6) ** 2)) * 3.2;
}

function distRio(x, z) {
    return Math.abs(z - centroRio(x)) - anchoRio(x) + (ruido2(x * 0.3, z * 0.3) - 0.5) * 1.0;
}

function peña(x, z) {
    const dx = (x + 16) / 11;
    const dz = (z + 19) / 9;
    return 1 - Math.sqrt(dx * dx + dz * dz) + (fbm2(x * 0.15 + 5, z * 0.15 + 1) - 0.5) * 0.4;
}

function zonaOlivar(x, z) {
    return x < -12 && z > -12 && z < centroRio(x) - anchoRio(x) - 3 && peña(x, z) < -0.18;
}

const PLAZA = { x0: 8, z0: -13, x1: 25, z1: 3 };
const enPlaza = (x, z) => x >= PLAZA.x0 && x <= PLAZA.x1 && z >= PLAZA.z0 && z <= PLAZA.z1;

function enPueblo(x, z) {
    if (peña(x, z) > -0.12) return false;
    if (z > centroRio(x) - anchoRio(x) - 5) return false;
    const borde = (ruido2(x * 0.12 + 7, z * 0.12) - 0.5) * 8;
    return x > -16 + borde && x < 42 + borde && z > -44 + borde * 0.4;
}

function alturaBase(x, z) {
    const d = distRio(x, z);
    if (d < 0) return Math.max(1, 3 - Math.floor(-d * 0.7));
    const zr = centroRio(x);
    const r = Math.hypot(x, z);
    let h;
    if (z > zr) {
        const s = Math.max(0, d - 3);
        h = 4 + Math.min(s, 60) * 0.3 + (fbm2(x * 0.09 + 4, z * 0.09) - 0.45) * 2.5 * Math.min(1, d / 5);
        h += (fbm2(x * 0.018 + 9, z * 0.018) - 0.42) * 34 * suave(8, 50, s);
    } else {
        const s = Math.max(0, d - 2.5);
        h = 4 + Math.min(s, 62) * 0.5 + (fbm2(x * 0.05 + 2, z * 0.05) - 0.45) * 7 * Math.min(1, s / 8);
        h += (fbm2(x * 0.018 + 3, z * 0.018 + 5) - 0.42) * 34 * suave(55, 95, s);
        if (zonaOlivar(x, z)) h = Math.floor(h / 2) * 2 + 0.1;
    }
    h += (fbm2(x * 0.008 + 11, z * 0.008 + 3) - 0.4) * 120 * suave(130, 260, r);
    h += Math.max(0, fbm2(x * 0.03, z * 0.03) - 0.5) * 50 * suave(120, 200, r);
    h += Math.exp(-(((x + 120) / 30) ** 2) - (((z + 130) / 60) ** 2)) * 50 * (0.7 + 0.6 * ruido2(x * 0.08, z * 0.08));
    h -= suave(90, 180, z) * 80;
    const u = z - 215;
    const v = x - 40;
    if (u > -34 && u < 50 && Math.abs(v) < 16) {
        const perfil = u < -26 ? 0 : 62 - Math.max(0, u + 18) * 0.6;
        h = Math.max(h, perfil * Math.sqrt(Math.max(0, 1 - (v / 16) ** 2)) - 6);
    }
    if (r < 100) h = Math.max(4, h);
    const p = peña(x, z);
    if (p > 0) {
        const k = Math.min(1, p / 0.25);
        h = h + (CIMA - h) * Math.pow(k, 0.6) + (ruido2(x * 0.5, z * 0.5) - 0.5) * 6 * Math.sin(k * Math.PI);
        if (p > 0.25) h = CIMA;
    }
    return Math.round(h);
}

const mundo = new Cubos(1);
const medio = new Cubos(0.5);
const fino = new Cubos(0.25);
const alturas = new Map();
const dentroTrozo = (x, z) => x >= -MITAD && x < MITAD && z >= -MITAD && z < MITAD;
const alturaEn = (x, z) => alturas.get(x * 1000 + z) ?? alturaBase(x, z);
let nivelPlaza = 0;

function calcularAlturas() {
    for (let x = -MITAD; x < MITAD; x++) for (let z = -MITAD; z < MITAD; z++) alturas.set(x * 1000 + z, alturaBase(x, z));
    nivelPlaza = alturaBase(16, -6);
    for (let x = PLAZA.x0; x <= PLAZA.x1; x++) for (let z = PLAZA.z0; z <= PLAZA.z1; z++) alturas.set(x * 1000 + z, nivelPlaza);
}

const ocupado = new Set();
const cerca = new Set();
const k2 = (x, z) => x * 1000 + z;

function crearTerreno() {
    for (let x = -MITAD; x < MITAD; x++) {
        for (let z = -MITAD; z < MITAD; z++) {
            const h = alturaEn(x, z);
            const borde = x === -MITAD || x === MITAD - 1 || z === -MITAD || z === MITAD - 1;
            let minimo = h;
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => (minimo = Math.min(minimo, alturaEn(x + a, z + b))));
            const desde = Math.min(h - 1, minimo - 1) - (borde ? 3 : 0);
            const p = peña(x, z);
            const d = distRio(x, z);
            const rio = h <= 3;
            const plaza = enPlaza(x, z);
            const roca = p > -0.04 || h - minimo >= 3;
            for (let y = desde; y < h; y++) {
                const prof = h - 1 - y;
                let b;
                if (prof === 0) {
                    if (rio) b = ruido2(x * 0.4, z * 0.4) > 0.6 ? B.canto : ruido2(x * 0.3 + 5, z * 0.3) > 0.5 ? B.grava : B.arena;
                    else if (plaza) b = (x - PLAZA.x0) % 4 === 0 || (z - PLAZA.z0) % 4 === 0 ? B.empedrado : B.losa;
                    else if (p > 0.25) b = ruido2(x * 0.4, z * 0.4) > 0.55 ? B.empedrado : B.hierbaSeca;
                    else if (roca) b = ruido2(x * 0.3, y * 0.3 + z * 0.3) > 0.55 ? B.calizaMancha : B.caliza;
                    else if (d < 1.4 && h === 4) b = ruido2(x * 0.5, z * 0.5) > 0.5 ? B.grava : B.arena;
                    else if (cerca.has(k2(x, z))) b = B.empedrado;
                    else if (zonaOlivar(x, z) || hash2(x * 0.2, z * 0.2) > 0.8) b = B.hierbaSeca;
                    else b = B.hierba;
                } else if (plaza) b = B.muro;
                else if (p > -0.04) b = ruido2(x * 0.3, y * 0.4 + z * 0.3) > 0.55 ? B.calizaMancha : B.caliza;
                else if (prof < 3 && !rio) b = zonaOlivar(x, z) && prof < 2 ? B.muro : B.tierra;
                else if (y < 0 || prof >= 3) b = ESTRATOS[((Math.floor((y + 40 + Math.sin(x * 0.17) * 1.5 + Math.sin(z * 0.13 + 1) * 1.5) / 3)) % ESTRATOS.length + ESTRATOS.length) % ESTRATOS.length];
                else b = B.tierra;
                mundo.poner(x, y, z, b);
            }
        }
    }
}

function crearRocasRio() {
    let puestas = 0;
    for (let i = 0; i < 400 && puestas < 22; i++) {
        const x = Math.floor(-MITAD + 1 + azar() * (MITAD * 2 - 2));
        const zr = centroRio(x);
        const z = Math.round(zr + (azar() - 0.5) * 2 * (anchoRio(x) + 1.5));
        if (!dentroTrozo(x, z)) continue;
        const d = distRio(x, z);
        if (d > 1.5) continue;
        const h = alturaEn(x, z);
        const alto = h <= 2 ? 3 : 1 + Math.floor(azar() * 2);
        const anchoR = 1 + Math.floor(azar() * 2);
        for (let a = 0; a < anchoR; a++)
            for (let b = 0; b < anchoR; b++) {
                const hh = alturaEn(x + a, z + b);
                const top = Math.max(hh, Math.min(5, h + alto - (a + b > 1 ? 1 : 0)));
                for (let y = hh; y < top; y++) mundo.poner(x + a, y, z + b, B.canto);
            }
        puestas++;
    }
}


// =====================================================================
// 7. EL PUEBLO BLANCO
// Las casas se ponen en filas siguiendo la ladera, pegadas unas a
// otras, con calles estrechas entre filas. Cada casa tiene su zócalo,
// sus ventanas con rejas y macetas, y su tejado de teja árabe.
// =====================================================================

const casas = [];
const posaderos = [];
const chimeneas = [];
const luces = [];

function cabeCasa(x0, z0, x1, z1) {
    if (x0 < -MITAD + 1 || x1 > MITAD - 2 || z0 < -MITAD + 1) return false;
    let alto = -99;
    let bajo = 99;
    for (let x = x0; x <= x1; x++) {
        for (let z = z0 - 1; z <= z1 + 1; z++) {
            if (ocupado.has(k2(x, z))) return false;
            if (z < z0 || z > z1) continue;
            if (!enPueblo(x, z) || enPlaza(x, z)) return false;
            const h = alturaEn(x, z);
            alto = Math.max(alto, h);
            bajo = Math.min(bajo, h);
        }
    }
    return alto - bajo <= 4;
}

function planearCasas() {
    for (let fila = 0; fila < 9; fila++) {
        let x = -22 + Math.floor(azar() * 3);
        while (x < 46) {
            const ancho = 4 + Math.floor(azar() * 4);
            const fondo = 4 + (azar() < 0.4 ? 1 : 0);
            const zf = 9 - fila * 6 + Math.round(Math.sin(x * 0.09 + fila * 1.7) * 1.2);
            const x1 = x + ancho - 1;
            const z0 = zf - fondo + 1;
            if (cabeCasa(x, z0, x1, zf)) {
                casas.push({ x0: x, z0, x1, z1: zf });
                for (let a = x; a <= x1; a++) for (let b = z0; b <= zf; b++) ocupado.add(k2(a, b));
                x = x1 + 1 + (azar() < 0.18 ? 1 + Math.floor(azar() * 2) : 0);
            } else {
                x += 1;
            }
        }
    }
    casas.forEach((c) => {
        for (let x = c.x0 - 2; x <= c.x1 + 2; x++) for (let z = c.z0 - 2; z <= c.z1 + 2; z++) if (enPueblo(x, z) && !ocupado.has(k2(x, z))) cerca.add(k2(x, z));
    });
}

function ventanaFina(x, y, z, cara, conReja, conMaceta) {
    const fx = x * 4;
    const fy = y * 4;
    const fz = z * 4;
    const fuera = cara === "sur" ? [0, 0, 4] : cara === "norte" ? [0, 0, -1] : cara === "este" ? [4, 0, 0] : [-1, 0, 0];
    const lateral = cara === "sur" || cara === "norte" ? [1, 0, 0] : [0, 0, 1];
    const pos = (a, b) => [fx + fuera[0] + lateral[0] * a, fy + b, fz + fuera[2] + lateral[2] * a];
    if (conReja) {
        for (let b = 0; b < 8; b++) {
            fino.poner(...pos(0, b), B.hierro);
            fino.poner(...pos(3, b), B.hierro);
            if (b % 3 === 0) for (let a = 1; a < 3; a++) fino.poner(...pos(a, b), B.hierro);
        }
        fino.poner(...pos(1, 7), B.hierro);
        fino.poner(...pos(2, 7), B.hierro);
    }
    if (conMaceta) {
        const maceta = azar() < 0.35 ? B.macetaAzul : B.maceta;
        const flor = azar() < 0.65 ? B.geranio : B.geranioRosa;
        const a0 = conReja ? 1 : 0;
        for (let a = a0; a < 4 - a0; a++) fino.poner(...pos(a, -1), maceta);
        for (let a = a0; a < 4 - a0; a++) {
            fino.poner(...pos(a, 0), B.tallo, 0.4);
            if (azar() < 0.8) fino.poner(...pos(a, 1), flor, 0.6);
        }
    }
}

function farola(x, y, z, cara) {
    const fuera = cara === "sur" ? [0, 0, 1] : cara === "norte" ? [0, 0, -1] : cara === "este" ? [1, 0, 0] : [-1, 0, 0];
    const fx = x * 4 + 1 + (fuera[0] > 0 ? 3 : 0) + (fuera[0] < 0 ? -1 : 0);
    const fz = z * 4 + 1 + (fuera[2] > 0 ? 3 : 0) + (fuera[2] < 0 ? -1 : 0);
    const fy = y * 4 + 2;
    for (let k = 0; k < 2; k++) fino.poner(fx + fuera[0] * k, fy + 2, fz + fuera[2] * k, B.hierro);
    const lx = fx + fuera[0] * 2;
    const lz = fz + fuera[2] * 2;
    fino.poner(lx, fy, lz, B.farol);
    fino.poner(lx, fy + 1, lz, B.farol);
    fino.poner(lx, fy + 2, lz, B.hierro);
    luces.push(new THREE.Vector3((lx + 0.5) * 0.25, (fy + 1) * 0.25, (lz + 0.5) * 0.25));
}

function tejadoDosAguas(x0, z0, x1, z1, techo, teja, alero = 1) {
    const hx0 = 2 * x0;
    const hx1 = 2 * x1 + 1;
    const hz0 = 2 * (z0 - alero);
    const hz1 = 2 * (z1 + alero) + 1;
    const base = 2 * techo - 1;
    const filas = hz1 - hz0 + 1;
    const mitad = Math.floor((filas - 1) / 2);
    const alturaFila = (hz) => base + Math.floor(Math.min(hz - hz0, hz1 - hz) / 2);
    for (let hz = hz0; hz <= hz1; hz++) {
        const j = Math.min(hz - hz0, hz1 - hz);
        const yh = alturaFila(hz);
        for (let hx = hx0; hx <= hx1; hx++) {
            const cumbre = j >= mitad;
            medio.poner(hx, yh, hz, cumbre ? B.cumbrera : Math.abs(hx) % 2 === 0 ? teja : B.teja[(B.teja.indexOf(teja) + 1) % B.teja.length]);
            if (cumbre) medio.poner(hx, yh + 1, hz, B.cumbrera);
        }
    }
    for (let hz = 2 * z0; hz <= 2 * z1 + 1; hz++) {
        const tope = alturaFila(hz);
        for (let yh = 2 * techo; yh < tope; yh++) {
            [2 * x0, 2 * x0 + 1, 2 * x1, 2 * x1 + 1].forEach((hx) => medio.poner(hx, yh, hz, B.cal));
        }
    }
    return { cumbre: alturaFila(hz0 + mitad) + 1, zCumbre: hz0 + mitad };
}

function construirCasa(c) {
    const { x0, z0, x1, z1 } = c;
    let suelo = -99;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) suelo = Math.max(suelo, alturaEn(x, z));
    const pisos = azar() < 0.45 ? 2 : 1;
    const alto = pisos === 2 ? 7 : 4;
    const techo = suelo + alto;
    const r = azar();
    const zocalo = r < 0.35 ? B.zocalo : r < 0.55 ? B.zocaloOcre : r < 0.65 ? B.zocaloAzul : B.cal;
    const pared = azar() < 0.12 ? B.calCrema : B.cal;
    const rp = azar();
    const puerta = rp < 0.5 ? B.puerta : rp < 0.8 ? B.puertaVerde : B.puertaAzul;
    const puertaX = x0 + 1 + Math.floor(azar() * Math.max(1, x1 - x0 - 1));
    const huecos = [];
    for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
            const borde = x === x0 || x === x1 || z === z0 || z === z1;
            const g = alturaEn(x, z);
            const hasta = borde ? techo : suelo;
            for (let y = Math.min(g, suelo); y < hasta; y++) {
                const b = y === g || (y === suelo && !borde) ? zocalo : pared;
                mundo.poner(x, y, z, b);
            }
        }
    }
    const filasVentana = pisos === 2 ? [suelo + 1, suelo + 4] : [suelo + 1];
    for (let x = x0 + 1; x < x1; x++) {
        if (Math.abs(x - puertaX) < 1) continue;
        if ((x - x0) % 2 === 0 && x1 - x0 > 3) continue;
        filasVentana.forEach((y, piso) => {
            const encendida = azar() < 0.55;
            const b = encendida ? B.ventana : B.ventanaOscura;
            mundo.poner(x, y, z1, b);
            mundo.poner(x, y + 1, z1, b);
            huecos.push({ x, y, z: z1, piso });
        });
    }
    for (let y = suelo; y <= suelo + 2; y++) mundo.poner(puertaX, y, z1, puerta);
    if (pisos === 2) {
        mundo.poner(puertaX, suelo + 4, z1, azar() < 0.5 ? B.ventana : B.ventanaOscura);
        mundo.poner(puertaX, suelo + 5, z1, azar() < 0.5 ? B.ventana : B.ventanaOscura);
        const fx = puertaX * 4;
        const fz = (z1 + 1) * 4;
        const fy = (suelo + 4) * 4;
        for (let a = -1; a <= 4; a++) {
            fino.poner(fx + a, fy - 1, fz, B.hierro);
            fino.poner(fx + a, fy - 1, fz + 1, B.hierro);
            fino.poner(fx + a, fy + 3, fz + 1, B.hierro);
            if (a === -1 || a === 4 || a % 2 === 0) for (let b = 0; b < 3; b++) fino.poner(fx + a, fy + b, fz + 1, B.hierro);
        }
        if (azar() < 0.7) for (let a = 0; a < 4; a += 3) {
            fino.poner(fx + a, fy, fz, B.maceta);
            fino.poner(fx + a, fy + 1, fz, azar() < 0.5 ? B.geranio : B.geranioRosa, 0.6);
        }
    }
    const delante = alturaEn(puertaX, z1 + 1);
    for (let y = delante; y < suelo; y++) mundo.poner(puertaX, y, z1 + 1, B.empedrado);
    huecos.forEach((h) => ventanaFina(h.x, h.y, h.z, "sur", h.piso === 0 && azar() < 0.6, azar() < 0.45));
    [[x0, "oeste"], [x1, "este"]].forEach(([x, lado]) => {
        const vecino = lado === "oeste" ? x - 1 : x + 1;
        if (ocupado.has(k2(vecino, z0 + 1))) return;
        if (x1 - x0 < 3 || z1 - z0 < 3) return;
        const z = z0 + 1 + Math.floor(azar() * (z1 - z0 - 1));
        const y = pisos === 2 ? suelo + 4 : suelo + 1;
        mundo.poner(x, y, z, azar() < 0.5 ? B.ventana : B.ventanaOscura);
    });
    if (pisos === 2 && x1 - x0 > 3) mundo.poner(x0 + 2, suelo + 5, z0, B.ventanaOscura);
    if (azar() < 0.3) farola(azar() < 0.5 ? x0 : x1, suelo + 2, z1, "sur");
    if (azar() < 0.14 && pisos === 1) {
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
            const borde = x === x0 || x === x1 || z === z0 || z === z1;
            mundo.poner(x, techo - 1, z, borde ? pared : B.losa);
            if (borde) mundo.poner(x, techo, z, pared);
        }
        return;
    }
    const teja = B.teja[Math.floor(azar() * B.teja.length)];
    const t = tejadoDosAguas(x0, z0, x1, z1, techo, teja);
    if (Math.hypot((x0 + x1) / 2 - 16, (z0 + z1) / 2 + 4) < 30) for (let k = 0; k < 2; k++) posaderos.push(new THREE.Vector3(x0 + 0.5 + azar() * (x1 - x0), (t.cumbre + 1) * 0.5, (t.zCumbre + 1) * 0.5));
    if (azar() < 0.4 && x1 - x0 >= 3) {
        const cx = 2 * (x0 + 1 + Math.floor(azar() * (x1 - x0 - 2)));
        const cz = t.zCumbre - 1 + (azar() < 0.5 ? 0 : 2);
        for (let yh = t.cumbre - 3; yh <= t.cumbre + 2; yh++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) medio.poner(cx + a, yh, cz + b, B.cal);
        for (let a = -1; a < 3; a++) for (let b = -1; b < 3; b++) if (a < 0 || a > 1 || b < 0 || b > 1) medio.poner(cx + a, t.cumbre + 3, cz + b, B.cumbrera);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) medio.poner(cx + a, t.cumbre + 4, cz + b, B.cumbrera);
        chimeneas.push(new THREE.Vector3((cx + 1) * 0.5, (t.cumbre + 3.5) * 0.5, (cz + 1) * 0.5));
    }
}

function crearPueblo() {
    casas.forEach(construirCasa);
}


// =====================================================================
// 8. LA IGLESIA DE SAN SEBASTIÁN Y LA PLAZA
// Nave blanca con contrafuertes, campanario con sus campanas (se
// pueden tocar) y una plaza con naranjos, bancos y la fuente.
// =====================================================================

const campanas = [];
const zonaIglesia = new THREE.Box3();

function crearIglesia() {
    const P = nivelPlaza;
    const nx0 = 13;
    const nx1 = 23;
    const nz0 = -12;
    const nz1 = -7;
    const alto = 8;
    for (let x = nx0; x <= nx1; x++) {
        for (let z = nz0; z <= nz1; z++) {
            const borde = x === nx0 || x === nx1 || z === nz0 || z === nz1;
            if (!borde) continue;
            for (let y = P; y < P + alto; y++) mundo.poner(x, y, z, y === P ? B.sillar : B.cal);
        }
    }
    for (let y = P; y < P + 4; y++) for (let x = 17; x <= 19; x++) mundo.poner(x, y, nz1, B.puerta);
    mundo.poner(18, P + 4, nz1, B.puerta);
    [16, 20].forEach((x) => mundo.poner(x, P + 4, nz1, B.sillar));
    mundo.caja(16, P, nz1, 16, P + 3, nz1, B.sillar);
    mundo.caja(20, P, nz1, 20, P + 3, nz1, B.sillar);
    mundo.poner(18, P + 6, nz1, B.ventana);
    for (let x = nx0 + 2; x < nx1; x += 3) {
        [nz0, nz1].forEach((z) => {
            if (z === nz1 && x >= 16 && x <= 20) return;
            mundo.poner(x, P + 4, z, B.ventana);
            mundo.poner(x, P + 5, z, B.ventana);
        });
    }
    [nx0 + 1, nx1 - 1].forEach((x) => mundo.caja(x, P, nz1 + 1, x, P + 5, nz1 + 1, B.sillar));
    const tc = tejadoDosAguas(nx0, nz0, nx1, nz1, P + alto, B.teja[0]);
    for (let k = 0; k < 4; k++) posaderos.push(new THREE.Vector3(nx0 + 1 + k * 2.5, (tc.cumbre + 1) * 0.5, (tc.zCumbre + 1) * 0.5));

    const tx0 = 9;
    const tx1 = 12;
    const tz0 = -12;
    const tz1 = -9;
    const tope = P + 16;
    for (let y = P; y < tope; y++) {
        for (let x = tx0; x <= tx1; x++) {
            for (let z = tz0; z <= tz1; z++) {
                const borde = x === tx0 || x === tx1 || z === tz0 || z === tz1;
                const esquina = (x === tx0 || x === tx1) && (z === tz0 || z === tz1);
                if (!borde && y !== P + 11) continue;
                const hueco = y >= P + 12 && y <= P + 14 && !esquina && borde;
                if (hueco) continue;
                let b = esquina ? B.ladrillo : B.cal;
                if (y === P + 11 || y === P + 15) b = B.sillar;
                if (y === P) b = B.sillar;
                mundo.poner(x, y, z, b);
            }
        }
    }
    mundo.poner(10, P + 6, tz1, B.ventanaOscura);
    mundo.poner(11, P + 6, tz1, B.ventanaOscura);
    for (let x = tx0 - 1; x <= tx1 + 1; x++) for (let z = tz0 - 1; z <= tz1 + 1; z++) {
        const borde = x === tx0 - 1 || x === tx1 + 1 || z === tz0 - 1 || z === tz1 + 1;
        if (borde) mundo.poner(x, P + 15, z, B.sillar);
        mundo.poner(x, P + 16, z, borde ? B.sillar : B.cal);
    }
    for (let k = 0; k < 5; k++) {
        const a = 2 * (tx0 - 1) + k;
        const b = 2 * (tx1 + 1) + 1 - k;
        const c = 2 * (tz0 - 1) + k;
        const d = 2 * (tz1 + 1) + 1 - k;
        if (a > b) break;
        for (let hx = a; hx <= b; hx++) for (let hz = c; hz <= d; hz++) {
            const borde = hx === a || hx === b || hz === c || hz === d;
            if (borde || k === 4) medio.poner(hx, 2 * (P + 17) + k, hz, k === 0 ? B.cumbrera : B.teja[Math.abs(hx + hz) % 2]);
        }
    }
    const cx = 11 * 4;
    const cz = -10 * 4 - 2;
    const cy = (P + 17) * 4 + 10;
    for (let y = 0; y < 9; y++) fino.poner(cx, cy + y, cz, B.hierro);
    for (let a = -2; a <= 2; a++) fino.poner(cx + a, cy + 6, cz, B.hierro);

    const campanaFina = new Cubos(0.125);
    const perfil = [1, 2, 2, 2, 3, 3, 4];
    perfil.forEach((r, i) => {
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r + 1) campanaFina.poner(a, -1 - i, b, B.bronce);
    });
    for (let a = -3; a <= 3; a++) campanaFina.poner(a, 0, 0, B.madera);
    campanaFina.poner(0, -8, 0, B.hierro);
    const geo = campanaFina.mallas().solida;
    const material = materialBloques(0.125);
    [[11, P + 15, -8.5, "x"], [12.5, P + 15, -10, "z"]].forEach(([x, y, z, eje]) => {
        const malla = new THREE.Mesh(geo, material);
        malla.position.set(x, y, z);
        if (eje === "z") malla.rotation.y = Math.PI / 2;
        malla.castShadow = true;
        escena.add(malla);
        campanas.push({ malla, angulo: 0, velocidad: 0, eje });
    });
    focos[1].set(11, P + 12, -8, 9);
    zonaIglesia.set(new THREE.Vector3(tx0 - 1, P, tz0 - 1), new THREE.Vector3(tx1 + 2, P + 22, tz1 + 2));

    [[9, -3], [24, -4], [9, 1], [24, 1]].forEach(([x, z]) => naranjo(x, z));
    banco(21 * 4, P * 4, -2 * 4);
    banco(11 * 4, P * 4, 1 * 4 + 2, true);
    banco(19 * 4 + 2, P * 4, 1 * 4 + 2, true);
    [[13, -1], [20, -1], [8, 3], [25, -9]].forEach(([x, z]) => farolaPie(x, P, z));
    fuente(14, P, -4);
    [[15, -6], [21, -6], [8, -7], [25, -1]].forEach(([x, z]) => maceton(x, P, z));
    const fz = PLAZA.z1 * 4 + 3;
    for (let fx = PLAZA.x0 * 4; fx <= PLAZA.x1 * 4 + 3; fx++) {
        fino.poner(fx, P * 4, fz, B.sillar);
        fino.poner(fx, P * 4 + 4, fz, B.hierro);
        fino.poner(fx, P * 4 + 2, fz, B.hierro);
        if (fx % 3 === 0) {
            fino.poner(fx, P * 4 + 1, fz, B.hierro);
            fino.poner(fx, P * 4 + 3, fz, B.hierro);
        }
    }
    for (let z = PLAZA.z0; z <= PLAZA.z1; z++) {
        [PLAZA.x0 - 1, PLAZA.x1 + 1].forEach((x) => {
            if (ocupado.has(k2(x, z)) || alturaEn(x, z) >= P) return;
            const lado = x < PLAZA.x0 ? PLAZA.x0 * 4 : PLAZA.x1 * 4 + 3;
            for (let k = 0; k < 4; k++) {
                fino.poner(lado, P * 4, z * 4 + k, B.sillar);
                fino.poner(lado, P * 4 + 4, z * 4 + k, B.hierro);
                if (k % 3 === 0) for (let y = 1; y < 4; y++) fino.poner(lado, P * 4 + y, z * 4 + k, B.hierro);
            }
        });
    }
    orbita.centro.set(9, P + 13, -11);
}

function farolaPie(x, y, z) {
    const fx = x * 4 + 1;
    const fz = z * 4 + 1;
    const fy = y * 4;
    for (let k = 0; k < 10; k++) fino.poner(fx, fy + k, fz, B.hierro);
    fino.poner(fx, fy + 10, fz, B.farol);
    fino.poner(fx, fy + 11, fz, B.farol);
    fino.poner(fx, fy + 12, fz, B.hierro);
    luces.push(new THREE.Vector3((fx + 0.5) * 0.25, (fy + 11) * 0.25, (fz + 0.5) * 0.25));
}

function banco(fx, fy, fz, alSur = false) {
    const asiento = alSur ? [fz + 1, fz + 2] : [fz, fz + 1];
    const respaldo = alSur ? fz : fz + 2;
    const delante = alSur ? fz + 2 : fz;
    for (let a = 0; a < 8; a++) {
        asiento.forEach((z) => fino.poner(fx + a, fy + 2, z, B.madera));
        fino.poner(fx + a, fy + 4, respaldo, B.madera);
        fino.poner(fx + a, fy + 5, respaldo, B.madera);
    }
    [0, 7].forEach((a) => {
        fino.poner(fx + a, fy, delante, B.hierro);
        fino.poner(fx + a, fy + 1, delante, B.hierro);
        for (let y = 0; y < 4; y++) fino.poner(fx + a, fy + y, respaldo, B.hierro);
    });
}

function maceton(x, y, z) {
    const fx = x * 4;
    const fy = y * 4;
    const fz = z * 4;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) {
        const borde = a === 0 || a === 3 || b === 0 || b === 3;
        fino.poner(fx + a, fy + c, fz + b, borde || c === 0 ? B.maceta : B.tierra);
    }
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        fino.poner(fx + a, fy + 3, fz + b, B.tallo, 0.3);
        if (azar() < 0.7) fino.poner(fx + a, fy + 4, fz + b, azar() < 0.6 ? B.geranio : B.geranioRosa, 0.5);
    }
}

function fuente(x, y, z) {
    const fx = x * 4;
    const fy = y * 4;
    const fz = z * 4;
    for (let a = 0; a < 16; a++) {
        for (let b = 0; b < 7; b++) {
            const borde = a === 0 || a === 15 || b === 0 || b === 6;
            for (let c = 0; c < 3; c++) if (borde || c === 0) fino.poner(fx + a, fy + c, fz + b, B.sillar);
            if (!borde) fino.poner(fx + a, fy + 1, fz + b, B.aguaFuente);
        }
    }
    for (let a = 0; a < 16; a++) for (let c = 3; c < 10; c++) fino.poner(fx + a, fy + c, fz - 1, c === 9 ? B.losa : B.sillar);
    for (let k = 0; k < 6; k++) {
        const a = 2 + k * 2 + (k > 2 ? 1 : 0);
        fino.poner(fx + a, fy + 6, fz, B.bronce);
        fino.poner(fx + a, fy + 6, fz + 1, B.bronce);
        for (let c = 2; c < 6; c++) fino.poner(fx + a, fy + c, fz + 2, B.chorro, 0.25);
    }
}


// =====================================================================
// 9. EL CASTILLO DEL ÁGUILA
// Murallas con almenas siguiendo el borde de la peña, la torre con la
// bandera de Andalucía y la ermita blanca dentro.
// =====================================================================

const zonaCastillo = new THREE.Box3();

function crearCastillo() {
    const dentro = (x, z) => dentroTrozo(x, z) && peña(x, z) > 0.25 && alturaEn(x, z) === CIMA;
    let cx = 0;
    let cz = 0;
    let n = 0;
    const celdas = [];
    for (let x = -MITAD; x < 0; x++) for (let z = -MITAD; z < 0; z++) if (dentro(x, z)) {
        celdas.push([x, z]);
        cx += x;
        cz += z;
        n++;
    }
    if (!n) return;
    cx = Math.round(cx / n);
    cz = Math.round(cz / n);
    const puerta = [cx + 9, cz + 3];
    celdas.forEach(([x, z]) => {
        const borde = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !dentro(x + a, z + b));
        if (!borde) return;
        if (Math.hypot(x - puerta[0], z - puerta[1]) < 2.2) return;
        for (let y = CIMA; y < CIMA + 3; y++) mundo.poner(x, y, z, B.sillar);
        if ((x + z) % 2 === 0) mundo.poner(x, CIMA + 3, z, B.sillar);
        if (hash2(x, z) > 0.85) luces.push(new THREE.Vector3(x + 0.5, CIMA - 0.5, z + 0.5));
    });
    const tx0 = cx - 5;
    const tz0 = cz - 3;
    const ttop = CIMA + 10;
    for (let x = tx0; x < tx0 + 5; x++) {
        for (let z = tz0; z < tz0 + 5; z++) {
            const borde = x === tx0 || x === tx0 + 4 || z === tz0 || z === tz0 + 4;
            for (let y = Math.min(alturaEn(x, z), CIMA); y < ttop; y++) if (borde || y === ttop - 1 || y < CIMA) mundo.poner(x, y, z, B.sillar);
            if (borde && (x + z) % 2 === 0) mundo.poner(x, ttop, z, B.sillar);
        }
    }
    [[tx0 + 2, CIMA + 3, tz0 + 4], [tx0 + 2, CIMA + 7, tz0 + 4], [tx0 + 4, CIMA + 5, tz0 + 2], [tx0, CIMA + 6, tz0 + 2]].forEach(([x, y, z]) => mundo.poner(x, y, z, B.ventanaOscura));
    const px = (tx0 + 2) * 4 + 1;
    const pz = (tz0 + 2) * 4 + 1;
    const py = ttop * 4;
    for (let k = 0; k < 16; k++) fino.poner(px, py + k, pz, B.hierro);
    for (let a = 1; a <= 9; a++) {
        for (let b = 0; b < 6; b++) {
            const franja = b < 2 || b > 3 ? B.banderaVerde : B.banderaBlanca;
            fino.poner(px + a, py + 10 + b, pz, franja, 0.25 + a * 0.22);
        }
    }
    const ex0 = cx + 1;
    const ez0 = cz - 2;
    const ex1 = cx + 5;
    const ez1 = cz + 1;
    let cabe = true;
    for (let x = ex0; x <= ex1; x++) for (let z = ez0; z <= ez1; z++) if (!dentro(x, z)) cabe = false;
    if (cabe) {
        for (let x = ex0; x <= ex1; x++) for (let z = ez0; z <= ez1; z++) {
            const borde = x === ex0 || x === ex1 || z === ez0 || z === ez1;
            if (borde) for (let y = CIMA; y < CIMA + 4; y++) mundo.poner(x, y, z, B.cal);
        }
        mundo.poner(ex1, CIMA, ez0 + 2, B.puerta);
        mundo.poner(ex1, CIMA + 1, ez0 + 2, B.puerta);
        mundo.poner(ex0 + 2, CIMA + 2, ez1, B.ventana);
        tejadoDosAguas(ex0, ez0, ex1, ez1, CIMA + 4, B.teja[1]);
        mundo.caja(ex1, CIMA + 4, ez0 + 1, ex1, CIMA + 6, ez0 + 2, B.cal);
        mundo.poner(ex1, CIMA + 7, ez0 + 1, B.cal);
        mundo.poner(ex1, CIMA + 7, ez0 + 2, B.cal);
        fino.poner(ex1 * 4 + 2, (CIMA + 6) * 4 + 1, (ez0 + 2) * 4, B.bronce);
        fino.poner(ex1 * 4 + 2, (CIMA + 6) * 4 + 2, (ez0 + 2) * 4, B.bronce);
        mundo.quitar(ex1, CIMA + 6, ez0 + 2);
    }
    zonaCastillo.set(new THREE.Vector3(cx - 10, CIMA - 2, cz - 9), new THREE.Vector3(cx + 10, CIMA + 16, cz + 9));
    centroCastillo.set(cx, CIMA, cz);
    focos[0].set(cx - 1, CIMA + 2, cz, 15);
}

const centroCastillo = new THREE.Vector3(-16, CIMA, -19);


// =====================================================================
// 10. ÁRBOLES: CASTAÑOS DE OTOÑO, ALCORNOQUES, OLIVOS Y NARANJOS
// En octubre el valle del Genal se pone color cobre: es el Bosque de
// Cobre. Cada castaño mezcla dos tonos.
// =====================================================================

const origenHojas = [];

function copa(c, cx, cy, cz, rx, ry, rz, elegir, densidad = 1) {
    for (let x = -rx; x <= rx; x++)
        for (let y = -ry; y <= ry; y++)
            for (let z = -rz; z <= rz; z++) {
                const d = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz);
                if (d > 1 + (azar() - 0.5) * 0.35) continue;
                if (d > 0.6 && azar() > densidad) continue;
                if (!c.hay(cx + x, cy + y, cz + z)) c.poner(cx + x, cy + y, cz + z, typeof elegir === "function" ? elegir() : elegir);
            }
}

const PALETAS_CASTAÑO = [
    [B.hojaCobre, B.hojaDorada],
    [B.hojaDorada, B.hojaVerdosa],
    [B.hojaCobre, B.hojaRojiza],
    [B.hojaVerdosa, B.hojaDorada],
    [B.hojaCobre, B.hojaVerdosa]
];

function castaño(x, z) {
    const y = alturaEn(x, z);
    const alto = 4 + Math.floor(azar() * 3);
    mundo.caja(x, y, z, x, y + alto, z, B.tronco);
    mundo.poner(x + 1, y + alto - 1, z, B.tronco);
    mundo.poner(x - 1, y + alto, z + 1, B.tronco);
    const [a, b] = PALETAS_CASTAÑO[Math.floor(azar() * PALETAS_CASTAÑO.length)];
    const elegir = () => (azar() < 0.7 ? a : b);
    copa(mundo, x, y + alto + 1, z, 4, 3, 4, elegir, 0.85);
    copa(mundo, x + 1, y + alto + 3, z - 1, 3, 2, 3, elegir, 0.8);
    origenHojas.push({ p: new THREE.Vector3(x + 0.5, y + alto + 1, z + 0.5), color: a });
}

function alcornoque(x, z) {
    const y = alturaEn(x, z);
    mundo.caja(x, y, z, x, y + 1, z, B.corcho);
    mundo.caja(x, y + 2, z, x, y + 3, z, B.tronco);
    mundo.poner(x + 1, y + 3, z, B.tronco);
    mundo.poner(x + 2, y + 4, z, B.tronco);
    mundo.poner(x - 1, y + 3, z + 1, B.tronco);
    mundo.poner(x - 2, y + 4, z + 1, B.tronco);
    copa(mundo, x, y + 5, z, 4, 2, 4, B.hojaAlcornoque, 0.85);
    copa(mundo, x + 2, y + 5, z - 1, 3, 1, 3, B.hojaAlcornoque, 0.8);
}

function olivo(x, z) {
    const y = alturaEn(x, z);
    mundo.poner(x, y, z, B.troncoOlivo);
    mundo.poner(x, y + 1, z, B.troncoOlivo);
    mundo.poner(x + (azar() < 0.5 ? 1 : -1), y + 2, z, B.troncoOlivo);
    copa(mundo, x, y + 3, z, 2, 1, 2, B.hojaOlivo, 0.9);
    copa(mundo, x + 1, y + 3, z + (azar() < 0.5 ? 1 : -1), 2, 1, 2, B.hojaOlivo, 0.8);
}

function naranjo(x, z) {
    const y = alturaEn(x, z);
    mundo.caja(x, y, z, x, y + 1, z, B.tronco);
    copa(mundo, x, y + 3, z, 2, 2, 2, B.hojaNaranjo, 0.95);
    for (let i = 0; i < 7; i++) {
        const a = Math.floor(azar() * 5) - 2;
        const b = Math.floor(azar() * 5) - 2;
        const c = Math.floor(azar() * 3) - 1;
        if (mundo.que(x + a, y + 3 + c, z + b) === B.hojaNaranjo) mundo.poner(x + a, y + 3 + c, z + b, B.naranja);
    }
}

function adelfa(x, z) {
    const y = alturaEn(x, z);
    copa(mundo, x, y, z, 1, 1, 1, B.adelfa, 0.9);
    mundo.poner(x, y + 1, z, B.adelfa);
}

function libre(x, z, radio) {
    for (let a = -radio; a <= radio; a++) for (let b = -radio; b <= radio; b++) {
        const k = k2(x + a, z + b);
        if (ocupado.has(k) || cerca.has(k) || enPlaza(x + a, z + b)) return false;
    }
    return true;
}

function crearVegetacion() {
    const puestos = [];
    const lejosDe = (x, z, r) => puestos.every(([a, b]) => Math.hypot(a - x, b - z) > r);
    for (let i = 0; i < 6000 && puestos.length < ajustes.arboles; i++) {
        const x = Math.floor(-MITAD + 3 + azar() * (MITAD * 2 - 6));
        const z = Math.floor(-MITAD + 3 + azar() * (MITAD * 2 - 6));
        if (!libre(x, z, 2) || distRio(x, z) < 1.5 || peña(x, z) > -0.06 || zonaOlivar(x, z)) continue;
        const delante = z > centroRio(x);
        if (delante && Math.abs(x - 8) < 7 && distRio(x, z) < 4) continue;
        if (!lejosDe(x, z, 6)) continue;
        puestos.push([x, z]);
        if (azar() < 0.72) castaño(x, z);
        else alcornoque(x, z);
    }
    for (let x = -MITAD + 2; x < -12; x += 4) {
        for (let z = -12; z < 16; z += 4) {
            const ox = x + Math.floor(azar() * 2);
            const oz = z + Math.floor(azar() * 2);
            if (!zonaOlivar(ox, oz) || !libre(ox, oz, 1) || !lejosDe(ox, oz, 3)) continue;
            olivo(ox, oz);
        }
    }
    for (let i = 0, n = 0; i < 600 && n < 14; i++) {
        const x = Math.floor(-16 + azar() * 58);
        const z = Math.floor(-44 + azar() * 52);
        if (!enPueblo(x, z) || !libre(x, z, 1)) continue;
        naranjo(x, z);
        n++;
    }
    for (let i = 0, n = 0; i < 900 && n < 40; i++) {
        const x = Math.floor(-MITAD + 2 + azar() * (MITAD * 2 - 4));
        const z = Math.round(centroRio(x) + (azar() < 0.5 ? -1 : 1) * (anchoRio(x) + 1 + azar() * 1.5));
        if (!dentroTrozo(x, z) || alturaEn(x, z) !== 4 || mundo.hay(x, 4, z)) continue;
        if (Math.abs(x - 8) < 4 && z > centroRio(x)) continue;
        adelfa(x, z);
        n++;
    }
    for (let x = -MITAD + 1; x < 0; x++) for (let z = -MITAD + 1; z < 0; z++) {
        const p = peña(x, z);
        if (p < -0.05 || p > 0.24) continue;
        const h = alturaEn(x, z);
        if (mundo.hay(x, h, z) || hash2(x * 1.3, z * 0.7) < 0.82) continue;
        if (alturaEn(x + 1, z) > h + 1 || alturaEn(x - 1, z) > h + 1 || alturaEn(x, z + 1) > h + 1 || alturaEn(x, z - 1) > h + 1) {
            mundo.poner(x, h, z, B.matorral);
            if (hash2(x, z) > 0.5) mundo.poner(x, h + 1, z, B.matorral);
        }
    }
}


// =====================================================================
// 11. EL REMANSO: BANCO, AGUA Y SALTO POR EL BORDE
// =====================================================================

function crearBancoRio() {
    const x = 6;
    const z = Math.round(centroRio(8) + anchoRio(8)) + 2;
    const h = alturaEn(x, z);
    banco(x * 4, h * 4, z * 4 + 1);
}

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
        uColorAgua: { value: new THREE.Color(0.1, 0.36, 0.32) },
        uCieloLuz: { value: new THREE.Color() },
        uNiebla: { value: escena.fog.color },
        uCerca: { value: escena.fog.near },
        uLejos: { value: escena.fog.far }
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
            float poza = exp(-pow((p.x - 8.0) / 6.0, 2.0));
            float corriente = mix(1.6, 0.25, poza);
            vec2 g = vec2(0.0);
            g += vec2(cos(p.x * 1.3 - uTiempo * corriente * 1.4), cos(p.y * 1.7 + uTiempo * 0.9)) * 0.03;
            g += vec2(cos(p.x * 3.1 - p.y * 1.7 - uTiempo * (1.0 + corriente * 2.0)), cos(p.y * 2.9 + p.x * 1.3 - uTiempo * 1.9)) * 0.02;
            g += vec2(cos(p.x * 7.0 + p.y * 3.0 - uTiempo * (2.0 + corriente * 3.0)), cos(p.y * 6.3 - p.x * 2.2 + uTiempo * 2.7)) * 0.01 * (0.6 + corriente);
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
            vec3 c = mix(base, reflejo, clamp(0.25 + fresnel * 0.9, 0.0, 1.0));
            vec3 H = normalize(uSol + V);
            float brillo = pow(max(dot(n, H), 0.0), 400.0) * 3.0 * (1.0 - uNoche * 0.6);
            c += uColorSol * brillo;
            float espuma = smoothstep(0.75, 0.95, sin(p.x * 2.3 - uTiempo * corriente * 3.0 + sin(p.y * 3.0) * 2.0) * 0.5 + 0.5) * (1.0 - poza) * 0.12;
            c += vec3(espuma) * (uCieloLuz * 0.6 + uColorSol * 0.4);
            float alfa = clamp(0.5 + fresnel * 0.6, 0.0, 0.96);
            gl_FragColor = vec4(mix(c, uNiebla, smoothstep(uCerca, uLejos, vDistancia)), alfa);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false
});

let agua = null;
let materialSalto = null;

function crearAgua() {
    agua = new THREE.Mesh(new THREE.PlaneGeometry(800, 24).rotateX(-Math.PI / 2), materialAgua);
    agua.position.set(0, AGUA, 19);
    agua.renderOrder = 2;
    escena.add(agua);
}

const truchas = [];

function modeloTrucha(colores) {
    const k = new Cubos(0.1);
    for (let x = -4; x <= 4; x++) {
        const ancho = x > 2 ? 1 : x < -2 ? 0 : 1;
        for (let z = -ancho; z <= ancho; z++) for (let y = 0; y <= (Math.abs(x) < 3 ? 1 : 0); y++) k.poner(x, y, z, colores[(y === 1 ? 0 : z === 0 ? 1 : (x + 7) % 3 === 0 ? 2 : 1)]);
    }
    const cuerpo = k.mallas().solida;
    const c = new Cubos(0.1);
    for (let x = -3; x <= -1; x++) for (let z = -Math.abs(x) + 1; z <= Math.abs(x) - 1; z++) c.poner(x, 0, z, colores[0]);
    c.poner(-1, 0, 0, colores[0]);
    return { cuerpo, cola: c.mallas().solida };
}

function enPoza(x, z) {
    return distRio(x, z) < -1 && Math.abs(x - 8) < 8 && alturaEn(Math.floor(x), Math.floor(z)) <= 2;
}

function crearTruchas() {
    const lomo = { c: color("#5f6340") };
    const flanco = { c: color("#b8b08c") };
    const pinta = { c: color("#9a3a2a") };
    const lomo2 = { c: color("#4f5a3c") };
    const flanco2 = { c: color("#c9c0a0") };
    const paletas = [[lomo, flanco, pinta], [lomo2, flanco2, pinta], [lomo, flanco2, lomo2]];
    const material = materialBloques(0.1, { contraste: "0.95", rango: "0.1" });
    for (let i = 0; i < ajustes.truchas; i++) {
        const modelo = modeloTrucha(paletas[i % paletas.length]);
        const grupo = new THREE.Group();
        const cuerpo = new THREE.Mesh(modelo.cuerpo, material);
        const cola = new THREE.Mesh(modelo.cola, material);
        cola.position.x = -0.4;
        grupo.add(cuerpo, cola);
        grupo.scale.setScalar(1.5 + azar() * 0.5);
        escena.add(grupo);
        const pez = { grupo, cola, x: 8, z: centroRio(8), rumbo: azar() * 6, vel: 0.6, objetivo: new THREE.Vector2(), huye: 0, fase: azar() * 6 };
        nuevoDestino(pez);
        pez.x = pez.objetivo.x;
        pez.z = pez.objetivo.y;
        nuevoDestino(pez);
        truchas.push(pez);
    }
}

function nuevoDestino(pez) {
    for (let i = 0; i < 40; i++) {
        const x = 1 + Math.random() * 14;
        const z = centroRio(x) + (Math.random() - 0.5) * 2 * anchoRio(x);
        if (enPoza(x, z)) {
            pez.objetivo.set(x, z);
            return;
        }
    }
    pez.objetivo.set(8, centroRio(8));
}

function moverTruchas(delta) {
    truchas.forEach((p) => {
        const dx = p.objetivo.x - p.x;
        const dz = p.objetivo.y - p.z;
        if (Math.hypot(dx, dz) < 0.8) nuevoDestino(p);
        let deseado = Math.atan2(dz, dx);
        let velocidad = 0.8;
        if (p.huye > 0) {
            p.huye -= delta;
            deseado = p.rumboHuida;
            velocidad = 4;
        }
        const ax = p.x + Math.cos(p.rumbo) * 1.2;
        const az = p.z + Math.sin(p.rumbo) * 1.2;
        if (!enPoza(ax, az)) deseado = Math.atan2(centroRio(8) - p.z, 8 - p.x);
        const giro = Math.atan2(Math.sin(deseado - p.rumbo), Math.cos(deseado - p.rumbo));
        p.rumbo += Math.max(-delta * 2.5, Math.min(delta * 2.5, giro));
        p.vel += (velocidad - p.vel) * Math.min(1, delta * 3);
        p.x += Math.cos(p.rumbo) * p.vel * delta;
        p.z += Math.sin(p.rumbo) * p.vel * delta;
        p.fase += delta * (4 + p.vel * 6);
        p.grupo.position.set(p.x, AGUA - 0.6 + Math.sin(p.fase * 0.3) * 0.08, p.z);
        p.grupo.rotation.y = -p.rumbo;
        p.cola.rotation.y = Math.sin(p.fase) * 0.5;
    });
}

function asustarTruchas(x, z) {
    truchas.forEach((p) => {
        if (Math.hypot(p.x - x, p.z - z) > 5) return;
        p.huye = 0.8;
        p.rumboHuida = Math.atan2(p.z - z, p.x - x);
    });
}


// =====================================================================
// 12. LOS ALREDEDORES
// Más allá del pueblo el terreno sigue con cubos grandes: castañares,
// la Serranía, Sierra Bermeja (roja), la costa y el Peñón de Gibraltar
// saliendo del mar.
// =====================================================================

const lejos = new Cubos(4);

function crearAlrededores() {
    const n = movil ? 66 : 88;
    const altos = new Map();
    const llave = (i, j) => i * 1000 + j;
    const dentro = (i, j) => i * 4 < MITAD && i * 4 + 4 > -MITAD && j * 4 < MITAD && j * 4 + 4 > -MITAD;
    for (let i = -n - 1; i <= n + 1; i++) for (let j = -n - 1; j <= n + 1; j++) altos.set(llave(i, j), Math.round(alturaBase(i * 4 + 2, j * 4 + 2) / 4));
    const hojas = [B.hojaCobre, B.hojaDorada, B.hojaVerdosa, B.hojaRojiza, B.hojaCobre];
    for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
            if (dentro(i, j)) continue;
            const wx = i * 4 + 2;
            const wz = j * 4 + 2;
            const a = altos.get(llave(i, j));
            if (a < 0 && wz > 60) continue;
            let minimo = a;
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([p, q]) => (minimo = Math.min(minimo, altos.get(llave(i + p, j + q)))));
            const bermeja = wx > 110 && wz < 90 && wz > -200;
            const gibraltar = wz > 170;
            const h = a * 4;
            for (let y = Math.min(a - 1, minimo - 1); y < a; y++) {
                let b = bermeja ? B.peridotita : B.piedra;
                if (y === a - 1) {
                    if (a <= 0) b = wz > 60 ? B.arena : B.grava;
                    else if (bermeja) b = h > 40 ? B.peridotita : B.monte;
                    else if (gibraltar || h > 56) b = B.caliza;
                    else if (h > 34) b = B.monte;
                    else b = hash2(i, j) > 0.7 ? B.hierbaSeca : B.hierba;
                } else if (!bermeja && a - y <= 2) b = B.tierra;
                lejos.poner(i, y, j, b);
            }
            if (!gibraltar && !bermeja && a >= 2 && h < 48 && wz < 110) {
                const k = hash2(i * 1.7, j * 2.3);
                if (k < fbm2(wx * 0.02, wz * 0.02 + 7) * 0.95) {
                    lejos.poner(i, a, j, k < 0.12 ? B.hojaAlcornoque : hojas[Math.floor(hash2(i, j) * hojas.length)], 0.1);
                    if (k < 0.05) lejos.poner(i, a + 1, j, B.hojaCobre, 0.1);
                }
            }
        }
    }
}

let mar = null;

function crearMar() {
    mar = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2c6a8e }));
    mar.position.set(0, -1.5, 1100);
    mar.layers.set(1);
    escena.add(mar);
}


// =====================================================================
// 13. FLORES Y HIERBA ALTA
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
        if (i === 0 || i === 5) {
            const tonos = i === 0 ? ["#6f9a3c", "#86a848", "#5f8a34"] : ["#c8b064", "#b8a058", "#d6c078"];
            for (let k = 0; k < 9; k++) {
                const x = 1 + Math.floor(azar() * 14);
                const alto = 5 + Math.floor(azar() * 10);
                for (let y = 15; y > 15 - alto; y--) px(i, x + (y < 8 && k % 2 ? 1 : 0), y, tonos[(x + y) % 3]);
            }
            continue;
        }
        for (let y = 7; y < 16; y++) px(i, 7 + (y > 12 ? 1 : 0), y, "#4f8a30");
        px(i, 6, 11, "#4f8a30");
        px(i, 5, 10, "#4f8a30");
        px(i, 9, 12, "#4f8a30");
        px(i, 10, 11, "#4f8a30");
        const c = ["", "#f5d533", "#a678e0", "#f4f2ec", "#e0402f"][i];
        const centro = ["", "#f09a20", "#f0d040", "#f0c030", "#2a1a10"][i];
        [[7, 3], [6, 4], [8, 4], [7, 5], [6, 5], [8, 5], [7, 6], [5, 5], [9, 5]].forEach(([x, y]) => px(i, x, y, c));
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
    for (let i = 0, puestas = 0; i < ajustes.flores * 10 && puestas < ajustes.flores; i++) {
        const ix = Math.floor(-MITAD + azar() * MITAD * 2);
        const iz = Math.floor(-MITAD + azar() * MITAD * 2);
        const h = alturaEn(ix, iz);
        const arriba = mundo.que(ix, h - 1, iz);
        if (arriba !== B.hierba && arriba !== B.hierbaSeca) continue;
        if (mundo.hay(ix, h, iz)) continue;
        const seca = arriba === B.hierbaSeca;
        const r = azar();
        const tipo = seca ? (r < 0.7 ? 5 : r < 0.85 ? 1 : 2) : r < 0.55 ? 0 : r < 0.7 ? 5 : 1 + Math.floor(azar() * 4);
        datos.push(ix + 0.2 + azar() * 0.6, h, iz + 0.2 + azar() * 0.6, tipo);
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
        uniforms: { ...comunes, tAtlas: { value: atlasFlores() }, uCieloLuz: { value: new THREE.Color() }, uFuerza: { value: 1 }, uNiebla: { value: escena.fog.color }, uCerca: { value: escena.fog.near }, uLejos: { value: escena.fog.far } },
        vertexShader: `
            attribute vec4 aDatos;
            uniform float uTiempo;
            varying vec2 vUv;
            varying float vDistancia;
            void main() {
                vec3 p = position * 0.8 + aDatos.xyz;
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
// 14. LOS BUITRES
// Tres buitres leonados dan vueltas sobre la peña, planeando y
// batiendo las alas de vez en cuando.
// =====================================================================

const buitres = [];

function crearBuitres() {
    const marron = { c: color("#7a5a3a") };
    const oscuro = { c: color("#3a2a1c") };
    const crema = { c: color("#e6d8bc") };
    const cuerpo = new Cubos(0.2);
    for (let x = -3; x <= 3; x++) cuerpo.poner(x, 0, 0, marron);
    cuerpo.poner(3, 0, 1, crema);
    cuerpo.poner(3, 0, -1, crema);
    cuerpo.poner(4, 0, 0, crema);
    cuerpo.poner(5, 0, 0, oscuro);
    for (let z = -1; z <= 1; z++) {
        cuerpo.poner(-4, 0, z, oscuro);
        cuerpo.poner(-5, 0, z, oscuro);
    }
    const ala = new Cubos(0.2);
    for (let z = 1; z <= 7; z++) {
        for (let x = -1; x <= 1; x++) {
            if (z >= 6 && x === -1 && z % 2 === 0) continue;
            ala.poner(x, 0, z, z >= 5 || x === -1 ? oscuro : marron);
        }
    }
    const gCuerpo = cuerpo.mallas().solida;
    const gAla = ala.mallas().solida;
    const material = materialBloques(0.2, { contraste: "0.9", rango: "0.2" });
    for (let i = 0; i < 3; i++) {
        const grupo = new THREE.Group();
        grupo.add(new THREE.Mesh(gCuerpo, material));
        const izq = new THREE.Mesh(gAla, material);
        const der = new THREE.Mesh(gAla, material);
        izq.position.z = 0.1;
        der.scale.z = -1;
        der.position.z = 0.1;
        grupo.add(izq, der);
        grupo.rotation.order = "YXZ";
        escena.add(grupo);
        buitres.push({ grupo, izq, der, angulo: i * 2.1, radio: 14 + i * 6, alto: 60 + i * 5, vel: 0.12 + i * 0.02, aleteo: 0 });
    }
}

function moverBuitres(delta, t) {
    buitres.forEach((b, i) => {
        b.angulo += b.vel * delta;
        const r = b.radio + Math.sin(t * 0.1 + i) * 3;
        const x = centroCastillo.x + Math.cos(b.angulo) * r;
        const z = centroCastillo.z + Math.sin(b.angulo) * r;
        const y = b.alto + Math.sin(t * 0.3 + i * 2) * 2;
        b.grupo.position.set(x, y, z);
        const rumbo = Math.atan2(Math.cos(b.angulo), -Math.sin(b.angulo));
        b.grupo.rotation.set(-0.35, -rumbo, 0);
        b.aleteo -= delta;
        let alas = 0.08;
        if (b.aleteo < 0 && b.aleteo > -1.4) alas = 0.08 + Math.sin((b.aleteo + 1.4) * 9) * 0.45;
        if (b.aleteo < -1.4) b.aleteo = 6 + Math.random() * 8;
        b.izq.rotation.x = -alas;
        b.der.rotation.x = alas;
    });
}


// =====================================================================
// 14b. LAS PALOMAS DE LA PLAZA
// Andan y picotean por el suelo. Si las tocas (o tocas cerca) salen
// volando a los tejados y al rato vuelven a bajar.
// =====================================================================

const palomas = [];

function puntoPlaza() {
    const arboles = [[9.5, -2.5], [24.5, -3.5], [9.5, 1.5], [24.5, 1.5]];
    for (let i = 0; i < 40; i++) {
        const x = 9.5 + Math.random() * 15;
        const z = -5.5 + Math.random() * 8;
        if (x > 13.6 && x < 18.2 && z > -4.4 && z < -2) continue;
        if (arboles.some(([a, b]) => Math.hypot(x - a, z - b) < 1.4)) continue;
        return new THREE.Vector3(x, nivelPlaza, z);
    }
    return new THREE.Vector3(18, nivelPlaza, -1);
}

function crearPalomas() {
    const gris = { c: [color("#8c919a"), color("#959aa3")] };
    const oscuro = { c: color("#5a5f68") };
    const cuello = { c: [color("#5f8a78"), color("#6a7a90")] };
    const pico = { c: color("#3a3232") };
    const pata = { c: color("#c4645a") };
    const cuerpo = new Cubos(0.08);
    for (let x = -2; x <= 2; x++) for (let z = -1; z <= 1; z++) for (let y = 1; y <= 2; y++) cuerpo.poner(x, y, z, gris);
    cuerpo.poner(3, 2, 0, cuello);
    cuerpo.poner(3, 3, 0, oscuro);
    cuerpo.poner(4, 3, 0, pico);
    for (let z = -1; z <= 1; z++) cuerpo.poner(-3, 2, z, oscuro);
    cuerpo.poner(-4, 2, 0, oscuro);
    cuerpo.poner(0, 0, 0, pata);
    const ala = new Cubos(0.08);
    for (let x = -2; x <= 1; x++) for (let z = 0; z <= 3; z++) ala.poner(x, 0, z, x === -1 && z < 3 ? oscuro : gris);
    const gCuerpo = cuerpo.mallas().solida;
    const gAla = ala.mallas().solida;
    const material = materialBloques(0.08, { contraste: "0.92", rango: "0.16" });
    for (let i = 0; i < ajustes.palomas; i++) {
        const grupo = new THREE.Group();
        const malla = new THREE.Mesh(gCuerpo, material);
        malla.castShadow = true;
        const izq = new THREE.Mesh(gAla, material);
        const der = new THREE.Mesh(gAla, material);
        izq.position.set(0, 0.2, 0.12);
        der.position.set(0, 0.2, -0.12);
        der.scale.z = -1;
        grupo.add(malla, izq, der);
        grupo.rotation.order = "YXZ";
        escena.add(grupo);
        const pos = puntoPlaza();
        palomas.push({ grupo, izq, der, estado: "suelo", pos, rumbo: Math.random() * 6, objetivo: puntoPlaza(), pausa: Math.random() * 3, fase: Math.random() * 6, t: 0, dur: 1, desde: new THREE.Vector3(), hasta: new THREE.Vector3(), luego: "suelo", espera: 0 });
    }
}

function volar(p, destino, luego) {
    p.desde.copy(p.pos);
    p.hasta.copy(destino);
    p.dur = 0.8 + p.desde.distanceTo(destino) / 6;
    p.t = 0;
    p.luego = luego;
    p.estado = "vuela";
    p.rumbo = Math.atan2(destino.z - p.pos.z, destino.x - p.pos.x);
}

function asustarPalomas(punto, radio) {
    let alguna = false;
    palomas.forEach((p) => {
        if (p.estado !== "suelo" || p.pos.distanceTo(punto) > radio) return;
        const sitio = posaderos.length ? posaderos[Math.floor(Math.random() * posaderos.length)] : puntoPlaza().setY(nivelPlaza + 6);
        setTimeout(() => volar(p, sitio, "tejado"), Math.random() * 250);
        alguna = true;
    });
    if (alguna) sonarAleteo();
}

function palomaTocada(rayo) {
    let mejor = null;
    palomas.forEach((p) => {
        if (rayo.distanceSqToPoint(p.pos) > 0.36) return;
        const d = p.pos.distanceTo(rayo.origin);
        if (!mejor || d < mejor.d) mejor = { d, p: p.pos.clone() };
    });
    return mejor;
}

let siguienteVuelo = 12;

function moverPalomas(delta, t) {
    siguienteVuelo -= delta;
    if (siguienteVuelo < 0) {
        siguienteVuelo = 15 + Math.random() * 25;
        const p = palomas[Math.floor(Math.random() * palomas.length)];
        if (p && p.estado === "suelo" && posaderos.length) volar(p, posaderos[Math.floor(Math.random() * posaderos.length)], "tejado");
    }
    palomas.forEach((p, i) => {
        let pico = 0;
        let alas = 0;
        let alto = 0;
        if (p.estado === "suelo") {
            if (p.pausa > 0) {
                p.pausa -= delta;
                pico = Math.sin(t * 9 + i) > 0.4 ? -0.55 : 0;
            } else {
                const dx = p.objetivo.x - p.pos.x;
                const dz = p.objetivo.z - p.pos.z;
                const lejos = Math.hypot(dx, dz);
                if (lejos < 0.1) {
                    p.pausa = 1 + Math.random() * 4;
                    p.objetivo = puntoPlaza();
                } else {
                    const deseado = Math.atan2(dz, dx);
                    p.rumbo += Math.atan2(Math.sin(deseado - p.rumbo), Math.cos(deseado - p.rumbo)) * Math.min(1, delta * 6);
                    const paso = Math.min(lejos, delta * 0.55);
                    p.pos.x += Math.cos(p.rumbo) * paso;
                    p.pos.z += Math.sin(p.rumbo) * paso;
                    alto = Math.abs(Math.sin(t * 14 + i)) * 0.03;
                    pico = Math.sin(t * 14 + i) * 0.12;
                }
            }
        } else if (p.estado === "vuela") {
            p.t = Math.min(1, p.t + delta / p.dur);
            const k = p.t;
            p.pos.lerpVectors(p.desde, p.hasta, k);
            p.pos.y += Math.sin(k * Math.PI) * (1.5 + p.desde.distanceTo(p.hasta) * 0.15);
            alas = Math.sin(t * 40 + i) * 0.9;
            if (k >= 1) {
                p.estado = p.luego;
                p.espera = 8 + Math.random() * 14;
                p.pausa = 1;
                p.objetivo = puntoPlaza();
            }
        } else {
            p.espera -= delta;
            pico = Math.sin(t * 0.7 + i) > 0.95 ? -0.3 : 0;
            if (p.espera < 0) volar(p, puntoPlaza(), "suelo");
        }
        p.grupo.position.set(p.pos.x, p.pos.y + alto, p.pos.z);
        p.grupo.rotation.set(0, -p.rumbo, pico + (p.estado === "vuela" ? 0.15 : 0));
        p.izq.rotation.x = -alas - (p.estado === "vuela" ? 0.3 : 0);
        p.der.rotation.x = alas + (p.estado === "vuela" ? 0.3 : 0);
    });
}


// =====================================================================
// 15. PARTÍCULAS: HUMO, HOJAS, LUCIÉRNAGAS, LUCES Y ESPUMA
// =====================================================================

function particulas(n, opciones) {
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometria.setAttribute("aDatos", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (opciones.colores) geometria.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTam: { value: opciones.tam }, uColor: { value: opciones.color }, uNoche: comunes.uNoche, uColorSol: comunes.uColorSol, uEscala: { value: 1 } },
        vertexShader: `
            attribute vec2 aDatos;
            ${opciones.colores ? "attribute vec3 aColor;" : ""}
            uniform float uTam;
            uniform float uEscala;
            varying vec2 vDatos;
            varying vec3 vColor;
            void main() {
                vDatos = aDatos;
                vColor = ${opciones.colores ? "aColor" : "vec3(1.0)"};
                vec4 vista = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = uTam * uEscala * aDatos.y / -vista.z;
                gl_Position = projectionMatrix * vista;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uNoche;
            uniform vec3 uColorSol;
            varying vec2 vDatos;
            varying vec3 vColor;
            void main() {
                vec2 d = abs(gl_PointCoord - 0.5);
                ${opciones.forma === "cuadro" ? "if (max(d.x, d.y) > 0.32) discard; float a = vDatos.x;" : "float r = length(d) * 2.0; float a = (exp(-r * r * 4.0) * 0.6 + exp(-r * r * 30.0)) * vDatos.x;"}
                vec3 c = uColor * vColor * ${opciones.ilumina ? "(uColorSol * 0.7 + 0.35)" : "1.0"};
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
    return { puntos, material, pos: geometria.attributes.position, datos: geometria.attributes.aDatos, colores: geometria.attributes.aColor, vida: new Float32Array(n), vel: Array.from({ length: n }, () => new THREE.Vector3()), n };
}

let humo;
let hojas;
let luciernagas;
let brillos;

function crearParticulas() {
    if (!origenHojas.length) origenHojas.push({ p: new THREE.Vector3(0, 20, 0), color: B.hojaCobre });
    const fuegos = chimeneas.slice(0, 6);
    humo = particulas(fuegos.length ? 72 : 0, { tam: 420, color: new THREE.Color(0.86, 0.87, 0.89), forma: "cuadro", ilumina: true });
    hojas = particulas(90, { tam: 70, color: new THREE.Color(1, 1, 1), forma: "cuadro", ilumina: true, colores: true });
    luciernagas = particulas(50, { tam: 160, color: new THREE.Color(0.75, 1, 0.35), aditivo: true });
    brillos = particulas(luces.length, { tam: 900, color: new THREE.Color(1, 0.7, 0.35), aditivo: true });
    humo.fuegos = fuegos;
    for (let i = 0; i < humo.n; i++) {
        const c = fuegos[i % fuegos.length];
        const v = (i + 0.5) / humo.n;
        const edad = (1 - v) / 0.16;
        humo.vida[i] = v;
        humo.vel[i].set(0.25 + Math.random() * 0.2, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2);
        humo.pos.setXYZ(i, c.x + humo.vel[i].x * edad, c.y + humo.vel[i].y * edad, c.z + humo.vel[i].z * edad);
    }
    for (let i = 0; i < hojas.n; i++) {
        const o = origenHojas[i % origenHojas.length];
        const col = Array.isArray(o.color.c) ? o.color.c[i % o.color.c.length] : o.color.c;
        hojas.colores.setXYZ(i, col.r, col.g, col.b);
        hojas.vida[i] = (i + 0.5) / hojas.n;
        reiniciarHoja(i, true);
    }
    hojas.colores.needsUpdate = true;
    luces.forEach((l, i) => brillos.pos.setXYZ(i, l.x, l.y, l.z));
    brillos.pos.needsUpdate = true;
    for (let i = 0; i < 50; i++) {
        const x = -50 + Math.random() * 100;
        luciernagas.vel[i].set(x, AGUA + 1 + Math.random() * 3, centroRio(x) + (Math.random() - 0.5) * 12);
        luciernagas.vida[i] = Math.random() * 100;
    }
}

function reiniciarHoja(i, repartir) {
    const o = origenHojas[i % origenHojas.length];
    const vida = repartir ? hojas.vida[i] : 1;
    hojas.vida[i] = vida;
    hojas.vel[i].set(0.5 + Math.random() * 0.5, -0.8 - Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
    const edad = repartir ? (1 - vida) / 0.11 : 0;
    const x = o.p.x + (Math.random() - 0.5) * 6 + hojas.vel[i].x * edad;
    const z = o.p.z + (Math.random() - 0.5) * 6;
    const suelo = alturaEn(Math.floor(x), Math.floor(z));
    hojas.pos.setXYZ(i, x, Math.max(suelo + 0.05, o.p.y + Math.random() * 2 + hojas.vel[i].y * edad), z);
}

function moverParticulas(delta, t) {
    for (let i = 0; i < humo.n; i++) {
        humo.vida[i] -= delta * 0.16;
        if (humo.vida[i] <= 0) {
            const c = humo.fuegos[i % humo.fuegos.length];
            humo.vida[i] = 1;
            humo.pos.setXYZ(i, c.x + (Math.random() - 0.5) * 0.4, c.y, c.z + (Math.random() - 0.5) * 0.4);
            humo.vel[i].set(0.25 + Math.random() * 0.2, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2);
        }
        humo.pos.setXYZ(i, humo.pos.getX(i) + humo.vel[i].x * delta, humo.pos.getY(i) + humo.vel[i].y * delta, humo.pos.getZ(i) + humo.vel[i].z * delta);
        const v = humo.vida[i];
        humo.datos.setXY(i, Math.sin(v * Math.PI) * 0.35, 0.4 + (1 - v) * 1.8);
    }
    for (let i = 0; i < hojas.n; i++) {
        hojas.vida[i] -= delta * 0.11;
        if (hojas.vida[i] <= 0) reiniciarHoja(i, false);
        const fase = t * 2 + i;
        const x = hojas.pos.getX(i) + (hojas.vel[i].x + Math.sin(fase) * 0.6) * delta;
        const z = hojas.pos.getZ(i) + (hojas.vel[i].z + Math.cos(fase * 0.7) * 0.4) * delta;
        const suelo = Math.max(alturaEn(Math.floor(x), Math.floor(z)), distRio(x, z) < 0 ? AGUA : -99) + 0.05;
        hojas.pos.setXYZ(i, x, Math.max(suelo, hojas.pos.getY(i) + hojas.vel[i].y * delta), z);
        hojas.datos.setXY(i, Math.max(0, Math.min(1, hojas.vida[i] * 4)), 1);
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
    for (let i = 0; i < luces.length; i++) brillos.datos.setXY(i, (0.1 + noche * 0.9) * (0.92 + 0.08 * Math.sin(t * 9 + i)), 1);
    brillos.datos.needsUpdate = true;
    [humo, hojas].forEach((p) => {
        p.pos.needsUpdate = true;
        p.datos.needsUpdate = true;
    });
}


// =====================================================================
// 16. EL CIELO Y LOS MOMENTOS DEL DÍA
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
            float nube = step(0.66, ruido(q * 0.35)) * smoothstep(0.05, 0.25, d.y);
            c = mix(c, mix(vec3(1.0), uHorizonte, 0.2) * (1.0 - uNoche * 0.9), nube * 0.7);
            vec3 e = floor(d * 260.0);
            float estrella = step(0.9975, fract(sin(dot(e, vec3(12.9898, 78.233, 37.719))) * 43758.5453));
            c += estrella * uNoche * smoothstep(0.02, 0.25, d.y) * (0.6 + 0.4 * sin(uTiempo * 2.0 + e.x));
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
const bovedaCielo = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), materialCielo);
bovedaCielo.frustumCulled = false;
bovedaCielo.renderOrder = -10;
escena.add(bovedaCielo);

const MOMENTOS = {
    dia: { sol: [0.4, 0.78, 0.55], colorSol: [1, 0.96, 0.88], intensidad: 2.6, cielo: [0.72, 0.84, 1], suelo: [0.42, 0.36, 0.28], hemi: 1.15, arriba: [0.3, 0.54, 0.9], horizonte: [0.8, 0.88, 0.97], niebla: [0.78, 0.86, 0.95], agua: [0.1, 0.38, 0.34], noche: 0, exposicion: 1.05 },
    atardecer: { sol: [-0.68, 0.28, 0.66], colorSol: [1, 0.6, 0.34], intensidad: 2.7, cielo: [0.66, 0.56, 0.66], suelo: [0.36, 0.25, 0.2], hemi: 1.0, arriba: [0.28, 0.3, 0.58], horizonte: [1, 0.66, 0.46], niebla: [0.94, 0.72, 0.6], agua: [0.16, 0.3, 0.36], noche: 0.15, exposicion: 1.08 },
    noche: { sol: [-0.3, 0.65, 0.6], colorSol: [0.5, 0.6, 0.95], intensidad: 0.5, cielo: [0.2, 0.25, 0.42], suelo: [0.06, 0.06, 0.09], hemi: 0.8, arriba: [0.01, 0.015, 0.05], horizonte: [0.05, 0.07, 0.14], niebla: [0.05, 0.07, 0.13], agua: [0.03, 0.08, 0.1], noche: 1, exposicion: 1.35 }
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
    if (materialSalto) materialSalto.uniforms.uLuz.value.copy(cielo.color).multiplyScalar(cielo.intensity * 0.6).add(auxColor.copy(comunes.uColorSol.value).multiplyScalar(sol.intensity * 0.12));
    sol.color.copy(comunes.uColorSol.value);
    sol.intensity += (m.intensidad - sol.intensity) * k;
    cielo.intensity += (m.hemi - cielo.intensity) * k;
    comunes.uNoche.value += (m.noche - comunes.uNoche.value) * k;
    renderizador.toneMappingExposure += (m.exposicion - renderizador.toneMappingExposure) * k;
    sol.position.copy(comunes.uSol.value).multiplyScalar(120).add(sol.target.position);
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
// 17. MIRAR Y TOCAR: LAS PALOMAS, EL CAMPANARIO, EL CASTILLO Y EL RÍO
// =====================================================================

const rayo = new THREE.Raycaster();
const auxRaton = new THREE.Vector2();
const planoAgua = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AGUA);
const auxCorte = new THREE.Vector3();
const pista = document.getElementById("pista");
let pulsado = null;

const punteros = new Map();
let pellizco = 0;
const lienzo = renderizador.domElement;

lienzo.addEventListener("pointerdown", (evento) => {
    punteros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    lienzo.setPointerCapture(evento.pointerId);
    pulsado = punteros.size === 1 ? { x: evento.clientX, y: evento.clientY } : null;
    if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        pellizco = Math.hypot(a.x - b.x, a.y - b.y);
    }
    orbita.auto = false;
    pista.classList.add("oculta");
});

lienzo.addEventListener("pointermove", (evento) => {
    const antes = punteros.get(evento.pointerId);
    if (!antes) return;
    const dx = evento.clientX - antes.x;
    const dy = evento.clientY - antes.y;
    punteros.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pellizco > 0) orbita.objetivoRadio = Math.max(16, Math.min(56, orbita.objetivoRadio * (pellizco / d)));
        pellizco = d;
        return;
    }
    const escala = 4.5 / Math.max(innerHeight, 400);
    orbita.objetivoTheta = Math.max(-0.95, Math.min(1.15, orbita.objetivoTheta - dx * escala));
    orbita.objetivoPhi = Math.max(1.12, Math.min(1.52, orbita.objetivoPhi - dy * escala));
});

const soltar = (evento) => {
    punteros.delete(evento.pointerId);
    if (punteros.size < 2) pellizco = 0;
};

lienzo.addEventListener("pointercancel", (evento) => {
    soltar(evento);
    pulsado = null;
});

lienzo.addEventListener("wheel", (evento) => {
    evento.preventDefault();
    orbita.objetivoRadio = Math.max(16, Math.min(56, orbita.objetivoRadio * (1 + evento.deltaY * 0.001)));
}, { passive: false });

lienzo.addEventListener("pointerup", (evento) => {
    soltar(evento);
    if (!pulsado) return;
    const movido = Math.hypot(evento.clientX - pulsado.x, evento.clientY - pulsado.y);
    pulsado = null;
    if (movido > 8) return;
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(auxRaton, camara);
    const toques = [];
    if (rayo.ray.intersectBox(zonaIglesia, auxCorte)) toques.push(["iglesia", auxCorte.distanceTo(rayo.ray.origin)]);
    if (rayo.ray.intersectBox(zonaCastillo, auxCorte)) toques.push(["castillo", auxCorte.distanceTo(rayo.ray.origin)]);
    planoPlaza.constant = -nivelPlaza;
    if (rayo.ray.intersectPlane(planoPlaza, auxCorte) && enPlaza(Math.floor(auxCorte.x), Math.floor(auxCorte.z))) {
        toques.push(["plaza", auxCorte.distanceTo(rayo.ray.origin), auxCorte.clone()]);
    }
    if (rayo.ray.intersectPlane(planoAgua, auxCorte) && dentroTrozo(Math.floor(auxCorte.x), Math.floor(auxCorte.z)) && alturaEn(Math.floor(auxCorte.x), Math.floor(auxCorte.z)) <= 3) {
        toques.push(["agua", auxCorte.distanceTo(rayo.ray.origin), auxCorte.clone()]);
    }
    const paloma = palomaTocada(rayo.ray);
    if (paloma) toques.push(["paloma", paloma.d, paloma.p]);
    if (!toques.length) return;
    toques.sort((a, b) => a[1] - b[1]);
    const [que, , punto] = toques[0];
    if (que === "agua") {
        soltarOnda(punto.x, punto.z, 1);
        asustarTruchas(punto.x, punto.z);
        sonarGota(0.6);
    } else if (que === "iglesia") {
        tocarCampanas();
    } else if (que === "castillo") {
        buitres.forEach((b) => (b.aleteo = 0));
        sonarBuitre();
    } else {
        asustarPalomas(punto, que === "paloma" ? 3 : 6);
    }
});

const planoPlaza = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const techos = new Map();

function calcularTechos() {
    mundo.mapa.forEach((v) => {
        const k = k2(v.x, v.z);
        techos.set(k, Math.max(techos.get(k) ?? -99, v.y + 1));
    });
    medio.mapa.forEach((v) => {
        const k = k2(Math.floor(v.x / 2), Math.floor(v.z / 2));
        techos.set(k, Math.max(techos.get(k) ?? -99, (v.y + 1) / 2));
    });
}

function techoEn(x, z) {
    let maximo = -99;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) maximo = Math.max(maximo, techos.get(k2(Math.floor(x) + a, Math.floor(z) + b)) ?? alturaBase(Math.floor(x), Math.floor(z)));
    return maximo;
}

function moverMirada(delta) {
    if (orbita.auto) {
        orbita.reloj += delta;
        orbita.objetivoTheta = orbita.base + Math.sin(orbita.reloj * 0.06) * 0.7;
    }
    const k = delta <= 0 ? 1 : 1 - Math.exp(-delta * 6);
    orbita.theta += (orbita.objetivoTheta - orbita.theta) * k;
    orbita.phi += (orbita.objetivoPhi - orbita.phi) * k;
    orbita.radio += (orbita.objetivoRadio - orbita.radio) * k;
    const c = orbita.centro;
    const sp = Math.sin(orbita.phi);
    camara.position.set(c.x + Math.sin(orbita.theta) * sp * orbita.radio, c.y + Math.cos(orbita.phi) * orbita.radio, c.z + Math.cos(orbita.theta) * sp * orbita.radio);
    const falta = Math.max(0, techoEn(camara.position.x, camara.position.z) + 2.5 - camara.position.y);
    orbita.alzado += (falta - orbita.alzado) * (delta <= 0 ? 1 : 1 - Math.exp(-delta * 4));
    camara.position.y += Math.max(orbita.alzado, falta * 0.6);
    camara.lookAt(c);
}

function tocarCampanas() {
    campanas.forEach((c, i) => (c.velocidad += i === 0 ? 2.6 : -2.2));
    sonarCampanas();
}

function moverCampanas(delta) {
    campanas.forEach((c) => {
        c.velocidad += -c.angulo * 9 * delta - c.velocidad * 0.5 * delta;
        c.angulo += c.velocidad * delta;
        if (c.eje === "x") c.malla.rotation.x = c.angulo;
        else c.malla.rotation.z = c.angulo;
    });
}

let siguientePez = 3;

function vidaDelAgua(delta) {
    ondas.forEach((o) => (o.z += delta));
    siguientePez -= delta;
    if (siguientePez > 0 || !truchas.length) return;
    siguientePez = 2.5 + Math.random() * 4;
    const p = truchas[Math.floor(Math.random() * truchas.length)];
    soltarOnda(p.x, p.z, 0.45);
}


// =====================================================================
// 18. SONIDO
// El río de fondo, pájaros de día, grillos y un cárabo de noche, y las
// campanas cuando se toca el campanario.
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
    for (let i = 0; i < largo; i++) datos[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    const lfo = ctx.createOscillator();
    const lfoVol = ctx.createGain();
    lfo.frequency.value = 0.13;
    lfoVol.gain.value = 0.03;
    lfo.connect(lfoVol).connect(g.gain);
    lfo.start();
    s.connect(f).connect(g).connect(general);
    s.start();
    return { ctx, general, siguiente: 1, buho: 8 };
}

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
    const base = 280 + Math.random() * 200;
    pitido(base, base * (2.5 + Math.random()), 0.08 + fuerza * 0.05, 0.12 * fuerza);
}

function golpeCampana(base, retraso) {
    [[0.5, 0.16, 3.5], [1, 0.22, 2.6], [1.19, 0.12, 2], [1.5, 0.1, 1.6], [2, 0.08, 1.3], [2.51, 0.05, 0.9], [2.66, 0.04, 0.8]].forEach(([r, v, d]) => pitido(base * r, base * r * 0.998, d, v, retraso));
}

function sonarCampanas() {
    if (!audio || !sonidoActivo) return;
    for (let i = 0; i < 4; i++) golpeCampana(i % 2 === 0 ? 392 : 330, i * 0.75);
}

function sonarAleteo() {
    if (!audio || !sonidoActivo) return;
    const ctx = audio.ctx;
    const dur = 0.7;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    for (let i = 0; i < datos.length; i++) {
        const t = i / ctx.sampleRate;
        datos[i] = (Math.random() * 2 - 1) * Math.max(0, Math.sin(t * Math.PI * 2 * 11)) * (1 - t / dur);
    }
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.frequency.value = 1400;
    const vol = ctx.createGain();
    vol.gain.value = 0.35;
    fuente.connect(filtro).connect(vol).connect(audio.general);
    fuente.start();
    fuente.onended = () => fuente.disconnect();
}

function sonarBuitre() {
    if (!audio || !sonidoActivo) return;
    pitido(900, 500, 0.25, 0.03, 0, "sawtooth");
}

function moverSonido(delta) {
    if (!audio || !sonidoActivo) return;
    audio.siguiente -= delta;
    if (momento === "noche") {
        audio.buho -= delta;
        if (audio.buho < 0) {
            audio.buho = 9 + Math.random() * 10;
            pitido(420, 400, 0.5, 0.05, 0, "sine");
            pitido(400, 360, 0.9, 0.05, 0.8, "sine");
        }
    }
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
// 19. LAS TARJETAS
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
// 20. TAMAÑO, CARGA Y BUCLE
// =====================================================================

function ajustarFov() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 64 : orbita.fov;
    camara.updateProjectionMatrix();
}

function ajustarTamano() {
    ajustarFov();
    renderizador.setSize(innerWidth, innerHeight);
    const tam = renderizador.getDrawingBufferSize(new THREE.Vector2());
    if (objetivoReflejo) objetivoReflejo.dispose();
    objetivoReflejo = new THREE.WebGLRenderTarget(Math.round(tam.x * ajustes.reflejo), Math.round(tam.y * ajustes.reflejo), { type: THREE.HalfFloatType });
    materialAgua.uniforms.tReflejo.value = objetivoReflejo.texture;
    const escala = tam.y / 900;
    [humo, hojas, luciernagas, brillos].forEach((p) => p && (p.material.uniforms.uEscala.value = escala));
}

window.addEventListener("resize", ajustarTamano);

const cargando = document.getElementById("cargando");
const reloj = new THREE.Clock();
const planoRecorte = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AGUA + 0.05);
let listo = false;
let fotograma = 0;

function construir() {
    calcularAlturas();
    planearCasas();
    crearTerreno();
    crearRocasRio();
    crearPueblo();
    crearIglesia();
    crearCastillo();
    crearVegetacion();
    crearBancoRio();
    crearAlrededores();
    añadir(mundo, "");
    añadir(medio, "medio");
    añadir(fino, "fina");
    añadir(lejos, "lejos", false, true).forEach((m) => m.layers.set(1));
    crearMar();
    crearAgua();
    crearTruchas();
    crearBuitres();
    crearPalomas();
    materialFlores = crearFlores();
    crearParticulas();
    calcularTechos();
    if (innerWidth < innerHeight) orbita.radio = orbita.objetivoRadio = 46;
    ajustarTamano();
    aplicarMomento(-1);
    cambiarMomento(momento);
    moverMirada(0);
    renderizador.compile(escena, camara);
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
}

function dibujar() {
    fotograma++;
    if (fotograma % 2 === 1) {
        camaraReflejo.copy(camara);
        camaraReflejo.position.y = 2 * AGUA - camara.position.y;
        camaraReflejo.rotation.set(-camara.rotation.x, camara.rotation.y, 0, "YXZ");
        camaraReflejo.layers.set(0);
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
    moverMirada(delta);
    moverPalomas(delta, t);
    vidaDelAgua(delta);
    moverTruchas(delta);
    moverBuitres(delta, t);
    moverCampanas(delta);
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
