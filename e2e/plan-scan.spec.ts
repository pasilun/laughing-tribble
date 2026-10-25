import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { demoPlan } from '@/lib/plan/demo'
import { leftNormal, wallDir, wallSegments } from '@/lib/plan/geometry'
import type { Plan, Wall } from '@/lib/plan/types'
import { calibrate } from '@/lib/plan/scan/calibrate'
import { detectWalls } from '@/lib/plan/scan/detect'
import { profile } from '@/lib/plan/scan/profile'
import type { Gray, Raster } from '@/lib/plan/scan/raster'
import { readDoor, readDoors } from '@/lib/plan/scan/doors'
import { findDashed, newOpenings } from '@/lib/plan/scan/openings'
import { findWindows, windowsOnWall } from '@/lib/plan/scan/elevation'
import { register } from '@/lib/plan/scan/register'
import { snapWalls } from '@/lib/plan/scan/snap'

// Accuracy of the scan tools on synthetic "scans": a known plan is drawn
// into an image, the walls are nudged off, and the tools must find them.

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

// Rough walls: shifted sideways, slightly rotated, wrong thickness.
function nudge(w: Wall, i: number): Wall {
  const n = leftNormal(wallDir(w))
  const off = (i % 2 ? 1 : -1) * 60
  const tilt = (i % 3) - 1 // mm extra at b
  return {
    ...w,
    a: { x: w.a.x + n.x * off, y: w.a.y + n.y * off },
    b: { x: w.b.x + n.x * (off + tilt * 25), y: w.b.y + n.y * (off + tilt * 25) },
    thickness: Math.round(w.thickness * 1.3),
  }
}

// Largest distance from the snapped centreline to the true one, at both ends.
function lineError(found: Wall, truth: Wall): number {
  const n = leftNormal(wallDir(truth))
  const off = (p: { x: number; y: number }) => Math.abs((p.x - truth.a.x) * n.x + (p.y - truth.a.y) * n.y)
  return Math.max(off(found.a), off(found.b))
}

for (const [style, mmPerPx] of [
  ['filled', 8.467],
  ['outline', 8.467],
  ['filled', 3.6],
  ['outline', 3.6],
] as const) {
  test(`snap finds ${style} walls at ${mmPerPx} mm/px within 1.5 px`, async () => {
    const truth = demoPlan()
    const { g, r } = await scan(truth, mmPerPx, style)
    const rough: Plan = { ...truth, walls: truth.walls.map(nudge) }
    const res = snapWalls(g, r, rough, { ids: rough.walls.map((w) => w.id) })
    for (const rep of res.reports) expect(rep.ok, `${rep.id}: ${rep.note}`).toBe(true)
    for (const w of res.walls) {
      const t = truth.walls.find((x) => x.id === w.id)!
      expect(lineError(w, t), w.id).toBeLessThanOrEqual(1.5 * mmPerPx + 1)
      expect(Math.abs(w.thickness - t.thickness), `${w.id} thickness`).toBeLessThanOrEqual(2 * mmPerPx + 5)
    }
  })
}

