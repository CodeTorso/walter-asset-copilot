import { parseDataset } from "../src/server/ingest/parse"
const t = Date.now()
const rows = await parseDataset(process.argv[2]!, { datasetId: "sample" })
console.log("ms", Date.now() - t, "today", rows.meta.today, "warnings", rows.warnings.length, rows.warnings.slice(0, 5))
console.log({ wells: rows.wells.length, ins: rows.inspections.length, mnt: rows.maintenance.length, reg: rows.regEvents.length, notes: rows.notes.length, facts: rows.facts.length, docs: rows.documents.length })
for (const r of rows.rules) console.log(r.wellType || "-", r.key, r.status, r.value, r.method, r.inheritedFrom ?? "", r.docId, r.section)
const f = rows.facts.filter((x) => x.maintenanceId === "MNT-0001-029")
console.log(f.map((x) => `${x.fact}|${x.key}|${x.value}|${x.quote.slice(0, 90)}`).join("\n"))
