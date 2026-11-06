import { auditPlan } from '../assist/audit'
import { comparePlans } from '../assist/compare'
import { describeReview, reviewPlan } from '../assist/review'
import { checkPlan } from '../domain/checks'
import { hasChanges } from '../domain/sheet'
import type { View } from '../domain/types'
import { loadPlan } from '../service'
import { listPlans, listRevisions } from '../storage/store'
import { changedSince, host, links, preview, SECTIONS, summarisePlan, type Section } from './format'
import { GUIDE } from './guide'
import { nextStep } from './guided'
import { OPS_DOC } from './ops-docs'
import { text, type Content, type Tool } from './tool'

// Reading: the guide, where a plan stands, the list, the plan itself, its checks, its history, a comparison.

export const READ_TOOLS: Tool[] = [
  {
    name: 'plan_guide',
    description: 'The working order for making a plan that can be trusted: getting the drawing into the plan, calibrating, tracing, comparing, reviewing, filling in the sheet. Read it before drawing anything from a drawing or photo.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['ops'], description: 'ops = the full reference for plan_edit operations' } } },
    run: async (args) => {
      return { content: [text(args.topic === 'ops' ? OPS_DOC : GUIDE)] }
    },
  },
  {
    name: 'plan_next',
    description: 'Where the plan stands and the one thing to do now, with the next call and its arguments filled in. Call it after every step; follow it.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const rev = await loadPlan(planId)
      if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
      const p = rev.plan
      const sources = (p.sources ?? []).filter((x) => x.view !== 'elevation')
      let open: number | undefined
      if (p.walls.length && p.openings.length && sources.some((x) => x.calibration)) open = (await auditPlan(planId, p)).filter((i) => i.level !== 'info').length
      const st = nextStep(p, { openIssues: open })
      return { content: [text(`Revision ${rev.meta.n}. Klart hittills: ${st.done.join(', ') || 'inget'}.\nNästa: ${st.next}${st.why ? `\n(${st.why})` : ''}`)] }
    },
  },
  {
    name: 'plan_list',
    description: 'Lists saved floor plans (planritningar) with their latest revision and tags. Plans shared with the user are marked with who owns them; plans the user shares say with whom.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const plans = await listPlans()
      const line = (p: (typeof plans)[number]) =>
        `${p.id}: ${p.name} (rev ${p.revision}${p.issued.length ? `, utfärdad ${p.issued.at(-1)}` : ''})${p.tags?.length ? ` [${p.tags.join(', ')}]` : ''}${p.owner ? ` – delad av ${p.owner}` : ''}${p.sharedWith?.length ? ` – delad med ${p.sharedWith.join(', ')}` : ''}`
      return { content: [text(plans.length ? plans.map(line).join('\n') : 'Inga planer.')] }
    },
  },
  {
    name: 'plan_get',
    description:
      'Reads a floor plan: a compact listing of every wall, opening, fixture and room with ids and measurements, the title block, the current revision number (needed for plan_edit), and a rendered drawing sheet. Set with_underlay to see the scanned drawing under the plan to check tracing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        revision: { type: 'number', description: 'Older revision to read (default latest)' },
        view: { type: 'string', enum: ['fore', 'efter'], description: 'Only for plans with demolished/new parts: which sheet (default efter)' },
        with_underlay: { type: 'boolean' },
        include_json: { type: 'boolean', description: 'Also return the full plan JSON' },
        only: { type: 'array', items: { type: 'string', enum: ['sheet', 'walls', 'openings', 'fixtures', 'rooms', 'sources'] }, description: 'Only these parts (default all). Cheaper when reworking.' },
        since: { type: 'number', description: 'Only what changed since this revision' },
        image: { type: 'boolean', description: 'Picture of the sheet (default yes, but not with only/since)' },
      },
      required: ['plan_id'],
    },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const view: View = args.view === 'fore' ? 'fore' : 'efter'
      const rev = await loadPlan(planId, typeof args.revision === 'number' ? args.revision : undefined)
      if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
      const only = Array.isArray(args.only) ? (args.only.filter((x): x is Section => (SECTIONS as readonly string[]).includes(String(x))) as Section[]) : undefined
      let body: string
      if (typeof args.since === 'number') {
        const old = await loadPlan(planId, args.since)
        if (!old) return { content: [text(`Revision ${args.since} finns inte`)], isError: true }
        body = changedSince(old.plan, rev.plan) || 'Inget har ändrats sedan dess.'
        body = `Ändrat sedan revision ${args.since}:\n${body}`
      } else body = summarisePlan(rev.plan, only?.length ? only : undefined)
      const parts: Content = [text(`Revision ${rev.meta.n} (${rev.meta.message})\n${body}\n\n${links(rev.plan, rev.meta.n)}`)]
      if (args.include_json) parts.push(text(JSON.stringify({ ...rev.plan, underlay: rev.plan.underlay ? { ...rev.plan.underlay, src: '…' } : undefined })))
      const narrow = (only?.length ?? 0) > 0 || typeof args.since === 'number'
      if (args.image === true || (args.image !== false && !narrow)) parts.push(await preview(rev.plan, view, !!args.with_underlay))
      return { content: parts }
    },
  },
  {
    name: 'plan_check',
    description: 'Checks a floor plan against what an anmälan for interior work needs to show (title block, scale fits, demolition of load-bearing walls, fire-cell boundaries, plugged connections, ventilation). Flags only — not a legal judgment.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const rev = await loadPlan(planId)
      if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
      const findings = checkPlan(rev.plan)
      return { content: [text(`Revision ${rev.meta.n}:\n${findings.map((f) => `- [${f.level}] ${f.message}`).join('\n') || '- inga anmärkningar'}\n\nKontrollen visar vad ritningen behöver visa; den gör ingen juridisk bedömning.`)] }
    },
  },
  {
    name: 'plan_review',
    description: 'Reviews a floor plan like an architect walking it: which rooms each door and opening joins, one entrance per flat (rooms need apartment set), every room reachable, no doors between flats or into walls, WC not off a kitchen and opening outward, doors not slamming into closets, habitable rooms with windows. Facts and flags to judge against the sources, not verdicts — see docs/plan-review.md.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' }, view: { type: 'string', enum: ['fore', 'efter'] } }, required: ['plan_id'] },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const rev = await loadPlan(planId)
      if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
      const v = args.view === 'efter' ? 'efter' : 'fore'
      return { content: [text(`Revision ${rev.meta.n}${hasChanges(rev.plan) ? `, ${v === 'fore' ? 'före' : 'efter'}` : ' (befintligt)'}:\n${describeReview(reviewPlan(rev.plan, v), rev.plan.rooms)}`)] }
    },
  },
  {
    name: 'plan_revisions',
    description: 'Lists the revision history of a floor plan (who changed what, issued revision letters).',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const revs = await listRevisions(planId)
      return { content: [text(revs.map((r) => `${r.n}${r.issued ? ` (rev ${r.issued})` : ''} ${r.createdAt.slice(0, 16)} ${r.author}: ${r.message}`).join('\n') || 'Inga revisioner.')] }
    },
  },
  {
    name: 'plan_compare',
    description:
      'Compares a plan with a reference plan of the same floor (e.g. archive-built vs surveyed). Walls are paired by id and the reference is mapped into the plan\'s frame by a fitted scale+offset per axis. Reports each wall\'s centreline and thickness difference, walls in only one plan, and openings matched (centre and width difference), missed and extra – a score for how well a plan was built.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, reference_id: { type: 'string' }, match_mm: { type: 'number', description: 'Max centre distance for an opening match (default 450)' } },
      required: ['plan_id', 'reference_id'],
    },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const a = await loadPlan(planId)
      const b = await loadPlan(String(args.reference_id ?? ''))
      if (!a || !b) return { content: [text('plan_id och reference_id måste finnas')], isError: true }
      const c = comparePlans(a.plan, b.plan, { matchMm: typeof args.match_mm === 'number' ? args.match_mm : undefined })
      const fit = (f: { scale: number; offset: number; rmsMm: number; n: number }) => `skala ${f.scale.toFixed(4)}, ${f.n} väggar, spridning ${f.rmsMm} mm`
      const lines = [
        `Inpassning x: ${fit(c.fit.x)}; y: ${fit(c.fit.y)}`,
        `Väggar (${c.walls.length} gemensamma): läge plan − referens, tjocklek plan − referens`,
        ...c.walls.map((w) => `- ${w.id} (${w.axis}): ${w.diffMm >= 0 ? '+' : ''}${w.diffMm} mm, tj ${w.thickness} mot ${w.refThickness} (${w.thicknessDiffMm >= 0 ? '+' : ''}${w.thicknessDiffMm})`),
        `Bara i referensen: ${c.wallsOnlyInRef.join(', ') || '–'}`,
        `Bara i planen: ${c.wallsOnlyInPlan.join(', ') || '–'}`,
        `Öppningar: ${c.openings.matched.length} matchade, ${c.openings.missed.length} saknas, ${c.openings.extra.length} extra`,
        ...c.openings.matched.map((m) => `- ✓ ${m.id} = ${m.refId}: mitt ${m.centreDiffMm} mm ifrån, bredd ${m.widthDiffMm >= 0 ? '+' : ''}${m.widthDiffMm}`),
        ...c.openings.missed.map((m) => `- ✗ saknas: ${m.refId} (${m.kind} i ${m.wallId})`),
        ...c.openings.extra.map((m) => `- + extra: ${m.id} (${m.kind} i ${m.wallId})`),
      ]
      return { content: [text(lines.join('\n'))] }
    },
  },
  {
    name: 'plan_upload_link',
    description:
      'Returns a link where the user drops a drawing (PNG, JPG, TIF or PDF, up to about 30 MB) so it becomes a source of the plan. A chat attachment cannot be passed to a tool, so use this whenever the user has a drawing or photo to trace. Afterwards read the plan (plan_get), view the source (plan_scan_view) and calibrate it (plan_scan_calibrate).',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      if (!(await loadPlan(planId))) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
      return {
        content: [
          text(
            `Be användaren öppna länken och släppa ritningen där (logga in med den personliga nyckeln första gången):\n${host()}/plans/${planId}/upload\n\nBe om ritningens skala (t.ex. 1:100) och år. När användaren säger att den är uppladdad: läs planen med plan_get (revisionen har ökat), titta på källan med plan_scan_view och kalibrera mot angivna mått med plan_scan_calibrate. Läs plan_guide för resten av arbetsordningen.`,
          ),
        ],
      }
    },
  },
]
