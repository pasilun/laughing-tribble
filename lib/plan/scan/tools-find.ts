import { bounds, wallLength } from '../domain/geometry'
import type { Op } from '../domain/ops'
import type { Pt, Wall } from '../domain/types'
import { detectWalls } from './detect'
import { describeDoor, readDoor, readDoors } from './doors'
import { findWindows, windowsOnWall, type Anchor } from './elevation'
import { clipToFree } from '../assist/clear'
import { missingWalls } from './missing'
import { newOpenings, showsWall } from './openings'
import { loadGray, resolveSource, type Gray, type Raster } from './raster'
import { snapWalls } from './snap'
import { scanView } from './view'
import { around, err, image, rectOf, RECT, PT, SRC, save, text, type Content, type ScanTool } from './kit'


// Finding things in a drawing: walls, openings, windows on a facade, door swings.

export const FIND_TOOLS: ScanTool[] = [
  {
    name: 'plan_scan_detect_walls',
    description:
      'Finds horizontal and vertical walls in a source drawing (filled bands or pairs of outlines). Returns proposals with thickness and confidence plus an image with them drawn as p1, p2…; nothing is changed. Add the right ones with plan_scan_snap_walls.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        source_id: SRC,
        rect: RECT,
        min_length_mm: { type: 'number', description: 'default 500' },
        min_thickness_mm: { type: 'number', description: 'default 60' },
        max_thickness_mm: { type: 'number', description: 'default 500' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const rect = rectOf(args.rect)
      const found = detectWalls(g, r, {
        rect,
        minLengthMm: typeof args.min_length_mm === 'number' ? args.min_length_mm : undefined,
        minThicknessMm: typeof args.min_thickness_mm === 'number' ? args.min_thickness_mm : undefined,
        maxThicknessMm: typeof args.max_thickness_mm === 'number' ? args.max_thickness_mm : undefined,
        threshold,
      })
      const walls: Wall[] = found.map((p, i) => ({ id: `p${i + 1}`, a: p.a, b: p.b, thickness: p.thickness, phase: 'existing' }))
      const lines = found.map((p, i) => `p${i + 1}: (${p.a.x},${p.a.y})→(${p.b.x},${p.b.y}) längd ${Math.round(Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y))} tj ${p.thickness} ${p.style === 'filled' ? 'fylld' : 'konturer'} säkerhet ${p.confidence}`)
      const area = rect ?? { x: r.x, y: r.y, w: r.widthPx * r.mmPerPx, h: r.heightPx * r.mmPerPx }
      const content: Content = [text(`${found.length} förslag (inget ändrat):\n${lines.join('\n') || '–'}`)]
      if (walls.length) content.push(image((await scanView(planId, { ...plan, walls, openings: [] }, r, area, { overlay: true })).png))
      return { content }
    },
  },
  {
    name: 'plan_scan_missing_walls',
    description:
      'Finds walls the drawings show and the plan lacks. Runs wall detection on several source drawings (default: all archive plan drawings), groups the walls they agree on, and drops what the plan already has. Returns numbered candidates (m1, m2…) with the drawings that show each, plus an image with the plan in red and the candidates in blue, strongest first. A candidate is something to LOOK at in the images, not a wall to add unseen: handwriting underlines, counters and other fixtures make long strokes too. Add a real one with plan_scan_snap_walls (walls: [{id, a, b, thickness}], also_sources) and check it there.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Drawings to read (default: every archive source that is not a facade)' },
        rect: RECT,
        min_sources: { type: 'number', description: 'How many drawings must show a wall (default 3, or all when fewer)' },
        min_length_mm: { type: 'number', description: 'default 700' },
        min_thickness_mm: { type: 'number', description: 'default 40' },
        max_thickness_mm: { type: 'number', description: 'default 450' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const srcs = plan.sources ?? []
      const ids = Array.isArray(args.sources) ? args.sources.map(String) : srcs.filter((x) => x.role === 'archive' && x.view !== 'elevation').map((x) => x.id)
      if (ids.length < 2) return err('minst två ritningar krävs – ange sources eller lägg till fler arkivritningar')
      const b = bounds(plan)
      const area = rectOf(args.rect) ?? { x: b.minX - 300, y: b.minY - 300, w: b.maxX - b.minX + 600, h: b.maxY - b.minY + 600 }
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
      const read = await Promise.all(
        ids.map(async (id) => {
          const rr = resolveSource(plan, id)
          const gg = await loadGray(planId, rr)
          const proposals = detectWalls(gg, rr, {
            rect: area,
            minLengthMm: num(args.min_length_mm) ?? 700,
            minThicknessMm: num(args.min_thickness_mm) ?? 40,
            maxThicknessMm: num(args.max_thickness_mm) ?? 450,
            threshold: num(args.threshold),
          })
          return { source: id, r: rr, proposals }
        }),
      )
      const need = num(args.min_sources) ?? Math.min(3, ids.length)
      // Only inside the plan's own outline: lines outside it (a stair, the yard) are not this apartment.
      const found = missingWalls(plan, read, { minSources: need }).filter((m) => {
        const cx = (m.a.x + m.b.x) / 2
        const cy = (m.a.y + m.b.y) / 2
        return cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY
      })
      const cands: Wall[] = found.map((m, i) => ({ id: `m${i + 1}`, a: m.a, b: m.b, thickness: m.thickness, phase: 'new' }))
      const lines = found.map((m, i) => `m${i + 1}: (${m.a.x},${m.a.y})→(${m.b.x},${m.b.y}) längd ${Math.round(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y))} tj ${m.thickness} i ${m.sources.length} av ${ids.length} ritningar (${m.sources.join(', ')}) säkerhet ${m.confidence}, ${Math.round(m.covered * 100)} % ligger vid en befintlig vägg`)
      const head = `${found.length} kandidater för väggar som minst ${need} av ${ids.length} ritningar visar men planen saknar, inom planens yttre gräns (ritningar: ${ids.join(', ')}). Starkast först. Granska i bilden: handstil och inredning ger också långa streck. Lägg till en riktig med plan_scan_snap_walls.`
      const content: Content = [text(`${head}\n${lines.join('\n') || '–'}`)]
      if (cands.length) content.push(image((await scanView(planId, { ...plan, walls: [...plan.walls, ...cands], openings: [] }, read[0].r, area, { overlay: true, view: 'efter' })).png))
      return { content }
    },
  },
  {
    name: 'plan_scan_snap_walls',
    description:
      'Snaps walls onto the source drawing: give existing wall_ids and/or rough new walls (same fields as plan_edit add wall, ~±100 mm is enough). Cross-sections find the drawn wall, a line fit sets position and angle, the median sets thickness, and ends near another wall are joined at the centreline. Returns a report per wall (confidence, shift, thickness, scatter) and an overlay image. apply=false previews only.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        wall_ids: { type: 'array', items: { type: 'string' } },
        walls: { type: 'array', items: { type: 'object' } },
        apply: { type: 'boolean', description: 'default true' },
        message: { type: 'string' },
        search_mm: { type: 'number' },
        keep_thickness: { type: 'boolean' },
        square: { type: 'boolean', description: 'Make walls within 3° of horizontal/vertical exactly straight (default true)' },
        join_mm: { type: 'number', description: 'default 250' },
        threshold: { type: 'number' },
        also_sources: { type: 'array', items: { type: 'string' }, description: 'More registered drawings of the same floor: each wall is fitted in every drawing and the median position and thickness used. Steadier than one scan when the drawings disagree.' },
        prior_thickness: { type: 'number', description: 'Thickness to prefer when a cross-section could be read several ways (one thick band or two outlines), instead of each wall\'s current thickness. Use when the current thickness is a guess, e.g. ~100 for light partitions.' },
      },
      required: ['plan_id'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const ids = Array.isArray(args.wall_ids) ? args.wall_ids.map(String) : []
      const add = (Array.isArray(args.walls) ? args.walls : []) as Wall[]
      if (!ids.length && !add.length) return err('ange wall_ids och/eller walls')
      for (const w of add) if (!w.id || !w.a || !w.b) return err('varje ny vägg behöver id, a och b')
      const also: Array<{ g: Gray; r: Raster }> = []
      for (const id of Array.isArray(args.also_sources) ? args.also_sources.map(String) : []) {
        if (id === r.id) continue
        const rr = resolveSource(plan, id)
        also.push({ g: await loadGray(planId, rr), r: rr })
      }
      const res = snapWalls(g, r, plan, { ids, add }, {
        searchMm: typeof args.search_mm === 'number' ? args.search_mm : undefined,
        keepThickness: !!args.keep_thickness,
        square: args.square !== false,
        joinMm: typeof args.join_mm === 'number' ? args.join_mm : undefined,
        priorThickness: typeof args.prior_thickness === 'number' ? args.prior_thickness : undefined,
        threshold,
      }, also)
      const lines = res.reports.map((x) =>
        `- ${x.id}: ${x.ok ? 'ok' : 'OSÄKER'} säkerhet ${x.confidence} (${x.sections} tvärsnitt), flytt ${x.shiftMm} mm, vinkel ${x.angleDeg}°, tj ${x.thicknessMm}, spridning ${x.rmsMm} mm${x.note ? ` – ${x.note}` : ''}`)
      const apply = args.apply !== false
      let head = 'Förhandsvisning (inget sparat).'
      let after = plan
      if (apply) {
        const saved = await save(planId, args.base_revision, res.ops, String(args.message ?? `Fäste ${res.walls.length} väggar mot ${r.id}`))
        if (typeof saved === 'string') return err(`${saved}\n${lines.join('\n')}`)
        head = `Sparad som revision ${saved.n}.`
        after = saved.plan
      } else {
        const byId = new Map(res.walls.map((w) => [w.id, w]))
        after = { ...plan, walls: [...plan.walls.map((w) => byId.get(w.id) ?? w), ...res.walls.filter((w) => !plan.walls.some((p) => p.id === w.id))] }
      }
      const summary = res.walls.map((w) => `  ${w.id}: (${w.a.x},${w.a.y})→(${w.b.x},${w.b.y}) längd ${Math.round(wallLength(w))} tj ${w.thickness}`)
      const v = await scanView(planId, after, r, around(res.walls), { overlay: true })
      return { content: [text(`${head}\n${lines.join('\n')}\nResultat:\n${summary.join('\n')}`), image(v.png)] }
    },
  },
  {
    name: 'plan_scan_openings',
    description:
      'Finds openings in the plan\'s walls from a source drawing: where both drawn faces of a wall stop, or one face is drawn dashed (older Stockholm drawings outline rooms and dash the outline across doorways; ends then ±1 dash ≈ 0.3 m), there is an opening. Each one is then read as a door (with hinge and swing, via the door reader) when a door symbol is clearly drawn there, otherwise as an open passage. Openings in walls marked exterior (facades) are windows; plan_scan_elevation reads windows more reliably from facade drawings. apply=true adds them.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        wall_ids: { type: 'array', items: { type: 'string' }, description: 'Default: all walls' },
        apply: { type: 'boolean' },
        accept: { type: 'array', items: { type: 'string' }, description: 'With apply: ids of the new openings to add (from a preview); default all. Confirmations of existing openings are always recorded.' },
        methods: { type: 'array', items: { type: 'string', enum: ['mellanrum', 'streckad', 'mittstreck', 'dörrbåge', 'fönsterband', 'fönsterlinjer'] }, description: 'Detectors to run: fönsterlinjer = thin sill lines across the core of an outlined exterior wall between reveals (1999 survey style), width the stretch plus the reveals; fönsterband = a hollow stretch (two thin face lines, empty core) between solid parts of a wall drawn black – a window on an exterior wall, width the whole stretch; mellanrum = both faces stop, streckad = dashed face, mittstreck = centre mark across the wall (1936 plans; width estimated 800, or 700 for a one-sided mark), dörrbåge = door symbol. Default auto: each is tried on the openings other archive drawings already show, and used if it finds at least a quarter of them (with fewer than 3 such openings, all are used). For an independent build from one set of drawings, give methods explicitly.' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const ids = Array.isArray(args.wall_ids) ? args.wall_ids.map(String) : undefined
      const methods = Array.isArray(args.methods) && args.methods.length ? args.methods.map(String) : 'auto'
      const { openings: found, confirms, skipped, located, checks } = newOpenings(g, r, plan, ids, threshold, methods)
      // Openings in facade walls are windows.
      const edge = (w: (typeof plan.walls)[number]) => !!w.exterior
      const lines: string[] = []
      const ops: Op[] = []
      // Review image: every find numbered and coloured by how it was found
      // (green door symbol, orange dashed face, yellow gap, blue window);
      // confirmations of existing openings in teal.
      const marks: Record<string, { label: string; color: string }> = {}
      const previewOpenings: typeof plan.openings = []
      for (const o of found) {
        const wall = plan.walls.find((w) => w.id === o.wallId)!
        const drawn = located.get(wall) ?? wall
        // The door symbol sits on the wall as drawn in the source.
        const shift = (drawn.a.x - wall.a.x) * (wall.b.x - wall.a.x) / wallLength(wall) + (drawn.a.y - wall.a.y) * (wall.b.y - wall.a.y) / wallLength(wall)
        const rd = readDoor(g, r, drawn, { ...o, offset: o.offset - shift, kind: 'door' }, threshold)
        const item: typeof o = edge(wall)
          ? { ...o, kind: 'window', hinge: undefined, swing: undefined }
          : o.kind === 'door'
            ? o
            : rd.best && rd.confident
            ? { ...o, kind: 'door', hinge: rd.best.hinge, swing: rd.best.swing, evidence: (o.evidence ?? []).map((e) => ({ ...e, method: `${e.method}+dörrbåge` })) }
            : o
        const accepted = !Array.isArray(args.accept) || args.accept.map(String).includes(item.id)
        if (accepted) ops.push({ op: 'add', kind: 'opening', item })
        const what = item.kind === 'door' ? `dörr ${describeDoor(wall, item)}` : item.kind === 'window' ? 'fönster' : 'öppning'
        const alt = item.kind === 'opening' ? ` [dörr? ${rd.candidates.map((c) => `${c.hinge}/${c.swing} ${Math.round(c.score * 100)}%`).join(', ')}]` : ''
        const method = item.evidence?.[0]?.method ?? ''
        const color = item.kind === 'window' ? '#2563eb' : method.includes('dörrbåge') ? '#16a34a' : method.includes('streckad') ? '#ea580c' : method.includes('mittstreck') ? '#db2777' : '#ca8a04'
        marks[item.id] = { label: String(lines.length + 1), color }
        previewOpenings.push(item)
        lines.push(`${lines.length + 1}. ${item.id}: ${what} i ${o.wallId}, offset ${o.offset}, bredd ${o.width} [${method}]${alt}${accepted ? '' : ' (ej vald)'}`)
      }
      // Existing openings this drawing also shows: their evidence grows.
      for (const c of confirms) {
        const o = plan.openings.find((q) => q.id === c.id)!
        ops.push({ op: 'update', kind: 'opening', id: o.id, patch: { evidence: [...(o.evidence ?? []), c.evidence] } })
        marks[o.id] = { label: 'B', color: '#0891b2' }
        lines.push(`B. ${o.id}: finns, bekräftas av ${r.id} (${c.evidence.method}, offset ${c.evidence.offset} bredd ${c.evidence.width} – planen ${o.offset}/${o.width})`)
      }
      const perMethod = ['mellanrum', 'streckad', 'mittstreck', 'dörrbåge'].map((m) => `${m} ${found.filter((o) => (o.evidence?.[0]?.method ?? '').includes(m)).length}`).join(', ')
      const how = checks.map((c) => `${c.method} ${c.found}/${c.known}${c.used ? '' : ' – används inte'}`).join(', ')
      let head = `Metoder mot kända öppningar: ${how}.\n${found.length} nya öppningar (${perMethod}), ${confirms.length} bekräftade${skipped.length ? `; väggar som inte syns i ${r.id} (hoppade över): ${skipped.join(', ')}` : ''}.`
      let after = plan
      if (args.apply && ops.length) {
        const saved = await save(planId, args.base_revision, ops, `Öppningar och dörrar från ${r.id}`)
        if (typeof saved === 'string') return err(`${head}\n${lines.join('\n')}\n\n${saved}`)
        head += ` Sparad som revision ${saved.n}.`
        after = saved.plan
      }
      const content: Content = [text(`${head}\n${lines.join('\n')}`)]
      // Preview: the plan with the unsaved finds drawn in, numbered.
      const shown = args.apply ? after : { ...plan, openings: [...plan.openings, ...previewOpenings] }
      if (shown.walls.length) content.push(image((await scanView(planId, shown, r, around(shown.walls, 400), { overlay: true, view: 'fore', marks })).png))
      return { content }
    },
  },
  {
    name: 'plan_openings_report',
    description:
      'Lists every opening with its evidence – which drawings show it, by what method (mellanrum, streckad, dörrbåge, fasad), and where each puts it – the spread between them, and conflicts: an opening that a current survey (sources with role before/after, or check_sources) draws as solid wall, or one with no evidence at all. Use it to decide which openings to trust; older drawings show the building as it was then.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, check_sources: { type: 'array', items: { type: 'string' }, description: 'Sources to check each opening against (default: plan sources with role before/after)' } },
      required: ['plan_id'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const srcs = plan.sources ?? []
      const checkIds = Array.isArray(args.check_sources) ? args.check_sources.map(String) : srcs.filter((x) => (x.role === 'before' || x.role === 'after') && x.view !== 'elevation').map((x) => x.id)
      const checks = await Promise.all(checkIds.map(async (id) => {
        const rr = resolveSource(plan, id)
        return { rr, g: await loadGray(planId, rr) }
      }))
      const label = (id: string) => {
        const x = srcs.find((q) => q.id === id)
        return x?.year ? `${id} (${x.year})` : id
      }
      const lines = plan.openings.map((o) => {
        const wall = plan.walls.find((w) => w.id === o.wallId)!
        const ev = o.evidence ?? []
        const spread = ev.length ? Math.max(...ev.map((e) => Math.max(Math.abs(e.offset - o.offset), Math.abs(e.offset + e.width - o.offset - o.width)))) : 0
        const flags: string[] = []
        if (!ev.length) flags.push('inga belägg (inlagd för hand)')
        for (const c of checks) {
          if (ev.some((e) => e.source === c.rr.id)) continue
          // Plan drawings draw windows as lines across the wall, never as
          // gaps: the gap check can't judge them (facades are their evidence).
          if (o.kind === 'window') continue
          const solid = showsWall(c.g, c.rr, plan, wall, o.offset, o.width)
          if (solid === true) flags.push(`VÄGG i ${label(c.rr.id)}`)
          else if (solid === undefined) flags.push(`väggen syns inte i ${label(c.rr.id)}`)
          else flags.push(`öppen i ${label(c.rr.id)}`)
        }
        const evs = ev.map((e) => `${label(e.source)} ${e.method} ${e.offset}/${e.width}`).join('; ')
        return `- ${o.id}: ${o.kind} i ${o.wallId} ${o.offset}/${o.width}${ev.length > 1 ? `, spridning ${spread} mm` : ''} | ${evs || '–'}${flags.length ? ` | ${flags.join(', ')}` : ''}`
      })
      const conflicts = lines.filter((l) => l.includes('VÄGG i')).length
      return { content: [text(`${plan.openings.length} öppningar, ${conflicts} motsägs av en aktuell ritning (kontroll mot: ${checkIds.join(', ') || '–'}).\nFormat: id: typ i vägg offset/bredd | belägg (källa metod offset/bredd) | kontroll\n${lines.join('\n')}`)] }
    },
  },
  {
    name: 'plan_scan_elevation',
    description:
      'Reads windows from a facade drawing (a source added with view="elevation") onto a facade wall of the plan. Give the floor\'s window row as a height band in the drawing (band.y0–y1, drawing mm: use plan_scan_view on the source to read it), and two anchors linking drawing x to plan points — e.g. the building\'s two corners. A facade drawn as seen from outside is mirrored; the anchors handle that. Returns the windows found (with heights) and an image; apply=true adds them as windows with evidence and marks the wall exterior.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: { type: 'string' },
        wall_id: { type: 'string', description: 'The facade wall in the plan' },
        band: { type: 'object', properties: { y0: { type: 'number' }, y1: { type: 'number' } }, required: ['y0', 'y1'] },
        anchors: {
          type: 'array',
          description: 'Two points: [{facade_x, plan:{x,y}}, …]',
          items: { type: 'object', properties: { facade_x: { type: 'number' }, plan: PT }, required: ['facade_x', 'plan'] },
        },
        apply: { type: 'boolean' },
        min_width_mm: { type: 'number', description: 'default 350' },
        threshold: { type: 'number' },
      },
      required: ['plan_id', 'source_id', 'wall_id', 'band', 'anchors'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const wall = plan.walls.find((w) => w.id === String(args.wall_id))
      if (!wall) return err(`väggen ${String(args.wall_id)} finns inte`)
      const band = args.band as { y0: number; y1: number }
      const raw = (Array.isArray(args.anchors) ? args.anchors : []) as Array<{ facade_x: number; plan: Pt }>
      if (raw.length !== 2 || raw[0].facade_x === raw[1].facade_x) return err('två ankare med olika facade_x krävs')
      const anchors = raw.map((a) => ({ facadeX: a.facade_x, plan: a.plan })) as [Anchor, Anchor]
      const xs = { x0: Math.min(raw[0].facade_x, raw[1].facade_x), x1: Math.max(raw[0].facade_x, raw[1].facade_x) }
      const wins = findWindows(g, r, band, xs, { minWidth: typeof args.min_width_mm === 'number' ? args.min_width_mm : undefined, threshold })
      const on = windowsOnWall(wins, wall, anchors)
      const existing = plan.openings.filter((o) => o.wallId === wall.id)
      const ops: Op[] = []
      const ids = new Set(plan.openings.map((o) => o.id))
      const freeId = () => {
        let k = 1
        while (ids.has(`f-${wall.id}-${k}`)) k++
        ids.add(`f-${wall.id}-${k}`)
        return `f-${wall.id}-${k}`
      }
      const lines = on.map((w, i) => {
        const clash = existing.find((o) => Math.min(o.offset + o.width, w.offset + w.width) - Math.max(o.offset, w.offset) > 0)
        // A window keeps clear of the walls it meets: a corner it runs into is cut off.
        const fit = clipToFree(plan, wall, w.offset, w.width)
        const cut = fit && (fit.offset !== w.offset || fit.width !== w.width)
        const ev = { source: r.id, method: cut ? 'fasad (beskuren mot vägg)' : 'fasad', offset: w.offset, width: w.width }
        const known = clash?.evidence?.some((e) => e.source === ev.source && e.method === ev.method)
        if (clash && !known) ops.push({ op: 'update', kind: 'opening', id: clash.id, patch: { evidence: [...(clash.evidence ?? []), ev] } })
        else if (!clash && fit) ops.push({ op: 'add', kind: 'opening', item: { id: freeId(), wallId: wall.id, kind: 'window', offset: fit.offset, width: fit.width, height: w.height, phase: 'existing', evidence: [ev] } })
        const note = !clash ? (fit ? '' : ' – ligger i hörnet mot en vägg, utelämnad') : known ? ` – finns redan som ${clash.id}, belägg från ${r.id} finns redan` : ` – finns redan som ${clash.id} (${clash.kind} offset ${clash.offset} bredd ${clash.width}), lägger till belägg`
        const at = fit ?? w
        return `- ${i + 1}: offset ${at.offset}, bredd ${at.width}, höjd ${w.height}${cut ? ` (ritad ${w.offset}/${w.width}, beskuren mot vägg)` : ''}${note}`
      })
      if (!wall.exterior) ops.push({ op: 'update', kind: 'wall', id: wall.id, patch: { exterior: true } })
      let head = `${wins.length} fönster i raden, ${on.length} på väggen ${wall.id}.`
      if (args.apply && ops.length) {
        const saved = await save(planId, args.base_revision, ops, `Fönster i ${wall.id} från fasadritning ${r.id}`)
        if (typeof saved === 'string') return err(`${head}\n${lines.join('\n')}\n\n${saved}`)
        head += ` Sparad som revision ${saved.n}.`
      }
      // The row with each found window boxed and numbered (in drawing mm).
      const boxes: Wall[] = wins.map((w, i) => {
        const y = (w.y0 + w.y1) / 2
        // Numbered as listed when on the wall, "–" when outside it.
        const n = on.findIndex((o) => o.win === w) + 1
        return { id: n ? String(n) : `–${i}`, a: { x: w.x0, y }, b: { x: w.x1, y }, thickness: Math.max(50, w.y1 - w.y0), phase: 'new' }
      })
      const pad = 600
      const view = await scanView(planId, { ...plan, walls: boxes, openings: [] }, r, { x: xs.x0 - pad, y: band.y0 - pad, w: xs.x1 - xs.x0 + 2 * pad, h: band.y1 - band.y0 + 2 * pad }, { overlay: true, maxPx: 2000 })
      return { content: [text(`${head}\n${lines.join('\n') || '–'}`), image(view.png)] }
    },
  },
  {
    name: 'plan_scan_doors',
    description:
      'Reads which way the plan\'s doors open from a source drawing: for each door all four options (hinge at either jamb × leaf to either side) are scored by how much of their swing arc lies on ink. Reports the best option, its score against the runner-up, and whether it differs from the plan; apply=true saves the confident corrections. Use the drawing that shows the doors (a before drawing for doors being removed). Never set hinge/swing by eye.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        door_ids: { type: 'array', items: { type: 'string' }, description: 'Default: all doors' },
        apply: { type: 'boolean' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const ids = Array.isArray(args.door_ids) ? args.door_ids.map(String) : undefined
      const { readings, ops } = readDoors(g, r, plan, ids, threshold)
      const fmt = (c: { hinge: string; swing: string; score: number }) => `${c.hinge}/${c.swing} ${Math.round(c.score * 100)}%`
      const lines = readings.map((x) => {
        const o = plan.openings.find((q) => q.id === x.id)!
        const wall = plan.walls.find((w) => w.id === o.wallId)!
        const status = !x.best ? 'HITTAS INTE i ritningen' : !x.confident ? 'OSÄKER' : x.changed ? 'FEL i planen →' : 'ok'
        const shown = x.best && x.confident ? describeDoor(wall, { ...o, hinge: x.best.hinge, swing: x.best.swing }) : describeDoor(wall, o)
        const off = x.best?.shiftMm ? ` (ritad ${x.best.shiftMm} mm från planens läge)` : ''
        return `- ${x.id}: ${status} ${shown}${off} [${x.candidates.map(fmt).join(', ')}]`
      })
      let head = `${readings.length} dörrar mot ${r.id}; ${ops.length} att rätta.`
      let after = plan
      if (args.apply && ops.length) {
        const saved = await save(planId, args.base_revision, ops, `Dörrar enligt ${r.id} (${ops.length} rättade)`)
        if (typeof saved === 'string') return err(`${head}\n${lines.join('\n')}\n\n${saved}`)
        head += ` Sparad som revision ${saved.n}.`
        after = saved.plan
      }
      const doorWalls = after.walls.filter((w) => after.openings.some((o) => o.kind === 'door' && o.wallId === w.id && (!ids || ids.includes(o.id))))
      const content: Content = [text(`${head}\n${lines.join('\n')}`)]
      if (doorWalls.length) content.push(image((await scanView(planId, after, r, around(doorWalls, 1200), { overlay: true, view: 'fore' })).png))
      return { content }
    },
  },
]