test('snap joins corners at the centreline intersection', async () => {
  const truth = demoPlan()
  const { g, r } = await scan(truth, 5, 'filled')
  const rough: Plan = { ...truth, walls: truth.walls.map(nudge) }
  const res = snapWalls(g, r, rough, { ids: ['yt-n', 'yt-o'] })
  const n = res.walls.find((w) => w.id === 'yt-n')!
  const o = res.walls.find((w) => w.id === 'yt-o')!
  expect(Math.hypot(n.b.x - o.a.x, n.b.y - o.a.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(n.b.x - 12000)).toBeLessThanOrEqual(10)
  expect(Math.abs(n.b.y)).toBeLessThanOrEqual(10)
})

test('snap squares near-axis walls, and leaves them be when asked', async () => {
  const truth = demoPlan()
  // The drawing itself slightly askew: every wall tilted 1.2°.
  const k = Math.tan((1.2 * Math.PI) / 180)
  const tilt = (p: { x: number; y: number }) => ({ x: p.x + k * p.y, y: p.y - k * p.x })
  const askew: Plan = { ...truth, walls: truth.walls.map((w) => ({ ...w, a: tilt(w.a), b: tilt(w.b) })) }
  const { g, r } = await scan(askew, 5, 'filled')
  const rough: Plan = { ...askew, walls: askew.walls.map(nudge) }
  const ids = ['lgh-grans', 'b-kok']
  const sq = snapWalls(g, r, rough, { ids }, { joinMm: 0 })
  for (const w of sq.walls) expect(Math.min(Math.abs(w.a.x - w.b.x), Math.abs(w.a.y - w.b.y)), w.id).toBe(0)
  const raw = snapWalls(g, r, rough, { ids }, { joinMm: 0, square: false })
  for (const w of raw.walls) expect(Math.min(Math.abs(w.a.x - w.b.x), Math.abs(w.a.y - w.b.y)), w.id).toBeGreaterThan(50)
})

test('detect proposes the long walls of a scan', async () => {
  const truth = demoPlan()
  for (const style of ['filled', 'outline'] as const) {
    const { g, r } = await scan(truth, 8.467, style)
    const found = detectWalls(g, r, { minLengthMm: 1500 })
    for (const id of ['yt-n', 'yt-s', 'yt-o', 'yt-v', 'lgh-grans', 'b-kok']) {
      const t = truth.walls.find((w) => w.id === id)!
      const hit = found.find((p) => lineError({ ...t, a: p.a, b: p.b }, t) <= 2 * 8.467 && Math.abs(p.thickness - t.thickness) <= 30)
      expect(hit, `${style} ${id}`).toBeTruthy()
    }
    // The dimension line is a single line, not a wall.
    expect(found.some((p) => Math.abs(p.a.y - 7600) < 30 && p.a.y === p.b.y)).toBe(false)
  }
})

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

for (const leafDeg of [60, 90]) {
  test(`doors: reads hinge and swing from ${leafDeg}° symbols, drawing 100 mm off`, async () => {
    const truth = demoPlan()
    const { g, r } = await doorScan(truth, 5, leafDeg, { x: 70, y: -70 })
    // Every door in the plan set to the mirror of the truth (other hinge, same side)
    // and one to the wrong side entirely.
    const wrong: Plan = {
      ...truth,
      openings: truth.openings.map((o, i) =>
        o.kind !== 'door' ? o : i % 2 ? { ...o, hinge: o.hinge === 'b' ? 'a' : 'b' } : { ...o, swing: o.swing === 'right' ? 'left' : 'right' },
      ),
    }
    const { readings } = readDoors(g, r, wrong)
    for (const rd of readings) {
      const t = truth.openings.find((o) => o.id === rd.id)!
      expect(rd.confident, `${rd.id} ${JSON.stringify(rd.candidates)}`).toBe(true)
      expect(rd.best && `${rd.best.hinge}/${rd.best.swing}`, rd.id).toBe(`${t.hinge ?? 'a'}/${t.swing ?? 'left'}`)
      expect(rd.changed, rd.id).toBe(true)
    }
  })
}

test('openings: gaps in drawn walls become openings, then doors with their swing', async () => {
  const truth = demoPlan()
  const { g, r } = await doorScan(truth, 5, 60, { x: 0, y: 0 })
  const bare: Plan = { ...truth, openings: [] }
  const found = newOpenings(g, r, bare).openings
  for (const o of truth.openings.filter((x) => x.kind !== 'window')) {
    const hit = found.find((f) => f.wallId === o.wallId && Math.abs(f.offset - o.offset) <= 30 && Math.abs(f.width - o.width) <= 60)
    expect(hit, `${o.id} ${JSON.stringify(found.filter((f) => f.wallId === o.wallId))}`).toBeTruthy()
    if (o.kind === 'door') {
      const wall = truth.walls.find((w) => w.id === o.wallId)!
      const rd = readDoor(g, r, wall, { ...hit!, kind: 'door' })
      expect(rd.confident && `${rd.best!.hinge}/${rd.best!.swing}`, o.id).toBe(`${o.hinge ?? 'a'}/${o.swing ?? 'left'}`)
    }
  }
})

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

test('elevation: windows read off a speckled facade and mapped (mirrored) onto a wall', async () => {
  // A 20 m facade at 1:100/300 dpi: three windows (1.2 m wide, 1.5 m high,
  // double frame and a transom) on one floor, a pilaster line, and speckle.
  const mmPerPx = 8.467
  const P = (mm: number) => (mm / mmPerPx).toFixed(2)
  const wins = [3000, 9000, 15000]
  const parts: string[] = []
  for (const x of wins) {
    parts.push(`<rect x="${P(x)}" y="${P(2000)}" width="${P(1200)}" height="${P(1500)}" fill="none" stroke="#000" stroke-width="2.5"/>`)
    parts.push(`<rect x="${P(x + 60)}" y="${P(2060)}" width="${P(1080)}" height="${P(1380)}" fill="none" stroke="#000" stroke-width="1.5"/>`)
    parts.push(`<line x1="${P(x)}" y1="${P(2600)}" x2="${P(x + 1200)}" y2="${P(2600)}" stroke="#000" stroke-width="1.5"/>`)
    parts.push(`<line x1="${P(x + 600)}" y1="${P(2000)}" x2="${P(x + 600)}" y2="${P(3500)}" stroke="#000" stroke-width="1.5"/>`)
  }
  parts.push(`<line x1="${P(12000)}" y1="${P(500)}" x2="${P(12000)}" y2="${P(5000)}" stroke="#000" stroke-width="2"/>`)
  // Speckle: deterministic pseudo-random dots.
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 1500; i++) parts.push(`<rect x="${(rnd() * 20000 / mmPerPx).toFixed(1)}" y="${((1500 + rnd() * 2500) / mmPerPx).toFixed(1)}" width="1.5" height="1.5" fill="#000"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P(20000)}" height="${P(5000)}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
  const { data, info } = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
  const r: Raster = { id: 'f', mmPerPx, x: 0, y: 0, widthPx: info.width, heightPx: info.height, src: '', rotation: 0 }
  const found = findWindows(g, r, { y0: 1700, y1: 3800 })
  expect(found).toHaveLength(3)
  for (const [i, x] of wins.entries()) {
    expect(Math.abs(found[i].x0 - x), `x0 ${i}`).toBeLessThanOrEqual(30)
    expect(Math.abs(found[i].x1 - found[i].x0 - 1200), `width ${i}`).toBeLessThanOrEqual(40)
    expect(Math.abs(found[i].y1 - found[i].y0 - 1500), `height ${i}`).toBeLessThanOrEqual(60)
  }
  // Seen from outside: facade x 0 is the wall's b-end, facade x 20000 its a-end.
  const wall: Wall = { id: 'yt', a: { x: 100000, y: 0 }, b: { x: 120000, y: 0 }, thickness: 400, phase: 'existing', exterior: true }
  const on = windowsOnWall(found, wall, [{ facadeX: 0, plan: { x: 120000, y: 0 } }, { facadeX: 20000, plan: { x: 100000, y: 0 } }])
  expect(on.map((w) => Math.round(w.offset / 100) * 100)).toEqual([3800, 9800, 15800])
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
