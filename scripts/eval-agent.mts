// Does a model make a good plan with these tools? Runs a model through the plan tools in this
// process (no server needed), on a drawing whose true size is known, and scores the result.
//
//   ANTHROPIC_API_KEY=… npx tsx scripts/eval-agent.mts --model claude-haiku-5-5 --profile basic
//   npx tsx scripts/eval-agent.mts --dry          (scripted stand-in model; checks the harness itself)
//
// Options: --model <id>  --profile basic|full (default full)  --turns <n> (default 40)
//          --price-in <usd/Mtok> --price-out <usd/Mtok> (to print a cost)  --out <dir> (default .visual)
// Writes <out>/eval-<model>-<profile>.json and .md (every call, shortened). The key is read from the
// environment only and never written anywhere.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = (name: string, d?: string) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? d : argv[i + 1]
}
const dry = argv.includes('--dry')
const model = opt('model', 'claude-haiku-5-5')!
const profile = opt('profile', 'full')!
const maxTurns = Number(opt('turns', '40'))
const outDir = opt('out', '.visual')!
const apiKey = process.env.ANTHROPIC_API_KEY
if (!dry && !apiKey) {
  console.error('ANTHROPIC_API_KEY saknas i miljön (lägg den i sessionens miljöinställningar, aldrig i chatten).')
  process.exit(2)
}

process.env.PLAN_STORE = 'fs'
process.env.PLAN_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'plan-eval-'))
const { runAs } = await import('../lib/plan/user')
const { createPlan, loadPlan } = await import('../lib/plan/service')
const { addSource } = await import('../lib/plan/scan/add-source')
const { handlePlanTool, toolsFor, instructionsFor } = await import('../lib/plan/mcp-tools')
const { finishPlan } = await import('../lib/plan/finish')
const { auditPlan } = await import('../lib/plan/audit')

// The case: the cellar drawing of the repository, 1:100, printed outside size 6,08 × 10,50 m.
const CASE = { file: 'e2e/fixtures/cellar/kallare.png', printed: { width: 6080, length: 10500 }, windows: 2 }

type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
type Msg = { role: 'user' | 'assistant'; content: string | Block[] }
type Reply = { content: Block[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }

async function askModel(system: string, tools: unknown[], messages: Msg[]): Promise<Reply> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4096, system, tools, messages }),
  })
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 400)}`)
  return (await r.json()) as Reply
}

// A stand-in that follows plan_next, to run the loop, the tools and the scoring without an API.
let scripted = 0
async function fakeModel(planId: string): Promise<Reply> {
  const calls: Array<[string, Record<string, unknown>]> = [
    ['plan_next', { plan_id: planId }],
    ['plan_trace', { plan_id: planId, printed_outer_mm: CASE.printed }],
    ['plan_audit', { plan_id: planId }],
    ['plan_fix', { plan_id: planId, apply: 'alla' }],
  ]
  const step = scripted++
  const usage = { input_tokens: 1000, output_tokens: 100 }
  if (step < calls.length) return { content: [{ type: 'tool_use', id: `t${step}`, name: calls[step][0], input: calls[step][1] }], stop_reason: 'tool_use', usage }
  return { content: [{ type: 'text', text: 'Klar (skriptad).' }], stop_reason: 'end_turn', usage }
}

const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n})` : s)

