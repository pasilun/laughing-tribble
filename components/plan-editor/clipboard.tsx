'use client'

import { useState } from 'react'

// Copies text; a browser that refuses the clipboard API (some in-app browsers) gets the old way.
export async function copyText(text: string): Promise<boolean> {
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
export function Keep({ value, testid, what }: { value: string; testid: string; what: string }) {
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
