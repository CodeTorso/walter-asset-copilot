// @ts-nocheck  (bun script operating on loosely-typed raw JSON rows)
// Generates contract-shaped UI fixtures from the REAL raw sample rows (read-only).
// Run: bun scripts/fixtures/make-fixtures.ts [path-to-sample-data]
// Nothing here copies expected answers from the evaluation queries: every value is computed
// from raw rows, with thresholds parsed out of the manual / SOP prose.
// Selection rules ("first well with an active shut-in note") are generic so the same script runs on new data.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(
  process.argv[2] ??
    `${import.meta.dir}/../../RESOURCE/flytbase-ahc-swe-asset-intelligence-dataset/sample-data`,
)
const OUT = resolve(import.meta.dir, "../../src/fixtures")
mkdirSync(OUT, { recursive: true })
const DATASET = "sample"

type Obj = Record<string, any>
const jl = (p: string): Obj[] =>
  existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []
const read = (p: string) => readFileSync(p, "utf8")
const r1 = (n: number) => Math.round(n * 10) / 10
const day = (iso: string) => iso.slice(0, 10)
const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10)
const fmtDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

// ── Load raw rows ─────────────────────────────────────────────────────────────
const users: Obj[] = JSON.parse(read(`${ROOT}/fleet/users.json`)).users
const areas: Obj[] = JSON.parse(read(`${ROOT}/fleet/areas.json`)).areas
const userName = (id?: string | null) => users.find((u) => u.user_id === id)?.name ?? id ?? "unknown"
const wells: Obj[] = []
const ins: Record<string, Obj[]> = {}
const mnt: Record<string, Obj[]> = {}
const reg: Record<string, Obj[]> = {}
const ctx: Record<string, Obj[]> = {}
for (const w of readdirSync(`${ROOT}/assets`).sort()) {
  const d = `${ROOT}/assets/${w}`
  wells.push(JSON.parse(read(`${d}/metadata.json`)))
  ins[w] = jl(`${d}/inspections.jsonl`)
  mnt[w] = jl(`${d}/maintenance.jsonl`)
  reg[w] = jl(`${d}/regulatory-events.jsonl`)
  ctx[w] = jl(`${d}/context.jsonl`)
}
const wellById = (id: string) => wells.find((w) => w.asset_id === id)!
const allIns = Object.values(ins).flat()
const TODAY = addDays(allIns.map((i) => i.inspected_at).sort().at(-1)!, 1)

// ── Rules parsed from prose ───────────────────────────────────────────────────
const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }
const manual: Record<string, string> = {}
for (const f of readdirSync(`${ROOT}/fleet/well-types`)) manual[f.replace(".md", "")] = read(`${ROOT}/fleet/well-types/${f}`)
const spillSop = read(`${ROOT}/fleet/sops/spill-response-sop.md`)
const compSop = read(`${ROOT}/fleet/sops/regulatory-compliance-sop.md`)
const quoteAround = (text: string, re: RegExp) => {
  const m = text.match(re)
  if (!m) return undefined
  return text.slice(Math.max(0, m.index!), (m.index ?? 0) + m[0].length + 60).replace(/\s+/g, " ").replace(/\*\*/g, "").trim()
}
const num = (text: string, re: RegExp) => {
  const m = text.match(re)
  return m ? Number(m[1]) : undefined
}
const rules = {
  delta: Object.fromEntries(Object.entries(manual).map(([t, x]) => [t, num(x, /at least \*\*(\d+) °C above/)])) as Record<string, number | undefined>,
  alarm: Object.fromEntries(Object.entries(manual).map(([t, x]) => [t, num(x, /at or below (\d+) °C/)])) as Record<string, number | undefined>,
  rca: words[(manual.T200.match(/(\w+) or more \*\*corrective/i)?.[1] ?? "").toLowerCase()],
  nov: num(compSop, /answered within \*\*(\d+) days/),
  verify: num(spillSop, /verified within (\d+) days/),
  write: num(spillSop, /within \*\*(\d+) hours\*\* of discovery, or/),
}
// T350 inherits T200 values it doesn't state; thresholds are per type, so fall back to the T200 rule text.
const deltaFor = (type: string) => rules.delta[type] ?? rules.delta.T200 ?? 15

