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

const observadorSecciones = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
            enlacesMenu.forEach((enlace) => {
                enlace.classList.toggle("activo", enlace.getAttribute("href") === "#" + entrada.target.id);
            });
        }
    });
}, { rootMargin: "-40% 0px -55% 0px" });

secciones.forEach((seccion) => observadorSecciones.observe(seccion));
