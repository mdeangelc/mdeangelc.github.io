import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// =====================================================================
// 1. AJUSTES
// Gargantua solo, flotando en el espacio. El disco de gas son tres
// capas que giran (más rápido por dentro), la luz doblada son dos arcos
// que abrazan la sombra negra, las estrellas de detrás se deforman por
// la gravedad y un resplandor en varias capas hace brillar lo caliente.
// Al cargar, el gas se va encendiendo en espiral. El ratón solo inclina
// un poco la vista. Si el sistema pide menos movimiento, no hay entrada
// ni balanceo.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const pocoMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.75,
    resolucionMin: movil ? 0.75 : 1,
    brilloEscala: movil ? 3 : 2
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

let renderizador;
try {
    renderizador = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
} catch (error) {
    document.getElementById("cargando").textContent = "Tu navegador no puede mostrar el agujero negro.";
    throw error;
}
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
document.body.prepend(renderizador.domElement);
renderizador.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
renderizador.domElement.addEventListener("webglcontextrestored", () => location.reload());

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
// Ruido suave que se repite, hecho una vez al cargar, octava a octava.
// Lo usan el gas y la nebulosa del fondo.
// =====================================================================

function texturaRuido() {
    const n = 512;
    const celdas = 64;
    const rejilla = new Float32Array(celdas * celdas).map(() => Math.random());
    const suma = new Float32Array(n * n);
    let amp = 0.5;
    for (let o = 0; o < 5; o++) {
        const c = 4 << o;
        const lado = n / c;
        for (let y = 0; y < n; y++) {
            const yi = Math.floor(y / lado);
            const fy = (y - yi * lado) / lado;
            const sy = fy * fy * (3 - 2 * fy);
            const fila0 = (yi % c) * celdas;
            const fila1 = ((yi + 1) % c) * celdas;
            for (let x = 0; x < n; x++) {
                const xi = Math.floor(x / lado);
                const fx = (x - xi * lado) / lado;
                const sx = fx * fx * (3 - 2 * fx);
                const x0 = xi % c;
                const x1 = (xi + 1) % c;
                const arriba = rejilla[fila0 + x0] + (rejilla[fila0 + x1] - rejilla[fila0 + x0]) * sx;
                const abajo = rejilla[fila1 + x0] + (rejilla[fila1 + x1] - rejilla[fila1 + x0]) * sx;
                suma[y * n + x] += amp * (arriba + (abajo - arriba) * sy);
            }
        }
        amp *= 0.5;
    }
    const datos = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) datos[i] = Math.floor(Math.min(1, suma[i] / 0.97) * 255);
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
            uAparece: { value: 1 },
            uGalaxia: { value: new THREE.Vector3() }
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
            uniform vec3 uGalaxia;
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

            // Una galaxia espiral lejana justo detrás del agujero. Su luz se
            // dobla igual que la de las estrellas: alrededor de la sombra
            // se ve estirada en arcos y, si queda bien alineada, en un
            // anillo completo (anillo de Einstein)
            vec3 galaxia(vec3 d) {
                vec3 g = normalize(uGalaxia);
                vec3 e1 = normalize(cross(g, vec3(0.0, 1.0, 0.0)));
                vec3 e2 = cross(e1, g);
                float frente = dot(d, g);
                if (frente < 0.9) return vec3(0.0);
                vec2 p = vec2(dot(d, e1), dot(d, e2)) / 0.11;
                p = mat2(0.8, -0.6, 0.6, 0.8) * p;
                p.y /= 0.55;
                float r = length(p);
                if (r > 1.6) return vec3(0.0);
                float a = atan(p.y, p.x);
                float brazos = 0.5 + 0.5 * sin(2.0 * a - log(r + 0.02) * 4.2 + 0.6);
                brazos = pow(brazos, 2.2);
                float polvo = texture2D(tRuido, p * 0.2 + 0.5).r;
                float nucleo = exp(-r * r * 22.0) * 2.2 + exp(-r * 5.0) * 0.5;
                float disco = exp(-r * 2.3) * (0.25 + brazos * (0.6 + polvo * 0.8));
                vec3 col = vec3(1.0, 0.86, 0.66) * nucleo + mix(vec3(0.5, 0.62, 1.0), vec3(0.95, 0.75, 0.9), polvo) * disco;
                return col * 0.1;
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
                cielo += galaxia(d) * min(aumento, 4.0) * smoothstep(0.02, 0.25, abs(beta) / uRadioLente) * smoothstep(0.9, 1.3, theta * 2.1 / uRadioLente);
                gl_FragColor = vec4(cielo * uAparece, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    })
);
fondo.renderOrder = -1;
escena.add(fondo);
// La galaxia queda detrás del agujero vista desde el sitio de partida,
// un poco desplazada: así forma arcos y, al girar, un anillo
fondo.material.uniforms.uGalaxia.value.set(-Math.sin(BASE_GIRO + 0.035), -Math.sin(BASE_ALTURA - 0.02), -Math.cos(BASE_GIRO + 0.035)).normalize();



// =====================================================================
// 5. EL GAS
// La textura de ruido leída en coordenadas polares: gira más rápido por
// dentro, se enrolla en espiral, se retuerce despacio, con anillos que
// se desplazan, filamentos finos, vetas oscuras de polvo, grumos
// calientes, un borde interior al rojo blanco donde el gas cae y un
// lado más brillante (el gas que viene hacia ti).
// =====================================================================

