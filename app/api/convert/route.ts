export const runtime = 'nodejs'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ifcConvert = require('ifc-converter') as (src: string, dest: string) => Promise<void>

import { writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'

export async function POST(req: Request) {
  const ifcText = await req.text()
  const id = Date.now()
  const inputPath = join('/tmp', `ifc-${id}.ifc`)
  const outputPath = join('/tmp', `ifc-${id}.glb`)

  try {
    await writeFile(inputPath, ifcText, 'utf8')
    await ifcConvert(inputPath, outputPath)
    const glb = await readFile(outputPath)
    return new Response(glb, {
      headers: { 'Content-Type': 'model/gltf-binary' },
    })
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}
