import * as THREE from "three";

// =====================================================================
// 1. AJUSTES
// Estilo gelatina: un remolino blandito y brillante de colores pastel
// que se traga todo hacia el centro. Por él caen golosinas de gelatina
// y, delante, mis secciones flotan en burbujas. Al cerrar una, el
// remolino se traga las letras una a una y luego la burbuja, que al
// rato vuelve a entrar por la derecha. Todo son piezas normales con
// shaders sencillos, así que va fluido en cualquier móvil.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const ajustes = {
    resolucionMax: movil ? 2 : 1.5,
    gotas: movil ? 22 : 34,
    aros: movil ? 12 : 18
};
const ACENTO = "#ff8fc8";

function alturaEmbudo(r) {
    return -7 / (r + 0.6) + 0.35;
}


// =====================================================================
// 2. RENDERIZADOR Y CÁMARA
// La cámara mira el remolino desde arriba y un poco de lado.
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
document.body.prepend(renderizador.domElement);

const camara = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 900);
const escenaFrente = new THREE.Scene();
const frente = new THREE.Group();
escenaFrente.add(frente);

const comunes = {
    uTiempo: { value: 0 },
    uDestello: { value: 0 },
    uTrago: { value: 0 },
    uOnda: { value: 9 },
    uNiebla: { value: new THREE.Color("#f3b8dc") }
};

const aux = new THREE.Vector3();
const aux2 = new THREE.Vector3();
const derecha = new THREE.Vector3();
const arriba = new THREE.Vector3();
const delante = new THREE.Vector3();
const raton = { x: 0, y: 0, sx: 0, sy: 0 };

function colocarCamara(t) {
    raton.sx += (raton.x - raton.sx) * 0.03;
    raton.sy += (raton.y - raton.sy) * 0.03;
    const az = 0.4 + t * 0.03 + raton.sx * 0.1;
    const al = 0.52 + Math.sin(t * 0.09) * 0.05 + raton.sy * 0.05;
    const d = (17 + Math.sin(t * 0.07) * 0.8) * (camara.aspect < 1 ? 1.15 : 1);
    camara.position.set(d * Math.cos(al) * Math.sin(az), d * Math.sin(al) - 1, d * Math.cos(al) * Math.cos(az));
    camara.up.set(0, 1, 0);
    camara.lookAt(0, -1.6, 0);
    camara.updateMatrixWorld();
    const e = camara.matrixWorld.elements;
    derecha.set(e[0], e[1], e[2]);
    arriba.set(e[4], e[5], e[6]);
    delante.set(-e[8], -e[9], -e[10]);
    frente.position.copy(camara.position);
    frente.quaternion.copy(camara.quaternion);
    frente.updateMatrixWorld();
}


// =====================================================================
// 3. EL REMOLINO DE GELATINA
// Un embudo hecho con LatheGeometry: rayas en espiral que giran hacia
// dentro, brillo de gelatina (reflejo fuerte y luz que atraviesa los
// bordes) y una onda que sale del centro cada vez que traga algo.
// =====================================================================

const gelatinaGlsl = `
    vec3 gelatina(vec3 base, vec3 n, vec3 V) {
        vec3 L = normalize(vec3(0.35, 1.0, 0.45));
        float dif = max(dot(n, L), 0.0) * 0.55 + 0.45;
        vec3 H = normalize(L + V);
        float nh = max(dot(n, H), 0.0);
        float brillo = pow(nh, 80.0) * 1.1 + pow(nh, 12.0) * 0.1;
        float borde = pow(1.0 - max(dot(n, V), 0.0), 2.5);
        vec3 c = base * dif + base * borde * 0.7 + vec3(1.0, 0.92, 1.0) * borde * 0.22 + vec3(1.0) * brillo;
        c += base * pow(max(dot(-n, L), 0.0), 2.0) * 0.3;
        return c;
    }
`;

