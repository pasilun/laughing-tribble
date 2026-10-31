import { area, bbox, centroid, dist, pointInRing, shortest, type P } from './geometry'
import type { Building } from './buildings'
import type { Mosaic } from './lantmateriet'

// A situation plan (situationsplan) as an SVG sheet in millimetres: the property boundary, the
// buildings, the distances from each building to the boundary, north arrow, scale bar, legend
// and title block. Scale and paper are chosen so the whole property fits at the largest
// standard scale. Map coordinates are SWEREF 99 TM metres (y up); the sheet is y down.

export type SiteTitle = { designation: string; municipality: string; address?: string; drawingNumber?: string; author?: string; date?: string; revision?: string; note?: string }

// A marked area: a meadow, a garden, a planned plot. Ring in map metres (SWEREF 99 TM).
// An item of the plan that covers ground: a meadow, a lawn, a garden, a planned plot. On the drawing it is
// a hatched area with an outline, a number and a name, like a building; over the aerial photo (a
// reference sheet) it is only an outline, so the photo stays readable. Ring in map metres (SWEREF 99 TM).
export type SiteArea = { id: string; name: string; kind?: string; status?: string; symbol?: 'hatch' | 'dots'; stroke: string; fill?: string; legend?: string; ring: P[] }

export type SiteSheet = {
  areas?: SiteArea[]
  polygons: P[][][]
  buildings: Building[]
  title: SiteTitle
  background?: Mosaic
  // 0.9 for the pale map, 1 for a photo.
  backgroundOpacity?: number
  // A metre grid in local coordinates (x east, y north from the south-west corner of the property), every n m.
  grid?: number
  paper?: 'A3' | 'A4'
  orientation?: 'portrait' | 'landscape'
  scale?: number
}

export const SITE_SCALES = [200, 250, 400, 500, 1000, 2000, 5000]
const PAPER = { A3: [297, 420], A4: [210, 297] } as const
const FRAME = 8 // mm from the paper edge to the frame
const TITLE_H = 34 // mm, the title block
const PAD_M = 3 // m of map around the property

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const f = (n: number) => (Math.round(n * 100) / 100).toString()
const dec = (n: number, d = 1) => n.toFixed(d).replace('.', ',')
const thousands = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export type Layout = { paperW: number; paperH: number; scale: number; paper: 'A3' | 'A4'; orientation: 'portrait' | 'landscape'; map: { x: number; y: number; w: number; h: number } }

export function layoutSite(s: Pick<SiteSheet, 'polygons' | 'paper' | 'orientation' | 'scale'>): Layout {
  const pts = s.polygons.flatMap((p) => p[0])
  const b = bbox(pts)
  const wM = b.maxX - b.minX + 2 * PAD_M
  const hM = b.maxY - b.minY + 2 * PAD_M
  const paper = s.paper ?? 'A3'
  const orientation = s.orientation ?? (hM > wM ? 'portrait' : 'landscape')
  const [pw, ph] = PAPER[paper]
  const paperW = orientation === 'portrait' ? pw : ph
  const paperH = orientation === 'portrait' ? ph : pw
  const map = { x: FRAME + 2, y: FRAME + 2, w: paperW - 2 * FRAME - 4, h: paperH - 2 * FRAME - 4 - TITLE_H }
  const fits = (sc: number) => (wM * 1000) / sc <= map.w && (hM * 1000) / sc <= map.h
  const scale = s.scale ?? SITE_SCALES.find(fits) ?? SITE_SCALES[SITE_SCALES.length - 1]
  return { paperW, paperH, scale, paper, orientation, map }
}

