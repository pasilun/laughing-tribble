import { isAdmin, secured } from '@/lib/plan/auth/access'
import { backupStream } from '@/lib/plan/storage/backup'
import { currentUser } from '@/lib/plan/auth/user'

export const runtime = 'nodejs'
export const maxDuration = 60

// A zip of the person's plans (every revision, the drawings, the latest as PDF), streamed as it is made.
// ?all=1: everyone's data, for an administrator (PLAN_ADMINS).
export const GET = secured(async (req: Request): Promise<Response> => {
  const me = currentUser()!
  const all = !!new URL(req.url).searchParams.get('all')
  if (all && !isAdmin(me)) return Response.json({ errors: ['Bara administratörer kan ladda ner allas data.'] }, { status: 403 })
  const date = new Date().toISOString().slice(0, 10)
  return new Response(backupStream(me, all), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="planer-backup-${date}${all ? '-alla' : ''}.zip"`,
      'cache-control': 'no-store',
    },
  })
})
