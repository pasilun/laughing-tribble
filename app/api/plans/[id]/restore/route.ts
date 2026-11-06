import { PLANS } from '@/lib/plan/docs'
import { restoreRoute } from '../../doc-routes'

export const runtime = 'nodejs'

// Takes a plan out of the trash.
export const POST = restoreRoute(PLANS)
