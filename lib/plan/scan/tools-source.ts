import { putAsset } from '../storage/store'
import type { Pt } from '../domain/types'
import { addSource, type SourceInput } from './add-source'
import { calibrate, rescaleAround, type Measurement } from './calibrate'
import { findDimensionEnds } from './dimension'
import { scanDiff } from './diff'
import { profile, roundRun } from './profile'
import sharp from 'sharp'
import { loadGray, loadPng, resolveSource, toPx, type Raster } from './raster'
import { register } from './register'
import { scanView } from './view'
import { err, image, rectOf, RECT, PT, SRC, save, sourceOps, text, type ScanTool } from './kit'


// Placing a drawing in the plan: adding it, looking at it, measuring, calibrating, aligning, comparing.

export const SOURCE_TOOLS: ScanTool[] = [
  {
    name: 'plan_source_add',
    description:
      'Adds a source drawing (archive TIF, PDF export, PNG/JPG photo of a drawing) to a plan. It is converted to PNG on the server and placed in plan mm from its scale and resolution (PDF pages are rendered at 200 dpi). Calibrate it with plan_scan_calibrate before tracing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        id: { type: 'string', description: 'Short id, e.g. "arkiv-1950" or "efter-skiss"' },
        name: { type: 'string' },
        role: { type: 'string', enum: ['archive', 'before', 'after', 'other'] },
        filename: { type: 'string', description: 'Original file name (extension decides the format)' },
        data_base64: { type: 'string' },
        scale: { type: 'number', description: 'Drawing scale denominator, e.g. 100 for 1:100' },
        dpi: { type: 'number', description: 'Scan resolution if not in the file' },
        mm_per_px: { type: 'number', description: 'Overrides scale/dpi' },
        x: { type: 'number', description: 'Plan mm of the image top-left (default 0)' },
        y: { type: 'number' },
        year: { type: 'number', description: 'When the drawing was made (older drawings show the building as it was then)' },
        view: { type: 'string', enum: ['plan', 'elevation'], description: 'elevation = a facade drawing (read with plan_scan_elevation)' },
      },
      required: ['plan_id', 'base_revision', 'id', 'filename', 'data_base64'],
    },
    run: async (ctx) => {
      const { planId, args } = ctx
      if (typeof args.base_revision !== 'number') return err('base_revision krävs för att spara')
      const data = Buffer.from(String(args.data_base64 ?? ''), 'base64')
      if (data.length === 0) return err('data_base64 är tom')
      const added = await addSource(planId, { ...(args as unknown as SourceInput), id: String(args.id ?? ''), filename: String(args.filename ?? '') }, data)
      if ('errors' in added) return err(`Ingen ändring sparades:\n${added.errors.join('\n')}${added.status === 409 ? '\nLäs planen igen (plan_get) och använd senaste revision.' : ''}`)
      const { source, mmPerPx, dpi } = added
      const wMm = Math.round(added.widthPx * mmPerPx)
      const hMm = Math.round(added.heightPx * mmPerPx)
      const r = resolveSource(added.plan, source.id)
      const view = await scanView(planId, added.plan, r, { x: source.x, y: source.y, w: wMm, h: hMm }, { maxPx: 1200 })
      return {
        content: [
          text(`Sparad som revision ${added.n}. Källa ${source.id}: ${added.widthPx}×${added.heightPx} px (${added.kind}${dpi ? `, ${Math.round(dpi)} dpi` : ''}), ${mmPerPx.toFixed(4)} mm/px ≈ ${wMm}×${hMm} mm, övre vänstra hörnet (${source.x},${source.y}).${added.note}`),
          image(view.png),
        ],
      }
    },
  },
  {
    name: 'plan_scan_view',
    description:
      'Shows an area of a source drawing in plan mm with a labelled mm grid (read positions off it). overlay=true draws the plan\'s walls on top (red existing, orange rivs, blue ny, ids labelled; openings purple) to check tracing.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, source_id: SRC, rect: RECT, grid_mm: { type: 'number' }, overlay: { type: 'boolean' }, view: { type: 'string', enum: ['fore', 'efter'] }, max_px: { type: 'number' } },
      required: ['plan_id', 'rect'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const rect = rectOf(args.rect)
      if (!rect) return err('rect {x,y,w,h} i mm krävs')
      const v = await scanView(planId, plan, r, rect, {
        gridMm: typeof args.grid_mm === 'number' ? args.grid_mm : undefined,
        overlay: !!args.overlay,
        view: args.view === 'fore' ? 'fore' : 'efter',
        maxPx: typeof args.max_px === 'number' ? Math.min(2400, args.max_px) : undefined,
      })
      return { content: [text(`Källa ${r.id}, utsnitt (${rect.x},${rect.y}) ${rect.w}×${rect.h} mm, ${(1 / v.scale).toFixed(2)} mm per bildpixel (källan ${r.mmPerPx.toFixed(3)} mm/px).`), image(v.png)] }
    },
  },
  {
    name: 'plan_scan_profile',
    description: 'Ink runs along a line across a source drawing, in mm from the line start — measures wall thickness and position exactly. Draw the line across the wall(s).',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, source_id: SRC, from: PT, to: PT, threshold: { type: 'number' } },
      required: ['plan_id', 'from', 'to'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const from = args.from as Pt
      const to = args.to as Pt
      const p = profile(g, r, from, to, threshold)
      const runs = p.runs.map(roundRun)
      const lines = runs.map((x, i) => `${i + 1}. ${x.from}–${x.to} mm (bredd ${x.width}, mitt ${x.mid})`)
      return { content: [text(`Linje ${Math.round(p.length)} mm i källa ${r.id}, ${runs.length} mörka partier (± ${r.mmPerPx.toFixed(1)} mm):\n${lines.join('\n') || '–'}`)] }
    },
  },
  {
    name: 'plan_scan_dimension',
    description:
      'Finds the exact ends of printed dimension lines in the source drawing and calibrates the scale from them. Give each dimension as a rough a→b (plan mm, read off a plan_scan_view crop: the two ends of the dimension line, where its end strokes are) and the printed value in mm. The end strokes (extension lines, ticks) are found to about a pixel, so the scale does not depend on how well the pixel positions were eyeballed. Returns the refined ends, the measured length against the printed one and the scale factor; apply=true calibrates the source with them (like plan_scan_calibrate). Use at least two dimensions, one in each direction, and prefer the long overall ones. Note: a printed dimension is usually between the outer faces of the walls.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        dimensions: {
          type: 'array',
          items: { type: 'object', properties: { a: PT, b: PT, mm: { type: 'number', description: 'The printed value in mm (6,08 m → 6080)' }, label: { type: 'string' } }, required: ['a', 'b', 'mm'] },
        },
        search_mm: { type: 'number', description: 'How far from each given end a stroke is looked for (default 350)' },
        apply: { type: 'boolean' },
      },
      required: ['plan_id', 'dimensions'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const dims = (Array.isArray(args.dimensions) ? args.dimensions : []) as Array<{ a: Pt; b: Pt; mm: number; label?: string }>
      if (!dims.length) return err('dimensions krävs: [{a, b, mm}]')
      const searchMm = typeof args.search_mm === 'number' ? args.search_mm : undefined
      const refined: Measurement[] = []
      const lines: string[] = []
      for (const [i, dm] of dims.entries()) {
        const label = dm.label ?? `mått ${i + 1}`
        const ends = findDimensionEnds(g, r, dm.a, dm.b, { searchMm, threshold })
        const note = (e: { found: boolean; moved: number; strength: number }, name: string) => (e.found ? `${name} flyttad ${e.moved} mm (streck ${e.strength} px)` : `${name}: inget tydligt ändstreck hittat, behåller din punkt`)
        const a2 = ends.a.found ? ends.a.point : dm.a
        const b2 = ends.b.found ? ends.b.point : dm.b
        refined.push({ a: a2, b: b2, mm: dm.mm, label })
        lines.push(`- ${label}: (${a2.x},${a2.y})→(${b2.x},${b2.y}); ${note(ends.a, 'a')}; ${note(ends.b, 'b')}`)
      }
      const c = calibrate(r, refined)
      const res = c.residuals.map((x) => `- ${x.label}: tryckt ${x.measuredMm}, ritat ${x.drawnMm} (${x.residualMm >= 0 ? '+' : ''}${x.residualMm} mm, ${x.residualPct}%)`).join('\n')
      // Several dimensions should agree on one scale; a spread means a misread value or a skewed scan.
      const factors = refined.map((m) => m.mm / Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y))
      const spread = (Math.max(...factors) - Math.min(...factors)) / (factors.reduce((x, y) => x + y, 0) / factors.length)
      let out = `Hittade ändstreck:\n${lines.join('\n')}\n\nFaktor ${c.factor.toFixed(5)} (${((c.factor - 1) * 100).toFixed(2)}%) → ${c.mmPerPx.toFixed(4)} mm/px. RMS ${c.rmsMm} mm.\n${res}`
      if (refined.length > 1 && spread > 0.01) out += `\nOBS: måtten ger olika skala (${(spread * 100).toFixed(1)}% spridning) – kontrollera de tryckta värdena, vilka punkter som avses, eller om skanningen är skev.`
      // A scan is often stretched a little more along one axis than the other (1 % or
      // more is common). The scan tools work on one scale, so when the horizontal and
      // the vertical dimensions disagree the image is resampled to one scale.
      const axisFactor = (horizontal: boolean) => {
        const ms = refined.filter((m) => {
          const dx = Math.abs(m.b.x - m.a.x)
          const dy = Math.abs(m.b.y - m.a.y)
          return horizontal ? dx >= 2 * dy : dy >= 2 * dx
        })
        if (!ms.length) return null
        let sdm = 0
        let sdd = 0
        for (const m of ms) {
          const d = horizontal ? Math.abs(m.b.x - m.a.x) : Math.abs(m.b.y - m.a.y)
          sdm += d * m.mm
          sdd += d * d
        }
        return { k: sdm / sdd, len: Math.sqrt(sdd) }
      }
      const fx = axisFactor(true)
      const fy = axisFactor(false)
      const skew = fx && fy ? Math.abs(fx.k - fy.k) / ((fx.k + fy.k) / 2) : 0
      if (fx && fy) out += `\nSkala per axel: vågrätt ${(r.mmPerPx * fx.k).toFixed(4)} mm/px, lodrätt ${(r.mmPerPx * fy.k).toFixed(4)} mm/px (skillnad ${(skew * 100).toFixed(2)}%).`
      if (args.apply) {
        if (fx && fy && skew > 0.005) {
          const kx = r.mmPerPx * fx.k
          const ky = r.mmPerPx * fy.k
          const kb = fx.len >= fy.len ? kx : ky // keep the scale of the longer dimension
          const png = await loadPng(planId, r)
          const sx = kx / kb
          const sy = ky / kb
          const w = Math.max(1, Math.round(r.widthPx * sx))
          const h = Math.max(1, Math.round(r.heightPx * sy))
          const straight = await sharp(png, { limitInputPixels: 200_000_000 }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
          const anchor = refined[0].a
          const apx = toPx(r, anchor)
          const src = await putAsset(planId, `src-${r.id}-rak-${Date.now().toString(36)}.png`, straight, 'image/png')
          const patch = {
            src,
            widthPx: w,
            heightPx: h,
            mmPerPx: kb,
            x: Math.round(anchor.x - apx.x * sx * kb),
            y: Math.round(anchor.y - apx.y * sy * kb),
            calibration: `${refined.length} tryckta mått (ändstreck funna), bilden rätad (${(skew * 100).toFixed(1)}% skillnad mellan axlarna)`,
          }
          const saved = await save(planId, args.base_revision, sourceOps(plan, r, patch), `Kalibrerade och rätade ${r.id} från tryckta mått`)
          if (typeof saved === 'string') return err(`${out}\n\n${saved}`)
          out += `\nBilden var sträckt ${(skew * 100).toFixed(1)}% mer längs en axel: den är omsamplad till en skala (${kb.toFixed(4)} mm/px, ${w}×${h} px). Mått du redan ritat mot den gamla bilden kan ligga fel – ritade väggar behöver snappas om. Sparad som revision ${saved.n}.`
        } else {
          const next = rescaleAround(r, c.factor, refined[0].a)
          const patch = { mmPerPx: next.mmPerPx, x: Math.round(next.x), y: Math.round(next.y), calibration: `${refined.length} tryckta mått (ändstreck funna), RMS ${c.rmsMm} mm` }
          const saved = await save(planId, args.base_revision, sourceOps(plan, r, patch), `Kalibrerade ${r.id} från tryckta mått (${((c.factor - 1) * 100).toFixed(2)}%)`)
          if (typeof saved === 'string') return err(`${out}\n\n${saved}`)
          out += `\nSparad som revision ${saved.n}.`
        }
      }
      return { content: [text(out)] }
    },
  },
  {
    name: 'plan_scan_calibrate',
    description:
      'Fits a source drawing\'s scale to known distances (laser measurements, dimension figures, scale bar). Each measurement: two points read off the drawing in plan mm (current calibration) and the true length. Returns the factor and residual per measurement; apply=true saves it, scaling around anchor (default: first point) so nearby tracing stays put.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        measurements: { type: 'array', items: { type: 'object', properties: { a: PT, b: PT, mm: { type: 'number' }, label: { type: 'string' } }, required: ['a', 'b', 'mm'] } },
        apply: { type: 'boolean' },
        anchor: PT,
        offset: { type: 'object', description: 'Also move the source by {dx,dy} mm (align to the plan)', properties: { dx: { type: 'number' }, dy: { type: 'number' } } },
      },
      required: ['plan_id', 'measurements'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const ms = (Array.isArray(args.measurements) ? args.measurements : []) as Measurement[]
      const c = calibrate(r, ms)
      const res = c.residuals.map((x) => `- ${x.label}: uppmätt ${x.measuredMm}, ritat ${x.drawnMm} (${x.residualMm >= 0 ? '+' : ''}${x.residualMm} mm, ${x.residualPct}%)`).join('\n')
      let out = `Faktor ${c.factor.toFixed(5)} (${((c.factor - 1) * 100).toFixed(2)}%) → ${c.mmPerPx.toFixed(4)} mm/px. RMS ${c.rmsMm} mm.\n${res}`
      if (args.apply) {
        const anchor = (args.anchor as Pt | undefined) ?? ms[0].a
        const next = rescaleAround(r, c.factor, anchor)
        const off = (args.offset ?? {}) as { dx?: number; dy?: number }
        const patch = { mmPerPx: next.mmPerPx, x: Math.round(next.x + (off.dx ?? 0)), y: Math.round(next.y + (off.dy ?? 0)), calibration: `${ms.length} mått, RMS ${c.rmsMm} mm` }
        const saved = await save(planId, args.base_revision, sourceOps(plan, r, patch), `Kalibrerade ${r.id} (${((c.factor - 1) * 100).toFixed(2)}%)`)
        if (typeof saved === 'string') return err(`${out}\n\n${saved}`)
        out += `\nSparad som revision ${saved.n}.`
      }
      return { content: [text(out)] }
    },
  },
  {
    name: 'plan_scan_register',
    description:
      'Aligns a source drawing to a reference source (scale + offset) by matching ink over an area both show — e.g. a ventilation or structural drawing onto the architectural plan. Place it roughly first (within shift_mm). Returns the fit and an overlay image of both (reference red, aligned source blue); apply=true saves the new position.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: { type: 'string', description: 'The drawing to move' },
        reference: { type: 'string', description: 'Source id to align to' },
        rect: RECT,
        scale_min: { type: 'number', description: 'default 0.9' },
        scale_max: { type: 'number', description: 'default 1.1' },
        shift_mm: { type: 'number', description: 'Search ± this far (default 2000)' },
        apply: { type: 'boolean' },
        threshold: { type: 'number' },
      },
      required: ['plan_id', 'source_id', 'reference', 'rect'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)
      const g = await loadGray(planId, r)
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const rect = rectOf(args.rect)
      if (!rect) return err('rect {x,y,w,h} i mm krävs')
      const rr = resolveSource(plan, String(args.reference))
      if (rr.id === r.id) return err('source_id och reference måste vara olika källor')
      const fit = register({ g: await loadGray(planId, rr), r: rr }, { g, r }, rect, {
        scaleMin: typeof args.scale_min === 'number' ? args.scale_min : undefined,
        scaleMax: typeof args.scale_max === 'number' ? args.scale_max : undefined,
        shiftMm: typeof args.shift_mm === 'number' ? args.shift_mm : undefined,
        threshold,
      })
      let out = `${r.id} mot ${rr.id}: skala ×${fit.scale.toFixed(4)} → ${fit.mmPerPx.toFixed(4)} mm/px, flytt (${fit.dx}, ${fit.dy}) mm → övre vänstra hörnet (${fit.x},${fit.y}). Överlapp ${fit.score} (1 = perfekt; under ~0.3 är tveksamt).`
      const moved: Raster = { ...r, mmPerPx: fit.mmPerPx, x: fit.x, y: fit.y }
      if (args.apply) {
        const saved = await save(planId, args.base_revision, sourceOps(plan, r, { mmPerPx: fit.mmPerPx, x: fit.x, y: fit.y, calibration: `inpassad mot ${rr.id} (överlapp ${fit.score})` }), `Passade in ${r.id} mot ${rr.id}`)
        if (typeof saved === 'string') return err(`${out}\n\n${saved}`)
        out += `\nSparad som revision ${saved.n}.`
      }
      const d = await scanDiff({ g: await loadGray(planId, rr), r: rr }, { g, r: moved }, rect, { threshold })
      return { content: [text(`${out}\nBild: rött = bara ${rr.id}, blått = bara ${r.id}, grått = båda.`), image(d.png)] }
    },
  },
  {
    name: 'plan_scan_diff',
    description: 'Compares two calibrated source drawings (e.g. före and efter) over an area: red = only in the first (removed), blue = only in the second (added), grey = both.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, before_source: { type: 'string' }, after_source: { type: 'string' }, rect: RECT, threshold: { type: 'number' } },
      required: ['plan_id', 'before_source', 'after_source', 'rect'],
    },
    run: async (ctx) => {
      const { planId, plan, args } = ctx
      const threshold = typeof args.threshold === 'number' ? args.threshold : undefined
      const rect = rectOf(args.rect)
      if (!rect) return err('rect {x,y,w,h} i mm krävs')
      const rb = resolveSource(plan, String(args.before_source))
      const ra = resolveSource(plan, String(args.after_source))
      const d = await scanDiff({ g: await loadGray(planId, rb), r: rb }, { g: await loadGray(planId, ra), r: ra }, rect, { threshold })
      return { content: [text(`Rött = bara i ${rb.id} (${d.removedPct}% av bläcket), blått = bara i ${ra.id} (${d.addedPct}%), grått = i båda.`), image(d.png)] }
    },
  },
]