const gasGlsl = `
    uniform sampler2D tRuido;
    uniform float uTiempo;
    uniform vec3 uVista;
    uniform float uEncendido;
    uniform float uPulso;
    uniform float uOnda;
    const float DENTRO = 1.35;
    const float FUERA = 4.8;
    float manchasFijas = 0.0;


    float manchasEn(float r, float phi) {
        float m = 0.0;
        for (int i = 0; i < 10; i++) {
            float ri = 1.55 + float(i) * 0.31 + 0.1 * sin(float(i) * 3.7);
            float ai = uTiempo * 1.5 * pow(ri / DENTRO, -1.5) + float(i) * 2.3;
            float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
            m += exp(-pow(da / (0.3 + float(i) * 0.08), 2.0) - pow((r - ri) / (0.07 + float(i) * 0.008), 2.0)) * (0.55 + 0.45 * sin(uTiempo * 2.0 + float(i) * 1.3));
        }
        return m;
    }

    vec4 gas(float r, float phi, float phiLuz, float desfase) {
        float x = (r - DENTRO) / (FUERA - DENTRO);
        float omega = 1.5 * pow(r / DENTRO, -1.5);
        float espiral = log(r) * 0.55;
        float ang = (phi - uTiempo * omega) / 6.2832 + desfase;
        #ifdef GAS_LIGERO
        float angT = ang;
        float rT = r;
        #else
        vec2 torcer = vec2(
            texture2D(tRuido, vec2(ang * 2.0 + uTiempo * 0.013, r * 0.3 - uTiempo * 0.021)).r,
            texture2D(tRuido, vec2(ang * 2.0 + 0.5 - uTiempo * 0.017, r * 0.3 + 0.4 + uTiempo * 0.015)).r
        ) - 0.5;
        float angT = ang + torcer.x * 0.018;
        float rT = r + torcer.y * 0.1;
        #endif
        float n = texture2D(tRuido, vec2(angT + espiral * 0.3, rT * 0.16 + desfase)).r;
        float fino = texture2D(tRuido, vec2(angT * 3.0 + espiral, rT * 0.6 + 0.37)).r;
        float hebras = texture2D(tRuido, vec2(angT * 9.0 + espiral * 2.0, rT * 2.2 + 0.11)).r;
        #ifdef GAS_LIGERO
        float rizo = 0.5;
        float manchas = manchasFijas;
        #else
        float rizo = texture2D(tRuido, vec2(angT * 22.0 + espiral * 4.0, rT * 5.0 + 0.53)).r;
        float manchas = manchasEn(r, phi);
        #endif
        float polvo = smoothstep(0.55, 0.8, texture2D(tRuido, vec2(angT + 0.5, rT * 0.09 + 0.61)).r) * smoothstep(0.12, 0.6, x);
        float perfil = smoothstep(-0.02, 0.05, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.3);
        float anillos = 0.6 + 0.4 * sin(rT * 14.0 - uTiempo * 1.1 + n * 4.0) * sin(rT * 4.6 + uTiempo * 0.4);
        float densidad = smoothstep(0.3, 0.75, n) * (0.4 + 0.8 * fino) * (0.65 + 0.7 * hebras) * (0.8 + 0.4 * rizo) * anillos;
        densidad = mix(densidad, 1.0, smoothstep(0.14, 0.0, x));
        float temperatura = pow(DENTRO / r, 1.4);
        vec3 col = mix(vec3(0.38, 0.13, 0.05), vec3(1.0, 0.46, 0.16), smoothstep(0.1, 0.42, temperatura));
        col = mix(col, vec3(1.0, 0.78, 0.5), smoothstep(0.42, 0.75, temperatura));
        col = mix(col, vec3(1.0, 0.95, 0.88), smoothstep(0.75, 1.0, temperatura));
        vec3 vel = vec3(-sin(phiLuz), 0.0, cos(phiLuz));
        float v = 0.45 * pow(DENTRO / r, 0.5);
        float doppler = 1.0 / (inversesqrt(1.0 - v * v) * (1.0 - v * dot(vel, uVista)));
        float haz = mix(1.0, pow(doppler, 3.5), 0.85);
        float brillo = temperatura * 2.0 * haz * (1.0 + 0.12 * sin(uTiempo * 1.3 + r * 2.5)) * (0.72 + 0.56 * rizo);
        col *= brillo * (1.0 - polvo * 0.85) * (1.0 + manchas * 1.5);
        col = mix(col, col * vec3(1.1, 0.8, 0.62), smoothstep(1.0, 0.6, doppler) * 0.6);
        col = mix(col, col * vec3(0.88, 0.98, 1.2) + vec3(0.03, 0.05, 0.1), smoothstep(1.0, 1.45, doppler) * 0.65);
        float borde = exp(-pow((r - DENTRO - 0.025) / 0.032, 2.0)) * (0.7 + 0.3 * sin(phi * 7.0 + uTiempo * 3.1) * sin(phi * 3.0 - uTiempo * 1.7));
        col += vec3(1.0, 0.95, 0.88) * borde * 2.2 * haz;
        col *= 1.0 + uPulso * 0.45 + uPulso * 2.2 * exp(-pow((r - uOnda) / 0.3, 2.0));
        float alfa = clamp((densidad + manchas * 0.4) * perfil * 1.6 + borde * 0.5, 0.0, 1.0);
        float frente = mix(FUERA + 0.9, DENTRO - 1.0, uEncendido);
        float filo = r + 0.45 * sin(phi * 2.0 - log(r) * 5.0 - uTiempo * 0.8);
        alfa *= smoothstep(frente - 0.2, frente + 0.6, filo);
        col *= 1.0 + 2.0 * exp(-pow((filo - frente - 0.3) / 0.35, 2.0)) * (1.0 - uEncendido);
        return vec4(col, alfa);
    }
`;


