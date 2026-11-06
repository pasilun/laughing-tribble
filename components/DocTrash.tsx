'use client'

export type TrashedDoc = { id: string; name: string; deletedAt: string; daysLeft: number; sharedWith?: string[] }

// The trash of one kind of document: restore, or delete for good (not while others still have it).
// `words.plural` is "planer", `words.one` "planen" – for the sentences.
export function DocTrash({
  api,
  items,
  words,
  onChanged,
  onError,
  onNotice,
}: {
  api: string
  items: TrashedDoc[]
  words: { plural: string; one: string }
  onChanged: () => void
  onError: (msg: string) => void
  onNotice: (msg: string) => void
}) {
  if (!items.length) return null
  const fail = async (r: Response, fallback: string) => onError((await r.json().catch(() => ({}))).errors?.[0] ?? fallback)

  const restore = async (id: string) => {
    onError('')
    const r = await fetch(`${api}/${id}/restore`, { method: 'POST' })
    if (!r.ok) return fail(r, `kunde inte återställa ${words.one}`)
    onNotice(`${words.one[0].toUpperCase()}${words.one.slice(1)} är tillbaka i listan.`)
    onChanged()
  }

  const purge = async (id: string, name: string) => {
    if (!window.confirm(`Radera ”${name}” för alltid? Det går inte att ångra.`)) return
    onError('')
    const r = await fetch(`${api}/${id}?permanent=1`, { method: 'DELETE' })
    if (!r.ok) return fail(r, `kunde inte radera ${words.one}`)
    onNotice('')
    onChanged()
  }

  return (
    <details className="mt-6 rounded-lg border bg-white p-3 text-sm" data-testid="trash">
      <summary className="cursor-pointer font-medium">Papperskorgen ({items.length})</summary>
      <p className="mt-2 text-xs text-zinc-600">Raderade {words.plural} ligger här i 30 dagar och kan återställas.</p>
      <ul className="mt-2 divide-y">
        {items.map((t) => (
          <li key={t.id} data-testid="trash-row" className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="break-words">{t.name}</span>
              <span className="ml-2 text-xs text-zinc-600">
                {t.daysLeft} dagar kvar{t.sharedWith?.length ? ` · delas med ${t.sharedWith.join(', ')}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 gap-2 text-xs">
              <button type="button" data-testid="restore-plan" className="rounded border px-2 py-1 hover:bg-zinc-50" onClick={() => restore(t.id)}>
                Återställ
              </button>
              {!t.sharedWith?.length && (
                <button type="button" data-testid="purge-plan" className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50" onClick={() => purge(t.id, t.name)}>
                  Radera för alltid
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
