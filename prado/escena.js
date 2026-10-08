import * as THREE from "three";

// =====================================================================
// 1. AJUSTES GENERALES
// =====================================================================

const movil = window.innerWidth < 700 || window.matchMedia("(pointer: coarse)").matches;
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Con ?calidad=baja en la dirección se dibuja menos hierba
const calidadBaja = new URLSearchParams(location.search).get("calidad") === "baja";
const factorCalidad = calidadBaja ? 0.25 : 1;

const ajustes = {
    hierbaCerca: Math.floor((movil ? 38000 : 90000) * factorCalidad),
    hierbaLejos: Math.floor((movil ? 45000 : 110000) * factorCalidad),
    flores: Math.floor((movil ? 700 : 1800) * Math.max(factorCalidad, 0.5)),
    luciernagas: movil ? 45 : 110,
    estrellas: 1400,
    pixeles: Math.min(window.devicePixelRatio, movil ? 1.5 : 2)
};

// Números aleatorios con semilla: el prado sale siempre igual al recargar
let semilla = 20261009;
function azar() {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// =====================================================================
// 2. FORMA DE LA COLINA
// La misma función sirve para el terreno, para colocar la hierba
// y para saber dónde toca el ratón.
// =====================================================================

const cimaColina = { x: 0, z: -42 };

function alturaTerreno(x, z) {
    const dx = x - cimaColina.x;
    const dz = z - cimaColina.z;
    const colina = 8 * Math.exp(-(dx * dx) / (2 * 24 * 24) - (dz * dz) / (2 * 20 * 20));
    const lomas = 0.45 * Math.sin(x * 0.08 + 1.3) * Math.cos(z * 0.06 + 0.4)
                + 0.25 * Math.sin(x * 0.19 + z * 0.11);
    return colina + lomas;
}

// =====================================================================
// 3. RENDERIZADOR, ESCENA Y CÁMARA
// =====================================================================

const renderizador = new THREE.WebGLRenderer({ antialias: true });
renderizador.setPixelRatio(ajustes.pixeles);
renderizador.setSize(window.innerWidth, window.innerHeight);
renderizador.toneMapping = THREE.ACESFilmicToneMapping;
renderizador.toneMappingExposure = 1.05;
document.body.prepend(renderizador.domElement);

const escena = new THREE.Scene();

const camara = new THREE.PerspectiveCamera(movil ? 62 : 48, window.innerWidth / window.innerHeight, 0.05, 900);
const baseCamara = new THREE.Vector3(0, alturaTerreno(0, 12) + 0.75, 12);
const objetivoCamara = new THREE.Vector3(0, 5.2, -42);
camara.position.copy(baseCamara);
camara.lookAt(objetivoCamara);

// =====================================================================
// 4. MOMENTOS DEL DÍA
// Cada momento es una lista de colores y valores. Al cambiar de
// momento se mezclan poco a poco los del actual con los del nuevo.
// =====================================================================

const momentos = {
    manana: {
        cenit: "#3f8fdc", medio: "#8cc4ef", horizonte: "#e3f1f8",
        sol: "#fff4dc", luz: "#fff1dc", ambiente: "#6f8796", niebla: "#d4e7ef",
        nubeLuz: "#ffffff", nubeSombra: "#b9cbda", nubes: 0.85,
        verdeBase: "#1d4612", verdePunta: "#8cc63e", amarillo: "#d8cf58",
        montana: "#7c9cad", luna: "#e8eefc",
        dirSol: [0.42, 0.36, -0.83], dirDisco: [0.42, 0.36, -0.83], alturaLuna: -0.3,
        intensidad: 1.0, translucidez: 0.35, noche: 0, solVisible: 1
    },
    atardecer: {
        cenit: "#8f9fcb", medio: "#f0b48c", horizonte: "#fde0b8",
        sol: "#ffe6b0", luz: "#ffe6c8", ambiente: "#6a6466", niebla: "#f3cfaa",
        nubeLuz: "#ffe8d0", nubeSombra: "#cf8f82", nubes: 0.7,
        verdeBase: "#173a0b", verdePunta: "#7fb52f", amarillo: "#d2bd48",
        montana: "#c59a8f", luna: "#e8eefc",
        dirSol: [0.34, 0.17, -0.92], dirDisco: [0.34, 0.17, -0.92], alturaLuna: -0.3,
        intensidad: 0.95, translucidez: 1.0, noche: 0, solVisible: 1
    },
    noche: {
        cenit: "#030817", medio: "#0b1631", horizonte: "#1b2c52",
        sol: "#ffe6b0", luz: "#9fb6f0", ambiente: "#253254", niebla: "#13213f",
        nubeLuz: "#34466e", nubeSombra: "#111a32", nubes: 0.35,
        verdeBase: "#081a12", verdePunta: "#3f6e5c", amarillo: "#4c5c48",
        montana: "#16233f", luna: "#eef2fc",
        dirSol: [-0.38, 0.3, -0.87], dirDisco: [0.34, -0.3, -0.9], alturaLuna: 0.3,
        intensidad: 0.45, translucidez: 0.12, noche: 1, solVisible: 0
    }
};

const nombresColor = ["cenit", "medio", "horizonte", "sol", "luz", "ambiente", "niebla", "nubeLuz", "nubeSombra",
    "verdeBase", "verdePunta", "amarillo", "montana", "luna"];
const nombresNumero = ["nubes", "intensidad", "translucidez", "noche", "solVisible", "alturaLuna"];

const pantallaEstrecha = window.innerWidth < window.innerHeight;

function prepararMomento(datos) {
    if (pantallaEstrecha) {
        datos.dirSol = [datos.dirSol[0] * 0.55, datos.dirSol[1], datos.dirSol[2]];
        datos.dirDisco = [datos.dirDisco[0] * 0.55, datos.dirDisco[1], datos.dirDisco[2]];
    }
    const preparado = {
        dirSol: new THREE.Vector3(...datos.dirSol).normalize(),
        dirDisco: new THREE.Vector3(...datos.dirDisco).normalize()
    };
    nombresColor.forEach((n) => (preparado[n] = new THREE.Color(datos[n])));
    nombresNumero.forEach((n) => (preparado[n] = datos[n]));
    return preparado;
}

Object.keys(momentos).forEach((clave) => (momentos[clave] = prepararMomento(momentos[clave])));

const actual = prepararMomento({
    ...Object.fromEntries(nombresColor.map((n) => [n, "#000000"])),
    dirSol: [0, 1, 0], dirDisco: [0, 1, 0], nubes: 0, intensidad: 0, translucidez: 0, noche: 0, solVisible: 0, alturaLuna: 0
});

function copiarMomento(destino, origen) {
    nombresColor.forEach((n) => destino[n].copy(origen[n]));
    nombresNumero.forEach((n) => (destino[n] = origen[n]));
    destino.dirSol.copy(origen.dirSol);
    destino.dirDisco.copy(origen.dirDisco);
}

function mezclarMomentos(destino, a, b, t) {
    nombresColor.forEach((n) => destino[n].lerpColors(a[n], b[n], t));
    nombresNumero.forEach((n) => (destino[n] = a[n] + (b[n] - a[n]) * t));
    destino.dirSol.lerpVectors(a.dirSol, b.dirSol, t).normalize();
    destino.dirDisco.lerpVectors(a.dirDisco, b.dirDisco, t).normalize();
}

// Uniformes compartidos por todos los shaders
const comunes = {
    uTiempo: { value: 0 },
    uNiebla: { value: actual.niebla },
    uLuz: { value: new THREE.Color() },
    uAmbiente: { value: actual.ambiente },
    uDirSol: { value: actual.dirSol },
    uVerdeBase: { value: actual.verdeBase },
    uVerdePunta: { value: actual.verdePunta },
    uAmarillo: { value: actual.amarillo },
    uTranslucidez: { value: 0 },
    uRaton: { value: new THREE.Vector2(999, 999) },
    uFuerzaRaton: { value: 0 },
    uViento: { value: new THREE.Vector2(0.8, -0.6).normalize() },
    uFuerzaViento: { value: movimientoReducido ? 0.25 : 1 }
};

// =====================================================================
// 5. FUNCIONES DE RUIDO PARA LOS SHADERS
// Sirven para las manchas de color, las ráfagas de viento y las nubes.
// =====================================================================

const ruidoGLSL = `
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float ruido(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    float fbm(vec2 p) {
        float total = 0.0;
        float amplitud = 0.5;
        for (int i = 0; i < 4; i++) {
            total += ruido(p) * amplitud;
            p *= 2.03;
            amplitud *= 0.5;
        }
        return total;
    }

    float manchas(vec2 xz) {
        return smoothstep(0.42, 0.64, fbm(xz * 0.05 + vec2(3.1, 7.2)));
    }
`;

const nieblaGLSL = `
    vec3 aplicarNiebla(vec3 color, float distancia) {
        float n = smoothstep(18.0, 150.0, distancia);
        return mix(color, uNiebla, n * 0.92);
    }
`;

// =====================================================================
// 6. CIELO: degradado, sol, luna y nubes en un solo shader
// =====================================================================

const materialCielo = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
        ...comunes,
        uCenit: { value: actual.cenit },
        uMedio: { value: actual.medio },
        uHorizonte: { value: actual.horizonte },
        uColorSol: { value: actual.sol },
        uColorLuna: { value: actual.luna },
        uNubeLuz: { value: actual.nubeLuz },
        uNubeSombra: { value: actual.nubeSombra },
        uNubes: { value: 0 },
        uSolVisible: { value: 1 },
        uLunaVisible: { value: 0 },
        uDirDisco: { value: actual.dirDisco },
        uDirLuna: { value: new THREE.Vector3(-0.38, 0.3, -0.87).normalize() }
    },
    vertexShader: `
        varying vec3 vDireccion;
        void main() {
            vDireccion = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
        }
    `,
    fragmentShader: `
        uniform float uTiempo;
        uniform vec3 uCenit;
        uniform vec3 uMedio;
        uniform vec3 uHorizonte;
        uniform vec3 uColorSol;
        uniform vec3 uColorLuna;
        uniform vec3 uNubeLuz;
        uniform vec3 uNubeSombra;
        uniform float uNubes;
        uniform float uSolVisible;
        uniform float uLunaVisible;
        uniform vec3 uDirSol;
        uniform vec3 uDirDisco;
        uniform vec3 uDirLuna;
        varying vec3 vDireccion;
        ${ruidoGLSL}

        void main() {
            vec3 d = normalize(vDireccion);
            float h = d.y;

            vec3 color = mix(uHorizonte, uMedio, smoothstep(0.0, 0.2, h));
            color = mix(color, uCenit, smoothstep(0.18, 0.75, h));

            float sol = max(dot(d, uDirDisco), 0.0);
            color += uColorSol * (pow(sol, 8.0) * 0.12 + pow(sol, 60.0) * 0.22 + pow(sol, 600.0) * 0.5) * uSolVisible;
            color = mix(color, vec3(1.0, 0.97, 0.9) * 2.4, smoothstep(0.99905, 0.9994, sol) * uSolVisible);

            float luna = max(dot(d, uDirLuna), 0.0);
            color += uColorLuna * (pow(luna, 60.0) * 0.03 + pow(luna, 600.0) * 0.12) * uLunaVisible;
            float discoLuna = smoothstep(0.99962, 0.99972, luna);
            float sombraLuna = 0.85 + 0.15 * ruido(d.xy * 900.0);
            color = mix(color, uColorLuna * sombraLuna, discoLuna * uLunaVisible);

            if (h > 0.0) {
                vec2 uv = d.xz / (h + 0.15) * 1.1 + vec2(uTiempo * 0.012, uTiempo * 0.004);
                float n = fbm(uv * 0.8);
                float nube = smoothstep(0.52, 0.82, n) * smoothstep(0.02, 0.3, h) * uNubes;
                vec3 colorNube = mix(uNubeSombra, uNubeLuz, smoothstep(0.5, 0.95, n));
                colorNube += uColorSol * pow(sol, 4.0) * 0.35 * uSolVisible;
                color = mix(color, colorNube, nube);
            }

            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
});

const cielo = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), materialCielo);
cielo.frustumCulled = false;
escena.add(cielo);

// =====================================================================
// 7. ESTRELLAS
// =====================================================================

const posicionesEstrellas = [];
for (let i = 0; i < ajustes.estrellas; i++) {
    const angulo = azar() * Math.PI * 2;
    const y = 0.06 + Math.pow(azar(), 0.7) * 0.94;
    const horizontal = Math.sqrt(1 - y * y);
    posicionesEstrellas.push(Math.cos(angulo) * horizontal * 500, y * 500, Math.sin(angulo) * horizontal * 500);
}
const geometriaEstrellas = new THREE.BufferGeometry();
geometriaEstrellas.setAttribute("position", new THREE.Float32BufferAttribute(posicionesEstrellas, 3));
const materialEstrellas = new THREE.PointsMaterial({
    color: "#ffffff", size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false
});
escena.add(new THREE.Points(geometriaEstrellas, materialEstrellas));

// =====================================================================
// 8. MONTAÑAS LEJANAS (difuminadas con la distancia)
// =====================================================================

function crearCordillera(distancia, alturaBase, variacion, fase, bruma) {
    const forma = new THREE.Shape();
    const ancho = 900;
    forma.moveTo(-ancho / 2, -10);
    for (let x = -ancho / 2; x <= ancho / 2; x += 3) {
        const y = alturaBase
            + Math.sin(x * 0.011 + fase) * variacion
            + Math.sin(x * 0.029 + fase * 1.9) * variacion * 0.5
            + Math.sin(x * 0.083 + fase * 3.1) * variacion * 0.14;
        forma.lineTo(x, y);
    }
    forma.lineTo(ancho / 2, -10);
    forma.closePath();

    const material = new THREE.ShaderMaterial({
        depthWrite: true,
        uniforms: {
            uColor: { value: actual.montana },
            uNiebla: comunes.uNiebla,
            uBruma: { value: bruma },
            uAltura: { value: alturaBase + variacion }
        },
        vertexShader: `
            varying float vAltura;
            void main() {
                vAltura = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uNiebla;
            uniform float uBruma;
            uniform float uAltura;
            varying float vAltura;
            void main() {
                float abajo = 1.0 - smoothstep(-2.0, uAltura, vAltura);
                vec3 color = mix(uColor, uNiebla, clamp(uBruma + abajo * 0.45, 0.0, 1.0));
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });

    const malla = new THREE.Mesh(new THREE.ShapeGeometry(forma), material);
    malla.position.z = -distancia;
    escena.add(malla);
}

