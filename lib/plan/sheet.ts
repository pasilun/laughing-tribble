import { add, along, bounds, dist, leftNormal, polygonArea, scale, wallDir, wallLength, wallQuad, wallSegments } from './geometry'
import type { Fixture, Opening, Phase, Plan, Pt, View, Wall } from './types'

// Renders a plan as a printable drawing sheet. All output coordinates are
// paper millimetres, so the SVG prints at true scale at 100%.

export const PAPER: Record<'A4' | 'A3', { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
}

const MARGIN = 10
const TITLE_H = 44
const FONT = 'Helvetica, Arial, sans-serif'
const TEXT = 2.5 // minimum readable text height on paper
const INK = '#000'
const EXISTING_FILL = '#b8b8b8'

export type SheetLayout = {
  paperW: number
  paperH: number
  frame: { x: number; y: number; w: number; h: number }
  drawing: { x: number; y: number; w: number; h: number }
  fits: boolean
  toPaper: (p: Pt) => Pt
  k: number // paper mm per plan mm
}

export function layoutSheet(plan: Plan): SheetLayout {
  const base = PAPER[plan.sheet.paper]
  const landscape = plan.sheet.orientation === 'landscape'
  const paperW = landscape ? base.w : base.h
  const paperH = landscape ? base.h : base.w
  const frame = { x: MARGIN, y: MARGIN, w: paperW - 2 * MARGIN, h: paperH - 2 * MARGIN }
  const drawing = { x: frame.x + 6, y: frame.y + 6, w: frame.w - 12, h: frame.h - TITLE_H - 12 }
  const k = 1 / plan.sheet.scale
  const b = bounds(plan)
  // Leave room for dimension lines around the plan.
  const pad = 14
  const planW = (b.maxX - b.minX) * k + 2 * pad
  const planH = (b.maxY - b.minY) * k + 2 * pad
  const fits = planW <= drawing.w + 0.01 && planH <= drawing.h + 0.01
  const ox = drawing.x + (drawing.w - (b.maxX - b.minX) * k) / 2 - b.minX * k
  const oy = drawing.y + (drawing.h - (b.maxY - b.minY) * k) / 2 - b.minY * k
  return { paperW, paperH, frame, drawing, fits, k, toPaper: (p) => ({ x: ox + p.x * k, y: oy + p.y * k }) }
}

// ── small SVG helpers (paper mm) ───────────────────────────────────────────

const f = (v: number) => (Math.round(v * 1000) / 1000).toString()

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function line(a: Pt, b: Pt, w: number, extra = ''): string {
  return `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${INK}" stroke-width="${f(w)}" ${extra}/>`
}

function poly(pts: Pt[], attrs: string): string {
  return `<polygon points="${pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}" ${attrs}/>`
}

function text(at: Pt, s: string, size = TEXT, opts: { anchor?: string; angle?: number; weight?: string; testid?: string } = {}): string {
  const rot = opts.angle ? ` transform="rotate(${f(opts.angle)} ${f(at.x)} ${f(at.y)})"` : ''
  const tid = opts.testid ? ` data-testid="${opts.testid}"` : ''
  return `<text x="${f(at.x)}" y="${f(at.y)}" font-family="${FONT}" font-size="${f(size)}" text-anchor="${opts.anchor ?? 'middle'}"${opts.weight ? ` font-weight="${opts.weight}"` : ''} fill="${INK}"${rot}${tid}>${esc(s)}</text>`
}

const DASH = 'stroke-dasharray="1.5 1"'
const DASHDOT = 'stroke-dasharray="4 1 0.6 1"'

// Hatch lines (45°) clipped to a convex polygon.
function hatchConvex(pts: Pt[], spacing: number): string {
  const proj = pts.map((p) => p.x + p.y)
  const lo = Math.min(...proj)
  const hi = Math.max(...proj)
  const out: string[] = []
  for (let c = Math.ceil(lo / spacing) * spacing; c <= hi; c += spacing) {
    // Intersect the line x + y = c with each edge.
    const hits: Pt[] = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      const fp = p.x + p.y - c
      const fq = q.x + q.y - c
      if (fp === fq) continue
      const t = fp / (fp - fq)
      if (t >= 0 && t <= 1) hits.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
    if (hits.length >= 2) {
      hits.sort((a, b) => a.x - b.x)
      out.push(line(hits[0], hits[hits.length - 1], 0.13))
    }
  }
  return out.join('')
}

