import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// =====================================================================
// 1. AJUSTES
// Gargantua en miniatura: un agujero negro metido en un bloque de
// resina oscura y transparente, sobre una peana de piedra con capas,
// en un estudio de fondo claro. Luz de estudio con reflejos, sombras
// suaves, resplandor en el gas caliente y un poco de desenfoque de
// maqueta arriba y abajo.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.75,
    sombra: movil ? 1024 : 2048,
    estrellas: movil ? 160 : 260,
    polvo: movil ? 70 : 120,
    desenfoque: !movil
};
const CENTRO = new THREE.Vector3(0, 4.9, 0);


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
const generadorEntorno = new THREE.PMREMGenerator(renderizador);
escena.environment = generadorEntorno.fromScene(new RoomEnvironment(renderizador), 0.04).texture;

const camara = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.5, 400);
camara.position.set(4, 13.5, 26);
const controles = new OrbitControls(camara, renderizador.domElement);
controles.target.set(0, 4.3, 0);
controles.enableDamping = true;
controles.dampingFactor = 0.05;
controles.enablePan = false;
controles.minDistance = 16;
controles.maxDistance = 46;
controles.minPolarAngle = Math.PI * 0.26;
controles.maxPolarAngle = Math.PI * 0.47;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.35;

const sol = new THREE.DirectionalLight(0xfff4ea, 1.5);
sol.position.set(-10, 18, 9);
sol.castShadow = true;
sol.shadow.mapSize.set(ajustes.sombra, ajustes.sombra);
sol.shadow.radius = 14;
sol.shadow.blurSamples = 20;
sol.shadow.bias = -0.0004;
Object.assign(sol.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
escena.add(sol);
const relleno = new THREE.HemisphereLight(0xf2f4ff, 0xd8d2cc, 0.45);
escena.add(relleno);

const comunes = { uTiempo: { value: 0 }, uVista: { value: new THREE.Vector3(0, 0, 1) } };


// =====================================================================
// 3. EL ESTUDIO: FONDO, SUELO Y PEANA
// El fondo es un degradado claro; el suelo solo recibe sombras, así se
// funde con el fondo. La peana es de piedra con capas, como un corte.
// =====================================================================

const fondo = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 16),
    new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vDir;
            void main() {
                float h = vDir.y;
                vec3 c = mix(vec3(0.80, 0.80, 0.82), vec3(0.91, 0.91, 0.925), smoothstep(-0.2, 0.25, h));
                c = mix(c, vec3(0.86, 0.86, 0.88), smoothstep(0.3, 0.9, h));
                gl_FragColor = vec4(c, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    })
);
escena.add(fondo);

const suelo = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
suelo.receiveShadow = true;
escena.add(suelo);

