import type { Client, InValue } from '@libsql/client'
import type { Backend } from './storage'

// The store on Turso (libSQL, SQLite over HTTP): one table of keys and values, which is all the store
// needs (read, write, write-only-if-new, remove, list a prefix). Unlike Blob it has no per-operation
// billing that listing or saving can run into, and a write-if-new is a real atomic insert.
//
//   kv(k TEXT PRIMARY KEY, v BLOB, ct TEXT, ts INTEGER)
//
// The client is created on first use (the web build, HTTP only, so the function stays small), or handed in:
// the tests give it a local file database.

export type ClientFactory = () => Promise<Client>

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v BLOB NOT NULL, ct TEXT, ts INTEGER) WITHOUT ROWID'

const bytes = (v: unknown): Buffer => (typeof v === 'string' ? Buffer.from(v) : Buffer.from(v as ArrayBuffer))

export class TursoBackend implements Backend {
  private ready: Promise<Client> | null = null
  constructor(private factory: ClientFactory) {}

  private client(): Promise<Client> {
    if (!this.ready) {
      this.ready = this.factory().then(async (c) => {
        await c.execute(SCHEMA)
        return c
      })
      this.ready.catch(() => (this.ready = null))
    }
    return this.ready
  }

  async read(key: string) {
    const c = await this.client()
    const r = await c.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [key] })
    return r.rows.length ? bytes(r.rows[0].v) : null
  }

  async write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }) {
    const c = await this.client()
    const v: InValue = typeof data === 'string' ? Buffer.from(data) : new Uint8Array(data)
    const args = [key, v, contentType, Date.now()]
    if (opts?.createOnly) {
      const r = await c.execute({ sql: 'INSERT OR IGNORE INTO kv (k, v, ct, ts) VALUES (?, ?, ?, ?)', args })
      return r.rowsAffected === 1
    }
    await c.execute({ sql: 'INSERT INTO kv (k, v, ct, ts) VALUES (?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, ct = excluded.ct, ts = excluded.ts', args })
    return true
  }

  async remove(keys: string[]) {
    if (!keys.length) return
    const c = await this.client()
    for (let i = 0; i < keys.length; i += 50) {
      await c.batch(
        keys.slice(i, i + 50).map((k) => ({ sql: 'DELETE FROM kv WHERE k = ?', args: [k] })),
        'write',
      )
    }
  }

  // Everything below prefix/, like a folder listing: "a" gives a/x and a/y/z, not ab/x ("0" is the character after "/").
  async keys(prefix: string) {
    const c = await this.client()
    const r = await c.execute({ sql: 'SELECT k FROM kv WHERE k >= ? AND k < ? ORDER BY k', args: [`${prefix}/`, `${prefix}0`] })
    return r.rows.map((row) => String(row.k))
  }

  // How many keys the store holds (the migration compares it with the source).
  async count(): Promise<number> {
    const c = await this.client()
    const r = await c.execute('SELECT COUNT(*) AS n FROM kv')
    return Number(r.rows[0].n)
  }
}

// The web client: HTTP to <name>.turso.io, no native code.
export function tursoFromEnv(): TursoBackend {
  return new TursoBackend(async () => {
    const url = process.env.TURSO_DATABASE_URL
    const authToken = process.env.TURSO_AUTH_TOKEN
    if (!url || !authToken) throw new Error('TURSO_DATABASE_URL och TURSO_AUTH_TOKEN saknas')
    const { createClient } = await import('@libsql/client/web')
    return createClient({ url, authToken })
  })
}
