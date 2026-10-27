// =====================================================================
// MEDIDOR DE RENDIMIENTO (solo con ?medir=si)
// Enseña cuánto tarda cada fotograma en la GPU y en el procesador, y en
// qué se va ese tiempo. A 60 FPS cada fotograma tiene 16,7 ms
// =====================================================================

// opciones.compositor: para saber qué pasada se está dibujando
// opciones.nombres: Map de objeto o material -> nombre que sale en el panel
// opciones.pases: nombres de las pasadas por su clase (RenderPass...)
// opciones.extra: función que devuelve una línea más para el panel
export function crearMedidor(renderizador, opciones = {}) {
    const { compositor, nombres = new Map(), pases = {}, extra = () => "" } = opciones;
    const gl = renderizador.getContext();
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const tarjeta = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    renderizador.info.autoReset = false;

    // -----------------------------------------------------------------
    // Panel
    // -----------------------------------------------------------------
    const panel = document.createElement("div");
    panel.className = "medidor";
    Object.assign(panel.style, {
        position: "fixed",
        right: "8px",
        top: "64px",
        zIndex: 99999,
        padding: "8px 10px",
        background: "rgba(0,0,0,0.72)",
        color: "#e8f0e0",
        font: "12px/1.45 ui-monospace, Consolas, monospace",
        whiteSpace: "pre",
        borderRadius: "6px",
        pointerEvents: "none",
    });
    document.body.appendChild(panel);
    // Si la escena se para (por ejemplo con el camino abierto encima) el
    // panel se esconde para no tapar el otro
    setInterval(() => (panel.style.display = performance.now() - ultimo > 2500 ? "none" : ""), 500);

    // -----------------------------------------------------------------
    // Tiempos de la GPU por partes
    // Solo puede haber una consulta abierta a la vez: cada vez que cambia
    // lo que se dibuja se cierra la anterior y se abre otra con su nombre
    // -----------------------------------------------------------------
    const libres = [];
    const pendientes = [];
    let abierta = null;
    let enPase = "";
    let enEscena = true;
    let cuadroActual = [];

    function cambiar(nombre) {
        if (!ext) return;
        if (abierta && abierta.nombre === nombre) return;
        if (abierta) {
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            cuadroActual.push(abierta);
            abierta = null;
        }
        if (!nombre) return;
        const q = libres.pop() || gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        abierta = { q, nombre };
    }

    function nombreDe(objeto, material) {
        if (material && (material.isMeshDepthMaterial || material.isMeshDistanceMaterial)) return "sombras";
        if (material && objeto && (material === objeto.customDepthMaterial || material === objeto.customDistanceMaterial)) return "sombras";
        let nombre = nombres.get(material);
        for (let o = objeto; o && !nombre; o = o.parent) nombre = nombres.get(o) || o.userData.medidor;
        if (!nombre) return enEscena && opciones.detallar ? "? " + (material?.name || objeto?.name || material?.type || "") + "#" + material?.id : enPase;
        // Si se vuelve a dibujar dentro de otra pasada (el brillo pinta
        // otra vez lo que brilla) se apunta a parte
        return enEscena ? nombre : nombre + " (" + enPase + ")";
    }

    if (ext) {
        const dibujar = renderizador.renderBufferDirect.bind(renderizador);
        renderizador.renderBufferDirect = (camara, escena, geometria, material, objeto, grupo) => {
            cambiar(nombreDe(objeto, material));
            dibujar(camara, escena, geometria, material, objeto, grupo);
        };
        const vaciar = renderizador.clear.bind(renderizador);
        renderizador.clear = (...a) => {
            cambiar(enPase);
            vaciar(...a);
        };
        if (compositor) {
            compositor.passes.forEach((pase) => {
                const clase = pase.constructor.name;
                const nombre = pase.nombreMedidor || pases[clase] || clase;
                const pintar = pase.render.bind(pase);
                pase.render = (...a) => {
                    enPase = nombre;
                    enEscena = clase === "RenderPass";
                    cambiar(nombre);
                    pintar(...a);
                };
            });
        }
    }

    // -----------------------------------------------------------------
    // Fotogramas
    // -----------------------------------------------------------------
    const cuadros = [];
    const cpu = [];
    const totales = [];
    const partes = new Map();
    let gpuCuadros = 0;
    let inicioCpu = 0;
    let ultimo = performance.now();
    let ultimoPanel = 0;

    function inicio() {
        renderizador.info.reset();
        inicioCpu = performance.now();
        enPase = "escena";
        enEscena = true;
    }

    function fin() {
        const ahora = performance.now();
        cpu.push(ahora - inicioCpu);
        cuadros.push(ahora - ultimo);
        ultimo = ahora;
        cambiar(null);
        if (cuadroActual.length) pendientes.push(cuadroActual);
        cuadroActual = [];
        leerGpu();
        if (ahora - ultimoPanel > 1000) pintar(ahora);
    }

    function leerGpu() {
        if (!ext) return;
        const descartar = gl.getParameter(ext.GPU_DISJOINT_EXT);
        while (pendientes.length) {
            const cuadro = pendientes[0];
            if (!gl.getQueryParameter(cuadro[cuadro.length - 1].q, gl.QUERY_RESULT_AVAILABLE)) break;
            pendientes.shift();
            let total = 0;
            cuadro.forEach(({ q, nombre }) => {
                if (!descartar) {
                    const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
                    total += ms;
                    partes.set(nombre, (partes.get(nombre) || 0) + ms);
                }
                libres.push(q);
            });
            if (!descartar) {
                totales.push(total);
                gpuCuadros++;
            }
        }
    }

    function media(lista) {
        return lista.reduce((a, b) => a + b, 0) / Math.max(1, lista.length);
    }

    function p95(lista) {
        const orden = [...lista].sort((a, b) => a - b);
        return orden[Math.floor(orden.length * 0.95)] || 0;
    }

    function pintar(ahora) {
        ultimoPanel = ahora;
        const fps = 1000 / media(cuadros);
        const msGpu = media(totales);
        const msCpu = media(cpu);
        const lineas = [
            Math.round(fps) + " FPS   (peor 5%: " + p95(cuadros).toFixed(1) + " ms)",
            "GPU  " + (ext ? (gpuCuadros ? msGpu.toFixed(2) + " ms" : "...") : "no disponible en este navegador"),
            "CPU  " + msCpu.toFixed(2) + " ms",
        ];
        if (ext && gpuCuadros) {
            const margen = 16.7 - Math.max(msGpu, msCpu);
            lineas.push("margen a 60 FPS: " + (margen > 0 ? margen.toFixed(1) + " ms (" + Math.round((margen / 16.7) * 100) + "%)" : "ninguno"));
            lineas.push("", "en qué se va la GPU:");
            [...partes.entries()]
                .map(([nombre, ms]) => [nombre, ms / gpuCuadros])
                .sort((a, b) => b[1] - a[1])
                .filter(([, ms]) => ms >= 0.05)
                .slice(0, 16)
                .forEach(([nombre, ms]) => lineas.push("  " + nombre.slice(0, 26).padEnd(26, " ") + ms.toFixed(2).padStart(6, " ") + " ms  " + String(Math.round((ms / msGpu) * 100)).padStart(3, " ") + "%"));
            lineas.push("");
        }
        lineas.push(
            "dibujos " + renderizador.info.render.calls + " · triángulos " + Math.round(renderizador.info.render.triangles / 1000) + "k",
            "resolución x" + renderizador.getPixelRatio().toFixed(2) + " · " + innerWidth + "×" + innerHeight,
        );
        const mas = extra();
        if (mas) lineas.push(mas);
        lineas.push(tarjeta.slice(0, 58));
        panel.textContent = lineas.join("\n");
        cuadros.length = 0;
        cpu.length = 0;
        totales.length = 0;
        partes.clear();
        gpuCuadros = 0;
    }

    return { inicio, fin };
}
