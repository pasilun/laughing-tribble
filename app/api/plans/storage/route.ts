import { isAdmin, secured } from '@/lib/plan/auth/access'
import { copyPages } from '@/lib/plan/storage/migrate-store'
import { blobBackend, blobConfigured, storageKind, tursoBackend, tursoConfigured } from '@/lib/plan/storage/storage'
import { currentUser } from '@/lib/plan/auth/user'
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
  return Response.json({ kind: storageKind(), blob: blobConfigured(), turso: tursoConfigured() })
})

// Copies the Blob store into Turso, a stretch at a time: { cursor? } in, { copied, bytes, missing, cursor, done } out.
// Call again with the cursor until done. Safe to repeat. Only while the app still uses Blob.
export const POST = secured(async (req: Request): Promise<Response> => {
  const no = gate()
  if (no) return no
  if (!blobConfigured() || !tursoConfigured()) return Response.json({ errors: ['Både Blob och Turso måste vara inställda (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN).'] }, { status: 400 })
  if (storageKind() !== 'blob') return Response.json({ errors: ['Appen använder redan inte Blob.'] }, { status: 400 })
  const body = await readJson(req)
  try {
    const blob = blobBackend()
    const target = tursoBackend()
    const res = await copyPages(blob, target, { cursor: typeof body?.cursor === 'string' ? body.cursor : undefined })
    return Response.json({ ...res, inTurso: res.done ? await target.count() : undefined })
  } catch (e) {
    return fail(e)
  }
})
