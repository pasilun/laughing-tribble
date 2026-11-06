'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// One button: pick the drawing, it is uploaded and becomes a source of the plan.
// Claude calibrates it afterwards from the dimensions printed on it, so no scale or
// resolution is asked for. Vercel takes at most 4.5 MB per request, so a bigger file
// (a PDF, TIF, PNG or JPG, as it is) is sent in pieces and put together on the server.
const PART = 4_000_000
const MAX_PARTS = 8

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'ritning'

async function errorOf(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return (j.errors ?? ['Uppladdningen misslyckades']).join('\n')
  } catch {
    return res.status === 413 ? 'Filen är för stor.' : 'Uppladdningen misslyckades'
  }
}

export function UploadForm({ planId }: { planId: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sourceId?: string } | null>(null)
  const [planName, setPlanName] = useState('')

  // Which plan this is for, so the page is not a blank form.
  useEffect(() => {
    fetch(`/api/plans/${planId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setPlanName(b?.plan?.name ?? ''))
      .catch(() => undefined)
  }, [planId])

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const q = new URLSearchParams({ role: 'archive', scale: '100' })
      const label = file.name.replace(/\.[a-z]+$/i, '')
      const id = `${slug(label)}-${Math.random().toString(36).slice(2, 6)}`
      q.set('id', id)
      q.set('filename', file.name)
      q.set('name', label)
      let body: Blob | undefined = file
      if (file.size > PART) {
        const parts = Math.ceil(file.size / PART)
        if (parts > MAX_PARTS) throw new Error('Filen är större än ca 30 MB. Välj en mindre fil.')
        const upload = Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, 'x').padEnd(8, 'x')
        for (let i = 0; i < parts; i++) {
          setMsg({ ok: true, text: `Laddar upp del ${i + 1} av ${parts}…` })
          const r = await fetch(`/api/plans/${planId}/sources/parts?upload=${upload}&part=${i}`, { method: 'POST', body: file.slice(i * PART, (i + 1) * PART) })
          if (!r.ok) throw new Error(await errorOf(r))
        }
        q.set('upload', upload)
        q.set('parts', String(parts))
        body = undefined
        setMsg({ ok: true, text: 'Läser in ritningen…' })
      }
      const res = await fetch(`/api/plans/${planId}/sources?${q}`, { method: 'POST', body })
      if (!res.ok) throw new Error(await errorOf(res))
      const j = await res.json()
      setMsg({ ok: true, text: `Klart. ”${label}” är nu en av planens ritningar.`, sourceId: j.source.id })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Link href={`/plans/${planId}`} className="text-sm text-blue-700 underline" data-testid="upload-back">
        ← {planName || 'Till planen'}
      </Link>
      <h1 className="mt-3 text-xl font-bold">Ladda upp ritning</h1>
      {planName && <p className="mt-1 text-sm text-gray-600">Läggs till i planen ”{planName}”. Du kan ladda upp flera.</p>}
      <label className={`mt-6 flex cursor-pointer items-center justify-center rounded bg-blue-600 px-4 py-4 text-lg text-white ${busy ? 'opacity-50' : ''}`}>
        {busy ? 'Laddar upp…' : 'Välj ritning'}
        <input data-testid="upload-file" type="file" accept=".png,.jpg,.jpeg,.tif,.tiff,.pdf,image/*,application/pdf" disabled={busy} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <p className="mt-2 text-sm text-gray-600">PNG, JPG, TIF eller PDF.</p>
      {msg && (
        <p data-testid="upload-result" className={`mt-4 whitespace-pre-wrap text-base ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
      {msg?.ok && msg.sourceId && (
        <div className="mt-3 space-y-2 text-sm text-gray-700">
          <Link href={`/plans/${planId}`} className="inline-block rounded border px-3 py-1.5 text-blue-700" data-testid="upload-open-plan">
            Öppna planen
          </Link>
          <p>
            Använder du Claude? Skriv i chatten: ”Ritningen är uppladdad som källa <span className="font-mono">{msg.sourceId}</span>”.
          </p>
        </div>
      )}
    </main>
  )
}
