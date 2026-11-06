import { SITES } from '@/lib/plan/storage/docs'
import { restoreRoute } from '../../../plans/doc-routes'

export const runtime = 'nodejs'

// Takes a site out of the trash.
export const POST = restoreRoute(SITES)