crearCordillera(330, 38, 14, 1.7, 0.6);
crearCordillera(240, 22, 10, 4.3, 0.36);
crearCordillera(165, 10, 7, 8.1, 0.16);

// =====================================================================
// 9. TERRENO (la colina)
// =====================================================================

const geometriaTerreno = new THREE.PlaneGeometry(420, 420, 260, 260);
geometriaTerreno.rotateX(-Math.PI / 2);
const verticesTerreno = geometriaTerreno.attributes.position;
for (let i = 0; i < verticesTerreno.count; i++) {
    verticesTerreno.setY(i, alturaTerreno(verticesTerreno.getX(i), verticesTerreno.getZ(i)));
}
geometriaTerreno.computeVertexNormals();

const materialTerreno = new THREE.ShaderMaterial({
    uniforms: comunes,
    vertexShader: `
        varying vec3 vMundo;
        varying vec3 vNormal;
        void main() {
            vec4 mundo = modelMatrix * vec4(position, 1.0);
            vMundo = mundo.xyz;
            vNormal = normal;
            gl_Position = projectionMatrix * viewMatrix * mundo;
        }
    `,
    fragmentShader: `
        uniform vec3 uNiebla;
        uniform vec3 uLuz;
        uniform vec3 uAmbiente;
        uniform vec3 uDirSol;
        uniform vec3 uVerdeBase;
        uniform vec3 uVerdePunta;
        uniform vec3 uAmarillo;
        varying vec3 vMundo;
        varying vec3 vNormal;
        ${ruidoGLSL}
        ${nieblaGLSL}
        void main() {
            float m = manchas(vMundo.xz);
            vec3 color = mix(mix(uVerdeBase, uVerdePunta, 0.35), mix(uVerdeBase, uAmarillo, 0.45), m * 0.7);
            color *= 0.6 + ruido(vMundo.xz * 0.7) * 0.2;
            float difusa = max(dot(normalize(vNormal), uDirSol), 0.0);
            color *= uAmbiente + uLuz * (0.35 + difusa * 0.65);
            color = aplicarNiebla(color, length(vMundo - cameraPosition));
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `
});