function materialEmbudo() {
    return new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uOnda: comunes.uOnda, uNiebla: comunes.uNiebla },
        vertexShader: `
            uniform float uTiempo;
            uniform float uOnda;
            varying vec3 vMundo;
            varying vec3 vN;
            varying float vR;
            varying float vAng;
            void main() {
                vec3 p = position;
                float r = length(p.xz);
                float ang = atan(p.z, p.x);
                float ola = sin(r * 1.4 - uTiempo * 2.0 + ang * 2.0) * 0.07 * smoothstep(1.5, 5.0, r) * smoothstep(30.0, 12.0, r);
                float golpe = exp(-pow((r - 1.2 - uOnda * 7.0) / 1.1, 2.0)) * exp(-uOnda * 0.9) * 0.7;
                p.y += ola + golpe;
                vR = r;
                vAng = ang;
                vec4 m = modelMatrix * vec4(p, 1.0);
                vMundo = m.xyz;
                float pendiente = 7.0 / ((r + 0.6) * (r + 0.6));
                vN = normalize(mat3(modelMatrix) * vec3(-pendiente * cos(ang), 1.0, -pendiente * sin(ang)));
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform float uTiempo;
            uniform vec3 uNiebla;
            varying vec3 vMundo;
            varying vec3 vN;
            varying float vR;
            varying float vAng;
            ${gelatinaGlsl}
            void main() {
                vec3 n = normalize(vN);
                if (!gl_FrontFacing) n = -n;
                vec3 V = normalize(cameraPosition - vMundo);
                float espiral = sin(vAng * 3.0 + log(vR) * 9.0 + uTiempo * 2.4);
                float fina = sin(vAng * 9.0 + log(vR) * 26.0 + uTiempo * 3.4);
                float t = smoothstep(1.0, 16.0, vR);
                vec3 base = mix(vec3(0.34, 0.08, 0.52), vec3(0.96, 0.44, 0.78), smoothstep(0.0, 0.45, t));
                base = mix(base, vec3(0.46, 0.88, 0.84), smoothstep(0.45, 1.0, t));
                base = mix(base, base * 1.35 + 0.06, smoothstep(0.2, 0.9, espiral) * 0.55);
                base *= 0.92 + 0.08 * fina;
                base *= mix(0.2, 1.0, smoothstep(1.0, 4.5, vR));
                vec3 c = gelatina(base, n, V);
                c = mix(c, uNiebla, smoothstep(20.0, 40.0, length(vMundo - cameraPosition)));
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }
        `,
        side: THREE.DoubleSide
    });
}

function materialBola() {
    return new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uTrago: comunes.uTrago },
        vertexShader: `
            uniform float uTiempo;
            uniform float uTrago;
            varying vec3 vMundo;
            varying vec3 vN;
            void main() {
                vec3 p = position;
                p += normal * (sin(p.x * 3.0 + uTiempo * 2.6) * sin(p.y * 2.5 + uTiempo * 2.1) * 0.06 + uTrago * 0.05 * sin(uTiempo * 25.0));
                p.y *= 1.0 - uTrago * 0.3;
                p.xz *= 1.0 + uTrago * 0.18;
                vec4 m = modelMatrix * vec4(p, 1.0);
                vMundo = m.xyz;
                vN = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform float uTiempo;
            uniform float uTrago;
            varying vec3 vMundo;
            varying vec3 vN;
            ${gelatinaGlsl}
            void main() {
                vec3 n = normalize(vN);
                vec3 V = normalize(cameraPosition - vMundo);
                vec3 base = mix(vec3(0.1, 0.02, 0.18), vec3(0.55, 0.2, 0.75), uTrago * 0.6);
                vec3 c = gelatina(base, n, V);
                c += vec3(0.9, 0.4, 1.0) * pow(1.0 - max(dot(n, V), 0.0), 3.0) * (0.3 + 0.2 * sin(uTiempo * 2.0));
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }
        `
    });
}

function materialGolosina() {
    return new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uNiebla: comunes.uNiebla },
        vertexShader: `
            uniform float uTiempo;
            varying vec3 vMundo;
            varying vec3 vN;
            varying vec3 vColor;
            void main() {
                vColor = vec3(1.0);
                #ifdef USE_INSTANCING_COLOR
                    vColor = instanceColor;
                #endif
                vec3 p = position;
                float fase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
                p += normal * sin(p.y * 6.0 + uTiempo * 5.0 + fase) * 0.025;
                vec4 m = modelMatrix * instanceMatrix * vec4(p, 1.0);
                vMundo = m.xyz;
                vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * m;
            }
        `,
        fragmentShader: `
            uniform vec3 uNiebla;
            varying vec3 vMundo;
            varying vec3 vN;
            varying vec3 vColor;
            ${gelatinaGlsl}
            void main() {
                vec3 n = normalize(vN);
                vec3 V = normalize(cameraPosition - vMundo);
                vec3 c = gelatina(vColor * 0.85, n, V);
                c = mix(c, uNiebla, smoothstep(20.0, 40.0, length(vMundo - cameraPosition)));
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }
        `
    });
}