// =====================================================================
// 6. GARGANTUA
// La sombra es una bola negra sin ningún reflejo. El disco son tres
// capas de gas y sigue casi del todo a la cámara. Los arcos de luz
// doblada se pintan en un anillo plano, sin piezas ni bordes cortados,
// y junto a los dos anillos de fotones miran siempre del todo a la
// cámara. Alrededor, halos de luz.
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

const VERTICE_LOCAL = `
    varying vec3 vLocal;
    void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const MEZCLA_PREMULTIPLICADA = {
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor
};

// El disco en tres capas: la del medio con todo el detalle y dos más
// gruesas y suaves por encima y por debajo que le dan cuerpo
function materialDisco(fuerza, desfase) {
    return new THREE.ShaderMaterial({
        uniforms: { ...comunes, tRuido },
        vertexShader: VERTICE_LOCAL,
        fragmentShader: (fuerza < 0.5 ? "#define GAS_LIGERO\n" : "") + gasGlsl + `
            varying vec3 vLocal;
            void main() {
                float r = length(vLocal.xz);
                float fi = atan(vLocal.z, vLocal.x);
                vec4 g = gas(r, fi, fi, ${desfase.toFixed(2)});
                float a = clamp(g.a * ${fuerza.toFixed(3)} * 1.7, 0.0, 1.0);
                if (a < 0.002) discard;
                gl_FragColor = vec4(pow(g.rgb, vec3(1.15)) * 0.85 * a, a);
            }
        `,
        ...MEZCLA_PREMULTIPLICADA
    });
}

[[0.06, 1, 0], [0.16, 0.3, 0.37], [0.28, 0.14, 0.71]].forEach(([grosor, fuerza, desfase], i) => {
    const capa = brillar(new THREE.Mesh(discoConVolumen(grosor), materialDisco(fuerza, desfase)));
    capa.renderOrder = 3 + i;
    agujero.add(capa);
});

// Los arcos: la parte de atrás del disco doblada por encima y por
// debajo. Fluyen en el mismo sentido que el disco de detrás y son más
// brillantes pegados a la sombra
function materialArcos(fuerza, desfase) {
    return new THREE.ShaderMaterial({
        uniforms: { ...comunes, tRuido },
        vertexShader: VERTICE_LOCAL,
        fragmentShader: (fuerza < 0.5 ? "#define GAS_LIGERO\n" : "") + gasGlsl + `
            varying vec3 vLocal;
            void main() {
                float rho = length(vLocal.xy);
                float aG = atan(vLocal.y, vLocal.x);
                bool arriba = vLocal.y > 0.0;
                float dentroArco = arriba ? 1.1 : 1.07;
                float fueraArco = arriba ? 2.55 : 1.5;
                if (rho < dentroArco - 0.02 || rho > fueraArco + 0.05) discard;
                float rG = DENTRO + max(0.0, rho - dentroArco) * (arriba ? 1.75 : 3.6);
                vec4 g = gas(rG, (arriba ? -aG : aG) * 0.9 + 1.4, aG * 0.9 + 1.4, ${desfase.toFixed(2)});
                g.rgb *= 1.0 + 0.5 * exp(-(rho - dentroArco) / (arriba ? 0.08 : 0.05));
                float a = clamp(g.a * (arriba ? 2.0 : 1.5), 0.0, 1.0);
                a *= smoothstep(0.0, 0.22, abs(vLocal.y) / rho);
                a *= smoothstep(dentroArco - 0.01, dentroArco + 0.05, rho);
                a *= smoothstep(fueraArco, fueraArco - (arriba ? 1.05 : 0.35), rho);
                a = clamp(a * ${fuerza.toFixed(2)} * 1.7, 0.0, 1.0);
                if (a < 0.002) discard;
                gl_FragColor = vec4(pow(g.rgb, vec3(1.15)) * a, a);
            }
        `,
        ...MEZCLA_PREMULTIPLICADA
    });
}

// Los arcos y los anillos van en su propio grupo, que mira siempre del
// todo a la cámara: así rodean la sombra igual se mire como se mire y
// no se nota que debajo hay una bola
const arcos = new THREE.Group();
arcos.position.copy(CENTRO);
arcos.rotation.order = "YXZ";
const planoArcos = new THREE.RingGeometry(1.03, 2.62, 160, 1);
const arcoAtras = brillar(new THREE.Mesh(planoArcos, materialArcos(0.35, 0.5)));
arcoAtras.position.z = -0.12;
const arcoDelante = brillar(new THREE.Mesh(planoArcos, materialArcos(1, 0)));
arcoAtras.renderOrder = 6;
arcoDelante.renderOrder = 7;
const anillo = brillar(new THREE.Mesh(new THREE.TorusGeometry(1.028, 0.01, 8, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.7).multiplyScalar(2.6) })));
const anillo2 = brillar(new THREE.Mesh(new THREE.TorusGeometry(1.075, 0.005, 6, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.6).multiplyScalar(0.45) })));
anillo.renderOrder = 9;
anillo2.renderOrder = 9;
arcos.add(arcoAtras, arcoDelante, anillo, anillo2);
escena.add(arcos);

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
// Unas pocas estrellas muy brillantes con rayitos, lejos del agujero
function texturaDestello() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 128;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(64, 64, 0, 64, 64, 14);
    d.addColorStop(0, "rgba(255, 255, 255, 1)");
    d.addColorStop(0.25, "rgba(255, 255, 255, 0.55)");
    d.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 128, 128);
    [[1, 0.025], [0.025, 1]].forEach(([sx, sy]) => {
        const rayo = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        rayo.addColorStop(0, "rgba(255, 255, 255, 1)");
        rayo.addColorStop(0.35, "rgba(255, 255, 255, 0.25)");
        rayo.addColorStop(1, "rgba(255, 255, 255, 0)");
        g.save();
        g.translate(64, 64);
        g.scale(sx, sy);
        g.fillStyle = rayo;
        g.beginPath();
        g.arc(0, 0, 64, 0, Math.PI * 2);
        g.fill();
        g.restore();
    });
    return new THREE.CanvasTexture(lienzo);
}

const destellos = (() => {
    const mapa = texturaDestello();
    const haciaAgujero = new THREE.Vector3(-Math.sin(BASE_GIRO), -Math.sin(BASE_ALTURA), -Math.cos(BASE_GIRO)).normalize();
    const lista = [];
    const tonos = [0xcfe0ff, 0xffffff, 0xffe2c4, 0xdde6ff];
    while (lista.length < 8) {
        const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (v.lengthSq() > 1 || v.lengthSq() < 0.01) continue;
        v.normalize();
        if (v.angleTo(haciaAgujero) < 0.16 || v.angleTo(haciaAgujero) > 0.6) continue;
        const estrella = new THREE.Sprite(new THREE.SpriteMaterial({ map: mapa, color: tonos[lista.length % tonos.length], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
        estrella.position.copy(v).multiplyScalar(150).add(CENTRO);
        estrella.scale.setScalar(0.022 + Math.random() * 0.03);
        estrella.userData = { fase: Math.random() * 6.28, fuerza: 0.45 + Math.random() * 0.55 };
        estrella.renderOrder = 0;
        escena.add(estrella);
        lista.push(estrella);
    }
    return lista;
})();

const halos = [[10, 0.16, [1, 0.5, 0.22]], [3.8, 0.28, [1, 0.72, 0.45]]].map(([tam, fuerza, c]) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: mapaHalo, color: new THREE.Color(...c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: fuerza }));
    halo.scale.setScalar(tam);
    halo.renderOrder = 10;
    halo.userData.fuerza = fuerza;
    agujero.add(halo);
    return halo;
});


// =====================================================================
// 6b. LA ESTRELLA DESTROZADA
// De vez en cuando (o al tocar) una estrella cae hacia el agujero. Al
// pasar muy cerca, la gravedad la estira y la rompe en un río de gas:
// la mitad se escapa hacia fuera y la otra mitad da vueltas y acaba
// entrando en el disco. Cada trozo se mueve con la gravedad de verdad
// (en el plano del disco, un poco inclinado).
// =====================================================================

const GM = 5.4;
const TROZOS = movil ? 500 : 900;
const marea = {
    estado: "nada",
    espera: parametros.get("marea") === "si" ? 7 : 40 + Math.random() * 25,
    ultima: -99,
    estrella: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    trozos: new Float32Array(TROZOS * 7)
};

const geometriaMarea = new THREE.BufferGeometry();
geometriaMarea.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TROZOS * 3), 3));
geometriaMarea.setAttribute("aBrillo", new THREE.BufferAttribute(new Float32Array(TROZOS), 1));
const materialMarea = new THREE.ShaderMaterial({
    uniforms: { uEscala: { value: 1 } },
    vertexShader: `
        attribute float aBrillo;
        uniform float uEscala;
        varying float vBrillo;
        void main() {
            vBrillo = aBrillo;
            vec4 vista = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uEscala * (0.6 + aBrillo * 0.6) / -vista.z;
            gl_Position = projectionMatrix * vista;
        }
    `,
    fragmentShader: `
        varying float vBrillo;
        void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = exp(-r * r * 5.0);
            vec3 color = mix(vec3(1.0, 0.55, 0.25), vec3(0.85, 0.92, 1.0), clamp(vBrillo - 0.6, 0.0, 1.0));
            gl_FragColor = vec4(color * a * vBrillo * 2.6, a * min(vBrillo, 1.0));
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const rioMarea = brillar(new THREE.Points(geometriaMarea, materialMarea));
rioMarea.frustumCulled = false;
rioMarea.renderOrder = 8;
rioMarea.visible = false;
agujero.add(rioMarea);

