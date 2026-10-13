import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// =====================================================================
// CINE: PIEZAS COMUNES CON GARGANTUA
// Lo mismo que se ve en la página de Gargantua, preparado para meterlo
// en otras escenas: la textura de ruido, el agujero negro con su disco,
// sus arcos y su anillo, un resplandor que sale de lo más brillante de
// la imagen, el acabado de cine y el zumbido grave.
// =====================================================================


// ---------------------------------------------------------------------
// Ruido suave que se repite, hecho una vez al cargar
// ---------------------------------------------------------------------

export function texturaRuido() {
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


// ---------------------------------------------------------------------
// Cielo de estrellas con lente
// Estrellas en una rejilla sobre las caras de un cubo y una nebulosa
// muy tenue. Alrededor de "centro" (donde está Gargantua) la luz se
// dobla: las estrellas se estiran y aparecen repetidas al otro lado.
// uRadioLente y uAparece se cambian desde fuera.
// ---------------------------------------------------------------------

export function crearCielo({ tRuido, uTiempo, centro, radio = 200 }) {
    const cielo = new THREE.Mesh(
        new THREE.SphereGeometry(radio, 48, 24),
        new THREE.ShaderMaterial({
            uniforms: {
                uTiempo,
                tRuido,
                uAgujero: { value: centro },
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
                    // Derivadas antes de salir y acotadas: en el cambio de cara del cubo
                    // saltan y harían líneas de estrellas gordas
                    float px = min(length(fwidth(uv)) * 0.75, tam * 3.0);
                    vec3 h = hash33(vec3(celda, cara * 17.0 + semilla));
                    if (h.x > densidad) return vec3(0.0);
                    vec2 centro = celda + 0.3 + h.yz * 0.4;
                    float dist = length(uv - centro);
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
    cielo.renderOrder = -1;
    cielo.frustumCulled = false;
    return cielo;
}


// ---------------------------------------------------------------------
// El gas del disco
// ---------------------------------------------------------------------

export const gasGlsl = `
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
        for (int i = 0; i < 6; i++) {
            float ri = 1.6 + float(i) * 0.5;
            float ai = uTiempo * 1.5 * pow(ri / DENTRO, -1.5) + float(i) * 2.3;
            float da = atan(sin(phi - ai), cos(phi - ai)) * ri;
            m += exp(-pow(da / (0.35 + float(i) * 0.12), 2.0) - pow((r - ri) / 0.1, 2.0)) * (0.6 + 0.4 * sin(uTiempo * 2.0 + float(i)));
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
        float haz = mix(1.0, pow(doppler, 3.0), 0.8);
        float brillo = temperatura * 2.0 * haz * (1.0 + 0.12 * sin(uTiempo * 1.3 + r * 2.5)) * (0.72 + 0.56 * rizo);
        col *= brillo * (1.0 - polvo * 0.85) * (1.0 + manchas * 1.5);
        col = mix(col, col * vec3(1.1, 0.8, 0.62), smoothstep(1.0, 0.6, doppler) * 0.6);
        col = mix(col, col * vec3(0.95, 1.0, 1.1) + 0.06, smoothstep(1.0, 1.45, doppler) * 0.5);
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


// ---------------------------------------------------------------------
// Gargantua
// Devuelve un grupo que se puede poner y escalar donde se quiera. El
// disco y los arcos se giran para que siempre se vea como Gargantua
// desde la cámara. Los halos suman luz sin tapar lo de detrás, así que
// también sirve para pintarlo en una textura transparente.
// ---------------------------------------------------------------------

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

export function crearGargantua({ tRuido, brillar = (o) => o }) {
    const comunes = {
        uTiempo: { value: 0 },
        uVista: { value: new THREE.Vector3(0, 0, 1) },
        uPulso: { value: 0 },
        uOnda: { value: 9 },
        uEncendido: { value: 1 }
    };

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

    const grupo = new THREE.Group();
    const agujero = new THREE.Group();
    agujero.rotation.order = "YXZ";
    grupo.add(agujero);

    const sombra = brillar(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    agujero.add(sombra);

    [[0.06, 1, 0], [0.16, 0.3, 0.37], [0.28, 0.14, 0.71]].forEach(([grosor, fuerza, desfase], i) => {
        const capa = brillar(new THREE.Mesh(discoConVolumen(grosor), materialDisco(fuerza, desfase)));
        capa.renderOrder = 3 + i;
        agujero.add(capa);
    });

    const arcos = new THREE.Group();
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
    grupo.add(arcos);

    const mapaHalo = texturaHalo();
    const halos = [[10, 0.16, [1, 0.5, 0.22]], [3.8, 0.28, [1, 0.72, 0.45]]].map(([tam, fuerza, c]) => {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: mapaHalo,
            color: new THREE.Color(...c),
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
            opacity: fuerza
        }));
        halo.scale.setScalar(tam);
        halo.renderOrder = 10;
        halo.userData.fuerza = fuerza;
        agujero.add(halo);
        return halo;
    });

    const centro = new THREE.Vector3();
    const aux = new THREE.Vector3();
    const inversa = new THREE.Matrix4();

    // Gira el disco y los arcos hacia la cámara. Con "seguir" menor que
    // 1 el disco gira un poco menos que la cámara y se nota algo de
    // perspectiva; los arcos y el anillo siempre miran del todo.
    function orientar(camara, seguir = 1, base = { giro: 0, altura: 0 }) {
        grupo.updateMatrixWorld();
        grupo.getWorldPosition(centro);
        aux.copy(camara.position);
        inversa.copy(grupo.matrixWorld).invert();
        aux.applyMatrix4(inversa);
        const giro = Math.atan2(aux.x, aux.z);
        const elevacion = Math.atan2(aux.y, Math.hypot(aux.x, aux.z));
        const g = base.giro + (giro - base.giro) * seguir;
        const e = base.altura + (elevacion - base.altura) * seguir;
        agujero.rotation.set(-(e - 0.2), g, -0.4);
        arcos.rotation.set(-(elevacion - 0.2), giro, -0.4);
        grupo.updateMatrixWorld();
        aux.copy(camara.position);
        agujero.worldToLocal(aux);
        comunes.uVista.value.copy(aux).normalize();
    }

    // Tocarlo: el gas se enciende, una onda cae hacia dentro y el anillo
    // brilla más
    function despertar() {
        comunes.uPulso.value = 1;
        comunes.uOnda.value = 5.2;
    }

    function actualizar(delta, t) {
        comunes.uTiempo.value = t;
        const pulso = (comunes.uPulso.value *= Math.exp(-delta * 1.1));
        comunes.uOnda.value = Math.max(0.6, comunes.uOnda.value - delta * 2.6);
        const encendido = comunes.uEncendido.value;
        const luzAnillo = THREE.MathUtils.smoothstep(encendido, 0.6, 1);
        anillo.material.color.setRGB(1, 0.88, 0.7).multiplyScalar((2.4 + Math.sin(t * 2.2) * 0.4 + pulso * 3) * luzAnillo);
        anillo2.material.color.setRGB(1, 0.8, 0.6).multiplyScalar(0.45 * luzAnillo);
        halos.forEach((h, i) => (h.material.opacity = h.userData.fuerza * encendido * (0.85 + 0.15 * Math.sin(t * (1.1 + i * 0.7)) + pulso * 0.8)));
    }

    return { grupo, sombra, comunes, orientar, despertar, actualizar };
}


// ---------------------------------------------------------------------
// Resplandor desde la imagen
// Toma lo más brillante de la imagen ya pintada, lo difumina a la
// mitad, a un cuarto y a un octavo de tamaño y lo suma. Además estira
// en horizontal lo más fuerte de todo, como el destello de una lente.
// ---------------------------------------------------------------------

const VERTICE_PLANO = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

export class PaseBrillo extends Pass {
    constructor({ flotantes = true, escala = 2, umbral = 1.0, umbralRaya = 3.0, fuerza = 0.55, raya = 0.22 } = {}) {
        super();
        this.escala = escala;
        this.umbral = umbral;
        this.umbralRaya = umbralRaya;
        const op = { type: flotantes ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false };
        this.niveles = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)]);
        this.raya = [new THREE.WebGLRenderTarget(1, 1, op), new THREE.WebGLRenderTarget(1, 1, op)];
        this.difuminar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null }, uDir: { value: new THREE.Vector2() } },
            vertexShader: VERTICE_PLANO,
            depthTest: false,
            depthWrite: false,
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
            uniforms: { tEntrada: { value: null }, uUmbral: { value: umbral }, uPaso: { value: new THREE.Vector2() } },
            vertexShader: VERTICE_PLANO,
            depthTest: false,
            depthWrite: false,
            fragmentShader: `
                uniform sampler2D tEntrada;
                uniform float uUmbral;
                uniform vec2 uPaso;
                varying vec2 vUv;
                void main() {
                    vec3 c = texture2D(tEntrada, vUv + uPaso * vec2(-0.5, -0.5)).rgb + texture2D(tEntrada, vUv + uPaso * vec2(0.5, -0.5)).rgb
                           + texture2D(tEntrada, vUv + uPaso * vec2(-0.5, 0.5)).rgb + texture2D(tEntrada, vUv + uPaso * vec2(0.5, 0.5)).rgb;
                    c *= 0.25;
                    c = (c.r < 1000.0 && c.g < 1000.0 && c.b < 1000.0) ? c : vec3(0.0);
                    float l = max(c.r, max(c.g, c.b));
                    gl_FragColor = vec4(c * max(l - uUmbral, 0.0) / max(l, 0.0001), 1.0);
                }
            `
        });
        this.copiar = new THREE.ShaderMaterial({
            uniforms: { tEntrada: { value: null } },
            vertexShader: VERTICE_PLANO,
            depthTest: false,
            depthWrite: false,
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
                uRaya: { value: raya },
                uFuerza: { value: fuerza }
            },
            vertexShader: VERTICE_PLANO,
            depthTest: false,
            depthWrite: false,
            fragmentShader: `
                uniform sampler2D tBase;
                uniform sampler2D tN0;
                uniform sampler2D tN1;
                uniform sampler2D tN2;
                uniform sampler2D tRaya;
                uniform float uRaya;
                uniform float uFuerza;
                varying vec2 vUv;
                void main() {
                    vec4 base = texture2D(tBase, vUv);
                    vec3 brillo = texture2D(tN0, vUv).rgb * 0.22 + texture2D(tN1, vUv).rgb * 0.42 + texture2D(tN2, vUv).rgb * 0.75;
                    brillo += texture2D(tRaya, vUv).rgb * vec3(0.8, 0.88, 1.0) * uRaya;
                    gl_FragColor = vec4(base.rgb + brillo * uFuerza, base.a);
                }
            `
        });
        this.cuadro = new FullScreenQuad();
    }

    setSize(ancho, alto) {
        const m = Math.max(1, Math.round(ancho / this.escala));
        const n = Math.max(1, Math.round(alto / this.escala));
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
        const [n0, n1, n2] = this.niveles;
        const r = this.recortar.uniforms;
        r.tEntrada.value = origen.texture;
        r.uPaso.value.set(1 / origen.width, 1 / origen.height);
        r.uUmbral.value = this.umbral;
        this.pasada(renderizador, this.recortar, n0[0]);
        this.difumina(renderizador, n0, 1.0);
        this.copiar.uniforms.tEntrada.value = n0[0].texture;
        this.pasada(renderizador, this.copiar, n1[0]);
        this.difumina(renderizador, n1, 1.4);
        this.copiar.uniforms.tEntrada.value = n1[0].texture;
        this.pasada(renderizador, this.copiar, n2[0]);
        this.difumina(renderizador, n2, 1.6);
        this.difumina(renderizador, n2, 3.0);

        // El destello horizontal solo se calcula si tiene fuerza
        const [ra, rb] = this.raya;
        if (this.mezclar.uniforms.uRaya.value > 0) {
            r.uUmbral.value = this.umbralRaya;
            r.tEntrada.value = n0[0].texture;
            r.uPaso.value.set(0, 0);
            this.pasada(renderizador, this.recortar, ra);
            const d = this.difuminar.uniforms;
            [[ra, rb, 2], [rb, ra, 4.5], [ra, rb, 10], [rb, ra, 22]].forEach(([desde, hacia, escala]) => {
                d.tEntrada.value = desde.texture;
                d.uDir.value.set(escala / desde.width, 0);
                this.pasada(renderizador, this.difuminar, hacia);
            });
        }

        const u = this.mezclar.uniforms;
        u.tBase.value = origen.texture;
        u.tN0.value = n0[0].texture;
        u.tN1.value = n1[0].texture;
        u.tN2.value = n2[0].texture;
        u.tRaya.value = ra.texture;
        this.pasada(renderizador, this.mezclar, this.renderToScreen ? null : destino);
    }
}


// ---------------------------------------------------------------------
// Acabado de cine
// Un poco más de contraste, los colores que se separan muy poco hacia
// los bordes, un oscurecido suave en las esquinas y un grano muy fino.
// Va después de la salida de color.
// ---------------------------------------------------------------------

export function crearAcabado(uTiempo) {
    return new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uTiempo },
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
                vec3 g3 = fract(vec3(gl_FragCoord.xyx + fract(uTiempo * 7.0) * 61.0) * 0.1031); g3 += dot(g3, g3.yzx + 33.33); float grano = fract((g3.x + g3.y) * g3.z);
                c.rgb += (grano - 0.5) / 255.0 * 1.5;
                gl_FragColor = c;
            }
        `
    });
}


// ---------------------------------------------------------------------
// Zumbido grave como de órgano, con eco. Solo suena tras pulsar.
// ---------------------------------------------------------------------

function impulsoEco(ctx, segundos) {
    const largo = Math.floor(ctx.sampleRate * segundos);
    const buffer = ctx.createBuffer(2, largo, ctx.sampleRate);
    for (let canal = 0; canal < 2; canal++) {
        const datos = buffer.getChannelData(canal);
        for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / largo, 2.6);
    }
    return buffer;
}

export function crearZumbido() {
    const estado = { ctx: null, activo: false, maestro: null, filtro: null };

    function crear() {
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
        Object.assign(estado, { ctx, maestro, filtro });
    }

    function alternar() {
        if (!estado.ctx) crear();
        estado.activo = !estado.activo;
        estado.ctx.resume();
        estado.maestro.gain.setTargetAtTime(estado.activo ? 0.22 : 0, estado.ctx.currentTime, 0.8);
        return estado.activo;
    }

    function despertar() {
        if (!estado.activo) return;
        const ahora = estado.ctx.currentTime;
        const f = estado.filtro.frequency;
        f.cancelScheduledValues(ahora);
        f.setTargetAtTime(1700, ahora, 0.08);
        f.setTargetAtTime(520, ahora + 0.7, 1.3);
        const g = estado.maestro.gain;
        g.cancelScheduledValues(ahora);
        g.setTargetAtTime(0.36, ahora, 0.1);
        g.setTargetAtTime(0.22, ahora + 0.8, 1.5);
    }

    document.addEventListener("visibilitychange", () => {
        if (!estado.ctx || !estado.activo) return;
        if (document.hidden) estado.ctx.suspend();
        else estado.ctx.resume();
    });

    return { alternar, despertar, estado };
}
