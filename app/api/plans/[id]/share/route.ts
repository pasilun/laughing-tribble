import { PLANS } from '@/lib/plan/docs'
import { shareRoutes } from '../../doc-routes'

export const runtime = 'nodejs'

export const { GET, POST, DELETE } = shareRoutes(PLANS)
