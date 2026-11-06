import { SiteEditor } from '@/components/site-editor/SiteEditor'
import { requireAccess } from '../../guard'

export const metadata = { title: 'Tomt' }
// Signed-in pages are rendered per request, never prerendered at build time (when no one is signed in).
export const dynamic = 'force-dynamic'

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await requireAccess(`/plans/site/${slug}`)
  return <SiteEditor slug={slug} />
}
