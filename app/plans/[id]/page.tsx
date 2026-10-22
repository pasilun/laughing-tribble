import { Editor } from '@/components/plan-editor/Editor'

export const metadata = { title: 'Planritning' }

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <Editor id={id} />
}
