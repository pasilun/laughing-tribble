'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Item = { id: string; name: string; revision: number; updatedAt: string; issued: string[] }

const PAGE_SIZE = 10

export function PlanList() {
  const router = useRouter()
  const [plans, setPlans] = useState<Item[] | null>(null)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'empty' | 'demo'>('empty')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/plans')
      .then((r) => r.json())
      .then((b) => setPlans(b.plans ?? []))
      .catch(() => setPlans([]))
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const r = await fetch('/api/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, template }) })
    const b = await r.json()
    if (!r.ok) return setError(b.errors?.[0] ?? 'kunde inte skapa planen')
    router.push(`/plans/${b.plan.id}`)
  }

  const remove = async (id: string) => {
    setError('')
    const r = await fetch(`/api/plans/${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      setConfirming(null)
      return setError(b.errors?.[0] ?? 'kunde inte radera planen')
    }
    setPlans((cur) => cur?.filter((p) => p.id !== id) ?? cur)
    setConfirming(null)
  }

  const q = query.trim().toLowerCase()
  const shown = plans?.filter((p) => !q || p.name.toLowerCase().includes(q)) ?? []
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const btn = 'rounded border px-3 py-1 text-sm disabled:opacity-40'

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Planritningar</h1>
      <p className="mt-1 text-sm">
        <Link href="/plans/site" data-testid="to-sites" className="text-blue-700 underline">
          Tomter (situationsplan, flygbild) →
        </Link>
      </p>
      <p className="mt-1 text-sm text-zinc-600">Planritning före och efter för anmälan om ändring inomhus – i skala, med versioner.</p>
      <form onSubmit={create} className="mt-6 flex flex-col gap-2 rounded border bg-white p-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          Namn
          <input data-testid="new-plan-name" required className="mt-1 w-full rounded border px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Väggöppning lgh 153–154" />
        </label>
        <label className="text-sm">
          Starta från
          <select data-testid="new-plan-template" className="mt-1 block w-full rounded border px-2 py-1.5" value={template} onChange={(e) => setTemplate(e.target.value as 'empty' | 'demo')}>
            <option value="empty">Tom plan</option>
            <option value="demo">Exempel</option>
          </select>
        </label>
        <button data-testid="create-plan" className="rounded bg-blue-600 px-4 py-1.5 text-white">
          Skapa
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex items-center gap-3">
        <input
          data-testid="plan-filter"
          type="search"
          aria-label="Sök bland planerna"
          placeholder="Sök på namn, t.ex. Gnejsen"
          className="w-full rounded border bg-white px-2 py-1.5 text-sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
        />
        {plans && (
          <span className="shrink-0 text-xs text-zinc-600" data-testid="plan-count">
            {q ? `${shown.length} av ${plans.length}` : plans.length} planer
          </span>
        )}
      </div>
      <ul className="mt-3 divide-y rounded border bg-white" data-testid="plan-list">
        {plans === null && <li className="p-4 text-sm text-zinc-500">Läser in…</li>}
        {plans?.length === 0 && <li className="p-4 text-sm text-zinc-500">Inga planer ännu.</li>}
        {plans && plans.length > 0 && shown.length === 0 && <li className="p-4 text-sm text-zinc-500">Ingen plan matchar ”{query}”.</li>}
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-2 pr-3" data-testid="plan-row">
            <a href={`/plans/${p.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 p-4 hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                rev {p.revision}
                {p.issued.length ? ` · utfärdad ${p.issued[p.issued.length - 1]}` : ''} · {new Date(p.updatedAt).toLocaleDateString('sv-SE')}
              </span>
            </a>
            {confirming === p.id ? (
              <span className="flex shrink-0 items-center gap-1" data-testid="confirm-delete">
                <button type="button" data-testid="delete-yes" className="rounded bg-red-700 px-2 py-1 text-xs text-white" onClick={() => remove(p.id)}>
                  Radera för alltid
                </button>
                <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setConfirming(null)}>
                  Avbryt
                </button>
              </span>
            ) : (
              <button type="button" data-testid="delete-plan" aria-label={`Radera ${p.name}`} className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => setConfirming(p.id)}>
                Radera
              </button>
            )}
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-between" aria-label="Sidor" data-testid="plan-pages">
          <button type="button" data-testid="page-prev" className={btn} disabled={current === 0} onClick={() => setPage(current - 1)}>
            ← Föregående
          </button>
          <span className="text-sm text-zinc-600" data-testid="page-info">
            Sida {current + 1} av {pages}
          </span>
          <button type="button" data-testid="page-next" className={btn} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Nästa →
          </button>
        </nav>
      )}
    </main>
  )
}
