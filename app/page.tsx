export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-white font-sans dark:bg-black">
      <main className="flex flex-col items-center justify-center gap-12 w-full max-w-4xl px-8 py-20 sm:py-32">
        <div className="flex flex-col items-center text-center gap-8 w-full max-w-2xl">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            Din svenska bygglovsassistent
          </h1>
          <p className="text-lg sm:text-xl font-normal text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Skapa ansökan för friggebod, attefallshus och andra små byggnader enkelt och snabbt
          </p>
          <div className="pt-4 flex flex-col sm:flex-row gap-3 items-center justify-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Anslut Claude via MCP på <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/api/mcp</code> och be om en 3D-modell
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
