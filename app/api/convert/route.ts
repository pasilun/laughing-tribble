export const runtime = 'nodejs'
export const maxDuration = 30

import { writeFile, readFile, unlink, chmod } from 'fs/promises'
import { join, resolve } from 'path'
import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'

const execFile = promisify(execFileCb)

// Resolve binary path relative to node_modules (not the bundle)
const BINARY = resolve(process.cwd(), 'node_modules/ifc-converter/bin/IfcConvert')

export async function POST(req: Request) {
  const ifcText = await req.text()
  const id = Date.now()
  const inputPath = join('/tmp', `ifc-${id}.ifc`)
  const outputPath = join('/tmp', `ifc-${id}.glb`)

  try {
    await writeFile(inputPath, ifcText, 'utf8')
    // Ensure binary is executable (survives npm install without chmod)
    await chmod(BINARY, 0o755).catch(() => {})
    await execFile(BINARY, [inputPath, outputPath], { maxBuffer: 10 * 1024 * 1024 })
    const glb = await readFile(outputPath)
    return new Response(glb, {
      headers: { 'Content-Type': 'model/gltf-binary' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(msg, { status: 500, headers: { 'Content-Type': 'text/plain' } })
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}