const terreno = new THREE.Mesh(geometriaTerreno, materialTerreno);
escena.add(terreno);

// =====================================================================
// 10. HIERBA
// Cada brizna es un plano estrecho. Con "instancing" se dibuja la
// misma brizna miles de veces y cada copia recibe su posición, giro,
// altura y anchura. El viento y el ratón se calculan en el shader.
// =====================================================================

const vertexHierba = `
    attribute vec3 aPosicion;
    attribute float aAngulo;
    attribute float aAlto;
    attribute float aAncho;
    attribute float aAzar;

    uniform float uTiempo;
    uniform vec2 uRaton;
    uniform float uFuerzaRaton;
    uniform vec2 uViento;
    uniform float uFuerzaViento;

    varying float vAlturaBrizna;
    varying float vAzar;
    varying float vMancha;
    varying float vRafaga;
    varying float vMata;
    varying vec3 vMundo;

    ${ruidoGLSL}

    void main() {
        float y = position.y;
        float ancho = aAncho * pow(1.0 - y, 0.75);
        vec3 local = vec3(position.x * ancho, y * aAlto, 0.0);
        local.z += (0.15 + aAzar * 0.45) * y * y * aAlto;

        float c = cos(aAngulo);
        float s = sin(aAngulo);
        vec3 mundo = aPosicion + vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);

        float curva = y * y;

        float rafaga = fbm(aPosicion.xz * 0.05 - uViento * uTiempo * 0.75);
        float ola = sin(dot(aPosicion.xz, uViento) * 0.32 - uTiempo * 2.0 + aAzar * 1.3);
        float viento = (0.12 + rafaga * rafaga * 1.3) * (0.6 + 0.4 * ola) * uFuerzaViento;
        mundo.xz += uViento * viento * curva * aAlto;
        mundo.y -= viento * viento * 0.22 * curva * aAlto;
        mundo.x += sin(uTiempo * 5.0 + aAzar * 25.0) * 0.012 * curva * uFuerzaViento;

        vec2 alejar = aPosicion.xz - uRaton;
        float distancia = length(alejar);
        float empuje = (1.0 - smoothstep(0.0, 2.4, distancia)) * uFuerzaRaton;
        mundo.xz += normalize(alejar + 0.0001) * empuje * curva * aAlto * 1.6;
        mundo.y -= empuje * curva * aAlto * 0.7;

        vAlturaBrizna = y;
        vAzar = aAzar;
        vMancha = manchas(aPosicion.xz) * smoothstep(3.0, 16.0, 12.0 - aPosicion.z);
        vRafaga = rafaga;
        vMata = ruido(aPosicion.xz * 0.9) * 0.6 + ruido(aPosicion.xz * 0.23 + 5.0) * 0.4;
        vMundo = mundo;

        gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
    }
`;

