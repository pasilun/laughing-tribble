'use client'

import { useState } from 'react'

// "Dela" with its form: shares a document (a plan, a site plan) with another person. The same for every kind of
// document; `api` is the kind's collection address (/api/plans, /api/sites) and `noun` how it is spoken of.
export function DocShare({ api, id, noun, onShared }: { api: string; id: string; noun: string; onShared?: (members: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [msg, setMsg] = useState('')

  const share = async () => {
    setMsg('')
    const r = await fetch(`${api}/${id}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: who }) })
    const b = await r.json().catch(() => ({}))
    if (!r.ok) return setMsg(b.errors?.[0] ?? `kunde inte dela ${noun}`)
    onShared?.(b.members ?? [])
    setMsg(`Delad med ${who.trim().toLowerCase()}.`)
    setWho('')
  }

  return (
    <>
      <button
        type="button"
        data-testid="share-plan"
        aria-expanded={open}
        className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-blue-700"
        onClick={() => {
          setOpen(!open)
          setMsg('')
          setWho('')
        }}
      >
        Dela
      </button>
      {open && (
        <form
          className="mt-2 basis-full space-y-1 text-xs"
          data-testid="share-form"
          onSubmit={(e) => {
            e.preventDefault()
            void share()
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="share-user"
              autoFocus
              autoCapitalize="none"
              autoComplete="off"
              aria-label="Användarnamn att dela med"
              placeholder="Användarnamn, t.ex. emil"
              className="min-w-0 flex-1 rounded border bg-white px-2 py-1"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            />
            <button data-testid="share-save" className="rounded bg-blue-600 px-2.5 py-1 text-white">
              Dela
            </button>
          </div>
          <p className="text-zinc-600">Ni kan båda göra nya versioner av {noun}. Raderar någon den försvinner den bara för den personen.</p>
          {msg && (
            <p data-testid="share-msg" role="status" className="text-zinc-800">
              {msg}
            </p>
          )}
        </form>
      )}
    </>
  )
}