export function renderSite(s: SiteSheet, backgroundDataUri?: string): string {
  const L = layoutSite(s)
  const rings = s.polygons.flatMap((p) => p)
  const outer = s.polygons.map((p) => p[0])
  const b = bbox(outer.flat())
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const k = 1000 / L.scale // mm on paper per metre
  const mx = L.map.x + L.map.w / 2
  const my = L.map.y + L.map.h / 2
  const X = (x: number) => mx + (x - cx) * k
  const Y = (y: number) => my - (y - cy) * k
  const pt = (p: P) => `${f(X(p.x))},${f(Y(p.y))}`
  const path = (ring: P[]) => `M${ring.map(pt).join('L')}Z`
  const out: string[] = []
  const text = (x: number, y: number, t: string, size = 2.6, o: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; fill?: string; rotate?: number } = {}) =>
    `<text x="${f(x)}" y="${f(y)}" font-size="${size}" text-anchor="${o.anchor ?? 'start'}" ${o.bold ? 'font-weight="bold" ' : ''}fill="${o.fill ?? '#000'}"${o.rotate ? ` transform="rotate(${f(o.rotate)} ${f(x)} ${f(y)})"` : ''}>${esc(t)}</text>`
  // Text with a pale plate behind it, so it reads over the map.
  const label = (x: number, y: number, t: string, size = 2.6, o: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; rotate?: number } = {}) => {
    const w = t.length * size * 0.52 + 1.2
    const x0 = o.anchor === 'middle' ? x - w / 2 : o.anchor === 'end' ? x - w : x - 0.6
    const plate = `<rect x="${f(x0)}" y="${f(y - size * 0.82)}" width="${f(w)}" height="${f(size * 1.15)}" fill="#fff" fill-opacity="0.82"/>`
    return o.rotate ? `<g transform="rotate(${f(o.rotate)} ${f(x)} ${f(y)})">${plate}${text(x, y, t, size, o)}</g>` : plate + text(x, y, t, size, o)
  }

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.paperW}mm" height="${L.paperH}mm" viewBox="0 0 ${L.paperW} ${L.paperH}" font-family="Liberation Sans, Helvetica, Arial, sans-serif">`)
  out.push(`<rect width="${L.paperW}" height="${L.paperH}" fill="#fff"/>`)
  // Ground symbols for marked areas: grass hatching (meadow) and dots (lawn), in the area's line colour.
  const defs = [...new Map((s.areas ?? []).map((a) => [`${a.kind === 'gräsmatta' || a.symbol === 'dots' ? 'dots' : 'hatch'}-${a.stroke}`, a])).values()]
    .map((a) => {
      const id = `sym-${a.symbol ?? (a.kind === 'gräsmatta' ? 'dots' : 'hatch')}-${a.stroke.replace('#', '')}`
      return (a.symbol ?? (a.kind === 'gräsmatta' ? 'dots' : 'hatch')) === 'dots'
        ? `<pattern id="${id}" patternUnits="userSpaceOnUse" width="2.2" height="2.2"><circle cx="1.1" cy="1.1" r="0.28" fill="${a.stroke}"/></pattern>`
        : `<pattern id="${id}" patternUnits="userSpaceOnUse" width="2.4" height="2.4" patternTransform="rotate(60)"><line x1="0" y1="0" x2="0" y2="2.4" stroke="${a.stroke}" stroke-width="0.22"/></pattern>`
    })
    .join('')
  out.push(`<defs>${defs}<clipPath id="map"><rect x="${L.map.x}" y="${L.map.y}" width="${L.map.w}" height="${L.map.h}"/></clipPath></defs>`)

  // Map underlay: the base map, pale, clipped to the drawing area.
  if (s.background && backgroundDataUri) {
    const bg = s.background
    const w = bg.width * bg.res * k
    const h = bg.height * bg.res * k
    out.push(`<g clip-path="url(#map)"><image href="${backgroundDataUri}" x="${f(X(bg.origin.x))}" y="${f(Y(bg.origin.y))}" width="${f(w)}" height="${f(h)}" opacity="${s.backgroundOpacity ?? 0.9}" preserveAspectRatio="none"/></g>`)
  }
  out.push(`<rect x="${L.map.x}" y="${L.map.y}" width="${L.map.w}" height="${L.map.h}" fill="none" stroke="#000" stroke-width="0.25"/>`)

  // Property boundary and its name.
  out.push(`<g clip-path="url(#map)">`)
  const gridLabels: string[] = []
  if (s.grid) {
    // Local coordinates: metres east (x) and north (y) of the property's south-west corner. Thin lines
    // inside the map, the numbers on the frame.
    const g = s.grid
    const colour = s.background && (s.backgroundOpacity ?? 0.9) >= 1 ? '#ffffff' : '#0077aa'
    const lines: string[] = []
    const x0 = Math.ceil(((L.map.x - mx) / k + cx - b.minX) / g) * g
    for (let lx = x0; ; lx += g) {
      const px = X(b.minX + lx)
      if (px > L.map.x + L.map.w) break
      lines.push(`<line x1="${f(px)}" y1="${L.map.y}" x2="${f(px)}" y2="${f(L.map.y + L.map.h)}" stroke="${colour}" stroke-width="0.12" stroke-opacity="0.65"/>`)
      gridLabels.push(label(px, L.map.y + 3.4, String(lx), 2.2, { anchor: 'middle' }))
    }
    const y0 = Math.ceil((cy - (L.map.y + L.map.h - my) / k - b.minY) / g) * g
    for (let ly = y0; ; ly += g) {
      const py = Y(b.minY + ly)
      if (py < L.map.y) break
      lines.push(`<line x1="${L.map.x}" y1="${f(py)}" x2="${f(L.map.x + L.map.w)}" y2="${f(py)}" stroke="${colour}" stroke-width="0.12" stroke-opacity="0.65"/>`)
      gridLabels.push(label(L.map.x + 1.6, py + 0.8, String(ly), 2.2, { anchor: 'start' }))
    }
    out.push(...lines)
  }
  const photoSheet = !!s.background && (s.backgroundOpacity ?? 0.9) >= 1
  const symbolOf = (a: SiteArea) => a.symbol ?? (a.kind === 'gräsmatta' ? 'dots' : 'hatch')
  const fillOf = (a: SiteArea) => (photoSheet ? 'none' : `url(#sym-${symbolOf(a)}-${a.stroke.replace('#', '')})`)
  ;(s.areas ?? []).forEach((a) => {
    const line = photoSheet ? '#ffe14d' : a.stroke
    out.push(`<path d="${path(a.ring)}" fill="${fillOf(a)}" stroke="${line}" stroke-width="${photoSheet ? 0.55 : 0.35}" stroke-dasharray="${photoSheet ? '2.2 1' : '2.4 0.8 0.5 0.8'}" stroke-linejoin="round"/>`)
  })
  for (const r of rings) out.push(`<path d="${path(r)}" fill="none" stroke="#a40000" stroke-width="0.5" stroke-dasharray="3.5 0.9 0.6 0.9" stroke-linejoin="round"/>`)
  const main = outer.reduce((a, c) => (area(c) > area(a) ? c : a), outer[0])
  const c0 = centroid(main)
  const total = s.polygons.reduce((t, p) => t + area(p[0]) - p.slice(1).reduce((u, h) => u + area(h), 0), 0)
  // The name goes in the open part of the property: halfway between the southernmost building and
  // the southern edge (or the middle when there are no buildings), centred on the widest stretch
  // of the property at that height.
  const southBuilding = s.buildings.length ? Math.min(...s.buildings.flatMap((q) => q.corners.map((p) => p.y))) : c0.y
  // The widest free stretch of the property (not over a building or a marked area) between the southernmost
  // building and the southern edge, searched row by row.
  const free = (p: P) => pointInRing(p, main) && !(s.areas ?? []).some((a) => pointInRing(p, a.ring))
  let spot = c0
  let widest = -1
  const top = s.buildings.length ? southBuilding - 6 : b.maxY - 6
  for (let yAt = b.minY + 8; yAt <= top; yAt += 3) {
    let run: number | null = null
    for (let i = 0; i <= 200; i++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / 200
      const ok = free({ x, y: yAt })
      if (ok && run === null) run = x
      if ((!ok || i === 200) && run !== null) {
        // Prefer wide rows, and among equals the northern one (closer to what the plan is about).
        const w = x - run - 0.02 * (top - yAt)
        if (w > widest) {
          widest = w
          spot = { x: (run + x) / 2, y: yAt }
        }
        run = null
      }
    }
  }
  out.push(label(X(spot.x), Y(spot.y), `${s.title.designation}`, 3.4, { anchor: 'middle', bold: true }))
  out.push(label(X(spot.x), Y(spot.y) + 4.4, `Tomtarea ca ${thousands(total)} m²`, 2.5, { anchor: 'middle' }))

  // Buildings, the distance to the boundary from each, and the main sides of the dwelling.
  for (const q of s.buildings) {
    const dwelling = q.kind === 'bostadshus'
    const photo = s.background && (s.backgroundOpacity ?? 0.9) >= 1
    out.push(`<path d="${path(q.corners)}" fill="${dwelling ? '#8f8f8f' : '#c4c4c4'}" fill-opacity="${photo ? 0.35 : 1}" stroke="${photo ? '#fff' : '#000'}" stroke-width="0.35"/>`)
  }
  const nearest = main
  for (const q of s.buildings) {
    const sh = shortest(q.corners, nearest)
    if (sh.d < 0.3) continue
    const a = { x: X(sh.from.x), y: Y(sh.from.y) }
    const e = { x: X(sh.to.x), y: Y(sh.to.y) }
    out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(e.x)}" y2="${f(e.y)}" stroke="#000" stroke-width="0.18"/>`)
    const ang = Math.atan2(e.y - a.y, e.x - a.x)
    for (const p of [a, e]) out.push(`<line x1="${f(p.x - Math.sin(ang) * 1.2)}" y1="${f(p.y + Math.cos(ang) * 1.2)}" x2="${f(p.x + Math.sin(ang) * 1.2)}" y2="${f(p.y - Math.cos(ang) * 1.2)}" stroke="#000" stroke-width="0.25"/>`)
    let deg = (ang * 180) / Math.PI
    if (deg > 90) deg -= 180
    if (deg < -90) deg += 180
    out.push(label((a.x + e.x) / 2, (a.y + e.y) / 2 - 0.9, `${dec(sh.d)} m`, 2.4, { anchor: 'middle', rotate: deg }))
  }
  // Labels beside the buildings with a short leader, on whichever side is free of the distance
  // labels, the other buildings and the other labels.
  type Box = { x0: number; y0: number; x1: number; y1: number }
  const hit = (a: Box, c: Box) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0
  const taken: Box[] = s.buildings.map((q) => {
    const xs = q.corners.map((p) => X(p.x))
    const ys = q.corners.map((p) => Y(p.y))
    return { x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1 }
  })
  for (const q of s.buildings) {
    const sh = shortest(q.corners, nearest)
    if (sh.d < 0.3) continue
    const mxm = (X(sh.from.x) + X(sh.to.x)) / 2
    const mym = (Y(sh.from.y) + Y(sh.to.y)) / 2
    taken.push({ x0: mxm - 8, x1: mxm + 8, y0: mym - 4, y1: mym + 4 })
  }
  s.buildings.forEach((q) => {
    const c = centroid(q.corners)
    const xs = q.corners.map((p) => X(p.x))
    const ys = q.corners.map((p) => Y(p.y))
    const title = `${q.id} ${q.kind === 'bostadshus' ? 'Bostadshus' : 'Komplementbyggnad'}`
    const sub = `${dec(q.width)} × ${dec(q.depth)} m, ca ${q.area} m²`
    const w = Math.max(title.length * 2.5 * 0.55, sub.length * 2.3 * 0.52) + 2
    const options: Array<{ right: boolean; up: boolean }> = [
      { right: true, up: false }, { right: true, up: true }, { right: false, up: false }, { right: false, up: true },
    ]
    let pick = options[0]
    let box: Box = { x0: 0, y0: 0, x1: 0, y1: 0 }
    for (const o of options) {
      const lx = o.right ? Math.max(...xs) + 6 : Math.min(...xs) - 6
      const ly = Y(c.y) + (o.up ? -6 : 7)
      const bx: Box = { x0: o.right ? lx - 1 : lx - w, x1: o.right ? lx + w : lx + 1, y0: ly - 3.6, y1: ly + 4 }
      pick = o
      box = bx
      const own = taken.indexOf(taken[s.buildings.indexOf(q)])
      if (!taken.some((t, i) => i !== own && hit(bx, t))) break
    }
    taken.push(box)
    const lx = pick.right ? box.x0 + 1 : box.x1 - 1
    const ly = (box.y0 + box.y1) / 2 - 0.2
    out.push(`<line x1="${f(X(c.x))}" y1="${f(Y(c.y))}" x2="${f(lx)}" y2="${f(ly)}" stroke="#000" stroke-width="0.15"/>`)
    const anchor = pick.right ? 'start' : 'end'
    out.push(label(lx, ly - 0.6, title, 2.5, { bold: true, anchor }))
    out.push(label(lx, ly + 2.4, sub, 2.3, { anchor }))
  })
  ;(s.areas ?? []).forEach((a, ai) => {
    const c = centroid(a.ring)
    out.push(label(X(c.x), Y(c.y), `A${ai + 1} ${a.name.replace(/\s*\(.*\)$/, '')}`, 2.6, { anchor: 'middle', bold: true }))
    // An area may run over the boundary (a meadow that goes on into the neighbour's land): say how much is inside.
    const whole = area(a.ring)
    const ab = bbox(a.ring)
    let inN = 0
    let allN = 0
    for (let gx = ab.minX + 0.25; gx < ab.maxX; gx += 0.5)
      for (let gy = ab.minY + 0.25; gy < ab.maxY; gy += 0.5) {
        const p = { x: gx, y: gy }
        if (!pointInRing(p, a.ring)) continue
        allN++
        if (outer.some((o) => pointInRing(p, o))) inN++
      }
    const inside = allN ? whole * (inN / allN) : whole
    const tail = whole - inside > Math.max(10, whole * 0.03) ? `, varav ca ${thousands(inside)} m² inom fastigheten` : ''
    out.push(label(X(c.x), Y(c.y) + 3.4, `ca ${thousands(whole)} m²${tail}${a.status && a.status !== 'befintlig' ? `, ${a.status}` : ''}`, 2.3, { anchor: 'middle' }))
  })
  out.push(`</g>`)

  out.push(...gridLabels)

  // North arrow (map north), top right of the drawing area.
  const nx = L.map.x + L.map.w - 12
  const ny = L.map.y + 14
  out.push(`<circle cx="${nx}" cy="${ny}" r="6" fill="#fff" fill-opacity="0.85" stroke="#000" stroke-width="0.25"/><path d="M${nx},${ny - 5}L${nx + 2.4},${ny + 3.6}L${nx},${ny + 2.2}L${nx - 2.4},${ny + 3.6}Z" fill="#000"/>${text(nx, ny - 7.2, 'N', 3.2, { anchor: 'middle', bold: true })}`)

  // Scale bar: five 10 m parts (or 5 m parts when the scale is large).
  const part = L.scale <= 250 ? 5 : L.scale <= 1000 ? 10 : 50
  const sbx = L.map.x + 6
  const sby = L.map.y + L.map.h - 8
  out.push(`<rect x="${sbx - 2}" y="${sby - 6}" width="${f(5 * part * k + 14)}" height="12.5" fill="#fff" fill-opacity="0.85"/>`)
  for (let i = 0; i < 5; i++) out.push(`<rect x="${f(sbx + i * part * k)}" y="${sby}" width="${f(part * k)}" height="1.6" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.2"/>`)
  for (let i = 0; i <= 5; i++) out.push(text(sbx + i * part * k, sby - 1, String(i * part), 2.2, { anchor: 'middle' }))
  out.push(text(sbx + 5 * part * k + 1.5, sby + 1.5, 'm', 2.2))

  // Legend, bottom right of the drawing area.
  const lgx = L.map.x + L.map.w - 62
  const legends = [...new Map((s.areas ?? []).map((a) => [a.legend ?? a.name, a])).values()]
  const lgy = L.map.y + L.map.h - 24 - 5 * legends.length
  out.push(`<rect x="${lgx - 2}" y="${lgy - 4}" width="62" height="${25 + 5 * legends.length}" fill="#fff" fill-opacity="0.88" stroke="#000" stroke-width="0.15"/>`)
  out.push(text(lgx, lgy, 'Teckenförklaring', 2.4, { bold: true }))
  out.push(`<line x1="${lgx}" y1="${lgy + 4}" x2="${lgx + 8}" y2="${lgy + 4}" stroke="#a40000" stroke-width="0.5" stroke-dasharray="3.5 0.9 0.6 0.9"/>${text(lgx + 10, lgy + 4.8, 'Fastighetsgräns', 2.2)}`)
  out.push(`<rect x="${lgx}" y="${lgy + 7}" width="8" height="3.4" fill="#8f8f8f" stroke="#000" stroke-width="0.3"/>${text(lgx + 10, lgy + 9.8, 'Befintligt bostadshus', 2.2)}`)
  out.push(`<rect x="${lgx}" y="${lgy + 12}" width="8" height="3.4" fill="#c4c4c4" stroke="#000" stroke-width="0.3"/>${text(lgx + 10, lgy + 14.8, 'Befintlig komplementbyggnad', 2.2)}`)
  legends.forEach((a, i) => out.push(`<rect x="${lgx}" y="${f(lgy + 17 + i * 5)}" width="8" height="3.4" fill="${photoSheet ? 'none' : fillOf(a)}" stroke="${photoSheet ? '#ffe14d' : a.stroke}" stroke-width="0.3" stroke-dasharray="1.2 0.7"/>${text(lgx + 10, lgy + 19.8 + i * 5, a.legend ?? a.name, 2.0)}`))
  out.push(text(lgx, lgy + 19 + 5 * legends.length, s.grid ? `Rutnät ${s.grid} m från sydvästra hörnet (m)` : 'Avstånd i m till fastighetsgräns', 2))

  // Frame and title block.
  out.push(`<rect x="${FRAME}" y="${FRAME}" width="${L.paperW - 2 * FRAME}" height="${L.paperH - 2 * FRAME}" fill="none" stroke="#000" stroke-width="0.6"/>`)
  const tx = FRAME
  const tw = L.paperW - 2 * FRAME
  const ty = L.paperH - FRAME - TITLE_H
  out.push(`<rect x="${tx}" y="${ty}" width="${tw}" height="${TITLE_H}" fill="#fff" stroke="#000" stroke-width="0.4"/>`)
  const t = s.title
  const date = t.date ?? new Date().toISOString().slice(0, 10)
  const cell = (x: number, y: number, w: number, h: number, caption: string, value: string, size = 3.2, bold = false) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="#000" stroke-width="0.2"/>${text(x + 1.2, y + 2.6, caption, 1.8, { fill: '#555' })}${text(x + 1.2, y + h - 2, value, size, { bold })}`
  const w1 = tw * 0.46
  const w2 = tw * 0.18
  const w3 = tw - w1 - 2 * w2
  const rh = TITLE_H / 3
  out.push(cell(tx, ty, w1, rh, 'Ritning', 'Situationsplan – befintlig', 4, true))
  out.push(cell(tx, ty + rh, w1, rh, 'Fastighet', `${t.municipality} ${t.designation.replace(new RegExp(`^${t.municipality}\\s*`), '')}`, 3.4, true))
  out.push(cell(tx, ty + 2 * rh, w1, rh, 'Adress', t.address ?? '', 3))
  out.push(cell(tx + w1, ty, w2, rh, 'Skala', `1:${L.scale} (${L.paper})`))
  out.push(cell(tx + w1, ty + rh, w2, rh, 'Datum', date))
  out.push(cell(tx + w1, ty + 2 * rh, w2, rh, 'Ritad av', t.author ?? ''))
  out.push(cell(tx + w1 + w2, ty, w2, rh, 'Ritningsnummer', t.drawingNumber ?? 'S-01'))
  out.push(cell(tx + w1 + w2, ty + rh, w2, rh, 'Revision', t.revision ?? '–'))
  out.push(cell(tx + w1 + w2, ty + 2 * rh, w2, rh, 'Koordinatsystem', 'SWEREF 99 TM'))
  const nx0 = tx + w1 + 2 * w2
  out.push(`<rect x="${f(nx0)}" y="${ty}" width="${f(w3)}" height="${TITLE_H}" fill="none" stroke="#000" stroke-width="0.2"/>`)
  const notes = (t.note ?? 'Underlag: Lantmäteriets topografiska webbkarta (Min karta). Fastighetsgräns enligt Lantmäteriets fastighetsregister. Byggnaders läge och storlek är avlästa ur kartan (noggrannhet ca ±1 m), inte inmätta. Nordpil visar kartans norr.').match(/.{1,44}(\s|$)/g) ?? []
  notes.slice(0, 6).forEach((ln, i) => out.push(text(nx0 + 1.2, ty + 4 + i * 3.4, ln.trim(), 2.1)))
  out.push('</svg>')
  return out.join('\n')
}