// ── visibility per view ────────────────────────────────────────────────────

export function visibleIn(phase: Phase, view: View): boolean {
  return view === 'fore' ? phase !== 'new' : true
}

// How an element is drawn in a view: in "före" everything that exists today
// looks existing; in "efter" demolition and new work are marked.
function styleOf(phase: Phase, view: View): Phase {
  return view === 'fore' ? 'existing' : phase
}

// ── dimensions ─────────────────────────────────────────────────────────────

function dimension(a: Pt, b: Pt, offset: number, label: string): string {
  // a, b and offset in paper mm; offset is to the left of a → b.
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 0.5) return ''
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  const n = leftNormal(d)
  const a2 = add(a, scale(n, offset))
  const b2 = add(b, scale(n, offset))
  const sgn = Math.sign(offset) || 1
  const ext = (p: Pt, q: Pt) => line(add(p, scale(n, sgn * 1)), add(q, scale(n, sgn * 1.5)), 0.13)
  const tick = (p: Pt) => line(add(p, { x: -1.2 * (d.x + n.x) / 2, y: -1.2 * (d.y + n.y) / 2 }), add(p, { x: 1.2 * (d.x + n.x) / 2, y: 1.2 * (d.y + n.y) / 2 }), 0.35)
  let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
  if (angle > 90) angle -= 180
  if (angle <= -90) angle += 180
  const mid = scale(add(a2, b2), 0.5)
  const up = angle === (Math.atan2(d.y, d.x) * 180) / Math.PI ? n : scale(n, -1)
  const textAt = add(mid, scale(up, 0.8))
  return (
    `<g class="dim">` +
    ext(a, a2) +
    ext(b, b2) +
    line(add(a2, scale(d, -1)), add(b2, scale(d, 1)), 0.18) +
    tick(a2) +
    tick(b2) +
    text(textAt, label, TEXT, { angle }) +
    `</g>`
  )
}

// ── plan elements ──────────────────────────────────────────────────────────

export function wallOpeningsIn(plan: Plan, w: Wall, view: View): Opening[] {
  return plan.openings.filter((o) => o.wallId === w.id && (view === 'fore' ? o.phase !== 'new' : o.phase !== 'demolish'))
}

type WallPiece = { wall: Wall; quad: Pt[]; style: Phase }

function joinedAt(plan: Plan, w: Wall, p: Pt): boolean {
  return plan.walls.some((o) => o.id !== w.id && (dist(o.a, p) <= 1 || dist(o.b, p) <= 1))
}

// Wall bodies for a view, cut at openings. Ends that meet another wall's end
// are extended by half the thickness so L-corners close.
export function wallPieces(plan: Plan, view: View): WallPiece[] {
  const out: WallPiece[] = []
  for (const w of plan.walls) {
    if (!visibleIn(w.phase, view)) continue
    const style = styleOf(w.phase, view)
    const len = wallLength(w)
    const extA = joinedAt(plan, w, w.a) ? w.thickness / 2 : 0
    const extB = joinedAt(plan, w, w.b) ? w.thickness / 2 : 0
    for (const [s, e] of wallSegments(w, wallOpeningsIn(plan, w, view))) {
      const part: Wall = { ...w, a: along(w, s === 0 ? -extA : s), b: along(w, e >= len ? len + extB : e) }
      out.push({ wall: w, quad: wallQuad(part), style })
    }
    // Closed-up openings appear as new wall in "efter".
    if (view === 'efter') {
      for (const o of plan.openings.filter((x) => x.wallId === w.id && x.phase === 'demolish')) {
        out.push({ wall: w, quad: wallQuad({ ...w, a: along(w, o.offset), b: along(w, o.offset + o.width) }), style: 'new' })
      }
    }
  }
  return out
}

