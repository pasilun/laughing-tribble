import { ConflictError, PublicError } from '@/lib/plan/store'

export type Ctx = { params: Promise<{ id: string }> }

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function fail(e: unknown) {
  if (e instanceof ConflictError) return Response.json({ errors: [e.message], head: e.head }, { status: 409 })
  if (e instanceof PublicError) return Response.json({ errors: [e.message] }, { status: e.status })
  // Anything else is ours to look at, not the caller's: it may name files, hosts or table names.
  console.error('[api]', e)
  return Response.json({ errors: ['Något gick fel på servern – försök igen.'] }, { status: 500 })
}

export function revParam(req: Request): number | undefined {
  const v = new URL(req.url).searchParams.get('rev')
  return v ? Number(v) : undefined
}

export function author(v: unknown): 'user' | 'claude' {
  return v === 'claude' ? 'claude' : 'user'
}
