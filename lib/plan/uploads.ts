import { loadPlan } from './service'
import { deleteAsset, getAsset, putAsset } from './storage/store'

// Getting a drawing into a plan: a picture stored beside it, or a source in pieces. The rules (which files, how
// big, how the pieces fit) are here; the routes only read the request and answer.

export type Failure = { errors: string[]; status: number }

// A drawing bigger than one request (4.5 MB on Vercel) is sent in pieces and put together on the server.
export const SINGLE_MAX = 4_400_000
const PART_MAX = 4_400_000
const PARTS_MAX = 8 // up to about 35 MB
const UPLOAD_ID = /^[a-z0-9]{6,24}$/
const partName = (upload: string, part: number) => `up-${upload}-${part}.part`

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
const IMAGE_MAX = 15 * 1024 * 1024

// A PNG or JPG kept beside the plan (a TIF or PDF is converted to PNG in the browser first).
export async function storeImage(planId: string, name: string, data: Buffer): Promise<Failure | { url: string }> {
  const type = IMAGE_TYPES[name.split('.').pop()?.toLowerCase() ?? '']
  if (!type) return { errors: ['endast png/jpg'], status: 400 }
  if (data.length === 0 || data.length > IMAGE_MAX) return { errors: ['filen är tom eller för stor (max 15 MB)'], status: 400 }
  return { url: await putAsset(planId, name, data, type) }
}

// One piece of a drawing too big for a single request.
export async function storePart(planId: string, upload: string, part: number, data: Buffer): Promise<Failure | { part: number; bytes: number }> {
  if (!UPLOAD_ID.test(upload) || !Number.isInteger(part) || part < 0 || part >= PARTS_MAX) return { errors: [`upload: gemener och siffror; part: 0–${PARTS_MAX - 1}`], status: 400 }
  if (data.length === 0) return { errors: ['biten är tom'], status: 400 }
  if (data.length > PART_MAX) return { errors: ['biten är för stor (max 4,4 MB)'], status: 413 }
  if (!(await loadPlan(planId))) return { errors: [`Planen ${planId} finns inte`], status: 404 }
  await putAsset(planId, partName(upload, part), data, 'application/octet-stream')
  return { part, bytes: data.length }
}

export function checkParts(upload: string, parts: number): Failure | null {
  if (!UPLOAD_ID.test(upload) || !Number.isInteger(parts) || parts < 1 || parts > PARTS_MAX) return { errors: [`upload: gemener och siffror; parts: 1–${PARTS_MAX}`], status: 400 }
  return null
}

// The pieces put together.
export async function joinParts(planId: string, upload: string, parts: number): Promise<Failure | Buffer> {
  const out: Buffer[] = []
  for (let i = 0; i < parts; i++) {
    const b = await getAsset(planId, partName(upload, i))
    if (!b) return { errors: [`bit ${i} saknas – ladda upp filen igen`], status: 400 }
    out.push(b)
  }
  return Buffer.concat(out)
}

export async function dropParts(planId: string, upload: string, parts: number): Promise<void> {
  for (let i = 0; i < parts; i++) await deleteAsset(planId, partName(upload, i)).catch(() => undefined)
}