// Drawn in passes so walls that overlap at joints merge into one outline:
// a wide outline of every solid piece first, then the fills on top.
function renderWalls(plan: Plan, view: View, L: SheetLayout): string {
  const pieces = wallPieces(plan, view).map((p) => ({ ...p, q: p.quad.map(L.toPaper) }))
  const solid = pieces.filter((p) => p.style !== 'demolish')
  const outline = solid.map((p) => poly(p.q, `fill="${INK}" stroke="${INK}" stroke-width="0.7" stroke-linejoin="miter"`)).join('')
  const byWall = new Map<string, string[]>()
  const push = (id: string, svg: string) => byWall.set(id, [...(byWall.get(id) ?? []), svg])
  for (const p of solid) push(p.wall.id, poly(p.q, `fill="${p.style === 'new' ? INK : EXISTING_FILL}" stroke="none"`))
  for (const p of solid) if (p.style === 'existing' && p.wall.loadBearing) push(p.wall.id, hatchConvex(p.q, 0.8))
  for (const p of pieces) if (p.style === 'demolish') push(p.wall.id, poly(p.q, `fill="none" stroke="${INK}" stroke-width="0.25" ${DASH}`))
  // Thicker walls on top, so partitions running into them disappear under them.
  const thickness = (id: string) => plan.walls.find((x) => x.id === id)?.thickness ?? 0
  const entries = [...byWall.entries()].sort((p, q) => thickness(p[0]) - thickness(q[0]))
  const groups = entries.map(([id, parts]) => {
    const w = plan.walls.find((x) => x.id === id)!
    return `<g data-wall="${esc(id)}" data-phase="${styleOf(w.phase, view)}">${parts.join('')}</g>`
  })
  return `<g class="wall-outline">${outline}</g>${groups.join('')}`
}

export function fireRatingIn(w: Wall, view: View): string {
  if (view === 'efter' && w.fireRatingAfter !== undefined) return w.fireRatingAfter
  return w.fireRating ?? ''
}

function renderFireLines(plan: Plan, view: View, L: SheetLayout): string {
  const out: string[] = []
  for (const w of plan.walls) {
    const rating = fireRatingIn(w, view)
    if (!rating || !visibleIn(w.phase, view)) continue
    if (view === 'efter' && w.phase === 'demolish') continue
    const n = leftNormal(wallDir(w))
    const off = scale(n, w.thickness / 2 + 1.2 / L.k)
    // Run between the faces of the walls at each end, not into them.
    const len = wallLength(w)
    const cs = crossings(plan, w)
    const t0 = Math.max(0, ...cs.filter((c) => c.near <= 1).map((c) => c.far))
    const t1 = Math.min(len, ...cs.filter((c) => c.far >= len - 1).map((c) => c.near))
    const a = L.toPaper(add(along(w, t0), off))
    const b = L.toPaper(add(along(w, t1), off))
    out.push(line(a, b, 0.35, DASHDOT))
    const mid = scale(add(a, b), 0.5)
    const d = wallDir(w)
    let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI
    if (angle > 90) angle -= 180
    if (angle <= -90) angle += 180
    out.push(text(add(mid, scale(n, 3.4)), rating, TEXT, { angle }))
  }
  return `<g class="fire">${out.join('')}</g>`
}

function renderOpening(plan: Plan, o: Opening, view: View, L: SheetLayout): string {
  const w = plan.walls.find((x) => x.id === o.wallId)
  if (!w) return ''
  if (view === 'fore' && o.phase === 'new') return ''
  if (view === 'efter' && o.phase === 'demolish') return ''
  const d = wallDir(w)
  const n = leftNormal(d)
  const half = w.thickness / 2
  const s = along(w, o.offset)
  const e = along(w, o.offset + o.width)
  const P = L.toPaper
  const out: string[] = []
  const st = styleOf(o.phase, view)
  const lw = st === 'new' ? 0.35 : 0.25
  if (o.kind === 'window') {
    out.push(line(P(add(s, scale(n, half))), P(add(e, scale(n, half))), 0.18))
    out.push(line(P(add(s, scale(n, -half))), P(add(e, scale(n, -half))), 0.18))
    out.push(line(P(s), P(e), 0.25))
    out.push(line(P(add(s, scale(n, half))), P(add(s, scale(n, -half))), 0.25))
    out.push(line(P(add(e, scale(n, half))), P(add(e, scale(n, -half))), 0.25))
  } else if (o.kind === 'door') {
    const hingeAtA = (o.hinge ?? 'a') === 'a'
    const side = (o.swing ?? 'left') === 'left' ? 1 : -1
    const hinge = add(hingeAtA ? s : e, scale(n, side * half))
    const free = add(hingeAtA ? e : s, scale(n, side * half))
    const leafEnd = add(hinge, scale(n, side * o.width))
    out.push(line(P(hinge), P(leafEnd), lw))
    const r = o.width * L.k
    // Sweep from the leaf to the closed position.
    const cross = (leafEnd.x - hinge.x) * (free.y - hinge.y) - (leafEnd.y - hinge.y) * (free.x - hinge.x)
    const sweep = cross > 0 ? 1 : 0
    const pl = P(leafEnd)
    const pf = P(free)
    out.push(`<path d="M ${f(pl.x)} ${f(pl.y)} A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(pf.x)} ${f(pf.y)}" fill="none" stroke="${INK}" stroke-width="0.18"/>`)
  } else {
    // Opening without a door: thin lines across the gap at both faces.
    out.push(line(P(add(s, scale(n, half))), P(add(e, scale(n, half))), 0.13, DASH))
    out.push(line(P(add(s, scale(n, -half))), P(add(e, scale(n, -half))), 0.13, DASH))
  }
  return `<g data-opening="${esc(o.id)}" data-phase="${st}">${out.join('')}</g>`
}

