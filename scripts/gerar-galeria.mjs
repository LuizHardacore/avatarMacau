// Gera a página "Galeria" a partir das imagens do vault.
//
// Uso:  node scripts/gerar-galeria.mjs [pastaDeConteudo]      (padrão: content)
//
// - Procura todas as imagens e todas as notas (.md) da pasta de conteúdo.
// - Descobre em quais notas cada imagem aparece (![[img]], ![](img), <img>, [[img]]).
// - Agrupa por pasta da nota -> nota -> imagens. Imagens sem nota ficam por pasta.
// - Cria miniaturas leves (webp) em <conteudo>/_galeria/ e escreve <conteudo>/Galeria.md.
//
// O Galeria.md e as miniaturas são gerados a cada build (não vão para o git (.git/info/exclude; o Quartz ignora o que está no .gitignore)):
// basta adicionar imagens ao vault e publicar, a galeria se atualiza sozinha.

import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONTENT = path.resolve(process.argv[2] ?? path.join(ROOT, "content"))
const THUMB_DIR = "_galeria"
const THUMB_WIDTH = 640
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".bmp"])
const SKIP_DIRS = new Set([".obsidian", ".trash", "private", "templates", "node_modules", THUMB_DIR])
const OUTPUT_NAME = "Galeria.md"

let sharp = null
try {
  sharp = (await import("sharp")).default
} catch {
  console.warn("[galeria] sharp indisponível: usando as imagens originais, sem miniaturas.")
}

const toPosix = (p) => p.split(path.sep).join("/")
const norm = (s) => s.normalize("NFC").toLowerCase()

// Mesma regra do Quartz para transformar um caminho de arquivo em URL.
function slugPath(p) {
  return p
    .normalize("NFC")
    .split("/")
    .map((seg) =>
      seg
        .replace(/\s/g, "-")
        .replace(/&/g, "-and-")
        .replace(/%/g, "-percent")
        .replace(/\?/g, "")
        .replace(/#/g, "")
        .replace(/[<>:"|*]/g, "")
        .toLowerCase(),
    )
    .join("/")
}

async function walk(dir, rel = "", out = { images: [], notes: [] }) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      await walk(path.join(dir, e.name), relPath, out)
    } else {
      const ext = path.extname(e.name).toLowerCase()
      // favicon e logo soltos na raiz são ícones do site, não imagens da wiki
      if (IMAGE_EXT.has(ext)) {
        if (!rel && /^(favicon|logo)./i.test(e.name)) continue
        out.images.push(relPath)
      }
      else if (ext === ".md" && relPath !== OUTPUT_NAME) out.notes.push(relPath)
    }
  }
  return out
}

function frontmatterTitle(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return undefined
  const t = m[1].match(/^title:\s*(.+?)\s*$/m)
  return t ? t[1].replace(/^["']|["']$/g, "") : undefined
}

// Extrai nomes/caminhos de imagem citados numa nota.
function referencedImages(text) {
  const refs = new Set()
  const add = (raw) => {
    if (!raw) return
    let t = raw.split("|")[0].split("#")[0].trim()
    try {
      t = decodeURIComponent(t)
    } catch {}
    if (IMAGE_EXT.has(path.extname(t).toLowerCase())) refs.add(t)
  }
  for (const m of text.matchAll(/!?\[\[([^\]]+?)\]\]/g)) add(m[1])
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*(?:"[^"]*")?\)/g)) add(m[1])
  for (const m of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) add(m[1])
  return refs
}

const { images, notes } = await walk(CONTENT)
const byFull = new Map(images.map((i) => [norm(i), i]))
const byName = new Map()
for (const i of images) {
  const k = norm(path.posix.basename(i))
  if (!byName.has(k)) byName.set(k, [])
  byName.get(k).push(i)
}

function resolveImage(ref, noteRel) {
  const r = norm(ref.replace(/^\.?\/+/, ""))
  const rel = norm(path.posix.normalize(path.posix.join(path.posix.dirname(noteRel), ref)))
  if (byFull.has(rel)) return byFull.get(rel)
  if (byFull.has(r)) return byFull.get(r)
  const cands = byName.get(norm(path.posix.basename(ref)))
  if (!cands) return undefined
  // vários com o mesmo nome: o mais próximo do caminho citado
  return cands.find((c) => norm(c).endsWith(r)) ?? cands[0]
}

// pasta -> nota -> imagens
const pages = [] // { folder, rel, title, images: [] }
const used = new Set()
for (const rel of notes.sort((a, b) => a.localeCompare(b, "pt-BR"))) {
  const text = await fs.readFile(path.join(CONTENT, rel), "utf8")
  const found = []
  for (const ref of referencedImages(text)) {
    const img = resolveImage(ref, rel)
    if (img && !found.includes(img)) found.push(img)
  }
  if (!found.length) continue
  found.forEach((f) => used.add(f))
  const dir = path.posix.dirname(rel)
  pages.push({
    folder: dir === "." ? "" : dir,
    rel,
    title: frontmatterTitle(text) ?? path.posix.basename(rel, ".md"),
    images: found,
  })
}
const orphans = images.filter((i) => !used.has(i))

// ---------- miniaturas ----------
const thumbRoot = path.join(CONTENT, THUMB_DIR)
await fs.mkdir(thumbRoot, { recursive: true })
const keep = new Set()
const info = new Map() // imagem -> { thumb, w, h }

async function prepare(rel) {
  if (info.has(rel)) return info.get(rel)
  const src = path.join(CONTENT, rel)
  const entry = { thumb: rel, w: 0, h: 0 }
  if (sharp && path.extname(rel).toLowerCase() !== ".svg") {
    try {
      const hash = crypto.createHash("sha1").update(norm(rel)).digest("hex").slice(0, 12)
      const name = `${hash}.webp`
      const out = path.join(thumbRoot, name)
      keep.add(name)
      const st = await fs.stat(src)
      let fresh = false
      try {
        fresh = (await fs.stat(out)).mtimeMs >= st.mtimeMs
      } catch {}
      const meta = await sharp(src).metadata()
      entry.w = meta.width ?? 0
      entry.h = meta.height ?? 0
      if (!fresh) {
        await sharp(src)
          .rotate()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: 72 })
          .toFile(out)
      }
      entry.thumb = `${THUMB_DIR}/${name}`
    } catch (err) {
      console.warn(`[galeria] imagem ilegível, fora da galeria: ${rel} (${err.message})`)
      entry.broken = true
    }
  }
  info.set(rel, entry)
  return entry
}

