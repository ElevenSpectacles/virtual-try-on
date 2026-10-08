#!/usr/bin/env node
// Zoomed crop with a labelled pixel grid, for reading frame edges by eye.
//   node grid-crop.mjs <image> <out.png> <left> <top> <width> <height> [zoom=3]
// Grid lines every 10 source px, red + labelled every 50. Coordinates on the
// grid are the INPUT image's pixels, so readings from two crops of the same
// image compare directly.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../../package.json', import.meta.url))
const sharp = createRequire(repo)('sharp')

const [src, out, l, t, w, h, z = '3'] = process.argv.slice(2)
if (!src || !out || !h) {
  console.error('usage: grid-crop.mjs <image> <out.png> <left> <top> <width> <height> [zoom]')
  process.exit(1)
}
const [L, T, W, H, k] = [l, t, w, h, z].map(Number)

let svg = `<svg width="${W * k}" height="${H * k}" xmlns="http://www.w3.org/2000/svg">`
for (let x = Math.ceil(L / 10) * 10; x < L + W; x += 10) {
  const major = x % 50 === 0
  svg += `<line x1="${(x - L) * k}" y1="0" x2="${(x - L) * k}" y2="${H * k}" stroke="${major ? '#f00a' : '#0f04'}"/>`
  if (major) svg += `<text x="${(x - L) * k + 2}" y="14" fill="red" font-size="14">${x}</text>`
}
for (let y = Math.ceil(T / 10) * 10; y < T + H; y += 10) {
  const major = y % 50 === 0
  svg += `<line x1="0" y1="${(y - T) * k}" x2="${W * k}" y2="${(y - T) * k}" stroke="${major ? '#f00a' : '#0f04'}"/>`
  if (major) svg += `<text x="2" y="${(y - T) * k - 2}" fill="red" font-size="14">${y}</text>`
}
svg += '</svg>'

await sharp(src)
  .extract({ left: L, top: T, width: W, height: H })
  .resize(W * k, H * k, { kernel: 'nearest' })
  .composite([{ input: Buffer.from(svg) }])
  .png()
  .toFile(out)
console.log(out)