const estrellaMarea = brillar(new THREE.Sprite(new THREE.SpriteMaterial({ map: mapaHalo, color: new THREE.Color(0.85, 0.92, 1).multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
estrellaMarea.visible = false;
estrellaMarea.renderOrder = 8;
agujero.add(estrellaMarea);

function lanzarEstrella() {
    if (marea.estado !== "nada" || comunes.uTiempo.value - marea.ultima < 15) return;
    // Órbita casi parabólica que pasa muy cerca, en el plano del disco
    const q = 2.5;
    const phi = -2.05 + (Math.random() - 0.5) * 0.2;
    const r = (2 * q) / (1 + Math.cos(phi));
    const sentido = 1;
    const v = Math.sqrt((2 * GM) / r) * 0.985;
    const h = Math.sqrt(2 * GM * q) * 0.985;
    const vt = h / r;
    const vr = -Math.sqrt(Math.max(0, v * v - vt * vt));
    const e = marea.estrella;
    const c = Math.cos(phi * sentido);
    const s = Math.sin(phi * sentido);
    // La órbita va inclinada respecto al disco para que el río de gas se
    // vea por encima y por debajo antes de caer en él
    const inc = 0.5;
    const z = r * s;
    const vz = vr * s + vt * c * sentido;
    e.x = r * c;
    e.y = z * Math.sin(inc);
    e.z = z * Math.cos(inc);
    e.vx = vr * c - vt * s * sentido;
    e.vy = vz * Math.sin(inc);
    e.vz = vz * Math.cos(inc);
    marea.estado = "cae";
    marea.t = 0;
    estrellaMarea.visible = true;
}

function romperEstrella() {
    const e = marea.estrella;
    const t = marea.trozos;
    const v = Math.hypot(e.vx, e.vy, e.vz);
    for (let i = 0; i < TROZOS; i++) {
        const k = i * 7;
        // Repartidos a lo largo de la trayectoria y con velocidades un poco
        // distintas: unos ligados al agujero y otros no
        const desfase = (Math.random() - 0.5) * 0.9;
        const extra = 1 + (Math.random() - 0.5) * 0.16;
        t[k] = e.x + (e.vx / v) * desfase + (Math.random() - 0.5) * 0.05;
        t[k + 1] = e.y + (Math.random() - 0.5) * 0.04;
        t[k + 2] = e.z + (e.vz / v) * desfase + (Math.random() - 0.5) * 0.05;
        t[k + 3] = e.vx * extra;
        t[k + 4] = e.vy * extra;
        t[k + 5] = e.vz * extra;
        t[k + 6] = 1;
    }
    marea.estado = "rio";
    marea.t = 0;
    estrellaMarea.visible = false;
    rioMarea.visible = true;
    despertar();
}

// Un paso de gravedad (y, dentro del disco, rozamiento que va metiendo
// el gas en órbitas circulares cada vez más pequeñas)
function gravedad(p, k, dt, conRoce) {
    const x = p[k];
    const y = p[k + 1];
    const z = p[k + 2];
    const r2 = x * x + y * y + z * z;
    const r = Math.sqrt(r2);
    const a = -GM / (r2 * r);
    p[k + 3] += a * x * dt;
    p[k + 4] += a * y * dt;
    p[k + 5] += a * z * dt;
    if (conRoce && r < 5.2) {
        // Velocidad circular en el plano del disco
        const vc = Math.sqrt(GM / r) * 0.97;
        const sentido = Math.sign(x * p[k + 5] - z * p[k + 3]) || 1;
        const tx = (-z / r) * vc * sentido;
        const tz = (x / r) * vc * sentido;
        const roce = Math.min(1, dt * 0.9);
        p[k + 3] += (tx - p[k + 3]) * roce;
        p[k + 5] += (tz - p[k + 5]) * roce;
        p[k + 4] += (-y * 1.2 - p[k + 4]) * roce * 0.5;
    }
    p[k] += p[k + 3] * dt;
    p[k + 1] += p[k + 4] * dt;
    p[k + 2] += p[k + 5] * dt;
    return r;
}

const estadoEstrella = new Float32Array(6);

function moverMarea(delta) {
    if (marea.estado === "nada") {
        marea.espera -= delta;
        if (marea.espera <= 0 && comunes.uEncendido.value > 0.95 && !pocoMovimiento) {
            lanzarEstrella();
            marea.espera = 55 + Math.random() * 35;
        }
        return;
    }
    marea.t += delta;
    const pasos = 4;
    const dt = delta / pasos;
    if (marea.estado === "cae") {
        const e = marea.estrella;
        const s = estadoEstrella;
        s.set([e.x, e.y, e.z, e.vx, e.vy, e.vz]);
        let r = 99;
        for (let i = 0; i < pasos; i++) r = gravedad(s, 0, dt, false);
        [e.x, e.y, e.z, e.vx, e.vy, e.vz] = s;
        estrellaMarea.position.set(e.x, e.y, e.z);
        // Se va estirando y calentando al acercarse
        const cerca = THREE.MathUtils.smoothstep(r, 9, 3);
        estrellaMarea.scale.setScalar(0.8 + cerca * 1.2);
        estrellaMarea.material.opacity = Math.min(1, marea.t * 0.8);
        if (r < 3.1) romperEstrella();
        return;
    }
    const p = marea.trozos;
    const pos = geometriaMarea.attributes.position.array;
    const brilloT = geometriaMarea.attributes.aBrillo.array;
    let vivos = 0;
    for (let i = 0; i < TROZOS; i++) {
        const k = i * 7;
        if (p[k + 6] <= 0) {
            brilloT[i] = 0;
            continue;
        }
        let r = 99;
        for (let j = 0; j < pasos; j++) r = gravedad(p, k, dt, marea.t > 2.5);
        // Se apaga al entrar en el disco interior o al alejarse mucho
        if (r < 1.5) p[k + 6] -= delta * 1.5;
        else if (r > 25) p[k + 6] -= delta * 0.6;
        else if (marea.t > 14) p[k + 6] -= delta * 0.12;
        pos[i * 3] = p[k];
        pos[i * 3 + 1] = p[k + 1];
        pos[i * 3 + 2] = p[k + 2];
        // Al principio, con todo el gas junto, brilla menos cada trozo para
        // no hacer una mancha blanca
        const junto = THREE.MathUtils.smoothstep(marea.t, 0, 1.5);
        brilloT[i] = Math.max(0, p[k + 6]) * (0.25 + 0.75 * junto) * (0.55 + 0.9 * Math.exp(-marea.t * 0.3) + 0.5 / Math.max(r - 0.8, 0.6));
        if (p[k + 6] > 0) vivos++;
    }
    geometriaMarea.attributes.position.needsUpdate = true;
    geometriaMarea.attributes.aBrillo.needsUpdate = true;
    if (!vivos || marea.t > 30) {
        marea.estado = "nada";
        marea.ultima = comunes.uTiempo.value;
        rioMarea.visible = false;
    }
}


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
        const op = { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false };
        this.escena = new THREE.WebGLRenderTarget(1, 1, { ...op, depthBuffer: true });
        this.niveles = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)]);
        this.raya = [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)];
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
                tRaya: { value: null },
                uRaya: { value: 0.22 },
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
                uniform sampler2D tRaya;
                uniform float uRaya;
                uniform float uFuerza;
                uniform vec2 uCentro;
                uniform vec2 uRadio;
                varying vec2 vUv;
                void main() {
                    vec4 base = texture2D(tBase, vUv);
                    vec3 brillo = texture2D(tN0, vUv).rgb * 0.22 + texture2D(tN1, vUv).rgb * 0.42 + texture2D(tN2, vUv).rgb * 0.75;
                    float bola = 1.0 - smoothstep(0.8, 1.0, length((vUv - uCentro) / uRadio));
                    brillo += texture2D(tRaya, vUv).rgb * vec3(0.8, 0.88, 1.0) * uRaya;
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
        const m = Math.max(1, Math.round(ancho / ajustes.brilloEscala));
        const n = Math.max(1, Math.round(alto / ajustes.brilloEscala));
        this.escena.setSize(m, n);
        this.niveles.forEach((par, i) => {
            const f = 1 << i;
            par.forEach((rt) => rt.setSize(Math.max(1, Math.round(m / f)), Math.max(1, Math.round(n / f))));
        });
        this.raya.forEach((rt) => rt.setSize(Math.max(1, Math.round(m / 2)), Math.max(1, Math.round(n / 4))));
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

        // El destello horizontal: solo lo más fuerte, estirado de lado
        const [ra, rb] = this.raya;
        this.recortar.uniforms.uUmbral.value = 3.0;
        this.pasada(renderizador, this.recortar, ra);
        this.recortar.uniforms.uUmbral.value = 0.7;
        const d = this.difuminar.uniforms;
        [[ra, rb, 2], [rb, ra, 4.5], [ra, rb, 10], [rb, ra, 22]].forEach(([desde, hacia, escala]) => {
            d.tEntrada.value = desde.texture;
            d.uDir.value.set(escala / desde.width, 0);
            this.pasada(renderizador, this.difuminar, hacia);
        });

        const u = this.mezclar.uniforms;
        u.tBase.value = origen.texture;
        u.tN0.value = n0[0].texture;
        u.tN1.value = n1[0].texture;
        u.tN2.value = n2[0].texture;
        u.tRaya.value = ra.texture;
        this.pasada(renderizador, this.mezclar, this.renderToScreen ? null : destino);
    }
}


