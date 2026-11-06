import { takenByEnv } from './access'
import { personById } from './people'
import { accessFor, forgetAccess, isTrashed, noteShared, PublicError, type Access, pointerKey, readShares, scopedBackend, sharesKey, type Shares } from './store'
import { currentUser, scopeOf, USER_ID } from './user'

// Sharing a plan with another person. Both then make new revisions of the same plan
// (the revision check stops one from overwriting the other). Anyone in it may add a person;
// a person may leave, and the owner may remove a member. "Delete" in the plan list is leaving:
// see deletePlan in store.ts. The files this keeps are described there.

export type Participants = { id: string; me: string; owner: string; ownerRemoved: boolean; members: string[]; role: 'owner' | 'member' }

const user = () => {
  const u = currentUser()
  if (!u || u.legacy) throw new PublicError('delning kräver personliga nycklar (PLAN_USERS)')
  return u
}

export async function userExists(id: string): Promise<boolean> {
  return USER_ID.test(id) && (takenByEnv(id) || !!(await personById(id)))
}

// The person's access to a plan that exists: a plan id nobody made is "owned" by anyone until it is written.
async function accessTo(me: { id: string }, id: string): Promise<(Access & { role: 'owner' | 'member' }) | null> {
  const a = await accessFor(me, id)
  if (a.role === 'none') return null
  if (a.role === 'owner' && !(await scopedBackend(a.scope).read(`plans/${id}/head.json`))) return null
  return a as Access & { role: 'owner' | 'member' }
}

export async function participants(id: string): Promise<Participants | null> {
  const me = user()
  const a = await accessTo(me, id)
  if (!a) return null
  const sh = await readShares(a.scope, id)
  return { id, me: me.id, owner: a.owner, ownerRemoved: isTrashed(sh), members: sh?.members ?? [], role: a.role }
}

// Adds a person. Returns an error text, or null when done (also when they were already in it).
export async function addShare(id: string, wanted: string): Promise<string | null> {
  const me = user()
  const target = wanted.trim().toLowerCase()
  const a = await accessTo(me, id)
  if (!a) return 'planen finns inte'
  if (!(await userExists(target))) return `Det finns ingen person som heter ”${target}”.`
  if (target === me.id) return 'Du har redan planen.'
  const holder = scopedBackend(a.scope)
  const sh: Shares = (await readShares(a.scope, id)) ?? { members: [] }
  // The owner comes back to a plan they had deleted: the same as being shared with again.
  if (target === a.owner) {
    if (!isTrashed(sh)) return 'Personen har redan planen.'
    await holder.write(sharesKey(id), JSON.stringify({ members: sh.members }), 'application/json')
    forgetAccess()
    return null
  }
  if (sh.members.includes(target)) return null
  const theirs = scopedBackend(scopeOf({ id: target }))
  if ((await theirs.keys(`plans/${id}`)).length || (await theirs.read(pointerKey(id)))) return `${target} har redan en plan med samma id.`
  // The pointer first: a member listed without a pointer is invisible and harmless, the other way round is not.
  await theirs.write(pointerKey(id), JSON.stringify({ owner: a.owner, addedAt: new Date().toISOString(), addedBy: me.id }), 'application/json')
  await noteShared(scopeOf({ id: target }), id, true)
  await holder.write(sharesKey(id), JSON.stringify({ ...sh, members: [...sh.members, target] }), 'application/json')
  forgetAccess()
  return null
}

// Takes a member out (the owner may remove anyone, a member only themselves). Null when done.
export async function removeShare(id: string, who: string): Promise<string | null> {
  const me = user()
  const a = await accessTo(me, id)
  if (!a) return 'planen finns inte'
  if (who !== me.id && a.role !== 'owner') return 'Bara ägaren kan ta bort någon annan.'
  const sh = await readShares(a.scope, id)
  if (!sh?.members.includes(who)) return 'Personen har inte planen delad med sig.'
  await scopedBackend(scopeOf({ id: who })).remove([pointerKey(id)])
  await noteShared(scopeOf({ id: who }), id, false)
  const members = sh.members.filter((m) => m !== who)
  const holder = scopedBackend(a.scope)
  await holder.write(sharesKey(id), JSON.stringify({ ...sh, members }), 'application/json')
  forgetAccess()
  return null
}
