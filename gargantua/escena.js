import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// =====================================================================
// 1. AJUSTES
// Gargantua solo, flotando en un estudio. El disco de gas son varias
// capas que giran (más rápido por dentro), la luz doblada son dos arcos
// que abrazan la bola negra, y un resplandor hecho a mano hace brillar
// lo caliente. El disco ilumina el suelo de debajo. Se puede cambiar
// entre estudio claro y oscuro.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.75,
    sombra: movil ? 1024 : 2048,
    polvo: movil ? 70 : 120,
    estrellas: movil ? 500 : 900,
    desenfoque: !movil
};
const ALTURA = 3.6;
const CENTRO = new THREE.Vector3(0, ALTURA, 0);
const CAPA_BRILLO = 1;


// =====================================================================
// 2. RENDERIZADOR, ESCENA, LUCES Y CÁMARA
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.0;
renderizador.shadowMap.enabled = true;
renderizador.shadowMap.type = THREE.VSMShadowMap;
renderizador.shadowMap.autoUpdate = false;
renderizador.shadowMap.needsUpdate = true;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();
escena.environment = new THREE.PMREMGenerator(renderizador).fromScene(new RoomEnvironment(renderizador), 0.04).texture;

const camara = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 400);
camara.position.set(2.5, 6.4, 15.5);
camara.layers.enable(CAPA_BRILLO);
const controles = new OrbitControls(camara, renderizador.domElement);
controles.target.set(0, ALTURA - 0.2, 0);
controles.enableDamping = true;
controles.dampingFactor = 0.05;
controles.enablePan = false;
controles.minDistance = 8;
controles.maxDistance = 30;
controles.minPolarAngle = Math.PI * 0.3;
controles.maxPolarAngle = Math.PI * 0.5;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.3;

const sol = new THREE.DirectionalLight(0xfff4ea, 1.4);
sol.position.set(-7, 14, 6);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
sol.shadow.radius = 16;
sol.shadow.blurSamples = 20;
sol.shadow.bias = -0.0004;
Object.assign(sol.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
escena.add(sol);
const relleno = new THREE.HemisphereLight(0xf2f4ff, 0xd8d2cc, 0.45);
escena.add(relleno);

const comunes = { uTiempo: { value: 0 }, uVista: { value: new THREE.Vector3(0, 0, 1) }, uLuzGas: { value: 1 }, uTinta: { value: 0 }, uPulso: { value: 0 }, uOnda: { value: 9 } };


// =====================================================================
// 3. EL ESTUDIO
// Un fondo con degradado y un suelo del mismo color que se funde con
// él gracias a la niebla. En modo oscuro el suelo brilla un poco más
// y aparecen estrellas a lo lejos.
// =====================================================================

const MODOS = {
    claro: { arriba: [0.66, 0.66, 0.69], horizonte: [0.8, 0.8, 0.82], abajo: [0.72, 0.72, 0.74], sombra: 0.22, sol: 1.4, relleno: 0.45, gas: 0.8, tinta: 1, reflejo: 1.1, halo: 0.25, brillo: 0.3, estrellas: 0 },
    oscuro: { arriba: [0.004, 0.005, 0.01], horizonte: [0.02, 0.022, 0.035], abajo: [0.008, 0.009, 0.015], sombra: 0.5, sol: 0.35, relleno: 0.12, gas: 1, tinta: 0, reflejo: 0.55, halo: 1, brillo: 0.55, estrellas: 1 }
};

const fondo = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 16),
    new THREE.ShaderMaterial({
        uniforms: { uArriba: { value: new THREE.Color() }, uHorizonte: { value: new THREE.Color() }, uAbajo: { value: new THREE.Color() } },
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uArriba;
            uniform vec3 uHorizonte;
            uniform vec3 uAbajo;
            varying vec3 vDir;
            void main() {
                float h = vDir.y;
                vec3 c = mix(uAbajo, uHorizonte, smoothstep(-0.6, 0.0, h));
                c = mix(c, uArriba, smoothstep(0.0, 0.7, h));
                gl_FragColor = vec4(c, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
    })
);
escena.add(fondo);

const suelo = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: 0x1a1620, opacity: 0.22, depthWrite: false }));
suelo.receiveShadow = true;
escena.add(suelo);

