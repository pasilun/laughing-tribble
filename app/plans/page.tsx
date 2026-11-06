import { PlanList } from '@/components/plan-editor/PlanList'
import { requireAccess } from './guard'

export const metadata = { title: 'Planritningar' }
// Signed-in pages are rendered per request, never prerendered at build time (when no one is signed in).
export const dynamic = 'force-dynamic'

export default async function PlansPage() {
  await requireAccess('/plans')
  return <PlanList />
}
