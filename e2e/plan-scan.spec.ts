import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { demoPlan } from '@/lib/plan/demo'
import { leftNormal, wallDir, wallSegments } from '@/lib/plan/geometry'
import type { Plan, Wall } from '@/lib/plan/types'
import { calibrate } from '@/lib/plan/scan/calibrate'
import { profile } from '@/lib/plan/scan/profile'
import type { Gray, Raster } from '@/lib/plan/scan/raster'
import { findCentreMarks, findDashed, newOpenings } from '@/lib/plan/scan/openings'
import { register } from '@/lib/plan/scan/register'
import { missingWalls } from '@/lib/plan/scan/missing'
import type { Proposal } from '@/lib/plan/scan/detect'
import { snapWallConsensus, snapWalls } from '@/lib/plan/scan/snap'

// Scan tools the golden case (plan-golden.spec.ts) doesn't exercise:
// calibration, registration, missing walls, consensus over several drawings,
// dashed faces and centre marks, evidence from a second drawing.

const MARGIN = 1000 // mm around the plan

async function scan(plan: Plan, mmPerPx: number, style: 'filled' | 'outline'): Promise<{ g: Gray; r: Raster }> {
  const w = Math.round((12000 + 2 * MARGIN) / mmPerPx)
  const h = Math.round((7000 + 2 * MARGIN) / mmPerPx)
  const P = (x: number, y: number) => `${((x + MARGIN) / mmPerPx).toFixed(2)},${((y + MARGIN) / mmPerPx).toFixed(2)}`
  const shapes: string[] = []
  const lw = (1.5 * 8.467) / mmPerPx // ~0.5 mm pen at 1:100, in px
  for (const wall of plan.walls) {
    const d = wallDir(wall)
    const n = leftNormal(d)
    const t = wall.thickness / 2
    for (const [s, e] of wallSegments(wall, plan.openings.filter((o) => o.wallId === wall.id))) {
      const a = { x: wall.a.x + d.x * s, y: wall.a.y + d.y * s }
      const b = { x: wall.a.x + d.x * e, y: wall.a.y + d.y * e }
      const q = [
        [a.x + n.x * t, a.y + n.y * t],
        [b.x + n.x * t, b.y + n.y * t],
        [b.x - n.x * t, b.y - n.y * t],
        [a.x - n.x * t, a.y - n.y * t],
      ]
      const pts = q.map(([x, y]) => P(x, y)).join(' ')
      shapes.push(
        style === 'filled'
          ? `<polygon points="${pts}" fill="#111"/>`
          : `<polygon points="${pts}" fill="none" stroke="#111" stroke-width="${lw}"/>`,
      )
    }
  }
  // Some clutter: a dimension line and text, which must not be taken for walls.
  shapes.push(`<line x1="${P(500, 7600).split(',')[0]}" y1="${P(500, 7600).split(',')[1]}" x2="${P(11500, 7600).split(',')[0]}" y2="${P(11500, 7600).split(',')[1]}" stroke="#111" stroke-width="${lw}"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/>${shapes.join('')}</svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  return {
    g: { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height },
    r: { id: 'synt', mmPerPx, x: -MARGIN, y: -MARGIN, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 },
  }
}

test('profile measures a wall across', async () => {
  const truth = demoPlan()
  const { g, r } = await scan(truth, 5, 'filled')
  // Across lgh-grans (x = 6000, 250 thick) at y = 2000.
  const { runs } = profile(g, r, { x: 5500, y: 2000 }, { x: 6500, y: 2000 })
  expect(runs).toHaveLength(1)
  expect(Math.abs(runs[0].width - 250)).toBeLessThanOrEqual(10)
  expect(Math.abs(runs[0].mid - 500)).toBeLessThanOrEqual(5)
})

test('calibrate finds the scale and residuals', () => {
  const r: Raster = { id: 's', mmPerPx: 8.467, x: 0, y: 0, widthPx: 1, heightPx: 1, src: '', rotation: 0 }
  // The drawing is 2 % too small: real 5000 reads 4900.
  const c = calibrate(r, [
    { a: { x: 0, y: 0 }, b: { x: 4900, y: 0 }, mm: 5000 },
    { a: { x: 0, y: 0 }, b: { x: 0, y: 2940 }, mm: 3000 },
  ])
  expect(c.factor).toBeCloseTo(5000 / 4900, 4)
  expect(c.rmsMm).toBeLessThanOrEqual(1)
})

test('register recovers scale and offset between two sources', async () => {
  const truth = demoPlan()
  const { g, r } = await scan(truth, 10, 'outline')
  // Same drawing, wrongly placed: 3 % too small and 400/−250 mm off.
  const off: Raster = { ...r, mmPerPx: r.mmPerPx / 1.03, x: r.x - 400, y: r.y + 250 }
  const fit = register({ g, r }, { g, r: off }, { x: -500, y: -500, w: 13000, h: 8000 }, { scaleMin: 0.95, scaleMax: 1.1, shiftMm: 800 })
  expect(Math.abs(fit.mmPerPx - r.mmPerPx)).toBeLessThan(0.02)
  expect(Math.abs(fit.x - r.x)).toBeLessThanOrEqual(30)
  expect(Math.abs(fit.y - r.y)).toBeLessThanOrEqual(30)
})

// Doors drawn the way people draw them: leaf open 60° (SketchUp habit) or
// 90° (archive habit), thick lines, the drawing a little off the plan.
async function doorScan(plan: Plan, mmPerPx: number, leafDeg: number, off: { x: number; y: number }) {
  const { g: _g, r } = await scan(plan, mmPerPx, 'outline')
  void _g
  const P = (x: number, y: number) => `${((x + off.x + MARGIN) / mmPerPx).toFixed(2)} ${((y + off.y + MARGIN) / mmPerPx).toFixed(2)}`
  const lw = 25 / mmPerPx
  const parts: string[] = []
  for (const wall of plan.walls) {
    const d = wallDir(wall)
    const n = leftNormal(d)
    const t = wall.thickness / 2
    for (const [s, e] of wallSegments(wall, plan.openings.filter((o) => o.wallId === wall.id))) {
      const q = [
        [wall.a.x + d.x * s + n.x * t, wall.a.y + d.y * s + n.y * t],
        [wall.a.x + d.x * e + n.x * t, wall.a.y + d.y * e + n.y * t],
        [wall.a.x + d.x * e - n.x * t, wall.a.y + d.y * e - n.y * t],
        [wall.a.x + d.x * s - n.x * t, wall.a.y + d.y * s - n.y * t],
      ]
      parts.push(`<path d="M ${q.map(([x, y]) => P(x, y)).join(' L ')} Z" fill="none" stroke="#111" stroke-width="${lw}"/>`)
    }
  }
  for (const o of plan.openings.filter((x) => x.kind === 'door')) {
    const wall = plan.walls.find((w) => w.id === o.wallId)!
    const d = wallDir(wall)
    const n = leftNormal(d)
    const side = o.swing === 'right' ? -1 : 1
    const atA = (o.hinge ?? 'a') === 'a'
    const t = wall.thickness / 2
    const at = (u: number) => ({ x: wall.a.x + d.x * u + n.x * side * t, y: wall.a.y + d.y * u + n.y * side * t })
    const h = at(atA ? o.offset : o.offset + o.width)
    const f = at(atA ? o.offset + o.width : o.offset)
    const cl = atA ? d : { x: -d.x, y: -d.y }
    const a = (leafDeg * Math.PI) / 180
    const tip = { x: h.x + (cl.x * Math.cos(a) + n.x * side * Math.sin(a)) * o.width, y: h.y + (cl.y * Math.cos(a) + n.y * side * Math.sin(a)) * o.width }
    const rpx = o.width / mmPerPx
    // Arc from the tip back to the free jamb, around the hinge.
    const cross = (tip.x - h.x) * (f.y - h.y) - (tip.y - h.y) * (f.x - h.x)
    parts.push(`<path d="M ${P(h.x, h.y)} L ${P(tip.x, tip.y)} A ${rpx} ${rpx} 0 0 ${cross > 0 ? 1 : 0} ${P(f.x, f.y)}" fill="none" stroke="#111" stroke-width="${lw}"/>`)
  }
  const w = r.widthPx
  const hgt = r.heightPx
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  return { g: { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }, r }
}

test('openings: a doorway drawn as a dashed face is found, a junction break is not', async () => {
  // One 4 m wall, 120 thick, at 1:100/300 dpi. The lower face is dashed
  // (300 mm dashes, 60 mm gaps) over 1000-1900; the upper face has one
  // 120 mm break where a crossing wall meets it at 3000.
  const mmPerPx = 8.467
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  const lw = (2.5).toFixed(2)
  const y1 = 1000 - 60
  const y2 = 1000 + 60
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(5000)}" height="${P(2000)}"><rect width="100%" height="100%" fill="#fff"/>
    <line x1="${P(500)}" y1="${P(y1)}" x2="${P(2940)}" y2="${P(y1)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(3060)}" y1="${P(y1)}" x2="${P(4500)}" y2="${P(y1)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(3000)}" y1="${P(y1)}" x2="${P(3000)}" y2="${P(200)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(500)}" y1="${P(y2)}" x2="${P(1000)}" y2="${P(y2)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(1000)}" y1="${P(y2)}" x2="${P(1900)}" y2="${P(y2)}" stroke="#000" stroke-width="${lw}" stroke-dasharray="${P(300)} ${P(60)}"/>
    <line x1="${P(1900)}" y1="${P(y2)}" x2="${P(4500)}" y2="${P(y2)}" stroke="#000" stroke-width="${lw}"/>
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  const r: Raster = { id: 's', mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 }
  const wall: Wall = { id: 'w', a: { x: 500, y: 1000 }, b: { x: 4500, y: 1000 }, thickness: 120, phase: 'existing' }
  const found = findDashed(g, r, wall, { junctions: [[2500, 100]] })
  expect(found).toHaveLength(1)
  // Where the last dash runs into the solid line can't be seen: ends are
  // good to about one dash (300 mm here).
  expect(Math.abs(found[0].offset - 500)).toBeLessThanOrEqual(150)
  expect(Math.abs(found[0].offset + found[0].width - 1400)).toBeLessThanOrEqual(150)
})

test('openings: a drawing that shows an existing opening confirms it (evidence), a long merged gap does not', async () => {
  const truth = demoPlan()
  const { g, r } = await doorScan(truth, 5, 60, { x: 0, y: 0 })
  const door = truth.openings.find((o) => o.id === 'd-a-hall')!
  // The plan already has the door; and a 3 m "opening" on b-kok that no single find matches.
  const plan: Plan = { ...truth, openings: [door, { id: 'bred', wallId: 'b-kok', kind: 'opening', offset: 500, width: 3000, phase: 'existing' }] }
  const res = newOpenings(g, r, plan)
  const c = res.confirms.find((x) => x.id === 'd-a-hall')
  expect(c, JSON.stringify(res.confirms)).toBeTruthy()
  expect(c!.evidence.source).toBe(r.id)
  expect(Math.abs(c!.evidence.offset - door.offset)).toBeLessThanOrEqual(60)
  expect(res.confirms.some((x) => x.id === 'bred')).toBe(false)
  expect(res.openings.some((o) => o.wallId === 'a-hall')).toBe(false)
})

test('openings auto: only the detectors that find the known openings in this drawing are used', async () => {
  const truth = demoPlan()
  // Doors drawn as arcs: the door-symbol detector finds the known doors.
  const { g, r } = await doorScan(truth, 5, 60, { x: 0, y: 0 })
  const src = (id: string) => ({ id, name: id, role: "archive" as const, src: "", widthPx: 1, heightPx: 1, mmPerPx: 1, x: 0, y: 0, rotation: 0 })
  const known: Plan = { ...truth, sources: [src("other")], openings: truth.openings.map((o) => ({ ...o, evidence: [{ source: "other", method: "streckad", offset: o.offset, width: o.width }] })) }
  const res = newOpenings(g, r, known)
  const arc = res.checks.find((c) => c.method === 'dörrbåge')!
  expect(arc.used, JSON.stringify(res.checks)).toBe(true)
  // Walls only, no door marks at all: nothing finds the known doors, so
  // nothing is used and no noise comes out.
  const bare = await scan(truth, 5, 'outline')
  const none = newOpenings(bare.g, bare.r, known)
  expect(none.checks.find((c) => c.method === 'dörrbåge')!.used, JSON.stringify(none.checks)).toBe(false)
  expect(none.openings.filter((o) => o.kind === 'door')).toHaveLength(0)
})

test('openings: centre marks across a wall are found, a crossing wall is not', async () => {
  // A 4 m wall, 120 thick, 1:100/300 dpi. A centre mark (line across the
  // wall reaching 300 mm past each face) at 1500; a crossing wall at 3000.
  const mmPerPx = 8.467
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  const lw = '2.5'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(5000)}" height="${P(3000)}"><rect width="100%" height="100%" fill="#fff"/>
    <line x1="${P(500)}" y1="${P(1440)}" x2="${P(4500)}" y2="${P(1440)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(500)}" y1="${P(1560)}" x2="${P(4500)}" y2="${P(1560)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(2000)}" y1="${P(1140)}" x2="${P(2000)}" y2="${P(1860)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(3500)}" y1="${P(100)}" x2="${P(3500)}" y2="${P(2900)}" stroke="#000" stroke-width="${lw}"/>
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  const r: Raster = { id: 's', mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 }
  const wall: Wall = { id: 'w', a: { x: 500, y: 1500 }, b: { x: 4500, y: 1500 }, thickness: 120, phase: 'existing' }
  const found = findCentreMarks(g, r, wall)
  expect(found).toHaveLength(1)
  expect(Math.abs(found[0].offset + found[0].width / 2 - 1500)).toBeLessThanOrEqual(30)
  expect(found[0].method).toContain('uppskattad')
})

test('openings: two unlike breaks in a face (scan noise) are not a dashed doorway', async () => {
  const mmPerPx = 8.467
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  // Lower face broken at 1500 (90 mm) and 1800 (25 mm): not dashes.
  const seg = (x0: number, x1: number) => `<line x1="${P(x0)}" y1="${P(1060)}" x2="${P(x1)}" y2="${P(1060)}" stroke="#000" stroke-width="2.5"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(5000)}" height="${P(2000)}"><rect width="100%" height="100%" fill="#fff"/>
    <line x1="${P(500)}" y1="${P(940)}" x2="${P(4500)}" y2="${P(940)}" stroke="#000" stroke-width="2.5"/>
    ${seg(500, 1500)}${seg(1590, 1800)}${seg(1825, 4500)}</svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  const r: Raster = { id: 's', mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 }
  const wall: Wall = { id: 'w', a: { x: 500, y: 1000 }, b: { x: 4500, y: 1000 }, thickness: 120, phase: 'existing' }
  expect(findDashed(g, r, wall)).toHaveLength(0)
})

