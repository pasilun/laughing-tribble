import { readFile } from 'fs/promises'
import { join, resolve } from 'path'

export const runtime = 'nodejs'

const CASES_DIR = resolve(process.cwd(), 'fixtures', 'cases')

function validName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(name) && !name.includes('..')
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  if (!validName(name)) {
    return Response.json({ error: 'Invalid case id' }, { status: 400 })
  }

  try {
    const raw = await readFile(join(CASES_DIR, `${name}.json`), 'utf8')
    return new Response(raw, {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return Response.json({ error: `Case not found: ${name}` }, { status: 404 })
  }
}