const COLORES = ["#ff7fb8", "#ffd36e", "#8fe3c8", "#9db7ff", "#c79bff", "#ff9e7a", "#7fd6ff"].map((c) => new THREE.Color(c));
const golosinas = [];

function crearFondo() {
    const cielo = new THREE.Mesh(
        new THREE.SphereGeometry(400, 32, 16),
        new THREE.ShaderMaterial({
            uniforms: { uTiempo: comunes.uTiempo },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTiempo;
                varying vec3 vDir;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                void main() {
                    float h = vDir.y;
                    vec3 c = mix(vec3(0.95, 0.72, 0.86), vec3(0.62, 0.55, 0.98), smoothstep(0.0, 0.5, h));
                    c = mix(c, vec3(0.3, 0.22, 0.62), smoothstep(0.45, 1.0, h));
                    c = mix(vec3(0.95, 0.72, 0.86), c, smoothstep(-0.05, 0.02, h));
                    vec2 q = vec2(atan(vDir.z, vDir.x) * 6.0, h * 12.0);
                    vec2 id = floor(q);
                    float k = hash(id);
                    if (k > 0.8 && h > 0.05) {
                        vec2 centro = vec2(hash(id + 1.7), hash(id + 3.1)) * 0.6 + 0.2;
                        float d = length(fract(q) - centro);
                        c += vec3(1.0, 0.95, 1.0) * smoothstep(0.25, 0.0, d) * 0.12 * (0.6 + 0.4 * sin(uTiempo + k * 20.0));
                    }
                    gl_FragColor = vec4(c, 1.0);
                    #include <colorspace_fragment>
                }
            `,
            side: THREE.BackSide,
            depthWrite: false
        })
    );
    cielo.renderOrder = -2;
    escenaFrente.add(cielo);

    const perfil = [];
    for (let i = 0; i <= 120; i++) {
        const r = 0.95 + 44 * Math.pow(i / 120, 1.9);
        perfil.push(new THREE.Vector2(r, alturaEmbudo(r)));
    }
    const embudo = new THREE.Mesh(new THREE.LatheGeometry(perfil, movil ? 120 : 180), materialEmbudo());
    escenaFrente.add(embudo);

    const bola = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 32), materialBola());
    bola.position.set(0, alturaEmbudo(1) + 0.55, 0);
    escenaFrente.add(bola);

    const material = materialGolosina();
    [[new THREE.SphereGeometry(0.34, 24, 16), ajustes.gotas], [new THREE.TorusGeometry(0.28, 0.12, 14, 32), ajustes.aros]].forEach(([geo, n]) => {
        const malla = new THREE.InstancedMesh(geo, material, n);
        for (let i = 0; i < n; i++) {
            malla.setColorAt(i, COLORES[Math.floor(Math.random() * COLORES.length)]);
            golosinas.push({ malla, i, r: 3 + Math.random() * 15, ang: Math.random() * 6.28, giro: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), velGiro: 0.5 + Math.random(), tam: 0.75 + Math.random() * 0.6, fase: Math.random() * 6 });
        }
        malla.frustumCulled = false;
        escenaFrente.add(malla);
    });
}

const auxMatrizFondo = new THREE.Matrix4();
const auxCuatFondo = new THREE.Quaternion();
const auxEscalaFondo = new THREE.Vector3();
const auxPosFondo = new THREE.Vector3();

function moverFondo(delta, t) {
    comunes.uOnda.value += delta;
    comunes.uTrago.value *= Math.exp(-delta * 2.5);
    const tocadas = new Set();
    golosinas.forEach((g) => {
        g.r -= delta * (0.18 + 1.3 / g.r);
        g.ang += delta * (2.2 / Math.pow(g.r, 1.15) + 0.05);
        if (g.r < 1.4) {
            g.r = 15 + Math.random() * 6;
            g.ang = Math.random() * 6.28;
            comunes.uTrago.value = Math.min(1, comunes.uTrago.value + 0.15);
        }
        const y = alturaEmbudo(g.r) + 0.3 * g.tam + Math.sin(t * 2 + g.fase) * 0.05;
        auxPosFondo.set(Math.cos(g.ang) * g.r, y, Math.sin(g.ang) * g.r);
        g.giro.x += delta * g.velGiro;
        g.giro.y += delta * g.velGiro * 0.7;
        auxCuatFondo.setFromEuler(g.giro);
        const encoge = THREE.MathUtils.smoothstep(g.r, 1.4, 3.2) * Math.min(1, (21 - g.r) * 0.5);
        auxEscalaFondo.setScalar(g.tam * Math.max(0.001, encoge));
        auxMatrizFondo.compose(auxPosFondo, auxCuatFondo, auxEscalaFondo);
        g.malla.setMatrixAt(g.i, auxMatrizFondo);
        tocadas.add(g.malla);
    });
    tocadas.forEach((m) => (m.instanceMatrix.needsUpdate = true));
}

function tragarLetra() {
    comunes.uTrago.value = Math.min(1, comunes.uTrago.value + 0.04);
}

function tragarBurbuja() {
    comunes.uTrago.value = 1;
    comunes.uOnda.value = 0;
}


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
            float f = pow(1.0 - c, 2.2);
            float grosor = f * 2.4 + uTiempo * 0.06 + n.y * 0.5 + uFase;
            vec3 iris = 0.5 + 0.5 * cos(6.2832 * (grosor + vec3(0.0, 0.33, 0.67)));
            vec3 L = normalize(vec3(0.35, 1.0, 0.45));
            vec3 H = normalize(L + vV);
            float brillo = pow(max(dot(n, H), 0.0), 90.0) * 1.8 + pow(max(dot(n, L), 0.0), 6.0) * f * 0.6;
            vec3 calido = vec3(1.0, 0.85, 0.95);

            vec3 col = iris * f * 0.85 + calido * brillo;
            float a = (0.04 + f * 0.6 + brillo * 0.5);
            col = mix(col, vec3(0.07, 0.025, 0.12), uOscuro * (1.0 - f));
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
    g.font = "600 76px Fraunces, Georgia, serif";
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
        numero: `600 ${11 * s}px Inter, Arial, sans-serif`,
        titulo: `600 ${27 * s}px Fraunces, Georgia, serif`,
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
    const caer = 1 - Math.pow(1 - k, 2);
    return destino.set(Math.cos(a) * rh, inicio.y * (1 - caer) + (alturaEmbudo(rh) + 0.4) * caer, Math.sin(a) * rh);
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
                tragarLetra();
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
                tragarBurbuja();
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
// 11. TAMAÑO Y BUCLE
// =====================================================================

function ajustarTamano() {
    camara.aspect = innerWidth / innerHeight;
    camara.fov = camara.aspect < 1 ? 62 : 50;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
    calcularAbierta();
    const abiertaYa = burbujas.find((b) => b.estado === "abierta");
    if (abiertaYa) prepararLetras(abiertaYa);
}

window.addEventListener("resize", ajustarTamano);

const reloj = new THREE.Clock();
const cargando = document.getElementById("cargando");
let listo = false;

function animar() {
    requestAnimationFrame(animar);
    if (!listo) return;
    const delta = Math.min(reloj.getDelta(), 0.1);
    const t = (comunes.uTiempo.value += delta);
    comunes.uDestello.value *= Math.exp(-delta * 1.6);
    colocarCamara(t);
    moverFondo(delta, t);
    moverBurbujas(delta, t);
    moverLetras(delta);
    renderizador.render(escenaFrente, camara);
}

const fuentes = ["400 16px Inter", "500 16px Inter", "600 16px Inter", "600 30px Fraunces"];

Promise.race([Promise.all(fuentes.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]).finally(() => {
    requestAnimationFrame(() => {
        crearFondo();
        crearBurbujas();
        ajustarTamano();
        colocarCamara(0);
        burbujas.forEach((b) => {
            puestoOrbita(b.i, b.grupo.position);
            b.grupo.scale.setScalar(b.radio);
        });
        renderizador.compile(escenaFrente, camara);
        listo = true;
        cargando.classList.add("oculta");
        reloj.getDelta();
        animar();
        if (parametros.has("abrir")) setTimeout(() => abrir(burbujas[+parametros.get("abrir")]), 300);
    });
});