const FIXTURE_LABEL: Record<Fixture['kind'], string> = {
  kitchen: 'Kök',
  stove: 'Spis',
  sink: 'Disk',
  radiator: 'Rad.',
  exhaust: 'F',
  shaft: 'Schakt',
  wc: 'WC',
  shower: 'Dusch',
  bath: 'Bad',
  plug: 'P',
  box: '',
}

function renderFixture(fx: Fixture, view: View, L: SheetLayout): string {
  if (!visibleIn(fx.phase, view)) return ''
  const st = styleOf(fx.phase, view)
  const c = L.toPaper({ x: fx.x, y: fx.y })
  const w = fx.w * L.k
  const d = fx.d * L.k
  const dash = st === 'demolish' ? DASH : ''
  const lw = st === 'new' ? 0.35 : 0.25
  const rot = fx.rotation ? ` transform="rotate(${f(fx.rotation)} ${f(c.x)} ${f(c.y)})"` : ''
  const out: string[] = []
  const x0 = c.x - w / 2
  const y0 = c.y - d / 2
  if (fx.kind === 'exhaust' || fx.kind === 'plug') {
    const r = Math.max(w, d) / 2
    out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="#fff" stroke="${INK}" stroke-width="${lw}" ${dash}/>`)
    out.push(text({ x: c.x, y: c.y + TEXT * 0.35 }, fx.label ?? FIXTURE_LABEL[fx.kind], TEXT * 0.9))
  } else {
    out.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(d)}" fill="#fff" stroke="${INK}" stroke-width="${lw}" ${dash}/>`)
    if (fx.kind === 'shaft') {
      out.push(line({ x: x0, y: y0 }, { x: x0 + w, y: y0 + d }, 0.18, dash))
      out.push(line({ x: x0 + w, y: y0 }, { x: x0, y: y0 + d }, 0.18, dash))
    }
    const base = fx.label ?? FIXTURE_LABEL[fx.kind]
    const label = base && st === 'demolish' ? `${base} (rivs)` : base
    if (label && fx.kind !== 'shaft') {
      // Labels that don't fit inside the symbol go just outside it.
      const fits = label.length * TEXT * 0.55 <= w - 1 && d >= TEXT + 0.6
      out.push(text(fits ? { x: c.x, y: c.y + TEXT * 0.35 } : { x: c.x, y: y0 + d + TEXT + 0.6 }, label, TEXT))
    }
  }
  return `<g data-fixture="${esc(fx.id)}" data-phase="${st}"${rot}>${out.join('')}</g>`
}

export function fmtArea(mm2: number): string {
  return `${(mm2 / 1e6).toFixed(1).replace('.', ',')} m²`
}

export function fmtMm(mm: number): string {
  return String(Math.round(mm))
}

