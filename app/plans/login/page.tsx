export const metadata = { title: 'Logga in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; fel?: string }> }) {
  const { next = '/plans', fel } = await searchParams
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-xl font-bold">Planritningar</h1>
      <form method="post" action="/api/plans/login" className="mt-6 space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm">
          Din personliga nyckel
          <input data-testid="login-password" name="password" type="password" required autoFocus className="mt-1 w-full rounded border px-2 py-1.5" />
        </label>
        {fel && <p className="text-sm text-red-700">{fel === 'for-manga' ? 'För många försök – vänta tio minuter.' : 'Fel nyckel.'}</p>}
        <button data-testid="login-submit" className="w-full rounded bg-blue-600 px-4 py-1.5 text-white">
          Logga in
        </button>
      </form>
    </main>
  )
}