const fragmentHierba = `
    uniform vec3 uNiebla;
    uniform vec3 uLuz;
    uniform vec3 uAmbiente;
    uniform vec3 uDirSol;
    uniform vec3 uVerdeBase;
    uniform vec3 uVerdePunta;
    uniform vec3 uAmarillo;
    uniform float uTranslucidez;

    varying float vAlturaBrizna;
    varying float vAzar;
    varying float vMancha;
    varying float vRafaga;
    varying float vMata;
    varying vec3 vMundo;

    ${nieblaGLSL}

    void main() {
        vec3 punta = mix(uVerdePunta, uAmarillo, vMancha * 0.75);
        punta *= 0.62 + vAzar * 0.5;
        punta *= mix(0.55, 1.1, smoothstep(0.25, 0.75, vMata));
        punta = mix(punta, punta * vec3(0.85, 1.0, 0.92), step(0.7, vAzar));
        vec3 color = mix(uVerdeBase, punta, smoothstep(0.0, 0.95, vAlturaBrizna));
        color *= mix(0.28, 1.0, smoothstep(0.0, 0.6, vAlturaBrizna));

        color *= uAmbiente * 1.3 + uLuz * (0.32 + 0.55 * vAlturaBrizna);

        vec3 vista = normalize(vMundo - cameraPosition);
        float contraluz = pow(max(dot(vista, uDirSol), 0.0), 6.0);
        color += uLuz * punta * contraluz * uTranslucidez * vAlturaBrizna * vAlturaBrizna * 0.45;
        color *= 1.0 + vRafaga * 0.1;

        color = aplicarNiebla(color, length(vMundo - cameraPosition));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const materialHierba = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: comunes,
    vertexShader: vertexHierba,
    fragmentShader: fragmentHierba
});

function anchoVisible(z) {
    return 3 + (12 - z) * (movil ? 0.75 : 0.95);
}

function crearHierba(cantidad, segmentos, zCerca, zLejos, reparto, escalaLejos) {
    const brizna = new THREE.PlaneGeometry(1, 1, 1, segmentos);
    brizna.translate(0, 0.5, 0);

    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = brizna.index;
    geometria.setAttribute("position", brizna.attributes.position);
    geometria.setAttribute("uv", brizna.attributes.uv);

    const posiciones = new Float32Array(cantidad * 3);
    const angulos = new Float32Array(cantidad);
    const altos = new Float32Array(cantidad);
    const anchos = new Float32Array(cantidad);
    const azares = new Float32Array(cantidad);

    for (let i = 0; i < cantidad; i++) {
        const z = zCerca - Math.pow(azar(), reparto) * (zCerca - zLejos);
        const x = (azar() - 0.5) * 2 * Math.min(anchoVisible(z), 70);
        const distancia = 12 - z;
        const crecer = 1 + distancia * escalaLejos;

        posiciones[i * 3] = x;
        posiciones[i * 3 + 1] = alturaTerreno(x, z) - 0.03;
        posiciones[i * 3 + 2] = z;
        angulos[i] = azar() * Math.PI * 2;
        altos[i] = (0.35 + azar() * 0.5) * crecer;
        anchos[i] = (0.028 + azar() * 0.022) * crecer;
        azares[i] = azar();
    }

    geometria.setAttribute("aPosicion", new THREE.InstancedBufferAttribute(posiciones, 3));
    geometria.setAttribute("aAngulo", new THREE.InstancedBufferAttribute(angulos, 1));
    geometria.setAttribute("aAlto", new THREE.InstancedBufferAttribute(altos, 1));
    geometria.setAttribute("aAncho", new THREE.InstancedBufferAttribute(anchos, 1));
    geometria.setAttribute("aAzar", new THREE.InstancedBufferAttribute(azares, 1));
    geometria.instanceCount = cantidad;

    const malla = new THREE.Mesh(geometria, materialHierba);
    malla.frustumCulled = false;
    escena.add(malla);
    return geometria;
}

const hierbaCerca = crearHierba(ajustes.hierbaCerca, 5, 10.9, -12, 1.25, 0.02);
const hierbaLejos = crearHierba(ajustes.hierbaLejos, 2, -12, -64, 1.1, 0.03);

// =====================================================================
// 11. FLORES
// Cada flor es un cuadrado que siempre mira a la cámara. El dibujo de
// los pétalos se hace en el shader con matemáticas (sin imágenes).
// =====================================================================

const coloresFlor = ["#e0473f", "#e0473f", "#4a6fd8", "#f2c84b", "#f6f1e4", "#e6779e"].map((c) => new THREE.Color(c));

function crearFlores(cantidad) {
    const cuadro = new THREE.PlaneGeometry(1, 1);
    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = cuadro.index;
    geometria.setAttribute("position", cuadro.attributes.position);
    geometria.setAttribute("uv", cuadro.attributes.uv);

    const posiciones = new Float32Array(cantidad * 3);
    const altos = new Float32Array(cantidad);
    const tamanos = new Float32Array(cantidad);
    const colores = new Float32Array(cantidad * 3);
    const azares = new Float32Array(cantidad);

    let colocadas = 0;
    while (colocadas < cantidad) {
        const z = 9.5 - Math.pow(azar(), 1.1) * 38;
        const x = (azar() - 0.5) * 2 * anchoVisible(z);
        const grupo = Math.sin(x * 0.21 + 1.7) * Math.cos(z * 0.17 + 0.6);
        if (grupo < -0.1 && azar() > 0.15) continue;

        const distancia = 12 - z;
        const color = coloresFlor[Math.floor(azar() * coloresFlor.length)];
        posiciones[colocadas * 3] = x;
        posiciones[colocadas * 3 + 1] = alturaTerreno(x, z);
        posiciones[colocadas * 3 + 2] = z;
        altos[colocadas] = (0.45 + azar() * 0.4) * (1 + distancia * 0.02);
        tamanos[colocadas] = (0.07 + azar() * 0.04) * (1 + distancia * 0.035);
        colores[colocadas * 3] = color.r;
        colores[colocadas * 3 + 1] = color.g;
        colores[colocadas * 3 + 2] = color.b;
        azares[colocadas] = azar();
        colocadas++;
    }

    geometria.setAttribute("aPosicion", new THREE.InstancedBufferAttribute(posiciones, 3));
    geometria.setAttribute("aAlto", new THREE.InstancedBufferAttribute(altos, 1));
    geometria.setAttribute("aTamano", new THREE.InstancedBufferAttribute(tamanos, 1));
    geometria.setAttribute("aColor", new THREE.InstancedBufferAttribute(colores, 3));
    geometria.setAttribute("aAzar", new THREE.InstancedBufferAttribute(azares, 1));
    geometria.instanceCount = cantidad;

    const material = new THREE.ShaderMaterial({
        uniforms: comunes,
        vertexShader: `
            attribute vec3 aPosicion;
            attribute float aAlto;
            attribute float aTamano;
            attribute vec3 aColor;
            attribute float aAzar;

            uniform float uTiempo;
            uniform vec2 uRaton;
            uniform float uFuerzaRaton;
            uniform vec2 uViento;
            uniform float uFuerzaViento;

            varying vec2 vUv;
            varying vec3 vColor;
            varying vec3 vMundo;
            varying float vAzar;

            ${ruidoGLSL}

            void main() {
                vec3 centro = aPosicion + vec3(0.0, aAlto, 0.0);

                float rafaga = fbm(aPosicion.xz * 0.05 - uViento * uTiempo * 0.75);
                float ola = sin(dot(aPosicion.xz, uViento) * 0.32 - uTiempo * 2.0 + aAzar * 1.3);
                float viento = (0.12 + rafaga * rafaga * 1.3) * (0.6 + 0.4 * ola) * uFuerzaViento;
                centro.xz += uViento * viento * aAlto * 0.8;

                vec2 alejar = aPosicion.xz - uRaton;
                float empuje = (1.0 - smoothstep(0.0, 2.4, length(alejar))) * uFuerzaRaton;
                centro.xz += normalize(alejar + 0.0001) * empuje * aAlto * 1.1;
                centro.y -= empuje * aAlto * 0.45;

                vec3 derecha = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                vec3 arriba = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                vec3 mundo = centro + (derecha * position.x + arriba * position.y) * aTamano;

                vUv = uv;
                vColor = aColor;
                vMundo = mundo;
                vAzar = aAzar;
                gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uNiebla;
            uniform vec3 uLuz;
            uniform vec3 uAmbiente;

            varying vec2 vUv;
            varying vec3 vColor;
            varying vec3 vMundo;
            varying float vAzar;

            ${nieblaGLSL}

            void main() {
                vec2 p = vUv - 0.5;
                float r = length(p) * 2.0;
                float angulo = atan(p.y, p.x) + vAzar * 6.28;
                float borde = 0.62 + 0.38 * abs(cos(angulo * 2.5));
                if (r > borde) discard;

                vec3 color = mix(vColor, vColor * 0.7, smoothstep(0.2, borde, r));
                color = mix(vec3(0.98, 0.82, 0.3), color, smoothstep(0.16, 0.24, r));
                color *= uAmbiente + uLuz * 0.85;
                color = aplicarNiebla(color, length(vMundo - cameraPosition));
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });

    const malla = new THREE.Mesh(geometria, material);
    malla.frustumCulled = false;
    escena.add(malla);
}

