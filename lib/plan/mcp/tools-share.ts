import { currentUser } from '../auth/user'
import { deleteDoc, PLANS, restoreDoc, SITES, TRASH_DAYS, type DocKind, type Trashed } from '../storage/docs'
import { addShare, participants, removeShare } from '../storage/shares'
import { listPlansAndTrash } from '../storage/store'
import { listSitesAndTrash } from '../../site/store'
import { refuse, text, type Tool } from './tool'

// Plans and site plans are shared, deleted and restored by the same code (storage/docs.ts); these tools are the
// same for both, one set of words for the two kinds.

const upper = (s: string) => s[0].toUpperCase() + s.slice(1)

function shareTool(kind: DocKind, name: string, idArg: string, thing: string): Tool {
  return {
    name,
    description: `Shares ${thing} with another person (by user name) so that both can make new revisions of it, or shows who has it (no with/remove). remove: takes a person out (the owner anyone, others only themselves). Deleting a shared ${kind.one === 'plan' ? 'plan' : 'site'} only removes it for the one who deletes. The person must already have an account.`,
    inputSchema: { type: 'object', properties: { [idArg]: { type: 'string' }, with: { type: 'string', description: 'user name to share with' }, remove: { type: 'string', description: 'user name to take out' } }, required: [idArg] },
    run: async (args) => {
      const id = String(args[idArg] ?? '')
      try {
        const who = typeof args.with === 'string' ? args.with : ''
        const out = typeof args.remove === 'string' ? args.remove : ''
        const err = who ? await addShare(kind, id, who) : out ? await removeShare(kind, id, out) : null
        if (err) return refuse(err)
        if (out && out === currentUser()?.id) return { content: [text(`Du har tagit bort ${kind.noun} ${id} för dig. De andra har kvar den.`)] }
        const p = await participants(kind, id)
        if (!p) return refuse(`${upper(kind.noun)} ${id} finns inte`)
        const people = [p.ownerRemoved ? `${p.owner} (har tagit bort den för sig)` : `${p.owner} (ägare)`, ...p.members]
        return { content: [text(`${upper(kind.noun)} delas av: ${people.join(', ')}. Du är ${p.me}.`)] }
      } catch (e) {
        return refuse((e as Error).message)
      }
    },
  }
}

const KINDS: Record<string, { kind: DocKind; list: () => Promise<Trashed[]> }> = {
  plan: { kind: PLANS, list: async () => (await listPlansAndTrash({ shared: false })).trash },
  site: { kind: SITES, list: async () => (await listSitesAndTrash({ shared: false })).trash },
}

export const SHARE_TOOLS: Tool[] = [
  shareTool(PLANS, 'plan_share', 'plan_id', 'a plan'),
  shareTool(SITES, 'site_share', 'slug', 'a site (a property seen from above)'),
  {
    name: 'doc_trash',
    description: `The trash of plans and sites. action "list" shows what the person has deleted (kept ${TRASH_DAYS} days), "delete" moves one there (for the owner; someone it is shared with only leaves it, the others keep working on it), "restore" takes one back out. Nothing is erased for good from here; that is done in the app.`,
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['plan', 'site'] }, action: { type: 'string', enum: ['list', 'delete', 'restore'] }, id: { type: 'string', description: 'plan_id or slug (not for list)' } },
      required: ['kind', 'action'],
    },
    run: async (args) => {
      const k = KINDS[String(args.kind)]
      if (!k) return refuse('kind: plan eller site')
      const id = String(args.id ?? '')
      if (args.action === 'list') {
        const trash = await k.list()
        return { content: [text(trash.length ? trash.map((t) => `${t.id}: ${t.name} – ${t.daysLeft} dagar kvar${t.sharedWith?.length ? `, delas med ${t.sharedWith.join(', ')}` : ''}`).join('\n') : 'Papperskorgen är tom.')] }
      }
      if (!id) return refuse('id krävs')
      if (args.action === 'delete') {
        const how = await deleteDoc(k.kind, id)
        if (!how) return refuse(`${upper(k.kind.noun)} ${id} finns inte`)
        return { content: [text(how === 'trashed' ? `${upper(k.kind.noun)} ${id} ligger nu i papperskorgen och kan återställas i ${TRASH_DAYS} dagar.` : `Du har tagit bort ${k.kind.noun} ${id} för dig. De andra har kvar den.`)] }
      }
      if (args.action === 'restore') {
        return (await restoreDoc(k.kind, id)) ? { content: [text(`${upper(k.kind.noun)} ${id} är tillbaka i listan.`)] } : refuse(`${upper(k.kind.noun)} ${id} ligger inte i papperskorgen`)
      }
      return refuse('action: list, delete eller restore')
    },
  },
]
