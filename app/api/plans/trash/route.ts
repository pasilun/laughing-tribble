import { secured } from '@/lib/plan/auth/access'
import { listTrash } from '@/lib/plan/storage/store'
import { TRASH_DAYS } from '@/lib/plan/storage/docs'
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