crearFlores(ajustes.flores);

// =====================================================================
// 12. LUCIÉRNAGAS
// =====================================================================

function texturaBrillo() {
    const lienzo = document.createElement("canvas");
    lienzo.width = 64;
    lienzo.height = 64;
    const ctx = lienzo.getContext("2d");
    const degradado = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    degradado.addColorStop(0, "rgba(240, 255, 170, 1)");
    degradado.addColorStop(0.2, "rgba(220, 255, 120, 0.8)");
    degradado.addColorStop(1, "rgba(200, 255, 100, 0)");
    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(lienzo);
}

const luciernagas = [];
for (let i = 0; i < ajustes.luciernagas; i++) {
    const z = 10 - azar() * 34;
    const x = (azar() - 0.5) * 2 * anchoVisible(z) * 0.8;
    luciernagas.push({ x, z, y: alturaTerreno(x, z) + 0.3 + azar() * 1.4, fase: azar() * 6.28, velocidad: 0.5 + azar() * 0.8 });
}
const geometriaLuciernagas = new THREE.BufferGeometry();
geometriaLuciernagas.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(luciernagas.length * 3), 3));
const materialLuciernagas = new THREE.PointsMaterial({
    map: texturaBrillo(),
    size: 0.22,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
});
escena.add(new THREE.Points(geometriaLuciernagas, materialLuciernagas));

