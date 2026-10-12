import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Gargantua en pixel art. El agujero se calcula rayo a rayo como el de
// verdad (la gravedad curva la luz), pero en píxeles grandes y con una
// paleta corta de naranjas con tramado, como un juego retro. Al calcular
// muchísimos menos puntos, va fluido hasta en móviles normalitos.
// Delante, mis secciones flotan en burbujas. Al tocar una se acerca;
// al cerrarla, el agujero se traga las letras una a una y luego la
// burbuja, que al rato vuelve a entrar por la derecha.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 2 : 1.5,
    escala: 1 / (parseFloat(parametros.get("pixel")) || (movil ? 3 : 4)),
    escalaMinima: 1 / 7,
    pasos: movil ? 160 : 200,
    pasosMinimos: 110
};
const ACENTO = "#f2b27a";


// =====================================================================
// 2. RENDERIZADOR Y CÁMARA
// La cámara es una cámara normal de three.js: el shader del agujero lee
// su posición y su orientación, así las burbujas y el fondo encajan.
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.autoClear = false;
document.body.prepend(renderizador.domElement);

const camara = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 400);
const escenaFrente = new THREE.Scene();
const frente = new THREE.Group();
escenaFrente.add(frente);
const camaraPlana = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const plano = new THREE.PlaneGeometry(2, 2);

const aux = new THREE.Vector3();
const aux2 = new THREE.Vector3();
const derecha = new THREE.Vector3();
const arriba = new THREE.Vector3();
const delante = new THREE.Vector3();
const raton = { x: 0, y: 0, sx: 0, sy: 0 };

function colocarCamara(t) {
    raton.sx += (raton.x - raton.sx) * 0.03;
    raton.sy += (raton.y - raton.sy) * 0.03;
    const az = 0.35 + t * 0.018 + raton.sx * 0.08;
    const al = 0.11 + Math.sin(t * 0.09) * 0.045 + raton.sy * 0.04;
    const d = (16 + Math.sin(t * 0.07) * 0.7) * (camara.aspect < 1 ? 1.1 : 1);
    camara.position.set(d * Math.cos(al) * Math.sin(az), d * Math.sin(al), d * Math.cos(al) * Math.cos(az));
    delante.copy(camara.position).multiplyScalar(-1).normalize();
    derecha.crossVectors(delante, aux.set(0, 1, 0)).normalize();
    arriba.crossVectors(derecha, delante);
    const g = -0.5 + Math.sin(t * 0.05) * 0.08;
    camara.up.copy(arriba).multiplyScalar(Math.cos(g)).addScaledVector(derecha, -Math.sin(g));
    camara.lookAt(0, 0, 0);
    camara.updateMatrixWorld();
    const e = camara.matrixWorld.elements;
    derecha.set(e[0], e[1], e[2]);
    arriba.set(e[4], e[5], e[6]);
    delante.set(-e[8], -e[9], -e[10]);
    const u = materialAgujero.uniforms;
    u.uCamPos.value.copy(camara.position);
    u.uCamMat.value.set(derecha.x, arriba.x, delante.x, derecha.y, arriba.y, delante.y, derecha.z, arriba.z, delante.z);
    u.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(camara.fov) / 2);
    u.uAspecto.value = camara.aspect;
    frente.position.copy(camara.position);
    frente.quaternion.copy(camara.quaternion);
    frente.updateMatrixWorld();
}


// =====================================================================
// 3. EL AGUJERO NEGRO
// Por cada píxel se lanza un rayo desde la cámara. En cada paso la
// gravedad lo dobla (aproximación de Schwarzschild, radio = 1). Si cae
// dentro del horizonte el píxel es negro; si cruza el disco toma su
// color; si escapa, mira las estrellas. El disco gira más rápido por
// dentro, tiene anillos que se mueven y grumos calientes en órbita.
// =====================================================================

const MAX_PASOS = 260;

function crearTexturaRuido() {
    const n = 32;
    const datos = new Uint8Array(n * n * n);
    for (let i = 0; i < datos.length; i++) datos[i] = Math.floor(Math.random() * 256);
    const t = new THREE.Data3DTexture(datos, n, n, n);
    t.format = THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
}

