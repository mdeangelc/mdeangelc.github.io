import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Un agujero negro de fondo calculado rayo a rayo: la gravedad curva la
// luz, por eso el disco se ve por encima y por debajo de la sombra.
// Cada sección es un planeta en órbita; al deslizar, el planeta cae en
// espiral, se estira y desaparece en el disco con un destello.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 1.5 : 1.25,
    escala: movil ? 0.5 : 0.62,
    escalaMinima: 0.3,
    pasos: movil ? 140 : 210,
    estela: movil ? 160 : 260
};


// =====================================================================
// 2. RENDERIZADOR Y CÁMARA
// La cámara es una cámara normal de three.js: el shader del agujero lee
// su posición y su orientación, así los planetas y el fondo encajan.
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: !movil, powerPreference: "high-performance", alpha: false });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.autoClear = false;
document.body.prepend(renderizador.domElement);

const camara = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);
const escenaPlanetas = new THREE.Scene();
const camaraPlana = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const plano = new THREE.PlaneGeometry(2, 2);

const VISTAS = [
    { azimut: 0.35, altura: 0.1, distancia: 16.5, giro: -0.58 },
    { azimut: 0.95, altura: 0.16, distancia: 15.5, giro: -0.44 },
    { azimut: 1.7, altura: 0.07, distancia: 15, giro: -0.64 },
    { azimut: 2.45, altura: 0.2, distancia: 16, giro: -0.38 },
    { azimut: 3.2, altura: 0.12, distancia: 14.5, giro: -0.52 }
];
const vista = { ...VISTAS[0] };
const auxVector = new THREE.Vector3();
const auxVector2 = new THREE.Vector3();
const derecha = new THREE.Vector3();
const arriba = new THREE.Vector3();
const delante = new THREE.Vector3();

function colocarCamara(delta, t) {
    const destino = VISTAS[actual];
    const k = delta < 0 ? 1 : 1 - Math.exp(-delta * 0.7);
    ["azimut", "altura", "distancia", "giro"].forEach((c) => (vista[c] += (destino[c] - vista[c]) * k));
    const az = vista.azimut + t * 0.012;
    const al = vista.altura + Math.sin(t * 0.13) * 0.02;
    const d = vista.distancia * (camara.aspect < 1 ? 1.12 : 1);
    camara.position.set(d * Math.cos(al) * Math.sin(az), d * Math.sin(al), d * Math.cos(al) * Math.cos(az));
    delante.copy(camara.position).multiplyScalar(-1).normalize();
    derecha.crossVectors(delante, auxVector.set(0, 1, 0)).normalize();
    arriba.crossVectors(derecha, delante);
    const g = vista.giro + Math.sin(t * 0.07) * 0.03;
    camara.up.copy(arriba).multiplyScalar(Math.cos(g)).addScaledVector(derecha, -Math.sin(g));
    const movido = camara.aspect < 1 ? auxVector.copy(arriba).multiplyScalar(-1.6) : auxVector.copy(derecha).multiplyScalar(-2.6).addScaledVector(arriba, -0.3);
    camara.lookAt(movido);
    camara.updateMatrixWorld();
    const e = camara.matrixWorld.elements;
    derecha.set(e[0], e[1], e[2]);
    arriba.set(e[4], e[5], e[6]);
    delante.set(-e[8], -e[9], -e[10]);
    materialAgujero.uniforms.uCamPos.value.copy(camara.position);
    materialAgujero.uniforms.uCamMat.value.set(derecha.x, arriba.x, delante.x, derecha.y, arriba.y, delante.y, derecha.z, arriba.z, delante.z);
    materialAgujero.uniforms.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(camara.fov) / 2);
    materialAgujero.uniforms.uAspecto.value = camara.aspect;
}


// =====================================================================
// 3. EL AGUJERO NEGRO
// Por cada píxel se lanza un rayo desde la cámara. En cada paso la
// gravedad lo dobla (aproximación de Schwarzschild, radio = 1). Si el
// rayo cae dentro del horizonte el píxel es negro; si cruza el plano
// del disco toma su color; si escapa, mira las estrellas del fondo.
// =====================================================================

const MAX_PASOS = 260;