const reflejo = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uPulso: comunes.uPulso, uFuerza: { value: 0.5 }, tRuido: { value: null } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTiempo;
            uniform float uPulso;
            uniform float uFuerza;
            uniform sampler2D tRuido;
            varying vec2 vUv;
            void main() {
                vec2 p = (vUv - 0.5) * 2.0;
                float r = length(p);
                float ang = atan(p.y, p.x) / 6.2832;
                float n = texture2D(tRuido, vec2(ang - uTiempo * 0.05, r * 0.4)).r;
                float luz = exp(-r * r * 6.0) * (0.7 + 0.6 * n) * 0.55 + exp(-r * r * 26.0) * 0.25;
                luz *= uFuerza * (1.0 + uPulso * 0.9);
                vec3 c = mix(vec3(0.7, 0.2, 0.08), vec3(1.0, 0.5, 0.24), exp(-r * r * 12.0));
                gl_FragColor = vec4(c * luz, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    })
);
reflejo.position.y = 0.01;
reflejo.renderOrder = 1;
escena.add(reflejo);


// =====================================================================
// 4. EL GAS
// Una textura de ruido ya hecha leída en coordenadas polares: gira más
// rápido por dentro, con anillos que se desplazan, filamentos finos,
// grumos calientes y un lado más brillante (el gas que viene hacia ti).
// =====================================================================

function texturaRuido() {
    const n = 256;
    const celdas = 16;
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
            for (let o = 0; o < 4; o++) {
                const c = 4 << o;
                s += a * valor((x / n) * c, (y / n) * c, c);
                a *= 0.5;
            }
            datos[y * n + x] = Math.floor(Math.min(1, s / 0.94) * 255);
        }
    }
    const t = new THREE.DataTexture(datos, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
}


const tRuido = { value: texturaRuido() };
reflejo.material.uniforms.tRuido.value = tRuido.value;

const gasGlsl = `
    uniform sampler2D tRuido;
    uniform float uTiempo;
    uniform vec3 uVista;
    uniform float uDesfase;
    uniform float uLuzGas;
    uniform float uTinta;
    uniform float uPulso;
    uniform float uOnda;
    const float DENTRO = 1.35;
    const float FUERA = 4.8;
    vec4 gas(float r, float phi) {
        float x = (r - DENTRO) / (FUERA - DENTRO);
        float omega = 1.5 * pow(r / DENTRO, -1.5);
        float ang = (phi - uTiempo * omega) / 6.2832 + uDesfase;
        float n = texture2D(tRuido, vec2(ang, r * 0.16 + uDesfase)).r;
        float fino = texture2D(tRuido, vec2(ang * 3.0, r * 0.6 + 0.37)).r;
        float hebras = texture2D(tRuido, vec2(ang * 9.0, r * 2.2 + 0.11)).r;
        float polvo = smoothstep(0.55, 0.8, texture2D(tRuido, vec2(ang + 0.5, r * 0.09 + 0.61)).r) * smoothstep(0.12, 0.6, x);
        float perfil = smoothstep(-0.02, 0.05, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.15);
        float anillos = 0.6 + 0.4 * sin(r * 14.0 - uTiempo * 1.1 + n * 4.0) * sin(r * 4.6 + uTiempo * 0.4);
        float densidad = smoothstep(0.22, 0.75, n) * (0.45 + 0.75 * fino) * (0.7 + 0.6 * hebras) * anillos;
        densidad = mix(densidad, 1.0, smoothstep(0.14, 0.0, x));
        float manchas = 0.0;
        for (int i = 0; i < 6; i++) {
            float ri = 1.6 + float(i) * 0.5;
            float ai = uTiempo * 1.5 * pow(ri / DENTRO, -1.5) + float(i) * 2.3;
            float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
            manchas += exp(-pow(da / (0.35 + float(i) * 0.12), 2.0) - pow((r - ri) / 0.1, 2.0)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + float(i)));
        }
        float temperatura = pow(DENTRO / r, 1.4);
        vec3 col = mix(vec3(0.38, 0.13, 0.05), vec3(1.0, 0.46, 0.16), smoothstep(0.1, 0.42, temperatura));
        col = mix(col, vec3(1.0, 0.78, 0.5), smoothstep(0.42, 0.75, temperatura));
        col = mix(col, vec3(1.0, 0.95, 0.88), smoothstep(0.75, 1.0, temperatura));
        vec3 vel = vec3(-sin(phi), 0.0, cos(phi));
        float v = 0.45 * pow(DENTRO / r, 0.5);
        float doppler = 1.0 / (inversesqrt(1.0 - v * v) * (1.0 - v * dot(vel, uVista)));
        float haz = mix(1.0, pow(doppler, 3.0), 0.8);
        float brillo = temperatura * 2.0 * haz * (1.0 + 0.12 * sin(uTiempo * 1.3 + r * 2.5));
        col *= brillo * (1.0 - polvo * 0.75) * (1.0 + manchas * 1.5);
        col = mix(col, col * vec3(1.1, 0.8, 0.62), smoothstep(1.0, 0.6, doppler) * 0.6);
        col = mix(col, col * vec3(0.95, 1.0, 1.1) + 0.06, smoothstep(1.0, 1.45, doppler) * 0.5);
        col *= 1.0 + uPulso * 0.45 + uPulso * 2.2 * exp(-pow((r - uOnda) / 0.3, 2.0));
        float alfa = clamp((densidad + manchas * 0.4) * perfil * 1.6, 0.0, 1.0);
        return vec4(col, alfa);
    }
`;