test('openings: one-sided centre marks in a light partition, not at a junction or on a party wall', async () => {
  const mmPerPx = 8.467
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  const lw = '2.5'
  // Wall 4 m, faces at y 940/1060. One-sided 0.2 m marks below the wall at
  // 1500 and 3300; a wall meets the lower face at 2500.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(5000)}" height="${P(2000)}"><rect width="100%" height="100%" fill="#fff"/>
    <line x1="${P(500)}" y1="${P(940)}" x2="${P(4500)}" y2="${P(940)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(500)}" y1="${P(1060)}" x2="${P(4500)}" y2="${P(1060)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(2000)}" y1="${P(1060)}" x2="${P(2000)}" y2="${P(1290)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(3800)}" y1="${P(1060)}" x2="${P(3800)}" y2="${P(1290)}" stroke="#000" stroke-width="${lw}"/>
    <line x1="${P(3000)}" y1="${P(1060)}" x2="${P(3000)}" y2="${P(1950)}" stroke="#000" stroke-width="${lw}"/>
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  const r: Raster = { id: 's', mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 }
  const wall: Wall = { id: 'w', a: { x: 500, y: 1000 }, b: { x: 4500, y: 1000 }, thickness: 120, phase: 'existing' }
  const light = findCentreMarks(g, r, wall, { junctions: [[2500, 100]] })
  expect(light.map((f) => Math.round((f.offset + f.width / 2) / 50) * 50)).toEqual([1500, 3300])
  expect(light.every((f) => f.method!.includes('ensidig'))).toBe(true)
  // The same wall as a party wall: one-sided marks are not trusted there.
  expect(findCentreMarks(g, r, wall, { junctions: [[2500, 100]], oneSided: false })).toHaveLength(0)
})

