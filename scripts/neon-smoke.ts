// Neon compatibility check with a 20-well slice under dataset id "neon-smoke" (deleted afterwards).
// Usage: bun --env-file=.env.vercel scripts/neon-smoke.ts   (never prints connection values)
import { eq } from "drizzle-orm"
import { ensureSchema, getDb } from "../src/server/db/client"
import * as t from "../src/server/db/schema"
import { tools } from "../src/server"
import { parseDataset } from "../src/server/ingest/parse"
import { writeDataset } from "../src/server/ingest/write"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set; run with --env-file=.env.vercel")
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED
const db = await getDb()
console.log("driver:", db.kind)
const t0 = Date.now()
await ensureSchema(db)
console.log("schema ok", Date.now() - t0, "ms")
const rows = await parseDataset("RESOURCE/flytbase-ahc-swe-asset-intelligence-dataset/sample-data", { datasetId: "neon-smoke" })
const keep = new Set(rows.wells.slice(0, 20).map((w) => w.asset_id))
rows.wells = rows.wells.filter((w) => keep.has(w.asset_id))
rows.inspections = rows.inspections.filter((i) => keep.has(i.asset_id))
rows.maintenance = rows.maintenance.filter((m) => keep.has(m.asset_id))
rows.regEvents = rows.regEvents.filter((e) => keep.has(e.asset_id))
rows.notes = rows.notes.filter((n) => keep.has(n.asset_id))
const mids = new Set(rows.maintenance.map((m) => m.maintenance_id))
rows.facts = rows.facts.filter((f) => mids.has(f.maintenanceId))
rows.documents = rows.documents.filter((d) => d.kind !== "report" || mids.has(d.maintenanceId!))
const t1 = Date.now()
const res = await writeDataset(db, rows, (l) => console.log(" ", l))
console.log("write ok", Date.now() - t1, "ms", res.version)
const ctx = { datasetId: "neon-smoke", userId: "U-201" }
const f = await tools.well_status(ctx, { scope: { wellIds: ["WELL-0001"] } })
console.log("well_status", f.rows[0]?.status, f.rows[0]?.delta_c)
const s = await tools.search_documents(ctx, { query: "root-cause analysis", limit: 2 })
console.log("search rows", s.rows.length)
const r = await tools.record_feedback(ctx, { kind: "data_correction", targetId: "INS-0001-0203", newValue: 50, reason: "smoke", text: "smoke" })
console.log("feedback", r.feedback.status, r.slots.statusAfter)
const g = await tools.recall(ctx, { reference: "x" })
console.log("recall rows", g.rows.length)
for (const table of [t.users, t.teams, t.areas, t.wells, t.inspections, t.maintenance, t.regulatoryEvents, t.notes, t.documents, t.documentSections, t.reportFacts, t.rules]) {
  await db.drizzle.delete(table).where(eq((table as typeof t.users).datasetId, "neon-smoke"))
}
await db.drizzle.delete(t.feedback).where(eq(t.feedback.datasetId, "neon-smoke"))
await db.drizzle.delete(t.memoryEntities).where(eq(t.memoryEntities.datasetId, "neon-smoke"))
await db.drizzle.delete(t.conversations).where(eq(t.conversations.datasetId, "neon-smoke"))
await db.drizzle.delete(t.datasets).where(eq(t.datasets.id, "neon-smoke"))
console.log("cleaned up")
