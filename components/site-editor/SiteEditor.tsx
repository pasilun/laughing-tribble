'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { itemArea, itemLength, KINDS, STATUSES, DEFAULT_COLOR, type ItemType, type SiteDoc, type SiteItem } from '@/lib/site/doc'
import { centroid, closestOnSegment, dist, type P } from '@/lib/site/geometry'

// The site page: the property seen from above (the pale map or the aerial photo), with a pen for what the
// person wants to say about the land – areas, lines, points, each with a name, a kind and a status. What is
// drawn is saved in local metres (x east, y north of the property's south-west corner) and Claude reads it
// with site_get, so "the lawn" is the outline drawn here, not a guess from a screenshot.

type Tool = 'select' | 'hand' | 'area' | 'line' | 'point' | 'free-area' | 'free-line'
type Underlay = 'none' | 'karta' | 'flyg'
type Loaded = { url: string; extent: { minX: number; minY: number; maxX: number; maxY: number } }

const TOOLS: Array<[Tool, string, string]> = [
  ['select', 'Välj / flytta', 'V'],
  ['hand', 'Panorera', 'H'],
  ['area', 'Yta (klicka punkter)', 'A'],
  ['free-area', 'Yta (frihand)', 'F'],
  ['line', 'Linje (klicka punkter)', 'L'],
  ['free-line', 'Linje (frihand)', 'G'],
  ['point', 'Punkt', 'O'],
]
const HINT: Record<Tool, string> = {
  select: 'Klicka på ett objekt. Dra i det för att flytta, dra i en punkt för att ändra formen.',
  hand: 'Dra för att flytta kartan. Mushjul zoomar.',
  area: 'Klicka ut hörnen. Dubbelklicka, Enter eller klicka på första punkten för att stänga. Esc avbryter.',
  'free-area': 'Håll ner musen eller pennan och rita runt området. Det stängs när du släpper.',
  line: 'Klicka ut punkterna. Dubbelklicka eller Enter avslutar. Esc avbryter.',
  'free-line': 'Håll ner och rita linjen. Den sparas när du släpper.',
  point: 'Klicka där punkten ska sitta.',
}
const COLORS: Array<[string, string]> = [
  ['#d40000', 'Röd'],
  ['#e8870e', 'Orange'],
  ['#d9b800', 'Gul'],
  ['#2f8f2f', 'Grön'],
  ['#1b6fd1', 'Blå'],
  ['#7b3fb5', 'Lila'],
  ['#222222', 'Svart'],
]

const fmt = (n: number, d = 1) => n.toFixed(d).replace('.', ',')
const tagOf = (items: SiteItem[], it: SiteItem) => `${it.type === 'area' ? 'A' : it.type === 'line' ? 'L' : 'P'}${items.filter((x) => x.type === it.type).indexOf(it) + 1}`

function simplify(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts
  const a = pts[0]
  const b = pts[pts.length - 1]
  let idx = 0
  let dm = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(pts[i], closestOnSegment(pts[i], a, b))
    if (d > dm) {
      idx = i
      dm = d
    }
  }
  if (dm > tol) return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)]
  return [a, b]
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'move'; id: string; start: P; orig: P[]; moved: boolean }
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'free' }