await runAs({ id: 'eval', legacy: true }, async () => {
  const created = (await createPlan({ name: 'Källare', author: 'claude' })) as { plan: { id: string } }
  const planId = created.plan.id
  const added = await addSource(planId, { id: 'kallare', name: 'Källarvåningen 1:100', role: 'archive', filename: 'kallare.png', scale: 100, dpi: 300, author: 'user' }, readFileSync(CASE.file))
  if ('errors' in added) throw new Error(added.errors.join('\n'))

  const tools = toolsFor(profile).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  const system = instructionsFor(profile)
  const messages: Msg[] = [{ role: 'user', content: `Jag har laddat upp en källritning (källa "kallare") till planen ${planId}. Gör en planritning av den.` }]
  const md: string[] = [`# ${dry ? 'dry run' : model} · profil ${profile} · ${tools.length} verktyg (~${Math.round(JSON.stringify(tools).length / 3.5)} tokens)\n`]
  const usage = { input: 0, output: 0 }
  const counts: Record<string, number> = {}
  let errors = 0
  let turns = 0
  const t0 = Date.now()

  for (; turns < maxTurns; turns++) {
    const reply = dry ? await fakeModel(planId) : await askModel(system, tools, messages)
    usage.input += reply.usage.input_tokens
    usage.output += reply.usage.output_tokens
    messages.push({ role: 'assistant', content: reply.content })
    for (const b of reply.content) if (b.type === 'text' && b.text.trim()) md.push(`**modell:** ${clip(b.text, 1200)}\n`)
    const uses = reply.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
    if (!uses.length) break
    const results: Block[] = []
    for (const u of uses) {
      counts[u.name] = (counts[u.name] ?? 0) + 1
      let content: unknown
      let isError = false
      try {
        const res = await handlePlanTool(u.name, u.input)
        if (!res) {
          isError = true
          content = [{ type: 'text', text: `Okänt verktyg ${u.name}` }]
        } else {
          isError = !!res.isError
          content = res.content.map((c) => (c.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } } : { type: 'text', text: c.text }))
          md.push(`- \`${u.name}\` ${clip(JSON.stringify(u.input), 300)}\n  → ${isError ? 'FEL ' : ''}${clip(res.content.filter((c) => c.type === 'text').map((c) => c.text).join(' / '), 500)}\n`)
        }
      } catch (e) {
        isError = true
        content = [{ type: 'text', text: (e as Error).message }]
        md.push(`- \`${u.name}\` kastade: ${(e as Error).message}\n`)
      }
      if (isError) errors++
      results.push({ type: 'tool_result', tool_use_id: u.id, content, ...(isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
  }

  // Score against what the drawing prints.
  const plan = (await loadPlan(planId))!.plan
  const fin = finishPlan(plan, { printedOuter: CASE.printed })
  const outer = fin.findings.find((f) => f.code === 'outer-size')
  const ext = plan.walls.filter((w) => w.exterior)
  const xs = (ext.length ? ext : plan.walls).flatMap((w) => [w.a.x, w.b.x])
  const ys = (ext.length ? ext : plan.walls).flatMap((w) => [w.a.y, w.b.y])
  const open = (await auditPlan(planId, plan, { printed: CASE.printed })).filter((i) => i.level !== 'info')
  const kinds = (k: string) => plan.openings.filter((o) => o.kind === k).length
  const score = {
    model: dry ? 'dry' : model,
    profile,
    tools: tools.length,
    toolDefinitionTokens: Math.round(JSON.stringify(tools).length / 3.5),
    turns: turns + 1,
    toolCalls: counts,
    toolErrors: errors,
    seconds: Math.round((Date.now() - t0) / 1000),
    tokens: usage,
    outerCheck: outer ? outer.message.slice(0, 200) : 'yttermåttet stämmer med det tryckta (±30 mm) eller är ojämfört',
    outerMm: xs.length ? `${Math.round(Math.max(...xs) - Math.min(...xs))} × ${Math.round(Math.max(...ys) - Math.min(...ys))} (centrumlinjer; tryckt ${CASE.printed.width} × ${CASE.printed.length} utvändigt)` : 'inga väggar',
    walls: plan.walls.length,
    exteriorWalls: ext.length,
    openings: { doors: kinds('door'), windows: kinds('window'), plain: kinds('opening'), windowsInDrawing: CASE.windows },
    rooms: plan.rooms.length,
    titleBlockFilled: Object.entries(plan.sheet.titleBlock).filter(([k, v]) => ['property', 'address', 'apartments', 'author'].includes(k) && String(v).trim()).length,
    openAuditFindings: open.length,
    revisions: (await loadPlan(planId))!.meta.n,
  }
  const pin = Number(opt('price-in', '')) || 0
  const pout = Number(opt('price-out', '')) || 0
  const cost = pin || pout ? (usage.input * pin + usage.output * pout) / 1e6 : undefined
  mkdirSync(outDir, { recursive: true })
  const base = path.join(outDir, `eval-${score.model}-${profile}`)
  writeFileSync(`${base}.json`, JSON.stringify({ ...score, ...(cost !== undefined ? { costUsd: Math.round(cost * 1000) / 1000 } : {}) }, null, 2))
  writeFileSync(`${base}.md`, md.join('\n'))
  console.log(JSON.stringify({ ...score, ...(cost !== undefined ? { costUsd: Math.round(cost * 1000) / 1000 } : {}) }, null, 2))
  console.log(`\nSamtal: ${base}.md`)
})