function sombraContacto() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 256;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    d.addColorStop(0, "rgba(20, 18, 24, 0.55)");
    d.addColorStop(0.55, "rgba(20, 18, 24, 0.18)");
    d.addColorStop(1, "rgba(20, 18, 24, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(lienzo);
    const malla = new THREE.Mesh(new THREE.PlaneGeometry(19, 19).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    malla.position.y = 0.01;
    escena.add(malla);
}
sombraContacto();

const peana = new THREE.Mesh(
    new RoundedBoxGeometry(12, 1.4, 12, 6, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, envMapIntensity: 0.35 })
);
peana.position.y = 0.7;
peana.castShadow = true;
peana.receiveShadow = true;
peana.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vMundoP;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvMundoP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vMundoP;\nfloat hashP(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }")
        .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
            float y = vMundoP.y + sin(vMundoP.x * 0.9 + vMundoP.z * 0.4) * 0.03;
            vec3 c = vec3(0.07, 0.065, 0.08);
            c = mix(c, vec3(0.13, 0.12, 0.14), smoothstep(0.25, 0.3, y));
            c = mix(c, vec3(0.09, 0.085, 0.1), smoothstep(0.62, 0.68, y));
            c = mix(c, vec3(0.16, 0.15, 0.165), smoothstep(0.95, 1.0, y));
            c = mix(c, vec3(0.55, 0.34, 0.2), smoothstep(1.17, 1.19, y) * (1.0 - smoothstep(1.25, 1.27, y)));
            c *= 0.92 + 0.16 * hashP(floor(vMundoP.xz * 18.0) + floor(y * 30.0));
            diffuseColor.rgb = c;`
        );
};
escena.add(peana);


// =====================================================================
// 4. EL GAS DEL DISCO
// Una textura de ruido ya hecha, leída en coordenadas polares. Gira más
// rápido por dentro, tiene anillos que se desplazan, grumos calientes y
// un lado más brillante (el gas que viene hacia ti).
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

const gasGlsl = `
    uniform sampler2D tRuido;
    uniform float uTiempo;
    uniform vec3 uVista;
    const float DENTRO = 1.35;
    const float FUERA = 4.6;
    vec4 gas(float r, float phi) {
        float x = (r - DENTRO) / (FUERA - DENTRO);
        float omega = 1.5 * pow(r / DENTRO, -1.5);
        float ang = (phi - uTiempo * omega) / 6.2832;
        float n = texture2D(tRuido, vec2(ang, r * 0.16)).r;
        float fino = texture2D(tRuido, vec2(ang * 3.0, r * 0.6 + 0.37)).r;
        float polvo = smoothstep(0.55, 0.8, texture2D(tRuido, vec2(ang + 0.5, r * 0.09 + 0.61)).r) * smoothstep(0.15, 0.6, x);
        float perfil = smoothstep(-0.02, 0.06, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.2);
        float anillos = 0.62 + 0.38 * sin(r * 14.0 - uTiempo * 1.1 + n * 4.0) * sin(r * 4.6 + uTiempo * 0.4);
        float densidad = mix(smoothstep(0.25, 0.75, n) * (0.5 + 0.8 * fino) * anillos, 0.95, smoothstep(0.16, 0.0, x));
        float manchas = 0.0;
        for (int i = 0; i < 5; i++) {
            float ri = 1.6 + float(i) * 0.55;
            float ai = uTiempo * 1.5 * pow(ri / DENTRO, -1.5) + float(i) * 2.3;
            float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
            manchas += exp(-pow(da / (0.4 + float(i) * 0.15), 2.0) - pow((r - ri) / 0.11, 2.0)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + float(i)));
        }
        float temperatura = pow(DENTRO / r, 1.5);
        vec3 col = mix(vec3(0.42, 0.17, 0.07), vec3(1.0, 0.5, 0.2), smoothstep(0.12, 0.45, temperatura));
        col = mix(col, vec3(1.0, 0.92, 0.82), smoothstep(0.45, 0.95, temperatura));
        vec3 vel = vec3(-sin(phi), 0.0, cos(phi));
        float v = 0.45 * pow(DENTRO / r, 0.5);
        float doppler = 1.0 / (inversesqrt(1.0 - v * v) * (1.0 - v * dot(vel, uVista)));
        float haz = mix(1.0, pow(doppler, 3.0), 0.5);
        float brillo = temperatura * 2.2 * haz * (1.0 + 0.12 * sin(uTiempo * 1.3 + r * 2.5));
        col *= brillo * (1.0 - polvo * 0.8) * (1.0 + manchas * 1.6);
        float alfa = clamp((densidad + manchas * 0.4) * perfil * 1.7, 0.0, 1.0);
        return vec4(col, alfa);
    }
