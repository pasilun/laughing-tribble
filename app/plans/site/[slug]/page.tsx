import { SiteEditor } from '@/components/site-editor/SiteEditor'
import { requireAccess } from '../../guard'

export const metadata = { title: 'Tomt' }

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await requireAccess(`/plans/site/${slug}`)
  return <SiteEditor slug={slug} />
}