const materialAgujero = new THREE.ShaderMaterial({
    uniforms: {
        uTiempo: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uCamMat: { value: new THREE.Matrix3() },
        uTanFov: { value: 0.47 },
        uAspecto: { value: 1 },
        uPasos: { value: ajustes.pasos },
        uDestello: { value: 0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        precision highp float;
        uniform float uTiempo;
        uniform vec3 uCamPos;
        uniform mat3 uCamMat;
        uniform float uTanFov;
        uniform float uAspecto;
        uniform int uPasos;
        uniform float uDestello;
        varying vec2 vUv;

        const float DENTRO = 2.6;
        const float FUERA = 14.0;

        float hash13(vec3 p) {
            p = fract(p * 0.1031);
            p += dot(p, p.zyx + 31.32);
            return fract((p.x + p.y) * p.z);
        }

        float ruido3(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash13(i);
            float b = hash13(i + vec3(1, 0, 0));
            float c = hash13(i + vec3(0, 1, 0));
            float d = hash13(i + vec3(1, 1, 0));
            float e = hash13(i + vec3(0, 0, 1));
            float g = hash13(i + vec3(1, 0, 1));
            float h = hash13(i + vec3(0, 1, 1));
            float k = hash13(i + vec3(1, 1, 1));
            return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
        }

        float fbm3(vec3 p) {
            float s = 0.0;
            float a = 0.5;
            for (int i = 0; i < 4; i++) {
                s += a * ruido3(p);
                p = p * 2.03 + vec3(1.7, 9.2, 3.1);
                a *= 0.5;
            }
            return s;
        }

        vec3 estrellas(vec3 d) {
            vec3 c = vec3(0.0);
            for (int k = 0; k < 2; k++) {
                float escala = k == 0 ? 150.0 : 380.0;
                vec3 q = d * escala;
                vec3 id = floor(q);
                float h = hash13(id);
                if (h > 0.982) {
                    vec3 centro = vec3(hash13(id + 1.3), hash13(id + 2.7), hash13(id + 5.1)) * 0.6 + 0.2;
                    float dist = length(fract(q) - centro);
                    float brillo = smoothstep(0.22, 0.0, dist) * (h - 0.982) / 0.018;
                    vec3 tono = mix(vec3(1.0, 0.82, 0.65), vec3(0.75, 0.85, 1.0), hash13(id + 9.0));
                    c += brillo * tono * (k == 0 ? 2.2 : 1.0);
                }
            }
            float banda = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, 0.25))) * 3.0, 2.0));
            c += banda * fbm3(d * 5.0) * vec3(0.035, 0.03, 0.04);
            return c;
        }

        vec4 disco(vec3 p, vec3 rayo) {
            float r = length(p.xz);
            if (r < DENTRO * 0.92 || r > FUERA) return vec4(0.0);
            float phi = atan(p.z, p.x);
            float ang = phi - uTiempo * 1.7 * pow(r, -1.5);
            vec3 q = vec3(r * 2.4, cos(ang) * 1.5, sin(ang) * 1.5);
            float n = fbm3(q);
            float fino = fbm3(vec3(r * 8.0, cos(ang) * 3.5, sin(ang) * 3.5));
            float x = (r - DENTRO) / (FUERA - DENTRO);
            float perfil = smoothstep(-0.02, 0.05, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.3);
            float densidad = mix(smoothstep(0.2, 0.7, n) * (0.5 + 0.7 * fino), 0.9, smoothstep(0.18, 0.0, x));
            float polvo = smoothstep(0.52, 0.78, fbm3(vec3(r * 1.2 + 4.0, cos(ang) * 0.8, sin(ang) * 0.8))) * smoothstep(0.15, 0.6, x);
            float temperatura = pow(DENTRO / r, 1.5);
            vec3 frio = vec3(0.42, 0.17, 0.07);
            vec3 tibio = vec3(1.0, 0.5, 0.2);
            vec3 caliente = vec3(1.0, 0.92, 0.82);
            vec3 col = mix(frio, tibio, smoothstep(0.12, 0.45, temperatura));
            col = mix(col, caliente, smoothstep(0.45, 0.95, temperatura));
            vec3 velocidad = vec3(-sin(phi), 0.0, cos(phi));
            float v = clamp(sqrt(0.5 / max(r - 0.6, 0.3)), 0.0, 0.62);
            float coseno = dot(velocidad, -rayo);
            float doppler = 1.0 / (inversesqrt(1.0 - v * v) * (1.0 - v * coseno));
            float haz = mix(1.0, pow(doppler, 3.0), 0.55);
            float brillo = temperatura * 2.6 * haz * sqrt(max(0.0, 1.0 - 1.0 / r)) * (1.0 + uDestello * 2.5 * exp(-x * 3.0));
            col *= brillo * (1.0 - polvo * 0.8);
            col = mix(col, col * vec3(1.15, 0.9, 0.75), smoothstep(1.0, 0.6, doppler) * 0.5);
            float alfa = clamp(densidad * perfil * 1.7, 0.0, 1.0);
            return vec4(col * alfa, alfa);
        }

        void main() {
            vec2 uv = vUv * 2.0 - 1.0;
            uv.x *= uAspecto;
            vec3 dir = normalize(uCamMat * vec3(uv * uTanFov, 1.0));
            vec3 pos = uCamPos;
            vec3 h3 = cross(pos, dir);
            float h2 = dot(h3, h3);
            vec3 col = vec3(0.0);
            float alfa = 0.0;
            bool absorbido = false;
            float anillo = 0.0;
            int cruces = 0;
            for (int i = 0; i < ${MAX_PASOS}; i++) {
                if (i >= uPasos) break;
                float r = length(pos);
                float paso = 0.03 + 0.09 * r * smoothstep(0.9, 3.5, r);
                vec3 acel = -1.5 * h2 * pos / pow(r, 5.0);
                vec3 nuevo = pos + dir * paso;
                dir += acel * paso;
                float rh = length(pos.xz);
                if (rh > DENTRO * 0.9 && rh < FUERA) {
                    float grosor = 0.12 + 0.045 * rh;
                    float niebla = exp(-pos.y * pos.y / (grosor * grosor));
                    if (niebla > 0.01) {
                        float xr = (rh - DENTRO) / (FUERA - DENTRO);
                        float ondas = 0.6 + 0.8 * ruido3(vec3(rh * 1.5, pos.y * 3.0, atan(pos.z, pos.x) * 2.0 - uTiempo * 0.3));
                        float emision = niebla * pow(DENTRO / rh, 1.8) * smoothstep(-0.02, 0.08, xr) * (1.0 - xr) * ondas * paso * 0.32;
                        col += (1.0 - alfa) * emision * mix(vec3(1.0, 0.5, 0.22), vec3(1.0, 0.85, 0.7), smoothstep(0.4, 0.0, xr));
                    }
                }
                anillo += paso * exp(-pow((r - 1.5) / 0.09, 2.0));
                if (pos.y * nuevo.y < 0.0) {
                    float k = pos.y / (pos.y - nuevo.y);
                    vec4 d = disco(mix(pos, nuevo, k), normalize(dir));
                    cruces++;
                    if (cruces > 2) d *= 0.35;
                    col += (1.0 - alfa) * d.rgb;
                    alfa += (1.0 - alfa) * d.a;
                    if (alfa > 0.985) break;
                }
                pos = nuevo;
                if (dot(pos, pos) < 1.0) {
                    absorbido = true;
                    break;
                }
                if (r > 40.0 && dot(pos, dir) > 0.0) break;
            }
            if (!absorbido) col += (1.0 - alfa) * estrellas(normalize(dir));
            col += vec3(1.0, 0.82, 0.62) * smoothstep(0.35, 1.6, anillo) * 1.2 * (1.0 - alfa * 0.6);
            gl_FragColor = vec4(col, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaAgujero = new THREE.Scene();
escenaAgujero.add(new THREE.Mesh(plano, materialAgujero));
let objetivoAgujero = null;

const materialFinal = new THREE.ShaderMaterial({
    uniforms: { tAgujero: { value: null }, uTexel: { value: new THREE.Vector2() }, uTiempo: { value: 0 } },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tAgujero;
        uniform vec2 uTexel;
        uniform float uTiempo;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        void main() {
            vec3 c = texture2D(tAgujero, vUv).rgb;
            vec3 halo = vec3(0.0);
            for (int i = 0; i < 8; i++) {
                float a = float(i) * 0.785 + 0.39;
                vec2 d = vec2(cos(a), sin(a));
                halo += max(texture2D(tAgujero, vUv + d * uTexel * 5.0).rgb - 0.5, 0.0);
                halo += max(texture2D(tAgujero, vUv + d * uTexel * 13.0).rgb - 0.5, 0.0) * 0.6;
            }
            c += halo * 0.07;
            c = aces(c * 0.95);
            float vineta = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.4);
            c *= mix(0.65, 1.0, vineta);
            float grano = fract(sin(dot(vUv * 1000.0 + uTiempo, vec2(12.9898, 78.233))) * 43758.5453);
            c += (grano - 0.5) * 0.012;
            gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaFinal = new THREE.Scene();
escenaFinal.add(new THREE.Mesh(plano, materialFinal));


// =====================================================================
// 4. LOS PLANETAS
// Uno por sección. La superficie se pinta con ruido en el shader y la
// luz viene del disco (del centro). Al caer se estiran hacia el
// agujero, se enrojecen y se apagan.
// =====================================================================

const PLANETAS = [
    { tipo: 0, a: "#1d4e7a", b: "#5f8a44", c: "#cdbb8c", atmosfera: "#6fb3ff", semilla: 1 },
    { tipo: 0, a: "#6a2c1a", b: "#b45e34", c: "#e6ad78", atmosfera: "#ff9a6a", semilla: 7 },
    { tipo: 2, a: "#7fc4dc", b: "#eaf7ff", c: "#5a9ab8", atmosfera: "#8fdcff", semilla: 3 },
    { tipo: 1, a: "#c9a478", b: "#7e4f30", c: "#f0e0c0", atmosfera: "#ffd9a0", semilla: 5, anillo: true },
    { tipo: 2, a: "#4e3f86", b: "#b9a2e6", c: "#2e2550", atmosfera: "#c8a8ff", semilla: 9 }
];

const vertexPlaneta = `
    varying vec3 vNormal;
    varying vec3 vLocal;
    varying vec3 vMundo;
    void main() {
        vLocal = position;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 m = modelMatrix * vec4(position, 1.0);
        vMundo = m.xyz;
        gl_Position = projectionMatrix * viewMatrix * m;
    }
`;

const ruidoGlsl = `
    float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
    }
    float ruido3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm3(vec3 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
            s += a * ruido3(p);
            p = p * 2.02 + 3.1;
            a *= 0.5;
        }
        return s;
    }
`;

function materialPlaneta(datos) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uA: { value: new THREE.Color(datos.a) },
            uB: { value: new THREE.Color(datos.b) },
            uC: { value: new THREE.Color(datos.c) },
            uAtmosfera: { value: new THREE.Color(datos.atmosfera) },
            uTipo: { value: datos.tipo },
            uSemilla: { value: datos.semilla },
            uRojo: { value: 0 },
            uAlfa: { value: 1 },
            uTiempo: { value: 0 }
        },
        vertexShader: vertexPlaneta,
        fragmentShader: `
            uniform vec3 uA;
            uniform vec3 uB;
            uniform vec3 uC;
            uniform vec3 uAtmosfera;
            uniform float uTipo;
            uniform float uSemilla;
            uniform float uRojo;
            uniform float uAlfa;
            uniform float uTiempo;
            varying vec3 vNormal;
            varying vec3 vLocal;
            varying vec3 vMundo;
            ${ruidoGlsl}
            void main() {
                vec3 n = normalize(vNormal);
                vec3 L = normalize(-vMundo);
                float dif = max(dot(n, L), 0.0);
                vec3 p = normalize(vLocal);
                float h = fbm3(p * 2.6 + uSemilla);
                vec3 base;
                if (uTipo < 0.5) {
                    float tierra = smoothstep(0.5, 0.53, h);
                    base = mix(uA * (0.7 + h * 0.5), mix(uB, uC, smoothstep(0.56, 0.72, h)), tierra);
                    float nubes = smoothstep(0.55, 0.75, fbm3(p * 4.0 + vec3(uTiempo * 0.02, 0.0, uSemilla)));
                    base = mix(base, vec3(0.95), nubes * 0.7);
                } else if (uTipo < 1.5) {
                    float bandas = sin(p.y * 16.0 + fbm3(p * 3.0 + uSemilla) * 5.0);
                    base = mix(uA, uB, bandas * 0.5 + 0.5);
                    base = mix(base, uC, smoothstep(0.62, 0.85, fbm3(p * 6.0 + uSemilla)));
                } else {
                    base = mix(uA, uB, smoothstep(0.35, 0.7, h));
                    float grietas = smoothstep(0.03, 0.0, abs(fbm3(p * 5.0 + uSemilla + 4.0) - 0.5));
                    base = mix(base, uC, grietas * 0.8);
                }
                vec3 V = normalize(cameraPosition - vMundo);
                float borde = pow(1.0 - max(dot(n, V), 0.0), 3.0);
                vec3 c = base * (dif * vec3(1.0, 0.82, 0.65) * 1.5 + 0.035) + uAtmosfera * borde * (0.12 + dif * 0.9);
                c = mix(c, c * vec3(1.5, 0.35, 0.12) + vec3(0.18, 0.02, 0.0) * dif, uRojo);
                c = c / (1.0 + c);
                gl_FragColor = vec4(pow(c * 1.4, vec3(1.0 / 2.2)), uAlfa);
            }
        `,
        transparent: true
    });
}

