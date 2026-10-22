import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { demoPlan } from '@/lib/plan/demo'
import { leftNormal, wallDir, wallSegments } from '@/lib/plan/geometry'
import type { Plan, Wall } from '@/lib/plan/types'
import { calibrate } from '@/lib/plan/scan/calibrate'
import { detectWalls } from '@/lib/plan/scan/detect'
import { profile } from '@/lib/plan/scan/profile'
import type { Gray, Raster } from '@/lib/plan/scan/raster'
import { readDoors } from '@/lib/plan/scan/doors'
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
