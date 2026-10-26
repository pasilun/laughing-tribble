'use client'

import { useState } from 'react'
import { dist, polygonArea, wallLength } from '@/lib/plan/geometry'
import type { Op } from '@/lib/plan/ops'
import type { FixtureKind, Phase, Plan, TitleBlock } from '@/lib/plan/types'
import type { Selection } from './Canvas'

type Props = {
  plan: Plan
  selection: Selection
  onOps: (ops: Op[], key: string, message: string) => void
  onDelete: () => void
}

export const PHASE_LABEL: Record<Phase, string> = { existing: 'Befintlig', demolish: 'Rivs', new: 'Ny' }
export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  kitchen: 'Köksbänk',
  stove: 'Spis',
  sink: 'Diskbänk',
  radiator: 'Radiator',
  exhaust: 'Frånluftsdon',
  shaft: 'Schakt',
  wc: 'WC',
  shower: 'Dusch',
  bath: 'Badkar',
  plug: 'Proppad anslutning',
  box: 'Övrigt',
  balcony: 'Balkong',
}

const input = 'w-full rounded border border-zinc-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none'

// Numeric field that commits whole millimetres; keeps the text while typing.
function Num({ label, value, onChange, testid, min }: { label: string; value: number; onChange: (v: number) => void; testid?: string; min?: number }) {
  const [text, setText] = useState(String(value))
  // Follow outside changes (undo, dragging) without fighting the user's typing.
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    if (Number(text) !== value) setText(String(value))
  }
  return (
    <label className="block text-xs text-zinc-600">
      {label}
      <input
        className={input}
        data-testid={testid}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value.replace(',', '.'))
          if (e.target.value.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onChange(Math.round(v))
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  )
}

