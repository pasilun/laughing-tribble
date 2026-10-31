import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { area, minRect, shortest } from '@/lib/site/geometry'
import { layoutSite, renderSite } from '@/lib/site/render'
import { svgToPng } from '@/lib/site/export'
import type { Building } from '@/lib/site/buildings'
import type { P } from '@/lib/site/geometry'

// The situation plan (lib/site): geometry, and a sheet from a recorded property (Strängnäs Lövinge 3:2,
// as Lantmäteriet's Min karta gave it) so the test needs no network.

const rec = JSON.parse(readFileSync('e2e/fixtures/site/lovinge.json', 'utf8')) as { property: { designation: string; municipality: string; polygons: P[][][] }; buildings: Building[] }

test('geometry: area, the smallest rectangle around points, the shortest line between outlines', () => {
  expect(area([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }])).toBe(12)
  // A 6 × 2 rectangle turned 30°.
  const a = Math.PI / 6
  const pts = [[0, 0], [6, 0], [6, 2], [0, 2]].map(([x, y]) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }))
  const r = minRect(pts)
  expect(r.width).toBeCloseTo(6, 6)
  expect(r.depth).toBeCloseTo(2, 6)
  expect(r.angle).toBeCloseTo(a, 6)
  const sq = (x: number, y: number): P[] => [{ x, y }, { x: x + 2, y }, { x: x + 2, y: y + 2 }, { x, y: y + 2 }]
  expect(shortest(sq(0, 0), sq(5, 0)).d).toBeCloseTo(3, 6)
  expect(shortest(sq(0, 0), sq(5, 5)).d).toBeCloseTo(Math.hypot(3, 3), 6)
})

test('the recorded property is 7 310 m² with a dwelling and three outbuildings', () => {
  expect(Math.round(area(rec.property.polygons[0][0]))).toBe(7310)
  expect(rec.buildings.map((b) => b.kind)).toEqual(['bostadshus', 'komplementbyggnad', 'komplementbyggnad', 'komplementbyggnad'])
  expect(rec.buildings[0].area).toBeGreaterThan(50)
  expect(rec.buildings[0].area).toBeLessThan(70)
})

test('the sheet: whole property on A3 portrait at 1:500, boundary, buildings with distances, scale bar and title block', () => {
  const L = layoutSite({ polygons: rec.property.polygons })
  expect(L).toMatchObject({ paper: 'A3', orientation: 'portrait', scale: 500 })
  const svg = renderSite({ polygons: rec.property.polygons, buildings: rec.buildings, title: { designation: rec.property.designation, municipality: rec.property.municipality, address: 'Lövinge' } })
  for (const s of ['Situationsplan – befintlig', 'Strängnäs Lövinge 3:2', '1:500 (A3)', 'Bostadshus', 'Komplementbyggnad', 'Fastighetsgräns', 'SWEREF 99 TM', 'Tomtarea ca 7 310 m²']) expect(svg).toContain(s)
  // One distance line per building, in metres with a decimal comma.
  expect([...svg.matchAll(/>(\d+,\d) m</g)]).toHaveLength(rec.buildings.length)
  // A smaller paper picks a smaller scale; a larger scale is refused only by not fitting.
  expect(layoutSite({ polygons: rec.property.polygons, paper: 'A4' }).scale).toBe(1000)
  const png = svgToPng(svg, 600)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
})

test('marked areas (a meadow, an idea) are drawn with name, area and a legend line, and shown over the photo grid', () => {
  const b = rec.property.polygons[0][0]
  const x0 = Math.min(...b.map((p) => p.x))
  const y0 = Math.min(...b.map((p) => p.y))
  const ring = [{ x: 45, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 70 }, { x: 45, y: 70 }].map((p) => ({ x: p.x + x0, y: p.y + y0 }))
  const svg = renderSite({
    polygons: rec.property.polygons,
    buildings: rec.buildings,
    title: { designation: rec.property.designation, municipality: rec.property.municipality },
    grid: 10,
    areas: [{ id: 'a1', name: 'Äng', fill: '#f2d024', stroke: '#9a7b00', legend: 'Äng (min bedömning)', status: 'idé', ring }],
  })
  expect(svg).toContain('>Äng<')
  expect(svg).toContain('ca 450 m², idé')
  // An area that runs over the boundary says how much is inside.
  const over = renderSite({ polygons: rec.property.polygons, buildings: [], title: { designation: 'x', municipality: 'y' }, areas: [{ id: 'b', name: 'Äng', fill: '#f2d024', stroke: '#9a7b00', ring: [{ x: -10, y: 40 }, { x: 20, y: 40 }, { x: 20, y: 70 }, { x: -10, y: 70 }].map((p) => ({ x: p.x + x0, y: p.y + y0 })) }] })
  expect(over).toContain('varav ca')
  expect(svg).toContain('Äng (min bedömning)')
  expect(svg).toContain('Rutnät 10 m')
})
