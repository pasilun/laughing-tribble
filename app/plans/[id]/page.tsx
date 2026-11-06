import { Editor } from '@/components/plan-editor/Editor'
import { requireAccess } from '../guard'

export const metadata = { title: 'Planritning' }
// Signed-in pages are rendered per request, never prerendered at build time (when no one is signed in).
export const dynamic = 'force-dynamic'

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAccess(`/plans/${id}`)
  return <Editor id={id} />
}