// =====================================================================
// 8. EFECTOS: RESPLANDOR Y ACABADO
// Al final, un poco más de contraste, los colores que se separan muy
// poco hacia los bordes como en una lente de verdad, un oscurecido
// suave en las esquinas y un grano muy fino que evita que los
// degradados oscuros se vean a escalones.
// =====================================================================

const contexto = renderizador.getContext();
const hayFlotantes = renderizador.capabilities.isWebGL2 && !!(contexto.getExtension("EXT_color_buffer_float") || contexto.getExtension("EXT_color_buffer_half_float"));
const compositor = new EffectComposer(renderizador, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: hayFlotantes ? THREE.HalfFloatType : THREE.UnsignedByteType }));
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
            vec2 q = vUv - 0.5;
            vec2 desvio = q * dot(q, q) * 0.007;
            vec4 c = texture2D(tDiffuse, vUv);
            c.r = texture2D(tDiffuse, vUv - desvio).r;
            c.b = texture2D(tDiffuse, vUv + desvio).b;
            c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.2);
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
// Arrastrando se gira alrededor del agujero, y al soltar sigue girando
// un poco y se frena solo (inercia). Con la rueda o pellizcando te
// acercas: la luz se dobla más, el anillo brilla más, el gas va más
// lento (el tiempo pasa más despacio cerca) y el sonido se hace más
// grave. Sin tocar nada, la cámara se mece muy despacio. El agujero
// sigue casi del todo a la cámara.
// =====================================================================

