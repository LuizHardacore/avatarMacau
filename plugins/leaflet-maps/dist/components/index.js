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
      var key = line.slice(0, i).trim().toLowerCase();
      var val = line.slice(i + 1).trim();
      if (key === "marker") { (cfg.markers = cfg.markers || []).push(val); return; }
      cfg[key] = val;
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

  // ---- marcadores (formato do plugin Obsidian Leaflet: marker: tipo, lat, long, [[link]], descrição)
  var COLORS = { "default": "#2da2eb", vermelho: "#eb2d2d", amarelo: "#ffbb00", verde: "#12d20f", branco: "#ffffff" };
  var UNITS_PER_PX = 131072; // o Obsidian Leaflet guarda a posição em pixels / 131072
  var pageIndex = null;

  function parseMarker(v) {
    var p = v.split(",");
    if (p.length < 3) return null;
    var lat = parseFloat(p[1]), lng = parseFloat(p[2]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var rest = p.slice(3).join(",").trim();
    var link = "";
    if (rest.indexOf("[[") === 0) {
      var e = rest.indexOf("]]");
      if (e > 0) {
        link = rest.slice(2, e).split("|")[0].trim();
        rest = rest.slice(e + 2).trim();
        if (rest.charAt(0) === ",") rest = rest.slice(1).trim();
      }
    }
    return { type: p[0].trim(), lat: lat, lng: lng, link: link, desc: rest };
  }

  function norm(s) { return s.normalize("NFC").toLowerCase().trim(); }
  function loadIndex() {
    if (pageIndex) return pageIndex;
    var root = (document.body && document.body.dataset.basepath) || "";
    pageIndex = fetch(root + "/static/contentIndex.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var map = {};
        Object.keys(data).forEach(function (slug) {
          var d = data[slug] || {};
          var file = (d.filePath || slug).split("/").pop().replace(".md", "");
          map[norm(file)] = slug;
          if (d.title) map[norm(d.title)] = map[norm(d.title)] || slug;
        });
        return map;
      })
      .catch(function () { pageIndex = null; return {}; });
    return pageIndex;
  }

  function pinIcon(L, type) {
    var color = COLORS[norm(type)] || COLORS["default"];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="26" height="34">' +
      '<path d="M12 1C6 1 1.5 5.6 1.5 11.3c0 7.6 8.5 18.4 10.5 19.9 2-1.5 10.5-12.3 10.5-19.9C22.5 5.6 18 1 12 1z" fill="' + color + '" stroke="#1c261b" stroke-width="1.6"/>' +
      '<circle cx="12" cy="11.5" r="4" fill="#1c261b" fill-opacity="0.75"/></svg>';
    return L.divIcon({ className: "mapa-pino", html: svg, iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -30], tooltipAnchor: [0, -28] });
  }

  function addMarkers(map, cfg, img, L) {
    (cfg.markers || []).forEach(function (raw) {
      var m = parseMarker(raw);
      if (!m) return;
      var x = Math.min(Math.max(m.lng * UNITS_PER_PX, 0), img.w);
      var yTop = Math.min(Math.max(-m.lat * UNITS_PER_PX, 0), img.h);
      var title = m.link || m.desc;
      var marker = L.marker([img.h - yTop, x], { icon: pinIcon(L, m.type), keyboard: true, title: title, riseOnHover: true }).addTo(map);
      marker.bindTooltip(title, { direction: "top", className: "mapa-dica" });
      var box = document.createElement("div");
      var h = document.createElement("strong");
      h.textContent = title;
      box.appendChild(h);
      if (m.link && m.desc) {
        var d = document.createElement("div");
        d.textContent = m.desc;
        box.appendChild(d);
      }
      var holder = document.createElement("div");
      box.appendChild(holder);
      marker.bindPopup(box, { className: "mapa-popup", closeButton: true, autoPanPadding: [30, 30] });
      if (m.link) {
        loadIndex().then(function (idx) {
          var slug = idx[norm(m.link)];
          if (!slug) return;
          var root = (document.body && document.body.dataset.basepath) || "";
          var a = document.createElement("a");
          a.className = "mapa-popup-link";
          a.href = root + "/" + encodeURI(slug);
          a.textContent = "Abrir página →";
          a.addEventListener("click", function (e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            e.preventDefault();
            if (window.spaNavigate) window.spaNavigate(new URL(a.href, location.href));
            else location.href = a.href;
          });
          holder.appendChild(a);
        });
      }
    });
  }

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
      addMarkers(map, cfg, img, L);
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
