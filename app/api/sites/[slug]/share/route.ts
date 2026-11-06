import { SITES } from '@/lib/plan/docs'
import { shareRoutes } from '../../../plans/doc-routes'

export const runtime = 'nodejs'

export const { GET, POST, DELETE } = shareRoutes(SITES)