function materialAnillo() {
    return new THREE.ShaderMaterial({
        uniforms: { uRojo: { value: 0 }, uAlfa: { value: 1 } },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vMundo;
            void main() {
                vUv = uv;
                vec4 m = modelMatrix * vec4(position, 1.0);
                vMundo = m.xyz;
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform float uRojo;
            uniform float uAlfa;
            varying vec2 vUv;
            varying vec3 vMundo;
            void main() {
                float r = vUv.x;
                float bandas = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.0);
                float borde = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.85, r);
                vec3 c = mix(vec3(0.85, 0.72, 0.55), vec3(0.6, 0.45, 0.32), r) * bandas;
                c = mix(c, c * vec3(1.4, 0.4, 0.15), uRojo);
                gl_FragColor = vec4(pow(c * 0.9, vec3(1.0 / 2.2)), borde * bandas * 0.75 * uAlfa);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
    });
}

function anilloGeometria() {
    const g = new THREE.RingGeometry(1.35, 2.3, 96, 1);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - 1.35) / 0.95, 0);
    }
    return g;
}

const planetas = [];
const esfera = new THREE.SphereGeometry(1, 64, 48);

function crearPlanetas() {
    PLANETAS.forEach((datos, i) => {
        const grupo = new THREE.Group();
        const cuerpo = new THREE.Group();
        const material = materialPlaneta(datos);
        const malla = new THREE.Mesh(esfera, material);
        cuerpo.add(malla);
        let anillo = null;
        if (datos.anillo) {
            anillo = new THREE.Mesh(anilloGeometria(), materialAnillo());
            anillo.rotation.x = -Math.PI / 2 + 0.45;
            anillo.rotation.y = 0.2;
            cuerpo.add(anillo);
        }
        grupo.add(cuerpo);
        grupo.visible = i === 0;
        escenaPlanetas.add(grupo);
        planetas.push({ grupo, cuerpo, malla, material, anillo, estado: i === 0 ? "activo" : "espera", t: 0, desde: new THREE.Vector3(), lejos: new THREE.Vector3(), giro: Math.random() * 6, inclinacion: 0.3 + Math.random() * 0.4 });
    });
}

