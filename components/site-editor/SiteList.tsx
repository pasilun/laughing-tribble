'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Item = { slug: string; designation: string; revision: number; updatedAt: string }

export function SiteList() {
  const router = useRouter()
  const [sites, setSites] = useState<Item[] | null>(null)
  const [designation, setDesignation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((b) => setSites(b.sites ?? []))
      .catch(() => setSites([]))
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await fetch('/api/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ designation }) })
      const b = await r.json()
      if (!r.ok) return setError(b.errors?.[0] ?? 'kunde inte skapa tomten')
      router.push(`/plans/site/${b.doc.slug}`)
    } catch {
      setError('kunde inte nå servern')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <p className="text-sm">
        <Link href="/plans" className="text-blue-700 underline">
          ← Planritningar
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">Tomter</h1>
      <p className="mt-1 text-sm text-zinc-600">Fastighetsgräns, byggnader och det du ritar in (äng, gräsmatta, idéer) på karta eller flygbild – i meter.</p>
      <form onSubmit={create} className="mt-6 flex flex-col gap-2 rounded border bg-white p-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          Fastighetsbeteckning
          <input data-testid="new-site-designation" required className="mt-1 w-full rounded border px-2 py-1.5" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Strängnäs Lövinge 3:2" />
        </label>
        <button data-testid="create-site" disabled={busy} className="rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-60">
          {busy ? 'Hämtar från Lantmäteriet…' : 'Hämta tomten'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <ul className="mt-6 divide-y rounded border bg-white" data-testid="site-list">
        {sites === null && <li className="p-4 text-sm text-zinc-500">Läser in…</li>}
        {sites?.length === 0 && <li className="p-4 text-sm text-zinc-500">Inga tomter ännu.</li>}
        {sites?.map((s) => (
          <li key={s.slug}>
            <a href={`/plans/site/${s.slug}`} className="flex items-center justify-between p-4 hover:bg-zinc-50">
              <span className="min-w-0 truncate font-medium">{s.designation}</span>
              <span className="shrink-0 text-xs text-zinc-500">rev {s.revision}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
