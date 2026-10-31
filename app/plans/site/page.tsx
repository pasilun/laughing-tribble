import { SiteList } from '@/components/site-editor/SiteList'
import { requireAccess } from '../guard'

export const metadata = { title: 'Tomter' }

export default async function SitesPage() {
  await requireAccess('/plans/site')
  return <SiteList />
}