function moverLuciernagas(tiempo, brillo) {
    const posiciones = geometriaLuciernagas.attributes.position;
    luciernagas.forEach((l, i) => {
        const t = tiempo * l.velocidad + l.fase;
        posiciones.setXYZ(i, l.x + Math.sin(t * 0.5) * 1.3, l.y + Math.sin(t * 1.1) * 0.35, l.z + Math.cos(t * 0.4) * 1.3);
    });
    posiciones.needsUpdate = true;
    materialLuciernagas.opacity = brillo * (0.75 + Math.sin(tiempo * 3) * 0.25);
}

// =====================================================================
// 13. RATÓN Y DEDO
// Se lanza un rayo desde la cámara y se busca dónde corta la colina.
// =====================================================================

const rayo = new THREE.Raycaster();
const puntero = new THREE.Vector2();
const objetivoRaton = new THREE.Vector2(999, 999);
let punteroDentro = false;
let punteroMovido = false;
let paralaje = new THREE.Vector2();
const pista = document.getElementById("pista");

if (movil) pista.textContent = "Desliza el dedo por la hierba";

function cortarColina(origen, direccion) {
    const punto = new THREE.Vector3();
    for (let distancia = 0.3; distancia < 90; distancia += distancia < 10 ? 0.08 : 0.4) {
        punto.copy(direccion).multiplyScalar(distancia).add(origen);
        if (punto.y <= alturaTerreno(punto.x, punto.z) + 0.35) return punto;
    }
    return null;
}

