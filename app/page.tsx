'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function Home() {
  const [name, setName] = useState('')

  const greeting = name.trim() ? `Välkommen, ${name}!` : 'Välkommen till Bygglovsassistenten'

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex flex-col items-center gap-8 text-center sm:items-start sm:text-left w-full">
          <h1 className="text-4xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            {greeting}
          </h1>
          <Link
            href="/design"
            className="px-6 py-3 bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
          >
            Kom igång
          </Link>
          <div className="flex flex-col gap-2 w-full max-w-md">
            <label htmlFor="name-input" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Ditt namn
            </label>
            <input
              id="name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ange ditt namn..."
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500"
            />
          </div>
        </div>
      </main>
    </div>
  )
}
