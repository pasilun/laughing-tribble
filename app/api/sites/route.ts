import { secured } from '@/lib/plan/access'
import type { SiteDoc } from '@/lib/site/doc'
import { slugOf } from '@/lib/site/doc'
import { createSite, importSite, knownDesignations } from '@/lib/site/service'
import { listSites } from '@/lib/site/store'
import { author, fail, readJson } from '../plans/http'

export const runtime = 'nodejs'
export const maxDuration = 60

export const GET = secured(async (): Promise<Response> => {
  try {
    const sites = await listSites()
    const have = new Set(sites.map((x) => x.slug))
    return Response.json({ sites, suggestions: knownDesignations().filter((d) => !have.has(slugOf(d))) })
  } catch (e) {
    return fail(e)
  }
})

// POST {designation: "Strängnäs Lövinge 3:2"} looks the property up in Lantmäteriet's Min karta and makes the site;
// POST {import: <site document>} stores a ready one.
export const POST = secured(async (req: Request): Promise<Response> => {
  const body = await readJson(req)
  if (!body) return Response.json({ errors: ['JSON krävs'] }, { status: 400 })
  try {
    const res = body.import ? await importSite(body.import as SiteDoc, author(body.author)) : typeof body.designation === 'string' && body.designation.trim() ? await createSite(body.designation.trim(), author(body.author)) : { errors: ['designation (fastighetsbeteckning) krävs'], status: 400 }
    if ('errors' in res) return Response.json({ errors: res.errors }, { status: res.status })
    return Response.json({ doc: res.stored.doc, revision: res.stored.meta }, { status: 201 })
  } catch (e) {
    return fail(e)
  }
})
