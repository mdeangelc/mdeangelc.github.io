import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// =====================================================================
// 1. AJUSTES
// La Tierra con imágenes reales de la NASA: de día, de noche con las
// luces de las ciudades, con nubes, atmósfera y una lupa de relieve que
// dibuja curvas de nivel donde está el ratón.
// =====================================================================

const parametros = new URLSearchParams(location.search);
const movil = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const CASA = { lat: 36.6, lon: -4.9 };
const INCLINACION = THREE.MathUtils.degToRad(23.4);
const ajustes = {
    segmentos: movil ? 96 : 160,
    estrellas: movil ? 2500 : 5000,
    resolucionMax: movil ? 1.75 : 2
};


// =====================================================================
// 2. RENDERIZADOR, ESCENA Y CÁMARA
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderizador.setPixelRatio(Math.min(devicePixelRatio || 1, ajustes.resolucionMax));
renderizador.setSize(innerWidth, innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.05;
document.body.prepend(renderizador.domElement);

const lado = parametros.get("calidad") === "baja" || movil || renderizador.capabilities.maxTextureSize < 4096 ? "2k" : "4k";

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200);
camara.position.set(0, 0.6, Math.max(4.1, 1.3 / (Math.tan(THREE.MathUtils.degToRad(16)) * (innerWidth / innerHeight))));

