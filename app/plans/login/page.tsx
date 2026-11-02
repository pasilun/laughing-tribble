export const metadata = { title: 'Logga in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; fel?: string }> }) {
  const { next = '/plans', fel } = await searchParams
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16 sm:py-24">
      <h1 className="text-2xl font-bold tracking-tight">Planstudio</h1>
      <p className="mt-1 text-sm text-zinc-600">Logga in för att se dina planritningar.</p>
      <form method="post" action="/api/plans/login" className="mt-6 space-y-3 rounded-lg border bg-white p-4 shadow-sm">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm">
          Din personliga nyckel
          <input data-testid="login-password" name="password" type="password" autoComplete="current-password" required autoFocus className="mt-1 w-full rounded border px-2 py-1.5" />
        </label>
        {fel && <p className="text-sm text-red-700">{fel === 'for-manga' ? 'För många försök – vänta tio minuter.' : 'Fel nyckel.'}</p>}
        <button data-testid="login-submit" className="w-full rounded bg-blue-600 px-4 py-1.5 text-white">
          Logga in
        </button>
      </form>
      <p className="mt-6 text-xs text-zinc-600">Har du fått en inbjudningslänk? Öppna den i stället – då får du en egen nyckel.</p>
    </main>
  )
}
