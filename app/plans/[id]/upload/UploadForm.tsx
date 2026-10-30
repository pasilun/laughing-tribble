'use client'

import { useState } from 'react'

// One button: pick the drawing, it is uploaded and becomes a source of the plan.
// Claude calibrates it afterwards from the dimensions printed on it, so no scale or
// resolution is asked for. Vercel takes at most 4.5 MB per request, so a bigger
// PNG/JPG is re-encoded smaller here and its dpi lowered to match.
const LIMIT = 4_300_000

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'ritning'

async function shrink(file: File): Promise<{ blob: Blob; dpi: number; filename: string }> {
  const bmp = await createImageBitmap(file)
  let f = Math.min(1, Math.sqrt(LIMIT / file.size) * 1.1)
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * f)
    c.height = Math.round(bmp.height * f)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
    if (blob && blob.size <= LIMIT) return { blob, dpi: 300 * f, filename: file.name.replace(/\.[a-z]+$/i, '') + '.jpg' }
    f *= 0.8
  }
  throw new Error('Bilden går inte att förminska tillräckligt – välj en mindre fil.')
}

export function UploadForm({ planId }: { planId: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      let body: Blob = file
      let filename = file.name
      const q = new URLSearchParams({ role: 'archive', scale: '100' })
      if (file.size > LIMIT) {
        if (!/\.(png|jpe?g)$/i.test(file.name)) throw new Error('Filen är större än 4,3 MB. TIF och PDF kan inte förminskas här – spara den som PNG eller JPG först.')
        const s = await shrink(file)
        body = s.blob
        filename = s.filename
        q.set('dpi', String(s.dpi))
      }
      const label = file.name.replace(/\.[a-z]+$/i, '')
      const id = `${slug(label)}-${Math.random().toString(36).slice(2, 6)}`
      q.set('id', id)
      q.set('filename', filename)
      q.set('name', label)
      const res = await fetch(`/api/plans/${planId}/sources?${q}`, { method: 'POST', body })
      const j = await res.json()
      if (!res.ok) throw new Error((j.errors ?? ['Uppladdningen misslyckades']).join('\n'))
      setMsg({ ok: true, text: `Klart. Gå tillbaka till chatten och skriv: "Ritningen är uppladdad som källa ${j.source.id}".` })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">Ladda upp ritning</h1>
      <label className={`mt-6 flex cursor-pointer items-center justify-center rounded bg-blue-600 px-4 py-4 text-lg text-white ${busy ? 'opacity-50' : ''}`}>
        {busy ? 'Laddar upp…' : 'Välj bild'}
        <input data-testid="upload-file" type="file" accept=".png,.jpg,.jpeg,.tif,.tiff,.pdf,image/*,application/pdf" disabled={busy} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <p className="mt-2 text-sm text-gray-600">PNG, JPG, TIF eller PDF.</p>
      {msg && (
        <p data-testid="upload-result" className={`mt-4 whitespace-pre-wrap text-base ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
    </main>
  )
}
