import { PeoplePanel } from '@/components/plan-editor/PeoplePanel'
import { requireAccess } from '../guard'

export const metadata = { title: 'Personer' }
export const dynamic = 'force-dynamic'

export default async function PeoplePage() {
  await requireAccess('/plans/people')
  return <PeoplePanel />
}
