// Puts a backup zip (from "Ladda ner mina planer") back into the store.
//   npx tsx scripts/restore-backup.ts <fil.zip> --to <användare> [--overwrite] [--dry-run]
// Run against the real store with its blob token in the environment, or against .data locally.
// Plans that already exist for the person are skipped unless --overwrite. Sharing, the trash marker
// and the PDFs are not put back; a backup of everyone ("alla/…") is put back as it was.
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { systemBackend } from '../lib/plan/storage'
import { USER_ID } from '../lib/plan/user'

const type = (k: string) => (k.endsWith('.json') ? 'application/json' : k.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(k) ? 'image/jpeg' : 'application/octet-stream')

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => a.endsWith('.zip'))
  const ti = args.indexOf('--to')
  const to = ti >= 0 ? args[ti + 1] : ''
  const all = !!file && Object.keys(unzipSync(readFileSync(file))).some((k) => k.startsWith('alla/'))
  if (!file || (!all && !USER_ID.test(to ?? ''))) {
    console.error('Användning: npx tsx scripts/restore-backup.ts <fil.zip> --to <användare> [--overwrite] [--dry-run]')
    process.exit(1)
  }
  const overwrite = args.includes('--overwrite')
  const dry = args.includes('--dry-run')
  const files = unzipSync(readFileSync(file))
  const b = systemBackend()
  // Whether a plan (or site) is skipped is decided once, before its first file is written.
  const skipUnit = new Map<string, boolean>()
  let written = 0
  let skipped = 0
  for (const [path, data] of Object.entries(files)) {
    let dest: string | null = null
    if (all && path.startsWith('alla/')) dest = path.slice('alla/'.length)
    else if (!all && path.startsWith('planer/') && !path.includes('/pdf/') && !path.endsWith('/shares.json')) dest = `u/${to}/plans/${path.slice('planer/'.length)}`
    else if (!all && path.startsWith('tomter/')) dest = `u/${to}/sites/${path.slice('tomter/'.length)}`
    if (!dest) continue
    const unit = dest.split('/').slice(0, 4).join('/')
    if (!skipUnit.has(unit)) skipUnit.set(unit, !overwrite && (await b.keys(unit)).length > 0)
    if (skipUnit.get(unit)) {
      skipped++
      continue
    }
    if (!dry) await b.write(dest, Buffer.from(data), type(dest))
    written++
  }
  console.log(`${dry ? 'skulle skriva' : 'skrev'} ${written} filer, hoppade över ${skipped} (finns redan; använd --overwrite)`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
