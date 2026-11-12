import * as Sentry from '@sentry/node'

// Error monitoring (Sentry, free tier). Off unless SENTRY_DSN is set, so tests and local runs send nothing.
// Only what is needed to find a failure again is sent: the tool, the action and the document id. Never arguments or images.

let started = false
function start(): boolean {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return false
  if (!started) {
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? 'local',
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      // Errors only: no performance traces, no personal data.
      tracesSampleRate: 0,
    })
    started = true
  }
  return true
}

// Reports an error and returns Sentry's event id (what a person can quote), or undefined when monitoring is off.
export async function reportError(error: unknown, tags: Record<string, string | undefined> = {}): Promise<string | undefined> {
  if (!start()) return undefined
  try {
    const clean = Object.fromEntries(Object.entries(tags).filter((e): e is [string, string] => typeof e[1] === 'string'))
    const id = Sentry.captureException(error, { tags: clean })
    // A function can be frozen as soon as it answers: send before that.
    await Sentry.flush(2000)
    return id
  } catch {
    return undefined
  }
}
