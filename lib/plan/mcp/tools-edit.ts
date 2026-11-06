import { finishPlan } from '../assist/finish'
import { checkPlan } from '../domain/checks'
import type { Op } from '../domain/ops'
import type { Plan, View } from '../domain/types'
import { createPlan, editPlan, importPlan, loadPlan, tagPlan } from '../service'
import { changedSince, links, preview } from './format'
import { OPS_SHORT } from './ops-docs'
import { refuse, text, type Tool } from './tool'

// Changing plans: create, import, edit by operations, tags, and the last mechanical steps.

export const EDIT_TOOLS: Tool[] = [
  {
    name: 'plan_create',
    description:
      'Creates a new floor plan and returns its id and editor link. By default it records what exists today: do not add changes, demolition or a new layout unless the user asks. If the user has a drawing or photo, call plan_upload_link next and trace from it (see plan_guide); otherwise start empty and add walls with plan_edit, or pass a full plan.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name, e.g. "Källare Lundagatan 48 B"' },
        template: { type: 'string', enum: ['empty', 'demo'], description: 'demo = a made-up example plan' },
      },
      required: ['name'],
    },
    run: async (args) => {
      const res = await createPlan({ name: String(args.name ?? 'Planritning'), template: args.template === 'demo' ? 'demo' : 'empty', author: 'claude' })
      if ('errors' in res) return { content: [text(res.errors!.join('\n'))], isError: true }
      return { content: [text(`Skapad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan, res.revision.n)}\n\nHar användaren en ritning eller bild att rita av? Anropa plan_upload_link nu och rita ingenting förrän ritningen är uppladdad. Rita det ritningen visar, inga ändringar om användaren inte ber om det.`), await preview(res.plan, 'efter', false)] }
    },
  },
  {
    name: 'plan_import',
    description: 'Creates a new floor plan from a full plan JSON (walls, openings, fixtures, rooms, sheet…), e.g. one traced elsewhere or exported with plan_get include_json. Returns the new id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        plan: { type: 'object' },
        copy_sources_from: { type: 'string', description: 'Plan id whose source drawings (plan.sources ids) are copied into the new plan; without it sources are dropped' },
      },
      required: ['name', 'plan'],
    },
    run: async (args) => {
      const input = args.plan as Partial<Plan> | undefined
      const res = await importPlan(input, String(args.name ?? ''), typeof args.copy_sources_from === 'string' ? args.copy_sources_from : undefined)
      if ('errors' in res) return refuse(res.stage === 'input' ? res.errors.join('\n') : `Kunde inte importera:\n${res.errors.join('\n')}`)
      if (res.copied !== null) return { content: [text(`Importerad: ${res.plan.id}, revision ${res.revision.n} (${res.copied} källritningar kopierade)\n${links(res.plan, res.revision.n)}`)] }
      return { content: [text(`Importerad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan, res.revision.n)}`), await preview(res.plan, 'efter', false)] }
    },
  },
  {
    name: 'plan_edit',
    description: `Changes a floor plan with small operations and saves them as a new revision. Pass base_revision from plan_get; if the user has saved since, the call is rejected — read the plan again and redo the change. Returns the new revision and only the findings that are new (plan_check lists all); add image:true for a preview picture.\n\n${OPS_SHORT}`,
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        message: { type: 'string', description: 'What changed, in Swedish, e.g. "Breddade öppningen till 1000 mm"' },
        ops: { type: 'array', items: { type: 'object' } },
        view: { type: 'string', enum: ['fore', 'efter'] },
        image: { type: 'boolean', description: 'Also return a picture of the sheet (default no)' },
      },
      required: ['plan_id', 'base_revision', 'message', 'ops'],
    },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const view: View = args.view === 'fore' ? 'fore' : 'efter'
      if (!Array.isArray(args.ops) || typeof args.base_revision !== 'number') return { content: [text('ops (lista) och base_revision (nummer) krävs')], isError: true }
      const before = await loadPlan(planId)
      const res = await editPlan(planId, args.ops as Op[], args.base_revision, 'claude', String(args.message ?? 'Ändring av Claude'))
      if (res.status !== 200) {
        const hint = res.status === 409 ? '\nLäs planen igen med plan_get och gör om ändringen mot den senaste revisionen.' : ''
        return { content: [text(`Ingen ändring sparades:\n${res.errors.join('\n')}${hint}`)], isError: true }
      }
      // Only what this edit changed in the findings: the model already knows the rest.
      const key = (f: { level: string; message: string }) => `${f.level}|${f.message}`
      const was = new Set(before ? checkPlan(before.plan).map(key) : [])
      const now = checkPlan(res.plan)
      const fresh = now.filter((f) => !was.has(key(f)))
      const gone = (before ? checkPlan(before.plan) : []).filter((f) => !now.some((n) => key(n) === key(f))).length
      const changes = changedSince(before?.plan ?? res.plan, res.plan)
      const text1 = `Sparad som revision ${res.revision.n}.\n${changes ? `Ändrat:\n${changes}\n` : ''}Nya anmärkningar: ${fresh.length ? `\n${fresh.map((f) => `- [${f.level}] ${f.message}`).join('\n')}` : 'inga'}${gone ? `\n${gone} tidigare anmärkningar är borta.` : ''}\nTotalt ${now.length} anmärkningar (plan_check listar alla).`
      return { content: args.image === true ? [text(text1), await preview(res.plan, view, false)] : [text(text1)] }
    },
  },
  {
    name: 'plan_tags',
    description: 'Sets the tags of a plan (replaces them), e.g. ["Gnejsen 152–154", "förslag B"]: the project or proposal it belongs to, shown and searchable in the plan list. Not a revision of the drawing. Pass [] to clear.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['plan_id', 'tags'] },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      if (!Array.isArray(args.tags)) return refuse('tags måste vara en lista')
      const res = await tagPlan(planId, args.tags)
      if ('errors' in res) return refuse(res.status === 404 ? `Planen ${planId} finns inte` : res.errors.join('\n'))
      return { content: [text(res.tags.length ? `Taggar: ${res.tags.join(', ')}` : 'Taggarna är borttagna.')] }
    },
  },
  {
    name: 'plan_finish',
    description:
      'The last mechanical steps of a plan, in one call: sets the largest sheet scale (and orientation) where the plan fills the paper, adds the overall dimension lines if there are none, optionally marks the exterior walls load-bearing, runs plan_review and plan_check, and lists what only the user can supply (property, address, flat number, drawn by). Saves one revision if it changed anything. Call it when the drawing is traced, then fix what it lists and ask the user for the missing title block fields in one question.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number', description: 'Defaults to the latest revision' },
        mark_exterior_load_bearing: { type: 'boolean', description: 'Mark exterior walls load-bearing (basements and masonry houses). Default false.' },
        fit_outer: { type: 'boolean', description: 'With printed_outer_mm: when the traced outside size is more than 30 mm but less than 3 % off the printed one, scale the plan (and the source drawing) to it. Use after tracing when the printed size is known.' },
        printed_outer_mm: {
          type: 'object',
          description: 'The overall outside size printed on the drawing, e.g. {"width":6080,"length":10500}. The traced plan is compared with it; more than 30 mm off is flagged. Always pass it when the drawing has them.',
          properties: { width: { type: 'number' }, length: { type: 'number' } },
          required: ['width', 'length'],
        },
        view: { type: 'string', enum: ['fore', 'efter'], description: 'Only for plans with demolished/new parts: which sheet (default efter)' },
      },
      required: ['plan_id'],
    },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const view: View = args.view === 'fore' ? 'fore' : 'efter'
      const rev = await loadPlan(planId)
      if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
      const po = args.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
      const printedOuter = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
      const fin = finishPlan(rev.plan, { markExteriorLoadBearing: args.mark_exterior_load_bearing === true, printedOuter, fitOuter: args.fit_outer === true })
      let plan = rev.plan
      let n = rev.meta.n
      if (fin.ops.length) {
        const res = await editPlan(planId, fin.ops, typeof args.base_revision === 'number' ? args.base_revision : n, 'claude', 'Färdigställd: blad, yttermått, våningsplan')
        if (res.status !== 200) return { content: [text(`Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs planen igen med plan_get och kör plan_finish mot senaste revisionen.' : ''}`)], isError: true }
        plan = res.plan
        n = res.revision.n
      }
      const done = fin.done.length ? fin.done.map((d) => `- ${d}`).join('\n') : '- inget behövde ändras'
      const order = { error: 0, warning: 1, info: 2 }
      const left = [...fin.findings].sort((a, b) => order[a.level] - order[b.level]).map((f) => `- [${f.level}] ${f.message}`).join('\n') || '- inga'
      const ask = fin.ask.length ? `\n\nFråga användaren (ett meddelande): ${fin.ask.join('; ')}. Sätt fälten med setTitleBlock. Skriv inte in egna gissningar.` : ''
      return {
        content: [
          text(`Färdigställd, revision ${n}.\nGjort:\n${done}\n\nKvarstår att åtgärda eller förklara:\n${left}${ask}\n\n${links(plan, n)}`),
          await preview(plan, view, false),
        ],
      }
    },
  },
]