// Positions along wall w where other walls cross its axis, as the near and
// far face of each crossing wall. Used to measure from wall faces, not centre lines.
function crossings(plan: Plan, w: Wall): Array<{ near: number; far: number }> {
  const len = wallLength(w)
  const d = wallDir(w)
  const out: Array<{ near: number; far: number }> = []
  for (const o of plan.walls) {
    if (o.id === w.id || o.phase === 'demolish') continue
    const e = { x: o.b.x - o.a.x, y: o.b.y - o.a.y }
    const den = d.x * e.y - d.y * e.x
    if (Math.abs(den) < 1e-9) continue
    const rx = o.a.x - w.a.x
    const ry = o.a.y - w.a.y
    const t = (rx * e.y - ry * e.x) / den
    const u = (rx * d.y - ry * d.x) / den
    if (u < -0.001 || u > 1.001 || t < -o.thickness || t > len + o.thickness) continue
    const sin = Math.abs(den) / Math.hypot(e.x, e.y)
    const half = o.thickness / 2 / (sin || 1)
    out.push({ near: t - half, far: t + half })
  }
  return out
}

function faceBefore(plan: Plan, w: Wall, t: number): number {
  return Math.max(0, ...crossings(plan, w).map((c) => c.far).filter((v) => v <= t + 0.5))
}

function faceAfter(plan: Plan, w: Wall, t: number): number {
  return Math.min(wallLength(w), ...crossings(plan, w).map((c) => c.near).filter((v) => v >= t - 0.5))
}

// Dimensions generated from the model: each new opening (width and position)
// and each demolished wall (length), so the changes are always measured.
function autoDimensions(plan: Plan, view: View, L: SheetLayout): string {
  if (view !== 'efter') return ''
  const out: string[] = []
  const P = L.toPaper
  for (const o of plan.openings) {
    if (o.phase !== 'new') continue
    const w = plan.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const n = leftNormal(wallDir(w))
    const face = scale(n, w.thickness / 2)
    const off = 5
    const s = add(along(w, o.offset), face)
    const e = add(along(w, o.offset + o.width), face)
    out.push(dimension(P(s), P(e), off, fmtMm(o.width)))
    const from = faceBefore(plan, w, o.offset)
    if (o.offset - from > 1) out.push(dimension(P(add(along(w, from), face)), P(s), off, fmtMm(o.offset - from)))
  }
  for (const w of plan.walls) {
    if (w.phase !== 'demolish') continue
    const face = scale(leftNormal(wallDir(w)), w.thickness / 2)
    const len = wallLength(w)
    const from = faceBefore(plan, w, len / 2)
    const to = faceAfter(plan, w, len / 2)
    out.push(dimension(P(add(along(w, from), face)), P(add(along(w, to), face)), 5, fmtMm(to - from)))
  }
  return `<g class="auto-dims" data-testid="auto-dims">${out.join('')}</g>`
}

function renderDimensions(plan: Plan, L: SheetLayout): string {
  return plan.dimensions
    .map((dm) => {
      const a = L.toPaper(dm.a)
      const b = L.toPaper(dm.b)
      const len = Math.hypot(dm.b.x - dm.a.x, dm.b.y - dm.a.y)
      return dimension(a, b, dm.offset * L.k, fmtMm(len))
    })
    .join('')
}

function renderRooms(plan: Plan, view: View, L: SheetLayout): string {
  return plan.rooms
    .map((r) => {
      const p = L.toPaper(r.at)
      let s = text(p, view === 'efter' && r.renamed ? r.renamed : r.name, 3, { weight: 'bold' })
      if (r.polygon && r.polygon.length >= 3) s += text({ x: p.x, y: p.y + 3.6 }, fmtArea(polygonArea(r.polygon)), TEXT)
      return `<g data-room="${esc(r.id)}">${s}</g>`
    })
    .join('')
}

function renderNotes(plan: Plan, view: View, L: SheetLayout): string {
  return plan.notes
    .filter((n) => visibleIn(n.phase ?? 'existing', view))
    .map((n) => text(L.toPaper(n.at), n.text, TEXT, { anchor: 'start' }))
    .join('')
}

// ── sheet furniture ────────────────────────────────────────────────────────

function northArrow(plan: Plan, L: SheetLayout): string {
  const c = { x: L.drawing.x + L.drawing.w - 10, y: L.drawing.y + 12 }
  const a = plan.sheet.northAngle
  return (
    `<g data-testid="north-arrow" transform="rotate(${f(a)} ${f(c.x)} ${f(c.y)})">` +
    `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="6" fill="none" stroke="${INK}" stroke-width="0.25"/>` +
    poly([{ x: c.x, y: c.y - 6 }, { x: c.x + 2.2, y: c.y + 4 }, { x: c.x, y: c.y + 2.5 }, { x: c.x - 2.2, y: c.y + 4 }], `fill="${INK}"`) +
    text({ x: c.x, y: c.y - 7.5 }, 'N', 3.5, { weight: 'bold' }) +
    `</g>`
  )
}