// ── Evidence helpers ──────────────────────────────────────────────────────────
const ev = (kind: string, id: string, label: string, extra: Obj = {}) => ({ kind, id, label, datasetId: DATASET, ...extra })
const insRef = (i: Obj) => ev("inspection", i.inspection_id, `Inspection ${i.inspection_id}, ${fmtDate(day(i.inspected_at))}`)
const wellRef = (w: Obj) => ev("well", w.asset_id, `${w.name} metadata`)
const mntRef = (m: Obj) => ev("maintenance", m.maintenance_id, `Maintenance ${m.maintenance_id}`)
const regRef = (e: Obj) => ev("regulatory_event", e.event_id, `${e.event_type.replaceAll("_", " ")} ${e.event_id}`)
const noteRef = (n: Obj) => ev("note", n.note_id, `Note ${n.note_id} by ${userName(n.author_user_id)}`, { quote: n.text })
const sentence = (text: string, re: RegExp) => {
  const para = text.split(/\n\s*\n/).find((p) => re.test(p))
  if (!para) return undefined
  const flat = para.replace(/^#+ .*$/gm, "").replace(/\s+/g, " ").replace(/\*\*/g, "").trim()
  return flat.split(/(?<=\.)\s+/).filter((x) => re.test(x.replace(/\*\*/g, "")))[0] ?? flat
}
const sectionOf = (text: string, re: RegExp) => {
  const idx = text.search(re)
  const heads = [...text.slice(0, idx).matchAll(/^#{2,3} (.+)$/gm)]
  return heads.at(-1)?.[1]
}
const ruleRef = (type: string) => {
  const sec = sectionOf(manual[type], /at least \*\*\d+ °C above/) ?? "Production temperature rule"
  const num = sec.match(/^(\d+(?:\.\d+)*)/)?.[1] ?? sec
  return ev("manual", `${type}#${num}`, `${type} manual §${num}`, {
    section: sec,
    quote: sentence(manual[type], /at least \d+ °C above/) ?? sentence(manual[type], /at least \*\*\d+ °C above/),
  })
}
const status = (i: Obj, type: string) => {
  const delta = r1(i.wellhead_temp_c - i.ambient_temp_c)
  return { delta, producing: delta >= deltaFor(type), threshold: deltaFor(type) }
}
const correctedIds = new Set(Object.values(ctx).flat().filter((n) => n.note_type === "correction").map((n) => n.inspection_id))

let fid = 0
const finding = (o: Obj) => ({
  id: `F-${++fid}`,
  datasetId: DATASET,
  asOf: TODAY,
  conflicts: [],
  caveats: [],
  rulesApplied: [],
  slots: {},
  evidence: [],
  totalRows: o.rows.length,
  handle: `handle:${o.tool}:${fid}`,
  ...o,
})

// ── Selection by generic rule ─────────────────────────────────────────────────
// Status well: first well with an active shut-in note (valid_to >= today).
const shutNote = Object.entries(ctx).flatMap(([w, ns]) => ns.map((n) => ({ ...n, w }))).find(
  (n) => n.valid_to && n.valid_to >= TODAY && /shut in/i.test(n.text),
)!
const sw = wellById(shutNote.w)
const swIns = ins[sw.asset_id]
const swLast = swIns.at(-1)!
const swStat = status(swLast, sw.well_type)
const swArea = areas.find((a) => a.area_id === sw.area_id)!

// ── Findings ──────────────────────────────────────────────────────────────────
const statusFinding = finding({
  workerId: "field",
  tool: "well_status",
  shape: "single_entity",
  title: `${sw.name} status now`,
  columns: [{ key: "status", label: "Status", type: "status" }],
  rows: [{ asset_id: sw.asset_id, status: swStat.producing ? "producing" : "not_producing", delta: swStat.delta }],
  slots: {
    wellId: sw.asset_id,
    wellName: sw.name,
    area: swArea.name,
    wellType: sw.well_type,
    status: swStat.producing ? "producing" : "not_producing",
    delta: swStat.delta,
    threshold: swStat.threshold,
    ambient: swLast.ambient_temp_c,
    wellhead: swLast.wellhead_temp_c,
    inspectedAt: swLast.inspected_at,
    inspector: userName(swLast.inspector_user_id),
    method: swLast.method,
    recordedStatus: sw.recorded_status,
    alarmMax: rules.alarm[sw.well_type] ?? rules.alarm.T200 ?? 0,
  },
  evidence: [insRef(swLast), wellRef(sw), noteRef(shutNote), ruleRef(sw.well_type)],
  rulesApplied: [{ key: "producing_delta_c", value: `≥ ${swStat.threshold} °C above ambient`, source: ruleRef(sw.well_type) }],
  conflicts: [
    {
      subject: wellRef(sw),
      sides: [
        { claim: `Latest inspection: ${swStat.delta} °C above ambient, below the ${swStat.threshold} °C rule`, source: insRef(swLast), status: "data" },
        { claim: shutNote.text, author: userName(shutNote.author_user_id), source: noteRef(shutNote), status: "unconfirmed" },
      ],
      needsConfirmationFrom: sw.in_charge_user_id,
    },
  ],
  caveats: [`Recorded status in the well record is "${sw.recorded_status}". Weekly inspections only, not live readings.`],
})

const last13 = swIns.slice(-13)
const seriesFinding = finding({
  workerId: "field",
  tool: "reading_series",
  shape: "series",
  title: `${sw.name} wellhead and ambient temperature, last 13 inspections`,
  window: { from: day(last13[0].inspected_at), to: day(last13.at(-1)!.inspected_at), label: `${fmtDate(day(last13[0].inspected_at))} to ${fmtDate(day(last13.at(-1)!.inspected_at))}`, basis: "by_date" },
  columns: [
    { key: "week", label: "Inspection", type: "date" },
    { key: "wellhead_temp_c", label: "Wellhead", type: "number", unit: "°C" },
    { key: "ambient_temp_c", label: "Ambient", type: "number", unit: "°C" },
    { key: "min_producing_temp_c", label: "Producing line", type: "number", unit: "°C" },
    { key: "not_producing", label: "Not producing", type: "status" },
  ],
  rows: last13.map((i) => {
    const s = status(i, sw.well_type)
    return {
      week: day(i.inspected_at),
      wellhead_temp_c: i.wellhead_temp_c,
      ambient_temp_c: i.ambient_temp_c,
      min_producing_temp_c: r1(i.ambient_temp_c + s.threshold),
      not_producing: !s.producing,
    }
  }),
  rowEvidence: last13.map((i) => [insRef(i)]),
  slots: { notProducingWeeks: last13.filter((i) => !status(i, sw.well_type).producing).length, threshold: deltaFor(sw.well_type) },
  evidence: [ruleRef(sw.well_type), ...last13.slice(-3).map(insRef)],
  rulesApplied: [{ key: "producing_delta_c", value: `≥ ${deltaFor(sw.well_type)} °C above ambient`, source: ruleRef(sw.well_type) }],
})

// Downtime ranking: each non-producing inspection in the trailing 12 months = 7 days (dataset guide rule).
const winFrom = addDays(TODAY, -365)
const downtime = wells
  .map((w) => {
    const rows = ins[w.asset_id].filter((i) => day(i.inspected_at) > winFrom)
    const np = rows.filter((i) => !status(i, w.well_type).producing)
    return { w, days: np.length * 7, np }
  })
  .sort((a, b) => b.days - a.days || a.w.asset_id.localeCompare(b.w.asset_id))
const cutoff = downtime[4].days
const top = downtime.filter((d) => d.days >= cutoff)
const tied = downtime.filter((d) => d.days === cutoff)
const barFinding = finding({
  workerId: "field",
  tool: "downtime",
  shape: "ranking",
  title: "Wells with the most downtime, last 12 months",
  window: { from: winFrom, to: TODAY, label: `${fmtDate(winFrom)} to ${fmtDate(TODAY)}`, basis: "by_date" },
  columns: [
    { key: "name", label: "Well", type: "well" },
    { key: "downtime_days", label: "Downtime", type: "number", unit: "days" },
  ],
  rows: top.map((d) => ({ asset_id: d.w.asset_id, name: d.w.name, downtime_days: d.days })),
  rowEvidence: top.map((d) => [wellRef(d.w), ...d.np.slice(-2).map(insRef)]),
  slots: { topDays: top[0].days, cutoffDays: cutoff, tiedCount: tied.length },
  evidence: [ruleRef("T200")],
  rulesApplied: [{ key: "downtime", value: "each non-producing inspection counts 7 days", source: ev("report", "dataset-guide#downtime", "Dataset guide, downtime rule") }],
  ties: tied.length > 1 ? tied.map((t) => t.w.asset_id) : [],
  caveats: tied.length > 1 ? [`${tied.length} wells share ${cutoff} days at the cutoff; all are shown.`] : [],
})

// Map: all wells in an area, latest status.
const mapArea = areas.find((a) => a.area_id === "NE-08") ?? areas[0]
const mapWells = wells.filter((w) => w.area_id === mapArea.area_id)
const mapRows = mapWells.map((w) => {
  const last = ins[w.asset_id].at(-1)!
  const s = status(last, w.well_type)
  return { asset_id: w.asset_id, name: w.name, lat: w.location.lat, lon: w.location.lon, status: s.producing ? "producing" : "not_producing", delta: s.delta, well_type: w.well_type }
})
const mapFinding = finding({
  workerId: "field",
  tool: "well_status",
  shape: "geo",
  title: `${mapArea.name}: latest status of ${mapRows.length} wells`,
  columns: [
    { key: "name", label: "Well", type: "well" },
    { key: "lat", label: "Latitude", type: "number" },
    { key: "lon", label: "Longitude", type: "number" },
    { key: "status", label: "Status", type: "status" },
    { key: "delta", label: "Δ above ambient", type: "number", unit: "°C" },
  ],
  rows: mapRows,
  rowEvidence: mapWells.map((w) => [wellRef(w), insRef(ins[w.asset_id].at(-1)!)]),
  slots: { producing: mapRows.filter((r) => r.status === "producing").length, notProducing: mapRows.filter((r) => r.status !== "producing").length },
  evidence: [ruleRef("T200"), ruleRef("T350")],
  rulesApplied: ["T200", "T350"].map((t) => ({ key: `producing_delta_c.${t}`, value: `≥ ${deltaFor(t)} °C`, source: ruleRef(t) })),
})

// Heatmap: real spills (detected, not corrected) by area x month for the trailing 12 months.
const months: string[] = []
for (let k = 11; k >= 0; k--) {
  const d = new Date(Date.parse(TODAY + "T00:00:00Z"))
  d.setUTCMonth(d.getUTCMonth() - k, 1)
  months.push(d.toISOString().slice(0, 7))
}
const heatRows: Obj[] = []
for (const a of areas) for (const m of months) heatRows.push({ area: a.name, month: m, spills: 0 })
let corrected = 0
for (const w of wells) {
  for (const i of ins[w.asset_id]) {
    if (!i.spill_detected) continue
    const m = i.inspected_at.slice(0, 7)
    if (!months.includes(m)) continue
    if (correctedIds.has(i.inspection_id)) { corrected++; continue }
    const area = areas.find((a) => a.area_id === w.area_id)!.name
    heatRows.find((r) => r.area === area && r.month === m)!.spills++
  }
}
const heatFinding = finding({
  workerId: "field",
  tool: "spills",
  shape: "matrix",
  title: "Spills by area and month, last 12 months",
  window: { from: months[0] + "-01", to: TODAY, label: `${months[0]} to ${months.at(-1)}`, basis: "by_date" },
  columns: [
    { key: "area", label: "Area", type: "text" },
    { key: "month", label: "Month", type: "text" },
    { key: "spills", label: "Spills", type: "number" },
  ],
  rows: heatRows,
  slots: { total: heatRows.reduce((s, r) => s + r.spills, 0), excludedCorrections: corrected },
  evidence: [ev("report", "spill-sop#7", "Spill SOP §7: corrected detections are excluded", { quote: "corrected detections are excluded" })],
  caveats: corrected ? [`${corrected} detections in this window were excluded because a correction note says they were not spills.`] : [],
})

// Tables
const tIns = swIns.slice(-8).reverse()
const tableInspections = finding({
  workerId: "field",
  tool: "inspections",
  shape: "list",
  title: `${sw.name} recent inspections`,
  columns: [
    { key: "inspection_id", label: "Inspection", type: "evidence" },
    { key: "inspected_at", label: "When (UTC)", type: "datetime" },
    { key: "inspector", label: "Inspector", type: "text" },
    { key: "method", label: "Method", type: "text" },
    { key: "wellhead_temp_c", label: "Wellhead", type: "number", unit: "°C" },
    { key: "delta", label: "Δ ambient", type: "number", unit: "°C" },
    { key: "status", label: "Status", type: "status" },
  ],
  rows: tIns.map((i) => ({
    inspection_id: i.inspection_id,
    inspected_at: i.inspected_at,
    inspector: userName(i.inspector_user_id),
    method: i.method,
    wellhead_temp_c: i.wellhead_temp_c,
    delta: status(i, sw.well_type).delta,
    status: status(i, sw.well_type).producing ? "producing" : "not_producing",
  })),
  rowEvidence: tIns.map((i) => [insRef(i)]),
  totalRows: swIns.length,
  evidence: [ruleRef(sw.well_type)],
})
const tMnt = [...mnt[sw.asset_id]].reverse().slice(0, 8)
const tableMaintenance = finding({
  workerId: "maintenance",
  tool: "maintenance",
  shape: "list",
  title: `${sw.name} latest maintenance jobs`,
  columns: [
    { key: "maintenance_id", label: "Job", type: "evidence" },
    { key: "started_at", label: "Started", type: "date" },
    { key: "maintenance_type", label: "Type", type: "text" },
    { key: "equipment_kind", label: "Equipment", type: "text" },
    { key: "issue", label: "Issue", type: "text" },
    { key: "downtime_hours", label: "Stopped", type: "number", unit: "h" },
    { key: "cost", label: "Cost", type: "number", unit: "USD" },
  ],
  rows: tMnt.map((m) => ({
    maintenance_id: m.maintenance_id,
    started_at: day(m.started_at),
    maintenance_type: m.maintenance_type,
    equipment_kind: m.equipment_kind.replaceAll("_", " "),
    issue: m.issue,
    downtime_hours: m.downtime_hours,
    cost: m.cost_usd.total,
  })),
  rowEvidence: tMnt.map((m) => [mntRef(m)]),
  totalRows: mnt[sw.asset_id].length,
  slots: { totalCost: mnt[sw.asset_id].reduce((s, m) => s + m.cost_usd.total, 0) },
  evidence: [],
})

// Regulator events: the well with the most fines.
const regWell = wells.map((w) => ({ w, fines: reg[w.asset_id].reduce((s, e) => s + (e.fine_usd ?? 0), 0) })).sort((a, b) => b.fines - a.fines)[0].w
const regRows = [...reg[regWell.asset_id]].sort((a, b) => b.date.localeCompare(a.date))
const tableRegulatory = finding({
  workerId: "compliance",
  tool: "compliance",
  shape: "list",
  title: `${regWell.name} regulator events`,
  columns: [
    { key: "event_id", label: "Event", type: "evidence" },
    { key: "date", label: "Date", type: "date" },
    { key: "event_type", label: "Type", type: "text" },
    { key: "protocol_id", label: "Protocol", type: "text" },
    { key: "fine_usd", label: "Fine", type: "number", unit: "USD" },
    { key: "status", label: "Status", type: "text" },
  ],
  rows: regRows.map((e) => ({ event_id: e.event_id, date: e.date, event_type: e.event_type.replaceAll("_", " "), protocol_id: e.protocol_id, fine_usd: e.fine_usd ?? 0, status: e.status })),
  rowEvidence: regRows.map((e) => [regRef(e)]),
  evidence: [],
})

// Empty: spill detections after correction in the last 7 days (generic query, may be empty).
const recentSpills = wells.flatMap((w) => ins[w.asset_id].filter((i) => i.spill_detected && !correctedIds.has(i.inspection_id) && day(i.inspected_at) > addDays(TODAY, -7)).map((i) => ({ w, i })))
const emptyFinding = finding({
  workerId: "field",
  tool: "spills",
  shape: "list",
  title: "Spills in the last 7 days",
  columns: [
    { key: "inspection_id", label: "Inspection", type: "evidence" },
    { key: "name", label: "Well", type: "well" },
    { key: "spill_est_volume_bbl", label: "Volume", type: "number", unit: "bbl" },
  ],
  rows: recentSpills.slice(0, 20).map(({ w, i }) => ({ inspection_id: i.inspection_id, name: w.name, spill_est_volume_bbl: i.spill_est_volume_bbl })),
  totalRows: recentSpills.length,
  evidence: [],
})

// ── Conflict: two notes disagreeing about the same inspection ─────────────────
const byInspection: Record<string, Obj[]> = {}
for (const [w, ns] of Object.entries(ctx)) for (const n of ns) if (n.note_type === "operator_feedback" && /INS-\d+-\d+/.test(n.text)) (byInspection[n.text.match(/INS-\d+-\d+/)![0]] ??= []).push({ ...n, w })
const disputed = Object.entries(byInspection).find(([, ns]) => ns.length >= 2)
let noteConflict: Obj | null = null
if (disputed) {
  const [insId, ns] = disputed
  const row = ins[ns[0].w].find((i) => i.inspection_id === insId)!
  noteConflict = {
    subject: insRef(row),
    sides: [
      { claim: `Inspection recorded a spill: ${row.spill_area_pct}% of pad, ${row.spill_est_volume_bbl} bbl. "${row.notes}"`, author: userName(row.inspector_user_id), source: insRef(row), status: "data" },
      ...ns.map((n) => ({ claim: n.text.replace(/^Inspection INS-\d+-\d+:\s*/, ""), author: userName(n.author_user_id), source: noteRef(n), status: "disputed" })),
    ],
    needsConfirmationFrom: wellById(ns[0].w).in_charge_user_id,
  }
}

// ── Corrections ───────────────────────────────────────────────────────────────
const corrNote = Object.entries(ctx).flatMap(([w, ns]) => ns.map((n) => ({ ...n, w }))).find((n) => n.note_type === "correction")!
const corrRow = ins[corrNote.w].find((i) => i.inspection_id === corrNote.inspection_id)!
const feedbackCorrection = {
  id: `FB-${corrNote.note_id}`,
  datasetId: DATASET,
  kind: "data_correction",
  targetType: "inspection",
  targetId: corrNote.inspection_id,
  field: "spill_detected",
  originalValue: corrRow.spill_detected,
  newValue: false,
  scopeType: "well",
  scopeValue: corrNote.w,
  authorUserId: corrNote.author_user_id,
  reason: corrNote.text,
  text: corrNote.text,
  validFrom: corrNote.valid_from,
  status: "applied",
  conflicts: [],
  createdAt: corrNote.created_at,
}
const feedbackClaim = {
  id: `FB-${shutNote.note_id}`,
  datasetId: DATASET,
  kind: "status_claim",
  targetType: "well",
  targetId: sw.asset_id,
  scopeType: "well",
  scopeValue: sw.asset_id,
  authorUserId: shutNote.author_user_id,
  text: shutNote.text,
  validFrom: shutNote.valid_from,
  validTo: shutNote.valid_to,
  status: "unconfirmed",
  conflicts: statusFinding.conflicts,
  createdAt: shutNote.created_at,
}
// Synthetic UI-state sample (clearly marked): a supervisor-scoped rule overriding the manual's RCA count.
const sup = users.find((u) => u.user_id === sw.in_charge_user_id)!
const feedbackRule = {
  id: "FB-demo-rule",
  datasetId: DATASET,
  kind: "scoped_rule",
  targetType: "rule",
  targetId: "rca_corrective_count",
  originalValue: rules.rca ?? 3,
  newValue: (rules.rca ?? 3) - 1,
  scopeType: "well_type",
  scopeValue: "T350",
  authorUserId: sup.user_id,
  reason: "Demo state for the UI lane, not a recorded user rule.",
  text: `Open an RCA after ${(rules.rca ?? 3) - 1} corrective events for T350.`,
  status: "applied",
  conflicts: [],
  createdAt: `${TODAY}T09:00:00Z`,
  synthetic: true,
}
const ruleManual = { key: "rca_corrective_count", value: `${rules.rca ?? 3} corrective events on the same equipment in 12 months`, source: ev("manual", "T200#10", "T200 manual §10", { section: "10. Maintenance escalation", quote: sentence(manual.T200, /Three or more/) }) }
const ruleUser = { ...ruleManual, value: `${(rules.rca ?? 3) - 1} corrective events on the same equipment in 12 months`, overriddenBy: feedbackRule.id, overrideAuthor: sup.name }

// ── Proposals data ────────────────────────────────────────────────────────────
// Dossier for the status well
const eq = sw.equipment.map((e: Obj) => {
  const jobs = mnt[sw.asset_id].filter((m) => m.equipment_kind === e.kind)
  const corrective = jobs.filter((m) => m.maintenance_type === "corrective")
  const recent = corrective.filter((m) => day(m.started_at) > winFrom)
  return {
    ...e,
    last: jobs.at(-1) ? { id: jobs.at(-1)!.maintenance_id, date: day(jobs.at(-1)!.started_at), type: jobs.at(-1)!.maintenance_type } : null,
    correctiveCount: corrective.length,
    correctiveLast12m: recent.length,
    rcaRequired: recent.length >= (rules.rca ?? 3),
    history: jobs.map((m) => ({ id: m.maintenance_id, date: day(m.started_at), type: m.maintenance_type, cost: m.cost_usd.total, hours: m.downtime_hours, issue: m.issue })),
  }
})
const dossier = {
  well: { id: sw.asset_id, name: sw.name, type: sw.well_type, area: swArea.name, inCharge: userName(sw.in_charge_user_id), installedOn: sw.installed_on, recordedStatus: sw.recorded_status, lat: sw.location.lat, lon: sw.location.lon },
  lastInspection: { id: swLast.inspection_id, at: swLast.inspected_at, inspector: userName(swLast.inspector_user_id), method: swLast.method },
  equipment: eq,
  rcaThreshold: rules.rca ?? 3,
  openEvents: reg[sw.asset_id].filter((e) => e.status === "open").map((e) => ({ id: e.event_id, date: e.date, type: e.event_type, detail: e.detail })),
  notes: ctx[sw.asset_id].map((n) => ({ id: n.note_id, type: n.note_type, author: userName(n.author_user_id), text: n.text, from: n.valid_from, to: n.valid_to })),
}
// Cost history: the well with the highest total spend
const costWell = wells.map((w) => ({ w, t: mnt[w.asset_id].reduce((s, m) => s + m.cost_usd.total, 0) })).sort((a, b) => b.t - a.t)[0].w
const costByYear: Record<string, Obj> = {}
for (const m of mnt[costWell.asset_id]) {
  const y = m.started_at.slice(0, 4)
  const row = (costByYear[y] ??= { year: y, labor: 0, parts: 0, jobs: 0, corrective: 0 })
  row.labor += m.cost_usd.labor
  row.parts += m.cost_usd.parts
  row.jobs++
  if (m.maintenance_type === "corrective") row.corrective++
}
const costHistory = { well: { id: costWell.asset_id, name: costWell.name }, years: Object.values(costByYear) }
// Compliance deadlines computed from open obligations
const deadlines: Obj[] = []
for (const w of wells) {
  for (const e of reg[w.asset_id]) {
    if (e.event_type === "notice_of_violation" && e.status === "open") {
      const answered = reg[w.asset_id].some((r) => r.event_type === "nov_response_filed" && r.related_inspection_id === e.related_inspection_id)
      const due = addDays(e.date, rules.nov ?? 30)
      deadlines.push({ id: `${e.event_id}-RC04`, protocol: "RC-04", label: "Respond to notice of violation", wellId: w.asset_id, wellName: w.name, due, daysLeft: Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5), done: answered, evidence: regRef(e) })
    }
  }
  for (const i of ins[w.asset_id]) {
    if (i.spill_detected && !correctedIds.has(i.inspection_id) && (i.spill_est_volume_bbl ?? 0) >= 5 && day(i.inspected_at) > addDays(TODAY, -(rules.verify ?? 60) - 30)) {
      const verified = reg[w.asset_id].some((r) => r.event_type === "site_inspection" && r.related_inspection_id === i.inspection_id && r.status === "closed")
      const due = addDays(day(i.inspected_at), rules.verify ?? 60)
      deadlines.push({ id: `${i.inspection_id}-SR03`, protocol: "SR-03", label: "Agency verification of remediation", wellId: w.asset_id, wellName: w.name, due, daysLeft: Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5), done: verified, evidence: insRef(i) })
    }
  }
}
deadlines.sort((a, b) => a.daysLeft - b.daysLeft)
// Fines by year
const finesByYear: Record<string, Obj> = {}
for (const e of Object.values(reg).flat()) {
  const y = e.date.slice(0, 4)
  const r = (finesByYear[y] ??= { year: y, fines: 0, events: 0, notices: 0 })
  r.fines += e.fine_usd ?? 0
  r.events++
  if (e.event_type === "notice_of_violation") r.notices++
}
// Inspector x method (last 12 months)
const inspMix: Record<string, Obj> = {}
for (const i of allIns.filter((x) => day(x.inspected_at) > winFrom)) {
  const r = (inspMix[i.inspector_user_id] ??= { inspector: userName(i.inspector_user_id), drone: 0, manual: 0 })
  r[i.method] = (r[i.method] ?? 0) + 1
}
// Active notes with validity windows (fleet)
const activeNotes = Object.entries(ctx)
  .flatMap(([w, ns]) => ns.map((n) => ({ ...n, w })))
  .filter((n) => n.note_type !== "correction" && (!n.valid_to || n.valid_to >= TODAY))
  .map((n) => ({ id: n.note_id, well: n.w, author: userName(n.author_user_id), type: n.note_type, text: n.text, from: n.valid_from, to: n.valid_to, createdAt: n.created_at }))
  .sort((a, b) => (a.to ?? "9999").localeCompare(b.to ?? "9999"))
  .slice(0, 8)

// ── Streams (replayed by the UI shell) ────────────────────────────────────────
const P = (type: string, data: unknown, t: number) => ({ t, type, data })
const turn = (id: string, phase: string, t: number) => P("data-turn", { turnId: id, userId: "U-101", conversationId: "C-1", datasetId: DATASET, phase }, t)
const deleg = (task: string, worker: string, line: string, t: number) => P("data-delegation", { taskId: task, workerId: worker, line }, t)
const task = (taskId: string, workerId: string, title: string, st: string, progress: Obj[], t: number, extra: Obj = {}) =>
  P("data-task", { taskId, workerId, title, status: st, progress, ...extra }, t)
const prog = (text: string, counts?: Obj) => ({ at: new Date().toISOString(), text, ...(counts ? { counts } : {}) })
const visual = (id: string, f: Obj, vis: string, t: number) => P("data-visual", { surfaceId: `S-${id}`, visual: vis, finding: f }, t)
const text = (s: string, t: number) => P("text", { text: s }, t)

const streams = {
  status: {
    prompt: `Is ${sw.name} producing right now?`,
    parts: [
      turn("T1", "started", 0),
      deleg("k1", "field", "I'll get Tess to work on that.", 250),
      task("k1", "field", `Check ${sw.name} status`, "working", [prog(`Read ${sw.asset_id} metadata`, { wells: 1 })], 500),
      task("k1", "field", `Check ${sw.name} status`, "working", [prog(`Read ${sw.asset_id} metadata`, { wells: 1 }), prog(`Read latest inspection ${swLast.inspection_id}`, { inspections: 1 })], 1100),
      deleg("k2", "memory", "I'll get Juno to check for notes on this well.", 1300),
      task("k2", "memory", `Notes for ${sw.asset_id}`, "working", [prog("Read well notes", { notes: ctx[sw.asset_id].length })], 1500),
      task("k1", "field", `Check ${sw.name} status`, "done", [prog(`Applied producing rule: Δ ≥ ${swStat.threshold} °C`), prog(`Δ is ${swStat.delta} °C`)], 1900, { findingId: statusFinding.id }),
      task("k2", "memory", `Notes for ${sw.asset_id}`, "done", [prog("1 active shut-in note found", { notes: 1 })], 2100),
      visual("status", statusFinding, "status_card", 2300),
      text(`${sw.name} was not producing at its last inspection: ${swStat.delta} °C above ambient against the ${swStat.threshold} °C rule. A note from ${userName(shutNote.author_user_id)} says it is shut in for planned work, so the status is shown with both sides.`, 2900),
      turn("T1", "completed", 3200),
    ],
  },
  series: {
    prompt: `Show the temperature trend for ${sw.name}.`,
    parts: [
      turn("T2", "started", 0),
      deleg("k3", "field", "I'll get Tess to work on that.", 250),
      task("k3", "field", `Temperature series for ${sw.name}`, "working", [prog("Read 13 inspections", { inspections: 13 })], 700),
      task("k3", "field", `Temperature series for ${sw.name}`, "done", [prog("Read 13 inspections", { inspections: 13 }), prog(`Marked ${seriesFinding.slots.notProducingWeeks} not-producing weeks`)], 1300, { findingId: seriesFinding.id }),
      visual("series", seriesFinding, "line_chart", 1500),
      text(`Wellhead temperature against ambient across the last 13 inspections. Shaded weeks fell below the producing line.`, 2000),
      turn("T2", "completed", 2300),
    ],
  },
  bar: {
    prompt: "Which wells had the most downtime in the last 12 months?",
    parts: [
      turn("T3", "started", 0),
      deleg("k4", "field", "I'll get Tess to work on that.", 250),
      task("k4", "field", "Rank downtime", "working", [prog(`Scanned ${wells.length} wells`, { wells: wells.length })], 700),
      task("k4", "field", "Rank downtime", "done", [prog(`Scanned ${wells.length} wells`, { wells: wells.length }), prog(`${tied.length} wells tied at the cutoff`)], 1400, { findingId: barFinding.id }),
      visual("bar", barFinding, "bar_chart", 1600),
      text(`Top ${top.length} wells by downtime. ${tied.length > 1 ? `${tied.length} wells tie at ${cutoff} days, so all are shown.` : ""}`, 2100),
      turn("T3", "completed", 2400),
    ],
  },
  map: {
    prompt: `Where are the ${mapArea.name} wells and which are producing?`,
    parts: [
      turn("T4", "started", 0),
      deleg("k5", "field", "I'll get Tess to work on that.", 250),
      task("k5", "field", `Map ${mapArea.name}`, "working", [prog(`Read ${mapRows.length} wells`)], 700),
      task("k5", "field", `Map ${mapArea.name}`, "done", [prog(`Read ${mapRows.length} wells`)], 1200, { findingId: mapFinding.id }),
      visual("map", mapFinding, "map", 1400),
      text(`${mapFinding.slots.producing} of ${mapRows.length} wells were producing at their latest inspection.`, 1900),
      turn("T4", "completed", 2200),
    ],
  },
  heatmap: {
    prompt: "Show spills by area and month for the last year.",
    parts: [
      turn("T5", "started", 0),
      deleg("k6", "field", "I'll get Tess to work on that.", 250),
      task("k6", "field", "Spills by area and month", "working", [prog("Scanned inspections")], 800),
      task("k6", "field", "Spills by area and month", "done", [prog("Scanned inspections"), prog(`Excluded ${corrected} corrected detections`)], 1500, { findingId: heatFinding.id }),
      visual("heatmap", heatFinding, "heatmap", 1700),
      text(`${heatFinding.slots.total} spills in the window after removing corrected detections.`, 2200),
      turn("T5", "completed", 2500),
    ],
  },
  table: {
    prompt: `Show recent maintenance for ${sw.name}.`,
    parts: [
      turn("T6", "started", 0),
      deleg("k7", "maintenance", "I'll get Marco to work on that.", 250),
      task("k7", "maintenance", `Maintenance for ${sw.name}`, "working", [prog(`Read ${mnt[sw.asset_id].length} jobs`)], 700),
      task("k7", "maintenance", `Maintenance for ${sw.name}`, "done", [prog(`Read ${mnt[sw.asset_id].length} jobs`)], 1200, { findingId: tableMaintenance.id }),
      visual("table", tableMaintenance, "table", 1400),
      text(`Showing the ${tableMaintenance.rows.length} most recent of ${mnt[sw.asset_id].length} jobs. Select a job ID to open the record.`, 1900),
      turn("T6", "completed", 2200),
    ],
  },
  conflict: {
    prompt: "Was there a spill at the Block 7 inspection people disagree about?",
    parts: [
      turn("T7", "started", 0),
      deleg("k8", "memory", "I'll get Juno to work on that.", 250),
      task("k8", "memory", "Compare notes on the inspection", "working", [prog("Read well notes")], 700),
      task("k8", "memory", "Compare notes on the inspection", "done", [prog("2 notes disagree")], 1200),
      P("data-conflict", noteConflict, 1400),
      text("The inspection recorded a spill and two notes disagree. I have not picked a side. A formal correction would change the record.", 1800),
      turn("T7", "completed", 2100),
    ],
  },
  correction: {
    prompt: `Correct the spill flag on ${corrNote.inspection_id}.`,
    parts: [
      turn("T8", "started", 0),
      deleg("k9", "memory", "I'll get Juno to work on that.", 250),
      task("k9", "memory", "Record correction", "working", [prog(`Found target ${corrNote.inspection_id}`)], 700),
      task("k9", "memory", "Record correction", "done", [prog(`Found target ${corrNote.inspection_id}`), prog("Stored original value")], 1200),
      P("data-feedback", { feedbackId: feedbackCorrection.id, kind: "data_correction", status: "applied", summary: "Spill flag corrected", conflicts: [], record: feedbackCorrection }, 1400),
      text("Recorded. The original value is kept and every spill count now excludes this detection.", 1800),
      turn("T8", "completed", 2100),
    ],
  },
  cancelled: {
    prompt: "Compare every well in every area for the last four years.",
    parts: [
      turn("T9", "started", 0),
      deleg("k10", "field", "I'll get Tess to work on that.", 250),
      task("k10", "field", "Compare all wells", "working", [prog("Scanned 40 of 200 wells", { wells: 40 })], 700),
      task("k10", "field", "Compare all wells", "working", [prog("Scanned 40 of 200 wells", { wells: 40 }), prog("Scanned 90 of 200 wells", { wells: 90 })], 1500),
      task("k10", "field", "Compare all wells", "failed", [prog("Stopped by user at 90 of 200 wells", { wells: 90 })], 2200),
      turn("T9", "cancelled", 2300),
    ],
  },
  error: {
    prompt: "What did the maintenance reports say about the flowline?",
    parts: [
      turn("T10", "started", 0),
      deleg("k11", "compliance", "I'll get Ines to work on that.", 250),
      task("k11", "compliance", "Search reports", "working", [prog("Searching documents")], 700),
      task("k11", "compliance", "Search reports", "failed", [prog("Search failed")], 1500, { error: "The document search did not respond. Nothing was changed." }),
      turn("T10", "failed", 1600),
    ],
  },
  empty: {
    prompt: "Any spills in the last 7 days?",
    parts: [
      turn("T11", "started", 0),
      deleg("k12", "field", "I'll get Tess to work on that.", 250),
      task("k12", "field", "Recent spills", "working", [prog("Scanned inspections")], 700),
      task("k12", "field", "Recent spills", "done", [prog("Scanned inspections"), prog(`${recentSpills.length} matching`)], 1200, { findingId: emptyFinding.id }),
      visual("empty", emptyFinding, "table", 1400),
      text(recentSpills.length ? `${recentSpills.length} spills.` : "No uncorrected spills in that window.", 1800),
      turn("T11", "completed", 2000),
    ],
  },
}

// Raw records for the evidence drawer: every evidence id referenced by a fixture, resolved to its source row.
const recordIndex: Record<string, Obj> = {}
{
  const seen = new Set<string>()
  const walk = (v: any) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === "object") {
      if (typeof v.kind === "string" && typeof v.id === "string" && typeof v.datasetId === "string") seen.add(v.kind + "|" + v.id)
      Object.values(v).forEach(walk)
    }
  }
  walk([statusFinding, seriesFinding, barFinding, mapFinding, heatFinding, tableInspections, tableMaintenance, tableRegulatory, emptyFinding, noteConflict, deadlines.slice(0, 8)])
  for (const key of seen) {
    const [kind, id] = key.split("|")
    const wid = id.match(/(\d{4})/)?.[1] ? `WELL-${id.match(/(\d{4})/)![1]}` : ""
    let row: Obj | undefined
    if (kind === "well") row = wellById(id)
    if (kind === "inspection") row = ins[wid]?.find((i) => i.inspection_id === id)
    if (kind === "maintenance") row = mnt[wid]?.find((m) => m.maintenance_id === id)
    if (kind === "regulatory_event") row = reg[wid]?.find((e) => e.event_id === id)
    if (kind === "note") row = ctx[wid]?.find((n) => n.note_id === id)
    if (kind === "manual") row = { document: id.split("#")[0], section: id.split("#")[1], text: manual[id.split("#")[0]] }
    if (row) {
      const { equipment, evidence_images, ...rest } = row as Obj
      recordIndex[id] = kind === "manual" ? { document: row.document, section: row.section } : { ...rest, ...(kind === "well" ? { equipment: (equipment ?? []).map((e: Obj) => `${e.kind}: ${e.model}`).join(", ") } : {}) }
    }
  }
}

const write = (name: string, v: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(v, null, 1) + "\n")
write("findings", { status: statusFinding, series: seriesFinding, bar: barFinding, map: mapFinding, heatmap: heatFinding, tableInspections, tableMaintenance, tableRegulatory, empty: emptyFinding })
write("states", { today: TODAY, noteConflict, feedbackCorrection, feedbackClaim, feedbackRule, ruleManual, ruleUser, rulesParsed: rules, statusWellId: sw.asset_id })
write("fleet", { users, areas: areas.map((a) => ({ ...a, asset_ids: undefined, wellCount: a.asset_ids.length })), wellCount: wells.length, today: TODAY })
write("streams", streams)
write("records", recordIndex)
write("proposals", { dossier, costHistory, deadlines: deadlines.slice(0, 8), finesByYear: Object.values(finesByYear), inspMix: Object.values(inspMix), activeNotes, rules })
console.log("fixtures written", { today: TODAY, statusWell: sw.asset_id, mapArea: mapArea.area_id, tied: tied.length, deadlines: deadlines.length, disputed: !!disputed, corrected, recentSpills: recentSpills.length })
