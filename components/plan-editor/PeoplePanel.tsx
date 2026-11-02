'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Person = { id: string; label?: string; createdAt: string }
type Invite = { id: string; label: string; createdAt: string; expiresAt: string }
type State = { me: string; people: Person[]; invites: Invite[] }

export function PeoplePanel() {
  const [state, setState] = useState<State | null>(null)
  const [denied, setDenied] = useState('')
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState(7)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  const apply = useCallback((res: { status: number; ok: boolean; body: { errors?: string[] } & Partial<State> }) => {
    if (res.status === 403) return setDenied(res.body.errors?.[0] ?? 'Ingen behörighet.')
    if (!res.ok) return setError(res.body.errors?.[0] ?? 'Kunde inte läsa listan.')
    setState(res.body as State)
  }, [])
  const fetchState = () => fetch('/api/plans/people').then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }))
  const load = () => fetchState().then(apply)

  useEffect(() => {
    fetchState().then(apply)
  }, [apply])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setCopied(false)
    const r = await fetch('/api/plans/people', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label, days }) })
    const b = await r.json().catch(() => ({}))
    if (!r.ok) return setError(b.errors?.[0] ?? 'Kunde inte skapa inbjudan.')
    setLink(b.link)
    setLabel('')
    load()
  }

  const remove = async (query: string, what: string) => {
    if (!window.confirm(what)) return
    const r = await fetch(`/api/plans/people?${query}`, { method: 'DELETE' })
    const b = await r.json().catch(() => ({}))
    if (!r.ok) return setError(b.errors?.[0] ?? 'Det gick inte.')
    setError('')
    load()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="text-sm">
        <Link href="/plans" className="text-blue-700 underline">
          ← Planritningar
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">Personer och inbjudningar</h1>
      {denied && (
        <p className="mt-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-zinc-900" data-testid="people-denied">
          {denied}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {state && (
        <>
          <form onSubmit={invite} className="mt-6 flex flex-col gap-2 rounded border bg-white p-4 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              Vem bjuder du in?
              <input data-testid="invite-label" required className="mt-1 w-full rounded border px-2 py-1.5" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="t.ex. Anna" maxLength={60} />
            </label>
            <label className="text-sm">
              Giltig
              <select className="mt-1 block w-full rounded border px-2 py-1.5" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1 dag</option>
                <option value={7}>7 dagar</option>
                <option value={30}>30 dagar</option>
              </select>
            </label>
            <button data-testid="invite-create" className="rounded bg-blue-600 px-4 py-1.5 text-white">
              Skapa länk
            </button>
          </form>
          {link && (
            <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm" data-testid="invite-link-box">
              <p className="font-medium text-zinc-900">Skicka den här länken till personen. Den visas bara nu och kan användas en gång.</p>
              <input data-testid="invite-link" readOnly className="mt-2 w-full rounded border bg-white px-2 py-1.5 font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="mt-2 rounded border bg-white px-3 py-1 text-xs" onClick={copy}>
                {copied ? 'Kopierad' : 'Kopiera'}
              </button>
            </div>
          )}

          <h2 className="mt-8 font-semibold">Väntande inbjudningar</h2>
          <ul className="mt-2 divide-y rounded border bg-white text-sm" data-testid="invite-list">
            {state.invites.length === 0 && <li className="p-3 text-zinc-600">Inga.</li>}
            {state.invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 p-3" data-testid="invite-row">
                <span className="min-w-0 truncate">
                  {i.label} <span className="text-xs text-zinc-600">· gäller till {new Date(i.expiresAt).toLocaleDateString('sv-SE')}</span>
                </span>
                <button type="button" className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => remove(`invite=${i.id}`, `Dra tillbaka inbjudan till ${i.label}?`)}>
                  Dra tillbaka
                </button>
              </li>
            ))}
          </ul>

          <h2 className="mt-8 font-semibold">Personer med inbjudan</h2>
          <ul className="mt-2 divide-y rounded border bg-white text-sm" data-testid="people-list">
            {state.people.length === 0 && <li className="p-3 text-zinc-600">Ingen har gått med via en inbjudan än.</li>}
            {state.people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 p-3" data-testid="person-row">
                <span className="min-w-0 truncate">
                  <strong>{p.id}</strong> <span className="text-xs text-zinc-600">· {p.label} · sedan {new Date(p.createdAt).toLocaleDateString('sv-SE')}</span>
                </span>
                <button type="button" data-testid="person-remove" className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => remove(`user=${p.id}`, `Ta bort ${p.id}? Personen loggas ut inom en halv minut. Planerna blir kvar i lagringen.`)}>
                  Ta bort
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-600">
            Du är inloggad som <strong>{state.me}</strong>. Personer som står i PLAN_USERS i Vercel visas inte här; de tas bort där.
          </p>
        </>
      )}
    </main>
  )
}
