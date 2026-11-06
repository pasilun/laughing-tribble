import { secured } from '@/lib/plan/access'
import { listTrash, TRASH_DAYS } from '@/lib/plan/store'
import { fail } from '../http'

export const runtime = 'nodejs'

// The person's trash: plans they deleted, kept for TRASH_DAYS days. { plans: [{ id, name, deletedAt, daysLeft }], days }.
export const GET = secured(async (): Promise<Response> => {
  try {
    return Response.json({ plans: await listTrash(), days: TRASH_DAYS })
  } catch (e) {
    return fail(e)
  }
})
