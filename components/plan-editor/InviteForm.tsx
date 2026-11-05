'use client'

import { useState } from 'react'
import Link from 'next/link'

type Done = { id: string; key: string; connector: string }

// Copies text; a browser that refuses the clipboard API (some in-app browsers) gets the old way.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, text.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

// A value to keep: a field to select, a Copy button and (where the phone has one) the share sheet,
// so it can be sent to Notes or a message when copying does not work.
function Keep({ value, testid, what }: { value: string; testid: string; what: string }) {
  const [copied, setCopied] = useState<'ja' | 'nej' | null>(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <div className="mt-2">
      <input data-testid={testid} readOnly className="w-full rounded border bg-white px-2 py-1.5 font-mono text-xs" value={value} onFocus={(e) => e.currentTarget.select()} />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" data-testid={`${testid}-copy`} className="rounded border bg-white px-3 py-1.5" onClick={async () => setCopied((await copyText(value)) ? 'ja' : 'nej')}>
          {copied === 'ja' ? 'Kopierad' : `Kopiera ${what}`}
        </button>
        {canShare && (
          <button type="button" data-testid={`${testid}-share`} className="rounded border bg-white px-3 py-1.5" onClick={() => void navigator.share({ text: value }).catch(() => undefined)}>
            Dela / spara…
          </button>
        )}
        {copied === 'nej' && <span className="text-red-700">Det gick inte att kopiera. Tryck i fältet och markera allt, eller välj Dela / spara.</span>}
      </div>
    </div>
  )
}

export function InviteForm({ token, label, expiresAt, forUser }: { token: string; label: string; expiresAt: string; forUser?: string }) {
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const r = await fetch('/api/plans/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, id: forUser ?? id }) })
    const b = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setError(b.errors?.[0] ?? 'Det gick inte att skapa kontot.')
    setDone(b as Done)
  }

  if (done)
    return (
      <div className="mt-6 space-y-4 text-sm" data-testid="invite-done">
        <p>
          {forUser ? 'Här är din nya nyckel, ' : 'Välkommen, '}
          <strong>{done.id}</strong>. Du är inloggad i den här webbläsaren.
        </p>
        <div className="rounded border border-amber-400 bg-amber-50 p-3">
          <p className="font-medium text-zinc-900">Spara din nyckel nu – den visas bara den här gången.</p>
          <Keep value={done.key} testid="invite-key" what="nyckeln" />
          <p className="mt-2 text-zinc-700">Du behöver den för att logga in i Claude och från en annan webbläsare eller telefon.</p>
          <label className="mt-2 flex items-start gap-2 text-zinc-900">
            <input data-testid="invite-saved" type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>Jag har sparat nyckeln på ett ställe jag hittar den.</span>
          </label>
        </div>
        <div>
          <p className="font-medium">Claude-koppling (valfritt)</p>
          <p className="text-zinc-700">I Claude: Inställningar → Connectors → Lägg till anpassad connector, klistra in adressen och logga in när Claude ber om det (med nyckeln ovan eller redan inloggad här). Adressen innehåller ingen nyckel.</p>
          <Keep value={done.connector} testid="invite-connector" what="adressen" />
        </div>
        {saved ? (
          <Link href="/plans" className="inline-block rounded bg-blue-600 px-4 py-1.5 text-white" data-testid="invite-continue">
            Till mina planer
          </Link>
        ) : (
          <span className="inline-block rounded bg-zinc-300 px-4 py-1.5 text-zinc-600" data-testid="invite-continue-locked" aria-disabled="true">
            Till mina planer (kryssa i rutan först)
          </span>
        )}
      </div>
    )

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      {forUser ? (
        <p className="text-sm text-zinc-700">
          Den här länken ger <strong>{forUser}</strong> en ny nyckel. Dina planer finns kvar. Länken gäller till {new Date(expiresAt).toLocaleDateString('sv-SE')} och kan användas en gång. Den gamla nyckeln slutar fungera.
        </p>
      ) : (
        <p className="text-sm text-zinc-700">
          Du är inbjuden som <strong>{label}</strong>. Länken gäller till {new Date(expiresAt).toLocaleDateString('sv-SE')} och kan användas en gång.
        </p>
      )}
      {!forUser && (
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
      )}
      {error && (
        <p className="text-sm text-red-700" data-testid="invite-error">
          {error}
        </p>
      )}
      <button data-testid="invite-submit" disabled={busy} className="w-full rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-60">
        {forUser ? 'Skapa ny nyckel' : 'Skapa mitt konto'}
      </button>
    </form>
  )
}
