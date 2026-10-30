// Slows down guessing of access keys: five wrong keys from one address lock
// that address out for ten minutes. The counter lives in the memory of one
// server instance, so it is a speed bump, not a hard guarantee; the keys are
// long random strings, which is what actually protects them.

const MAX = 5
const WINDOW_MS = 10 * 60 * 1000
const tries = new Map<string, { n: number; until: number }>()

export function allowed(ip: string, now = Date.now()): boolean {
  const t = tries.get(ip)
  if (!t) return true
  if (now > t.until) {
    tries.delete(ip)
    return true
  }
  return t.n < MAX
}

export function fail(ip: string, now = Date.now()) {
  const t = tries.get(ip)
  tries.set(ip, { n: t && now <= t.until ? t.n + 1 : 1, until: now + WINDOW_MS })
}

export function ok(ip: string) {
  tries.delete(ip)
}

export function resetLimits() {
  tries.clear()
}
