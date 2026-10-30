import { AsyncLocalStorage } from 'node:async_hooks'

// The signed-in person for the current request. Routes and MCP calls run
// inside runAs(); the store reads it to pick that person's storage prefix, so
// no function in between has to carry a user argument (and none can forget it:
// with sign-in configured, storage without a user throws).

export type User = {
  id: string
  // Single-password mode and local development keep the old unprefixed layout.
  legacy?: boolean
}

const ctx = new AsyncLocalStorage<User>()

export function runAs<T>(user: User, fn: () => T): T {
  return ctx.run(user, fn)
}

export function currentUser(): User | undefined {
  return ctx.getStore()
}

export const USER_ID = /^[a-z0-9][a-z0-9-]{0,29}$/

// Where a person's data lives in the store ("" = the old shared layout).
export function scopeOf(user: User): string {
  return user.legacy ? '' : `u/${user.id}/`
}