function hueco(destino) {
    const ancho = camara.aspect < 1;
    const d = 9;
    const lado = ancho ? 1.0 : 3.6;
    const alto = ancho ? -1.4 : 1.7;
    return destino.copy(camara.position).addScaledVector(delante, d).addScaledVector(derecha, lado).addScaledVector(arriba, alto);
}

function puntoLejano(destino, base) {
    return destino.copy(base).addScaledVector(derecha, 26).addScaledVector(delante, 34).addScaledVector(arriba, 7);
}

const tamPlaneta = () => (camara.aspect < 1 ? 0.62 : 0.78);
const suaveFin = (t) => 1 - Math.pow(1 - t, 3);

function moverPlanetas(delta, t) {
    planetas.forEach((p, i) => {
        p.giro += delta * 0.12;
        p.malla.rotation.set(p.inclinacion, p.giro, 0);
        p.material.uniforms.uTiempo.value = t;
        let escalaRadial = 1;
        let rojo = 0;
        let alfa = 1;
        const r0 = tamPlaneta();
        if (p.estado === "activo") {
            hueco(auxVector);
            p.grupo.position.lerp(auxVector, Math.min(1, delta * 3));
            p.grupo.position.y += Math.sin(t * 0.6 + i) * 0.002;
        } else if (p.estado === "llega" || p.estado === "sale") {
            p.t = Math.min(1, p.t + delta / 2.4);
            hueco(auxVector);
            puntoLejano(auxVector2, auxVector);
            const k = suaveFin(p.t);
            if (p.estado === "llega") p.grupo.position.lerpVectors(auxVector2, auxVector, k);
            else p.grupo.position.lerpVectors(p.desde, auxVector2, p.t * p.t);
            alfa = p.estado === "llega" ? Math.min(1, p.t * 3) : 1 - p.t;
            if (p.t >= 1) {
                p.estado = p.estado === "llega" ? "activo" : "espera";
                p.grupo.visible = p.estado === "activo";
            }
        } else if (p.estado === "cae") {
            p.t = Math.min(1, p.t + delta / 3.4);
            const k = p.t;
            const rh0 = Math.hypot(p.desde.x, p.desde.z);
            const a0 = Math.atan2(p.desde.z, p.desde.x);
            const rh = rh0 * Math.pow(1 - k, 1.25) + 1.15 * k;
            const a = a0 + 3.2 * k * k;
            p.grupo.position.set(Math.cos(a) * rh, p.desde.y * Math.pow(1 - k, 1.6), Math.sin(a) * rh);
            escalaRadial = 1 + 6 * Math.pow(Math.max(0, (k - 0.3) / 0.7), 2);
            rojo = THREE.MathUtils.smoothstep(k, 0.35, 0.95);
            alfa = 1 - THREE.MathUtils.smoothstep(k, 0.78, 1);
            soltarEstela(p, delta);
            if (k > 0.86 && !p.destello) {
                p.destello = true;
                materialAgujero.uniforms.uDestello.value = 1;
                sonarGolpe();
            }
            if (k >= 1) {
                p.estado = "caido";
                p.grupo.visible = false;
            }
        }
        if (escalaRadial > 1) {
            auxVector.copy(p.grupo.position).multiplyScalar(-1).normalize();
            p.cuerpo.quaternion.setFromUnitVectors(auxVector2.set(0, 1, 0), auxVector);
            const lado = 1 / Math.sqrt(escalaRadial);
            p.cuerpo.scale.set(r0 * lado, r0 * escalaRadial, r0 * lado);
        } else {
            p.cuerpo.quaternion.identity();
            p.cuerpo.scale.setScalar(r0);
        }
        p.material.uniforms.uRojo.value = rojo;
        p.material.uniforms.uAlfa.value = alfa;
        if (p.anillo) {
            p.anillo.material.uniforms.uRojo.value = rojo;
            p.anillo.material.uniforms.uAlfa.value = alfa;
        }
    });
}