function Text({ label, value, onChange, testid, placeholder }: { label: string; value: string; onChange: (v: string) => void; testid?: string; placeholder?: string }) {
  return (
    <label className="block text-xs text-zinc-600">
      {label}
      <input className={input} data-testid={testid} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Choice<T extends string>({ label, value, options, onChange, testid }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void; testid?: string }) {
  return (
    <label className="block text-xs text-zinc-600">
      {label}
      <select className={input} data-testid={testid} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

function Check({ label, value, onChange, testid }: { label: string; value: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-700">
      <input type="checkbox" data-testid={testid} checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const PHASES: Array<[Phase, string]> = [
  ['existing', PHASE_LABEL.existing],
  ['demolish', PHASE_LABEL.demolish],
  ['new', PHASE_LABEL.new],
]

export function Inspector({ plan, selection, onOps, onDelete }: Props) {
  const upd = (kind: NonNullable<Selection>['kind'], id: string, field: string, patch: Record<string, unknown>, message: string) =>
    onOps([{ op: 'update', kind, id, patch }], `${kind}:${id}:${field}`, message)

  if (!selection) return <SheetPanel plan={plan} onOps={onOps} />

  const del = (
    <button className="mt-3 w-full rounded border border-red-300 px-2 py-1 text-sm text-red-700 hover:bg-red-50" data-testid="delete-selected" onClick={onDelete}>
      Ta bort
    </button>
  )

  if (selection.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === selection.id)
    if (!w) return null
    const len = Math.round(wallLength(w))
    return (
      <div className="space-y-2" data-testid="inspector-wall">
        <h3 className="font-semibold">Vägg {w.id}</h3>
        <Num label="Längd (mm, ände b flyttas)" value={len} min={1} testid="wall-length" onChange={(v) => onOps([{ op: 'setWallLength', id: w.id, length: v, fixed: 'a' }], `wall:${w.id}:len`, 'Ändrade vägglängd')} />
        <Num label="Tjocklek (mm)" value={w.thickness} min={1} testid="wall-thickness" onChange={(v) => upd('wall', w.id, 'thickness', { thickness: v }, 'Ändrade väggtjocklek')} />
        <Choice label="Status" value={w.phase} options={PHASES} testid="wall-phase" onChange={(v) => upd('wall', w.id, 'phase', { phase: v }, `Vägg: ${PHASE_LABEL[v].toLowerCase()}`)} />
        <Check label="Bärande" value={!!w.loadBearing} testid="wall-loadbearing" onChange={(v) => upd('wall', w.id, 'lb', { loadBearing: v }, v ? 'Markerade bärande' : 'Ej bärande')} />
        <Check label="Lägenhetsskiljande" value={!!w.apartmentBoundary} onChange={(v) => upd('wall', w.id, 'ab', { apartmentBoundary: v }, 'Lägenhetsskiljande')} />
        <Text label="Brandklass före (t.ex. EI60)" value={w.fireRating ?? ''} testid="wall-fire" onChange={(v) => upd('wall', w.id, 'fire', { fireRating: v || undefined }, 'Ändrade brandklass')} />
        <Choice
          label="Brandcellsgräns efter"
          value={w.fireRatingAfter === undefined ? 'same' : w.fireRatingAfter === '' ? 'none' : 'other'}
          options={[
            ['same', 'Samma som före'],
            ['none', 'Ingen gräns efter'],
            ['other', 'Annan klass'],
          ]}
          testid="wall-fire-after"
          onChange={(v) => upd('wall', w.id, 'fireAfter', { fireRatingAfter: v === 'same' ? undefined : v === 'none' ? '' : (w.fireRatingAfter || w.fireRating || 'EI60') }, 'Ändrade brandcellsgräns efter')}
        />
        {w.fireRatingAfter !== undefined && w.fireRatingAfter !== '' && (
          <Text label="Brandklass efter" value={w.fireRatingAfter} onChange={(v) => upd('wall', w.id, 'fireAfterText', { fireRatingAfter: v }, 'Ändrade brandklass efter')} />
        )}
        <p className="text-xs text-zinc-500">
          a ({w.a.x}, {w.a.y}) → b ({w.b.x}, {w.b.y}). Dra i ändpunkterna eller hela väggen; Skift = bara vinkelrätt.
        </p>
        {del}
      </div>
    )
  }

  if (selection.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === selection.id)
    if (!o) return null
    const w = plan.walls.find((x) => x.id === o.wallId)
    return (
      <div className="space-y-2" data-testid="inspector-opening">
        <h3 className="font-semibold">Öppning {o.id}</h3>
        <Choice label="Typ" value={o.kind} options={[['door', 'Dörr'], ['opening', 'Öppning utan dörr'], ['window', 'Fönster']]} onChange={(v) => upd('opening', o.id, 'kind', { kind: v }, 'Ändrade öppningstyp')} />
        <Num label="Bredd (mm)" value={o.width} min={1} testid="opening-width" onChange={(v) => upd('opening', o.id, 'width', { width: v }, 'Ändrade öppningsbredd')} />
        <Num label={`Avstånd från vägg ${w?.id ?? ''} ände a (mm)`} value={o.offset} min={0} testid="opening-offset" onChange={(v) => upd('opening', o.id, 'offset', { offset: v }, 'Flyttade öppning')} />
        <Num label="Höjd (mm)" value={o.height ?? 0} min={0} testid="opening-height" onChange={(v) => upd('opening', o.id, 'height', { height: v || undefined }, 'Ändrade öppningshöjd')} />
        <Choice label="Status" value={o.phase} options={PHASES} onChange={(v) => upd('opening', o.id, 'phase', { phase: v }, `Öppning: ${PHASE_LABEL[v].toLowerCase()}`)} />
        {o.kind === 'door' && (
          <>
            <Choice label="Gångjärn" value={o.hinge ?? 'a'} options={[['a', 'Vid ände a'], ['b', 'Vid ände b']]} onChange={(v) => upd('opening', o.id, 'hinge', { hinge: v }, 'Ändrade gångjärn')} />
            <Choice label="Öppnar åt" value={o.swing ?? 'left'} options={[['left', 'Vänster'], ['right', 'Höger']]} onChange={(v) => upd('opening', o.id, 'swing', { swing: v }, 'Ändrade slagriktning')} />
          </>
        )}
        {del}
      </div>
    )
  }

  if (selection.kind === 'fixture') {
    const f = plan.fixtures.find((x) => x.id === selection.id)
    if (!f) return null
    return (
      <div className="space-y-2" data-testid="inspector-fixture">
        <h3 className="font-semibold">Inredning {f.id}</h3>
        <Choice label="Typ" value={f.kind} options={Object.entries(FIXTURE_LABEL) as Array<[FixtureKind, string]>} onChange={(v) => upd('fixture', f.id, 'kind', { kind: v }, 'Ändrade typ')} />
        <Text label="Text (tom = standard)" value={f.label ?? ''} onChange={(v) => upd('fixture', f.id, 'label', { label: v || undefined }, 'Ändrade text')} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Bredd" value={f.w} min={1} onChange={(v) => upd('fixture', f.id, 'w', { w: v }, 'Ändrade storlek')} />
          <Num label="Djup" value={f.d} min={1} onChange={(v) => upd('fixture', f.id, 'd', { d: v }, 'Ändrade storlek')} />
          <Num label="x" value={f.x} onChange={(v) => upd('fixture', f.id, 'x', { x: v }, 'Flyttade inredning')} />
          <Num label="y" value={f.y} onChange={(v) => upd('fixture', f.id, 'y', { y: v }, 'Flyttade inredning')} />
        </div>
        <Num label="Rotation (grader)" value={f.rotation ?? 0} onChange={(v) => upd('fixture', f.id, 'rot', { rotation: v || undefined }, 'Roterade inredning')} />
        <Choice label="Status" value={f.phase} options={PHASES} onChange={(v) => upd('fixture', f.id, 'phase', { phase: v }, `Inredning: ${PHASE_LABEL[v].toLowerCase()}`)} />
        {del}
      </div>
    )
  }

  if (selection.kind === 'room') {
    const r = plan.rooms.find((x) => x.id === selection.id)
    if (!r) return null
    return (
      <div className="space-y-2" data-testid="inspector-room">
        <h3 className="font-semibold">Rum</h3>
        <Text label="Namn" value={r.name} testid="room-name" onChange={(v) => upd('room', r.id, 'name', { name: v }, 'Ändrade rumsnamn')} />
        <Text label="Namn efter ändring (tomt = samma)" value={r.renamed ?? ''} onChange={(v) => upd('room', r.id, 'renamed', { renamed: v || undefined }, 'Ändrade rumsnamn efter')} />
        <Check label="Rummet försvinner efter ändringen" value={!!r.goneAfter} onChange={(v) => upd('room', r.id, 'gone', { goneAfter: v || undefined }, v ? 'Rummet tas bort efter' : 'Rummet finns kvar efter')} />
        <Text label="Lägenhet" value={r.apartment ?? ''} onChange={(v) => upd('room', r.id, 'apt', { apartment: v || undefined }, 'Ändrade lägenhet')} />
        {r.polygon && <p className="text-xs text-zinc-500">Area {(polygonArea(r.polygon) / 1e6).toFixed(1).replace('.', ',')} m²</p>}
        {del}
      </div>
    )
  }

  if (selection.kind === 'note') {
    const n = plan.notes.find((x) => x.id === selection.id)
    if (!n) return null
    return (
      <div className="space-y-2" data-testid="inspector-note">
        <h3 className="font-semibold">Text</h3>
        <label className="block text-xs text-zinc-600">
          Text
          <textarea className={input} rows={3} data-testid="note-text" value={n.text} onChange={(e) => upd('note', n.id, 'text', { text: e.target.value }, 'Ändrade text')} />
        </label>
        <Choice
          label="Visas på"
          value={n.phase === 'new' ? 'new' : 'existing'}
          options={[
            ['existing', 'Före och efter'],
            ['new', 'Bara efter'],
          ]}
          onChange={(v) => upd('note', n.id, 'phase', { phase: v === 'new' ? 'new' : undefined }, 'Ändrade var texten visas')}
        />
        {del}
      </div>
    )
  }

  const dm = plan.dimensions.find((x) => x.id === selection.id)
  if (!dm) return null
  return (
    <div className="space-y-2" data-testid="inspector-dimension">
      <h3 className="font-semibold">Mått {Math.round(dist(dm.a, dm.b))} mm</h3>
      <Num label="Avstånd från mätpunkterna (mm)" value={dm.offset} onChange={(v) => upd('dimension', dm.id, 'offset', { offset: v }, 'Flyttade måttlinje')} />
      {del}
    </div>
  )
}

const TB_FIELDS: Array<[keyof TitleBlock, string, string?]> = [
  ['project', 'Projekt'],
  ['property', 'Fastighetsbeteckning', 'Stockholm Gnejsen 6'],
  ['address', 'Adress'],
  ['apartments', 'Lägenhet(er)', 'Lgh 1102, 1103'],
  ['floor', 'Våningsplan', 'Plan 1 tr'],
  ['drawingNumber', 'Ritningsnummer'],
  ['author', 'Ritad av'],
  ['date', 'Datum'],
]

function SheetPanel({ plan, onOps }: { plan: Plan; onOps: Props['onOps'] }) {
  const tb = plan.sheet.titleBlock
  return (
    <div className="space-y-2" data-testid="inspector-sheet">
      <h3 className="font-semibold">Ritningsblad</h3>
      <div className="grid grid-cols-2 gap-2">
        <Choice label="Papper" value={plan.sheet.paper} options={[['A3', 'A3'], ['A4', 'A4']]} testid="sheet-paper" onChange={(v) => onOps([{ op: 'setSheet', patch: { paper: v } }], 'sheet:paper', `Papper ${v}`)} />
        <Choice
          label="Skala"
          value={String(plan.sheet.scale) as '50' | '100'}
          options={[['50', '1:50'], ['100', '1:100']]}
          testid="sheet-scale"
          onChange={(v) => onOps([{ op: 'setSheet', patch: { scale: Number(v) as 50 | 100 } }], 'sheet:scale', `Skala 1:${v}`)}
        />
        <Choice label="Orientering" value={plan.sheet.orientation} options={[['landscape', 'Liggande'], ['portrait', 'Stående']]} onChange={(v) => onOps([{ op: 'setSheet', patch: { orientation: v } }], 'sheet:orient', 'Orientering')} />
        <Num label="Norrpil (grader)" value={plan.sheet.northAngle} onChange={(v) => onOps([{ op: 'setSheet', patch: { northAngle: v } }], 'sheet:north', 'Norrpil')} />
      </div>
      <h3 className="pt-2 font-semibold">Ritningshuvud</h3>
      {TB_FIELDS.map(([key, label, ph]) => (
        <Text key={key} label={label} value={tb[key]} placeholder={ph} testid={`tb-input-${key}`} onChange={(v) => onOps([{ op: 'setTitleBlock', patch: { [key]: v } }], `tb:${key}`, `Ritningshuvud: ${label.toLowerCase()}`)} />
      ))}
    </div>
  )
}