const controles = new OrbitControls(camara, renderizador.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.06;
controles.enablePan = false;
controles.rotateSpeed = 0.5;
controles.zoomSpeed = 0.6;
controles.minDistance = 1.7;
controles.maxDistance = 14;
controles.autoRotate = true;
controles.autoRotateSpeed = 0.35;

const tierra = new THREE.Group();
tierra.rotation.z = INCLINACION;
escena.add(tierra);

function direccionDe(lat, lon, destino = new THREE.Vector3()) {
    const f = THREE.MathUtils.degToRad(lat);
    const l = THREE.MathUtils.degToRad(lon);
    return destino.set(Math.cos(l) * Math.cos(f), Math.sin(f), -Math.sin(l) * Math.cos(f));
}

const casaLocal = direccionDe(CASA.lat, CASA.lon);
const casaMundo = new THREE.Vector3();

function actualizarCasa() {
    tierra.updateMatrixWorld();
    casaMundo.copy(casaLocal).applyMatrix4(tierra.matrixWorld).normalize();
}


// =====================================================================
// 3. TEXTURAS
// =====================================================================

const cargador = new THREE.LoadingManager();
const lector = new THREE.TextureLoader(cargador);
const anisotropia = Math.min(8, renderizador.capabilities.getMaxAnisotropy());

function textura(nombre, color) {
    const t = lector.load("texturas/" + nombre);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropia;
    t.wrapS = THREE.RepeatWrapping;
    return t;
}

const texturas = {
    dia: textura(`dia-${lado}.jpg`, true),
    noche: textura(`noche-${lado}.jpg`, true),
    nubes: textura(`nubes-${lado}.jpg`, false),
    relieve: textura("relieve.jpg", false),
    agua: textura("agua.jpg", false)
};


// =====================================================================
// 4. UNIFORMES COMUNES
// =====================================================================

const comunes = {
    uSol: { value: new THREE.Vector3(1, 0.2, 0.4).normalize() },
    uTiempo: { value: 0 },
    uGiroNubes: { value: 0 }
};

const FINAL = `
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
`;


// =====================================================================
// 5. LA TIERRA
// El shader mezcla el día y la noche según el sol, pone las luces de
// las ciudades en la cara oscura, el brillo del sol en el mar, la
// sombra de las nubes y, donde está la lupa, colores de altitud y
// curvas de nivel.
// =====================================================================

const materialTierra = new THREE.ShaderMaterial({
    uniforms: {
        ...comunes,
        tDia: { value: texturas.dia },
        tNoche: { value: texturas.noche },
        tNubes: { value: texturas.nubes },
        tRelieve: { value: texturas.relieve },
        tAgua: { value: texturas.agua },
        uPuntero: { value: new THREE.Vector3(0, 1, 0) },
        uLente: { value: 0 },
        uRelieveTodo: { value: 0 },
        uPasoRelieve: { value: new THREE.Vector2(1 / 2048, 1 / 1024) }
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying vec3 vPosicion;
        varying vec3 vEste;
        varying vec3 vNorte;
        void main() {
            vUv = uv;
            vLocal = normalize(position);
            vNormal = normalize(mat3(modelMatrix) * normal);
            vec3 este = normalize(cross(vec3(0.0, 1.0, 0.0), vLocal) + vec3(0.0, 0.0, 1e-5));
            vEste = mat3(modelMatrix) * este;
            vNorte = mat3(modelMatrix) * cross(vLocal, este);
            vec4 p = modelMatrix * vec4(position, 1.0);
            vPosicion = p.xyz;
            gl_Position = projectionMatrix * viewMatrix * p;
        }
    `,
    fragmentShader: `
        uniform sampler2D tDia;
        uniform sampler2D tNoche;
        uniform sampler2D tNubes;
        uniform sampler2D tRelieve;
        uniform sampler2D tAgua;
        uniform vec3 uSol;
        uniform vec3 uPuntero;
        uniform float uLente;
        uniform float uRelieveTodo;
        uniform float uGiroNubes;
        uniform float uTiempo;
        uniform vec2 uPasoRelieve;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying vec3 vPosicion;
        varying vec3 vEste;
        varying vec3 vNorte;

        vec3 hipsometria(float h) {
            vec3 c = mix(vec3(0.16, 0.42, 0.2), vec3(0.55, 0.62, 0.3), smoothstep(0.0, 0.12, h));
            c = mix(c, vec3(0.86, 0.76, 0.46), smoothstep(0.1, 0.28, h));
            c = mix(c, vec3(0.66, 0.42, 0.26), smoothstep(0.26, 0.5, h));
            c = mix(c, vec3(0.95, 0.95, 0.97), smoothstep(0.55, 0.8, h));
            return c;
        }

        void main() {
            vec3 n = normalize(vNormal);
            vec3 V = normalize(cameraPosition - vPosicion);
            vec3 este = normalize(vEste);
            vec3 norte = normalize(vNorte);
            float agua = texture2D(tAgua, vUv).r;
            float h = texture2D(tRelieve, vUv).r;
            float hE = texture2D(tRelieve, vUv + vec2(uPasoRelieve.x, 0.0)).r;
            float hN = texture2D(tRelieve, vUv + vec2(0.0, uPasoRelieve.y)).r;
            float relieve = 1.0 + uLente * 2.0 + uRelieveTodo * 2.0;
            vec3 nRelieve = normalize(n - (este * (hE - h) + norte * (hN - h)) * 9.0 * relieve * (1.0 - agua));

            float sol = dot(n, uSol);
            float luz = max(dot(nRelieve, uSol), 0.0);
            float dia = smoothstep(-0.1, 0.16, sol);
            float crepusculo = smoothstep(-0.22, 0.02, sol) * smoothstep(0.32, 0.02, sol);

            vec2 uvNubes = vUv + vec2(uGiroNubes, 0.0);
            vec2 haciaSol = vec2(dot(uSol, este), dot(uSol, norte)) * vec2(0.0035, 0.007);
            float sombraNube = texture2D(tNubes, uvNubes + haciaSol).r;
            float nube = texture2D(tNubes, uvNubes).r;

            vec3 colDia = texture2D(tDia, vUv).rgb;
            vec3 color = colDia * (luz * 1.9 + 0.012) * (1.0 - sombraNube * 0.5 * dia);
            color += colDia * vec3(1.0, 0.42, 0.15) * crepusculo * 0.35;

            vec3 H = normalize(uSol + V);
            float brillo = pow(max(dot(n, H), 0.0), 240.0) * 0.45 + pow(max(dot(n, H), 0.0), 18.0) * 0.05;
            color += vec3(1.0, 0.86, 0.66) * brillo * agua * dia * (1.0 - nube * 0.8);

            vec3 luces = texture2D(tNoche, vUv).rgb;
            vec3 pesos = vec3(0.35, 0.55, 0.1);
            float lum = dot(luces, pesos);
            float fondoLuz = dot(texture2D(tNoche, vUv, 3.0).rgb, pesos);
            float ciudad = clamp(smoothstep(0.006, 0.05, lum - fondoLuz * 0.95) + smoothstep(0.07, 0.2, lum), 0.0, 1.0);
            color += vec3(1.0, 0.66, 0.3) * ciudad * 2.4 * (1.0 - dia) * (1.0 - nube * 0.7);
            color += colDia * vec3(0.5, 0.6, 1.0) * 0.012 * (1.0 - dia);

            float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
            vec3 cielo = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.45, 0.2), crepusculo);
            color = mix(color, cielo * (dia * 0.9 + crepusculo * 0.5), fres * 0.65);

            float distancia = 1.0 - dot(vLocal, uPuntero);
            float radio = 0.014;
            float lente = max(smoothstep(radio, radio * 0.75, distancia) * uLente, uRelieveTodo);
            if (lente > 0.001) {
                float tierraFirme = smoothstep(0.6, 0.3, agua);
                vec2 p = uPasoRelieve * 1.2;
                float hs = h * 0.4;
                hs += (texture2D(tRelieve, vUv + vec2(p.x, 0.0)).r + texture2D(tRelieve, vUv - vec2(p.x, 0.0)).r) * 0.15;
                hs += (texture2D(tRelieve, vUv + vec2(0.0, p.y)).r + texture2D(tRelieve, vUv - vec2(0.0, p.y)).r) * 0.15;
                float niveles = hs * 18.0;
                float ancho = fwidth(niveles);
                float curva = 1.0 - smoothstep(0.0, ancho * 1.3, abs(fract(niveles - 0.5) - 0.5));
                float maestra = 1.0 - smoothstep(0.0, ancho * 2.0, abs(fract(niveles / 5.0 - 0.5) - 0.5) * 5.0);
                vec3 mapa = hipsometria(hs) * (0.35 + 0.85 * max(luz, 0.25));
                mapa = mix(mapa, vec3(0.1, 0.07, 0.04), max(curva * 0.55, maestra * 0.8) * tierraFirme);
                vec3 mar = vec3(0.07, 0.2, 0.42) * (0.4 + 0.8 * max(luz, 0.25));
                mapa = mix(mar, mapa, tierraFirme);
                color = mix(color, mapa, lente * 0.82);
            }
            float aro = smoothstep(radio * 0.06, 0.0, abs(distancia - radio)) * uLente * (1.0 - uRelieveTodo);
            color += vec3(1.0, 0.75, 0.4) * aro * 1.5;

            gl_FragColor = vec4(color, 1.0);
            ${FINAL}
        }
    `,
    extensions: { derivatives: true }
});

const esfera = new THREE.SphereGeometry(1, ajustes.segmentos, ajustes.segmentos / 2);
const globo = new THREE.Mesh(esfera, materialTierra);
tierra.add(globo);


// =====================================================================
// 6. NUBES Y ATMÓSFERA
// =====================================================================

const materialNubes = new THREE.ShaderMaterial({
    uniforms: { ...comunes, tNubes: { value: texturas.nubes } },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vPosicion;
        void main() {
            vUv = uv;
            vNormal = normalize(mat3(modelMatrix) * normal);
            vec4 p = modelMatrix * vec4(position, 1.0);
            vPosicion = p.xyz;
            gl_Position = projectionMatrix * viewMatrix * p;
        }
    `,
    fragmentShader: `
        uniform sampler2D tNubes;
        uniform vec3 uSol;
        uniform float uGiroNubes;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vPosicion;
        void main() {
            vec3 n = normalize(vNormal);
            float nube = texture2D(tNubes, vUv + vec2(uGiroNubes, 0.0)).r;
            float sol = dot(n, uSol);
            float luz = smoothstep(-0.15, 0.35, sol);
            float crepusculo = smoothstep(-0.2, 0.0, sol) * smoothstep(0.3, 0.0, sol);
            vec3 color = vec3(1.0, 0.98, 0.95) * (luz * 1.25 + 0.006) + vec3(1.0, 0.5, 0.25) * crepusculo * 0.6;
            vec3 V = normalize(cameraPosition - vPosicion);
            float borde = smoothstep(0.0, 0.25, dot(n, V));
            gl_FragColor = vec4(color, nube * 0.95 * borde);
            ${FINAL}
        }
    `,
    transparent: true,
    depthWrite: false
});