// A horizontal wall drawn as two face lines (y in mm), with optional extra lines.
async function faces(lines: Array<{ y0: number; y1?: number }>, mmPerPx = 8.5): Promise<{ g: Gray; r: Raster }> {
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(5000)}" height="${P(2000)}"><rect width="100%" height="100%" fill="#fff"/>
    ${lines.map(({ y0, y1 = y0 }) => `<line x1="${P(500)}" y1="${P(y0)}" x2="${P(4500)}" y2="${P(y1)}" stroke="#000" stroke-width="2"/>`).join('')}
  </svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  return {
    g: { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height },
    r: { id: `s${lines.map((l) => l.y0).join('-')}`, mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 },
  }
}

test('snap: a prior thickness overrides a bad first guess', async () => {
  // Faces 100 mm apart, and a fixture line another 100 mm out.
  const { g, r } = await faces([{ y0: 950 }, { y0: 1050 }, { y0: 1150 }])
  const wall: Wall = { id: 'w', a: { x: 600, y: 1030 }, b: { x: 4400, y: 1030 }, thickness: 200, phase: 'existing' }
  const plan = { ...demoPlan(), walls: [wall], openings: [] }
  const guessed = snapWalls(g, r, plan, { ids: ['w'] }, { joinMm: 0 }).walls[0]
  expect(guessed.thickness).toBeGreaterThan(170)
  const fixed = snapWalls(g, r, plan, { ids: ['w'] }, { joinMm: 0, priorThickness: 100 }).walls[0]
  expect(Math.abs(fixed.thickness - 100)).toBeLessThanOrEqual(15)
  expect(Math.abs(fixed.a.y - 1000)).toBeLessThanOrEqual(15)
})