`;

function materialGas(modo) {
    const material = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.4, metalness: 0, emissive: 0xffffff, envMapIntensity: 0.25, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.tRuido = tRuido;
        shader.uniforms.uTiempo = comunes.uTiempo;
        shader.uniforms.uVista = comunes.uVista;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLocalG;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalG = position;");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLocalG;\n" + gasGlsl)
            .replace(
                "#include <emissivemap_fragment>",
                `#include <emissivemap_fragment>
                ${modo === "disco" ? `
                float rG = length(vLocalG.xz);
                vec4 g = gas(rG, atan(vLocalG.z, vLocalG.x));` : `
                float rho = length(vLocalG.xy);
                float rG = DENTRO + max(0.0, rho - ${modo === "arriba" ? "1.16" : "1.12"}) * ${modo === "arriba" ? "1.9" : "3.4"};
                vec4 g = gas(rG, atan(vLocalG.y, vLocalG.x) * 0.9 + 1.4);
                g.a = clamp(g.a * ${modo === "arriba" ? "2.2" : "1.4"}, 0.0, 1.0) * smoothstep(0.0, 0.25, abs(vLocalG.y) / rho);`}
                totalEmissiveRadiance = pow(g.rgb, vec3(1.1)) * clamp(g.a * 1.5, 0.0, 1.0) * ${modo === "disco" ? "2.8" : "3.3"};`
            );
    };
    material.customProgramCacheKey = () => "gas" + modo;
    return material;
}


// =====================================================================
// 5. EL AGUJERO NEGRO
// Bola negra brillante, disco con volumen (más grueso por dentro), los
// dos arcos de luz doblada (el de arriba ancho, el de abajo fino) y el
// anillo de fotones. Todo el grupo se gira hacia la cámara para que
// siempre se vea como Gargantua: el disco casi de canto y en diagonal.
// =====================================================================

const agujero = new THREE.Group();
agujero.position.copy(CENTRO);
agujero.scale.setScalar(1.15);
agujero.rotation.order = "YXZ";
escena.add(agujero);

const sombra = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.MeshPhysicalMaterial({ color: 0x010102, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.3 })
);
sombra.material.transparent = true;
sombra.renderOrder = 2;
agujero.add(sombra);

function discoConVolumen() {
    const perfil = [];
    const dentro = 1.3;
    const fuera = 4.65;
    const grosor = (r) => 0.07 * Math.pow(1 - (r - dentro) / (fuera - dentro), 0.8) + 0.008;
    const n = 60;
    for (let i = 0; i <= n; i++) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, -grosor(r)));
    }
    for (let i = n; i >= 0; i--) {
        const r = dentro + ((fuera - dentro) * i) / n;
        perfil.push(new THREE.Vector2(r, grosor(r)));
    }
    perfil.push(perfil[0].clone());
    return new THREE.LatheGeometry(perfil, 220);
}

const disco = new THREE.Mesh(discoConVolumen(), materialGas("disco"));
disco.renderOrder = 3;
agujero.add(disco);

function arco(dentro, fuera, desde, largo, grosor) {
    const forma = new THREE.Shape();
    forma.absarc(0, 0, fuera, desde, desde + largo, false);
    forma.absarc(0, 0, dentro, desde + largo, desde, true);
    const geo = new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: true, bevelThickness: grosor * 0.6, bevelSize: grosor * 0.6, bevelSegments: 3, curveSegments: 120 });
    geo.translate(0, 0, -grosor / 2);
    return geo;
}

const arcos = new THREE.Group();
const arcoArriba = new THREE.Mesh(arco(1.16, 2.45, 0.02, Math.PI - 0.04, 0.05), materialGas("arriba"));
const arcoAbajo = new THREE.Mesh(arco(1.12, 1.55, Math.PI + 0.06, Math.PI - 0.12, 0.04), materialGas("abajo"));
const anillo = new THREE.Mesh(
    new THREE.TorusGeometry(1.08, 0.016, 12, 200),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.66).multiplyScalar(5) })
);
arcoArriba.renderOrder = 3;
arcoAbajo.renderOrder = 3;
anillo.renderOrder = 4;
arcos.add(arcoArriba, arcoAbajo, anillo);
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
[[9.5, 0.22, [1, 0.55, 0.25]], [3.6, 0.35, [1, 0.75, 0.5]]].forEach(([tam, fuerza, c]) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaHalo(), color: new THREE.Color(...c), transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, opacity: fuerza }));
    halo.scale.setScalar(tam);
    halo.renderOrder = 5;
    halo.userData.fuerza = fuerza;
    agujero.add(halo);
    halos.push(halo);
});

const polvo = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), ajustes.polvo);
polvo.renderOrder = 4;
const motas = [];
for (let i = 0; i < ajustes.polvo; i++) {
    const r = 1.45 + Math.pow(Math.random(), 1.4) * 3.0;
    motas.push({ r, ang: Math.random() * 6.28, y: (Math.random() - 0.5) * 0.12, tam: 0.6 + Math.random() * 1.2 });
    const calor = Math.pow(1.35 / r, 1.2);
    polvo.setColorAt(i, new THREE.Color(1, 0.55 + calor * 0.4, 0.25 + calor * 0.6).multiplyScalar(2 + calor * 4));
}
agujero.add(polvo);


// =====================================================================
// 6. EL BLOQUE DE RESINA Y LAS ESTRELLAS DE DENTRO
// La resina deja pasar la luz y la tiñe de azul muy oscuro, así se ve
// el agujero dentro como en un pisapapeles. Las estrellas son motas
// brillantes atrapadas en la resina.
// =====================================================================

const resina = new THREE.Mesh(
    new RoundedBoxGeometry(11, 7, 11, 8, 0.4),
    new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vMundo;
            varying vec3 vNormal;
            void main() {
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                vNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            varying vec3 vMundo;
            varying vec3 vNormal;
            void main() {
                vec3 n = normalize(vNormal);
                vec3 V = normalize(cameraPosition - vMundo);
                float f = pow(1.0 - max(dot(n, V), 0.0), 4.0);
                vec3 R = reflect(-V, n);
                float caja = smoothstep(0.9, 0.97, dot(R, normalize(vec3(-0.55, 0.72, 0.42))));
                float barra = smoothstep(0.986, 0.996, dot(R, normalize(vec3(0.75, 0.5, 0.25))));
                float arriba = smoothstep(0.6, 1.0, n.y) * 0.05;
                float a = clamp(0.025 + f * 0.5 + caja * 0.5 + barra * 0.45 + arriba, 0.0, 0.9);
                gl_FragColor = vec4(vec3(0.94, 0.96, 1.0), a);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false
    })
);
resina.position.set(0, 1.4 + 3.5, 0);
resina.renderOrder = 8;

const interior = new THREE.Mesh(
    new RoundedBoxGeometry(10.9, 6.9, 10.9, 8, 0.36),
    new THREE.ShaderMaterial({
        uniforms: { uCentro: { value: CENTRO }, tRuido },
        vertexShader: `
            varying vec3 vMundo;
            varying vec3 vNormal;
            void main() {
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                vNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform vec3 uCentro;
            uniform sampler2D tRuido;
            varying vec3 vMundo;
            varying vec3 vNormal;
            void main() {
                vec3 V = normalize(cameraPosition - vMundo);
                float borde = pow(1.0 - abs(dot(normalize(vNormal), V)), 3.0);
                vec3 c = mix(vec3(0.012, 0.016, 0.04), vec3(0.03, 0.045, 0.1), borde);
                c += vec3(0.08, 0.04, 0.02) * exp(-length(vMundo - uCentro) * 0.35);
                float nube = texture2D(tRuido, vMundo.xy * 0.07 + vMundo.z * 0.05).r * texture2D(tRuido, vMundo.zy * 0.11 + 0.3).r;
                c += vec3(0.05, 0.03, 0.08) * smoothstep(0.25, 0.6, nube);
                gl_FragColor = vec4(c, 0.97);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false
    })
);
interior.position.copy(resina.position);
interior.renderOrder = 1;
escena.add(interior);
escena.add(resina);

