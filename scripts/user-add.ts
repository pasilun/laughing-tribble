// Makes an access key for a new person. Prints the key (give it to them, it is
// not stored anywhere) and the line to add to PLAN_USERS in Vercel.
//   npx tsx scripts/user-add.ts <id> [https://din-adress.vercel.app]
import { randomBytes } from 'crypto'
import { hashKey } from '../lib/plan/access'
import { USER_ID } from '../lib/plan/user'

const [id, host = 'https://<adress>'] = process.argv.slice(2)
if (!id || !USER_ID.test(id)) {
  console.error('Användning: npx tsx scripts/user-add.ts <id> [adress]\n  id: små bokstäver, siffror och bindestreck, högst 30 tecken')
  process.exit(1)
}
const key = `pk_${randomBytes(32).toString('base64url')}`
console.log(`Person:        ${id}
Nyckel:        ${key}      (ges till personen; sparas ingenstans)
Lägg till i PLAN_USERS (kommaseparerat, i Vercel → Settings → Environment Variables):
  ${id}:${hashKey(key)}

Personens inloggning:   ${host}/plans   (klistra in nyckeln)
Claude-koppling (lägg till som anpassad connector):
  ${host}/api/mcp?key=${key}

Ändra PLAN_USERS och deploya om för att lägga till eller ta bort någon.`)
