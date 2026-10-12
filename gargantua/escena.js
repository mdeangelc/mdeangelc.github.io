import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// =====================================================================
// 1. AJUSTES
// Gargantua solo, flotando en el espacio. El disco de gas son
// varias capas que giran (más rápido por dentro), la luz doblada son
// dos arcos que abrazan la sombra negra, las estrellas de detrás se
// deforman por la gravedad y un resplandor en varias capas hace brillar
// lo caliente. Al cargar, el gas se va encendiendo en espiral. El
// ratón solo inclina un poco la vista.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.75,
    resolucionMin: movil ? 0.75 : 1
};
const ALTURA = 3.6;
const CENTRO = new THREE.Vector3(0, ALTURA, 0);
const OBJETIVO = new THREE.Vector3(0, ALTURA - 0.2, 0);
const CAPA_BRILLO = 1;
const BASE_GIRO = 0.16;
const BASE_ALTURA = 0.19;


// =====================================================================
// 2. RENDERIZADOR, ESCENA Y CÁMARA
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 400);
camara.layers.enable(CAPA_BRILLO);

const comunes = {
    uTiempo: { value: 0 },
    uVista: { value: new THREE.Vector3(0, 0, 1) },
    uPulso: { value: 0 },
    uOnda: { value: 9 },
    uEncendido: { value: 0 }
};


// =====================================================================
// 3. TEXTURA DE RUIDO
// Ruido suave que se repite, hecho una vez al cargar. Lo usan el gas,
// la luz del suelo y la nebulosa del fondo.
// =====================================================================

function texturaRuido() {
    const n = 512;
    const celdas = 64;
    const rejilla = Array.from({ length: celdas * celdas }, () => Math.random());
    const valor = (x, y, c) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const fx = x - xi;
        const fy = y - yi;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v = (a, b) => rejilla[(((b % c) + c) % c) * celdas + (((a % c) + c) % c)];
        return v(xi, yi) * (1 - sx) * (1 - sy) + v(xi + 1, yi) * sx * (1 - sy) + v(xi, yi + 1) * (1 - sx) * sy + v(xi + 1, yi + 1) * sx * sy;
    };
    const datos = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            let s = 0;
            let a = 0.5;
            for (let o = 0; o < 5; o++) {
                const c = 4 << o;
                s += a * valor((x / n) * c, (y / n) * c, c);
                a *= 0.5;
            }
            datos[y * n + x] = Math.floor(Math.min(1, s / 0.97) * 255);
        }
    }
    const t = new THREE.DataTexture(datos, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
}

const tRuido = { value: texturaRuido() };


// =====================================================================
// 4. EL FONDO: ESTRELLAS DOBLADAS POR LA GRAVEDAD
// Un cielo hecho en el shader: estrellas en una rejilla sobre las caras
// de un cubo y una nebulosa muy tenue. Cada píxel primero se dobla con
// la ecuación de una lente gravitatoria, así que alrededor del agujero
// las estrellas se estiran, se acercan a un anillo y aparecen
// repetidas al otro lado.
// =====================================================================

