'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// The way back in for someone whose invite link died in a webview: they paste the link
// (or the bare inv_… token), this checks it without spending it and sends them on.
export function InviteLookup() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const m = /inv_[A-Za-z0-9_-]{20,80}/.exec(value.trim())
    if (!m) return setError('Klistra in inbjudningslänken, eller token som börjar på inv_.')
    setBusy(true)
    const r = await fetch(`/api/plans/invite?token=${encodeURIComponent(m[0])}`)
    const b = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return setError(b.errors?.[0] ?? 'Inbjudan gäller inte längre.')
    router.push(`/plans/invite/${m[0]}`)
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      <label className="block text-sm">
        Har du en inbjudan? Klistra in länken
        <input
          data-testid="invite-lookup"
          required
          autoFocus
          autoCapitalize="none"
          autoComplete="off"
          className="mt-1 w-full rounded border px-2 py-1.5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…/plans/invite/inv_…"
        />
      </label>
      {error && (
        <p className="text-sm text-red-700" data-testid="invite-lookup-error">
          {error}
        </p>
      )}
      <button data-testid="invite-lookup-submit" disabled={busy} className="w-full rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-60">
        Gå till inbjudan
      </button>
    </form>
  )
}
