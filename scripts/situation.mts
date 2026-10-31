// A situation plan (situationsplan) of a property from Lantmäteriet's Min karta.
//   npx tsx scripts/situation.mts "Strängnäs Lövinge 3:2" [--out .visual/situation] [--paper A3|A4] [--scale 500]
//        [--address "…"] [--author "…"] [--no-map] [--no-aerial]
// Writes situationsplan.svg / .png / .pdf (pale map underlay) and flygbild.svg / .png / .pdf (aerial photo
// underlay with a 10 m grid in local coordinates), flygbild.jpg (the photo itself, with the boundary), and
// site.json (property, buildings).
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import path from 'node:path'
import { extractBuildings } from '../lib/site/buildings'
import { backgroundUri, svgToPdf, svgToPng } from '../lib/site/export'
import { bbox } from '../lib/site/geometry'
import { fetchAerial, fetchMosaic, findProperty } from '../lib/site/lantmateriet'
import { layoutSite, renderSite } from '../lib/site/render'

const argv = process.argv.slice(2)
const name = argv.find((a, i) => !a.startsWith('--') && !(argv[i - 1] ?? '').startsWith('--'))
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? undefined : argv[i + 1]
}
if (!name) {
  console.error('npx tsx scripts/situation.mts "Strängnäs Lövinge 3:2" [--out dir] [--paper A3|A4] [--scale 500] [--address …] [--author …] [--no-map]')
  process.exit(1)
}
const out = opt('out') ?? '.visual/situation'
mkdirSync(out, { recursive: true })

const prop = await findProperty(name)
const rings = prop.polygons.map((p) => p[0])
const b = bbox(rings.flat())
const margin = 60
const area = { minX: b.minX - margin, maxX: b.maxX + margin, minY: b.minY - margin, maxY: b.maxY + margin }
const topo = await fetchMosaic(area, 'topowebb')
const buildings = await extractBuildings(topo, rings)
const paper: 'A3' | 'A4' = opt('paper') === 'A4' ? 'A4' : 'A3'
const scale = opt('scale') ? Number(opt('scale')) : undefined
const L = layoutSite({ polygons: prop.polygons, paper, scale })
const base = argv.includes('--no-map') ? undefined : await fetchMosaic(area, 'topowebb_nedtonad')
const sheet = { polygons: prop.polygons, buildings, title: { designation: prop.designation, municipality: prop.municipality, address: opt('address'), author: opt('author') }, background: base, paper, scale }
const svg = renderSite(sheet, base ? await backgroundUri(base) : undefined)
writeFileSync(path.join(out, 'situationsplan.svg'), svg)
writeFileSync(path.join(out, 'situationsplan.png'), svgToPng(svg, 2200))
writeFileSync(path.join(out, 'situationsplan.pdf'), await svgToPdf(svg, L.paperW, L.paperH, `Situationsplan ${prop.designation}`))
writeFileSync(path.join(out, 'site.json'), JSON.stringify({ property: prop, buildings }, null, 1))
if (!argv.includes('--no-aerial')) {
  // The photo covers the whole drawing area of the sheet, not only the property.
  const halfW = ((L.map.w / 2) * L.scale) / 1000 + 2
  const halfH = ((L.map.h / 2) * L.scale) / 1000 + 2
  const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  const aerial = await fetchAerial({ minX: mid.x - halfW, maxX: mid.x + halfW, minY: mid.y - halfH, maxY: mid.y + halfH }, 0.2)
  const photoSheet = { ...sheet, background: aerial, backgroundOpacity: 1, grid: 10, title: { ...sheet.title, drawingNumber: 'S-02', note: 'Underlag: Lantmäteriets flygbild (Min karta), referensbild: ej ritningsunderlag. Fastighetsgräns enligt Lantmäteriets fastighetsregister. Byggnader avlästa ur kartan (±1 m). Rutnät i lokala koordinater.' } }
  const photoSvg = renderSite(photoSheet, await backgroundUri(aerial, { photo: true }))
  writeFileSync(path.join(out, 'flygbild.svg'), photoSvg)
  writeFileSync(path.join(out, 'flygbild.png'), svgToPng(photoSvg, 2200))
  writeFileSync(path.join(out, 'flygbild.pdf'), await svgToPdf(photoSvg, L.paperW, L.paperH, `Flygbild ${prop.designation}`))
  writeFileSync(path.join(out, 'flygbild.jpg'), await sharp(aerial.png).jpeg({ quality: 88 }).toBuffer())
}
console.log(`${prop.designation}: ${L.paper} ${L.orientation} 1:${L.scale}, ${buildings.length} byggnader → ${out}/situationsplan.{svg,png,pdf}`)