export function SiteEditor({ slug }: { slug: string }) {
  const [doc, setDoc] = useState<SiteDoc | null>(null)
  const [rev, setRev] = useState(0)
  const [items, setItems] = useState<SiteItem[]>([])
  const [saved, setSaved] = useState('[]')
  const [past, setPast] = useState<SiteItem[][]>([])
  const [future, setFuture] = useState<SiteItem[][]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [draft, setDraft] = useState<P[]>([])
  const [cursor, setCursor] = useState<P | null>(null)
  const [underlay, setUnderlay] = useState<Underlay>('none')
  const [layers, setLayers] = useState<Partial<Record<'karta' | 'flyg', Loaded | 'loading' | 'error'>>>({})
  const [grid, setGrid] = useState(true)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ cx: 40, cy: 85, z: 4 })
  const [status, setStatus] = useState('')
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const fitted = useRef(false)
  const space = useRef(false)

  const dirty = useMemo(() => JSON.stringify(items) !== saved, [items, saved])

  // ── loading ──────────────────────────────────────────────────────────────
  const applyLoaded = useCallback((ok: boolean, b: { doc?: SiteDoc; revision?: { n: number }; errors?: string[] }) => {
    if (!ok || !b.doc || !b.revision) {
      setError(b.errors?.[0] ?? 'kunde inte läsa tomten')
      return
    }
    setDoc(b.doc)
    setRev(b.revision.n)
    setItems(b.doc.items)
    setSaved(JSON.stringify(b.doc.items))
    setPast([])
    setFuture([])
    setSel(null)
    setConflict(false)
  }, [])
  const load = useCallback(() => fetch(`/api/sites/${slug}`).then(async (r) => applyLoaded(r.ok, await r.json())), [slug, applyLoaded])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  // Fit the property to the page once.
  useEffect(() => {
    if (!doc || fitted.current || size.w < 50 || size.h < 50) return
    const xs = doc.property.flatMap((p) => p[0].map((q) => q.x))
    const ys = doc.property.flatMap((p) => p[0].map((q) => q.y))
    const w = Math.max(...xs) - Math.min(...xs) + 20
    const h = Math.max(...ys) - Math.min(...ys) + 20
    fitted.current = true
    setView({ cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, z: Math.min(size.w / w, size.h / h) })
  }, [doc, size])

  const loadLayer = useCallback(
    async (layer: 'karta' | 'flyg') => {
      setLayers((l) => ({ ...l, [layer]: 'loading' }))
      try {
        const r = await fetch(`/api/sites/${slug}/map?layer=${layer}`)
        if (!r.ok) throw new Error(String(r.status))
        const [minX, minY, maxX, maxY] = (r.headers.get('X-Extent') ?? '').split(',').map(Number)
        const url = URL.createObjectURL(await r.blob())
        setLayers((l) => ({ ...l, [layer]: { url, extent: { minX, minY, maxX, maxY } } }))
      } catch {
        setLayers((l) => ({ ...l, [layer]: 'error' }))
      }
    },
    [slug],
  )
  const chooseUnderlay = (u: Underlay) => {
    setUnderlay(u)
    if (u !== 'none' && !layers[u]) loadLayer(u)
  }

  // ── coordinates ──────────────────────────────────────────────────────────
  const toScreen = useCallback((p: P) => ({ x: (p.x - view.cx) * view.z + size.w / 2, y: size.h / 2 - (p.y - view.cy) * view.z }), [view, size])
  const toWorld = useCallback((sx: number, sy: number): P => ({ x: (sx - size.w / 2) / view.z + view.cx, y: view.cy - (sy - size.h / 2) / view.z }), [view, size])
  const evWorld = (e: { clientX: number; clientY: number }): P => {
    const r = svgRef.current!.getBoundingClientRect()
    return toWorld(e.clientX - r.left, e.clientY - r.top)
  }

  // ── editing ──────────────────────────────────────────────────────────────
  const commit = useCallback(
    (next: SiteItem[], before: SiteItem[] = items) => {
      setPast((p) => [...p.slice(-60), before])
      setFuture([])
      setItems(next)
    },
    [items],
  )
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p
      setFuture((f) => [items, ...f])
      setItems(p[p.length - 1])
      return p.slice(0, -1)
    })
  }, [items])
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      setPast((p) => [...p, items])
      setItems(f[0])
      return f.slice(1)
    })
  }, [items])

  const newId = useCallback(() => {
    const ids = new Set(items.map((i) => i.id))
    let k = items.length + 1
    while (ids.has(`i${k}`)) k++
    return `i${k}`
  }, [items])

  const add = useCallback(
    (type: ItemType, points: P[]) => {
      const it: SiteItem = { id: newId(), type, name: type === 'area' ? 'Ny yta' : type === 'line' ? 'Ny linje' : 'Ny punkt', kind: 'annat', status: 'idé', color: DEFAULT_COLOR, points: points.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })) }
      commit([...items, it])
      setSel(it.id)
      setTool('select')
      setTimeout(() => nameRef.current?.select(), 30)
    },
    [items, commit, newId],
  )

  const finishDraft = useCallback(() => {
    const need = tool === 'area' ? 3 : 2
    if (draft.length >= need) add(tool === 'area' ? 'area' : 'line', draft)
    setDraft([])
  }, [draft, tool, add])

  const patch = (id: string, p: Partial<SiteItem>) => commit(items.map((i) => (i.id === id ? { ...i, ...p } : i)))
  const remove = useCallback(
    (id: string) => {
      commit(items.filter((i) => i.id !== id))
      setSel(null)
    },
    [items, commit],
  )

  const save = useCallback(async () => {
    setStatus('Sparar…')
    const r = await fetch(`/api/sites/${slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, baseRevision: rev, message: 'Ändrad på sidan' }) })
    const b = await r.json()
    if (r.status === 409) {
      setConflict(true)
      setStatus('')
      return
    }
    if (!r.ok) {
      setStatus(b.errors?.join(' ') ?? 'kunde inte spara')
      return
    }
    setDoc(b.doc)
    setRev(b.revision.n)
    setSaved(JSON.stringify(b.doc.items))
    setStatus(`Sparad (revision ${b.revision.n})`)
  }, [items, rev, slug])

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      if (e.code === 'Space' && !typing) space.current = true
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
        return
      }
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Escape') {
        setDraft([])
        drag.current = null
        setSel(null)
        return
      }
      if (e.key === 'Enter' && draft.length) return finishDraft()
      if (e.key === 'Backspace' && draft.length) return setDraft((d) => d.slice(0, -1))
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) return remove(sel)
      const t2 = TOOLS.find(([, , k]) => k.toLowerCase() === e.key.toLowerCase())
      if (t2 && !e.ctrlKey && !e.metaKey) {
        setTool(t2[0])
        setDraft([])
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [save, undo, redo, remove, finishDraft, draft.length, sel])

  // Wheel zoom about the pointer (a native listener: React's is passive).
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top
      setView((v) => {
        const z = Math.min(80, Math.max(1.2, v.z * Math.exp(-e.deltaY * 0.0015)))
        const wx = (sx - size.w / 2) / v.z + v.cx
        const wy = v.cy - (sy - size.h / 2) / v.z
        return { z, cx: wx - (sx - size.w / 2) / z, cy: wy + (sy - size.h / 2) / z }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size, doc])

  // ── pointer ──────────────────────────────────────────────────────────────
  const onDown = (e: React.PointerEvent) => {
    const svg = svgRef.current!
    const w = evWorld(e)
    if (e.button === 1 || e.button === 2 || tool === 'hand' || space.current || (tool === 'select' && e.button === 0)) {
      if (tool === 'select' && !space.current && e.button === 0) setSel(null)
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cx, cy: view.cy }
      svg.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'point') return add('point', [w])
    if (tool === 'free-area' || tool === 'free-line') {
      drag.current = { kind: 'free' }
      svg.setPointerCapture(e.pointerId)
      setDraft([w])
      return
    }
    if (tool === 'area' || tool === 'line') {
      // Clicking the first point of an area closes it.
      if (tool === 'area' && draft.length >= 3 && dist(toScreen(draft[0]), { x: e.clientX - svg.getBoundingClientRect().left, y: e.clientY - svg.getBoundingClientRect().top }) < 10) return finishDraft()
      setDraft((d) => [...d, w])
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const w = evWorld(e)
    setCursor(w)
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.sx) / v.z, cy: d.cy + (e.clientY - d.sy) / v.z }))
    } else if (d.kind === 'free') {
      setDraft((pts) => (pts.length && dist(toScreen(pts[pts.length - 1]), toScreen(w)) < 4 ? pts : [...pts, w]))
    } else if (d.kind === 'move') {
      const dx = w.x - d.start.x
      const dy = w.y - d.start.y
      d.moved = d.moved || Math.hypot(dx, dy) * view.z > 3
      if (d.moved) setItems((its) => its.map((i) => (i.id === d.id ? { ...i, points: d.orig.map((p) => ({ x: Math.round((p.x + dx) * 100) / 100, y: Math.round((p.y + dy) * 100) / 100 })) } : i)))
    } else if (d.kind === 'vertex') {
      setItems((its) => its.map((i) => (i.id === d.id ? { ...i, points: i.points.map((p, k) => (k === d.index ? { x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 } : p)) } : i)))
    }
  }

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    try {
      svgRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // not captured
    }
    if (!d) return
    if (d.kind === 'free') {
      const pts = simplify(draft, 3 / view.z)
      const need = tool === 'free-area' ? 3 : 2
      setDraft([])
      if (pts.length >= need) add(tool === 'free-area' ? 'area' : 'line', pts)
    } else if (d.kind === 'move' || d.kind === 'vertex') {
      // The live edit already changed `items`; record the state before it for undo.
      const before = beforeDrag.current
      if (before && JSON.stringify(before) !== JSON.stringify(items)) {
        setPast((p) => [...p.slice(-60), before])
        setFuture([])
      }
      beforeDrag.current = null
    }
  }
  const beforeDrag = useRef<SiteItem[] | null>(null)

  const startItemDrag = (e: React.PointerEvent, it: SiteItem) => {
    if (tool !== 'select' || e.button !== 0) return
    e.stopPropagation()
    setSel(it.id)
    beforeDrag.current = items
    drag.current = { kind: 'move', id: it.id, start: evWorld(e), orig: it.points, moved: false }
    svgRef.current!.setPointerCapture(e.pointerId)
  }
  const startVertexDrag = (e: React.PointerEvent, it: SiteItem, index: number) => {
    e.stopPropagation()
    if (e.altKey || e.shiftKey) {
      const need = it.type === 'area' ? 3 : 2
      if (it.points.length > need && it.type !== 'point') patch(it.id, { points: it.points.filter((_, k) => k !== index) })
      return
    }
    beforeDrag.current = items
    drag.current = { kind: 'vertex', id: it.id, index }
    svgRef.current!.setPointerCapture(e.pointerId)
  }
  const insertVertex = (e: React.PointerEvent, it: SiteItem, after: number) => {
    e.stopPropagation()
    const a = it.points[after]
    const b = it.points[(after + 1) % it.points.length]
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const points = [...it.points.slice(0, after + 1), mid, ...it.points.slice(after + 1)]
    beforeDrag.current = items
    setItems(items.map((i) => (i.id === it.id ? { ...i, points } : i)))
    drag.current = { kind: 'vertex', id: it.id, index: after + 1 }
    svgRef.current!.setPointerCapture(e.pointerId)
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  const path = (pts: P[], close: boolean) => `M${pts.map((p) => { const s = toScreen(p); return `${s.x.toFixed(1)},${s.y.toFixed(1)}` }).join('L')}${close ? 'Z' : ''}`
  const gridStep = view.z > 6 ? 10 : view.z > 2.2 ? 20 : 50

  if (error) return <main className="p-6 text-red-700">{error} <Link className="underline" href="/plans/site">Till tomterna</Link></main>
  if (!doc) return <main className="p-6 text-sm text-zinc-500">Läser in…</main>

  const xs = doc.property.flatMap((p) => p[0].map((q) => q.x))
  const ys = doc.property.flatMap((p) => p[0].map((q) => q.y))
  const current = underlay === 'none' ? null : layers[underlay]
  const selected = items.find((i) => i.id === sel) ?? null
  const photo = underlay === 'flyg'

  const gridLines: React.ReactElement[] = []
  if (grid) {
    const x0 = Math.floor((view.cx - size.w / 2 / view.z) / gridStep) * gridStep
    const x1 = view.cx + size.w / 2 / view.z
    const y0 = Math.floor((view.cy - size.h / 2 / view.z) / gridStep) * gridStep
    const y1 = view.cy + size.h / 2 / view.z
    const col = photo ? 'rgba(255,255,255,0.55)' : 'rgba(0,119,170,0.4)'
    for (let x = x0; x <= x1; x += gridStep) {
      const s = toScreen({ x, y: 0 }).x
      gridLines.push(<line key={`gx${x}`} x1={s} y1={0} x2={s} y2={size.h} stroke={col} strokeWidth={0.7} />)
      gridLines.push(<text key={`tx${x}`} x={s + 3} y={12} fontSize={10} fill={photo ? '#fff' : '#046'} paintOrder="stroke" stroke={photo ? '#000' : '#fff'} strokeWidth={2.5}>{x}</text>)
    }
    for (let y = y0; y <= y1; y += gridStep) {
      const s = toScreen({ x: 0, y }).y
      gridLines.push(<line key={`gy${y}`} x1={0} y1={s} x2={size.w} y2={s} stroke={col} strokeWidth={0.7} />)
      gridLines.push(<text key={`ty${y}`} x={3} y={s - 3} fontSize={10} fill={photo ? '#fff' : '#046'} paintOrder="stroke" stroke={photo ? '#000' : '#fff'} strokeWidth={2.5}>{y}</text>)
    }
  }

  const draftPts = draft.length && cursor && (tool === 'area' || tool === 'line') ? [...draft, cursor] : draft
  const cursorStyle = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-white px-3 py-2 text-sm">
        <Link href="/plans/site" className="text-blue-700 underline">
          ← Tomter
        </Link>
        <h1 className="font-semibold" data-testid="site-title">
          {doc.designation}
        </h1>
        <div className="flex overflow-hidden rounded border">
          {(['none', 'karta', 'flyg'] as const).map((u) => (
            <button key={u} data-testid={`underlay-${u}`} className={`px-2 py-1 ${underlay === u ? 'bg-zinc-900 text-white' : ''}`} onClick={() => chooseUnderlay(u)}>
              {u === 'none' ? 'Ingen' : u === 'karta' ? 'Karta' : 'Flygbild'}
            </button>
          ))}
        </div>
        {current === 'loading' && <span className="text-xs text-zinc-500">hämtar bild…</span>}
        {current === 'error' && <span className="text-xs text-red-700">kunde inte hämta bilden</span>}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Rutnät
        </label>
        <span className="flex-1" />
        <button data-testid="undo" disabled={!past.length} className="rounded border px-2 py-1 disabled:opacity-40" onClick={undo}>
          Ångra
        </button>
        <button disabled={!future.length} className="rounded border px-2 py-1 disabled:opacity-40" onClick={redo}>
          Gör om
        </button>
        <button data-testid="save-site" disabled={!dirty} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40" onClick={save}>
          Spara{dirty ? ' *' : ''}
        </button>
        <span data-testid="site-status" className="text-xs text-zinc-600">
          rev {rev} {status}
        </span>
      </header>
      {conflict && (
        <div className="flex items-center gap-3 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="site-conflict">
          Tomten har ändrats sedan du öppnade den (till exempel av Claude). Läs om den för att se ändringen – det du ritat sedan dess försvinner.
          <button className="rounded border border-amber-700 px-2 py-0.5" onClick={load}>
            Läs om
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-white p-1 md:w-44 md:flex-col md:border-b-0 md:border-r">
          {TOOLS.map(([t, label, key]) => (
            <button
              key={t}
              data-testid={`tool-${t}`}
              title={`${label} (${key})`}
              className={`flex items-center justify-between gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-sm ${tool === t ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100'}`}
              onClick={() => {
                setTool(t)
                setDraft([])
              }}
            >
              <span>{label}</span>
              <kbd className="hidden text-xs opacity-60 md:inline">{key}</kbd>
            </button>
          ))}
          <div className="hidden px-2 pt-3 text-xs text-zinc-500 md:block">Alt-klick på en punkt tar bort den. Klicka på en liten mittpunkt för att lägga till en. Mellanslag + dra panorerar.</div>
        </nav>
        <div ref={wrap} className="relative min-h-[50vh] flex-1 bg-zinc-100">
          <svg
            ref={svgRef}
            data-testid="site-svg"
            className="absolute inset-0 h-full w-full touch-none select-none"
            style={{ cursor: cursorStyle }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={() => (tool === 'area' || tool === 'line') && finishDraft()}
          >
            {current && typeof current === 'object' && (
              <image href={current.url} x={toScreen({ x: current.extent.minX, y: current.extent.maxY }).x} y={toScreen({ x: current.extent.minX, y: current.extent.maxY }).y} width={(current.extent.maxX - current.extent.minX) * view.z} height={(current.extent.maxY - current.extent.minY) * view.z} preserveAspectRatio="none" opacity={photo ? 1 : 0.9} />
            )}
            {gridLines}
            {doc.property.map((poly, i) => (
              <path key={i} d={path(poly[0], true)} fill="none" stroke="#a40000" strokeWidth={2} strokeDasharray="10 3 2 3" />
            ))}
            {doc.buildings.map((b) => {
              const c = toScreen(centroid(b.corners))
              return (
                <g key={b.id}>
                  <path d={path(b.corners, true)} fill={b.kind === 'bostadshus' ? '#8f8f8f' : '#c4c4c4'} fillOpacity={photo ? 0.35 : 0.9} stroke={photo ? '#fff' : '#000'} strokeWidth={1.2} />
                  <text x={c.x} y={c.y + 4} fontSize={11} textAnchor="middle" fill="#000" paintOrder="stroke" stroke="#fff" strokeWidth={3}>
                    {b.id}
                  </text>
                </g>
              )
            })}
            {items.map((it) => {
              const isSel = it.id === sel
              const dash = it.status === 'befintlig' ? undefined : it.status === 'idé' ? '8 4' : it.status === 'planerad' ? '14 4 3 4' : '20 3'
              const c = toScreen(it.type === 'area' ? centroid(it.points) : it.points[Math.floor(it.points.length / 2)])
              return (
                <g key={it.id} data-item={it.id} onPointerDown={(e) => startItemDrag(e, it)} style={{ cursor: tool === 'select' ? 'move' : undefined }}>
                  {it.type === 'area' && <path d={path(it.points, true)} fill={it.color} fillOpacity={isSel ? 0.35 : 0.22} stroke={it.color} strokeWidth={isSel ? 3 : 2} strokeDasharray={dash} strokeLinejoin="round" />}
                  {it.type === 'line' && (
                    <>
                      <path d={path(it.points, false)} fill="none" stroke="transparent" strokeWidth={14} />
                      <path d={path(it.points, false)} fill="none" stroke={it.color} strokeWidth={isSel ? 4 : 3} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" />
                    </>
                  )}
                  {it.type === 'point' && <circle cx={toScreen(it.points[0]).x} cy={toScreen(it.points[0]).y} r={isSel ? 8 : 6} fill={it.color} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />}
                  <text x={c.x} y={c.y - (it.type === 'point' ? 11 : 0)} fontSize={12} fontWeight="bold" textAnchor="middle" fill="#000" paintOrder="stroke" stroke="#fff" strokeWidth={3.5} pointerEvents="none">
                    {tagOf(items, it)} {it.name}
                  </text>
                </g>
              )
            })}
            {selected && selected.type !== 'point' && (
              <g>
                {selected.points.map((p, i) => {
                  const q = selected.points[(i + 1) % selected.points.length]
                  if (selected.type === 'line' && i === selected.points.length - 1) return null
                  const m = toScreen({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
                  return <circle key={`m${i}`} cx={m.x} cy={m.y} r={4} fill="#fff" fillOpacity={0.7} stroke={selected.color} strokeWidth={1.5} style={{ cursor: 'copy' }} onPointerDown={(e) => insertVertex(e, selected, i)} />
                })}
                {selected.points.map((p, i) => {
                  const s = toScreen(p)
                  return <circle key={`v${i}`} data-testid="vertex" cx={s.x} cy={s.y} r={6} fill="#fff" stroke={selected.color} strokeWidth={2.5} style={{ cursor: 'grab' }} onPointerDown={(e) => startVertexDrag(e, selected, i)} />
                })}
              </g>
            )}
            {selected?.type === 'point' && <circle cx={toScreen(selected.points[0]).x} cy={toScreen(selected.points[0]).y} r={12} fill="none" stroke={selected.color} strokeWidth={2} strokeDasharray="3 3" pointerEvents="none" />}
            {draftPts.length > 0 && (
              <g pointerEvents="none">
                <path d={path(draftPts, false)} fill="none" stroke={DEFAULT_COLOR} strokeWidth={2.5} strokeDasharray="6 4" />
                {(tool === 'area' || tool === 'line') && draft.map((p, i) => <circle key={i} cx={toScreen(p).x} cy={toScreen(p).y} r={i === 0 && tool === 'area' && draft.length >= 3 ? 8 : 4} fill="#fff" stroke={DEFAULT_COLOR} strokeWidth={2} />)}
              </g>
            )}
          </svg>
          <div className="pointer-events-none absolute bottom-1 left-2 right-2 flex justify-between text-xs text-zinc-700">
            <span className="rounded bg-white/80 px-1">{HINT[tool]}</span>
            <span className="rounded bg-white/80 px-1" data-testid="cursor">
              {cursor ? `x ${fmt(cursor.x)}  y ${fmt(cursor.y)} m` : ''}
            </span>
          </div>
        </div>
        <aside className="max-h-[40vh] shrink-0 overflow-y-auto border-t bg-white p-3 text-sm md:max-h-none md:w-72 md:border-l md:border-t-0" data-testid="site-inspector">
          {selected ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <b>
                  {tagOf(items, selected)} {selected.type === 'area' ? 'Yta' : selected.type === 'line' ? 'Linje' : 'Punkt'}
                </b>
                <button data-testid="delete-item" className="rounded border border-red-600 px-2 py-0.5 text-red-700" onClick={() => remove(selected.id)}>
                  Ta bort
                </button>
              </div>
              <label className="block">
                Namn
                <input ref={nameRef} data-testid="item-name" className="mt-1 w-full rounded border px-2 py-1" value={selected.name} onChange={(e) => patch(selected.id, { name: e.target.value })} />
              </label>
              <label className="block">
                Sort
                <select data-testid="item-kind" className="mt-1 w-full rounded border px-2 py-1" value={selected.kind} onChange={(e) => patch(selected.id, { kind: e.target.value })}>
                  {[...new Set([...KINDS, selected.kind])].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                Status
                <select data-testid="item-status" className="mt-1 w-full rounded border px-2 py-1" value={selected.status} onChange={(e) => patch(selected.id, { status: e.target.value as SiteItem['status'] })}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <div>
                Färg
                <div className="mt-1 flex gap-1">
                  {COLORS.map(([c, n]) => (
                    <button key={c} title={n} aria-label={n} className={`h-6 w-6 rounded-full border-2 ${selected.color.toLowerCase() === c ? 'border-black' : 'border-white ring-1 ring-zinc-300'}`} style={{ background: c }} onClick={() => patch(selected.id, { color: c })} />
                  ))}
                </div>
              </div>
              <label className="block">
                Anteckning
                <textarea className="mt-1 w-full rounded border px-2 py-1" rows={3} value={selected.note ?? ''} onChange={(e) => patch(selected.id, { note: e.target.value || undefined })} />
              </label>
              <p className="text-xs text-zinc-600" data-testid="item-size">
                {selected.type === 'area' && `Yta ca ${Math.round(itemArea(selected))} m², ${selected.points.length} hörn`}
                {selected.type === 'line' && `Längd ca ${Math.round(itemLength(selected))} m, ${selected.points.length} punkter`}
                {selected.type === 'point' && `Läge x ${fmt(selected.points[0].x)}  y ${fmt(selected.points[0].y)} m`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <b>{doc.designation}</b>
                <p className="text-xs text-zinc-600">
                  Rutnätet är i meter från fastighetens sydvästra hörn. Fastigheten är ca {Math.round(Math.max(...xs) - Math.min(...xs))} × {Math.round(Math.max(...ys) - Math.min(...ys))} m. Byggnaderna är avlästa ur kartan (±1 m).
                </p>
              </div>
              <div>
                <b>Objekt ({items.length})</b>
                <ul className="mt-1 space-y-1" data-testid="item-list">
                  {items.length === 0 && <li className="text-zinc-500">Inget ritat ännu. Välj en yta, linje eller punkt till vänster.</li>}
                  {items.map((it) => (
                    <li key={it.id}>
                      <button className="w-full rounded px-1 py-0.5 text-left hover:bg-zinc-100" onClick={() => setSel(it.id)}>
                        <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: it.color }} />
                        {tagOf(items, it)} {it.name} <span className="text-xs text-zinc-500">({it.kind}, {it.status})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <b>Byggnader</b>
                <ul className="mt-1 text-xs text-zinc-700">
                  {doc.buildings.map((b) => (
                    <li key={b.id}>
                      {b.id} {b.kind}: {b.label ?? `${fmt(b.width)} × ${fmt(b.depth)} m (ca ${b.area} m²)`}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1">
                <b>Ritning</b>
                <div className="flex flex-wrap gap-2 text-blue-700 underline">
                  <a data-testid="export-pdf" href={`/api/sites/${slug}/sheet?format=pdf&underlay=none`}>
                    PDF situationsplan
                  </a>
                  <a href={`/api/sites/${slug}/sheet?format=pdf&underlay=flyg&grid=10`}>PDF flygbild</a>
                  <a href={`/api/sites/${slug}/sheet?format=png&underlay=none`}>PNG</a>
                </div>
                <p className="text-xs text-zinc-600">Sparade ändringar hamnar på bladet. Claude läser dem med site_get.</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
