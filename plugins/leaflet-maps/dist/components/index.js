import { Fragment, jsx } from "preact/jsx-runtime";

// Mapas interativos a partir dos blocos leaflet do Obsidian (plugin Obsidian Leaflet).
// O bloco chega ao navegador como <pre data-language="leaflet">; este script lê as linhas
// "chave: valor" originais e troca o bloco por um mapa Leaflet (CRS.Simple + imagem).
// Observação: o script evita barras invertidas, crases e cifrão com chaves, pois vive
// dentro de uma template string.
const inline = `
(function () {
  var NL = String.fromCharCode(10);
  var VERSION = "1.9.4";
  var CDNS = ["https://cdn.jsdelivr.net/npm/leaflet@" + VERSION + "/dist/", "https://unpkg.com/leaflet@" + VERSION + "/dist/"];
  var scriptLoading = null;
  var live = [];

  function tryEach(make) {
    var i = 0;
    function next() {
      if (i >= CDNS.length) return Promise.reject(new Error("cdn"));
      return make(CDNS[i++]).catch(next);
    }
    return next();
  }
  // o Quartz remove do <head> o que não tem data-persist ao navegar
  function ensureCss() {
    var old = document.getElementById("leaflet-css");
    if (old && old.dataset.ready === "1") return Promise.resolve();
    if (old) old.remove();
    return tryEach(function (cdn) {
      return new Promise(function (resolve, reject) {
        var l = document.createElement("link");
        l.id = "leaflet-css";
        l.rel = "stylesheet";
        l.setAttribute("data-persist", "true");
        l.href = cdn + "leaflet.css";
        l.onload = function () { l.dataset.ready = "1"; resolve(); };
        l.onerror = function () { l.remove(); reject(new Error("css")); };
        document.head.appendChild(l);
      });
    });
  }
  function ensureScript() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (scriptLoading) return scriptLoading;
    scriptLoading = tryEach(function (cdn) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = cdn + "leaflet.js";
        s.async = true;
        s.setAttribute("data-persist", "true");
        s.onload = function () { resolve(window.L); };
        s.onerror = function () { s.remove(); reject(new Error("js")); };
        document.head.appendChild(s);
      });
    }).catch(function (e) { scriptLoading = null; throw e; });
    return scriptLoading;
  }

  function parse(pre) {
    var lines = pre.querySelectorAll("[data-line]");
    var text = lines.length
      ? Array.prototype.map.call(lines, function (l) { return l.textContent; }).join(NL)
      : pre.textContent;
    var cfg = {};
    text.split(NL).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === "#") return;
      var i = line.indexOf(":");
      if (i < 1) return;
      cfg[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return cfg;
  }

  // mesma regra de nomes de arquivo do Quartz
  function slugify(s) {
    s = s.normalize("NFC").split(" ").join("-").split("&").join("-and-").split("%").join("-percent");
    var bad = "?#<>:" + String.fromCharCode(34) + "|*";
    for (var i = 0; i < bad.length; i++) s = s.split(bad.charAt(i)).join("");
    return s.toLowerCase();
  }
  function candidates(file) {
    var root = (document.body && document.body.dataset.basepath) || "";
    var name = file.split("[").join("").split("]").join("").split("|")[0].trim();
    var base = name.split("/").pop();
    var out = [
      root + "/" + name.split("/").map(slugify).join("/"),
      root + "/imagens/" + slugify(base),
      root + "/mapas/" + slugify(base)
    ];
    return out.filter(function (u, i) { return out.indexOf(u) === i; }).map(encodeURI);
  }
  function loadFirst(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error("img"));
      var url = urls[i++];
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { resolve({ url: url, w: im.naturalWidth, h: im.naturalHeight }); };
        im.onerror = reject;
        im.src = url;
      }).catch(next);
    }
    return next();
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  function build(wrap, cfg, L) {
    var el = wrap.querySelector(".mapa-leaflet");
    return loadFirst(candidates(cfg.image || "")).then(function (img) {
      var touch = L.Browser.mobile;
      var map = L.map(el, {
        crs: L.CRS.Simple,
        zoomSnap: 0.25,
        zoomDelta: num(cfg.zoomdelta, 0.5),
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: !touch,
        minZoom: -12,
        maxBoundsViscosity: 1
      });
      var bounds = [[0, 0], [img.h, img.w]];
      L.imageOverlay(img.url, bounds).addTo(map);
      map.setMaxBounds(L.latLngBounds(bounds).pad(0.15));

      // altura do mapa acompanha a proporção da imagem (sem faixas vazias), limitada à tela
      function sizeBox() {
        if (wrap.classList.contains("mapa-cheio")) { el.style.height = ""; return; }
        var w = wrap.clientWidth || el.clientWidth;
        if (!w) return;
        el.style.height = Math.round(Math.min((w * img.h) / img.w, window.innerHeight * 0.8)) + "px";
      }
      function fit() {
        sizeBox();
        map.invalidateSize();
        // zoom exato em que a imagem inteira cabe na caixa (getBoundsZoom arredonda para baixo)
        var size = map.getSize();
        var z = Math.log(Math.min(size.x / img.w, size.y / img.h)) / Math.LN2;
        map.setMinZoom(z);
        map.setMaxZoom(Math.max(z + 4, 1.5));
        return z;
      }
      var z0 = fit();
      map.setView([img.h / 2, img.w / 2], z0, { animate: false });

      // roda do mouse só depois de clicar no mapa (não prende a rolagem da página)
      map.on("click focus", function () { map.scrollWheelZoom.enable(); });
      el.addEventListener("mouseleave", function () { map.scrollWheelZoom.disable(); });

      function relayout(refit) {
        var was = Math.abs(map.getZoom() - map.getMinZoom()) < 0.05;
        var z = fit();
        if (refit || was || map.getZoom() < z) map.setView([img.h / 2, img.w / 2], z, { animate: false });
      }
      function toggle(force) {
        var on = typeof force === "boolean" ? force : !wrap.classList.contains("mapa-cheio");
        wrap.classList.toggle("mapa-cheio", on);
        document.documentElement.classList.toggle("mapa-aberto", on);
        if (on) map.dragging.enable();
        else if (touch) map.dragging.disable();
        setTimeout(function () { relayout(true); }, 50);
      }

      // botão de tela cheia
      var Full = L.Control.extend({
        options: { position: "topleft" },
        onAdd: function () {
          var box = L.DomUtil.create("div", "leaflet-bar");
          var a = L.DomUtil.create("a", "mapa-cheio-btn", box);
          a.title = "Tela cheia";
          a.tabIndex = 0;
          a.setAttribute("role", "button");
          a.setAttribute("aria-label", "Tela cheia");
          a.innerHTML = "&#x26F6;";
          L.DomEvent.disableClickPropagation(box);
          L.DomEvent.on(a, "click", function (e) { L.DomEvent.stop(e); toggle(); });
          L.DomEvent.on(a, "keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { L.DomEvent.stop(e); toggle(); }
          });
          return box;
        }
      });
      new Full().addTo(map);

      function onKey(e) { if (e.key === "Escape" && wrap.classList.contains("mapa-cheio")) toggle(false); }
      document.addEventListener("keydown", onKey);

      var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { relayout(false); }) : null;
      if (ro) ro.observe(wrap);

      wrap.classList.add("mapa-pronto");
      live.push({
        el: wrap,
        destroy: function () {
          document.removeEventListener("keydown", onKey);
          document.documentElement.classList.remove("mapa-aberto");
          if (ro) ro.disconnect();
          try { map.remove(); } catch (e) {}
        }
      });
    });
  }

  function fail(wrap) {
    wrap.classList.add("mapa-erro");
    wrap.textContent = "Não foi possível carregar o mapa.";
  }

  function init() {
    live = live.filter(function (m) {
      if (document.body.contains(m.el)) return true;
      m.destroy();
      return false;
    });
    var pres = document.querySelectorAll('pre[data-language="leaflet"]');
    if (!pres.length) return;
    var jobs = [];
    pres.forEach(function (pre) {
      if (pre.closest(".popover")) return;
      var cfg = parse(pre);
      if (!cfg.image) return;
      var holder = pre.closest("figure") || pre;
      var wrap = document.createElement("div");
      wrap.className = "mapa-leaflet-wrap";
      wrap.innerHTML = '<div class="mapa-leaflet"></div>';
      wrap.style.setProperty("--mapa-altura", num(cfg.height, 400) + "px");
      holder.replaceWith(wrap);
      jobs.push([wrap, cfg]);
    });
    if (!jobs.length) return;
    Promise.all([ensureCss(), ensureScript()]).then(function (r) {
      jobs.forEach(function (j) {
        if (!document.body.contains(j[0])) return;
        build(j[0], j[1], r[1]).catch(function () { fail(j[0]); });
      });
    }).catch(function () { jobs.forEach(function (j) { fail(j[0]); }); });
  }
  document.addEventListener("nav", init);
  document.addEventListener("render", init);
})();
`;

export const LeafletMaps = () => {
  const Comp = () => jsx(Fragment, {});
  Comp.afterDOMLoaded = inline;
  return Comp;
};
