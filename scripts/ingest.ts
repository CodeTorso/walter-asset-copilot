// Usage: bun run ingest --dataset sample --path RESOURCE/.../sample-data [--label "Sample"] [--today 2026-10-16] [--reset] [--strict]
// Local database: PGlite in .data/pglite (PGLITE_DIR to change). Neon: DATABASE_URL=postgres://... bun run ingest ...
// PGlite allows one process at a time: stop any process holding .data/pglite before ingesting.
import { parseArgs } from "node:util"
import { getDb, ensureSchema } from "../src/server/db/client"
import { parseDataset } from "../src/server/ingest/parse"
import { dbSizeReport, resetDataset, writeDataset } from "../src/server/ingest/write"

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    path: { type: "string" },
    label: { type: "string" },
    today: { type: "string" },
    reset: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    size: { type: "boolean", default: false },
  },
})

if (!values.dataset || !values.path) {
  console.error("Usage: bun run ingest --dataset <id> --path <dataset folder> [--label <text>] [--today YYYY-MM-DD] [--reset] [--strict]")
  console.error("  Local:  PGlite in .data/pglite.   Neon: DATABASE_URL=postgres://... bun run ingest ...")
  process.exit(1)
}

const target = process.env.DATABASE_URL ? "Neon (DATABASE_URL set)" : `PGlite (${process.env.PGLITE_DIR ?? ".data/pglite"})`
console.log(`target: ${target}`)
const t0 = Date.now()
const db = await getDb()
await ensureSchema(db)
const rows = await parseDataset(values.path, {
  datasetId: values.dataset,
  label: values.label,
  today: values.today,
  strict: values.strict,
  onLog: (l) => console.log(l),
})
for (const w of rows.warnings.slice(0, 20)) console.warn("warning:", w)
if (rows.warnings.length > 20) console.warn(`... ${rows.warnings.length - 20} more warnings`)
const res = await writeDataset(db, rows, (l) => console.log(" ", l))
if (values.reset) {
  await resetDataset(db, values.dataset)
  console.log("cleared feedback and memory for this dataset")
}
console.log(`dataset ${res.datasetId} loaded as version ${res.version}; today = ${rows.meta.today}${rows.meta.todayOverridden ? " (override)" : ""}`)
console.log(res.counts)
const missing = rows.rules.filter((r) => r.status === "missing")
if (missing.length) console.warn(`rules missing (model fallback hook): ${missing.map((r) => `${r.wellType || "fleet"}:${r.key}`).join(", ")}`)
const size = await dbSizeReport(db)
console.log(`database size: ${size.total?.pretty} (${size.total?.size} bytes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (values.size) console.table(size.tables)
await db.close()