// imagens corrompidas (que não abrem) ficam de fora
for (const rel of images) await prepare(rel)
const ok = (rel) => !info.get(rel)?.broken
const brokenCount = images.filter((i) => !ok(i)).length
for (const p of pages) p.images = p.images.filter(ok)
for (let i = pages.length - 1; i >= 0; i--) if (!pages[i].images.length) pages.splice(i, 1)
for (let i = orphans.length - 1; i >= 0; i--) if (!ok(orphans[i])) orphans.splice(i, 1)

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const capName = (rel) => path.posix.basename(rel, path.posix.extname(rel))

async function grid(list, caption) {
  const items = []
  for (const rel of list) {
    const t = await prepare(rel)
    const dims = t.w && t.h ? ` width="${t.w}" height="${t.h}"` : ""
    const label = esc(`${caption} — ${capName(rel)}`)
    items.push(
      `<a class="galeria-item" href="${esc(slugPath(rel))}" data-caption="${label}" data-name="${esc(capName(rel))}" target="_blank" rel="noopener">` +
        `<img src="${esc(slugPath(t.thumb))}" alt="${esc(capName(rel))}" loading="lazy" decoding="async"${dims}></a>`,
    )
  }
  return `<div class="galeria-grid">${items.join("")}</div>`
}

// ---------- agrupamento por pasta ----------
const folders = new Map() // pasta -> { pages: [], orphans: [] }
const slot = (f) => {
  if (!folders.has(f)) folders.set(f, { pages: [], orphans: [] })
  return folders.get(f)
}
pages.forEach((p) => slot(p.folder).pages.push(p))
orphans.forEach((o) => {
  const d = path.posix.dirname(o)
  slot(d === "." ? "" : d).orphans.push(o)
})

const folderLabel = (f) => (f === "" ? "Páginas principais" : f.split("/").join(" › "))
const sorted = [...folders.keys()].sort((a, b) => {
  if (a === "") return -1
  if (b === "") return 1
  return a.localeCompare(b, "pt-BR")
})

const total = images.length - brokenCount
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`
const folderCount = (f) => {
  const { pages: ps, orphans: os } = folders.get(f)
  return new Set([...ps.flatMap((p) => p.images), ...os]).size
}
const chips = sorted
  .map((f, i) => `<a class="galeria-chip" href="#g-${i}">${esc(folderLabel(f))}<span>${folderCount(f)}</span></a>`)
  .join("")
const lines = [
  "---",
  "title: Galeria",
  "comments: false",
  // fora de backlinks, grafo, busca e explorador (o acesso é pelo botão ao lado da busca)
  "unlisted: true",
  "---",
  "",
  `<div class="galeria-hero"><p class="galeria-resumo">${plural(total, "imagem", "imagens")} em ${plural(pages.length, "página", "páginas")}, organizadas por pasta. Toque em uma imagem para ampliar.</p><nav class="galeria-chips" aria-label="Pastas">${chips}</nav></div>`,
  "",
]

for (const [fi, f] of sorted.entries()) {
  const { pages: ps, orphans: os } = folders.get(f)
  const count = folderCount(f)
  lines.push(`<span id="g-${fi}" class="galeria-ancora"></span>`, "", `## ${folderLabel(f)}`, "", `<p class="galeria-contagem">${plural(count, "imagem", "imagens")}</p>`, "")
  for (const p of ps) {
    const link = p.rel.replace(/\.md$/i, "")
    lines.push(`### [[${link}|${p.title.replace(/[|\]]/g, "")}]]`, "", await grid(p.images, p.title), "")
  }
  if (os.length) {
    const label = ps.length ? "Outras imagens da pasta" : "Imagens da pasta"
    lines.push(`### ${label}`, "", await grid(os, folderLabel(f)), "")
  }
}

if (!total) lines.push("Ainda não há imagens na wiki.", "")

await fs.writeFile(path.join(CONTENT, OUTPUT_NAME), lines.join("\n"), "utf8")

// remove miniaturas de imagens que não existem mais
for (const f of await fs.readdir(thumbRoot)) {
  if (!keep.has(f)) await fs.rm(path.join(thumbRoot, f), { force: true })
}

console.log(
  `[galeria] ${total} imagens, ${pages.length} páginas, ${folders.size} pastas -> ${toPosix(path.relative(ROOT, path.join(CONTENT, OUTPUT_NAME)))}`,
)