const vista = {
    giro: 0, altura: 0, objGiro: 0, objAltura: 0, radio: 16.4, arrastrando: false, x: 0, y: 0,
    orbita: 0, orbitaAltura: 0, velGiro: 0, velAltura: 0,
    zoom: 1, objZoom: 1, giroActual: BASE_GIRO, punteros: new Map(), pellizco: 0
};

// 0 lejos, 1 lo más cerca posible
const cercania = () => THREE.MathUtils.clamp((1 - vista.zoom) / (1 - 0.42), 0, 1);
const auxV = new THREE.Vector3();

function colocarCamara(delta, t) {
    const suave = Math.min(1, delta * 2.5);
    vista.giro += (vista.objGiro - vista.giro) * suave;
    vista.altura += (vista.objAltura - vista.altura) * suave;
    // Inercia: al soltar sigue girando y se va frenando
    if (!vista.arrastrando) {
        vista.orbita += vista.velGiro * delta;
        vista.orbitaAltura += vista.velAltura * delta;
        const freno = Math.exp(-delta * 1.6);
        vista.velGiro *= freno;
        vista.velAltura *= freno;
    }
    vista.orbitaAltura = THREE.MathUtils.clamp(vista.orbitaAltura, -0.14, 0.4);
    vista.zoom += (vista.objZoom - vista.zoom) * Math.min(1, delta * 3);
    const acercar = 1 + 0.22 * Math.pow(1 - comunes.uEncendido.value, 2);
    const balanceo = pocoMovimiento ? 0 : 1;
    const giro = BASE_GIRO + vista.orbita + vista.giro + Math.sin(t * 0.12) * 0.05 * balanceo;
    const altura = Math.max(0.04, BASE_ALTURA + vista.orbitaAltura + vista.altura + Math.sin(t * 0.09) * 0.015 * balanceo);
    vista.giroActual = giro;
    camara.position.set(Math.sin(giro) * Math.cos(altura), Math.sin(altura), Math.cos(giro) * Math.cos(altura)).multiplyScalar(vista.radio * acercar * vista.zoom).add(OBJETIVO);
    camara.lookAt(OBJETIVO);
}

