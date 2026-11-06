import { isAdmin, secured } from '@/lib/plan/auth/access'
import { currentUser } from '@/lib/plan/auth/user'
import { copyBlobToTurso, storageStatus } from '@/lib/plan/storage/admin'
import { fail, readJson } from '../http'

export const runtime = 'nodejs'
export const maxDuration = 60

const gate = (): Response | null => {
  const me = currentUser()
  return me && isAdmin(me) ? null : Response.json({ errors: ['Bara administratörer.'] }, { status: 403 })
}

// Where the data lives and what can be done about it (administrators).
export const GET = secured(async (): Promise<Response> => {
  const no = gate()
  if (no) return no
  return Response.json(storageStatus())
})

// Copies the Blob store into Turso, a stretch at a time: { cursor? } in, { copied, bytes, missing, cursor, done } out.
// Call again with the cursor until done. Safe to repeat. Only while the app still uses Blob.
export const POST = secured(async (req: Request): Promise<Response> => {
  const no = gate()
  if (no) return no
  const body = await readJson(req)
  try {
    const res = await copyBlobToTurso(typeof body?.cursor === 'string' ? body.cursor : undefined)
    return 'errors' in res ? Response.json({ errors: res.errors }, { status: res.status }) : Response.json(res)
  } catch (e) {
    return fail(e)
  }
})
