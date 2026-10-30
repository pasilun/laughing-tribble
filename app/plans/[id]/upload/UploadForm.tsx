'use client'

import { useState } from 'react'

// A drawing from your own device becomes a source of the plan; Claude then
// calibrates and traces it with the scan tools. Vercel takes at most 4.5 MB per
// request, so a bigger PNG/JPG is re-encoded smaller here and its dpi lowered to match.
const LIMIT = 4_300_000

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'ritning'

async function shrink(file: File, dpi: number): Promise<{ blob: Blob; dpi: number; filename: string }> {
  const bmp = await createImageBitmap(file)
  let f = Math.min(1, Math.sqrt(LIMIT / file.size) * 1.1)
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * f)
    c.height = Math.round(bmp.height * f)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
    if (blob && blob.size <= LIMIT) return { blob, dpi: dpi * f, filename: file.name.replace(/\.[a-z]+$/i, '') + '.jpg' }
    f *= 0.8
  }
  throw new Error('Bilden går inte att förminska tillräckligt – ladda upp en mindre fil.')
}

export function UploadForm({ planId }: { planId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('archive')
  const [scale, setScale] = useState('100')
  const [dpi, setDpi] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      let body: Blob = file
      let filename = file.name
      let useDpi = dpi ? Number(dpi) : undefined
      let note = ''
      if (file.size > LIMIT) {
        if (!/\.(png|jpe?g)$/i.test(file.name)) throw new Error('Filen är större än 4,3 MB. TIF och PDF kan inte förminskas här – spara den som PNG eller JPG först.')
        const s = await shrink(file, useDpi ?? 300)
        body = s.blob
        filename = s.filename
        useDpi = s.dpi
        note = ' (förminskad för uppladdning, skalan är justerad)'
      }
      const label = name || file.name.replace(/\.[a-z]+$/i, '')
      const id = `${slug(label)}-${Math.random().toString(36).slice(2, 6)}`
      const q = new URLSearchParams({ id, filename, name: label, role, scale })
      if (useDpi) q.set('dpi', String(useDpi))
      if (year) q.set('year', year)
      const res = await fetch(`/api/plans/${planId}/sources?${q}`, { method: 'POST', body })
      const j = await res.json()
      if (!res.ok) throw new Error((j.errors ?? ['Uppladdningen misslyckades']).join('\n'))
      setMsg({
        ok: true,
        text: `Klart${note}: källa "${j.source.id}" är sparad (${j.source.widthPx}×${j.source.heightPx} px). Säg till Claude: "Ritningen är uppladdad som källa ${j.source.id}, kalibrera och rita av den."${j.note ? `\n${j.note}` : ''}`,
      })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const field = 'mt-1 w-full rounded border px-2 py-1.5'
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-xl font-bold">Ladda upp ritning</h1>
      <p className="mt-1 text-sm text-gray-600">Plan: {planId}. PNG, JPG, TIF eller PDF. Ritningen läggs in som källa som Claude sedan kalibrerar och ritar av.</p>
      <form onSubmit={send} className="mt-6 space-y-3">
        <label className="block text-sm">
          Fil
          <input data-testid="upload-file" type="file" accept=".png,.jpg,.jpeg,.tif,.tiff,.pdf,image/*,application/pdf" required className={field} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="block text-sm">
          Namn
          <input data-testid="upload-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="t.ex. Källare 1:100" className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Typ
            <select data-testid="upload-role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
              <option value="archive">Stadens arkivritning</option>
              <option value="before">Före</option>
              <option value="after">Efter</option>
              <option value="other">Annat</option>
            </select>
          </label>
          <label className="block text-sm">
            Skala 1:
            <input data-testid="upload-scale" type="number" min="1" value={scale} onChange={(e) => setScale(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            Upplösning (dpi)
            <input data-testid="upload-dpi" type="number" min="1" value={dpi} onChange={(e) => setDpi(e.target.value)} placeholder="om filen saknar" className={field} />
          </label>
          <label className="block text-sm">
            Ritningens år
            <input data-testid="upload-year" type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="valfritt" className={field} />
          </label>
        </div>
        <button data-testid="upload-submit" disabled={busy || !file} className="w-full rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-50">
          {busy ? 'Laddar upp…' : 'Ladda upp'}
        </button>
        {msg && (
          <p data-testid="upload-result" className={`whitespace-pre-wrap text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
            {msg.text}
          </p>
        )}
      </form>
    </main>
  )
}
