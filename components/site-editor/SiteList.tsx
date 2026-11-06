'use client'

import { useEffect, useState } from 'react'
import { AppNav } from '@/components/AppNav'
import { DocShare } from '@/components/DocShare'
import { DocTrash, type TrashedDoc } from '@/components/DocTrash'
import { useRouter } from 'next/navigation'

type Item = { slug: string; designation: string; revision: number; updatedAt: string; owner?: string; sharedWith?: string[] }

export function SiteList() {
  const router = useRouter()
  const [sites, setSites] = useState<Item[] | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [designation, setDesignation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [trash, setTrash] = useState<TrashedDoc[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = () =>
    fetch('/api/sites')
      .then((r) => r.json())
      .then((b) => {
        setSites(b.sites ?? [])
        setTrash(Array.isArray(b.trash) ? b.trash : [])
        setSuggestions(b.suggestions ?? [])
      })
      .catch(() => setSites([]))

  useEffect(() => {
    void load()
  }, [])

  const remove = async (s: Item) => {
    setError('')
    const r = await fetch(`/api/sites/${s.slug}`, { method: 'DELETE' })
    const b = await r.json().catch(() => ({}))
    setConfirming(null)
    if (!r.ok) return setError(b.errors?.[0] ?? 'kunde inte radera tomten')
    setNotice(b.how === 'trashed' ? `”${s.designation}” ligger nu i papperskorgen och kan återställas i 30 dagar.` : `Du har tagit bort ”${s.designation}” för dig. De andra har kvar den.`)
    void load()
  }

  const create = async (e: React.FormEvent | null, name = designation) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await fetch('/api/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ designation: name }) })
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
      <AppNav current="tomter" />
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Tomter</h1>
      <p className="mt-1 text-sm text-zinc-600">Fastighetsgräns, byggnader och det du ritar in (äng, gräsmatta, idéer) på karta eller flygbild – i meter.</p>
      <form onSubmit={(e) => create(e)} className="mt-6 flex flex-col gap-2 rounded border bg-white p-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          Fastighetsbeteckning
          <input data-testid="new-site-designation" required className="mt-1 w-full rounded border px-2 py-1.5" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Strängnäs Lövinge 3:2" />
        </label>
        <button data-testid="create-site" disabled={busy} className="rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-60">
          {busy ? 'Hämtar från Lantmäteriet…' : 'Hämta tomten'}
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm" data-testid="site-suggestions">
          <p className="text-zinc-700">Tomter vi redan känner till – ett klick hämtar dem från Lantmäteriet:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((d) => (
              <button key={d} data-testid="suggested-site" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-60" onClick={() => create(null, d)}>
                {busy ? 'Hämtar…' : `Skapa ${d}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="mt-3 rounded border border-zinc-300 bg-zinc-50 p-2 text-sm text-zinc-800" role="status" data-testid="notice">
          {notice}
        </p>
      )}
      <ul className="mt-6 divide-y rounded border bg-white" data-testid="site-list">
        {sites === null && <li className="p-4 text-sm text-zinc-500">Läser in…</li>}
        {sites?.length === 0 && <li className="p-4 text-sm text-zinc-500">Inga tomter ännu.</li>}
        {sites?.map((s) => (
          <li key={s.slug} data-testid="site-row">
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <a href={`/plans/site/${s.slug}`} className="block min-w-0 truncate font-medium hover:underline">
                  {s.designation}
                </a>
                <p className="mt-0.5 text-xs text-zinc-500">
                  rev {s.revision}
                  {s.owner && (
                    <span data-testid="shared-by" className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-violet-800">
                      delad av {s.owner}
                    </span>
                  )}
                  {!s.owner && s.sharedWith && s.sharedWith.length > 0 && (
                    <span data-testid="shared-with" className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-violet-800">
                      delad med {s.sharedWith.join(', ')}
                    </span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <DocShare api="/api/sites" id={s.slug} noun="tomten" onShared={(people) => setSites((cur) => cur?.map((x) => (x.slug === s.slug ? { ...x, ...(x.owner ? {} : { sharedWith: people }) } : x)) ?? cur)} />
                </div>
              </div>
              <div className="shrink-0 text-xs">
                {confirming === s.slug ? (
                  <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center" data-testid="confirm-delete">
                    <button type="button" data-testid="delete-yes" className="rounded bg-red-700 px-2 py-1 text-white hover:bg-red-800" onClick={() => remove(s)}>
                      {s.owner ? 'Ta bort för mig' : 'Flytta till papperskorgen'}
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirming(null)}>
                      Avbryt
                    </button>
                  </span>
                ) : (
                  <button type="button" data-testid="delete-site" aria-label={`Radera ${s.designation}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirming(s.slug)}>
                    Radera
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <DocTrash api="/api/sites" items={trash} words={{ plural: 'tomter', one: 'tomten' }} onChanged={() => void load()} onError={setError} onNotice={setNotice} />
    </main>
  )
}