const estrellas = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), ajustes.estrellas);
estrellas.renderOrder = 2;
const datosEstrellas = [];
{
    const m = new THREE.Matrix4();
    const tonos = [new THREE.Color(1, 0.95, 0.88), new THREE.Color(0.75, 0.85, 1), new THREE.Color(1, 0.8, 0.6)];
    for (let i = 0; i < ajustes.estrellas; i++) {
        let p;
        do {
            p = new THREE.Vector3((Math.random() - 0.5) * 10.2, 1.8 + Math.random() * 6.2, (Math.random() - 0.5) * 10.2);
        } while (p.distanceTo(CENTRO) < 5);
        const tam = 0.012 + Math.pow(Math.random(), 4) * 0.05;
        datosEstrellas.push({ p, tam, fase: Math.random() * 6.28 });
        m.compose(p, new THREE.Quaternion(), new THREE.Vector3().setScalar(tam));
        estrellas.setMatrixAt(i, m);
        estrellas.setColorAt(i, tonos[i % 3].clone().multiplyScalar(2.5 + Math.random() * 4));
    }
}
escena.add(estrellas);


// =====================================================================
// 6b. DETALLES DE MAQUETA
// Una malla del espacio-tiempo hundida como un embudo bajo el agujero,
// una placa de latón en la peana y el reflejo cálido en el suelo.
// =====================================================================

