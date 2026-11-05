'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Keep } from './clipboard'
import { looksLikeInAppBrowser } from '@/lib/plan/browser'

type Done = { id: string; key: string; connector: string }

const noopSubscribe = () => () => undefined
// Server render says no; the client snapshot reads the real user agent.
const onServer = () => false

// A webview (Instagram, WhatsApp …) keeps its own cookies, so the sign-in the OAuth
// handshake needs never reaches the real browser. Offer the way out before anything else.
function InAppStrip() {
  const inApp = useSyncExternalStore(noopSubscribe, () => looksLikeInAppBrowser(navigator.userAgent), onServer)
  if (!inApp) return null
  const url = window.location.href
  const safari = /iphone|ipad|ipod/i.test(navigator.userAgent)
  return (
    <div className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm" data-testid="inapp-strip">
      <p className="text-zinc-900">Du är i en app (t.ex. Instagram eller WhatsApp). Logga in i webbläsaren i stället, annars når inte Claude inloggningen.</p>
      <a href={url} className="mt-2 inline-block rounded bg-blue-600 px-3 py-1.5 text-white" data-testid="inapp-open">
        Öppna i {safari ? 'Safari' : 'Chrome'}
      </a>
    </div>
  )
}

export function InviteForm({ token, label, expiresAt, forUser }: { token: string; label: string; expiresAt: string; forUser?: string }) {
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const [busy, setBusy] = useState(false)

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
          <strong>{done.id}</strong>. Du är inloggad här. På den här telefonen behöver du ingen nyckel.
        </p>
        <div className="rounded border bg-white p-3">
          <p className="font-medium text-zinc-900">Koppla Claude</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-zinc-700">
            <li>
              Kopiera adressen
              <Keep value={done.connector} testid="invite-connector" what="adressen" />
            </li>
            <li>
              Öppna Claude → Inställningar → Connectors → Lägg till anpassad connector
              <div className="mt-2">
                <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" className="inline-block rounded bg-blue-600 px-3 py-1.5 text-white" data-testid="invite-open-claude">
                  Öppna Claude
                </a>
              </div>
            </li>
            <li>Logga in när Claude frågar — du är redan inloggad i den här webbläsaren, tryck bara Godkänn.</li>
          </ol>
        </div>
        <details className="rounded border bg-white p-3">
          <summary className="cursor-pointer font-medium">Bytte du enhet? Din nyckel</summary>
          <p className="mt-2 text-zinc-700">Spara den nu – den visas bara den här gången. Du behöver den om du loggar in från en annan telefon eller webbläsare.</p>
          <Keep value={done.key} testid="invite-key" what="nyckeln" />
        </details>
        <div>
          <Link href="/plans" className="inline-block rounded bg-blue-600 px-4 py-1.5 text-white" data-testid="invite-continue">
            Till mina planer
          </Link>
        </div>
      </div>
    )

  return (
    <>
      <InAppStrip />
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
    </>
  )
}