test('snap consensus: median over drawings, a tilted fit is left out', async () => {
  const srcs = await Promise.all([
    faces([{ y0: 950 }, { y0: 1050 }]),          // centre 1000, 100 thick
    faces([{ y0: 970 }, { y0: 1090 }]),          // centre 1030, 120
    faces([{ y0: 965 }, { y0: 1055 }]),          // centre 1010, 90
    faces([{ y0: 900, y1: 1200 }, { y0: 1000, y1: 1300 }]), // tilted ~4°
  ])
  const wall: Wall = { id: 'w', a: { x: 600, y: 1000 }, b: { x: 4400, y: 1000 }, thickness: 100, phase: 'existing' }
  const res = snapWallConsensus(srcs, wall, [])
  expect(res.report.ok).toBe(true)
  expect(res.report.note).toContain('median av 3')
  expect(Math.abs(res.wall!.a.y - 1010)).toBeLessThanOrEqual(10)
  expect(res.wall!.a.y).toBe(res.wall!.b.y)
  expect(Math.abs(res.wall!.thickness - 100)).toBeLessThanOrEqual(10)
})

test('openings: a wall drawn in parts is located stretch by stretch; a stretch whose faces stop is a passage', async () => {
  const mmPerPx = 8.5
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  const line = (x0: number, y0: number, x1: number, y1: number) => `<line x1="${P(x0)}" y1="${P(y0)}" x2="${P(x1)}" y2="${P(y1)}" stroke="#000" stroke-width="2"/>`
  // Wall along y≈1000 from x 500 to 8500: 450 thick west of x 4000, 350
  // thick east of it (the south face jogs). Crossing walls at 2000, 3200,
  // 4000 and 6000. Between 2000 and 3200 the faces stop, with a label
  // written across the north face; at 6500-7500 a WC bowl sits on it.
  const parts = [
    line(500, 775, 2000, 775), line(500, 1225, 2000, 1225),
    line(3200, 775, 8500, 775), line(3200, 1225, 4000, 1225), line(4000, 1125, 8500, 1125),
    ...[2000, 3200, 4000, 6000].flatMap((x) => [line(x - 50, 0, x - 50, 775), line(x + 50, 0, x + 50, 775), line(x - 50, 1225, x - 50, 2000), line(x + 50, 1225, x + 50, 2000)]),
    `<text x="${P(2300)}" y="${P(850)}" font-size="${P(180)}" font-family="sans-serif">40 /</text>`,
    `<circle cx="${P(7000)}" cy="${P(950)}" r="${P(160)}" fill="none" stroke="#000" stroke-width="2"/>`,
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(9000)}" height="${P(2000)}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  const r: Raster = { id: 's', mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 }
  const wall: Wall = { id: 'mur', a: { x: 500, y: 1000 }, b: { x: 8500, y: 1000 }, thickness: 400, phase: 'existing', loadBearing: true }
  const cross = [2000, 3200, 4000, 6000].flatMap((x, i): Wall[] => [
    { id: `n${i}`, a: { x, y: 0 }, b: { x, y: 800 }, thickness: 100, phase: 'existing' },
    { id: `s${i}`, a: { x, y: 1200 }, b: { x, y: 2000 }, thickness: 100, phase: 'existing' },
  ])
  const plan: Plan = { ...demoPlan(), walls: [wall, ...cross], openings: [] }
  const found = newOpenings(g, r, plan, ['mur'], undefined, ['mellanrum']).openings
  expect(found).toHaveLength(1)
  expect(found[0].evidence![0].method).toContain('hel sträcka')
  expect(Math.abs(found[0].offset + 500 - 2090)).toBeLessThanOrEqual(30)
  expect(Math.abs(found[0].offset + found[0].width + 500 - 3110)).toBeLessThanOrEqual(30)
})

