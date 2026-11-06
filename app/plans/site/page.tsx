import { SiteList } from '@/components/site-editor/SiteList'
import { requireAccess } from '../guard'

export const metadata = { title: 'Tomter' }
// Signed-in pages are rendered per request, never prerendered at build time (when no one is signed in).
export const dynamic = 'force-dynamic'

export default async function SitesPage() {
  await requireAccess('/plans/site')
  return <SiteList />
}