function scaleBar(plan: Plan, L: SheetLayout): string {
  const metres = 5
  const unit = 1000 * L.k // one metre on paper
  const x0 = L.frame.x + 6
  const y0 = L.frame.y + L.frame.h - TITLE_H - 4
  const out: string[] = []
  for (let i = 0; i < metres; i++) {
    out.push(`<rect x="${f(x0 + i * unit)}" y="${f(y0 - 1.5)}" width="${f(unit)}" height="1.5" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="0.18"/>`)
  }
  for (const m of [0, metres]) out.push(text({ x: x0 + m * unit, y: y0 - 2.5 }, String(m), TEXT))
  out.push(text({ x: x0 + metres * unit + 3, y: y0 }, 'm', TEXT, { anchor: 'start' }))
  return `<g data-testid="scale-bar">${out.join('')}</g>`
}

function legend(view: View, L: SheetLayout, plan: Plan): string {
  const x = L.frame.x + 6
  let y = L.frame.y + L.frame.h - TITLE_H + 6
  const sw = (fill: string, extra = '') => (px: number, py: number) =>
    `<rect x="${f(px)}" y="${f(py - 2)}" width="8" height="2.4" fill="${fill}" stroke="${INK}" stroke-width="0.25" ${extra}/>`
  const rows: Array<[(px: number, py: number) => string, string]> = [[sw(EXISTING_FILL), 'Befintlig vägg']]
  const fixtures = plan.fixtures.filter((fx) => visibleIn(fx.phase, view))
  if (plan.walls.some((w) => w.loadBearing))
    rows.push([(px, py) => sw(EXISTING_FILL)(px, py) + hatchConvex([{ x: px, y: py - 2 }, { x: px + 8, y: py - 2 }, { x: px + 8, y: py + 0.4 }, { x: px, y: py + 0.4 }], 0.8), 'Bärande vägg'])
  if (view === 'efter') {
    rows.push([sw(INK), 'Ny vägg / igensättning'])
    rows.push([sw('none', DASH), 'Rivs'])
  }
  if (plan.walls.some((w) => fireRatingIn(w, view))) rows.push([(px, py) => line({ x: px, y: py - 0.8 }, { x: px + 8, y: py - 0.8 }, 0.35, DASHDOT), 'Brandcellsgräns'])
  if (fixtures.some((fx) => fx.kind === 'exhaust')) rows.push([(px, py) => `<circle cx="${f(px + 4)}" cy="${f(py - 0.8)}" r="1.4" fill="none" stroke="${INK}" stroke-width="0.25"/>`, 'F = frånluftsdon'])
  if (fixtures.some((fx) => fx.kind === 'plug')) rows.push([(px, py) => `<circle cx="${f(px + 4)}" cy="${f(py - 0.8)}" r="1.4" fill="none" stroke="${INK}" stroke-width="0.25"/>`, 'P = proppad anslutning'])
  const out: string[] = [text({ x, y }, 'Teckenförklaring', TEXT, { anchor: 'start', weight: 'bold' })]
  y += 4.2
  let col = 0
  for (const [draw, label] of rows) {
    const px = x + col * 52
    out.push(draw(px, y))
    out.push(text({ x: px + 10, y: y + 0.2 }, label, TEXT, { anchor: 'start' }))
    if (col === 1) {
      col = 0
      y += 4.4
    } else col = 1
  }
  return `<g data-testid="legend">${out.join('')}</g>`
}

export const VIEW_TITLE: Record<View, string> = { fore: 'Planritning före', efter: 'Planritning efter' }

