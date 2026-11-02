'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export type Section = 'planer' | 'tomter' | 'personer'

// The same three places on every list page. "Personer" shows only for administrators.
export function AppNav({ current }: { current: Section }) {
  const [admin, setAdmin] = useState(current === 'personer')

  useEffect(() => {
    fetch('/api/plans/people')
      .then((r) => setAdmin(r.ok))
      .catch(() => setAdmin(false))
  }, [])

  const pill = 'rounded-full border px-3 py-1 text-sm'
  const item = (section: Section, href: string, label: string, testid: string) =>
    current === section ? (
      <span className={`${pill} border-zinc-900 bg-zinc-900 text-white`} aria-current="page">
        {label}
      </span>
    ) : (
      <Link href={href} data-testid={testid} className={`${pill} hover:bg-zinc-50`}>
        {label}
      </Link>
    )

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Avsnitt">
      {item('planer', '/plans', 'Planer', 'to-plans')}
      {item('tomter', '/plans/site', 'Tomter', 'to-sites')}
      {admin && item('personer', '/plans/people', 'Personer', 'to-people')}
    </nav>
  )
}