const nubes = new THREE.Mesh(esfera, materialNubes);
nubes.scale.setScalar(1.006);
tierra.add(nubes);

const materialAtmosfera = new THREE.ShaderMaterial({
    uniforms: { ...comunes },
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosicion;
        void main() {
            vNormal = normalize(mat3(modelMatrix) * normal);
            vec4 p = modelMatrix * vec4(position, 1.0);
            vPosicion = p.xyz;
            gl_Position = projectionMatrix * viewMatrix * p;
        }
    `,
    fragmentShader: `
        uniform vec3 uSol;
        varying vec3 vNormal;
        varying vec3 vPosicion;
        void main() {
            vec3 n = normalize(vNormal);
            vec3 V = normalize(cameraPosition - vPosicion);
            float borde = dot(n, V);
            float halo = pow(clamp(-borde / 0.3, 0.0, 1.0), 3.0);
            float sol = dot(n, uSol);
            float luz = smoothstep(-0.45, 0.35, sol);
            float crepusculo = smoothstep(-0.4, -0.05, sol) * smoothstep(0.35, -0.05, sol);
            vec3 color = mix(vec3(0.28, 0.55, 1.0), vec3(1.0, 0.5, 0.22), crepusculo * 0.85) * (luz + crepusculo * 0.4);
            gl_FragColor = vec4(color * halo * 1.1, 1.0);
            ${FINAL}
        }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

const atmosfera = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), materialAtmosfera);
atmosfera.scale.setScalar(1.045);
escena.add(atmosfera);


