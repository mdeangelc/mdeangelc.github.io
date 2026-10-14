// =====================================================================
// MEDIDOR DE RENDIMIENTO (solo con ?medir=si)
// Enseña cuánto tarda cada fotograma en la GPU y en el procesador para
// saber cuánto margen queda. A 60 FPS cada fotograma tiene 16,7 ms
// =====================================================================

export function crearMedidor(renderizador, extra = () => "") {
    const gl = renderizador.getContext();
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const tarjeta = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    renderizador.info.autoReset = false;

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

    // Consultas de tiempo de la GPU: llegan con unos fotogramas de retraso
    const libres = [];
    const pendientes = [];
    let midiendo = null;

    const cuadros = [];
    const gpu = [];
    const cpu = [];
    let inicioCpu = 0;
    let ultimo = performance.now();
    let ultimoPanel = 0;

    function inicio() {
        renderizador.info.reset();
        inicioCpu = performance.now();
        if (ext && !midiendo) {
            midiendo = libres.pop() || gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, midiendo);
        }
    }

    function fin() {
        const ahora = performance.now();
        cpu.push(ahora - inicioCpu);
        cuadros.push(ahora - ultimo);
        ultimo = ahora;
        if (ext && midiendo) {
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            pendientes.push(midiendo);
            midiendo = null;
        }
        leerGpu();
        if (ahora - ultimoPanel > 500) pintar(ahora);
    }

    function leerGpu() {
        if (!ext) return;
        const descartar = gl.getParameter(ext.GPU_DISJOINT_EXT);
        while (pendientes.length && gl.getQueryParameter(pendientes[0], gl.QUERY_RESULT_AVAILABLE)) {
            const q = pendientes.shift();
            if (!descartar) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            libres.push(q);
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
        const msGpu = media(gpu);
        const msCpu = media(cpu);
        const lineas = [
            Math.round(fps) + " FPS   (peor 5%: " + p95(cuadros).toFixed(1) + " ms)",
            "GPU  " + (ext ? (gpu.length ? msGpu.toFixed(2) + " ms" : "...") : "no disponible en este navegador"),
            "CPU  " + msCpu.toFixed(2) + " ms",
        ];
        if (ext && gpu.length) {
            const margen = 16.7 - Math.max(msGpu, msCpu);
            lineas.push("margen a 60 FPS: " + (margen > 0 ? margen.toFixed(1) + " ms (" + Math.round((margen / 16.7) * 100) + "%)" : "ninguno"));
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
        gpu.length = 0;
        cpu.length = 0;
    }

    return { inicio, fin };
}
