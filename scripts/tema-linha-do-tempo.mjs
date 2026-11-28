// Deixa a imagem da "Linha do Tempo" combinando com o site.
//
// Uso:  node scripts/tema-linha-do-tempo.mjs [pastaDeConteudo]      (padrão: content)
//
// A imagem original (Imagens/Frame 1.png) tem fundo branco opaco e texto preto: no modo
// escuro vira um bloco branco. Este script troca o fundo por transparência e recolore:
// texto na cor do tema e marcador/linha no verde de destaque. Nenhum texto é alterado.
// É idempotente: se a imagem já tem transparência, não faz nada. No modo escuro, o CSS
// (custom.scss) inverte as cores da imagem.

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONTENT = path.resolve(process.argv[2] ?? path.join(ROOT, "content"))
const FILE = path.join(CONTENT, "Imagens", "Frame 1.png")

const TEXT = [28, 38, 27] // #1c261b
const GREEN = [47, 125, 74] // #2f7d4a
const SCALE = 2

let input
try {
  input = await fs.readFile(FILE)
} catch {
  console.log("[linha-do-tempo] Imagens/Frame 1.png não encontrada, nada a fazer.")
  process.exit(0)
}

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info
let hasAlpha = false
for (let i = 3; i < data.length; i += 4) {
  if (data[i] < 250) {
    hasAlpha = true
    break
  }
}
if (hasAlpha) {
  console.log("[linha-do-tempo] imagem já tem transparência, nada a fazer.")
  process.exit(0)
}

const out = Buffer.alloc(data.length)
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2]
  const a = 1 - Math.min(r, g, b) / 255 // cobertura da tinta sobre o fundo branco
  let color = TEXT
  if (a > 0.02) {
    // cor da tinta (remove o branco misturado) para decidir se é o verde ou o texto
    const ir = (r - 255 * (1 - a)) / a, ig = (g - 255 * (1 - a)) / a, ib = (b - 255 * (1 - a)) / a
    if (ig > ir * 1.3 && ig > ib * 1.3 && ig - Math.max(ir, ib) > 25) color = GREEN
  }
  out[i] = color[0]
  out[i + 1] = color[1]
  out[i + 2] = color[2]
  out[i + 3] = Math.round(a * 255)
}

const png = await sharp(out, { raw: { width, height, channels: 4 } })
  .resize({ width: width * SCALE, kernel: "lanczos3" })
  .png({ compressionLevel: 9 })
  .toBuffer()
await fs.writeFile(FILE, png)
console.log(`[linha-do-tempo] imagem atualizada (${width * SCALE}x${height * SCALE}, fundo transparente).`)
