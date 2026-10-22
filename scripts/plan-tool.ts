// Runs a plan tool (the same ones Claude gets over MCP) from the command line,
// against the local file store. Text goes to stdout, images to files.
//   npx tsx scripts/plan-tool.ts <tool> '<json args>' [--out dir] [--file path]
//   args may be @file.json; --file fills data_base64 and filename.
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

process.env.PLAN_STORE ??= 'fs'

async function main() {
  const argv = process.argv.slice(2)
  const flag = (k: string) => {
    const i = argv.indexOf(k)
    if (i < 0) return undefined
    const v = argv[i + 1]
    argv.splice(i, 2)
    return v
  }
  const out = flag('--out') ?? '.data/tool-out'
  const file = flag('--file')
  const [tool, raw = '{}'] = argv
  if (!tool) {
    const { PLAN_TOOLS } = await import('../lib/plan/mcp-tools')
    console.log(PLAN_TOOLS.map((t) => `${t.name}: ${t.description.split('\n')[0]}`).join('\n'))
    return
  }
  const args = JSON.parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw) as Record<string, unknown>
  if (file) {
    args.data_base64 = readFileSync(file).toString('base64')
    args.filename ??= path.basename(file)
  }
  const { handlePlanTool } = await import('../lib/plan/mcp-tools')
  const res = await handlePlanTool(tool, args)
  if (!res) throw new Error(`okänt verktyg ${tool}`)
  mkdirSync(out, { recursive: true })
  let n = 0
  for (const c of res.content) {
    if (c.type === 'text') console.log(c.text)
    else {
      const p = path.join(out, `${tool}-${Date.now().toString(36)}-${++n}.png`)
      writeFileSync(p, Buffer.from(c.data, 'base64'))
      console.log(`[bild] ${p}`)
    }
  }
  if (res.isError) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
