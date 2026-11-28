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

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.galeria-item");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    open(a);
  });
  document.addEventListener("keydown", function (e) {
    if (!box || box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  // ao trocar de página com o visualizador aberto, fecha
  document.addEventListener("nav", close);
})();
`;

export const GalleryLightbox = () => {
  const Comp = () => jsx(Fragment, {});
  Comp.afterDOMLoaded = inline;
  return Comp;
};
