'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Item = { id: string; name: string; revision: number; updatedAt: string; issued: string[] }

export function PlanList() {
  const router = useRouter()
  const [plans, setPlans] = useState<Item[] | null>(null)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'empty' | 'demo'>('empty')
  const [error, setError] = useState('')

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

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Planritningar</h1>
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
      <ul className="mt-6 divide-y rounded border bg-white" data-testid="plan-list">
        {plans === null && <li className="p-4 text-sm text-zinc-500">Läser in…</li>}
        {plans?.length === 0 && <li className="p-4 text-sm text-zinc-500">Inga planer ännu.</li>}
        {plans?.map((p) => (
          <li key={p.id}>
            <a href={`/plans/${p.id}`} className="flex items-center justify-between p-4 hover:bg-zinc-50">
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                rev {p.revision}
                {p.issued.length ? ` · utfärdad ${p.issued[p.issued.length - 1]}` : ''} · {new Date(p.updatedAt).toLocaleDateString('sv-SE')}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
