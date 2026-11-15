// Draws a step-1 answer (outline, rooms, neighbours, entrance, convention examples) over the flat picture, plus the
// basplan's flat outline as a thin grey reference.
//   npx tsx scripts/wallbench/step1viz.mts <step1.json> <flat.png> <x> <y> <w> <h> <scale> <out.png>
import { readFileSync } from 'fs'
import sharp from 'sharp'
import { CASE, tileBits } from './common.mjs'

type Step1 = { conventions: Array<{ what: string; how: string; at: number[] }>; outline: number[][]; entrance?: number[]; rooms: Array<{ name: string; rect: number[]; at: number[] }>; neighbours: Array<{ a: string; b: string; between: string }> }
const [file, flat, x, y, w, h, scale, out] = process.argv.slice(2)
const s = JSON.parse(readFileSync(file, 'utf8')) as Step1
const b = await tileBits([Number(x), Number(y), Number(w), Number(h)])
const S = Number(scale)
const X = (mm: number) => (((mm - CASE.x) / CASE.mm_per_px - b.x0) * S).toFixed(1)
const Y = (mm: number) => (((mm - CASE.y) / CASE.mm_per_px - b.y0) * S).toFixed(1)
const meta = await sharp(flat).metadata()
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const colours = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#808000', '#469990', '#000075']
const parts: string[] = []
// Reference: the basplan's flat 154 zone (today's state; close to 1999 at the outline).
const ref = [[20599, 15659], [22597, 15659], [22597, 14342], [24462, 14342], [24462, 15659], [26308, 15659], [26308, 20403], [20599, 20403]]
parts.push(`<polygon points="${ref.map(([a, c]) => `${X(a)},${Y(c)}`).join(' ')}" fill="none" stroke="#777" stroke-width="2" stroke-dasharray="8 6"/>`)
s.rooms.forEach((r, i) => {
  const c = colours[i % colours.length]
  const [x0, y0, x1, y1] = r.rect
  parts.push(`<rect x="${X(x0)}" y="${Y(y0)}" width="${(+X(x1) - +X(x0)).toFixed(1)}" height="${(+Y(y1) - +Y(y0)).toFixed(1)}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="2"/>`)
  parts.push(`<circle cx="${X(r.at[0])}" cy="${Y(r.at[1])}" r="6" fill="${c}"/>`)
  parts.push(`<text x="${+X(r.at[0]) + 9}" y="${+Y(r.at[1]) + 5}" font-size="17" font-weight="bold" font-family="sans-serif" fill="${c}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(r.name)}</text>`)
})
const at = new Map(s.rooms.map((r) => [r.name, r.at]))
for (const n of s.neighbours) {
  const p = at.get(n.a), q = at.get(n.b)
  if (!p || !q) continue
  const style = n.between === 'door' ? 'stroke="#0a0" stroke-width="3"' : n.between === 'open' ? 'stroke="#06c" stroke-width="5" stroke-dasharray="2 5"' : 'stroke="#c00" stroke-width="1.5" stroke-dasharray="6 4"'
  parts.push(`<line x1="${X(p[0])}" y1="${Y(p[1])}" x2="${X(q[0])}" y2="${Y(q[1])}" ${style}/>`)
}
parts.push(`<polygon points="${s.outline.map(([a, c]) => `${X(a)},${Y(c)}`).join(' ')}" fill="none" stroke="#d000d0" stroke-width="4"/>`)
if (s.entrance) parts.push(`<circle cx="${X(s.entrance[0])}" cy="${Y(s.entrance[1])}" r="11" fill="none" stroke="#d000d0" stroke-width="4"/><text x="${+X(s.entrance[0]) + 14}" y="${+Y(s.entrance[1]) - 8}" font-size="16" font-family="sans-serif" fill="#d000d0" stroke="#fff" stroke-width="3" paint-order="stroke">entrance</text>`)
s.conventions.forEach((c) => parts.push(`<rect x="${+X(c.at[0]) - 5}" y="${+Y(c.at[1]) - 5}" width="10" height="10" fill="#ffcc00" stroke="#000"/><text x="${+X(c.at[0]) + 8}" y="${+Y(c.at[1]) + 16}" font-size="12" font-family="sans-serif" fill="#000" stroke="#ffcc00" stroke-width="3" paint-order="stroke">${esc(c.what)}</text>`))
const legend = `<g transform="translate(10,${(meta.height ?? 0) - 92})"><rect width="430" height="84" fill="#fff" stroke="#999"/>` +
  `<line x1="10" y1="16" x2="50" y2="16" stroke="#d000d0" stroke-width="4"/><text x="58" y="21" font-size="13" font-family="sans-serif">outline (step 1)</text>` +
  `<line x1="210" y1="16" x2="250" y2="16" stroke="#777" stroke-width="2" stroke-dasharray="8 6"/><text x="258" y="21" font-size="13" font-family="sans-serif">basplan outline (reference)</text>` +
  `<line x1="10" y1="40" x2="50" y2="40" stroke="#0a0" stroke-width="3"/><text x="58" y="45" font-size="13" font-family="sans-serif">door</text>` +
  `<line x1="110" y1="40" x2="150" y2="40" stroke="#06c" stroke-width="5" stroke-dasharray="2 5"/><text x="158" y="45" font-size="13" font-family="sans-serif">open</text>` +
  `<line x1="210" y1="40" x2="250" y2="40" stroke="#c00" stroke-width="1.5" stroke-dasharray="6 4"/><text x="258" y="45" font-size="13" font-family="sans-serif">wall only</text>` +
  `<rect x="10" y="58" width="10" height="10" fill="#ffcc00" stroke="#000"/><text x="28" y="68" font-size="13" font-family="sans-serif">convention example</text></g>`
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${parts.join('')}${legend}</svg>`)
await sharp(flat).composite([{ input: svg }]).png().toFile(out)