test('missing walls: a wall several drawings agree on and the plan lacks is reported; covered and single-drawing ones are not', () => {
  const plan: Plan = { ...demoPlan(), walls: [{ id: 'a', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, phase: 'existing' }], openings: [] }
  const line = (x0: number, y0: number, x1: number, y1: number, thickness = 100): Proposal => ({ a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, thickness, style: 'filled', confidence: 0.8 })
  const found = [
    // The plan's own wall (drawn 10 mm off) and a wall it lacks.
    { source: 's1', proposals: [line(0, 10, 4000, 10, 200), line(1000, 2000, 1000, 3500)] },
    // The same two, the missing one drawn 60 mm to the side and thicker.
    { source: 's2', proposals: [line(0, -20, 4000, -20, 200), line(1060, 2000, 1060, 3500, 110)] },
    // A stroke only one drawing has.
    { source: 's3', proposals: [line(5000, 5000, 5000, 6000)] },
  ]
  const miss = missingWalls(plan, found, { minSources: 2 })
  expect(miss).toHaveLength(1)
  expect(miss[0].sources.sort()).toEqual(['s1', 's2'])
  expect(Math.abs(miss[0].a.x - 1030)).toBeLessThanOrEqual(30)
  expect(Math.round(Math.hypot(miss[0].b.x - miss[0].a.x, miss[0].b.y - miss[0].a.y))).toBe(1500)
  expect(miss[0].covered).toBe(0)
})
