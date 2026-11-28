import { jsx, Fragment } from "preact/jsx-runtime";

// Script do cliente: carrega o Waline uma vez e (re)inicia a cada navegação SPA.
// O modo escuro é detectado pelo atributo saved-theme do <html>, que o Quartz já mantém.
const inline = `
(function () {
  var instance = null;

  // Avatares: o Waline só aceita estilos do Gravatar, então trocamos cada imagem por um
  // símbolo das quatro nações (ar, água, terra, fogo), escolhido pelo hash do avatar original.
  var W = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="';
  var S = '" /><g fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">';
  var SYMBOLS = [
    // ar: espiral
    W + '#d4a437' + S + '<path d="M32 32a2.5 2.5 0 0 1 5 0a6 6 0 0 1-12 0a10 10 0 0 1 20 0a14 14 0 0 1-28 0"/></g></svg>',
    // água: três ondas
    W + '#3f8fc7' + S + '<path d="M13 23q4.75-6 9.5 0t9.5 0t9.5 0t9.5 0"/><path d="M13 33q4.75-6 9.5 0t9.5 0t9.5 0t9.5 0"/><path d="M13 43q4.75-6 9.5 0t9.5 0t9.5 0t9.5 0"/></g></svg>',
    // terra: quadrado com espiral
    W + '#2f7d4a' + S + '<rect x="17" y="17" width="30" height="30" rx="4"/><path d="M32 32a2 2 0 0 1 4 0a5 5 0 0 1-10 0"/></g></svg>',
    // fogo: chama
    W + '#d9622b' + '" /><path d="M32 11c3 9 14 13 14 27 0 9-6 15-14 15s-14-6-14-15c0-7 5-10 7-17 3 3 4 4 6 5 1-5 1-10 1-15z" fill="#fff"/><path d="M32 33c4 5 7 8 7 12 0 4-3 6-7 6s-7-2-7-6c0-4 4-7 7-12z" fill="#d9622b"/></svg>'
  ];
  function pick(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 4;
  }
  function swapAvatars(root) {
    root.querySelectorAll("img.wl-user-avatar, .wl-avatar img, .wl-user-avatar img").forEach(function (img) {
      var src = img.getAttribute("src") || "";
      if (src.indexOf("data:image/svg") === 0) return;
      var svg = SYMBOLS[pick(src || img.alt || "")];
      img.setAttribute("src", "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    });
  }
  var observer = null;
  var scriptLoading = null;
  var token = 0;
  var CDNS = ["https://cdn.jsdelivr.net/npm/", "https://unpkg.com/"];

  // Tenta cada CDN em ordem até um funcionar.
  function tryEach(make) {
    var i = 0;
    function next() {
      if (i >= CDNS.length) return Promise.reject(new Error("cdn"));
      return make(CDNS[i++]).catch(next);
    }
    return next();
  }

  // O Quartz remove do <head> o que não tem data-persist ao trocar de página, então o CSS
  // e o script são marcados como persistentes (senão os comentários perdem a formatação).
  function ensureCss(v) {
    var old = document.getElementById("waline-css");
    if (old && old.dataset.ready === "1") return Promise.resolve();
    if (old) old.remove();
    return tryEach(function (cdn) {
      return new Promise(function (resolve, reject) {
        var l = document.createElement("link");
        l.id = "waline-css";
        l.rel = "stylesheet";
        l.setAttribute("data-persist", "true");
        l.href = cdn + "@waline/client@" + v + "/dist/waline.css";
        l.onload = function () { l.dataset.ready = "1"; resolve(); };
        l.onerror = function () { l.remove(); reject(new Error("css")); };
        document.head.appendChild(l);
      });
    });
  }

  function ensureScript(v) {
    if (window.Waline) return Promise.resolve(window.Waline);
    if (scriptLoading) return scriptLoading;
    scriptLoading = tryEach(function (cdn) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = cdn + "@waline/client@" + v + "/dist/waline.umd.js";
        s.async = true;
        s.setAttribute("data-persist", "true");
        s.onload = function () { resolve(window.Waline); };
        s.onerror = function () { s.remove(); reject(new Error("js")); };
        document.head.appendChild(s);
      });
    }).catch(function (e) { scriptLoading = null; throw e; });
    return scriptLoading;
  }

  function mount() {
    var my = ++token;
    if (observer) { observer.disconnect(); observer = null; }
    if (instance) { try { instance.destroy(); } catch (e) {} instance = null; }
    var el = document.querySelector(".waline-comments");
    if (!el || !el.dataset.serverUrl) return;
    var target = el.querySelector(".waline-target");
    if (!target) return;
    var v = el.dataset.version;
    Promise.all([ensureCss(v), ensureScript(v)]).then(function (r) {
      // outra montagem começou (nav + render disparam juntos) ou a página mudou
      if (my !== token || !document.body.contains(target)) return;
      var Waline = r[1];
      instance = Waline.init({
        el: target,
        serverURL: el.dataset.serverUrl,
        path: location.pathname,
        lang: el.dataset.lang,
        dark: ':root[saved-theme="dark"]',
        requiredMeta: el.dataset.requiredMeta ? el.dataset.requiredMeta.split(",") : [],
        login: "disable",
        pageview: false,
        reaction: false,
        search: false
      });
      observer = new MutationObserver(function () { swapAvatars(target); });
      observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      swapAvatars(target);
    }).catch(function () {
      if (my === token) target.textContent = "Não foi possível carregar os comentários. Recarregue a página.";
    });
  }
  // Página "Comentários": lista os comentários mais recentes de todo o site
  var titleIndex = null;
  function loadTitles(root) {
    if (titleIndex) return titleIndex;
    titleIndex = fetch(root + "/static/contentIndex.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var m = {};
        Object.keys(d).forEach(function (k) { m[k] = (d[k] && d[k].title) || ""; });
        return m;
      })
      .catch(function () { titleIndex = null; return {}; });
    return titleIndex;
  }
  function plain(html) {
    var doc = new DOMParser().parseFromString(html || "", "text/html");
    doc.querySelectorAll("br").forEach(function (b) { b.replaceWith(String.fromCharCode(10)); });
    doc.querySelectorAll("p").forEach(function (q) { q.append(String.fromCharCode(10)); });
    return (doc.body.textContent || "").trim();
  }
  function pageTitle(url, titles, root) {
    var path = url || "";
    try { path = decodeURIComponent(path); } catch (e) {}
    if (path.indexOf(root) === 0) path = path.slice(root.length);
    var slug = path.split("?")[0].split("#")[0];
    while (slug.charAt(0) === "/") slug = slug.slice(1);
    var folder = slug === "" || slug.charAt(slug.length - 1) === "/";
    while (slug.charAt(slug.length - 1) === "/") slug = slug.slice(0, -1);
    var key = folder ? (slug ? slug + "/index" : "index") : slug;
    if (titles[key]) return titles[key];
    var last = (slug.split("/").pop() || "Página inicial").split("-").join(" ");
    return last.charAt(0).toUpperCase() + last.slice(1);
  }
  function recent() {
    var box = document.querySelector(".comentarios-recentes");
    if (!box || box.dataset.done === "1") return;
    box.dataset.done = "1";
    var server = box.dataset.serverUrl || "";
    while (server.charAt(server.length - 1) === "/") server = server.slice(0, -1);
    var root = (document.body && document.body.dataset.basepath) || "";
    var LIMIT = 50;
    function msg(t) { box.textContent = ""; var p = document.createElement("p"); p.className = "comentarios-aviso"; p.textContent = t; box.appendChild(p); }
    msg("Carregando comentários…");
    Promise.all([
      fetch(server + "/api/comment?type=recent&count=" + LIMIT + "&lang=pt-BR").then(function (r) { return r.json(); }),
      loadTitles(root)
    ]).then(function (res) {
      var list = (res[0] && res[0].data) || [];
      var titles = res[1];
      if (!list.length) { msg("Ainda não há comentários no site."); return; }
      box.textContent = "";
      var head = document.createElement("p");
      head.className = "comentarios-resumo";
      head.textContent = list.length + (list.length === 1 ? " comentário" : " comentários") + (list.length >= LIMIT ? " mais recentes" : "") + ", do mais novo para o mais antigo.";
      box.appendChild(head);
      var ul = document.createElement("ul");
      ul.className = "comentarios-lista";
      list.forEach(function (c) {
        var li = document.createElement("li");
        li.className = "comentario";
        var img = document.createElement("img");
        img.className = "comentario-avatar";
        img.alt = "";
        img.setAttribute("src", "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SYMBOLS[pick(c.nick || c.objectId || "")]));
        var body = document.createElement("div");
        body.className = "comentario-corpo";
        var top = document.createElement("div");
        top.className = "comentario-topo";
        var nick = document.createElement("strong");
        nick.textContent = c.nick || "Anônimo";
        var when = document.createElement("time");
        var dt = new Date(c.insertedAt || c.createdAt || c.time || 0);
        if (isFinite(dt.getTime()) && dt.getTime() > 0) {
          when.dateTime = dt.toISOString();
          when.textContent = dt.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
        }
        top.appendChild(nick);
        top.appendChild(when);
        var text = document.createElement("div");
        text.className = "comentario-texto";
        text.textContent = plain(c.comment);
        var where = document.createElement("a");
        where.className = "comentario-pagina";
        where.href = c.url || "#";
        where.textContent = "em " + pageTitle(c.url, titles, root);
        body.appendChild(top);
        body.appendChild(text);
        body.appendChild(where);
        li.appendChild(img);
        li.appendChild(body);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }).catch(function () { msg("Não foi possível carregar os comentários agora. Tente novamente mais tarde."); });
  }
  document.addEventListener("nav", recent);
  document.addEventListener("render", recent);
  document.addEventListener("nav", mount);
  document.addEventListener("render", mount);
})();
`;

export const WalineComments = (opts = {}) => {
  const Comp = ({ displayClass, fileData }) => {
    const override = fileData.frontmatter?.comments;
    if (override === false || override === "false") return jsx(Fragment, {});
    if (!opts.serverURL) return jsx(Fragment, {});
    return jsx("div", {
      class: [displayClass, "waline-comments"].filter(Boolean).join(" "),
      "data-server-url": opts.serverURL,
      "data-lang": opts.lang ?? "pt-BR",
      "data-required-meta": opts.requiredMeta ?? "nick",
      "data-version": opts.version ?? "3.5.0",
      children: jsx("div", { class: "waline-target" }),
    });
  };
  Comp.afterDOMLoaded = inline;
  return Comp;
};
