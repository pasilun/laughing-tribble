'use client'

import { useEffect, useState } from 'react'

type State = { me: string | null; others: string[]; signIn: boolean }

// Who is signed in on this browser, with a way to switch to someone else who is, to sign in as another
// person (without losing the first) and to sign out. Shows nothing where nobody signs in (local development).
export function AccountSwitcher() {
  const [s, setS] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/plans/accounts')
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => undefined)
  }, [])

  if (!s || !s.signIn || !s.me) return null

  const call = async (method: 'POST' | 'DELETE', url = '/api/plans/accounts', body?: unknown) => {
    setBusy(true)
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    setBusy(false)
    return r.ok
  }
  const switchTo = async (id: string) => {
    if (await call('POST', '/api/plans/accounts', { switchTo: id })) window.location.assign('/plans')
  }
  const signOut = async () => {
    if (await call('DELETE')) window.location.assign('/plans')
  }
  const forget = async (id: string) => {
    if (await call('DELETE', `/api/plans/accounts?id=${encodeURIComponent(id)}`)) setS({ ...s, others: s.others.filter((o) => o !== id) })
  }

  return (
    <details className="relative ml-auto" data-testid="account-menu">
      <summary className="cursor-pointer list-none rounded-full border px-3 py-1 text-sm hover:bg-zinc-50" data-testid="account-me">
        {s.me} ▾
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-60 rounded border bg-white p-1 text-sm shadow">
        <p className="px-2 py-1 text-xs text-zinc-600">
          Inloggad som <strong>{s.me}</strong>
        </p>
        {s.others.map((o) => (
          <div key={o} className="flex items-center justify-between gap-1 rounded px-2 py-1 hover:bg-zinc-100">
            <button type="button" disabled={busy} data-testid="account-switch" className="min-w-0 flex-1 truncate text-left" onClick={() => switchTo(o)}>
              Byt till <strong>{o}</strong>
            </button>
            <button type="button" disabled={busy} aria-label={`Ta bort ${o} från den här webbläsaren`} className="rounded px-1.5 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-700" onClick={() => forget(o)}>
              ✕
            </button>
          </div>
        ))}
        <a className="block rounded px-2 py-1 hover:bg-zinc-100" data-testid="account-add" href={`/plans/login?next=${encodeURIComponent('/plans')}`}>
          Logga in som någon annan…
        </a>
        <button type="button" disabled={busy} data-testid="account-signout" className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100" onClick={signOut}>
          Logga ut {s.me}
        </button>
      </div>
    </details>
  )
}
