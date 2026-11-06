import { secured } from '@/lib/plan/auth/access'
import { deleteDoc, purgeDoc, restoreDoc, type DocKind } from '@/lib/plan/storage/docs'
import { addShare, participants, removeShare } from '@/lib/plan/storage/shares'
import { fail, readJson } from './http'

// The routes every kind of document has the same: sharing, delete (to the trash, or for good from it) and restore.
// A kind's route files are one line each (see app/api/plans/[id]/share/route.ts and app/api/sites/[slug]/…).

type Params = { params: Promise<Record<string, string>> }
const idOf = async ({ params }: Params) => Object.values(await params)[0]
const missing = (kind: DocKind) => Response.json({ errors: [`${kind.noun} finns inte`] }, { status: 404 })

export const shareRoutes = (kind: DocKind) => ({
  // Who has the document: { owner, members, me, role }.
  GET: secured(async (_req: Request, ctx: Params): Promise<Response> => {
    try {
      const p = await participants(kind, await idOf(ctx))
      return p ? Response.json(p) : missing(kind)
    } catch (e) {
      return fail(e)
    }
  }),
  // Shares it with another person: { user: "emil" }. They then make revisions of it too.
  POST: secured(async (req: Request, ctx: Params): Promise<Response> => {
    const id = await idOf(ctx)
    const body = await readJson(req)
    if (typeof body?.user !== 'string' || !body.user.trim()) return Response.json({ errors: ['user krävs'] }, { status: 400 })
    try {
      const err = await addShare(kind, id, body.user)
      if (err) return Response.json({ errors: [err] }, { status: err === `${kind.noun} finns inte` ? 404 : 400 })
      return Response.json(await participants(kind, id), { status: 201 })
    } catch (e) {
      return fail(e)
    }
  }),
  // ?user=<id> takes a person out of it (yourself, or as owner anyone).
  DELETE: secured(async (req: Request, ctx: Params): Promise<Response> => {
    const id = await idOf(ctx)
    const who = new URL(req.url).searchParams.get('user')
    if (!who) return Response.json({ errors: ['user krävs'] }, { status: 400 })
    try {
      const err = await removeShare(kind, id, who)
      if (err) return Response.json({ errors: [err] }, { status: err === `${kind.noun} finns inte` ? 404 : 400 })
      return Response.json({ removed: who })
    } catch (e) {
      return fail(e)
    }
  }),
})

// Deletes it for the one who asks: the owner's goes to the trash (restorable for TRASH_DAYS), a member only leaves.
// ?permanent=1 removes one that is in the trash for good (not while others have it).
export const deleteRoute = (kind: DocKind) =>
  secured(async (req: Request, ctx: Params): Promise<Response> => {
    const id = await idOf(ctx)
    try {
      if (new URL(req.url).searchParams.get('permanent')) {
        const r = await purgeDoc(kind, id)
        if (r === 'notfound') return missing(kind)
        if (r === 'nottrashed') return Response.json({ errors: [`Flytta ${kind.noun} till papperskorgen först.`] }, { status: 400 })
        if (r === 'shared') return Response.json({ errors: [`${kind.noun[0].toUpperCase()}${kind.noun.slice(1)} delas fortfarande med någon och kan inte raderas för alltid.`] }, { status: 400 })
        return Response.json({ purged: id })
      }
      const how = await deleteDoc(kind, id)
      if (!how) return missing(kind)
      return Response.json({ deleted: id, how })
    } catch (e) {
      return fail(e)
    }
  })

// Takes it out of the trash.
export const restoreRoute = (kind: DocKind) =>
  secured(async (_req: Request, ctx: Params): Promise<Response> => {
    const id = await idOf(ctx)
    try {
      if (!(await restoreDoc(kind, id))) return Response.json({ errors: [`${kind.noun} ligger inte i papperskorgen`] }, { status: 404 })
      return Response.json({ restored: id })
    } catch (e) {
      return fail(e)
    }
  })
