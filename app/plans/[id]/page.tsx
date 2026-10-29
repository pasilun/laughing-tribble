import { Editor } from '@/components/plan-editor/Editor'
import { requireAccess } from '../guard'

export const metadata = { title: 'Planritning' }

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAccess(`/plans/${id}`)
  return <Editor id={id} />
}
