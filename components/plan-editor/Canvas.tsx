'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { add, along, bounds, dist, leftNormal, pointSegmentDistance, scale, wallDir, wallLength, wallQuad } from '@/lib/plan/geometry'
import { applyOps, newId, type Op } from '@/lib/plan/ops'
import { fireRatingIn, wallPieces } from '@/lib/plan/sheet'
import type { Fixture, FixtureKind, Opening, OpeningKind, Phase, Plan, Pt, View, Wall } from '@/lib/plan/types'
import { atLength, snapPoint, type Snap } from './snap'

export type Tool = 'select' | 'wall' | 'opening' | 'fixture' | 'room' | 'dimension' | 'calibrate' | 'underlay' | 'pan'

export type ToolOptions = {
  phase: Phase
  thickness: number
  openingKind: OpeningKind
  openingWidth: number
  fixtureKind: FixtureKind
}

export type Selection = { kind: 'wall' | 'opening' | 'fixture' | 'room' | 'dimension'; id: string } | null

type Props = {
  plan: Plan
  view: View
  tool: Tool
  options: ToolOptions
  selection: Selection
  onSelect: (s: Selection) => void
  onDraft: (p: Plan | null) => void
  onCommit: (p: Plan, message: string) => void
  onCalibrate: (a: Pt, b: Pt) => void
  onStatus: (s: string) => void
  fitSignal: number
}

const PHASE_FILL: Record<Phase, string> = { existing: '#9ca3af', new: '#111827', demolish: 'none' }

const DEFAULT_SIZE: Record<FixtureKind, [number, number]> = {
  kitchen: [2400, 600],
  stove: [600, 600],
  sink: [800, 600],
  radiator: [1000, 100],
  exhaust: [250, 250],
  shaft: [500, 400],
  wc: [400, 650],
  shower: [900, 900],
  bath: [1700, 700],
  plug: [250, 250],
  box: [600, 600],
}

type Drag =
  | { type: 'pan'; start: Pt; t0: Pt }
  | { type: 'wall'; id: string; start: Pt; base: Plan }
  | { type: 'vertex'; from: Pt; base: Plan; wallId: string }
  | { type: 'fixture'; id: string; start: Pt; base: Plan; at0: Pt }
  | { type: 'room'; id: string; start: Pt; base: Plan; at0: Pt }
  | { type: 'opening'; id: string; base: Plan; grab: number }
  | { type: 'underlay'; start: Pt; base: Plan; at0: Pt }

