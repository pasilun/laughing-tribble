'use client'

import { useState } from 'react'
import Link from 'next/link'

type Done = { id: string; key: string; connector: string }

export function InviteForm({ token, label, expiresAt }: { token: string; label: string; expiresAt: string }) {
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const r = await fetch('/api/plans/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, id }) })
    const b = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setError(b.errors?.[0] ?? 'Det gick inte att skapa kontot.')
    setDone(b as Done)
  }

  if (done)
    return (
      <div className="mt-6 space-y-4 text-sm" data-testid="invite-done">
        <p>
          Välkommen, <strong>{done.id}</strong>. Du är inloggad i den här webbläsaren.
        </p>
        <div className="rounded border border-amber-400 bg-amber-50 p-3">
          <p className="font-medium text-zinc-900">Spara din nyckel nu – den visas bara den här gången.</p>
          <input data-testid="invite-key" readOnly className="mt-2 w-full rounded border bg-white px-2 py-1.5 font-mono text-xs" value={done.key} onFocus={(e) => e.currentTarget.select()} />
          <p className="mt-2 text-zinc-700">Du behöver den för att logga in från en annan webbläsare eller telefon.</p>
        </div>
        <div>
          <p className="font-medium">Claude-koppling (valfritt)</p>
          <p className="text-zinc-700">I Claude: Inställningar → Connectors → Lägg till anpassad connector, klistra in adressen och logga in när Claude ber om det (med nyckeln ovan eller redan inloggad här). Adressen innehåller ingen nyckel.</p>
          <input data-testid="invite-connector" readOnly className="mt-2 w-full rounded border bg-white px-2 py-1.5 font-mono text-xs" value={done.connector} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <Link href="/plans" className="inline-block rounded bg-blue-600 px-4 py-1.5 text-white" data-testid="invite-continue">
          Till mina planer
        </Link>
      </div>
    )

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      <p className="text-sm text-zinc-700">
        Du är inbjuden som <strong>{label}</strong>. Länken gäller till {new Date(expiresAt).toLocaleDateString('sv-SE')} och kan användas en gång.
      </p>
      <label className="block text-sm">
        Välj ett användarnamn
        <input
          data-testid="invite-id"
          required
          autoFocus
          autoCapitalize="none"
          autoComplete="off"
          maxLength={30}
          className="mt-1 w-full rounded border px-2 py-1.5"
          value={id}
          onChange={(e) => setId(e.target.value.toLowerCase())}
          placeholder="t.ex. anna"
        />
        <span className="mt-1 block text-xs text-zinc-600">Små bokstäver, siffror och bindestreck. Dina planer sparas under det namnet.</span>
      </label>
      {error && (
        <p className="text-sm text-red-700" data-testid="invite-error">
          {error}
        </p>
      )}
      <button data-testid="invite-submit" disabled={busy} className="w-full rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-60">
        Skapa mitt konto
      </button>
    </form>
  )
}
