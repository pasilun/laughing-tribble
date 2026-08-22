import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildingFromParams, type BuildingParams } from '../lib/building-factory'
import { validateBuilding } from '../lib/validate-building'

const [, , id, description, paramsFile] = process.argv

if (!id || !description || !paramsFile) {
  console.error('Usage: npm run new-case -- <case-id> "<sv description>" <params.json>')
  process.exit(1)
}

if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
  console.error(`Invalid case id: ${id} (use a-z, 0-9, - and _)`)
  process.exit(1)
}

const params = JSON.parse(readFileSync(resolve(paramsFile), 'utf8')) as BuildingParams
const model = buildingFromParams(params)
model.flowType = params.flowType

const warnings = validateBuilding(model)
if (warnings.length > 0) {
  console.warn('⚠ Valideringsvarningar:')
  for (const w of warnings) console.warn(`  - ${w}`)
}

const outPath = resolve('fixtures', 'cases', `${id}.json`)
writeFileSync(outPath, JSON.stringify({ id, description, model }, null, 2))
console.log(`✓ Wrote ${outPath}`)
console.log(`  View:  http://localhost:3000/review/${id}`)
