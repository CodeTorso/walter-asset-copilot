import { sql } from "drizzle-orm"
import type { PgDatabase } from "drizzle-orm/pg-core"
import * as schema from "./schema"

export type DrizzleDb = PgDatabase<any, typeof schema>

export type Db = {
  kind: "pglite" | "neon"
  drizzle: DrizzleDb
  /** Run raw SQL text (no params) */
  exec: (text: string) => Promise<void>
  /** Run a drizzle sql`` template and return rows */
  rows: <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => Promise<T[]>
  close: () => Promise<void>
}

const globalKey = Symbol.for("asset-copilot.db")
type Holder = { [globalKey]?: Promise<Db> }

function normalizeRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return ((result as { rows?: T[] }).rows ?? []) as T[]
}

export async function openPglite(dataDir: string): Promise<Db> {
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ])
  if (!dataDir.startsWith("memory:")) {
    const { mkdirSync } = await import("node:fs")
    mkdirSync(dataDir, { recursive: true })
  }
  const client = new PGlite(dataDir)
  await client.waitReady
  const db = drizzle(client, { schema }) as unknown as DrizzleDb
  return {
    kind: "pglite",
    drizzle: db,
    exec: async (text) => {
      await client.exec(text)
    },
    rows: async (query) => normalizeRows(await db.execute(query)),
    close: () => client.close(),
  }
}

export async function openNeon(url: string): Promise<Db> {
  const [{ neon }, { drizzle }] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-http"),
  ])
  const client = neon(url)
  const db = drizzle(client, { schema }) as unknown as DrizzleDb
  return {
    kind: "neon",
    drizzle: db,
    exec: async (text) => {
      await client.query(text)
    },
    rows: async (query) => normalizeRows(await db.execute(query)),
    close: async () => {},
  }
}

/** One shared connection per process: Neon when DATABASE_URL is set, otherwise PGlite in .data/pglite. */
export function getDb(): Promise<Db> {
  const holder = globalThis as unknown as Holder
  holder[globalKey] ??= (async () => {
    const url = process.env.DATABASE_URL
    if (url) return openNeon(url)
    return openPglite(process.env.PGLITE_DIR ?? ".data/pglite")
  })()
  return holder[globalKey]
}

export function setDb(db: Promise<Db> | Db) {
  ;(globalThis as unknown as Holder)[globalKey] = Promise.resolve(db)
}

export async function ensureSchema(db: Db) {
  const { DDL } = await import("./ddl.generated")
  const existing = await db.rows<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  )
  const have = new Set(existing.map((r) => r.table_name))
  for (const stmt of DDL) {
    const m = /CREATE TABLE "([^"]+)"/.exec(stmt)
    if (m && have.has(m[1]!)) continue
    if (!m) {
      // indexes: skip when their table already existed
      const t = /ON "([^"]+)"/.exec(stmt)
      if (t && have.has(t[1]!)) continue
    }
    await db.exec(stmt)
  }
}