const materialAgujero = new THREE.ShaderMaterial({
    uniforms: {
        uTiempo: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uCamMat: { value: new THREE.Matrix3() },
        uTanFov: { value: 0.47 },
        uAspecto: { value: 1 },
        uPasos: { value: ajustes.pasos },
        uDestello: { value: 0 },
        tRuido: { value: crearTexturaRuido() }
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
        uniform highp sampler3D tRuido;
        varying vec2 vUv;

        const float DENTRO = 2.6;
        const float FUERA = 14.0;

        float hash13(vec3 p) {
            p = fract(p * 0.1031);
            p += dot(p, p.zyx + 31.32);
            return fract((p.x + p.y) * p.z);
        }

        float ruido3(vec3 p) {
            return texture(tRuido, p * 0.03125).r;
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
                float escala = k == 0 ? 110.0 : 260.0;
                vec3 q = d * escala;
                vec3 id = floor(q);
                float h = hash13(id);
                if (h > 0.978) {
                    vec3 centro = vec3(hash13(id + 1.3), hash13(id + 2.7), hash13(id + 5.1)) * 0.6 + 0.2;
                    float dist = length(fract(q) - centro);
                    float brillo = exp(-dist * dist * 90.0) * (h - 0.978) / 0.022;
                    brillo *= 0.75 + 0.25 * sin(uTiempo * (1.5 + h * 3.0) + h * 40.0);
                    vec3 tono = mix(vec3(1.0, 0.82, 0.65), vec3(0.75, 0.85, 1.0), hash13(id + 9.0));
                    c += brillo * tono * (k == 0 ? 2.0 : 0.9);
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
            float omega = 3.4 * pow(r, -1.5);
            float ang = phi - uTiempo * omega;
            vec3 q = vec3(r * 2.4, cos(ang) * 1.5, sin(ang) * 1.5 + uTiempo * 0.06);
            float n = fbm3(q);
            float fino = fbm3(vec3(r * 8.0, cos(ang) * 3.5, sin(ang) * 3.5 - uTiempo * 0.1));
            float x = (r - DENTRO) / (FUERA - DENTRO);
            float perfil = smoothstep(-0.02, 0.05, x) * pow(clamp(1.0 - x, 0.0, 1.0), 1.3);
            float anillos = 0.62 + 0.38 * sin(r * 5.0 - uTiempo * 1.1 + n * 4.0) * sin(r * 1.7 + uTiempo * 0.4);
            float densidad = mix(smoothstep(0.2, 0.7, n) * (0.5 + 0.7 * fino) * anillos, 0.9, smoothstep(0.16, 0.0, x));
            float polvo = smoothstep(0.52, 0.78, fbm3(vec3(r * 1.2 + 4.0, cos(ang) * 0.8, sin(ang) * 0.8))) * smoothstep(0.15, 0.6, x);
            float manchas = 0.0;
            for (int i = 0; i < 5; i++) {
                float ri = 3.0 + float(i) * 1.45;
                float ai = uTiempo * 3.4 * pow(ri, -1.5) + float(i) * 2.3;
                float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
                manchas += exp(-pow(da / (1.0 + float(i) * 0.4), 2.0) - pow((r - ri) / 0.3, 2.0)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + float(i)));
            }
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
            float pulso = 1.0 + 0.12 * sin(uTiempo * 1.3 + r * 0.8);
            float brillo = temperatura * 2.6 * haz * pulso * sqrt(max(0.0, 1.0 - 1.0 / r)) * (1.0 + uDestello * 2.5 * exp(-x * 3.0));
            col *= brillo * (1.0 - polvo * 0.8) * (1.0 + manchas * 1.6);
            col = mix(col, col * vec3(1.15, 0.9, 0.75), smoothstep(1.0, 0.6, doppler) * 0.5);
            float alfa = clamp((densidad + manchas * 0.4) * perfil * 1.7, 0.0, 1.0);
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
            if (h2 > (FUERA + 1.0) * (FUERA + 1.0)) {
                vec3 haciaCentro = normalize(-(pos - dot(pos, dir) * dir));
                gl_FragColor = vec4(estrellas(normalize(dir + haciaCentro * 2.0 / sqrt(h2))), 1.0);
                return;
            }
            for (int i = 0; i < ${MAX_PASOS}; i++) {
                if (i >= uPasos) break;
                float r = length(pos);
                float paso = 0.025 + r * mix(0.085, 0.13, smoothstep(4.0, 12.0, r)) * smoothstep(0.9, 3.5, r);
                vec3 acel = -1.5 * h2 * pos / pow(r, 5.0);
                vec3 nuevo = pos + dir * paso;
                dir += acel * paso;
                float rh = length(pos.xz);
                float grosor = 0.12 + 0.045 * rh;
                if (rh > DENTRO * 0.9 && rh < FUERA && abs(pos.y) < grosor * 2.2) {
                    float niebla = exp(-pos.y * pos.y / (grosor * grosor));
                    {
                        float xr = (rh - DENTRO) / (FUERA - DENTRO);
                        float angulo = atan(pos.z, pos.x) - uTiempo * 3.4 * pow(rh, -1.5);
                        float ondas = 0.5 + 0.9 * ruido3(vec3(rh * 1.5, pos.y * 3.0 + uTiempo * 0.2, angulo * 2.0));
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
            col += vec3(1.0, 0.82, 0.62) * smoothstep(0.35, 1.6, anillo) * (1.1 + 0.25 * sin(uTiempo * 2.2)) * (1.0 - alfa * 0.6);
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
        const vec3 PALETA[9] = vec3[9](
            vec3(0.0, 0.0, 0.0),
            vec3(0.10, 0.04, 0.02),
            vec3(0.23, 0.09, 0.035),
            vec3(0.42, 0.17, 0.06),
            vec3(0.63, 0.29, 0.10),
            vec3(0.84, 0.48, 0.17),
            vec3(0.95, 0.65, 0.31),
            vec3(0.98, 0.82, 0.55),
            vec3(1.0, 0.95, 0.86)
        );
        const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
        vec3 aces(vec3 x) {
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }
        void main() {
            vec2 celda = floor(vUv / uTexel);
            vec3 c = aces(texture2D(tAgujero, (celda + 0.5) * uTexel).rgb * 0.95);
            float l = max(c.r, max(c.g * 1.05, c.b * 1.1));
            ivec2 b = ivec2(mod(celda, 4.0));
            float umbral = float(BAYER[b.y * 4 + b.x]) / 16.0;
            float x = clamp(pow(l, 0.8) * 8.0 + (umbral - 0.5) * 0.95, 0.0, 8.0) * smoothstep(0.03, 0.06, l);
            vec3 col = PALETA[int(floor(x + 0.5))];
            if (c.b > c.r * 1.15 && l > 0.22) col = vec3(0.78, 0.86, 1.0);
            gl_FragColor = vec4(col, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false
});

const escenaFinal = new THREE.Scene();
escenaFinal.add(new THREE.Mesh(plano, materialFinal));


// =====================================================================
// 4. LAS BURBUJAS
// Pompas de jabón: casi transparentes en el centro y con colores
// irisados en el borde, con un brillo cálido del lado del agujero.
// Dan vueltas en órbita delante de la cámara.
// =====================================================================

const materialBurbujaBase = new THREE.ShaderMaterial({
    uniforms: { uTiempo: { value: 0 }, uAlfa: { value: 1 }, uRojo: { value: 0 }, uOscuro: { value: 0 }, uFase: { value: 0 } },
    vertexShader: `
        uniform float uTiempo;
        uniform float uFase;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vMundo;
        void main() {
            vec3 p = position;
            float w = sin(p.x * 4.0 + uTiempo * 2.1 + uFase) * sin(p.y * 3.5 + uTiempo * 1.7) * 0.025;
            p += normal * w;
            vec4 m = modelMatrix * vec4(p, 1.0);
            vMundo = m.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            vV = normalize(cameraPosition - m.xyz);
            gl_Position = projectionMatrix * viewMatrix * m;
        }
    `,
    fragmentShader: `
        uniform float uTiempo;
        uniform float uAlfa;
        uniform float uRojo;
        uniform float uOscuro;
        uniform float uFase;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vMundo;
        void main() {
            vec3 n = normalize(vN);
            if (!gl_FrontFacing) n = -n;
            float c = abs(dot(n, vV));
            float f = floor(pow(1.0 - c, 2.2) * 5.0 + 0.5) / 5.0;
            float grosor = f * 2.4 + floor(uTiempo * 4.0) * 0.015 + n.y * 0.5 + uFase;
            vec3 iris = floor((0.5 + 0.5 * cos(6.2832 * (grosor + vec3(0.0, 0.33, 0.67)))) * 4.0 + 0.5) / 4.0;
            vec3 L = normalize(-vMundo);
            vec3 H = normalize(L + vV);
            float brillo = step(0.985, max(dot(n, H), 0.0)) * 1.4 + step(0.6, pow(max(dot(n, L), 0.0), 6.0)) * f * 0.5;
            vec3 calido = vec3(1.0, 0.72, 0.45);
            vec3 col = iris * f * 0.85 + calido * brillo;
            float a = (0.04 + f * 0.6 + brillo * 0.5);
            col = mix(col, vec3(0.015, 0.012, 0.012), uOscuro * (1.0 - f));
            a = max(a, uOscuro * 0.6);
            col = mix(col, col * vec3(1.5, 0.45, 0.2) + vec3(0.2, 0.04, 0.0) * f, uRojo);
            gl_FragColor = vec4(col, a * uAlfa);
        }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
});

const esfera = new THREE.SphereGeometry(1, 64, 40);
const burbujas = [];
const articulos = [...document.querySelectorAll(".seccion")];

function etiquetaTexto(texto) {
    const lienzo = document.createElement("canvas");
    lienzo.width = 512;
    lienzo.height = 128;
    const g = lienzo.getContext("2d");
    g.font = "400 58px Silkscreen, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0, 0, 0, 0.8)";
    g.shadowBlur = 14;
    g.fillStyle = "#f6efe8";
    g.fillText(texto, 256, 64);
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

function crearBurbujas() {
    articulos.forEach((articulo, i) => {
        const material = materialBurbujaBase.clone();
        material.uniforms.uFase.value = i * 1.3;
        const malla = new THREE.Mesh(esfera, material);
        malla.renderOrder = 1;
        const etiqueta = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425), new THREE.MeshBasicMaterial({ map: etiquetaTexto(articulo.querySelector("h2").textContent === "Miguel Ángel Calvente Medina" ? "Hola" : articulo.querySelector("h2").textContent), transparent: true, depthWrite: false, depthTest: false }));
        etiqueta.renderOrder = 2;
        const grupo = new THREE.Group();
        grupo.add(malla, etiqueta);
        frente.add(grupo);
        burbujas.push({ i, articulo, grupo, malla, material, etiqueta, estado: "orbita", t: 0, desde: new THREE.Vector3(), radio: 0.62, giro: Math.random() * 6 });
    });
}

function medidas() {
    const tan = Math.tan(THREE.MathUtils.degToRad(camara.fov) / 2);
    return { tan, alto: (d) => d * tan, ancho: (d) => d * tan * camara.aspect };
}

const ORBITA = { d: 9, velocidad: 0.13 };
let anguloOrbita = 0;

function puestoOrbita(i, destino) {
    const m = medidas();
    const vertical = camara.aspect < 1;
    const rx = m.ancho(ORBITA.d) * (vertical ? 0.62 : 0.66);
    const ry = m.alto(ORBITA.d) * (vertical ? 0.52 : 0.34);
    const a = anguloOrbita + (i / burbujas.length) * Math.PI * 2;
    return destino.set(Math.cos(a) * rx, Math.sin(a) * ry * 0.85 + (vertical ? 0.2 : 0.1), -ORBITA.d + Math.sin(a) * 1.8);
}

function puestoAbierta(destino) {
    return destino.set(0, 0, -abierta.d);
}

const abierta = { d: 3.4, radio: 1 };

function calcularAbierta() {
    const m = medidas();
    const alto = m.alto(abierta.d);
    const ancho = m.ancho(abierta.d);
    abierta.radio = camara.aspect < 1 ? Math.min(ancho * 0.97, alto * 0.62) : Math.min(alto * 0.86, ancho * 0.6);
    abierta.pxPorUnidad = innerHeight / 2 / alto;
    abierta.anchoTexto = Math.min(abierta.radio * 1.42, ancho * 1.8);
    abierta.altoTexto = camara.aspect < 1 ? Math.min(abierta.radio * 1.7, alto * 1.5) : abierta.radio * 1.36;
}


// =====================================================================
// 5. EL TEXTO DENTRO DE LA BURBUJA
// El artículo del HTML se dibuja en un lienzo y se guarda dónde cae
// cada letra. Luego cada letra es un trocito de ese lienzo que se puede
// mover sola: así el agujero se las puede tragar de una en una.
// =====================================================================

const medidor = document.createElement("canvas").getContext("2d");
const anchos = new Map();

function anchoLetra(letra, fuente) {
    const k = fuente + letra;
    if (!anchos.has(k)) {
        medidor.font = fuente;
        anchos.set(k, medidor.measureText(letra).width);
    }
    return anchos.get(k);
}

function maquetar(articulo, ancho, s) {
    const ops = [];
    const piezas = [];
    const enlaces = [];
    let y = 0;
    const fuentes = {
        numero: `400 ${11 * s}px Silkscreen, monospace`,
        titulo: `400 ${23 * s}px Silkscreen, monospace`,
        texto: `400 ${15.5 * s}px Inter, Arial, sans-serif`,
        fuerte: `600 ${15.5 * s}px Inter, Arial, sans-serif`,
        etiqueta: `500 ${13 * s}px Inter, Arial, sans-serif`,
        boton: `600 ${14.5 * s}px Inter, Arial, sans-serif`
    };

    function bloque(trozos, alturaLinea, margen, centrar) {
        const lineas = [[]];
        let x = 0;
        trozos.forEach((trozo) => {
            if (trozo.salto) {
                lineas.push([]);
                x = 0;
                return;
            }
            trozo.texto.split(/(\s+)/).forEach((palabra) => {
                if (!palabra) return;
                const espacio = trozo.espacio || 0;
                if (/^\s+$/.test(palabra)) {
                    if (x > 0) x += anchoLetra(" ", trozo.fuente) + espacio;
                    return;
                }
                const w = [...palabra].reduce((a, l) => a + anchoLetra(l, trozo.fuente) + espacio, 0);
                if (x + w > ancho && x > 0) {
                    lineas.push([]);
                    x = 0;
                }
                [...palabra].forEach((l) => {
                    const lw = anchoLetra(l, trozo.fuente);
                    lineas[lineas.length - 1].push({ letra: l, x, w: lw, fuente: trozo.fuente, color: trozo.color });
                    x += lw + espacio;
                });
            });
        });
        lineas.forEach((linea) => {
            const fin = linea.length ? linea[linea.length - 1].x + linea[linea.length - 1].w : 0;
            const desplazar = centrar ? (ancho - fin) / 2 : 0;
            linea.forEach((l) => {
                const x0 = l.x + desplazar;
                ops.push({ tipo: "letra", ...l, x: x0, y, h: alturaLinea });
                piezas.push({ x: x0 - 1, y, w: l.w + 2, h: alturaLinea });
            });
            y += alturaLinea;
        });
        y += margen;
    }

    [...articulo.children].forEach((nodo) => {
        if (nodo.classList.contains("numero")) {
            bloque([{ texto: nodo.textContent.toUpperCase(), fuente: fuentes.numero, color: ACENTO, espacio: 2.4 * s }], 18 * s, 4 * s, true);
        } else if (nodo.tagName === "H2") {
            bloque([{ texto: nodo.textContent, fuente: fuentes.titulo, color: "#f8f2ec" }], 34 * s, 10 * s, true);
        } else if (nodo.tagName === "P") {
            const trozos = [];
            nodo.childNodes.forEach((h) => {
                if (h.nodeName === "BR") trozos.push({ salto: true });
                else if (h.nodeName === "STRONG") trozos.push({ texto: h.textContent, fuente: fuentes.fuerte, color: "#fbf6f0" });
                else trozos.push({ texto: h.textContent.replace(/\s+/g, " "), fuente: fuentes.texto, color: "rgba(246, 240, 234, 0.86)" });
            });
            bloque(trozos, 24 * s, 10 * s, true);
        } else if (nodo.tagName === "UL") {
            const alto = 28 * s;
            const hueco = 7 * s;
            const filas = [[]];
            let x = 0;
            [...nodo.children].forEach((li) => {
                const w = [...li.textContent].reduce((a, l) => a + anchoLetra(l, fuentes.etiqueta), 0) + 22 * s;
                if (x + w > ancho && x > 0) {
                    filas.push([]);
                    x = 0;
                }
                filas[filas.length - 1].push({ texto: li.textContent, x, w });
                x += w + hueco;
            });
            filas.forEach((fila) => {
                const fin = fila.length ? fila[fila.length - 1].x + fila[fila.length - 1].w : 0;
                const desplazar = (ancho - fin) / 2;
                fila.forEach((e) => {
                    ops.push({ tipo: "pastilla", x: e.x + desplazar, y, w: e.w, h: alto, texto: e.texto, fuente: fuentes.etiqueta });
                    piezas.push({ x: e.x + desplazar - 2, y: y - 2, w: e.w + 4, h: alto + 4 });
                });
                y += alto + hueco;
            });
            y += 8 * s;
        } else if (nodo.tagName === "A") {
            const alto = 38 * s;
            const w = [...nodo.textContent].reduce((a, l) => a + anchoLetra(l, fuentes.boton), 0) + 40 * s;
            const x = (ancho - w) / 2;
            ops.push({ tipo: "boton", x, y: y + 4 * s, w, h: alto, texto: nodo.textContent, fuente: fuentes.boton });
            piezas.push({ x: x - 2, y: y + 4 * s - 2, w: w + 4, h: alto + 4 });
            enlaces.push({ x, y: y + 4 * s, w, h: alto, href: nodo.href });
            y += alto + 12 * s;
        }
    });
    return { ops, piezas, enlaces, alto: y };
}

function redondeado(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function dibujarTexto(articulo) {
    calcularAbierta();
    const anchoCss = abierta.anchoTexto * abierta.pxPorUnidad;
    const altoMax = abierta.altoTexto * abierta.pxPorUnidad;
    let s = Math.min(1.45, Math.max(0.8, anchoCss / 360));
    let m = maquetar(articulo, anchoCss, s);
    while (m.alto > altoMax && s > 0.62) {
        s *= 0.93;
        m = maquetar(articulo, anchoCss, s);
    }
    const borde = 8;
    const k = Math.min(2.5, (devicePixelRatio || 1) * 1.3);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.ceil((anchoCss + borde * 2) * k);
    lienzo.height = Math.ceil((m.alto + borde * 2) * k);
    const g = lienzo.getContext("2d");
    g.scale(k, k);
    g.translate(borde, borde);
    g.textBaseline = "middle";
    m.ops.forEach((op) => {
        if (op.tipo === "letra") {
            g.font = op.fuente;
            g.fillStyle = op.color;
            g.shadowColor = "rgba(0, 0, 0, 0.85)";
            g.shadowBlur = 6;
            g.fillText(op.letra, op.x, op.y + op.h / 2);
        } else {
            g.shadowBlur = 0;
            redondeado(g, op.x, op.y, op.w, op.h, op.h / 2);
            g.fillStyle = op.tipo === "boton" ? ACENTO : "rgba(255, 240, 225, 0.12)";
            g.fill();
            if (op.tipo === "pastilla") {
                g.strokeStyle = "rgba(255, 228, 200, 0.28)";
                g.lineWidth = 1;
                g.stroke();
            }
            g.font = op.fuente;
            g.fillStyle = op.tipo === "boton" ? "#2a1608" : "#f6efe8";
            g.textAlign = "center";
            g.fillText(op.texto, op.x + op.w / 2, op.y + op.h / 2 + 0.5);
            g.textAlign = "left";
        }
    });
    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.minFilter = THREE.LinearFilter;
    textura.generateMipmaps = false;
    const W = anchoCss + borde * 2;
    const H = m.alto + borde * 2;
    const ppu = abierta.pxPorUnidad;
    const piezas = m.piezas.map((p) => {
        const x = p.x + borde;
        const y = p.y + borde;
        return {
            uv: [x / W, 1 - (y + p.h) / H, p.w / W, p.h / H],
            local: new THREE.Vector3((x + p.w / 2 - W / 2) / ppu, -(y + p.h / 2 - H / 2) / ppu, 0),
            w: p.w / ppu,
            h: p.h / ppu
        };
    });
    const enlaces = m.enlaces.map((e) => ({ x0: (e.x + borde - W / 2) / ppu, x1: (e.x + borde + e.w - W / 2) / ppu, y0: -(e.y + borde + e.h - H / 2) / ppu, y1: -(e.y + borde - H / 2) / ppu, href: e.href }));
    return { textura, piezas, enlaces };
}


// =====================================================================
// 6. LAS LETRAS
// Todas las letras de la burbuja abierta son un solo InstancedMesh.
// Quietas, forman el texto. Al cerrar salen en fila hacia el agujero:
// giran en espiral, se estiran, se calientan y desaparecen en el disco.
// =====================================================================

const cuadro = new THREE.PlaneGeometry(1, 1);
const materialLetras = new THREE.ShaderMaterial({
    uniforms: { tTexto: { value: null } },
    vertexShader: `
        attribute vec4 aRect;
        attribute float aAlfa;
        attribute float aCalor;
        varying vec2 vUv;
        varying float vAlfa;
        varying float vCalor;
        void main() {
            vUv = aRect.xy + uv * aRect.zw;
            vAlfa = aAlfa;
            vCalor = aCalor;
            gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tTexto;
        varying vec2 vUv;
        varying float vAlfa;
        varying float vCalor;
        void main() {
            vec4 t = texture2D(tTexto, vUv);
            vec3 c = mix(t.rgb, vec3(1.0, 0.62, 0.3) * (1.0 + vCalor * 1.5), vCalor * 0.85);
            gl_FragColor = vec4(c, t.a * vAlfa);
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false
});

const letras = { malla: null, piezas: [], enlaces: [], burbuja: null };
const auxMatriz = new THREE.Matrix4();
const auxCuaternion = new THREE.Quaternion();
const auxCuaternion2 = new THREE.Quaternion();
const ejeZ = new THREE.Vector3(0, 0, 1);
const auxEscala = new THREE.Vector3();
const auxPos = new THREE.Vector3();

function prepararLetras(burbuja) {
    if (letras.malla) {
        escenaFrente.remove(letras.malla);
        letras.malla.geometry.dispose();
        materialLetras.uniforms.tTexto.value?.dispose();
    }
    const { textura, piezas, enlaces } = dibujarTexto(burbuja.articulo);
    const n = piezas.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = cuadro.index;
    geo.setAttribute("position", cuadro.attributes.position);
    geo.setAttribute("uv", cuadro.attributes.uv);
    geo.setAttribute("aRect", new THREE.InstancedBufferAttribute(new Float32Array(piezas.flatMap((p) => p.uv)), 4));
    geo.setAttribute("aAlfa", new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    geo.setAttribute("aCalor", new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    materialLetras.uniforms.tTexto.value = textura;
    const malla = new THREE.InstancedMesh(geo, materialLetras, n);
    malla.frustumCulled = false;
    malla.renderOrder = 3;
    escenaFrente.add(malla);
    letras.malla = malla;
    letras.burbuja = burbuja;
    letras.enlaces = enlaces;
    letras.piezas = piezas.map((p) => ({ ...p, estado: "quieta", t: 0, salida: 0, giro: 3.2 + Math.random() * 1.4, duracion: 1.7 + Math.random() * 0.5, inicio: new THREE.Vector3(), antes: new THREE.Vector3(), mundo: new THREE.Vector3() }));
}

function caminoAlAgujero(inicio, k, giro, destino) {
    const rh0 = Math.hypot(inicio.x, inicio.z);
    const a0 = Math.atan2(inicio.z, inicio.x);
    const rh = 1.05 + (rh0 - 1.05) * Math.pow(1 - k, 2.2);
    const a = a0 + giro * Math.pow(THREE.MathUtils.smoothstep(k, 0.15, 1), 1.3);
    return destino.set(Math.cos(a) * rh, inicio.y * Math.pow(1 - k, 2), Math.sin(a) * rh);
}

function moverLetras(delta) {
    const malla = letras.malla;
    if (!malla) return;
    const b = letras.burbuja;
    const alfa = malla.geometry.attributes.aAlfa;
    const calor = malla.geometry.attributes.aCalor;
    const escalaPanel = b.grupo.scale.x / abierta.radio;
    const visible = b.estado === "abierta" || b.estado === "cerrando" || b.estado === "abriendo";
    letras.piezas.forEach((p, i) => {
        let a = 0;
        let c = 0;
        let estirar = 1;
        let angulo = 0;
        if (p.estado === "quieta") {
            auxPos.copy(p.local).multiplyScalar(escalaPanel).add(b.grupo.position);
            frente.localToWorld(p.mundo.copy(auxPos));
            a = b.estado === "abriendo" ? THREE.MathUtils.smoothstep(b.t, 0.55, 1) : visible ? 1 : 0;
            if (b.estado === "cerrando" && b.t >= p.salida) {
                p.estado = "vuela";
                p.inicio.copy(p.mundo);
                p.antes.copy(p.mundo);
                p.t = 0;
            }
        } else if (p.estado === "vuela") {
            p.t = Math.min(1, p.t + delta / p.duracion);
            p.antes.copy(p.mundo);
            caminoAlAgujero(p.inicio, p.t, p.giro, p.mundo);
            aux.subVectors(p.mundo, p.antes);
            const vx = aux.dot(derecha);
            const vy = aux.dot(arriba);
            angulo = Math.atan2(vy, vx) * THREE.MathUtils.smoothstep(p.t, 0.05, 0.35);
            estirar = 1 + Math.min(4, Math.hypot(vx, vy) / Math.max(delta, 0.001) * 0.12) * THREE.MathUtils.smoothstep(p.t, 0.2, 0.8);
            c = THREE.MathUtils.smoothstep(p.t, 0.25, 0.9);
            a = 1 - THREE.MathUtils.smoothstep(p.t, 0.82, 1);
            if (p.t >= 1) {
                p.estado = "dentro";
                materialAgujero.uniforms.uDestello.value = Math.min(1.2, materialAgujero.uniforms.uDestello.value + 0.012);
            }
        }
        if (p.estado === "dentro") a = 0;
        alfa.array[i] = a;
        calor.array[i] = c;
        auxCuaternion.copy(camara.quaternion).multiply(auxCuaternion2.setFromAxisAngle(ejeZ, angulo));
        const encoger = p.estado === "vuela" ? 1 - 0.5 * p.t : 1;
        const escalaLetra = p.estado === "quieta" ? escalaPanel : 1;
        auxEscala.set(p.w * escalaLetra * estirar * encoger, p.h * escalaLetra * encoger / Math.sqrt(estirar), 1);
        auxMatriz.compose(p.mundo, auxCuaternion, auxEscala);
        malla.setMatrixAt(i, auxMatriz);
    });
    malla.instanceMatrix.needsUpdate = true;
    alfa.needsUpdate = true;
    calor.needsUpdate = true;
}


// =====================================================================
// 7. LA CRUZ PARA CERRAR
// =====================================================================

function texturaCruz() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 128;
    const g = lienzo.getContext("2d");
    g.fillStyle = "rgba(20, 14, 12, 0.6)";
    g.strokeStyle = "rgba(255, 228, 200, 0.5)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = "#f6efe8";
    g.lineWidth = 7;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(44, 44);
    g.lineTo(84, 84);
    g.moveTo(84, 44);
    g.lineTo(44, 84);
    g.stroke();
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

const cruz = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texturaCruz(), transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
cruz.renderOrder = 4;
frente.add(cruz);

function colocarCruz(b) {
    const r = b.grupo.scale.x;
    const vertical = camara.aspect < 1;
    const a = vertical ? 0.62 : 0.78;
    cruz.position.set(b.grupo.position.x + Math.cos(a) * r * (vertical ? 0.86 : 0.8), b.grupo.position.y + Math.sin(a) * r * (vertical ? 0.86 : 0.8), b.grupo.position.z + 0.02);
    const tam = Math.max(0.16, r * 0.13);
    cruz.scale.setScalar(tam);
}


// =====================================================================
// 8. ABRIR, CERRAR Y VOLVER
// =====================================================================

let ocupado = false;

function abrir(b) {
    if (ocupado || b.estado !== "orbita") return;
    ocupado = true;
    pista.classList.add("oculta");
    prepararLetras(b);
    b.estado = "abriendo";
    b.t = 0;
    b.desde.copy(b.grupo.position);
    b.radioDesde = b.grupo.scale.x;
    sonarAbrir();
}

function cerrar() {
    const b = burbujas.find((x) => x.estado === "abierta");
    if (!b) return;
    b.estado = "cerrando";
    b.t = 0;
    const n = letras.piezas.length;
    const paso = Math.min(0.018, 1.5 / Math.max(n, 1));
    letras.piezas.forEach((p, i) => (p.salida = 0.15 + i * paso));
    b.finLetras = 0.15 + n * paso;
    sonarSuccion(b.finLetras + 1.2);
}

let atenuado = 0;

function moverBurbujas(delta, t) {
    anguloOrbita += delta * ORBITA.velocidad;
    const hayAbierta = burbujas.some((b) => b.estado === "abriendo" || b.estado === "abierta" || b.estado === "cerrando");
    atenuado += ((hayAbierta ? 1 : 0) - atenuado) * Math.min(1, delta * 5);
    burbujas.forEach((b) => {
        b.material.uniforms.uTiempo.value = t;
        let radio = b.radio;
        let etiqueta = 1;
        let oscuro = 0.28;
        let rojo = 0;
        let alfa = 1;
        let estirar = 1;
        if (b.estado === "orbita") {
            puestoOrbita(b.i, aux);
            b.grupo.position.lerp(aux, Math.min(1, delta * 4));
        } else if (b.estado === "abriendo") {
            b.t = Math.min(1, b.t + delta / 0.85);
            const k = 1 - Math.pow(1 - b.t, 3);
            b.grupo.position.lerpVectors(b.desde, puestoAbierta(aux), k);
            radio = b.radioDesde + (abierta.radio - b.radioDesde) * k;
            etiqueta = 1 - k;
            oscuro = 0.28 + 0.72 * k;
            if (b.t >= 1) b.estado = "abierta";
        } else if (b.estado === "abierta") {
            b.grupo.position.lerp(puestoAbierta(aux), Math.min(1, delta * 4));
            radio = abierta.radio;
            etiqueta = 0;
            oscuro = 1;
        } else if (b.estado === "cerrando") {
            b.t += delta;
            radio = abierta.radio * (1 + Math.sin(b.t * 9) * 0.01) * (1 - 0.18 * THREE.MathUtils.smoothstep(b.t, 0.2, b.finLetras + 0.3));
            etiqueta = 0;
            oscuro = 1 - THREE.MathUtils.smoothstep(b.t, 0.1, b.finLetras);
            if (b.t > b.finLetras + 0.3) {
                b.estado = "tragada";
                b.t = 0;
                frente.localToWorld(b.inicio = b.grupo.position.clone());
                b.radioDesde = radio;
            }
        } else if (b.estado === "tragada") {
            b.t = Math.min(1, b.t + delta / 1.9);
            caminoAlAgujero(b.inicio, b.t, 3.6, aux);
            b.grupo.position.copy(frente.worldToLocal(aux));
            radio = b.radioDesde * (1 - 0.75 * b.t);
            estirar = 1 + 4 * Math.pow(Math.max(0, (b.t - 0.25) / 0.75), 2);
            rojo = THREE.MathUtils.smoothstep(b.t, 0.3, 0.9);
            alfa = 1 - THREE.MathUtils.smoothstep(b.t, 0.8, 1);
            etiqueta = 0;
            if (b.t > 0.88 && !b.destello) {
                b.destello = true;
                materialAgujero.uniforms.uDestello.value = 1.3;
                sonarGolpe();
            }
            if (b.t >= 1) {
                b.estado = "fuera";
                b.t = 0;
                b.destello = false;
                ocupado = false;
            }
        } else if (b.estado === "fuera") {
            b.t += delta;
            alfa = 0;
            if (b.t > 1.4) {
                b.estado = "volviendo";
                b.t = 0;
                const m = medidas();
                b.desde.set(m.ancho(ORBITA.d) + 2.5, 0.3, -ORBITA.d);
            }
        } else if (b.estado === "volviendo") {
            b.t = Math.min(1, b.t + delta / 2.2);
            const k = 1 - Math.pow(1 - b.t, 3);
            b.grupo.position.lerpVectors(b.desde, puestoOrbita(b.i, aux), k);
            alfa = Math.min(1, b.t * 2.5);
            if (b.t >= 1) b.estado = "orbita";
        }
        if (b.estado === "orbita" || b.estado === "volviendo") alfa *= 1 - 0.85 * atenuado;
        b.giro += delta * 0.3;
        b.malla.rotation.set(0.3, b.giro, 0);
        if (estirar > 1) {
            aux.set(0, 0, 0);
            frente.worldToLocal(aux).sub(b.grupo.position).normalize();
            b.grupo.quaternion.setFromUnitVectors(aux2.set(0, 1, 0), aux);
            b.grupo.scale.set(radio / Math.sqrt(estirar), radio * estirar, radio / Math.sqrt(estirar));
        } else {
            b.grupo.quaternion.identity();
            b.grupo.scale.setScalar(radio);
        }
        b.material.uniforms.uOscuro.value = oscuro * 0.9;
        b.material.uniforms.uRojo.value = rojo;
        b.material.uniforms.uAlfa.value = alfa;
        b.etiqueta.material.opacity = etiqueta * alfa;
        b.etiqueta.visible = etiqueta * alfa > 0.01;
        b.grupo.visible = alfa > 0.001;
    });
    const abiertaAhora = burbujas.find((b) => b.estado === "abierta" || b.estado === "abriendo");
    if (abiertaAhora) colocarCruz(abiertaAhora);
    const objetivoCruz = abiertaAhora && abiertaAhora.estado === "abierta" ? 1 : 0;
    cruz.material.opacity += (objetivoCruz - cruz.material.opacity) * Math.min(1, delta * 8);
    cruz.visible = cruz.material.opacity > 0.01;
}


// =====================================================================
// 9. TOCAR
// Toca una burbuja para abrirla. Con una abierta, la cruz o tocar fuera
// la cierra; el botón de GitHub abre el enlace.
// =====================================================================

const rayo = new THREE.Raycaster();
const auxRaton = new THREE.Vector2();
const pista = document.getElementById("pista");
let inicioToque = null;

addEventListener("pointerdown", (evento) => {
    if (evento.target.closest("button, a")) return;
    inicioToque = { x: evento.clientX, y: evento.clientY };
});

addEventListener("pointermove", (evento) => {
    raton.x = (evento.clientX / innerWidth) * 2 - 1;
    raton.y = (evento.clientY / innerHeight) * 2 - 1;
    if (movil) return;
    auxRaton.set(raton.x, -raton.y);
    rayo.setFromCamera(auxRaton, camara);
    const encima = !ocupado && burbujaTocada() !== null;
    const abiertaYa = burbujas.some((b) => b.estado === "abierta");
    renderizador.domElement.style.cursor = encima || abiertaYa ? "pointer" : "default";
});

function burbujaTocada() {
    let mejor = null;
    let distancia = Infinity;
    burbujas.forEach((b) => {
        if (b.estado !== "orbita") return;
        b.grupo.getWorldPosition(aux);
        const radio = b.grupo.scale.x * 1.05;
        if (rayo.ray.distanceSqToPoint(aux) > radio * radio) return;
        const d = aux.distanceTo(rayo.ray.origin);
        if (d < distancia) {
            distancia = d;
            mejor = b;
        }
    });
    return mejor;
}

addEventListener("pointerup", (evento) => {
    if (!inicioToque) return;
    const movido = Math.hypot(evento.clientX - inicioToque.x, evento.clientY - inicioToque.y);
    inicioToque = null;
    if (movido > 12) return;
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    const b = burbujas.find((x) => x.estado === "abierta");
    if (b) {
        const m = medidas();
        const lx = auxRaton.x * m.ancho(abierta.d) - b.grupo.position.x;
        const ly = auxRaton.y * m.alto(abierta.d) - b.grupo.position.y;
        const dCruz = Math.hypot(auxRaton.x * m.ancho(abierta.d) - cruz.position.x, auxRaton.y * m.alto(abierta.d) - cruz.position.y);
        if (dCruz < cruz.scale.x * 0.8) return cerrar();
        const enlace = letras.enlaces.find((e) => lx > e.x0 && lx < e.x1 && ly > e.y0 && ly < e.y1);
        if (enlace) return window.open(enlace.href, "_blank", "noopener");
        if (Math.hypot(lx, ly) > b.grupo.scale.x) cerrar();
        return;
    }
    rayo.setFromCamera(auxRaton, camara);
    const tocada = burbujaTocada();
    if (tocada) abrir(tocada);
});

addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") cerrar();
});

document.querySelectorAll(".atajos button").forEach((boton, i) => boton.addEventListener("click", () => abrir(burbujas[i])));


// =====================================================================
// 10. SONIDO
// Zumbido grave de fondo, un "plop" al abrir, una succión mientras se
// van las letras y un golpe sordo cuando cae la burbuja.
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
    const blanco = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datosBlanco = blanco.getChannelData(0);
    for (let i = 0; i < largo; i++) datosBlanco[i] = Math.random() * 2 - 1;
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
    return { ctx, general, blanco };
}

function tono(f0, f1, dur, volumen, tipo = "sine") {
    if (!audio || !sonidoActivo) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(volumen, t + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(vol).connect(audio.general);
    osc.start(t);
    osc.stop(t + dur + 0.05);
}

function sonarAbrir() {
    tono(260, 620, 0.18, 0.18);
    tono(520, 900, 0.12, 0.06);
}

function sonarSuccion(dur) {
    if (!audio || !sonidoActivo) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime;
    const fuente = ctx.createBufferSource();
    fuente.buffer = audio.blanco;
    fuente.loop = true;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.Q.value = 2.5;
    filtro.frequency.setValueAtTime(2400, t);
    filtro.frequency.exponentialRampToValueAtTime(140, t + dur);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(0.35, t + 0.3);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    fuente.connect(filtro).connect(vol).connect(audio.general);
    fuente.start(t);
    fuente.stop(t + dur + 0.1);
}

function sonarGolpe() {
    tono(75, 28, 1.4, 0.4);
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
// 11. TAMAÑO, CALIDAD Y BUCLE
// El agujero se calcula casi a resolución completa. Si el aparato va
// justo, se baja la resolución sola hasta que vaya fluido.
// =====================================================================

let escala = Math.min(ajustes.escala, parseFloat(parametros.get("escala")) || ajustes.escala);

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 62 : 50;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    crearObjetivo();
    calcularAbierta();
    const abiertaYa = burbujas.find((b) => b.estado === "abierta");
    if (abiertaYa) prepararLetras(abiertaYa);
}

function crearObjetivo() {
    const tam = renderizador.getDrawingBufferSize(new THREE.Vector2());
    const ancho = Math.max(32, Math.min(tam.x, Math.ceil(innerWidth * escala)));
    const alto = Math.max(32, Math.min(tam.y, Math.ceil(innerHeight * escala)));
    if (objetivoAgujero) objetivoAgujero.dispose();
    objetivoAgujero = new THREE.WebGLRenderTarget(ancho, alto, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    materialFinal.uniforms.tAgujero.value = objetivoAgujero.texture;
    materialFinal.uniforms.uTexel.value.set(1 / ancho, 1 / alto);
}

window.addEventListener("resize", ajustarTamano);

const reloj = new THREE.Clock();
const cargando = document.getElementById("cargando");
let tiempos = [];
let listo = false;

let rapidas = 0;

function vigilarRendimiento(delta) {
    if (delta > 0.09) return;
    tiempos.push(delta);
    if (tiempos.length < 40) return;
    const media = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
    tiempos = [];
    const pasos = materialAgujero.uniforms.uPasos;
    if (media > 1 / 45) {
        rapidas = 0;
        if (pasos.value > ajustes.pasosMinimos) pasos.value = Math.max(ajustes.pasosMinimos, Math.round(pasos.value * 0.85));
        else if (escala > ajustes.escalaMinima) {
            escala = Math.max(ajustes.escalaMinima, escala * 0.9);
            crearObjetivo();
        }
    } else if (media < 1 / 56 && ++rapidas >= 3) {
        rapidas = 0;
        if (escala < ajustes.escala) {
            escala = Math.min(ajustes.escala, escala * 1.08);
            crearObjetivo();
        } else if (pasos.value < ajustes.pasos) pasos.value = Math.min(ajustes.pasos, pasos.value + 15);
    }
}

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (materialAgujero.uniforms.uTiempo.value += delta);
    materialFinal.uniforms.uTiempo.value = t;
    materialAgujero.uniforms.uDestello.value *= Math.exp(-delta * 1.6);
    colocarCamara(t);
    moverBurbujas(delta, t);
    moverLetras(delta);
    renderizador.setRenderTarget(objetivoAgujero);
    renderizador.render(escenaAgujero, camaraPlana);
    renderizador.setRenderTarget(null);
    renderizador.clear();
    renderizador.render(escenaFinal, camaraPlana);
    renderizador.clearDepth();
    renderizador.render(escenaFrente, camara);
    if (!parametros.has("escala")) vigilarRendimiento(delta);
}

const fuentes = ["400 16px Inter", "500 16px Inter", "600 16px Inter", "400 30px Silkscreen"];

Promise.race([Promise.all(fuentes.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]).finally(() => {
    requestAnimationFrame(() => {
        crearBurbujas();
        ajustarTamano();
        colocarCamara(0);
        burbujas.forEach((b) => {
            puestoOrbita(b.i, b.grupo.position);
            b.grupo.scale.setScalar(b.radio);
        });
        renderizador.compile(escenaAgujero, camaraPlana);
        renderizador.compile(escenaFrente, camara);
        listo = true;
        cargando.classList.add("oculta");
        reloj.getDelta();
        animar();
        if (parametros.has("abrir")) setTimeout(() => abrir(burbujas[+parametros.get("abrir")]), 300);
    });
});
