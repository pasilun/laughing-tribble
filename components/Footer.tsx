export function Footer() {
  const currentYear = 2026

  return (
    <footer
      role="contentinfo"
      className="w-full py-6 px-4 text-center text-sm text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-black border-t border-zinc-200 dark:border-zinc-800"
    >
      © Bygglovsassistenten {currentYear}
    </footer>
  )
}
