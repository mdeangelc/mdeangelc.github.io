// Modo oscuro
const botonTema = document.getElementById("boton-tema");
const raiz = document.documentElement;

function actualizarTextoBoton() {
    if (raiz.classList.contains("oscuro")) {
        botonTema.textContent = "Modo claro";
    } else {
        botonTema.textContent = "Modo oscuro";
    }
}

botonTema.addEventListener("click", () => {
    raiz.classList.toggle("oscuro");

    if (raiz.classList.contains("oscuro")) {
        localStorage.setItem("tema", "oscuro");
    } else {
        localStorage.setItem("tema", "claro");
    }

    actualizarTextoBoton();
});

actualizarTextoBoton();

// Animación al hacer scroll
const bloques = document.querySelectorAll(".aparecer");

const observadorBloques = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
            entrada.target.classList.add("visible");
            observadorBloques.unobserve(entrada.target);
        }
    });
}, { threshold: 0.15 });

bloques.forEach((bloque) => observadorBloques.observe(bloque));

// Marcar en el menú la sección actual
const enlacesMenu = document.querySelectorAll(".menu-enlaces a");
const secciones = document.querySelectorAll("main section");

let porClic = false;

function activar(id) {
    enlacesMenu.forEach((enlace) => {
        enlace.classList.toggle("activo", enlace.getAttribute("href") === "#" + id);
    });
}

enlacesMenu.forEach((enlace) => {
    enlace.addEventListener("click", () => {
        porClic = true;
        activar(enlace.getAttribute("href").slice(1));
    });
});

["wheel", "touchstart", "keydown"].forEach((evento) => {
    window.addEventListener(evento, () => {
        porClic = false;
    });
});

function marcarSeccion() {
    if (porClic) {
        return;
    }

    let actual = "";

    secciones.forEach((seccion) => {
        if (seccion.getBoundingClientRect().top <= window.innerHeight * 0.4) {
            actual = seccion.id;
        }
    });

    const alFinal = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    if (alFinal) {
        actual = secciones[secciones.length - 1].id;
    }

    activar(actual);
}

window.addEventListener("scroll", marcarSeccion);
marcarSeccion();