function crearMalla() {
    const puntos = [];
    const lado = 5.1;
    const paso = 0.34;
    const base = CENTRO.y - 2.6;
    const hundir = (x, z) => base - 1.5 / (1 + (x * x + z * z) * 0.55);
    for (let a = -lado; a <= lado + 0.001; a += paso) {
        for (let b = -lado; b < lado - 0.001; b += paso / 3) {
            const b2 = b + paso / 3;
            puntos.push(a, hundir(a, b), b, a, hundir(a, b2), b2);
            puntos.push(b, hundir(b, a), a, b2, hundir(b2, a), a);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(puntos, 3));
    const malla = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo },
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
            varying vec3 vMundo;
            void main() {
                float r = length(vMundo.xz);
                float borde = smoothstep(5.2, 3.5, max(abs(vMundo.x), abs(vMundo.z)));
                float onda = 0.75 + 0.25 * sin(r * 3.0 + uTiempo * 1.6);
                vec3 c = mix(vec3(0.35, 0.5, 1.0), vec3(1.0, 0.6, 0.3), smoothstep(2.5, 0.6, r));
                gl_FragColor = vec4(c * 0.36 * onda * borde, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    }));
    malla.renderOrder = 2;
    escena.add(malla);
}
crearMalla();

function crearPlaca() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 1024;
    lienzo.height = 200;
    const g = lienzo.getContext("2d");
    const d = g.createLinearGradient(0, 0, 0, 200);
    d.addColorStop(0, "#c9a46a");
    d.addColorStop(0.5, "#a9824c");
    d.addColorStop(1, "#8c6a3a");
    g.fillStyle = d;
    g.fillRect(0, 0, 1024, 200);
    g.strokeStyle = "rgba(60, 40, 20, 0.6)";
    g.lineWidth = 6;
    g.strokeRect(14, 14, 996, 172);
    g.fillStyle = "rgba(48, 32, 16, 0.85)";
    g.textAlign = "center";
    g.font = "italic 78px Fraunces, Georgia, serif";
    g.fillText("Gargantua", 512, 104);
    g.font = "500 30px Inter, Arial, sans-serif";
    g.fillText("AGUJERO NEGRO SUPERMASIVO  ·  ESCALA 1 : 10¹³", 512, 158);
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const placa = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.66, 0.06, 3, 0.03), [
        new THREE.MeshStandardMaterial({ color: 0x9a7848, metalness: 0.8, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0x9a7848, metalness: 0.8, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0x9a7848, metalness: 0.8, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0x9a7848, metalness: 0.8, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ map: t, metalness: 0.65, roughness: 0.38 }),
        new THREE.MeshStandardMaterial({ color: 0x9a7848, metalness: 0.8, roughness: 0.35 })
    ]);
    placa.position.set(0, 0.68, 6.03);
    placa.castShadow = true;
    escena.add(placa);
}

