import { Fragment, jsx } from "preact/jsx-runtime";

// Visualizador de imagens da página Galeria. Usa delegação de eventos no document,
// então funciona após qualquer navegação SPA sem precisar ser reiniciado.
const inline = `
(function () {
  var box = null, img = null, cap = null, count = null, list = [], idx = 0, lastFocus = null;

  function build() {
    box = document.createElement("div");
    box.className = "galeria-viewer";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Visualizador de imagens");
    box.hidden = true;
    box.innerHTML =
      '<button type="button" class="gv-btn gv-close" aria-label="Fechar">&times;</button>' +
      '<button type="button" class="gv-btn gv-prev" aria-label="Anterior">&#8249;</button>' +
      '<button type="button" class="gv-btn gv-next" aria-label="Próxima">&#8250;</button>' +
      '<figure class="gv-fig"><img class="gv-img" alt=""><figcaption class="gv-cap"></figcaption></figure>';
    document.body.appendChild(box);
    img = box.querySelector(".gv-img");
    cap = box.querySelector(".gv-cap");
    box.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest(".gv-close") || t === box || t.classList.contains("gv-fig")) close();
      else if (t.closest(".gv-prev")) step(-1);
      else if (t.closest(".gv-next")) step(1);
    });
    var x0 = null;
    box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    });
  }

  function show(i) {
    idx = (i + list.length) % list.length;
    var a = list[idx];
    img.src = a.href;
    img.alt = (a.querySelector("img") || {}).alt || "";
    cap.textContent = (a.dataset.caption || "") + "  ·  " + (idx + 1) + "/" + list.length;
    box.classList.toggle("gv-single", list.length < 2);
    // pré-carrega a vizinha
    if (list.length > 1) { var n = new Image(); n.src = list[(idx + 1) % list.length].href; }
  }

  function open(a) {
    if (!box) build();
    var grid = a.closest(".galeria-grid");
    list = Array.prototype.slice.call(document.querySelectorAll(".galeria-item"));
    lastFocus = a;
    box.hidden = false;
    document.documentElement.classList.add("galeria-aberta");
    show(list.indexOf(a));
    box.querySelector(".gv-close").focus();
  }

  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    img.removeAttribute("src");
    document.documentElement.classList.remove("galeria-aberta");
    if (lastFocus) lastFocus.focus();
  }

  function step(d) { if (list.length > 1) show(idx + d); }

  // Fase de captura na window: roda antes do roteador SPA do Quartz e do navegador,
  // então a imagem nunca abre numa página/aba própria.
  window.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.galeria-item");
    if (!a || e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    open(a);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (!box || box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  // ao trocar de página com o visualizador aberto, fecha
  document.addEventListener("nav", close);

  // Explorador: na primeira visita (por navegador), abre todas as pastas.
  // Depois disso o estado aberto/fechado escolhido pela pessoa é respeitado.
  function expandAll(tries) {
    var icons = document.querySelectorAll(".explorer .folder-icon.is-collapsed");
    if (icons.length) {
      icons.forEach(function (i) { i.click(); });
      try { localStorage.setItem("galeria-explorer-aberto", "1"); } catch (e) {}
    } else if (tries > 0) {
      setTimeout(function () { expandAll(tries - 1); }, 150);
    }
  }
  document.addEventListener("nav", function () {
    try { if (localStorage.getItem("galeria-explorer-aberto")) return; } catch (e) { return; }
    expandAll(20);
  });
})();
`;

// Botão da galeria (ao lado da busca) + script do visualizador.
const ICON = jsx("svg", {
  xmlns: "http://www.w3.org/2000/svg", width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
  "aria-hidden": "true",
  children: [
    jsx("rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
    jsx("circle", { cx: 9, cy: 9, r: 2 }),
    jsx("path", { d: "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" }),
  ],
});

export const GalleryLightbox = () => {
  const Comp = ({ fileData, displayClass }) => {
    const slug = fileData?.slug ?? "index";
    const depth = slug.split("/").length - 1;
    const href = (depth > 0 ? "../".repeat(depth) : "./") + "galeria";
    const current = slug === "galeria";
    return jsx("a", {
      class: ["galeria-button", "internal", displayClass].filter(Boolean).join(" "),
      href,
      title: "Galeria de imagens",
      "aria-label": "Galeria de imagens",
      "aria-current": current ? "page" : undefined,
      children: ICON,
    });
  };
  Comp.afterDOMLoaded = inline;
  return Comp;
};