function moverPuntero(evento) {
    puntero.x = (evento.clientX / window.innerWidth) * 2 - 1;
    puntero.y = -(evento.clientY / window.innerHeight) * 2 + 1;
    punteroDentro = true;
    punteroMovido = true;
    pista.classList.add("oculta");
}

renderizador.domElement.addEventListener("pointermove", moverPuntero);
renderizador.domElement.addEventListener("pointerdown", moverPuntero);
renderizador.domElement.addEventListener("pointerleave", () => (punteroDentro = false));
renderizador.domElement.addEventListener("pointerup", (evento) => {
    if (evento.pointerType === "touch") punteroDentro = false;
});

function actualizarRaton(delta) {
    if (punteroMovido) {
        rayo.setFromCamera(puntero, camara);
        const punto = cortarColina(rayo.ray.origin, rayo.ray.direction);
        if (punto) objetivoRaton.set(punto.x, punto.z);
        punteroMovido = false;
    }

    const actualRaton = comunes.uRaton.value;
    if (actualRaton.x > 900) actualRaton.copy(objetivoRaton);
    else actualRaton.lerp(objetivoRaton, Math.min(1, delta * 12));

    const fuerzaObjetivo = punteroDentro && objetivoRaton.x < 900 ? 1 : 0;
    comunes.uFuerzaRaton.value += (fuerzaObjetivo - comunes.uFuerzaRaton.value) * Math.min(1, delta * 4);

    const paralajeObjetivo = punteroDentro && !movil ? puntero : new THREE.Vector2();
    paralaje.lerp(paralajeObjetivo, Math.min(1, delta * 2));
    camara.position.set(baseCamara.x + paralaje.x * 0.5, baseCamara.y + paralaje.y * 0.12, baseCamara.z);
    camara.lookAt(objetivoCamara);
}

