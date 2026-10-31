// A situation plan (situationsplan) of a property from Lantmäteriet's Min karta.
//   npx tsx scripts/situation.mts "Strängnäs Lövinge 3:2" [--out .visual/situation] [--paper A3|A4] [--scale 500]
//        [--address "…"] [--author "…"] [--no-map]
// Writes situationsplan.svg / .png / .pdf and site.json (property, buildings).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { extractBuildings } from '../lib/site/buildings'
import { backgroundUri, svgToPdf, svgToPng } from '../lib/site/export'
import { bbox } from '../lib/site/geometry'
import { fetchMosaic, findProperty } from '../lib/site/lantmateriet'
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
console.log(`${prop.designation}: ${L.paper} ${L.orientation} 1:${L.scale}, ${buildings.length} byggnader → ${out}/situationsplan.{svg,png,pdf}`)
