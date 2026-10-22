'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkPlan, type Finding } from '@/lib/plan/checks'
import { dist } from '@/lib/plan/geometry'
import { applyOps, type Op } from '@/lib/plan/ops'
import { renderSheet } from '@/lib/plan/sheet'
import type { FixtureKind, Plan, Pt, Revision, View } from '@/lib/plan/types'
import { Canvas, type Selection, type Tool, type ToolOptions } from './Canvas'
import { initHistory, push, redo, undo, type History } from './history'
import { FIXTURE_LABEL, Inspector, PHASE_LABEL } from './Inspector'
import { toPng } from './underlay'

const TOOLS: Array<[Tool, string, string]> = [
  ['select', 'Markera / flytta', 'V'],
  ['wall', 'Vägg', 'W'],
  ['opening', 'Dörr / öppning / fönster', 'O'],
  ['fixture', 'Inredning', 'I'],
  ['room', 'Rumsnamn', 'R'],
  ['dimension', 'Mått', 'M'],
  ['calibrate', 'Kalibrera underlag', 'K'],
  ['underlay', 'Flytta underlag', 'U'],
  ['pan', 'Panorera', 'H'],
]

const HINT: Record<Tool, string> = {
  select: 'Klicka för att markera. Dra för att flytta. Delete tar bort.',
  wall: 'Klicka start, klicka slut (eller skriv längd i mm + Enter). Esc avslutar.',
  opening: 'Klicka på en vägg för att sätta in öppningen.',
  fixture: 'Klicka för att placera.',
  room: 'Klicka där rumsnamnet ska stå.',
  dimension: 'Klicka två punkter.',
  calibrate: 'Klicka två punkter med känt avstånd på underlaget (t.ex. skalstocken).',
  underlay: 'Dra för att flytta underlagsritningen.',
  pan: 'Dra för att panorera. Scrolla för att zooma.',
}

type Tab = 'props' | 'checks' | 'revisions' | 'underlay'