function orientarAgujero() {
    auxV.subVectors(camara.position, CENTRO);
    // El giro sin cortes (atan2 saltaría de -180 a 180 grados al dar la vuelta)
    let giro = Math.atan2(auxV.x, auxV.z);
    giro += Math.round((vista.giroActual - giro) / (Math.PI * 2)) * Math.PI * 2;
    const elevacion = Math.atan2(auxV.y, Math.hypot(auxV.x, auxV.z));
    const g = BASE_GIRO + (giro - BASE_GIRO) * 0.75;
    const e = BASE_ALTURA + (elevacion - BASE_ALTURA) * 0.75;
    agujero.rotation.set(-(e - 0.2), g, -0.4);
    agujero.updateMatrixWorld();
    arcos.rotation.set(-(elevacion - 0.2), giro, -0.4);
    arcos.updateMatrixWorld();
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

// El sonido: un zumbido grave como de órgano (varias notas suaves con
// eco) que solo empieza al pulsar el botón. Al despertar al agujero se
// abre y sube un momento.
const sonido = { ctx: null, activo: false, maestro: null, filtro: null, osciladores: [], base: 520 };
const botonSonido = document.getElementById("boton-sonido");

function impulsoEco(ctx, segundos) {
    const largo = Math.floor(ctx.sampleRate * segundos);
    const buffer = ctx.createBuffer(2, largo, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
        const datos = buffer.getChannelData(canal);
        for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / largo, 2.6);
    }
    return buffer;
}