// =====================================================================
// 14. CAMBIO DE MOMENTO (botones)
// =====================================================================

const botones = document.querySelectorAll("#momentos button");
// Con ?momento=noche (o manana) en la dirección se empieza en ese momento
const momentoPedido = new URLSearchParams(location.search).get("momento");
const momentoInicial = momentos[momentoPedido] ? momentoPedido : "atardecer";
const momentoDesde = prepararMomento({ ...Object.fromEntries(nombresColor.map((n) => [n, "#000000"])), dirSol: [0, 1, 0], dirDisco: [0, 1, 0], nubes: 0, intensidad: 0, translucidez: 0, noche: 0, solVisible: 0, alturaLuna: 0 });
let momentoHasta = momentos[momentoInicial];
let progreso = 1;

copiarMomento(momentoDesde, momentoHasta);
copiarMomento(actual, momentoHasta);
botones.forEach((b) => b.classList.toggle("activo", b.dataset.momento === momentoInicial));

function cambiarMomento(nombre) {
    copiarMomento(momentoDesde, actual);
    momentoHasta = momentos[nombre];
    progreso = 0;
    botones.forEach((b) => b.classList.toggle("activo", b.dataset.momento === nombre));
}

botones.forEach((boton) => boton.addEventListener("click", () => cambiarMomento(boton.dataset.momento)));

function suavizar(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function aplicarMomento() {
    comunes.uLuz.value.copy(actual.luz).multiplyScalar(actual.intensidad);
    comunes.uTranslucidez.value = actual.translucidez;

    const u = materialCielo.uniforms;
    u.uNubes.value = actual.nubes;
    u.uSolVisible.value = actual.solVisible;
    u.uLunaVisible.value = actual.noche;
    u.uDirLuna.value.set(pantallaEstrecha ? -0.21 : -0.38, actual.alturaLuna, -0.87).normalize();

    materialEstrellas.opacity = Math.max(0, actual.noche * 1.25 - 0.25);
    renderizador.toneMappingExposure = 1.05 + actual.noche * 0.25;
}

// =====================================================================
// 15. RENDIMIENTO
// Si los primeros segundos van lentos, se quita hierba.
// =====================================================================

let fotogramas = 0;
let tiempoMedido = 0;
let calidadRevisada = false;

function revisarCalidad(delta) {
    if (calidadRevisada) return;
    fotogramas++;
    tiempoMedido += delta;
    if (fotogramas < 90) return;

    const fps = fotogramas / tiempoMedido;
    if (fps < 40) {
        hierbaCerca.instanceCount = Math.floor(hierbaCerca.instanceCount * 0.6);
        hierbaLejos.instanceCount = Math.floor(hierbaLejos.instanceCount * 0.55);
        renderizador.setPixelRatio(1);
    }
    calidadRevisada = true;
}

// =====================================================================
// 16. TAMAÑO DE LA VENTANA
// =====================================================================

window.addEventListener("resize", () => {
    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();
    renderizador.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
// 17. BUCLE PRINCIPAL
// =====================================================================

const reloj = new THREE.Clock();
let tiempo = 0;
let primerFotograma = true;

function animar() {
    requestAnimationFrame(animar);
    const delta = Math.min(reloj.getDelta(), 0.1);

    if (!movimientoReducido) tiempo += delta;
    comunes.uTiempo.value = tiempo;

    if (progreso < 1) {
        progreso = Math.min(1, progreso + delta / 2.2);
        mezclarMomentos(actual, momentoDesde, momentoHasta, suavizar(progreso));
    }
    aplicarMomento();

    actualizarRaton(delta);
    if (actual.noche > 0.02) moverLuciernagas(tiempo, actual.noche);
    else materialLuciernagas.opacity = 0;

    renderizador.render(escena, camara);
    revisarCalidad(delta);

    if (primerFotograma) {
        primerFotograma = false;
        document.getElementById("cargando").classList.add("oculta");
    }
}

animar();
