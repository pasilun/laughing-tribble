import { accessMode } from '@/lib/plan/access'
import { activeAccount, otherAccounts, sessionCookies } from '@/lib/plan/accounts'
import { readJson } from '../http'

export const runtime = 'nodejs'

// The people signed in on this browser. Public like the login page: it only reports what the
// browser's own cookies prove. { me, others: [id] }; me is null when nobody is signed in.
export async function GET(req: Request) {
  if (accessMode() !== 'users') return Response.json({ me: null, others: [], signIn: false })
  const active = await activeAccount(req)
  const others = await otherAccounts(req)
  return Response.json({ me: active?.id ?? null, others: others.map((o) => o.id), signIn: true }, { headers: { 'cache-control': 'no-store' } })
}

const reply = (req: Request, body: unknown, active: string | null, others: Array<{ cookie: string }>, status = 200) => {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })
  const secure = new URL(req.url).protocol === 'https:'
  for (const c of sessionCookies(secure, active, others)) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

// Switches to another person already signed in here: { switchTo: "emil" }. The one in use moves to the list.
export async function POST(req: Request) {
  if (accessMode() !== 'users') return Response.json({ errors: ['inloggning med personliga nycklar används inte här'] }, { status: 400 })
  const body = await readJson(req)
  const want = typeof body?.switchTo === 'string' ? body.switchTo : ''
  const active = await activeAccount(req)
  const others = await otherAccounts(req)
  const target = others.find((o) => o.id === want)
  if (!target) return Response.json({ errors: ['Den personen är inte inloggad här. Logga in med nyckeln.'] }, { status: 404 })
  const rest = others.filter((o) => o.id !== want)
  return reply(req, { me: target.id, others: [...(active ? [active.id] : []), ...rest.map((o) => o.id)] }, target.cookie, [...(active ? [active] : []), ...rest])
}

// Signs out: the one in use (the next person signed in here takes over), or ?id=<other> only forgets that person.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  const active = await activeAccount(req)
  const others = await otherAccounts(req)
  if (id && id !== active?.id) {
    const rest = others.filter((o) => o.id !== id)
    return reply(req, { me: active?.id ?? null, others: rest.map((o) => o.id) }, active?.cookie ?? null, rest)
  }
  const [next, ...rest] = others
  return reply(req, { me: next?.id ?? null, others: rest.map((o) => o.id) }, next?.cookie ?? null, rest)
}