// =====================================================================
// 7. MI CASA
// Un punto que late sobre Gaucín, con su etiqueta en HTML.
// =====================================================================

const materialCasa = new THREE.ShaderMaterial({
    uniforms: { uTiempo: comunes.uTiempo },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTiempo;
        varying vec2 vUv;
        void main() {
            float r = length(vUv - 0.5) * 2.0;
            float nucleo = exp(-r * r * 60.0) * 2.5 + exp(-r * r * 10.0) * 0.4;
            float ola = fract(uTiempo * 0.6);
            float aro = smoothstep(0.06, 0.0, abs(r - ola)) * (1.0 - ola);
            float ola2 = fract(uTiempo * 0.6 + 0.5);
            aro += smoothstep(0.06, 0.0, abs(r - ola2)) * (1.0 - ola2);
            vec3 color = vec3(1.0, 0.72, 0.32) * (nucleo + aro * 1.4);
            gl_FragColor = vec4(color * 2.0, 1.0);
            ${FINAL}
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

const casa = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), materialCasa);
casa.position.copy(casaLocal).multiplyScalar(1.004);
casa.lookAt(casaLocal.clone().multiplyScalar(2));
tierra.add(casa);

const marca = document.getElementById("marca");
const auxPantalla = new THREE.Vector3();
const auxCamara = new THREE.Vector3();

function colocarMarca() {
    actualizarCasa();
    auxCamara.copy(camara.position).normalize();
    const mira = casaMundo.dot(auxCamara);
    auxPantalla.copy(casaMundo).multiplyScalar(1.02).project(camara);
    const x = (auxPantalla.x * 0.5 + 0.5) * innerWidth;
    const y = (-auxPantalla.y * 0.5 + 0.5) * innerHeight;
    marca.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 34)}px)`;
    marca.classList.toggle("visible", mira > 0.35 && listo);
}


// =====================================================================
// 8. EL ESPACIO
// Estrellas de distintos colores y tamaños, más densas en la franja de
// la Vía Láctea, y un resplandor del sol a lo lejos.
// =====================================================================

function crearEstrellas() {
    const n = ajustes.estrellas;
    const posiciones = new Float32Array(n * 3);
    const datos = new Float32Array(n * 2);
    const colores = new Float32Array(n * 3);
    const banda = new THREE.Vector3(0.3, 1, 0.2).normalize();
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        p.randomDirection();
        if (Math.random() < 0.45) {
            p.addScaledVector(banda, -p.dot(banda) * (0.85 + Math.random() * 0.15)).normalize();
        }
        p.multiplyScalar(80);
        posiciones.set([p.x, p.y, p.z], i * 3);
        const brillo = Math.pow(Math.random(), 4);
        datos[i * 2] = 0.6 + brillo * 3.2;
        datos[i * 2 + 1] = Math.random() * 100;
        const t = Math.random();
        const c = t < 0.15 ? [1, 0.78, 0.6] : t < 0.35 ? [0.7, 0.8, 1] : [1, 0.97, 0.92];
        colores.set(c, i * 3);
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("aDatos", new THREE.BufferAttribute(datos, 2));
    geometria.setAttribute("aColor", new THREE.BufferAttribute(colores, 3));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTiempo: comunes.uTiempo, uEscala: { value: renderizador.getPixelRatio() } },
        vertexShader: `
            attribute vec2 aDatos;
            attribute vec3 aColor;
            uniform float uTiempo;
            uniform float uEscala;
            varying vec3 vColor;
            varying float vBrillo;
            void main() {
                vColor = aColor;
                vBrillo = 0.55 + 0.45 * sin(uTiempo * (1.0 + fract(aDatos.y) * 2.0) + aDatos.y);
                gl_PointSize = aDatos.x * uEscala;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vBrillo;
            void main() {
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = smoothstep(1.0, 0.0, r);
                gl_FragColor = vec4(vColor * a * a * vBrillo * 1.4, 1.0);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const estrellas = new THREE.Points(geometria, material);
    estrellas.frustumCulled = false;
    escena.add(estrellas);

    const materialFondo = new THREE.ShaderMaterial({
        uniforms: { uBanda: { value: banda } },
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uBanda;
            varying vec3 vDir;
            float hash(vec3 p) {
                p = fract(p * 0.3183099 + 0.1);
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            float ruido(vec3 x) {
                vec3 i = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                           mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
            }
            void main() {
                vec3 d = normalize(vDir);
                float franja = exp(-pow(dot(d, uBanda), 2.0) * 14.0);
                float nubes = ruido(d * 4.0) * 0.5 + ruido(d * 9.0) * 0.3 + ruido(d * 20.0) * 0.2;
                float polvo = smoothstep(0.45, 0.75, ruido(d * 7.0 + 3.0));
                vec3 color = mix(vec3(0.05, 0.06, 0.12), vec3(0.14, 0.1, 0.12), nubes) * franja * nubes * (1.0 - polvo * 0.6);
                color += vec3(0.008, 0.01, 0.02);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    });
    const fondo = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), materialFondo);
    escena.add(fondo);
}

function crearSol() {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 256;
    const ctx = lienzo.getContext("2d");
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255, 250, 235, 1)");
    g.addColorStop(0.06, "rgba(255, 236, 200, 0.9)");
    g.addColorStop(0.2, "rgba(255, 190, 120, 0.25)");
    g.addColorStop(1, "rgba(255, 160, 90, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(lienzo);
    t.colorSpace = THREE.SRGBColorSpace;
    const sol = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sol.scale.setScalar(16);
    escena.add(sol);
    return sol;
}

crearEstrellas();
const solVisible = crearSol();


// =====================================================================
// 9. MOMENTOS: DÍA, ATARDECER Y NOCHE EN MÁLAGA
// En vez de girar la Tierra se mueve el sol alrededor de ella, de forma
// que en Málaga sea mediodía, la puesta de sol o noche cerrada.
// =====================================================================

const MOMENTOS = { dia: 0.8, atardecer: 0.03, noche: -0.72 };
let momento = parametros.get("momento") in MOMENTOS ? parametros.get("momento") : "atardecer";
let anguloSol = -1;
const auxSol = new THREE.Vector3();
const ejeY = new THREE.Vector3(0, 1, 0);

function solConAngulo(angulo, destino) {
    destino.set(casaMundo.x, 0, casaMundo.z).normalize().applyAxisAngle(ejeY, angulo);
    destino.y = 0.12;
    return destino.normalize();
}

function anguloPara(alineacion) {
    let mejor = 0;
    let error = Infinity;
    for (let a = 0; a >= -Math.PI; a -= 0.005) {
        const e = Math.abs(solConAngulo(a, auxSol).dot(casaMundo) - alineacion);
        if (e < error) {
            error = e;
            mejor = a;
        }
    }
    return mejor;
}

function colocarSol(delta) {
    actualizarCasa();
    if (!colocarSol.angulos) colocarSol.angulos = Object.fromEntries(Object.entries(MOMENTOS).map(([k, v]) => [k, anguloPara(v)]));
    const objetivo = colocarSol.angulos[momento];
    if (delta < 0) anguloSol = objetivo;
    anguloSol += (objetivo - anguloSol) * (1 - Math.exp(-Math.max(delta, 0) * 1.4));
    comunes.uSol.value.copy(solConAngulo(anguloSol, auxSol));
    solVisible.position.copy(comunes.uSol.value).multiplyScalar(70);
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
// 10. LA LUPA DE RELIEVE
// Con el ratón encima se ven colores de altitud y curvas de nivel. En el
// móvil aparece unos segundos donde se toca.
// =====================================================================

const rayo = new THREE.Raycaster();
const auxRaton = new THREE.Vector2();
const esferaGlobo = new THREE.Sphere(new THREE.Vector3(), 1);
const puntoCorte = new THREE.Vector3();
const lupa = { objetivo: 0, valor: 0, hasta: 0 };
let relieveTodo = false;
const botonRelieve = document.getElementById("boton-relieve");

function apuntar(evento) {
    auxRaton.set((evento.clientX / innerWidth) * 2 - 1, -(evento.clientY / innerHeight) * 2 + 1);
    rayo.setFromCamera(auxRaton, camara);
    const corte = rayo.ray.intersectSphere(esferaGlobo, puntoCorte);
    if (!corte) {
        lupa.objetivo = 0;
        return false;
    }
    const local = globo.worldToLocal(puntoCorte.clone()).normalize();
    materialTierra.uniforms.uPuntero.value.copy(local);
    lupa.objetivo = 1;
    return true;
}

renderizador.domElement.addEventListener("pointermove", (evento) => {
    if (evento.pointerType === "touch") return;
    apuntar(evento);
});

renderizador.domElement.addEventListener("pointerleave", () => {
    lupa.objetivo = 0;
});

renderizador.domElement.addEventListener("pointerdown", (evento) => {
    pararPaseo();
    document.getElementById("pista").classList.add("oculta");
    if (evento.pointerType === "touch" && apuntar(evento)) lupa.hasta = performance.now() + 3000;
});

botonRelieve.addEventListener("click", () => {
    relieveTodo = !relieveTodo;
    botonRelieve.classList.toggle("activo", relieveTodo);
    botonRelieve.setAttribute("aria-pressed", relieveTodo);
});

function moverLupa(delta) {
    if (lupa.hasta && performance.now() > lupa.hasta) {
        lupa.hasta = 0;
        lupa.objetivo = 0;
    }
    lupa.valor += (lupa.objetivo - lupa.valor) * Math.min(1, delta * 8);
    materialTierra.uniforms.uLente.value = lupa.valor;
    const u = materialTierra.uniforms.uRelieveTodo;
    u.value += ((relieveTodo ? 1 : 0) - u.value) * Math.min(1, delta * 4);
}


// =====================================================================
// 11. IR A MÁLAGA
// La cámara vuela hasta quedar encima de casa, un poco inclinada.
// =====================================================================

let paseo = null;
const botonCasa = document.getElementById("boton-casa");

function irACasa() {
    actualizarCasa();
    const inicio = camara.position.clone();
    const distancia = Math.max(2.2, Math.min(2.8, inicio.length()));
    const destino = casaMundo.clone().add(new THREE.Vector3(0, -0.25, 0)).normalize().multiplyScalar(distancia);
    paseo = { inicio, destino, t: 0 };
    controles.autoRotate = false;
    botonCasa.classList.add("activo");
}

function pararPaseo() {
    paseo = null;
    botonCasa.classList.remove("activo");
}

function moverPaseo(delta) {
    if (!paseo) return;
    paseo.t = Math.min(1, paseo.t + delta / 2.6);
    const k = paseo.t < 0.5 ? 4 * paseo.t ** 3 : 1 - (-2 * paseo.t + 2) ** 3 / 2;
    const largo = THREE.MathUtils.lerp(paseo.inicio.length(), paseo.destino.length(), k);
    camara.position.copy(paseo.inicio).normalize().lerp(paseo.destino.clone().normalize(), k).normalize().multiplyScalar(largo);
    if (paseo.t >= 1) {
        paseo = null;
        setTimeout(() => botonCasa.classList.remove("activo"), 600);
    }
}

botonCasa.addEventListener("click", irACasa);
marca.addEventListener("click", () => {
    mostrarTarjetas(true);
    document.querySelector(".presentacion").scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
});


// =====================================================================
// 12. LAS TARJETAS Y EL ENCUADRE
// Con las tarjetas abiertas la Tierra se aparta hacia un lado (o hacia
// arriba en el móvil) para que no quede tapada.
// =====================================================================

const botonPaisaje = document.getElementById("boton-paisaje");
const tarjetas = [...document.querySelectorAll(".tarjeta")];
const encuadre = { valor: 1, objetivo: 1 };

function mostrarTarjetas(mostrar) {
    document.body.classList.toggle("sin-tarjetas", !mostrar);
    botonPaisaje.textContent = mostrar ? "Ver el paisaje" : "Ver tarjetas";
    botonPaisaje.setAttribute("aria-pressed", !mostrar);
    encuadre.objetivo = mostrar ? 1 : 0;
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

if (parametros.get("tarjetas") === "no") {
    mostrarTarjetas(false);
    encuadre.valor = 0;
}

function aplicarEncuadre(delta) {
    encuadre.valor += (encuadre.objetivo - encuadre.valor) * Math.min(1, delta * 3);
    const ancho = innerWidth;
    const alto = innerHeight;
    const estrecho = ancho <= 900;
    const dx = estrecho ? 0 : 200 * encuadre.valor;
    const dy = estrecho ? alto * 0.14 * encuadre.valor : 0;
    if (dx < 0.5 && dy < 0.5) camara.clearViewOffset();
    else camara.setViewOffset(ancho, alto, dx, dy, ancho, alto);
}


// =====================================================================
// 13. TAMAÑO, CARGA Y BUCLE
// =====================================================================

window.addEventListener("resize", () => {
    camara.aspect = innerWidth / innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(innerWidth, innerHeight);
});

const cargando = document.getElementById("cargando");
let listo = false;

cargador.onProgress = (url, hechos, total) => {
    cargando.textContent = "Cargando la Tierra... " + Math.round((hechos / total) * 100) + "%";
};

cargador.onLoad = () => {
    Object.values(texturas).forEach((t) => renderizador.initTexture(t));
    listo = true;
    cargando.classList.add("oculta");
    setTimeout(() => document.getElementById("pista").classList.add("oculta"), 7000);
};

cargador.onError = () => {
    cargando.textContent = "No se han podido cargar las imágenes de la Tierra";
};

const reloj = new THREE.Clock();
colocarSol(-1);
cambiarMomento(momento);
actualizarCasa();
const distanciaInicial = camara.position.length();
camara.position.copy(casaMundo).applyAxisAngle(ejeY, -0.3).setY(casaMundo.y * 0.6).normalize().multiplyScalar(distanciaInicial);
if (parametros.get("casa") === "si") {
    actualizarCasa();
    camara.position.copy(casaMundo).add(new THREE.Vector3(0, -0.25, 0)).normalize().multiplyScalar(2.6);
    controles.autoRotate = false;
}

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);
    comunes.uTiempo.value += delta;
    comunes.uGiroNubes.value = (comunes.uGiroNubes.value + delta * 0.0018) % 1;
    colocarSol(delta);
    moverLupa(delta);
    moverPaseo(delta);
    controles.update();
    aplicarEncuadre(delta);
    colocarMarca();
    renderizador.render(escena, camara);
}

animar();
