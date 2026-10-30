// Checks a running deployment end to end with a real login.
//   node scripts/smoke.mjs <url> <key> [<annan-nyckel>]
// Tests: health (storage round trip, image libraries, PDF), create/read/edit/
// export/delete a plan, and – with a second key – that the other person sees
// none of it. Leaves nothing behind. Exit code 1 on any failure.
const [base, key, other] = process.argv.slice(2)
if (!base || !key) {
  console.error('Användning: node scripts/smoke.mjs <adress> <nyckel> [<annan nyckel>]')
  process.exit(2)
}
const url = (p) => new URL(p, base.endsWith('/') ? base : `${base}/`).toString()
const call = (k, p, init = {}) => fetch(url(p), { ...init, headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json', ...(init.headers ?? {}) }, redirect: 'manual' })
let failed = 0
const step = async (name, fn) => {
  const t = Date.now()
  try {
    const detail = await fn()
    console.log(`ok    ${name}${detail ? ` – ${detail}` : ''} (${Date.now() - t} ms)`)
  } catch (e) {
    failed++
    console.log(`FEL   ${name} – ${e.message}`)
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

let id
await step('utan nyckel nekas', async () => {
  const r = await fetch(url('api/plans'))
  expect([401, 503].includes(r.status), `fick ${r.status}`)
})
await step('hälsokontroll', async () => {
  const r = await call(key, 'api/health')
  const j = await r.json()
  expect(r.status === 200 && j.ok, `status ${r.status}: ${JSON.stringify(j.storage?.ok === false ? j.storage : Object.entries(j.render ?? {}).filter(([, v]) => !v.ok))}`)
  return `${j.build.env} ${j.build.sha ?? ''} · lagring ${j.storage.kind} ${j.storage.ms} ms · ${j.auth.mode}, ${j.auth.users} personer`
})
await step('skapa plan', async () => {
  const r = await call(key, 'api/plans', { method: 'POST', body: JSON.stringify({ name: 'Rökprov (raderas)', template: 'demo' }) })
  expect(r.status === 201, `status ${r.status}`)
  id = (await r.json()).plan.id
})
await step('läsa och ändra', async () => {
  const r = await call(key, `api/plans/${id}/ops`, { method: 'POST', body: JSON.stringify({ ops: [{ op: 'setSheet', patch: { scale: 100 } }], baseRevision: 1, message: 'rökprov' }) })
  expect(r.status === 200, `ändra: status ${r.status}`)
  const g = await (await call(key, `api/plans/${id}`)).json()
  expect(g.revision.n === 2 && g.plan.sheet.scale === 100, 'ändringen syns inte')
})
for (const [name, q, magic] of [['PDF', 'format=pdf&view=both', '%PDF'], ['PNG', 'format=png&view=fore&width=800', '\x89PNG'], ['DXF', 'format=dxf&view=efter', 'SECTION']])
  await step(`exportera ${name}`, async () => {
    const r = await call(key, `api/plans/${id}/sheet?${q}`)
    const b = Buffer.from(await r.arrayBuffer())
    expect(r.status === 200 && b.subarray(0, 64).toString('latin1').includes(magic), `status ${r.status}, ${b.length} byte`)
    return `${b.length} byte`
  })
await step('MCP-anslutningen svarar', async () => {
  const r = await fetch(url(`api/mcp?key=${encodeURIComponent(key)}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'plan_get', arguments: { plan_id: id } } }) })
  const j = await r.json()
  expect(!j.result?.isError && JSON.stringify(j).includes(id), JSON.stringify(j).slice(0, 200))
})
if (other)
  await step('annan person ser ingenting', async () => {
    for (const [what, p] of [['planen', `api/plans/${id}`], ['PDF', `api/plans/${id}/sheet?format=pdf`], ['historiken', `api/plans/${id}/revisions`]]) {
      const r = await call(other, p)
      expect(r.status === 404, `${what}: status ${r.status} (väntade 404)`)
    }
    const list = await (await call(other, 'api/plans')).json()
    expect(!JSON.stringify(list).includes(id), 'planen syns i den andras lista')
    const del = await call(other, `api/plans/${id}`, { method: 'DELETE' })
    expect(del.status === 404, `den andra kunde radera: status ${del.status}`)
  })
await step('radera planen', async () => {
  if (!id) throw new Error('ingen plan att radera')
  const r = await call(key, `api/plans/${id}`, { method: 'DELETE' })
  expect(r.status === 200, `status ${r.status}`)
  expect((await call(key, `api/plans/${id}`)).status === 404, 'planen finns kvar')
})
console.log(failed ? `\n${failed} steg misslyckades` : '\nAlla steg gick bra')
process.exit(failed ? 1 : 0)