function crearReflejo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 128;
    const g = lienzo.getContext("2d");
    const d = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    d.addColorStop(0, "rgba(255, 170, 100, 0.5)");
    d.addColorStop(1, "rgba(255, 170, 100, 0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 128, 128);
    const reflejo = new THREE.Mesh(new THREE.PlaneGeometry(14, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lienzo), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
    reflejo.position.set(0, 0.02, 8.6);
    escena.add(reflejo);
}
crearReflejo();


// =====================================================================
// 7. EFECTOS: DESENFOQUE DE MAQUETA
// =====================================================================

const compositor = new EffectComposer(renderizador);
compositor.addPass(new RenderPass(escena, camara));
const maqueta = new ShaderPass({
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
            float d = smoothstep(0.18, 0.5, abs(vUv.y - 0.47));
            vec4 c = texture2D(tDiffuse, vUv);
            if (d > 0.001) {
                vec4 s = vec4(0.0);
                for (int i = 0; i < 12; i++) {
                    float a = float(i) * 2.399;
                    float r = sqrt(float(i) + 0.5) / 3.5;
                    s += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * uTexel * 5.0 * d);
                }
                c = mix(c, s / 12.0, d);
            }
            gl_FragColor = c;
        }
    `
});
if (ajustes.desenfoque) compositor.addPass(maqueta);
compositor.addPass(new OutputPass());


// =====================================================================
// 8. MOVIMIENTO
// =====================================================================

const reloj = new THREE.Clock();
const auxM = new THREE.Matrix4();
const auxQ = new THREE.Quaternion();
const auxV = new THREE.Vector3();
const auxE = new THREE.Vector3();
const pista = document.getElementById("pista");
let listo = false;

renderizador.domElement.addEventListener("pointerdown", () => {
    controles.autoRotate = false;
    pista.classList.add("oculta");
});

function orientarAgujero() {
    auxV.subVectors(camara.position, CENTRO);
    const azimut = Math.atan2(auxV.x, auxV.z);
    const elevacion = Math.atan2(auxV.y, Math.hypot(auxV.x, auxV.z));
    agujero.rotation.set(-(elevacion - 0.21), azimut, -0.42);
    agujero.updateMatrixWorld();
    auxV.copy(camara.position);
    agujero.worldToLocal(auxV);
    comunes.uVista.value.copy(auxV).normalize();
}

function moverPolvo(delta) {
    motas.forEach((m, i) => {
        m.ang += delta * 1.5 * Math.pow(m.r / 1.35, -1.5);
        auxV.set(Math.cos(m.ang) * m.r, m.y, Math.sin(m.ang) * m.r);
        auxM.compose(auxV, auxQ, auxE.setScalar(m.tam));
        polvo.setMatrixAt(i, auxM);
    });
    polvo.instanceMatrix.needsUpdate = true;
}

function moverEstrellas(t) {
    datosEstrellas.forEach((e, i) => {
        auxM.compose(e.p, auxQ, auxE.setScalar(e.tam * (0.75 + 0.35 * Math.sin(t * 1.7 + e.fase))));
        estrellas.setMatrixAt(i, auxM);
    });
    estrellas.instanceMatrix.needsUpdate = true;
}

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 46 : 32;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    compositor.setSize(innerWidth, innerHeight);
    maqueta.uniforms.uTexel.value.set(1 / innerWidth, 1 / innerHeight);
}

window.addEventListener("resize", ajustarTamano);

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (comunes.uTiempo.value += delta);
    controles.update();
    orientarAgujero();
    anillo.material.color.setRGB(1, 0.86, 0.66).multiplyScalar(4.5 + Math.sin(t * 2.2) * 0.8);
    sombra.scale.setScalar(1 + Math.sin(t * 0.8) * 0.004);
    halos.forEach((h, i) => (h.material.opacity = h.userData.fuerza * (0.85 + 0.15 * Math.sin(t * (1.1 + i * 0.7)))));
    moverPolvo(delta);
    moverEstrellas(t);
    compositor.render();
}

const fuentesPlaca = ["italic 78px Fraunces", "500 30px Inter"];

Promise.race([Promise.all(fuentesPlaca.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2000))]).finally(() => requestAnimationFrame(() => {
    crearPlaca();
    ajustarTamano();
    if (camara.aspect < 1) camara.position.set(2, 16, 38);
    renderizador.shadowMap.needsUpdate = true;
    controles.update();
    orientarAgujero();
    moverPolvo(0);
    moverEstrellas(0);
    renderizador.compile(escena, camara);
    listo = true;
    document.getElementById("cargando").classList.add("oculta");
    setTimeout(() => pista.classList.add("oculta"), 6000);
    reloj.getDelta();
    animar();
}));