function materialGas(modo, opciones = {}) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false });
    const desfase = { value: opciones.desfase ?? 0 };
    const fuerza = opciones.fuerza ?? 1;
    material.onBeforeCompile = (shader) => {
        shader.uniforms.tRuido = tRuido;
        shader.uniforms.uTiempo = comunes.uTiempo;
        shader.uniforms.uVista = comunes.uVista;
        shader.uniforms.uDesfase = desfase;
        shader.uniforms.uLuzGas = comunes.uLuzGas;
        shader.uniforms.uTinta = comunes.uTinta;
        shader.uniforms.uPulso = comunes.uPulso;
        shader.uniforms.uOnda = comunes.uOnda;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLocalG;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalG = position;");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLocalG;\nuniform float uFuerzaCapa;\n" + gasGlsl)
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
                vec3 colG = pow(g.rgb, vec3(1.15));
                float grisG = dot(colG, vec3(0.3, 0.55, 0.15));
                colG = max(mix(vec3(grisG), colG, 1.0 + uTinta * 0.6), 0.0);
                diffuseColor.rgb = colG * uLuzGas * ${modo === "disco" ? "0.85" : "1.0"};
                diffuseColor.a = clamp(g.a * (1.7 + uTinta * 1.1), 0.0, 1.0);`
            );
    };
    material.customProgramCacheKey = () => "gas" + modo + fuerza;
    return material;
}


// =====================================================================
// 5. GARGANTUA
// Bola negra brillante, disco en tres capas (la del medio con volumen y
// dos más finas y suaves por encima y por debajo), los dos arcos de luz
// doblada, el anillo de fotones, polvo en órbita y halos de luz. Todo
// el grupo se gira hacia la cámara para verse siempre como Gargantua.
// =====================================================================

const agujero = new THREE.Group();
agujero.position.copy(CENTRO);
agujero.rotation.order = "YXZ";
escena.add(agujero);

const brillar = (o) => {
    o.layers.enable(CAPA_BRILLO);
    return o;
};

const sombra = brillar(new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96),
    new THREE.MeshPhysicalMaterial({ color: 0x010102, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.12 })
));
sombra.castShadow = true;
agujero.add(sombra);

function discoConVolumen(grosorMax) {
    const perfil = [];
    const dentro = 1.3;
    const fuera = 4.85;
    const grosor = (r) => grosorMax * Math.pow(1 - (r - dentro) / (fuera - dentro), 0.8) + 0.006;
    const n = 80;
    for (let i = 0; i <= n; i++) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, -grosor(r)));
    }
    for (let i = n; i >= 0; i--) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, grosor(r)));
    }
    perfil.push(perfil[0].clone());
    return new THREE.LatheGeometry(perfil, 256);
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
    const geo = new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: true, bevelThickness: grosor * 0.6, bevelSize: grosor * 0.6, bevelSegments: 3, curveSegments: 160 });
    geo.translate(0, 0, -grosor / 2);
    return geo;
}

const arcos = new THREE.Group();
const arcoArriba = brillar(new THREE.Mesh(arco(1.15, 2.6, 0.01, Math.PI - 0.02, 0.05), materialGas("arriba")));
const arcoArriba2 = brillar(new THREE.Mesh(arco(1.15, 2.6, 0.01, Math.PI - 0.02, 0.05), materialGas("arriba", { fuerza: 0.35, desfase: 0.5 })));
arcoArriba2.position.z = -0.12;
const arcoAbajo = brillar(new THREE.Mesh(arco(1.11, 1.62, Math.PI + 0.04, Math.PI - 0.08, 0.04), materialGas("abajo")));
const anillo = brillar(new THREE.Mesh(new THREE.TorusGeometry(1.075, 0.012, 12, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.66).multiplyScalar(2.2), fog: false })));
const anillo2 = brillar(new THREE.Mesh(new THREE.TorusGeometry(1.11, 0.006, 8, 256), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.6).multiplyScalar(1.2), fog: false })));
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

const halos = [];
[[10, 0.16, [1, 0.5, 0.22]], [3.8, 0.28, [1, 0.72, 0.45]]].forEach(([tam, fuerza, c]) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaHalo(), color: new THREE.Color(...c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: fuerza, fog: false }));
    halo.scale.setScalar(tam);
    halo.renderOrder = 10;
    halo.userData.fuerza = fuerza;
    agujero.add(halo);
    halos.push(halo);
});

const polvo = brillar(new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), ajustes.polvo));
polvo.renderOrder = 11;
const motas = [];
for (let i = 0; i < ajustes.polvo; i++) {
    const r = 1.45 + Math.pow(Math.random(), 1.3) * 3.2;
    motas.push({ r, ang: Math.random() * 6.28, y: (Math.random() - 0.5) * 0.04 * r, tam: 0.4 + Math.random() * 0.9 });
    const calorM = Math.pow(1.35 / r, 1.2);
    polvo.setColorAt(i, new THREE.Color(1, 0.55 + calorM * 0.4, 0.25 + calorM * 0.6).multiplyScalar(0.6 + calorM * 1.6));
}
agujero.add(polvo);

const estrellas = (() => {
    const n = ajustes.estrellas;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const u = Math.random() * 0.9 + 0.08;
        const a = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * s * 150, u * 150, Math.sin(a) * s * 150], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const puntos = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, map: texturaHalo(), size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    escena.add(puntos);
    return puntos;
})();


// =====================================================================
// 6. RESPLANDOR HECHO A MANO
// Se pinta aparte solo lo que brilla (el gas, los arcos, el anillo y
// la bola negra, que tapa lo que queda detrás), se difumina dos veces a
// menos resolución y se suma a la imagen.
// =====================================================================

class PaseBrillo extends Pass {
    constructor() {
        super();
        const op = { type: THREE.HalfFloatType };
        this.a = new THREE.WebGLRenderTarget(1, 1, op);
        this.b = new THREE.WebGLRenderTarget(1, 1, op);
        this.c = new THREE.WebGLRenderTarget(1, 1, op);
        this.d = new THREE.WebGLRenderTarget(1, 1, op);
        this.difuminar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uDir: { value: new THREE.Vector2() } },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
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
        this.mezclar = new THREE.ShaderMaterial({
            uniforms: { tBase: { value: null }, tCerca: { value: null }, tLejos: { value: null }, uFuerza: { value: 1 }, uCentro: { value: new THREE.Vector2(0.5, 0.5) }, uRadio: { value: new THREE.Vector2(0.1, 0.1) } },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tBase;
                uniform sampler2D tCerca;
                uniform sampler2D tLejos;
                uniform float uFuerza;
                uniform vec2 uCentro;
                uniform vec2 uRadio;
                varying vec2 vUv;
                void main() {
                    vec4 base = texture2D(tBase, vUv);
                    vec3 brillo = texture2D(tCerca, vUv).rgb * 0.35 + texture2D(tLejos, vUv).rgb;
                    float bola = 1.0 - smoothstep(0.78, 1.0, length((vUv - uCentro) / uRadio));
                    brillo *= 1.0 - bola * 0.8;
                    gl_FragColor = vec4(base.rgb + brillo * uFuerza, base.a);
                }
            `
        });
        this.recortar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uUmbral: { value: 0.7 } },
            vertexShader: this.difuminar.vertexShader,
            fragmentShader: `
                uniform sampler2D tEntrada;
                uniform float uUmbral;
                varying vec2 vUv;
                void main() {
                    vec3 c = texture2D(tEntrada, vUv).rgb;
                    float l = max(c.r, max(c.g, c.b));
                    gl_FragColor = vec4(c * max(l - uUmbral, 0.0) / max(l, 0.0001), 1.0);
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
        this.a.setSize(m, n);
        this.b.setSize(m, n);
        this.c.setSize(Math.max(1, Math.round(m / 3)), Math.max(1, Math.round(n / 3)));
        this.d.setSize(Math.max(1, Math.round(m / 3)), Math.max(1, Math.round(n / 3)));
    }

    pasada(renderizador, material, destino) {
        this.cuadro.material = material;
        renderizador.setRenderTarget(destino);
        this.cuadro.render(renderizador);
    }

    difumina(renderizador, origen, auxiliar, escala) {
        const u = this.difuminar.uniforms;
        u.tEntrada.value = origen.texture;
        u.uDir.value.set(escala / origen.width, 0);
        this.pasada(renderizador, this.difuminar, auxiliar);
        u.tEntrada.value = auxiliar.texture;
        u.uDir.value.set(0, escala / origen.height);
        this.pasada(renderizador, this.difuminar, origen);
    }

    render(renderizador, destino, origen) {
        const mascara = camara.layers.mask;
            renderizador.getClearColor(this.antes);
        const alfaAntes = renderizador.getClearAlpha();
        camara.layers.set(CAPA_BRILLO);
        renderizador.setClearColor(this.negro, 1);
        renderizador.setRenderTarget(this.a);
        renderizador.clear();
        renderizador.render(escena, camara);
        camara.layers.mask = mascara;
        renderizador.setClearColor(this.antes, alfaAntes);
        this.recortar.uniforms.tEntrada.value = this.a.texture;
        this.pasada(renderizador, this.recortar, this.b);
        this.difumina(renderizador, this.b, this.a, 1.2);
        this.difuminar.uniforms.tEntrada.value = this.b.texture;
        this.difuminar.uniforms.uDir.value.set(0, 0);
        this.pasada(renderizador, this.difuminar, this.c);
        this.difumina(renderizador, this.c, this.d, 1.6);
        this.difumina(renderizador, this.c, this.d, 3.2);
        const u = this.mezclar.uniforms;
        u.tBase.value = origen.texture;
        u.tCerca.value = this.b.texture;
        u.tLejos.value = this.c.texture;
        this.pasada(renderizador, this.mezclar, this.renderToScreen ? null : destino);
    }
}


// =====================================================================
// 7. EFECTOS: RESPLANDOR Y DESENFOQUE DE ESTUDIO
// =====================================================================

const compositor = new EffectComposer(renderizador);
compositor.addPass(new RenderPass(escena, camara));
const brillo = new PaseBrillo();
compositor.addPass(brillo);
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
            float d = smoothstep(0.22, 0.52, abs(vUv.y - 0.5));
            vec4 c = texture2D(tDiffuse, vUv);
            if (d > 0.001) {
                vec4 s = vec4(0.0);
                for (int i = 0; i < 12; i++) {
                    float a = float(i) * 2.399 + fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
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
// 8. MODO CLARO Y OSCURO
// =====================================================================

const botonModo = document.getElementById("boton-modo");
let modo = parametros.get("modo") === "oscuro" ? "oscuro" : "claro";

function aplicarModo() {
    const m = MODOS[modo];
    const u = fondo.material.uniforms;
    u.uArriba.value.setRGB(...m.arriba);
    u.uHorizonte.value.setRGB(...m.horizonte);
    u.uAbajo.value.setRGB(...m.abajo);
    suelo.material.opacity = m.sombra;
    sol.intensity = m.sol;
    relleno.intensity = m.relleno;
    comunes.uLuzGas.value = m.gas;
    comunes.uTinta.value = m.tinta;
    halos.forEach((h) => (h.userData.modo = m.halo));
    estrellas.material.opacity = m.estrellas * 0.85;
    brillo.mezclar.uniforms.uFuerza.value = m.brillo;
    document.body.classList.toggle("oscuro", modo === "oscuro");
    botonModo.textContent = modo === "oscuro" ? "Claro" : "Oscuro";
    botonModo.setAttribute("aria-pressed", modo === "oscuro");
}

botonModo.addEventListener("click", () => {
    modo = modo === "oscuro" ? "claro" : "oscuro";
    aplicarModo();
});


// =====================================================================
// 9. MOVIMIENTO
// =====================================================================

const reloj = new THREE.Clock();
const auxM = new THREE.Matrix4();
const auxQ = new THREE.Quaternion();
const auxV = new THREE.Vector3();
const auxE = new THREE.Vector3();
const pista = document.getElementById("pista");
let listo = false;

const toque = { x: 0, y: 0, t: 0 };

// Tocar sin arrastrar despierta al agujero: el gas se enciende, una onda
// cae hacia dentro y el polvo se precipita
function despertar() {
    comunes.uPulso.value = 1;
    comunes.uOnda.value = 5.2;
    motas.forEach((m) => (m.caida = 0.6 + Math.random() * 1.4));
}

renderizador.domElement.addEventListener("pointerdown", (e) => {
    controles.autoRotate = false;
    pista.classList.add("oculta");
    Object.assign(toque, { x: e.clientX, y: e.clientY, t: performance.now() });
});

renderizador.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 8 && performance.now() - toque.t < 350) despertar();
});

function orientarAgujero() {
    auxV.subVectors(camara.position, CENTRO);
    const azimut = Math.atan2(auxV.x, auxV.z);
    const elevacion = Math.atan2(auxV.y, Math.hypot(auxV.x, auxV.z));
    agujero.rotation.set(-(elevacion - 0.2), azimut, -0.4);
    agujero.updateMatrixWorld();
    auxV.copy(camara.position);
    agujero.worldToLocal(auxV);
    comunes.uVista.value.copy(auxV).normalize();
}

function moverPolvo(delta) {
    motas.forEach((m, i) => {
        m.ang += delta * 1.5 * Math.pow(m.r / 1.35, -1.5) * (1 + comunes.uPulso.value * 1.5);
        if (m.caida) {
            m.r -= delta * m.caida * comunes.uPulso.value * 2.2;
            m.caida *= Math.exp(-delta * 0.6);
            if (m.caida < 0.02) m.caida = 0;
        }
        if (m.r < 1.15) {
            m.r = 3.8 + Math.random() * 0.9;
            m.caida = 0;
        }
        auxV.set(Math.cos(m.ang) * m.r, m.y, Math.sin(m.ang) * m.r);
        auxM.compose(auxV, auxQ, auxE.setScalar(m.tam));
        polvo.setMatrixAt(i, auxM);
    });
    polvo.instanceMatrix.needsUpdate = true;
}

function marcarBola() {
    auxV.copy(CENTRO).project(camara);
    const u = brillo.mezclar.uniforms;
    u.uCentro.value.set(auxV.x * 0.5 + 0.5, auxV.y * 0.5 + 0.5);
    const ry = (Math.tan(Math.asin(1 / camara.position.distanceTo(CENTRO))) / Math.tan(THREE.MathUtils.degToRad(camara.fov / 2))) * 0.5;
    u.uRadio.value.set(ry / camara.aspect, ry);
}

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 44 : 30;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
    enfoque.uniforms.uTexel.value.set(1 / innerWidth, 1 / innerHeight);
}

window.addEventListener("resize", ajustarTamano);

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (comunes.uTiempo.value += delta);
    controles.update();
    orientarAgujero();
    const pulso = (comunes.uPulso.value *= Math.exp(-delta * 1.1));
    comunes.uOnda.value = Math.max(0.6, comunes.uOnda.value - delta * 2.6);
    anillo.material.color.setRGB(1, 0.86, 0.66).multiplyScalar((2 + Math.sin(t * 2.2) * 0.35 + pulso * 2.5) * comunes.uLuzGas.value);
    reflejo.material.uniforms.uFuerza.value = MODOS[modo].reflejo * 0.5 * (0.9 + 0.1 * Math.sin(t * 1.3));
    halos.forEach((h, i) => (h.material.opacity = h.userData.fuerza * h.userData.modo * (0.85 + 0.15 * Math.sin(t * (1.1 + i * 0.7)) + pulso * 0.8)));
    brillo.mezclar.uniforms.uFuerza.value = MODOS[modo].brillo * (1 + pulso * 0.6);
    marcarBola();
    moverPolvo(delta);
    compositor.render();
}

requestAnimationFrame(() => {
    ajustarTamano();
    aplicarModo();
    if (camara.aspect < 1) camara.position.set(1.6, 6.3, 16.5);
    controles.update();
    orientarAgujero();
    moverPolvo(0);
    renderizador.shadowMap.needsUpdate = true;
    renderizador.compile(escena, camara);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
    if (parametros.has("pulso")) despertar();
    reloj.getDelta();
    animar();
});
