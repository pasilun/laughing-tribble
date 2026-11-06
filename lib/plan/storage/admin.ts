import { copyPages } from './migrate-store'
import { blobBackend, blobConfigured, storageKind, tursoBackend, tursoConfigured } from './storage'

// What the administrator can see and do about where the data lives.

export const storageStatus = () => ({ kind: storageKind(), blob: blobConfigured(), turso: tursoConfigured() })

// Copies the Blob store into Turso, a stretch at a time (call again with the cursor until done; safe to repeat).
// Only while the app still uses Blob.
export async function copyBlobToTurso(cursor?: string) {
  if (!blobConfigured() || !tursoConfigured()) return { errors: ['Både Blob och Turso måste vara inställda (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN).'], status: 400 }
  if (storageKind() !== 'blob') return { errors: ['Appen använder redan inte Blob.'], status: 400 }
  const target = tursoBackend()
  const res = await copyPages(blobBackend(), target, { cursor })
  return { ...res, inTurso: res.done ? await target.count() : undefined }
}
