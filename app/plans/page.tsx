import { PlanList } from '@/components/plan-editor/PlanList'
import { requireAccess } from './guard'

export const metadata = { title: 'Planritningar' }

export default async function PlansPage() {
  await requireAccess('/plans')
  return <PlanList />
}