export function Canvas(props: Props) {
  const { plan, view, tool, options, selection } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vp, setVp] = useState({ zoom: 0.08, tx: 40, ty: 40 }) // px per mm, screen offset
  const [cursor, setCursor] = useState<Snap | null>(null)
  const [chain, setChain] = useState<Pt | null>(null) // start of the wall/dimension being drawn
  const [calA, setCalA] = useState<Pt | null>(null)
  const [typed, setTyped] = useState('') // length in mm typed while drawing
  const [dragging, setDragging] = useState<Drag['type'] | null>(null)
  const drag = useRef<Drag | null>(null)

  // Switching tool abandons whatever was being drawn.
  const [prevTool, setPrevTool] = useState(tool)
  if (prevTool !== tool) {
    setPrevTool(tool)
    setChain(null)
    setCalA(null)
    setTyped('')
  }

  // ── viewport ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the plan to the view on request (fitSignal) and when the canvas size settles.
  const fitKey = `${props.fitSignal}:${size.w}x${size.h}`
  const [fittedKey, setFittedKey] = useState('')
  if (fittedKey !== fitKey) {
    setFittedKey(fitKey)
    const b = bounds(plan)
    let { minX, minY, maxX, maxY } = b
    if (plan.underlay && plan.walls.length === 0) {
      const u = plan.underlay
      minX = u.x
      minY = u.y
      maxX = u.x + u.widthPx * u.mmPerPx
      maxY = u.y + u.heightPx * u.mmPerPx
    }
    const w = Math.max(maxX - minX, 2000)
    const h = Math.max(maxY - minY, 2000)
    const zoom = Math.min((size.w - 80) / w, (size.h - 80) / h)
    setVp({ zoom, tx: (size.w - w * zoom) / 2 - minX * zoom, ty: (size.h - h * zoom) / 2 - minY * zoom })
  }

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = svgRef.current!.getBoundingClientRect()
      return { x: (e.clientX - r.left - vp.tx) / vp.zoom, y: (e.clientY - r.top - vp.ty) / vp.zoom }
    },
    [vp],
  )

  const tol = 10 / vp.zoom
  const grid = vp.zoom > 0.15 ? 5 : 10

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const k = Math.exp(-e.deltaY * 0.0015)
    const zoom = Math.min(5, Math.max(0.005, vp.zoom * k))
    setVp({ zoom, tx: sx - ((sx - vp.tx) / vp.zoom) * zoom, ty: sy - ((sy - vp.ty) / vp.zoom) * zoom })
  }

  // ── committing edits ─────────────────────────────────────────────────────
  const commitOps = (ops: Op[], message: string, base: Plan = plan): boolean => {
    const res = applyOps(base, ops)
    if (res.errors.length) {
      props.onStatus(res.errors[0])
      props.onDraft(null)
      return false
    }
    props.onDraft(null)
    props.onCommit(res.plan, message)
    return true
  }

  const draftOps = (base: Plan, ops: Op[]) => {
    const res = applyOps(base, ops)
    if (!res.errors.length) props.onDraft(res.plan)
  }

  const snapAt = (raw: Pt, from?: Pt, exclude?: string) => snapPoint(raw, plan, { from, tolerance: tol, grid, exclude })

  // Finishes a wall/dimension segment at `end`.
  const finishSegment = (end: Pt) => {
    if (!chain || dist(chain, end) < 1) return
    if (tool === 'wall') {
      const wall: Wall = { id: newId('v'), a: chain, b: end, thickness: options.thickness, phase: options.phase }
      if (commitOps([{ op: 'add', kind: 'wall', item: wall }], 'Ny vägg')) setChain(end)
    } else if (tool === 'dimension') {
      commitOps([{ op: 'add', kind: 'dimension', item: { id: newId('m'), a: chain, b: end, offset: 500 } }], 'Nytt mått')
      setChain(null)
    }
  }

  // While drawing: digits type an exact length, Enter places the end point
  // (like SketchUp's measurements box), Esc stops drawing. Handled here,
  // before the editor's shortcuts (it skips events we preventDefault).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape' && (chain || calA)) {
        e.preventDefault()
        setChain(null)
        setCalA(null)
        setTyped('')
        return
      }
      if (!chain || e.ctrlKey || e.metaKey) return
      if (/^[0-9.,]$/.test(e.key)) {
        e.preventDefault()
        setTyped((t) => t + e.key)
      } else if (e.key === 'Backspace' && typed) {
        e.preventDefault()
        setTyped((t) => t.slice(0, -1))
      } else if (e.key === 'Enter' && typed) {
        e.preventDefault()
        const mm = Number(typed.replace(',', '.'))
        setTyped('')
        if (cursor && mm > 0) finishSegment(atLength(chain, cursor.pt, mm))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── pointer handling ─────────────────────────────────────────────────────
  const nearestWall = (p: Pt): { wall: Wall; t: number } | null => {
    let best: { wall: Wall; t: number; d: number } | null = null
    for (const w of plan.walls) {
      const { d, t } = pointSegmentDistance(p, w.a, w.b)
      if (d <= Math.max(w.thickness / 2, tol) && (!best || d < best.d)) best = { wall: w, t: t * wallLength(w), d }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toWorld(e)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    if (e.button === 1 || tool === 'pan' || e.altKey) {
      startDrag({ type: 'pan', start: { x: e.clientX, y: e.clientY }, t0: { x: vp.tx, y: vp.ty } })
      return
    }
    const target = (e.target as Element).closest('[data-hit]') as HTMLElement | null
    const hit = target?.dataset.hit
    const hitId = target?.dataset.id ?? ''

    switch (tool) {
      case 'select': {
        if (hit === 'vertex') {
          const w = plan.walls.find((x) => x.id === hitId)!
          const from = target!.dataset.end === 'a' ? w.a : w.b
          startDrag({ type: 'vertex', from, base: plan, wallId: w.id })
          return
        }
        if (hit === 'wall') {
          props.onSelect({ kind: 'wall', id: hitId })
          startDrag({ type: 'wall', id: hitId, start: p, base: plan })
          return
        }
        if (hit === 'opening') {
          props.onSelect({ kind: 'opening', id: hitId })
          const o = plan.openings.find((x) => x.id === hitId)!
          const w = plan.walls.find((x) => x.id === o.wallId)!
          const t = pointSegmentDistance(p, w.a, w.b).t * wallLength(w)
          startDrag({ type: 'opening', id: hitId, base: plan, grab: t - o.offset })
          return
        }
        if (hit === 'fixture') {
          props.onSelect({ kind: 'fixture', id: hitId })
          const f = plan.fixtures.find((x) => x.id === hitId)!
          startDrag({ type: 'fixture', id: hitId, start: p, base: plan, at0: { x: f.x, y: f.y } })
          return
        }
        if (hit === 'room') {
          props.onSelect({ kind: 'room', id: hitId })
          const r = plan.rooms.find((x) => x.id === hitId)!
          startDrag({ type: 'room', id: hitId, start: p, base: plan, at0: r.at })
          return
        }
        if (hit === 'dimension') {
          props.onSelect({ kind: 'dimension', id: hitId })
          return
        }
        props.onSelect(null)
        startDrag({ type: 'pan', start: { x: e.clientX, y: e.clientY }, t0: { x: vp.tx, y: vp.ty } })
        return
      }
      case 'wall':
      case 'dimension': {
        const s = snapAt(p, chain ?? undefined)
        if (!chain) setChain(s.pt)
        else finishSegment(s.pt)
        return
      }
      case 'opening': {
        const nw = nearestWall(p)
        if (!nw) {
          props.onStatus('Klicka på en vägg för att placera öppningen')
          return
        }
        const width = options.openingWidth
        const len = wallLength(nw.wall)
        const offset = Math.round(Math.max(0, Math.min(len - width, nw.t - width / 2)) / 10) * 10
        const o: Opening = { id: newId('o'), wallId: nw.wall.id, kind: options.openingKind, offset, width, phase: options.phase }
        if (o.kind === 'door') Object.assign(o, { hinge: 'a', swing: 'left' })
        if (commitOps([{ op: 'add', kind: 'opening', item: o }], 'Ny öppning')) props.onSelect({ kind: 'opening', id: o.id })
        return
      }
      case 'fixture': {
        const s = snapAt(p)
        const [w, d] = DEFAULT_SIZE[options.fixtureKind]
        const f: Fixture = { id: newId('i'), kind: options.fixtureKind, x: s.pt.x, y: s.pt.y, w, d, phase: options.phase }
        if (commitOps([{ op: 'add', kind: 'fixture', item: f }], 'Ny inredning')) props.onSelect({ kind: 'fixture', id: f.id })
        return
      }
      case 'room': {
        const id = newId('r')
        if (commitOps([{ op: 'add', kind: 'room', item: { id, name: 'Rum', at: { x: Math.round(p.x), y: Math.round(p.y) } } }], 'Nytt rum'))
          props.onSelect({ kind: 'room', id })
        return
      }
      case 'calibrate': {
        if (!plan.underlay) {
          props.onStatus('Lägg in en underlagsritning först')
          return
        }
        if (!calA) {
          setCalA(p)
          props.onStatus('Klicka på mätsträckans andra ände')
        } else {
          props.onCalibrate(calA, p)
          setCalA(null)
        }
        return
      }
      case 'underlay': {
        if (!plan.underlay) return
        startDrag({ type: 'underlay', start: p, base: plan, at0: { x: plan.underlay.x, y: plan.underlay.y } })
        return
      }
    }
  }

  const startDrag = (d: Drag) => {
    drag.current = d
    setDragging(d.type)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e)
    const d = drag.current
    if (!d) {
      if (tool === 'wall' || tool === 'dimension') setCursor(snapAt(p, chain ?? undefined))
      else if (tool === 'fixture' || tool === 'calibrate') setCursor({ pt: p, kind: 'grid' })
      else setCursor(null)
      return
    }
    switch (d.type) {
      case 'pan':
        setVp((v) => ({ ...v, tx: d.t0.x + e.clientX - d.start.x, ty: d.t0.y + e.clientY - d.start.y }))
        return
      case 'vertex': {
        const s = snapPoint(p, d.base, { tolerance: tol, grid, exclude: d.wallId })
        setCursor(s)
        draftOps(d.base, [{ op: 'moveVertex', from: d.from, to: s.pt }])
        return
      }
      case 'wall': {
        let dx = Math.round((p.x - d.start.x) / grid) * grid
        let dy = Math.round((p.y - d.start.y) / grid) * grid
        if (e.shiftKey) {
          // Move only perpendicular to the wall.
          const w = d.base.walls.find((x) => x.id === d.id)!
          const n = leftNormal(wallDir(w))
          const k = dx * n.x + dy * n.y
          dx = Math.round(n.x * k)
          dy = Math.round(n.y * k)
        }
        draftOps(d.base, [{ op: 'moveWall', id: d.id, dx, dy }])
        return
      }
      case 'opening': {
        const o = d.base.openings.find((x) => x.id === d.id)!
        const w = d.base.walls.find((x) => x.id === o.wallId)!
        const t = pointSegmentDistance(p, w.a, w.b).t * wallLength(w)
        const offset = Math.round(Math.max(0, Math.min(wallLength(w) - o.width, t - d.grab)) / grid) * grid
        draftOps(d.base, [{ op: 'update', kind: 'opening', id: d.id, patch: { offset } }])
        return
      }
      case 'fixture':
      case 'room': {
        const x = Math.round((d.at0.x + p.x - d.start.x) / grid) * grid
        const y = Math.round((d.at0.y + p.y - d.start.y) / grid) * grid
        draftOps(d.base, [d.type === 'fixture' ? { op: 'update', kind: 'fixture', id: d.id, patch: { x, y } } : { op: 'update', kind: 'room', id: d.id, patch: { at: { x, y } } }])
        return
      }
      case 'underlay': {
        const u = d.base.underlay!
        draftOps(d.base, [{ op: 'setUnderlay', underlay: { ...u, x: Math.round(d.at0.x + p.x - d.start.x), y: Math.round(d.at0.y + p.y - d.start.y) } }])
        return
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    if (!d || d.type === 'pan') return
    // The draft is what's on screen; commit it relative to the drag's base.
    const label: Record<string, string> = { vertex: 'Flyttade väggände', wall: 'Flyttade vägg', opening: 'Flyttade öppning', fixture: 'Flyttade inredning', room: 'Flyttade rumsnamn', underlay: 'Flyttade underlag' }
    if (plan !== d.base) props.onCommit(plan, label[d.type])
    props.onDraft(null)
    void e
  }

  // ── rendering (world mm inside one transform) ───────────────────────────
  const px = (n: number) => n / vp.zoom // screen pixels → mm
  const visible = (ph: Phase) => view === 'efter' || ph !== 'new'
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id

  // Same wall bodies as the printed sheet: cut at openings, corners joined.
  const pieces = useMemo(() => wallPieces(plan, view), [plan, view])

  const preview = chain && cursor ? { a: chain, b: cursor.pt } : null

  return (
    <svg
      ref={svgRef}
      data-testid="plan-canvas"
      className={`h-full w-full touch-none select-none bg-white ${tool === 'pan' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="pe-hatch" width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={px(8)} stroke="#374151" strokeWidth={px(1.5)} />
        </pattern>
      </defs>
      <g transform={`translate(${vp.tx} ${vp.ty}) scale(${vp.zoom})`}>
        {plan.underlay && (
          <image
            data-testid="underlay"
            href={plan.underlay.src}
            x={plan.underlay.x}
            y={plan.underlay.y}
            width={plan.underlay.widthPx * plan.underlay.mmPerPx}
            height={plan.underlay.heightPx * plan.underlay.mmPerPx}
            opacity={plan.underlay.opacity}
            transform={`rotate(${plan.underlay.rotation} ${plan.underlay.x} ${plan.underlay.y})`}
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none' }}
          />
        )}
        {pieces.map(({ wall: w, quad: q, style }, i) => {
          const sel = isSel('wall', w.id)
          const pts = q.map((p) => `${p.x},${p.y}`).join(' ')
          return (
            <g key={`${w.id}-${i}`}>
              <polygon
                data-hit="wall"
                data-id={w.id}
                data-testid={i === pieces.findIndex((p) => p.wall.id === w.id) ? `wall-${w.id}` : undefined}
                points={pts}
                fill={PHASE_FILL[style]}
                fillOpacity={plan.underlay ? 0.75 : 1}
                stroke={sel ? '#2563eb' : style === 'demolish' ? '#dc2626' : '#111827'}
                strokeWidth={px(sel ? 2.5 : 1)}
                strokeDasharray={style === 'demolish' ? `${px(6)} ${px(4)}` : undefined}
              />
              {w.loadBearing && style !== 'demolish' && <polygon points={pts} fill="url(#pe-hatch)" opacity={0.5} pointerEvents="none" />}
            </g>
          )
        })}
        {plan.walls.map((w) => {
          const rating = fireRatingIn(w, view)
          if (!rating || !visible(w.phase)) return null
          const off = scale(leftNormal(wallDir(w)), w.thickness / 2 + px(5))
          const a = add(w.a, off)
          const b = add(w.b, off)
          return <line key={`fire-${w.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dc2626" strokeWidth={px(1.5)} strokeDasharray={`${px(10)} ${px(3)} ${px(2)} ${px(3)}`} pointerEvents="none" />
        })}
        {plan.openings.map((o) => {
          if (view === 'fore' && o.phase === 'new') return null
          const w = plan.walls.find((x) => x.id === o.wallId)
          if (!w) return null
          const part = { ...w, a: along(w, o.offset), b: along(w, o.offset + o.width), thickness: w.thickness + px(2) }
          const q = wallQuad(part)
          const sel = isSel('opening', o.id)
          const n = leftNormal(wallDir(w))
          const hingeAtA = (o.hinge ?? 'a') === 'a'
          const side = (o.swing ?? 'left') === 'left' ? 1 : -1
          const hinge = add(hingeAtA ? part.a : part.b, scale(n, (side * w.thickness) / 2))
          const leaf = add(hinge, scale(n, side * o.width))
          const closed = add(hingeAtA ? part.b : part.a, scale(n, (side * w.thickness) / 2))
          const cross = (leaf.x - hinge.x) * (closed.y - hinge.y) - (leaf.y - hinge.y) * (closed.x - hinge.x)
          const struck = view === 'efter' && o.phase === 'demolish'
          return (
            <g key={o.id} data-hit="opening" data-id={o.id} data-testid={`opening-${o.id}`}>
              <polygon
                points={q.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={struck ? '#111827' : '#ffffff'}
                stroke={sel ? '#2563eb' : o.phase === 'new' && view === 'efter' ? '#16a34a' : '#6b7280'}
                strokeWidth={px(sel ? 2.5 : 1)}
              />
              {o.kind === 'door' && !struck && (
                <>
                  <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} stroke="#111827" strokeWidth={px(1)} />
                  <path d={`M ${leaf.x} ${leaf.y} A ${o.width} ${o.width} 0 0 ${cross > 0 ? 1 : 0} ${closed.x} ${closed.y}`} fill="none" stroke="#111827" strokeWidth={px(0.75)} />
                </>
              )}
              {o.kind === 'window' && <line x1={part.a.x} y1={part.a.y} x2={part.b.x} y2={part.b.y} stroke="#111827" strokeWidth={px(1)} />}
            </g>
          )
        })}
        {plan.fixtures.map((f) => {
          if (!visible(f.phase)) return null
          const sel = isSel('fixture', f.id)
          const style = view === 'fore' ? 'existing' : f.phase
          const stroke = sel ? '#2563eb' : style === 'demolish' ? '#dc2626' : style === 'new' ? '#16a34a' : '#374151'
          const round = f.kind === 'exhaust' || f.kind === 'plug'
          return (
            <g key={f.id} data-hit="fixture" data-id={f.id} data-testid={`fixture-${f.id}`} transform={f.rotation ? `rotate(${f.rotation} ${f.x} ${f.y})` : undefined}>
              {round ? (
                <circle cx={f.x} cy={f.y} r={Math.max(f.w, f.d) / 2} fill="#fff" stroke={stroke} strokeWidth={px(sel ? 2.5 : 1.25)} strokeDasharray={style === 'demolish' ? `${px(5)} ${px(3)}` : undefined} />
              ) : (
                <rect x={f.x - f.w / 2} y={f.y - f.d / 2} width={f.w} height={f.d} fill="#fff" fillOpacity={0.85} stroke={stroke} strokeWidth={px(sel ? 2.5 : 1.25)} strokeDasharray={style === 'demolish' ? `${px(5)} ${px(3)}` : undefined} />
              )}
              <text x={f.x} y={f.y + px(4)} fontSize={px(11)} textAnchor="middle" fill="#374151" pointerEvents="none">
                {f.label ?? FIXTURE_SHORT[f.kind]}
              </text>
            </g>
          )
        })}
        {plan.rooms.map((r) => (
          <text
            key={r.id}
            data-hit="room"
            data-id={r.id}
            data-testid={`room-${r.id}`}
            x={r.at.x}
            y={r.at.y}
            fontSize={px(14)}
            fontWeight={600}
            textAnchor="middle"
            fill={isSel('room', r.id) ? '#2563eb' : '#111827'}
            style={{ cursor: 'move' }}
          >
            {view === 'efter' && r.renamed ? r.renamed : r.name}
          </text>
        ))}
        {plan.dimensions.map((dm) => {
          const n = leftNormal(wallDir({ id: '', a: dm.a, b: dm.b, thickness: 0, phase: 'existing' }))
          const a = add(dm.a, scale(n, dm.offset))
          const b = add(dm.b, scale(n, dm.offset))
          const mid = scale(add(a, b), 0.5)
          const sel = isSel('dimension', dm.id)
          return (
            <g key={dm.id} data-hit="dimension" data-id={dm.id}>
              <line x1={dm.a.x} y1={dm.a.y} x2={a.x} y2={a.y} stroke="#6b7280" strokeWidth={px(0.75)} />
              <line x1={dm.b.x} y1={dm.b.y} x2={b.x} y2={b.y} stroke="#6b7280" strokeWidth={px(0.75)} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? '#2563eb' : '#111827'} strokeWidth={px(sel ? 2 : 1)} />
              <text x={mid.x} y={mid.y - px(4)} fontSize={px(12)} textAnchor="middle" fill="#111827">
                {Math.round(dist(dm.a, dm.b))}
              </text>
            </g>
          )
        })}
        {selection?.kind === 'wall' &&
          (() => {
            const w = plan.walls.find((x) => x.id === selection.id)
            if (!w) return null
            return (['a', 'b'] as const).map((end) => (
              <circle key={end} data-hit="vertex" data-id={w.id} data-end={end} data-testid={`vertex-${end}`} cx={w[end].x} cy={w[end].y} r={px(6)} fill="#fff" stroke="#2563eb" strokeWidth={px(2)} style={{ cursor: 'move' }} />
            ))
          })()}
        {preview && (
          <g pointerEvents="none">
            <line x1={preview.a.x} y1={preview.a.y} x2={preview.b.x} y2={preview.b.y} stroke="#2563eb" strokeWidth={tool === 'wall' ? options.thickness : px(1.5)} strokeOpacity={tool === 'wall' ? 0.35 : 1} />
            <text data-testid="draw-length" x={(preview.a.x + preview.b.x) / 2} y={(preview.a.y + preview.b.y) / 2 - px(10)} fontSize={px(13)} textAnchor="middle" fill="#2563eb">
              {typed ? `${typed} mm ↵` : `${Math.round(dist(preview.a, preview.b))} mm`}
            </text>
          </g>
        )}
        {calA && cursor && <line x1={calA.x} y1={calA.y} x2={cursor.pt.x} y2={cursor.pt.y} stroke="#d97706" strokeWidth={px(2)} pointerEvents="none" />}
        {cursor?.guide && <line x1={cursor.guide.from.x} y1={cursor.guide.from.y} x2={cursor.guide.to.x} y2={cursor.guide.to.y} stroke="#d946ef" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} pointerEvents="none" />}
        {cursor && (tool === 'wall' || tool === 'dimension' || dragging === 'vertex') && (
          <circle cx={cursor.pt.x} cy={cursor.pt.y} r={px(5)} fill="none" stroke={SNAP_COLOR[cursor.kind]} strokeWidth={px(2)} pointerEvents="none" />
        )}
      </g>
      <text x={10} y={size.h - 10} fontSize={11} fill="#6b7280">
        {cursor ? `${SNAP_LABEL[cursor.kind]} · x ${Math.round(cursor.pt.x)} y ${Math.round(cursor.pt.y)}` : ''}
      </text>
    </svg>
  )
}

const FIXTURE_SHORT: Record<FixtureKind, string> = {
  kitchen: 'Kök',
  stove: 'Spis',
  sink: 'Disk',
  radiator: 'Rad',
  exhaust: 'F',
  shaft: 'Schakt',
  wc: 'WC',
  shower: 'Dusch',
  bath: 'Bad',
  plug: 'P',
  box: '',
}

const SNAP_COLOR: Record<Snap['kind'], string> = { endpoint: '#16a34a', onwall: '#0891b2', axis: '#dc2626', align: '#d946ef', grid: '#6b7280' }
const SNAP_LABEL: Record<Snap['kind'], string> = { endpoint: 'Ände', onwall: 'På vägg', axis: 'Rät vinkel', align: 'I linje', grid: 'Rutnät' }
