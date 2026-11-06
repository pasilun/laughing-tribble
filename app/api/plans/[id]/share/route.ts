import { PLANS } from '@/lib/plan/storage/docs'
import { shareRoutes } from '../../doc-routes'

export const runtime = 'nodejs'

export const { GET, POST, DELETE } = shareRoutes(PLANS)
