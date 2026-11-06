import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { sheetPdf } from '../export'
import { loadPlan } from '../service'
import { listPlans } from './store'
import { systemBackend } from './storage'
import { ownBackend, userBackend } from './docs'
import { listSites } from '../../site/store'
import { runAs, type User } from '../auth/user'

// A backup of a person's plans as a zip, built while it is sent (no size limit from the buffered
// response, and the download starts at once).
//
//   planer/<id>/…            their own plans: every revision (rev-0001.json …), head.json, shares.json,
//                            assets/ (the drawings they are traced from); a plan in the trash is in here too,
//                            marked by trashedAt in its shares.json
//   planer/<id>/pdf/…        the latest revision as a PDF (before and after), if there was time
//   delade-med-mig/<ägare>/<id>/…   plans others share with them (same layout)
//   tomter/…                 their site plans
//   LAS-MIG.txt              what is what, and how to put it back (scripts/restore-backup.ts)
//
// With all (an administrator): everything under u/ in the store, as alla/u/<person>/…, without PDFs.

const PDF_BUDGET_MS = 30_000
const BATCH = 8

type Item = { path: string; read: () => Promise<Buffer | null> }

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'plan'

const stored = (path: string) => /\.(png|jpe?g|pdf|zip)$/i.test(path)

async function ownItems(): Promise<{ items: Item[]; pdfs: Array<{ id: string; owner?: string; name: string }> }> {
  const own = ownBackend()
  const mine = userBackend()
  const items: Item[] = []
  for (const k of await own.keys('plans')) items.push({ path: `planer/${k.slice('plans/'.length)}`, read: () => own.read(k) })
  for (const k of await own.keys('sites')) items.push({ path: `tomter/${k.slice('sites/'.length)}`, read: () => own.read(k) })
  const plans = await listPlans()
  for (const p of plans.filter((x) => x.owner)) {
    for (const k of await mine.keys(`plans/${p.id}`)) items.push({ path: `delade-med-mig/${p.owner}/${k.slice('plans/'.length)}`, read: () => mine.read(k) })
  }
  for (const s of (await listSites()).filter((x) => x.owner)) {
    for (const k of await mine.keys(`sites/${s.id}`)) items.push({ path: `delade-med-mig/${s.owner}/tomter/${k.slice('sites/'.length)}`, read: () => mine.read(k) })
  }
  return { items, pdfs: plans.map((p) => ({ id: p.id, owner: p.owner, name: p.name })) }
}

async function allItems(): Promise<Item[]> {
  const sys = systemBackend()
  return (await sys.keys('u')).map((k) => ({ path: `alla/${k}`, read: () => sys.read(k) }))
}

const readme = (all: boolean, who: string, failed: string[], skipped: string[]) =>
  [
    `Backup av planritningar – ${new Date().toISOString().slice(0, 10)} – ${all ? 'alla personer' : who}`,
    '',
    all
      ? 'alla/u/<person>/…   allt som ligger under u/ i lagringen: planer, tomter och delningar för varje person.'
      : [
          'planer/<id>/rev-0001.json …   varje version av planen (högst nummer är senaste). head.json pekar ut den.',
          'planer/<id>/assets/           ritningarna som planen är avritad från.',
          'planer/<id>/shares.json       vem planen delas med; trashedAt = den ligger i papperskorgen.',
          'planer/<id>/pdf/              senaste versionen som PDF (före och efter), om det fanns tid.',
          'delade-med-mig/<ägare>/…      planer som andra delar med dig, samma uppbyggnad.',
          'tomter/                       dina tomtplaner.',
        ].join('\n'),
    '',
    'Så läggs en backup tillbaka (på en dator med lagringens nyckel i miljön, se docs/deploy.md):',
    '  npm run restore:backup -- <fil.zip> --to <användare> [--overwrite]',
    'Planer som redan finns hoppas över om du inte anger --overwrite. Delningar och papperskorgsmarkeringar återskapas inte.',
    ...(failed.length ? ['', 'Dessa filer gick inte att läsa och saknas:', ...failed.map((f) => `  ${f}`)] : []),
    ...(skipped.length ? ['', `PDF saknas för (tiden tog slut, ladda ner igen eller exportera i editorn): ${skipped.join(', ')}`] : []),
    '',
  ].join('\n')

export function backupStream(user: User, all: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err)
        controller.enqueue(chunk)
        if (final) controller.close()
      })
      const add = (path: string, data: Uint8Array) => {
        const f = stored(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 })
        zip.add(f)
        f.push(data, true)
      }
      const job = runAs(user, async () => {
        const failed: string[] = []
        const skipped: string[] = []
        const t0 = Date.now()
        const { items, pdfs } = all ? { items: await allItems(), pdfs: [] } : await ownItems()
        for (let i = 0; i < items.length; i += BATCH) {
          const batch = items.slice(i, i + BATCH)
          const got = await Promise.all(batch.map((it) => it.read().catch(() => null)))
          batch.forEach((it, j) => (got[j] ? add(it.path, got[j]!) : failed.push(it.path)))
        }
        // The PDFs last, so the data is complete before the time runs out.
        for (const p of pdfs) {
          if (Date.now() - t0 > PDF_BUDGET_MS) {
            skipped.push(p.name)
            continue
          }
          try {
            const rev = await loadPlan(p.id)
            if (!rev) continue
            const pdf = await sheetPdf(rev.plan, ['fore', 'efter'])
            const dir = p.owner ? `delade-med-mig/${p.owner}/${p.id}` : `planer/${p.id}`
            add(`${dir}/pdf/${slug(p.name)}-rev${rev.meta.n}.pdf`, pdf)
          } catch {
            skipped.push(p.name)
          }
        }
        add('LAS-MIG.txt', Buffer.from(readme(all, user.id, failed, skipped), 'utf8'))
        zip.end()
      })
      job.catch((e) => controller.error(e))
    },
  })
}