const fondo = new THREE.Mesh(
    new THREE.SphereGeometry(200, 48, 24),
    new THREE.ShaderMaterial({
        uniforms: {
            uTiempo: comunes.uTiempo,
            tRuido,
            uAgujero: { value: CENTRO },
            uRadioLente: { value: 0.1 },
            uAparece: { value: 1 }
        },
        vertexShader: `
            varying vec3 vMundo;
            void main() {
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform float uTiempo;
            uniform sampler2D tRuido;
            uniform vec3 uAgujero;
            uniform float uRadioLente;
            uniform float uAparece;
            varying vec3 vMundo;

            vec3 hash33(vec3 p3) {
                p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yxz + 33.33);
                return fract((p3.xxy + p3.yxx) * p3.zyx);
            }

            vec2 caraCubo(vec3 d, out float cara) {
                vec3 a = abs(d);
                if (a.x >= a.y && a.x >= a.z) {
                    cara = d.x > 0.0 ? 0.0 : 1.0;
                    return d.yz / a.x;
                }
                if (a.y >= a.z) {
                    cara = d.y > 0.0 ? 2.0 : 3.0;
                    return d.xz / a.y;
                }
                cara = d.z > 0.0 ? 4.0 : 5.0;
                return d.xy / a.z;
            }

            vec3 capaEstrellas(vec3 d, float escala, float densidad, float tam, float semilla) {
                float cara;
                vec2 uv = caraCubo(d, cara) * escala;
                vec2 celda = floor(uv);
                vec3 h = hash33(vec3(celda, cara * 17.0 + semilla));
                if (h.x > densidad) return vec3(0.0);
                vec2 centro = celda + 0.3 + h.yz * 0.4;
                float dist = length(uv - centro);
                float px = length(fwidth(uv)) * 0.75;
                float r = max(tam, px);
                float luz = smoothstep(r, 0.0, dist) * min(1.0, (tam * tam) / (r * r) * 1.6);
                float fuerza = 0.25 + pow(fract(h.y * 7.31), 4.0) * 2.4;
                fuerza *= 0.85 + 0.15 * sin(uTiempo * (0.8 + h.z * 2.5) + h.y * 40.0);
                vec3 col = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.7), fract(h.z * 3.7));
                return col * luz * fuerza;
            }

            void main() {
                vec3 dir = normalize(vMundo - cameraPosition);
                vec3 haciaAgujero = normalize(uAgujero - cameraPosition);
                float coseno = clamp(dot(dir, haciaAgujero), -1.0, 1.0);
                float theta = acos(coseno);
                float e2 = uRadioLente * uRadioLente;
                float beta = theta - e2 / max(theta, 0.0005);
                vec3 eje = dir - haciaAgujero * coseno;
                float largoEje = length(eje);
                eje = largoEje > 0.00001 ? eje / largoEje : vec3(0.0, 1.0, 0.0);
                vec3 d = normalize(cos(beta) * haciaAgujero + sin(beta) * eje);
                float aumento = clamp(1.0 / abs(1.0 - e2 * e2 / pow(max(theta, 0.0005), 4.0)), 0.0, 6.0);

                vec3 cielo = mix(vec3(0.004, 0.005, 0.01), vec3(0.012, 0.012, 0.022), exp(-theta * 2.5));
                float lon = atan(d.z, d.x) / 6.2832;
                float banda = exp(-pow(dot(d, normalize(vec3(0.35, 0.8, -0.45))) / 0.32, 2.0));
                float nube = texture2D(tRuido, vec2(lon * 2.0, d.y * 0.9 + 0.3)).r;
                float nubeFina = texture2D(tRuido, vec2(lon * 6.0 + 0.2, d.y * 2.6)).r;
                float nebulosa = smoothstep(0.4, 0.85, nube * 0.7 + nubeFina * 0.4) * banda;
                cielo += mix(vec3(0.035, 0.02, 0.06), vec3(0.06, 0.035, 0.03), nubeFina) * nebulosa * 0.9;

                vec3 estrellas = capaEstrellas(d, 110.0, 0.3, 0.07, 1.0) * 0.6;
                estrellas += capaEstrellas(d, 40.0, 0.22, 0.05, 2.0) * 1.6;
                estrellas += capaEstrellas(d, 14.0, 0.12, 0.035, 3.0) * 3.6;
                estrellas *= 0.7 + nebulosa * 1.5;
                float lejosDelCentro = smoothstep(0.1, 0.4, abs(beta) / uRadioLente) * smoothstep(1.1, 1.7, theta * 2.1 / uRadioLente);
                cielo += estrellas * min(aumento, 3.0) * lejosDelCentro;
                gl_FragColor = vec4(cielo * uAparece, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    })
);
fondo.renderOrder = -1;
escena.add(fondo);



// =====================================================================
// 5. EL GAS
// La textura de ruido leída en coordenadas polares: gira más rápido por
// dentro, se enrolla en espiral, con anillos que se desplazan,
// filamentos finos, grumos calientes y un lado más brillante (el gas
// que viene hacia ti).
// =====================================================================

const gasGlsl = `
    uniform sampler2D tRuido;
    uniform float uTiempo;
    uniform vec3 uVista;
    uniform float uDesfase;
    uniform float uEncendido;
    uniform float uPulso;
    uniform float uOnda;
    const float DENTRO = 1.35;
    const float FUERA = 4.8;
    vec4 gas(float r, float phi) {
        float x = (r - DENTRO) / (FUERA - DENTRO);
        float omega = 1.5 * pow(r / DENTRO, -1.5);
        float espiral = log(r) * 0.55;
        float ang = (phi - uTiempo * omega) / 6.2832 + uDesfase;
        float n = texture2D(tRuido, vec2(ang + espiral * 0.3, r * 0.16 + uDesfase)).r;
        float fino = texture2D(tRuido, vec2(ang * 3.0 + espiral, r * 0.6 + 0.37)).r;
        #ifdef GAS_SENCILLO
        float hebras = 0.5;
        float rizo = 0.5;
        #else
        float hebras = texture2D(tRuido, vec2(ang * 9.0 + espiral * 2.0, r * 2.2 + 0.11)).r;
        float rizo = texture2D(tRuido, vec2(ang * 22.0 + espiral * 4.0, r * 5.0 + 0.53)).r;
        #endif
        float polvo = smoothstep(0.55, 0.8, texture2D(tRuido, vec2(ang + 0.5, r * 0.09 + 0.61)).r) * smoothstep(0.12, 0.6, x);
        float perfil = smoothstep(-0.02, 0.05, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.3);
        float anillos = 0.6 + 0.4 * sin(r * 14.0 - uTiempo * 1.1 + n * 4.0) * sin(r * 4.6 + uTiempo * 0.4);
        float densidad = smoothstep(0.25, 0.78, n) * (0.4 + 0.8 * fino) * (0.65 + 0.7 * hebras) * (0.8 + 0.4 * rizo) * anillos;
        densidad = mix(densidad, 1.0, smoothstep(0.14, 0.0, x));
        float manchas = 0.0;
        #ifndef GAS_SENCILLO
        for (int i = 0; i < 6; i++) {
            float ri = 1.6 + float(i) * 0.5;
            float ai = uTiempo * 1.5 * pow(ri / DENTRO, -1.5) + float(i) * 2.3;
            float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
            manchas += exp(-pow(da / (0.35 + float(i) * 0.12), 2.0) - pow((r - ri) / 0.1, 2.0)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + float(i)));
        }
        #endif
        float temperatura = pow(DENTRO / r, 1.4);
        vec3 col = mix(vec3(0.38, 0.13, 0.05), vec3(1.0, 0.46, 0.16), smoothstep(0.1, 0.42, temperatura));
        col = mix(col, vec3(1.0, 0.78, 0.5), smoothstep(0.42, 0.75, temperatura));
        col = mix(col, vec3(1.0, 0.95, 0.88), smoothstep(0.75, 1.0, temperatura));
        vec3 vel = vec3(-sin(phi), 0.0, cos(phi));
        float v = 0.45 * pow(DENTRO / r, 0.5);
        float doppler = 1.0 / (inversesqrt(1.0 - v * v) * (1.0 - v * dot(vel, uVista)));
        float haz = mix(1.0, pow(doppler, 3.0), 0.8);
        float brillo = temperatura * 2.0 * haz * (1.0 + 0.12 * sin(uTiempo * 1.3 + r * 2.5)) * (0.85 + 0.3 * rizo);
        col *= brillo * (1.0 - polvo * 0.75) * (1.0 + manchas * 1.5);
        col = mix(col, col * vec3(1.1, 0.8, 0.62), smoothstep(1.0, 0.6, doppler) * 0.6);
        col = mix(col, col * vec3(0.95, 1.0, 1.1) + 0.06, smoothstep(1.0, 1.45, doppler) * 0.5);
        col *= 1.0 + uPulso * 0.45 + uPulso * 2.2 * exp(-pow((r - uOnda) / 0.3, 2.0));
        float alfa = clamp((densidad + manchas * 0.4) * perfil * 1.6, 0.0, 1.0);
        float frente = mix(FUERA + 0.9, DENTRO - 1.0, uEncendido);
        float borde = r + 0.45 * sin(phi * 2.0 - log(r) * 5.0 - uTiempo * 0.8);
        alfa *= smoothstep(frente - 0.2, frente + 0.6, borde);
        col *= 1.0 + 2.0 * exp(-pow((borde - frente - 0.3) / 0.35, 2.0)) * (1.0 - uEncendido);
        return vec4(col, alfa);
    }
`;

function materialGas(modo, opciones = {}) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const desfase = { value: opciones.desfase ?? 0 };
    const fuerza = opciones.fuerza ?? 1;
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, comunes, { tRuido, uDesfase: desfase });
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLocalG;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalG = position;");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLocalG;\n" + (fuerza < 0.5 ? "#define GAS_SENCILLO\n" : "") + gasGlsl)
            .replace(
                "#include <color_fragment>",
                `#include <color_fragment>
                ${modo === "disco" ? `
                float rG = length(vLocalG.xz);
                vec4 g = gas(rG, atan(vLocalG.z, vLocalG.x));` : `
                float rho = length(vLocalG.xy);
                float dentroArco = ${modo === "arriba" ? "1.16" : "1.12"};
                float fueraArco = ${modo === "arriba" ? "2.55" : "1.6"};
                float rG = DENTRO + max(0.0, rho - dentroArco) * ${modo === "arriba" ? "1.75" : "3.2"};
                vec4 g = gas(rG, atan(vLocalG.y, vLocalG.x) * 0.9 + 1.4);
                g.a = clamp(g.a * ${modo === "arriba" ? "2.0" : "1.4"}, 0.0, 1.0) * smoothstep(0.0, 0.22, abs(vLocalG.y) / rho) * smoothstep(dentroArco, dentroArco + 0.06, rho) * smoothstep(fueraArco, fueraArco - ${modo === "arriba" ? "0.95" : "0.4"}, rho);`}
                g.a *= ${fuerza.toFixed(3)};
                diffuseColor.rgb = pow(g.rgb, vec3(1.15)) * ${modo === "disco" ? "0.85" : "1.0"};
                diffuseColor.a = clamp(g.a * 1.7, 0.0, 1.0);`
            );
    };
    material.customProgramCacheKey = () => "gas" + modo + fuerza;
    return material;
}


// =====================================================================
// 6. GARGANTUA
// La sombra es una bola negra sin ningún reflejo. Alrededor, el disco en
// tres capas, los dos arcos de luz doblada, dos anillos de fotones muy
// finos y halos de luz. El grupo mira casi siempre a
// la cámara para verse como Gargantua.
// =====================================================================

const agujero = new THREE.Group();
agujero.position.copy(CENTRO);
agujero.rotation.order = "YXZ";
escena.add(agujero);

const brillar = (o) => {
    o.layers.enable(CAPA_BRILLO);
    return o;
};

const sombra = brillar(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000 })));
agujero.add(sombra);

function discoConVolumen(grosorMax) {
    const perfil = [];
    const dentro = 1.3;
    const fuera = 4.85;
    const grosor = (r) => grosorMax * Math.pow(1 - (r - dentro) / (fuera - dentro), 0.8) + 0.006;
    const n = 28;
    for (let i = 0; i <= n; i++) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, -grosor(r)));
    }
    for (let i = n; i >= 0; i--) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, grosor(r)));
    }
    perfil.push(perfil[0].clone());
    return new THREE.LatheGeometry(perfil, 144);
}

[[0.06, 1, 0], [0.16, 0.3, 0.37], [0.28, 0.14, 0.71]].forEach(([grosor, fuerza, desfase], i) => {
    const capa = brillar(new THREE.Mesh(discoConVolumen(grosor), materialGas("disco", { fuerza, desfase })));
    capa.renderOrder = 3 + i;
    agujero.add(capa);
});

function arco(dentro, fuera, desde, largo, grosor) {
    const forma = new THREE.Shape();
    forma.absarc(0, 0, fuera, desde, desde + largo, false);
    forma.absarc(0, 0, dentro, desde + largo, desde, true);
    const geo = new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: true, bevelThickness: grosor * 0.6, bevelSize: grosor * 0.6, bevelSegments: 2, curveSegments: 72 });
    geo.translate(0, 0, -grosor / 2);
    return geo;
}

const arcos = new THREE.Group();
const arcoArriba = brillar(new THREE.Mesh(arco(1.15, 2.6, 0.01, Math.PI - 0.02, 0.05), materialGas("arriba")));
const arcoArriba2 = brillar(new THREE.Mesh(arco(1.15, 2.6, 0.01, Math.PI - 0.02, 0.05), materialGas("arriba", { fuerza: 0.35, desfase: 0.5 })));
arcoArriba2.position.z = -0.12;
const arcoAbajo = brillar(new THREE.Mesh(arco(1.11, 1.62, Math.PI + 0.04, Math.PI - 0.08, 0.04), materialGas("abajo")));
const anillo = brillar(new THREE.Mesh(new THREE.TorusGeometry(1.028, 0.008, 8, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.7).multiplyScalar(2.6) })));
const anillo2 = brillar(new THREE.Mesh(new THREE.TorusGeometry(1.075, 0.003, 6, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.6).multiplyScalar(0.45) })));
[arcoArriba2, arcoArriba, arcoAbajo].forEach((m, i) => (m.renderOrder = 6 + i));
anillo.renderOrder = 9;
anillo2.renderOrder = 9;
arcos.add(arcoArriba2, arcoArriba, arcoAbajo, anillo, anillo2);
agujero.add(arcos);

function texturaHalo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 128;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    d.addColorStop(0, "rgba(255, 255, 255, 1)");
    d.addColorStop(0.25, "rgba(255, 255, 255, 0.45)");
    d.addColorStop(0.6, "rgba(255, 255, 255, 0.1)");
    d.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(lienzo);
}

const mapaHalo = texturaHalo();
const halos = [[10, 0.16, [1, 0.5, 0.22]], [3.8, 0.28, [1, 0.72, 0.45]]].map(([tam, fuerza, c]) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: mapaHalo, color: new THREE.Color(...c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: fuerza }));
    halo.scale.setScalar(tam);
    halo.renderOrder = 10;
    halo.userData.fuerza = fuerza;
    agujero.add(halo);
    return halo;
});



// =====================================================================
// 7. RESPLANDOR EN VARIAS CAPAS
// Se pinta aparte solo lo que brilla (el gas, los arcos, los anillos y
// la sombra negra, que tapa lo que queda detrás). Se queda con lo más
// fuerte, se difumina a la mitad, a un cuarto y a un octavo de tamaño
// y se suma a la imagen: un brillo cercano y nítido y otro amplio y
// suave. Sobre la sombra casi no se suma, para que siga negra.
// =====================================================================

const VERTICE_PLANO = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

class PaseBrillo extends Pass {
    constructor() {
        super();
        const gl = renderizador.getContext();
        const flotante = renderizador.capabilities.isWebGL2 && !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
        const op = { type: flotante ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false };
        this.escena = new THREE.WebGLRenderTarget(1, 1, { ...op, depthBuffer: true });
        this.niveles = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)]);
        this.difuminar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uDir: { value: new THREE.Vector2() } },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tEntrada;
                uniform vec2 uDir;
                varying vec2 vUv;
                void main() {
                    vec3 c = texture2D(tEntrada, vUv).rgb * 0.2270;
                    c += (texture2D(tEntrada, vUv + uDir * 1.385).rgb + texture2D(tEntrada, vUv - uDir * 1.385).rgb) * 0.3162;
                    c += (texture2D(tEntrada, vUv + uDir * 3.231).rgb + texture2D(tEntrada, vUv - uDir * 3.231).rgb) * 0.0703;
                    gl_FragColor = vec4(c, 1.0);
                }
            `
        });
        this.recortar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uUmbral: { value: 0.7 }, uPaso: { value: new THREE.Vector2() } },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tEntrada;
                uniform float uUmbral;
                uniform vec2 uPaso;
                varying vec2 vUv;
                void main() {
                    vec3 c = texture2D(tEntrada, vUv + uPaso * vec2(-0.5, -0.5)).rgb + texture2D(tEntrada, vUv + uPaso * vec2(0.5, -0.5)).rgb
                           + texture2D(tEntrada, vUv + uPaso * vec2(-0.5, 0.5)).rgb + texture2D(tEntrada, vUv + uPaso * vec2(0.5, 0.5)).rgb;
                    c *= 0.25;
                    float l = max(c.r, max(c.g, c.b));
                    gl_FragColor = vec4(c * max(l - uUmbral, 0.0) / max(l, 0.0001), 1.0);
                }
            `
        });
        this.copiar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null } },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tEntrada;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = vec4(texture2D(tEntrada, vUv).rgb, 1.0);
                }
            `
        });
        this.mezclar = new THREE.ShaderMaterial({
            uniforms: {
                tBase: { value: null },
                tN0: { value: null },
                tN1: { value: null },
                tN2: { value: null },
                uFuerza: { value: 0.55 },
                uCentro: { value: new THREE.Vector2(0.5, 0.5) },
                uRadio: { value: new THREE.Vector2(0.1, 0.1) }
            },
            vertexShader: VERTICE_PLANO,
            fragmentShader: `
                uniform sampler2D tBase;
                uniform sampler2D tN0;
                uniform sampler2D tN1;
                uniform sampler2D tN2;
                uniform float uFuerza;
                uniform vec2 uCentro;
                uniform vec2 uRadio;
                varying vec2 vUv;
                void main() {
                    vec4 base = texture2D(tBase, vUv);
                    vec3 brillo = texture2D(tN0, vUv).rgb * 0.3 + texture2D(tN1, vUv).rgb * 0.55 + texture2D(tN2, vUv).rgb * 0.8;
                    float bola = 1.0 - smoothstep(0.8, 1.0, length((vUv - uCentro) / uRadio));
                    brillo *= 1.0 - bola * 0.88;
                    gl_FragColor = vec4(base.rgb + brillo * uFuerza, base.a);
                }
            `
        });
        this.cuadro = new FullScreenQuad();
        this.negro = new THREE.Color(0, 0, 0);
        this.antes = new THREE.Color();
    }

    setSize(ancho, alto) {
        const m = Math.max(1, Math.round(ancho / 2));
        const n = Math.max(1, Math.round(alto / 2));
        this.escena.setSize(m, n);
        this.niveles.forEach((par, i) => {
            const f = 1 << i;
            par.forEach((rt) => rt.setSize(Math.max(1, Math.round(m / f)), Math.max(1, Math.round(n / f))));
        });
    }

    pasada(renderizador, material, destino) {
        this.cuadro.material = material;
        renderizador.setRenderTarget(destino);
        this.cuadro.render(renderizador);
    }

    difumina(renderizador, [rt, auxiliar], escala) {
        const u = this.difuminar.uniforms;
        u.tEntrada.value = rt.texture;
        u.uDir.value.set(escala / rt.width, 0);
        this.pasada(renderizador, this.difuminar, auxiliar);
        u.tEntrada.value = auxiliar.texture;
        u.uDir.value.set(0, escala / rt.height);
        this.pasada(renderizador, this.difuminar, rt);
    }

    render(renderizador, destino, origen) {
        const mascara = camara.layers.mask;
        renderizador.getClearColor(this.antes);
        const alfaAntes = renderizador.getClearAlpha();
        camara.layers.set(CAPA_BRILLO);
        renderizador.setClearColor(this.negro, 1);
        renderizador.setRenderTarget(this.escena);
        renderizador.clear();
        renderizador.render(escena, camara);
        camara.layers.mask = mascara;
        renderizador.setClearColor(this.antes, alfaAntes);

        const [n0, n1, n2] = this.niveles;
        this.recortar.uniforms.tEntrada.value = this.escena.texture;
        this.recortar.uniforms.uPaso.value.set(1 / this.escena.width, 1 / this.escena.height);
        this.pasada(renderizador, this.recortar, n0[0]);
        this.difumina(renderizador, n0, 1.0);
        this.copiar.uniforms.tEntrada.value = n0[0].texture;
        this.pasada(renderizador, this.copiar, n1[0]);
        this.difumina(renderizador, n1, 1.4);
        this.copiar.uniforms.tEntrada.value = n1[0].texture;
        this.pasada(renderizador, this.copiar, n2[0]);
        this.difumina(renderizador, n2, 1.6);
        this.difumina(renderizador, n2, 3.0);

        const u = this.mezclar.uniforms;
        u.tBase.value = origen.texture;
        u.tN0.value = n0[0].texture;
        u.tN1.value = n1[0].texture;
        u.tN2.value = n2[0].texture;
        this.pasada(renderizador, this.mezclar, this.renderToScreen ? null : destino);
    }
}