// =====================================================================
// 5. LA ESTELA
// Mientras el planeta cae suelta polvo que también gira hacia el
// agujero y se enciende con el calor.
// =====================================================================

const estela = {
    pos: new Float32Array(ajustes.estela * 3),
    datos: new Float32Array(ajustes.estela * 2),
    vel: Array.from({ length: ajustes.estela }, () => new THREE.Vector3()),
    vida: new Float32Array(ajustes.estela),
    siguiente: 0
};
const geometriaEstela = new THREE.BufferGeometry();
geometriaEstela.setAttribute("position", new THREE.BufferAttribute(estela.pos, 3));
geometriaEstela.setAttribute("aDatos", new THREE.BufferAttribute(estela.datos, 2));
const materialEstela = new THREE.ShaderMaterial({
    uniforms: { uEscala: { value: 1 } },
    vertexShader: `
        attribute vec2 aDatos;
        uniform float uEscala;
        varying vec2 vDatos;
        void main() {
            vDatos = aDatos;
            vec4 v = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 70.0 * uEscala * aDatos.y / -v.z;
            gl_Position = projectionMatrix * v;
        }
    `,
    fragmentShader: `
        varying vec2 vDatos;
        void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = exp(-r * r * 4.0) * vDatos.x;
            vec3 c = mix(vec3(1.0, 0.35, 0.1), vec3(1.0, 0.85, 0.6), vDatos.x);
            gl_FragColor = vec4(c * a, 1.0);
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const puntosEstela = new THREE.Points(geometriaEstela, materialEstela);
puntosEstela.frustumCulled = false;
escenaPlanetas.add(puntosEstela);
const ultimaPosicion = new THREE.Vector3();

function soltarEstela(p, delta) {
    const vel = auxVector2.copy(p.grupo.position).sub(ultimaPosicion).divideScalar(Math.max(delta, 0.001));
    ultimaPosicion.copy(p.grupo.position);
    if (p.t < 0.05) return;
    const cuantas = movil ? 2 : 3;
    for (let k = 0; k < cuantas; k++) {
        const i = estela.siguiente;
        estela.siguiente = (estela.siguiente + 1) % ajustes.estela;
        const r = tamPlaneta() * 0.8;
        estela.pos[i * 3] = p.grupo.position.x + (Math.random() - 0.5) * r;
        estela.pos[i * 3 + 1] = p.grupo.position.y + (Math.random() - 0.5) * r;
        estela.pos[i * 3 + 2] = p.grupo.position.z + (Math.random() - 0.5) * r;
        estela.vel[i].copy(vel).multiplyScalar(0.7 + Math.random() * 0.25).add(auxVector.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
        estela.vida[i] = 1;
    }
}

function moverEstela(delta) {
    for (let i = 0; i < ajustes.estela; i++) {
        if (estela.vida[i] <= 0) {
            estela.datos[i * 2] = 0;
            continue;
        }
        estela.vida[i] -= delta * 0.45;
        auxVector.set(estela.pos[i * 3], estela.pos[i * 3 + 1], estela.pos[i * 3 + 2]);
        const r = auxVector.length();
        if (r < 1.3) estela.vida[i] = 0;
        estela.vel[i].addScaledVector(auxVector, (-7 / (r * r * r)) * delta);
        estela.vel[i].y -= auxVector.y * delta * 0.6;
        auxVector.addScaledVector(estela.vel[i], delta);
        estela.pos[i * 3] = auxVector.x;
        estela.pos[i * 3 + 1] = auxVector.y;
        estela.pos[i * 3 + 2] = auxVector.z;
        estela.datos[i * 2] = Math.max(0, estela.vida[i]) * Math.min(1, (r - 1.3) * 2);
        estela.datos[i * 2 + 1] = 0.5 + (1 - estela.vida[i]) * 1.2;
    }
    geometriaEstela.attributes.position.needsUpdate = true;
    geometriaEstela.attributes.aDatos.needsUpdate = true;
}


// =====================================================================
// 6. LAS SECCIONES Y LOS GESTOS
// Deslizar hacia arriba (o a la izquierda), la rueda o las flechas
// pasan a la siguiente; al revés, vuelve a la anterior.
// =====================================================================

const secciones = [...document.querySelectorAll(".seccion")];
const puntos = [...document.querySelectorAll(".puntos button")];
const pista = document.getElementById("pista");
let actual = 0;
let bloqueado = 0;

function marcarPuntos() {
    puntos.forEach((b, i) => {
        b.classList.toggle("activo", i === actual);
        b.classList.toggle("caido", i < actual);
        b.setAttribute("aria-current", i === actual ? "true" : "false");
    });
}

function cambiarTarjeta(nueva, retraso) {
    secciones.forEach((s) => {
        if (s.classList.contains("activa")) {
            s.classList.remove("activa");
            s.classList.add("sale");
            setTimeout(() => s.classList.remove("sale"), 700);
        }
    });
    setTimeout(() => {
        if (actual === nueva) secciones[nueva].classList.add("activa");
    }, retraso);
}

function irA(n) {
    if (n === actual || n < 0 || n >= planetas.length || bloqueado > 0) return;
    pista.classList.add("oculta");
    bloqueado = 1.6;
    const viejo = planetas[actual];
    const avanza = n > actual;
    if (avanza) {
        viejo.estado = "cae";
        viejo.t = 0;
        viejo.destello = false;
        viejo.desde.copy(viejo.grupo.position);
        ultimaPosicion.copy(viejo.grupo.position);
        for (let i = actual + 1; i < n; i++) planetas[i].estado = "caido";
        sonarCaida();
    } else {
        viejo.estado = "sale";
        viejo.t = 0;
        viejo.desde.copy(viejo.grupo.position);
        for (let i = n + 1; i < planetas.length; i++) if (i !== actual) planetas[i].estado = "espera";
    }
    const nuevo = planetas[n];
    setTimeout(() => {
        nuevo.estado = "llega";
        nuevo.t = 0;
        nuevo.grupo.visible = true;
        hueco(auxVector);
        puntoLejano(nuevo.grupo.position, auxVector);
    }, avanza ? 900 : 300);
    actual = n;
    marcarPuntos();
    cambiarTarjeta(n, avanza ? 2300 : 1500);
}

let inicioGesto = null;

addEventListener("pointerdown", (evento) => {
    if (evento.target.closest("button, a")) return;
    inicioGesto = { x: evento.clientX, y: evento.clientY, t: performance.now() };
});

addEventListener("pointerup", (evento) => {
    if (!inicioGesto) return;
    const dx = evento.clientX - inicioGesto.x;
    const dy = evento.clientY - inicioGesto.y;
    inicioGesto = null;
    if (Math.abs(dy) > 40 && Math.abs(dy) >= Math.abs(dx)) irA(actual + (dy < 0 ? 1 : -1));
    else if (Math.abs(dx) > 50) irA(actual + (dx < 0 ? 1 : -1));
});

addEventListener("pointercancel", () => (inicioGesto = null));

let ruedaAcumulada = 0;
addEventListener("wheel", (evento) => {
    ruedaAcumulada += evento.deltaY;
    if (Math.abs(ruedaAcumulada) > 60) {
        irA(actual + (ruedaAcumulada > 0 ? 1 : -1));
        ruedaAcumulada = 0;
    }
}, { passive: true });

addEventListener("keydown", (evento) => {
    if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(evento.key)) irA(actual + 1);
    if (["ArrowUp", "ArrowLeft", "PageUp"].includes(evento.key)) irA(actual - 1);
});

puntos.forEach((b, i) => b.addEventListener("click", () => irA(i)));

const botonPaisaje = document.getElementById("boton-paisaje");
botonPaisaje.addEventListener("click", () => {
    const oculto = document.body.classList.toggle("sin-texto");
    botonPaisaje.textContent = oculto ? "Ver texto" : "Ocultar texto";
    botonPaisaje.setAttribute("aria-pressed", oculto);
});
if (parametros.get("texto") === "no") botonPaisaje.click();


// =====================================================================
// 7. SONIDO
// Un zumbido grave de fondo y un rugido que baja cuando un planeta cae.
// =====================================================================

let audio = null;
let sonidoActivo = false;
const botonSonido = document.getElementById("boton-sonido");

function crearAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const general = ctx.createGain();
    general.gain.value = 0;
    general.connect(ctx.destination);
    [55, 55.6, 82.4].forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        const vol = ctx.createGain();
        vol.gain.value = i === 2 ? 0.04 : 0.09;
        osc.connect(vol).connect(general);
        osc.start();
    });
    const largo = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = buffer.getChannelData(0);
    let ultimo = 0;
    for (let i = 0; i < largo; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        datos[i] = ultimo * 3.5;
    }
    const ruido = ctx.createBufferSource();
    ruido.buffer = buffer;
    ruido.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 180;
    const vol = ctx.createGain();
    vol.gain.value = 0.25;
    ruido.connect(filtro).connect(vol).connect(general);
    ruido.start();
    return { ctx, general, buffer };
}

function sonarCaida() {
    if (!audio || !sonidoActivo) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime;
    const fuente = ctx.createBufferSource();
    fuente.buffer = audio.buffer;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.setValueAtTime(900, t);
    filtro.frequency.exponentialRampToValueAtTime(60, t + 3.4);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(0.9, t + 0.6);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    fuente.connect(filtro).connect(vol).connect(audio.general);
    fuente.start(t);
    fuente.stop(t + 3.7);
    const osc = ctx.createOscillator();
    const volOsc = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 3.4);
    volOsc.gain.setValueAtTime(0.0001, t);
    volOsc.gain.exponentialRampToValueAtTime(0.18, t + 0.8);
    volOsc.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    osc.connect(volOsc).connect(audio.general);
    osc.start(t);
    osc.stop(t + 3.6);
}

function sonarGolpe() {
    if (!audio || !sonidoActivo) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(vol).connect(audio.general);
    osc.start(t);
    osc.stop(t + 1.5);
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
// 8. TAMAÑO, CALIDAD Y BUCLE
// El agujero se calcula a menos resolución y se amplía. Si el aparato
// va justo, se baja la resolución sola hasta que vaya fluido.
// =====================================================================

let escala = Math.min(ajustes.escala, parseFloat(parametros.get("escala")) || ajustes.escala);

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 64 : 50;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    crearObjetivo();
    materialEstela.uniforms.uEscala.value = renderizador.getDrawingBufferSize(new THREE.Vector2()).y / 900;
}

function crearObjetivo() {
    const tam = renderizador.getDrawingBufferSize(new THREE.Vector2());
    const ancho = Math.max(64, Math.round(tam.x * escala));
    const alto = Math.max(64, Math.round(tam.y * escala));
    if (objetivoAgujero) objetivoAgujero.dispose();
    objetivoAgujero = new THREE.WebGLRenderTarget(ancho, alto, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    materialFinal.uniforms.tAgujero.value = objetivoAgujero.texture;
    materialFinal.uniforms.uTexel.value.set(1 / ancho, 1 / alto);
}

window.addEventListener("resize", ajustarTamano);

const reloj = new THREE.Clock();
const cargando = document.getElementById("cargando");
let tiempos = [];
let listo = false;

function vigilarRendimiento(delta) {
    tiempos.push(delta);
    if (tiempos.length < 45) return;
    const media = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
    tiempos = [];
    if (media > 1 / 42 && escala > ajustes.escalaMinima) {
        escala = Math.max(ajustes.escalaMinima, escala * 0.82);
        crearObjetivo();
    }
}

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (materialAgujero.uniforms.uTiempo.value += delta);
    materialFinal.uniforms.uTiempo.value = t;
    bloqueado = Math.max(0, bloqueado - delta);
    materialAgujero.uniforms.uDestello.value *= Math.exp(-delta * 1.4);
    colocarCamara(delta, t);
    moverPlanetas(delta, t);
    moverEstela(delta);
    renderizador.setRenderTarget(objetivoAgujero);
    renderizador.render(escenaAgujero, camaraPlana);
    renderizador.setRenderTarget(null);
    renderizador.clear();
    renderizador.render(escenaFinal, camaraPlana);
    renderizador.clearDepth();
    renderizador.render(escenaPlanetas, camara);
    if (!parametros.has("escala")) vigilarRendimiento(delta);
}

requestAnimationFrame(() => {
    setTimeout(() => {
        crearPlanetas();
        ajustarTamano();
        colocarCamara(-1, 0);
        hueco(planetas[0].grupo.position);
        renderizador.compile(escenaAgujero, camaraPlana);
        renderizador.compile(escenaPlanetas, camara);
        marcarPuntos();
        listo = true;
        cargando.classList.add("oculta");
        reloj.getDelta();
        animar();
    }, 30);
});