function titleBlock(plan: Plan, view: View, L: SheetLayout): string {
  const tb = plan.sheet.titleBlock
  const w = 150
  const x = L.frame.x + L.frame.w - w
  const y = L.frame.y + L.frame.h - TITLE_H
  const h = TITLE_H
  const out: string[] = []
  out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="#fff" stroke="${INK}" stroke-width="0.5"/>`)
  const rowH = h / 5
  for (let i = 1; i < 5; i++) out.push(line({ x, y: y + i * rowH }, { x: x + w, y: y + i * rowH }, 0.18))
  out.push(line({ x: x + w / 2, y: y + 2 * rowH }, { x: x + w / 2, y: y + h }, 0.18))
  out.push(line({ x: x + w * 0.75, y: y + 3 * rowH }, { x: x + w * 0.75, y: y + h }, 0.18))
  out.push(line({ x: x + w * 0.25, y: y + 3 * rowH }, { x: x + w * 0.25, y: y + h }, 0.18))
  const cell = (cx: number, row: number, label: string, value: string, testid?: string, big = false) => {
    out.push(text({ x: cx + 1.5, y: y + row * rowH + 2.6 }, label, 1.8, { anchor: 'start' }))
    out.push(text({ x: cx + 1.5, y: y + row * rowH + rowH - 1.6 }, value, big ? 3.5 : TEXT, { anchor: 'start', weight: big ? 'bold' : undefined, testid }))
  }
  const title = `${VIEW_TITLE[view]}${tb.floor ? ` – ${tb.floor}` : ''}`
  cell(x, 0, 'Ritning', title, 'tb-title', true)
  cell(x, 1, 'Projekt', tb.project, 'tb-project')
  cell(x, 2, 'Fastighet', tb.property, 'tb-property')
  cell(x + w / 2, 2, 'Adress', tb.address, 'tb-address')
  cell(x, 3, 'Lägenhet', tb.apartments, 'tb-apartments')
  cell(x + w * 0.25, 3, 'Skala', `1:${plan.sheet.scale} (${plan.sheet.paper})`, 'tb-scale')
  cell(x + w / 2, 3, 'Datum', tb.date, 'tb-date')
  cell(x + w * 0.75, 3, 'Rev', tb.revision || '–', 'tb-revision')
  cell(x, 4, 'Ritad av', tb.author, 'tb-author')
  cell(x + w / 2, 4, 'Ritningsnummer', `${tb.drawingNumber}${view === 'fore' ? '-F' : '-E'}`, 'tb-number')
  return `<g data-testid="title-block">${out.join('')}</g>`
}

export type RenderOptions = { underlay?: boolean }

export function renderSheet(plan: Plan, view: View, opts: RenderOptions = {}): string {
  const L = layoutSheet(plan)
  const body: string[] = []
  body.push(`<rect x="0" y="0" width="${f(L.paperW)}" height="${f(L.paperH)}" fill="#fff"/>`)
  body.push(`<rect x="${f(L.frame.x)}" y="${f(L.frame.y)}" width="${f(L.frame.w)}" height="${f(L.frame.h)}" fill="none" stroke="${INK}" stroke-width="0.5"/>`)
  if (opts.underlay && plan.underlay) {
    const u = plan.underlay
    const p = L.toPaper({ x: u.x, y: u.y })
    body.push(
      `<image href="${esc(u.src)}" x="${f(p.x)}" y="${f(p.y)}" width="${f(u.widthPx * u.mmPerPx * L.k)}" height="${f(u.heightPx * u.mmPerPx * L.k)}" transform="rotate(${f(u.rotation)} ${f(p.x)} ${f(p.y)})" opacity="${u.opacity}" preserveAspectRatio="none"/>`,
    )
  }
  body.push(`<g data-testid="plan-walls">${renderWalls(plan, view, L)}</g>`)
  body.push(`<g data-testid="plan-openings">${plan.openings.map((o) => renderOpening(plan, o, view, L)).join('')}</g>`)
  body.push(`<g data-testid="plan-fixtures">${plan.fixtures.map((fx) => renderFixture(fx, view, L)).join('')}</g>`)
  body.push(renderFireLines(plan, view, L))
  body.push(`<g data-testid="plan-rooms">${renderRooms(plan, view, L)}</g>`)
  body.push(`<g data-testid="dims">${renderDimensions(plan, L)}${autoDimensions(plan, view, L)}</g>`)
  body.push(renderNotes(plan, view, L))
  body.push(northArrow(plan, L))
  body.push(scaleBar(plan, L))
  body.push(legend(view, L, plan))
  body.push(titleBlock(plan, view, L))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(L.paperW)}mm" height="${f(L.paperH)}mm" viewBox="0 0 ${f(L.paperW)} ${f(L.paperH)}" data-view="${view}" data-scale="${plan.sheet.scale}">` +
    body.join('') +
    `</svg>`
  )
}
