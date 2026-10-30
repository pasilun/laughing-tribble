// Moves today's shared plans (plans/…) into one person's own storage (u/<id>/plans/…).
// Copies first; the old files are removed only with --delete-legacy, after the
// copies have been read back and compared. Run against the real store with its
// blob token in the environment (BLOB_READ_WRITE_TOKEN), or against .data locally.
//   npx tsx scripts/migrate-to-users.ts --to <id> [--delete-legacy] [--dry-run]
import { systemBackend } from '../lib/plan/store'
import { USER_ID } from '../lib/plan/user'

async function main() {
  const args = process.argv.slice(2)
  const to = args[args.indexOf('--to') + 1]
  if (args.indexOf('--to') < 0 || !to || !USER_ID.test(to)) {
    console.error('Användning: npx tsx scripts/migrate-to-users.ts --to <id> [--delete-legacy] [--dry-run]')
    process.exit(1)
  }
  const dry = args.includes('--dry-run')
  const b = systemBackend()
  const keys = (await b.keys('plans')).filter((k) => k.startsWith('plans/'))
  console.log(`${keys.length} filer under plans/ → u/${to}/plans/`)
  let copied = 0
  const verified: string[] = []
  for (const k of keys) {
    const data = await b.read(k)
    if (!data) continue
    const dest = `u/${to}/${k}`
    if (!dry) {
      await b.write(dest, data, k.endsWith('.json') ? 'application/json' : k.endsWith('.png') ? 'image/png' : 'application/octet-stream')
      const back = await b.read(dest)
      if (!back || !back.equals(data)) throw new Error(`kopian av ${k} stämmer inte`)
    }
    verified.push(k)
    copied++
  }
  console.log(`${dry ? 'skulle kopiera' : 'kopierade och kontrollerade'} ${copied} filer`)
  if (args.includes('--delete-legacy') && !dry) {
    await b.remove(verified)
    console.log(`tog bort ${verified.length} gamla filer`)
  } else if (!dry) console.log('de gamla filerna ligger kvar; kör om med --delete-legacy när allt fungerar')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