export function Editor({ id }: { id: string }) {
  const [hist, setHist] = useState<History | null>(null)
  const [draft, setDraft] = useState<Plan | null>(null)
  const [base, setBase] = useState<{ n: number; plan: Plan } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState<View>('efter')
  const [mode, setMode] = useState<'draw' | 'sheet'>('draw')
  const [tab, setTab] = useState<Tab>('props')
  const [selection, setSelection] = useState<Selection>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [calib, setCalib] = useState<{ a: Pt; b: Pt } | null>(null)
  const [options, setOptions] = useState<ToolOptions>({ phase: 'existing', thickness: 100, openingKind: 'door', openingWidth: 900, fixtureKind: 'radiator' })

  // ── load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/plans/${id}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.errors?.[0] ?? 'kunde inte läsa planen')
        setHist(initHistory(body.plan))
        setBase({ n: body.revision.n, plan: body.plan })
        setFitSignal((s) => s + 1)
      })
      .catch((e) => setError(e.message))
  }, [id])

  const plan = draft ?? hist?.present ?? null
  const dirty = !!hist && !!base && hist.present !== base.plan

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // ── editing ──────────────────────────────────────────────────────────────
  const commit = useCallback((next: Plan, message: string, key?: string) => {
    setHist((h) => (h ? push(h, next, key) : h))
    setMessages((m) => (m[m.length - 1] === message ? m : [...m, message]))
    setStatus(message)
  }, [])

  const applyAndCommit = useCallback(
    (ops: Op[], key: string, message: string) => {
      if (!hist) return
      const res = applyOps(hist.present, ops)
      if (res.errors.length) {
        setStatus(res.errors[0])
        return
      }
      commit(res.plan, message, key)
    },
    [hist, commit],
  )

  const deleteSelected = useCallback(() => {
    if (!selection) return
    applyAndCommit([{ op: 'delete', kind: selection.kind, id: selection.id }], `del:${selection.id}`, 'Tog bort')
    setSelection(null)
  }, [selection, applyAndCommit])

  const save = useCallback(async () => {
    if (!hist || !base || !dirty || saving) return
    setSaving(true)
    try {
      const message = messages.slice(-4).join(', ') || 'Ändrad i editorn'
      const r = await fetch(`/api/plans/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: hist.present, baseRevision: base.n, author: 'user', message }),
      })
      const body = await r.json()
      if (r.status === 409) {
        setStatus(`Kunde inte spara: ${body.errors[0]}. Ladda om sidan för att se den senaste versionen.`)
        return
      }
      if (!r.ok) throw new Error(body.errors?.[0] ?? 'kunde inte spara')
      setBase({ n: body.revision.n, plan: hist.present })
      setMessages([])
      setStatus(`Sparad som revision ${body.revision.n}`)
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [hist, base, dirty, saving, messages, id])

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.defaultPrevented) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setHist((h) => (h ? (e.shiftKey ? redo(h) : undo(h)) : h))
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        setHist((h) => (h ? redo(h) : h))
        return
      }
      if (mod) return
      if (e.key === 'Escape') {
        setSelection(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        deleteSelected()
        return
      }
      const t = TOOLS.find(([, , k]) => k.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t[0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, save, deleteSelected])

  // ── underlay ─────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadUnderlay = async (file: File) => {
    if (!plan) return
    try {
      setStatus('Läser in ritningen…')
      const raster = await toPng(file)
      const r = await fetch(`/api/plans/${id}/assets?name=${encodeURIComponent(raster.name)}`, { method: 'POST', body: raster.blob })
      const body = await r.json()
      if (!r.ok) throw new Error(body.errors?.[0] ?? 'uppladdningen misslyckades')
      // First guess: a 300 dpi scan of a 1:100 drawing. Calibrate to fix.
      applyAndCommit(
        [{ op: 'setUnderlay', underlay: { src: body.url, widthPx: raster.width, heightPx: raster.height, mmPerPx: 8.467, x: 0, y: 0, rotation: 0, opacity: 0.5 } }],
        'underlay',
        'Lade in underlagsritning',
      )
      setFitSignal((s) => s + 1)
      setTool('calibrate')
      setStatus('Underlaget är inlagt. Kalibrera: klicka två punkter med känt avstånd, t.ex. skalstockens ändar.')
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  const applyCalibration = (realMm: number) => {
    if (!plan?.underlay || !calib) return
    const measured = dist(calib.a, calib.b)
    if (!(realMm > 0) || measured < 1) return
    const k = realMm / measured
    const u = plan.underlay
    // Scale around the first clicked point so it stays put.
    const underlay = { ...u, mmPerPx: u.mmPerPx * k, x: Math.round(calib.a.x + (u.x - calib.a.x) * k), y: Math.round(calib.a.y + (u.y - calib.a.y) * k) }
    applyAndCommit([{ op: 'setUnderlay', underlay }], 'calibrate', `Kalibrerade underlaget (${realMm} mm)`)
    setCalib(null)
    setTool('select')
    setFitSignal((s) => s + 1)
  }

  const findings = useMemo<Finding[]>(() => (plan ? checkPlan(plan) : []), [plan])
  const sheetSvg = useMemo(() => (plan && mode === 'sheet' ? renderSheet(plan, view) : ''), [plan, mode, view])

  if (error) return <div className="p-8 text-red-700">{error}</div>
  if (!plan || !hist || !base) return <div className="p-8 text-zinc-500">Läser in…</div>

  const exportUrl = (format: string, v: string) => `/api/plans/${id}/sheet?view=${v}&format=${format}&rev=${base.n}&download=1`
  const errors = findings.filter((f) => f.level === 'error').length

  return (
    <div className="flex h-[100dvh] flex-col bg-zinc-50 text-zinc-900">
      {/* Phones: read-only sheet; editing needs a mouse and a big screen. */}
      <div className="p-4 md:hidden" data-testid="mobile-notice">
        <h1 className="text-lg font-semibold">{plan.name}</h1>
        <p className="mt-1 text-sm text-zinc-600">Ritverktyget kräver en dator. Här kan du se och ladda ner ritningen.</p>
        <div className="mt-3 flex gap-2">
          <a className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white" href={exportUrl('pdf', 'both')}>
            Ladda ner PDF
          </a>
        </div>
        <div className="mt-3 w-full overflow-hidden border bg-white" dangerouslySetInnerHTML={{ __html: renderSheet(plan, view).replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"') }} />
      </div>

      <header className="hidden items-center gap-3 border-b bg-white px-3 py-2 md:flex">
        <Link href="/plans" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Planer
        </Link>
        <h1 className="truncate font-semibold" data-testid="plan-name">
          {plan.name}
        </h1>
        <span className="text-xs text-zinc-500" data-testid="save-state">
          rev {base.n}
          {dirty ? ' · osparade ändringar' : ' · sparad'}
        </span>
        <div className="ml-4 flex rounded border" role="group">
          {(['fore', 'efter'] as View[]).map((v) => (
            <button key={v} data-testid={`view-${v}`} className={`px-3 py-1 text-sm ${view === v ? 'bg-zinc-900 text-white' : ''}`} onClick={() => setView(v)}>
              {v === 'fore' ? 'Före' : 'Efter'}
            </button>
          ))}
        </div>
        <div className="flex rounded border" role="group">
          <button data-testid="mode-draw" className={`px-3 py-1 text-sm ${mode === 'draw' ? 'bg-zinc-900 text-white' : ''}`} onClick={() => setMode('draw')}>
            Rita
          </button>
          <button data-testid="mode-sheet" className={`px-3 py-1 text-sm ${mode === 'sheet' ? 'bg-zinc-900 text-white' : ''}`} onClick={() => setMode('sheet')}>
            Ritningsblad
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="rounded border px-2 py-1 text-sm disabled:opacity-40" disabled={!hist.past.length} onClick={() => setHist(undo(hist))} title="Ctrl+Z">
            Ångra
          </button>
          <button className="rounded border px-2 py-1 text-sm disabled:opacity-40" disabled={!hist.future.length} onClick={() => setHist(redo(hist))} title="Ctrl+Shift+Z">
            Gör om
          </button>
          <button data-testid="save" className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40" disabled={!dirty || saving} onClick={() => void save()} title="Ctrl+S">
            {saving ? 'Sparar…' : 'Spara'}
          </button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border px-2 py-1 text-sm" data-testid="export-menu">
              Exportera ▾
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-56 rounded border bg-white p-1 text-sm shadow">
              {dirty && <p className="px-2 py-1 text-xs text-amber-700">Exporterar senast sparade revision ({base.n}).</p>}
              <a className="block rounded px-2 py-1 hover:bg-zinc-100" data-testid="export-pdf" href={exportUrl('pdf', 'both')}>
                PDF – före och efter
              </a>
              <a className="block rounded px-2 py-1 hover:bg-zinc-100" href={exportUrl('pdf', view)}>
                PDF – {view === 'fore' ? 'före' : 'efter'}
              </a>
              <a className="block rounded px-2 py-1 hover:bg-zinc-100" href={exportUrl('svg', view)}>
                SVG – {view === 'fore' ? 'före' : 'efter'}
              </a>
              <a className="block rounded px-2 py-1 hover:bg-zinc-100" href={exportUrl('dxf', view)}>
                DXF – {view === 'fore' ? 'före' : 'efter'} (för konsulter)
              </a>
            </div>
          </details>
        </div>
      </header>

      <div className="hidden min-h-0 flex-1 md:flex">
        <aside className="w-48 shrink-0 space-y-1 overflow-y-auto border-r bg-white p-2">
          {TOOLS.map(([t, label, key]) => (
            <button
              key={t}
              data-testid={`tool-${t}`}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${tool === t ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100'}`}
              onClick={() => setTool(t)}
            >
              {label}
              <kbd className="text-xs opacity-60">{key}</kbd>
            </button>
          ))}
          <div className="space-y-2 border-t pt-2 text-xs text-zinc-600">
            <label className="block">
              Ny sak ritas som
              <select data-testid="opt-phase" className="w-full rounded border px-1 py-1 text-sm" value={options.phase} onChange={(e) => setOptions({ ...options, phase: e.target.value as ToolOptions['phase'] })}>
                {(['existing', 'demolish', 'new'] as const).map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            {tool === 'wall' && (
              <label className="block">
                Väggtjocklek (mm)
                <input data-testid="opt-thickness" className="w-full rounded border px-1 py-1 text-sm" inputMode="numeric" value={options.thickness} onChange={(e) => setOptions({ ...options, thickness: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
            )}
            {tool === 'opening' && (
              <>
                <label className="block">
                  Typ
                  <select className="w-full rounded border px-1 py-1 text-sm" value={options.openingKind} onChange={(e) => setOptions({ ...options, openingKind: e.target.value as ToolOptions['openingKind'], openingWidth: e.target.value === 'window' ? 1200 : 900 })}>
                    <option value="door">Dörr</option>
                    <option value="opening">Öppning utan dörr</option>
                    <option value="window">Fönster</option>
                  </select>
                </label>
                <label className="block">
                  Bredd (mm)
                  <input className="w-full rounded border px-1 py-1 text-sm" inputMode="numeric" value={options.openingWidth} onChange={(e) => setOptions({ ...options, openingWidth: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
              </>
            )}
            {tool === 'fixture' && (
              <label className="block">
                Typ
                <select className="w-full rounded border px-1 py-1 text-sm" value={options.fixtureKind} onChange={(e) => setOptions({ ...options, fixtureKind: e.target.value as FixtureKind })}>
                  {Object.entries(FIXTURE_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </aside>

        <main className="relative min-w-0 flex-1">
          {mode === 'draw' ? (
            <Canvas
              plan={plan}
              view={view}
              tool={tool}
              options={options}
              selection={selection}
              fitSignal={fitSignal}
              onSelect={(s) => {
                setSelection(s)
                if (s) setTab('props')
              }}
              onDraft={setDraft}
              onCommit={(p, m) => commit(p, m)}
              onCalibrate={(a, b) => setCalib({ a, b })}
              onStatus={setStatus}
            />
          ) : (
            <div className="h-full overflow-auto bg-zinc-200 p-6">
              <div data-testid="sheet-preview" className="mx-auto max-w-[1400px] bg-white shadow" dangerouslySetInnerHTML={{ __html: sheetSvg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"') }} />
            </div>
          )}
          {calib && (
            <form
              data-testid="calibrate-form"
              className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded border bg-white px-3 py-2 shadow"
              onSubmit={(e) => {
                e.preventDefault()
                applyCalibration(Number(new FormData(e.currentTarget).get('mm')))
              }}
            >
              <span className="text-sm">Verkligt avstånd mellan punkterna:</span>
              <input name="mm" autoFocus data-testid="calibrate-mm" className="w-24 rounded border px-2 py-1 text-sm" inputMode="numeric" placeholder="mm" />
              <span className="text-sm">mm</span>
              <button className="rounded bg-blue-600 px-2 py-1 text-sm text-white">Kalibrera</button>
              <button type="button" className="text-sm text-zinc-500" onClick={() => setCalib(null)}>
                Avbryt
              </button>
            </form>
          )}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 truncate border-t bg-white/90 px-3 py-1 text-xs text-zinc-600" data-testid="status">
            {status || HINT[tool]}
          </div>
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l bg-white">
          <div className="flex border-b text-sm">
            {(
              [
                ['props', 'Egenskaper'],
                ['checks', `Kontroll${errors ? ` (${errors})` : ''}`],
                ['revisions', 'Versioner'],
                ['underlay', 'Underlag'],
              ] as Array<[Tab, string]>
            ).map(([t, l]) => (
              <button key={t} data-testid={`tab-${t}`} className={`flex-1 px-2 py-2 ${tab === t ? 'border-b-2 border-blue-600 font-medium' : 'text-zinc-500'}`} onClick={() => setTab(t)}>
                {l}
              </button>
            ))}
          </div>
          <div className="p-3">
            {tab === 'props' && <Inspector plan={plan} selection={selection} onOps={applyAndCommit} onDelete={deleteSelected} />}
            {tab === 'checks' && <Checks findings={findings} onPick={(ref) => selectRef(plan, ref, setSelection)} />}
            {tab === 'revisions' && <Revisions id={id} current={base.n} onRestore={(p, n) => commit(p, `Återställde till revision ${n}`)} />}
            {tab === 'underlay' && (
              <div className="space-y-3 text-sm">
                <p className="text-zinc-600">Lägg in en skannad ritning (TIF, PNG eller JPG) från Bygg- och plantjänsten och rita av väggarna ovanpå.</p>
                <input ref={fileRef} type="file" accept=".tif,.tiff,.png,.jpg,.jpeg,image/tiff,image/png,image/jpeg" data-testid="underlay-file" className="block w-full text-sm" onChange={(e) => e.target.files?.[0] && void uploadUnderlay(e.target.files[0])} />
                {plan.underlay && (
                  <div className="space-y-2">
                    <label className="block text-xs text-zinc-600">
                      Synlighet
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={plan.underlay.opacity}
                        className="w-full"
                        onChange={(e) => applyAndCommit([{ op: 'setUnderlay', underlay: { ...plan.underlay!, opacity: Number(e.target.value) } }], 'underlay:opacity', 'Underlagets synlighet')}
                      />
                    </label>
                    <p className="text-xs text-zinc-500" data-testid="underlay-scale">
                      {plan.underlay.mmPerPx.toFixed(3)} mm per pixel · {Math.round(plan.underlay.widthPx * plan.underlay.mmPerPx)} × {Math.round(plan.underlay.heightPx * plan.underlay.mmPerPx)} mm
                    </p>
                    <label className="block text-xs text-zinc-600">
                      Rotation (grader)
                      <input
                        className="w-full rounded border px-2 py-1 text-sm"
                        inputMode="decimal"
                        defaultValue={plan.underlay.rotation}
                        onBlur={(e) => applyAndCommit([{ op: 'setUnderlay', underlay: { ...plan.underlay!, rotation: Number(e.target.value.replace(',', '.')) || 0 } }], 'underlay:rot', 'Roterade underlaget')}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button className="rounded border px-2 py-1" onClick={() => setTool('calibrate')}>
                        Kalibrera
                      </button>
                      <button className="rounded border px-2 py-1" onClick={() => setTool('underlay')}>
                        Flytta
                      </button>
                      <button className="rounded border border-red-300 px-2 py-1 text-red-700" onClick={() => applyAndCommit([{ op: 'setUnderlay', underlay: null }], 'underlay:rm', 'Tog bort underlaget')}>
                        Ta bort
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function selectRef(plan: Plan, ref: string | undefined, set: (s: Selection) => void) {
  if (!ref) return
  if (plan.walls.some((w) => w.id === ref)) set({ kind: 'wall', id: ref })
  else if (plan.openings.some((o) => o.id === ref)) set({ kind: 'opening', id: ref })
  else if (plan.fixtures.some((f) => f.id === ref)) set({ kind: 'fixture', id: ref })
}

function Checks({ findings, onPick }: { findings: Finding[]; onPick: (ref?: string) => void }) {
  if (findings.length === 0) return <p className="text-sm text-green-700">Inga anmärkningar.</p>
  const color = { error: 'border-red-300 bg-red-50 text-red-800', warning: 'border-amber-300 bg-amber-50 text-amber-900', info: 'border-zinc-200 bg-zinc-50 text-zinc-700' }
  return (
    <ul className="space-y-2" data-testid="findings">
      {findings.map((f, i) => (
        <li key={i} className={`cursor-pointer rounded border px-2 py-1.5 text-sm ${color[f.level]}`} data-level={f.level} onClick={() => onPick(f.ref)}>
          {f.message}
        </li>
      ))}
      <li className="text-xs text-zinc-500">Kontrollen pekar ut vad ritningen behöver visa. Den gör ingen juridisk bedömning.</li>
    </ul>
  )
}

function Revisions({ id, current, onRestore }: { id: string; current: number; onRestore: (p: Plan, n: number) => void }) {
  const [revs, setRevs] = useState<Revision[] | null>(null)
  useEffect(() => {
    fetch(`/api/plans/${id}/revisions`)
      .then((r) => r.json())
      .then((b) => setRevs((b.revisions as Revision[]).reverse()))
      .catch(() => setRevs([]))
  }, [id, current])
  const restore = async (n: number) => {
    const r = await fetch(`/api/plans/${id}?rev=${n}`)
    const b = await r.json()
    if (r.ok) onRestore(b.plan, n)
  }
  if (!revs) return <p className="text-sm text-zinc-500">Läser in…</p>
  return (
    <ul className="space-y-2 text-sm" data-testid="revisions">
      {revs.map((r) => (
        <li key={r.n} className="rounded border px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {r.n}
              {r.issued && <span className="ml-1 rounded bg-green-100 px-1 text-xs text-green-800">rev {r.issued}</span>}
              {r.n === current && <span className="ml-1 text-xs text-zinc-500">(aktuell)</span>}
            </span>
            <span className="text-xs text-zinc-500">{r.author === 'claude' ? 'Claude' : 'Du'}</span>
          </div>
          <div className="text-zinc-700">{r.message}</div>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{new Date(r.createdAt).toLocaleString('sv-SE')}</span>
            <span className="space-x-2">
              <a className="underline" href={`/api/plans/${id}/sheet?view=both&format=pdf&rev=${r.n}`} target="_blank" rel="noreferrer">
                PDF
              </a>
              {r.n !== current && (
                <button className="underline" onClick={() => void restore(r.n)}>
                  Återställ
                </button>
              )}
            </span>
          </div>
        </li>
      ))}
      <IssueButton id={id} />
    </ul>
  )
}

function IssueButton({ id }: { id: string }) {
  const [msg, setMsg] = useState('')
  return (
    <li className="pt-2">
      <button
        className="w-full rounded border px-2 py-1 text-sm hover:bg-zinc-50"
        onClick={async () => {
          const r = await fetch(`/api/plans/${id}/issue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          const b = await r.json()
          setMsg(r.ok ? `Utfärdad som rev ${b.revision.issued} – ladda om sidan` : b.errors?.[0])
        }}
      >
        Utfärda ny revision (A, B, C…)
      </button>
      {msg && <p className="mt-1 text-xs text-zinc-600">{msg}</p>}
    </li>
  )
}