// =====================================================================
// 8. EFECTOS: RESPLANDOR Y ACABADO
// Al final, un oscurecido suave en las esquinas y un grano muy fino que
// evita que los degradados oscuros se vean a escalones.
// =====================================================================

const compositor = new EffectComposer(renderizador);
compositor.addPass(new RenderPass(escena, camara));
const brillo = new PaseBrillo();
compositor.addPass(brillo);
compositor.addPass(new OutputPass());
const acabado = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTiempo: comunes.uTiempo },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTiempo;
        varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            vec2 q = vUv - 0.5;
            c.rgb *= 1.0 - dot(q, q) * 0.55;
            float grano = fract(sin(dot(gl_FragCoord.xy + fract(uTiempo * 7.0) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
            c.rgb += (grano - 0.5) / 255.0 * 1.5;
            gl_FragColor = c;
        }
    `
});
compositor.addPass(acabado);


// =====================================================================
// 9. LA VISTA
// No se gira alrededor: el ratón (o el dedo arrastrando) solo inclina
// la cámara un poco, y cuando no tocas nada se mece sola muy despacio.
// El agujero sigue casi del todo a la cámara.
// =====================================================================

const vista = { giro: 0, altura: 0, objGiro: 0, objAltura: 0, radio: 16.4, arrastrando: false, x: 0, y: 0 };
const auxV = new THREE.Vector3();

function colocarCamara(delta, t) {
    const suave = Math.min(1, delta * 2.5);
    vista.giro += (vista.objGiro - vista.giro) * suave;
    vista.altura += (vista.objAltura - vista.altura) * suave;
    const acercar = 1 + 0.22 * Math.pow(1 - comunes.uEncendido.value, 2);
    const giro = BASE_GIRO + vista.giro + Math.sin(t * 0.12) * 0.05;
    const altura = Math.max(0.04, BASE_ALTURA + vista.altura + Math.sin(t * 0.09) * 0.015);
    camara.position.set(Math.sin(giro) * Math.cos(altura), Math.sin(altura), Math.cos(giro) * Math.cos(altura)).multiplyScalar(vista.radio * acercar).add(OBJETIVO);
    camara.lookAt(OBJETIVO);
}

function orientarAgujero() {
    auxV.subVectors(camara.position, CENTRO);
    const giro = Math.atan2(auxV.x, auxV.z);
    const elevacion = Math.atan2(auxV.y, Math.hypot(auxV.x, auxV.z));
    const g = BASE_GIRO + (giro - BASE_GIRO) * 0.75;
    const e = BASE_ALTURA + (elevacion - BASE_ALTURA) * 0.75;
    agujero.rotation.set(-(e - 0.2), g, -0.4);
    agujero.updateMatrixWorld();
    auxV.copy(camara.position);
    agujero.worldToLocal(auxV);
    comunes.uVista.value.copy(auxV).normalize();
}

// Aleja la cámara lo justo para que el disco quepa a lo ancho, sobre
// todo con el móvil en vertical
function encuadrar() {
    const mitad = Math.atan(Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)) * camara.aspect);
    vista.radio = Math.min(30, Math.max(16, 4.2 / Math.tan(mitad)));
}

// La sombra en pantalla, para que el resplandor no la tape, y el tamaño
// de la lente para el fondo
function marcarBola() {
    const distancia = camara.position.distanceTo(CENTRO);
    const angulo = Math.asin(1 / distancia);
    fondo.material.uniforms.uRadioLente.value = angulo * 2.1;
    auxV.copy(CENTRO).project(camara);
    const u = brillo.mezclar.uniforms;
    u.uCentro.value.set(auxV.x * 0.5 + 0.5, auxV.y * 0.5 + 0.5);
    const ry = (Math.tan(angulo) / Math.tan(THREE.MathUtils.degToRad(camara.fov / 2))) * 0.5;
    u.uRadio.value.set(ry / camara.aspect, ry);
}


// =====================================================================
// 10. TOCAR
// Mover el ratón inclina la vista. Arrastrar con el dedo también. Tocar
// sin arrastrar despierta al agujero: el gas se enciende, una onda cae
// hacia dentro y el anillo de luz brilla más.
// =====================================================================

const pista = document.getElementById("pista");
const toque = { x: 0, y: 0, t: 0 };
const lienzo = renderizador.domElement;

function despertar() {
    comunes.uPulso.value = 1;
    comunes.uOnda.value = 5.2;
}

lienzo.addEventListener("pointerdown", (e) => {
    pista.classList.add("oculta");
    Object.assign(toque, { x: e.clientX, y: e.clientY, t: performance.now() });
    vista.arrastrando = e.pointerType !== "mouse";
    vista.x = e.clientX;
    vista.y = e.clientY;
});

lienzo.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
        vista.objGiro = -(e.clientX / innerWidth - 0.5) * 0.5;
        vista.objAltura = (e.clientY / innerHeight - 0.5) * 0.16;
        return;
    }
    if (!vista.arrastrando) return;
    vista.objGiro = Math.max(-0.3, Math.min(0.3, vista.objGiro - ((e.clientX - vista.x) / innerWidth) * 0.9));
    vista.objAltura = Math.max(-0.1, Math.min(0.1, vista.objAltura + ((e.clientY - vista.y) / innerHeight) * 0.3));
    vista.x = e.clientX;
    vista.y = e.clientY;
});

const soltar = (e) => {
    vista.arrastrando = false;
    if (e.type === "pointerup" && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 8 && performance.now() - toque.t < 350) despertar();
};
lienzo.addEventListener("pointerup", soltar);
lienzo.addEventListener("pointercancel", soltar);
document.addEventListener("pointerleave", () => {
    vista.objGiro = 0;
    vista.objAltura = 0;
});


// =====================================================================
// 11. MOVIMIENTO
// =====================================================================

const reloj = new THREE.Clock();
let listo = false;

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 44 : 30;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
}

window.addEventListener("resize", () => {
    ajustarTamano();
    encuadrar();
});

// Si el aparato no llega a unos 28 fotogramas por segundo se baja un
// poco la resolución, y si va sobrado se vuelve a subir
const ritmo = { suma: 0, cuenta: 0, espera: 2, actual: renderizador.getPixelRatio(), fija: parametros.has("fijo") };

function adaptarResolucion(delta) {
    if (ritmo.fija) return;
    ritmo.espera -= delta;
    ritmo.suma += delta;
    ritmo.cuenta++;
    if (ritmo.cuenta < 40 || ritmo.espera > 0) return;
    const media = (ritmo.suma / ritmo.cuenta) * 1000;
    ritmo.suma = 0;
    ritmo.cuenta = 0;
    const tope = Math.min(devicePixelRatio || 1, ajustes.resolucionMax);
    let nueva = ritmo.actual;
    if (media > 36) nueva = Math.max(ajustes.resolucionMin, ritmo.actual - 0.25);
    else if (media < 20) nueva = Math.min(tope, ritmo.actual + 0.125);
    if (nueva === ritmo.actual) return;
    ritmo.actual = nueva;
    ritmo.espera = 1.5;
    renderizador.setPixelRatio(nueva);
    compositor.setPixelRatio(nueva);
    ajustarTamano();
}

// La entrada: primero aparecen las estrellas y la sombra negra, y
// después el gas se va encendiendo en espiral de fuera hacia dentro
// mientras la cámara se acerca un poco
const entrada = { t: parametros.has("fijo") || parametros.has("sinentrada") ? 10 : 0 };

function moverEntrada(delta) {
    entrada.t += delta;
    const gas = THREE.MathUtils.smoothstep(entrada.t, 0.9, 5.2);
    fondo.material.uniforms.uAparece.value = THREE.MathUtils.smoothstep(entrada.t, 0.2, 1.6);
    comunes.uEncendido.value = gas;
    return gas;
}

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const real = reloj.getDelta();
    const delta = Math.min(real, 0.1);
    const t = (comunes.uTiempo.value += delta);
    if (real < 0.5) adaptarResolucion(real);
    colocarCamara(delta, t);
    orientarAgujero();
    const pulso = (comunes.uPulso.value *= Math.exp(-delta * 1.1));
    comunes.uOnda.value = Math.max(0.6, comunes.uOnda.value - delta * 2.6);
    const encendido = moverEntrada(delta);
    const luzAnillo = THREE.MathUtils.smoothstep(encendido, 0.6, 1);
    anillo.material.color.setRGB(1, 0.88, 0.7).multiplyScalar((2.4 + Math.sin(t * 2.2) * 0.4 + pulso * 3) * luzAnillo);
    anillo2.material.color.setRGB(1, 0.8, 0.6).multiplyScalar(0.45 * luzAnillo);
    halos.forEach((h, i) => (h.material.opacity = h.userData.fuerza * encendido * (0.85 + 0.15 * Math.sin(t * (1.1 + i * 0.7)) + pulso * 0.8)));
    brillo.mezclar.uniforms.uFuerza.value = 0.55 * (1 + pulso * 0.6);
    marcarBola();
    compositor.render();
}

requestAnimationFrame(() => {
    ajustarTamano();
    encuadrar();
    colocarCamara(1, 0);
    orientarAgujero();
    marcarBola();
    moverEntrada(0);
    if (parametros.has("pulso")) despertar();
    renderizador.compile(escena, camara);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
    reloj.getDelta();
    animar();
});
