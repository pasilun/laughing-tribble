'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Item = { id: string; name: string; revision: number; updatedAt: string; issued: string[]; tags?: string[] }

const PAGE_SIZE = 10

const day = (iso: string) => {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

// A small picture of the latest revision. The address names the revision, so the browser keeps it.
function Thumb({ p }: { p: Item }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-zinc-50" aria-hidden="true">
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/plans/${p.id}/sheet?view=efter&format=png&width=400&rev=${p.revision}`}
          alt=""
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain"
          onError={() => setBroken(true)}
        />
      )}
    </span>
  )
}

export function PlanList() {
  const router = useRouter()
  const [plans, setPlans] = useState<Item[] | null>(null)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'empty' | 'demo'>('empty')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [admin, setAdmin] = useState(false)
  const [loadError, setLoadError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // A failed read is shown as a failure with a retry, never as "no plans yet".
  const load = () =>
    fetch('/api/plans')
      .then(async (r) => {
        const b = await r.json().catch(() => ({}))
        if (!r.ok || !Array.isArray(b.plans)) throw new Error(b.errors?.[0] ?? `Fel ${r.status}`)
        setLoadError('')
        setPlans(b.plans)
      })
      .catch((e: Error) => setLoadError(e.message || 'Kunde inte läsa planerna'))

  useEffect(() => {
    load()
    fetch('/api/plans/people')
      .then((r) => setAdmin(r.ok))
      .catch(() => setAdmin(false))
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

  const saveTags = async (id: string) => {
    setError('')
    const r = await fetch(`/api/plans/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags: draft.split(',') }) })
    const b = await r.json().catch(() => ({}))
    if (!r.ok) return setError(b.errors?.[0] ?? 'kunde inte spara taggarna')
    setPlans((cur) => cur?.map((p) => (p.id === id ? { ...p, tags: b.tags } : p)) ?? cur)
    setEditing(null)
  }

  const counts = new Map<string, number>()
  for (const p of plans ?? []) for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  const tagList = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'))
  const q = query.trim().toLowerCase()
  const shown = plans?.filter((p) => (!tag || p.tags?.includes(tag)) && (!q || p.name.toLowerCase().includes(q) || p.tags?.some((t) => t.toLowerCase().includes(q)))) ?? []
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const empty = plans?.length === 0 && !loadError
  const showCreate = creating || empty
  const filtered = !!(q || tag)
  const btn = 'rounded border bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40 disabled:hover:bg-white'
  const nav = 'rounded-full border px-3 py-1 text-sm hover:bg-zinc-50'

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8 sm:pt-12">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Planstudio</h1>
        <p className="mt-1 text-sm text-zinc-600">Planritningar för bygglov och anmälan – före och efter, i skala, med versioner.</p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Avsnitt">
          <span className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1 text-sm text-white" aria-current="page">
            Planer
          </span>
          <Link href="/plans/site" data-testid="to-sites" className={nav}>
            Tomter
          </Link>
          {admin && (
            <Link href="/plans/people" data-testid="to-people" className={nav}>
              Personer
            </Link>
          )}
        </nav>
      </header>

      <div className="mt-6 flex items-center gap-2">
        <input
          data-testid="plan-filter"
          type="search"
          aria-label="Sök bland planerna"
          placeholder="Sök på namn eller tagg"
          className="min-w-0 flex-1 rounded border bg-white px-3 py-2 text-sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
        />
        <button
          type="button"
          data-testid="new-plan"
          aria-expanded={showCreate}
          className="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => {
            setCreating((c) => !c)
            setTimeout(() => nameRef.current?.focus(), 0)
          }}
        >
          + Ny plan
        </button>
      </div>

      {showCreate && (
        <form onSubmit={create} className="mt-3 flex flex-col gap-2 rounded border bg-zinc-50 p-4 sm:flex-row sm:items-end" data-testid="create-form">
          <label className="flex-1 text-sm">
            Namn
            <input ref={nameRef} data-testid="new-plan-name" required className="mt-1 w-full rounded border px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Väggöppning lgh 153–154" />
          </label>
          <label className="text-sm">
            Starta från
            <select data-testid="new-plan-template" className="mt-1 block w-full rounded border px-2 py-1.5" value={template} onChange={(e) => setTemplate(e.target.value as 'empty' | 'demo')}>
              <option value="empty">Tom plan</option>
              <option value="demo">Exempel</option>
            </select>
          </label>
          <button data-testid="create-plan" className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700">
            Skapa
          </button>
        </form>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {tagList.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5" data-testid="tag-filter" role="group" aria-label="Filtrera på tagg">
          {tagList.map(([t, n]) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              data-testid="tag-chip"
              className={`rounded-full border px-2.5 py-0.5 text-xs ${tag === t ? 'border-blue-700 bg-blue-700 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-50'}`}
              onClick={() => {
                setTag(tag === t ? null : t)
                setPage(0)
              }}
            >
              {t} · {n}
            </button>
          ))}
        </div>
      )}

      {plans && (
        <p className="mt-4 text-xs text-zinc-600" data-testid="plan-count" aria-live="polite">
          {filtered ? `${shown.length} av ${plans.length}` : plans.length} planer
          {filtered && (
            <>
              {' · '}
              <button
                type="button"
                className="text-blue-700 underline"
                onClick={() => {
                  setQuery('')
                  setTag(null)
                  setPage(0)
                }}
              >
                Visa alla
              </button>
            </>
          )}
        </p>
      )}

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="load-error">
          Kunde inte läsa planerna ({loadError}).{' '}
          <button type="button" className="underline" onClick={() => load()}>
            Försök igen
          </button>
        </p>
      )}

      <ul className="mt-2 divide-y rounded-lg border bg-white shadow-sm" data-testid="plan-list">
        {plans === null && !loadError &&
          [0, 1, 2].map((i) => (
            <li key={i} className="flex animate-pulse gap-3 p-4" aria-hidden="true">
              <span className="h-16 w-16 rounded bg-zinc-100" />
              <span className="flex-1 space-y-2">
                <span className="block h-4 w-2/3 rounded bg-zinc-100" />
                <span className="block h-3 w-1/3 rounded bg-zinc-100" />
              </span>
            </li>
          ))}
        {empty && (
          <li className="p-8 text-center text-sm text-zinc-600">
            <p className="font-medium text-zinc-900">Inga planer ännu</p>
            <p className="mt-1">Skriv ett namn ovan och tryck Skapa. Välj &quot;Exempel&quot; för att se hur en färdig plan ser ut.</p>
          </li>
        )}
        {plans && plans.length > 0 && shown.length === 0 && (
          <li className="p-8 text-center text-sm text-zinc-600">
            <p className="font-medium text-zinc-900">Ingen plan matchar ”{query || tag}”</p>
            <p className="mt-1">Kontrollera stavningen eller välj en annan tagg.</p>
          </li>
        )}
        {rows.map((p) => (
          <li key={p.id} data-testid="plan-row" className="hover:bg-zinc-50/60">
            <div className="flex gap-3 p-3 sm:p-4">
              <a href={`/plans/${p.id}`} tabIndex={-1} className="shrink-0">
                <Thumb p={p} />
              </a>
              <div className="min-w-0 flex-1">
                <a href={`/plans/${p.id}`} data-testid="plan-name" className="block break-words font-medium leading-snug text-zinc-900 hover:underline">
                  {p.name}
                </a>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Rev {p.revision} · ändrad {day(p.updatedAt)}
                  {p.issued.length > 0 && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">utfärdad {p.issued[p.issued.length - 1]}</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  {editing === p.id ? (
                    <form
                      className="flex w-full flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        saveTags(p.id)
                      }}
                    >
                      <input
                        data-testid="tag-input"
                        autoFocus
                        aria-label="Taggar, skilda med komma"
                        placeholder="Taggar, skilda med komma, t.ex. Gnejsen, förslag B"
                        className="min-w-0 flex-1 rounded border bg-white px-2 py-1"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <button data-testid="tag-save" className="rounded bg-blue-600 px-2.5 py-1 text-white">
                        Spara
                      </button>
                      <button type="button" className="rounded border px-2.5 py-1" onClick={() => setEditing(null)}>
                        Avbryt
                      </button>
                    </form>
                  ) : (
                    <>
                      {p.tags?.map((t) => (
                        <button
                          key={t}
                          type="button"
                          data-testid="row-tag"
                          className="rounded-full border bg-zinc-50 px-2 py-0.5 text-zinc-700 hover:bg-zinc-100"
                          onClick={() => {
                            setTag(t)
                            setPage(0)
                          }}
                        >
                          {t}
                        </button>
                      ))}
                      <button
                        type="button"
                        data-testid="edit-tags"
                        className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-blue-700"
                        onClick={() => {
                          setEditing(p.id)
                          setDraft((p.tags ?? []).join(', '))
                        }}
                      >
                        {p.tags?.length ? 'Ändra taggar' : '+ Tagg'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="shrink-0 self-start text-xs">
                {confirming === p.id ? (
                  <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center" data-testid="confirm-delete">
                    <button type="button" data-testid="delete-yes" className="rounded bg-red-700 px-2 py-1 text-white hover:bg-red-800" onClick={() => remove(p.id)}>
                      Radera för alltid
                    </button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirming(null)}>
                      Avbryt
                    </button>
                  </span>
                ) : (
                  <button type="button" data-testid="delete-plan" aria-label={`Radera ${p.name}`} className="rounded px-2 py-1 text-zinc-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirming(p.id)}>
                    Radera
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between" aria-label="Sidor" data-testid="plan-pages">
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
