import { requireAccess } from '../../guard'
import { UploadForm } from './UploadForm'

export const metadata = { title: 'Ladda upp ritning' }

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireAccess(`/plans/${id}/upload`)
  return <UploadForm planId={id} />
}