function crearSonido() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const maestro = ctx.createGain();
    maestro.gain.value = 0;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 520;
    filtro.Q.value = 0.7;
    const eco = ctx.createConvolver();
    eco.buffer = impulsoEco(ctx, 4.5);
    const seco = ctx.createGain();
    seco.gain.value = 0.55;
    const mojado = ctx.createGain();
    mojado.gain.value = 0.7;
    filtro.connect(seco).connect(maestro);
    filtro.connect(eco).connect(mojado).connect(maestro);
    maestro.connect(ctx.destination);
    [[55, 0.5, "sine"], [82.41, 0.28, "sine"], [110, 0.3, "triangle"], [164.81, 0.14, "triangle"], [220, 0.08, "sine"]].forEach(([frecuencia, volumen, tipo]) => {
        [-4, 4].forEach((desafinar) => {
            const osc = ctx.createOscillator();
            osc.type = tipo;
            osc.frequency.value = frecuencia;
            osc.detune.value = desafinar;
            osc.userData = desafinar;
            sonido.osciladores.push(osc);
            const voz = ctx.createGain();
            voz.gain.value = volumen / 2;
            osc.connect(voz).connect(filtro);
            osc.start();
        });
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const profundidad = ctx.createGain();
    profundidad.gain.value = 160;
    lfo.connect(profundidad).connect(filtro.frequency);
    lfo.start();
    Object.assign(sonido, { ctx, maestro, filtro });
}

function cambiarSonido() {
    if (!sonido.ctx) crearSonido();
    sonido.activo = !sonido.activo;
    sonido.ctx.resume();
    sonido.maestro.gain.setTargetAtTime(sonido.activo ? 0.22 : 0, sonido.ctx.currentTime, 0.8);
    botonSonido.setAttribute("aria-pressed", sonido.activo);
    botonSonido.classList.toggle("activo", sonido.activo);
}

// Cerca del agujero el zumbido baja de tono y se apaga lo agudo
function sonidoCercania() {
    if (!sonido.ctx || !sonido.activo) return;
    const c = cercania();
    const ahora = sonido.ctx.currentTime;
    sonido.base = 520 * (1 - 0.55 * c);
    sonido.osciladores.forEach((o) => o.detune.setTargetAtTime(o.userData - c * 500, ahora, 0.4));
    if (comunes.uPulso.value < 0.05) {
        sonido.filtro.frequency.setTargetAtTime(sonido.base, ahora, 0.4);
        sonido.maestro.gain.setTargetAtTime(0.22 * (1 + c * 0.5), ahora, 0.4);
    }
}

function sonarDespertar() {
    if (!sonido.activo) return;
    const ahora = sonido.ctx.currentTime;
    const f = sonido.filtro.frequency;
    f.cancelScheduledValues(ahora);
    f.setTargetAtTime(1700, ahora, 0.08);
    f.setTargetAtTime(sonido.base, ahora + 0.7, 1.3);
    const g = sonido.maestro.gain;
    g.cancelScheduledValues(ahora);
    g.setTargetAtTime(0.36, ahora, 0.1);
    g.setTargetAtTime(0.22, ahora + 0.8, 1.5);
}

botonSonido.addEventListener("click", cambiarSonido);
document.addEventListener("visibilitychange", () => {
    if (!sonido.ctx || !sonido.activo) return;
    if (document.hidden) sonido.ctx.suspend();
    else sonido.ctx.resume();
});
const toque = { x: 0, y: 0, t: 0 };
const lienzo = renderizador.domElement;

function despertar() {
    sonarDespertar();
    comunes.uPulso.value = 1;
    comunes.uOnda.value = 5.2;
}

function cambiarZoom(factor) {
    vista.objZoom = THREE.MathUtils.clamp(vista.objZoom * factor, 0.42, 1.3);
}

lienzo.addEventListener("pointerdown", (e) => {
    pista.classList.add("oculta");
    lienzo.setPointerCapture(e.pointerId);
    vista.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    Object.assign(toque, { x: e.clientX, y: e.clientY, t: performance.now() });
    vista.arrastrando = true;
    vista.velGiro = 0;
    vista.velAltura = 0;
    vista.x = e.clientX;
    vista.y = e.clientY;
    if (vista.punteros.size === 2) {
        const [a, b] = [...vista.punteros.values()];
        vista.pellizco = Math.hypot(a.x - b.x, a.y - b.y);
    }
});

lienzo.addEventListener("pointermove", (e) => {
    if (vista.punteros.has(e.pointerId)) vista.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Dos dedos: pellizcar para acercar o alejar
    if (vista.punteros.size === 2) {
        const [a, b] = [...vista.punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (vista.pellizco > 0) cambiarZoom(vista.pellizco / d);
        vista.pellizco = d;
        return;
    }
    if (!vista.arrastrando) {
        // Ratón sin pulsar: solo inclina un poco la vista
        if (e.pointerType === "mouse") {
            vista.objGiro = -(e.clientX / innerWidth - 0.5) * 0.3;
            vista.objAltura = (e.clientY / innerHeight - 0.5) * 0.1;
        }
        return;
    }
    const dx = (e.clientX - vista.x) / innerWidth;
    const dy = (e.clientY - vista.y) / innerHeight;
    vista.orbita -= dx * 3.2;
    vista.orbitaAltura += dy * 1.2;
    const dt = Math.max(0.008, (performance.now() - (vista.ultimo || 0)) / 1000);
    vista.velGiro = THREE.MathUtils.clamp((-dx * 3.2) / dt, -3, 3);
    vista.velAltura = THREE.MathUtils.clamp((dy * 1.2) / dt, -1, 1);
    vista.ultimo = performance.now();
    vista.x = e.clientX;
    vista.y = e.clientY;
});

lienzo.addEventListener("wheel", (e) => {
    e.preventDefault();
    pista.classList.add("oculta");
    cambiarZoom(Math.exp(e.deltaY * 0.0012));
}, { passive: false });

const soltar = (e) => {
    vista.punteros.delete(e.pointerId);
    if (vista.punteros.size < 2) vista.pellizco = 0;
    if (vista.punteros.size > 0) return;
    vista.arrastrando = false;
    // Si hace rato que no se movía, no se lanza al soltar
    if (performance.now() - (vista.ultimo || 0) > 120) {
        vista.velGiro = 0;
        vista.velAltura = 0;
    }
    if (e.type === "pointerup" && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 8 && performance.now() - toque.t < 350) {
        despertar();
        lanzarEstrella();
    }
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
    materialMarea.uniforms.uEscala.value = renderizador.getPixelRatio() * innerHeight * 0.12;
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
const entrada = { t: parametros.has("fijo") || parametros.has("sinentrada") || pocoMovimiento ? 10 : 0 };

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
    // Cerca del agujero el tiempo pasa más despacio: el gas gira más lento
    const t = (comunes.uTiempo.value += delta * (1 - cercania() * 0.45));
    if (real < 0.5) adaptarResolucion(real);
    colocarCamara(delta, t);
    orientarAgujero();
    const pulso = (comunes.uPulso.value *= Math.exp(-delta * 1.1));
    comunes.uOnda.value = Math.max(0.6, comunes.uOnda.value - delta * 2.6);
    const encendido = moverEntrada(delta);
    const luzAnillo = THREE.MathUtils.smoothstep(encendido, 0.6, 1);
    const c = cercania();
    anillo.material.color.setRGB(1, 0.88, 0.7).multiplyScalar((2.4 + Math.sin(t * 2.2) * 0.4 + pulso * 3) * luzAnillo * (1 + c * 0.8));
    anillo2.material.color.setRGB(1, 0.8, 0.6).multiplyScalar(0.45 * luzAnillo);
    halos.forEach((h, i) => (h.material.opacity = h.userData.fuerza * encendido * (0.85 + 0.15 * Math.sin(t * (1.1 + i * 0.7)) + pulso * 0.8)));
    brillo.mezclar.uniforms.uFuerza.value = 0.55 * (1 + pulso * 0.6) * (1 - c * 0.35);
    marcarBola();
    moverMarea(delta);
    sonidoCercania();
    destellos.forEach((d) => (d.material.opacity = d.userData.fuerza * fondo.material.uniforms.uAparece.value * (0.8 + 0.2 * Math.sin(t * 1.3 + d.userData.fase))));
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
