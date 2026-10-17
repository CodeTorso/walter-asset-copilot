import { z } from "zod"
import type { EvidenceRef, Finding, Row } from "../contracts"

const cell = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const operand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("column"), key: z.string() }),
  z.object({ kind: z.literal("slot"), findingId: z.string(), key: z.string() }),
  z.object({ kind: z.literal("constant"), value: cell, reason: z.string().min(1).max(500) }),
])
export const AnalysisArgs = z.object({
  findingId: z.string(), title: z.string().min(1).max(200),
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("calculate"), output: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/), op: z.enum(["add", "subtract", "multiply", "divide", "elapsed_hours", "elapsed_days"]), left: operand, right: operand, unit: z.string().max(40).optional() }),
    z.object({ kind: z.literal("filter"), key: z.string(), op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "is_null"]), value: operand.optional() }),
    z.object({ kind: z.literal("aggregate"), by: z.array(z.string()).max(5), op: z.enum(["count", "sum", "avg", "median", "min", "max"]), key: z.string().optional() }),
    z.object({ kind: z.literal("join"), rightFindingId: z.string(), keys: z.array(z.object({ left: z.string(), right: z.string() })).min(1).max(5), mode: z.enum(["inner", "left"]), time: z.object({ left: z.string(), right: z.string(), minHours: z.number().finite(), maxHours: z.number().finite() }).optional() }),
  ]),
})
export const InspectArgs = z.object({ findingId: z.string(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20), columns: z.array(z.string()).max(20).optional() })
export type FullRows = { rows: Row[]; rowEvidence: EvidenceRef[][] }
const unique = (refs: EvidenceRef[]) => [...new Map(refs.map(r => [`${r.datasetId}:${r.id}:${r.section ?? ""}`, r])).values()]
const numeric = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
// Require an ISO date, or a timestamp with an explicit timezone. Reject rolled dates and local time.
export function timestamp(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v)) return null
  const day = v.slice(0, 10), t = Date.parse(v)
  if (!Number.isFinite(t) || new Date(Date.parse(day)).toISOString().slice(0, 10) !== day) return null
  return t
}

/** Per-turn store: only findings retrieved by this turn can be inspected or combined. */
export class FindingAnalysis {
  private derived = new Map<string, FullRows>()
  constructor(private findings: Map<string, Finding>, private full: (handle: string) => FullRows | undefined) {}
  private get(id: string) {
    const f = this.findings.get(id)
    if (!f) throw new Error(`Unknown finding ID '${id}'. Available: ${[...this.findings.keys()].join(", ")}`)
    return f
  }
  fullRows(f: Finding): FullRows { return this.derived.get(f.handle) ?? this.full(f.handle) ?? { rows: f.rows, rowEvidence: f.rowEvidence ?? [] } }
  private key(f: Finding, key: string) {
    if (!f.columns.some(c => c.key === key)) throw new Error(`Missing column '${key}' in ${f.id}. Available: ${f.columns.map(c => c.key).join(", ")}. Retrieve a finding with the needed field first.`)
  }
  inspect(raw: z.input<typeof InspectArgs>) {
    const a = InspectArgs.parse(raw), f = this.get(a.findingId), full = this.fullRows(f)
    a.columns?.forEach(k => this.key(f, k))
    const rows = full.rows.slice(a.offset, a.offset + a.limit)
    return { findingId: f.id, totalRows: f.totalRows, availableRows: full.rows.length, offset: a.offset, nextOffset: a.offset + rows.length < full.rows.length ? a.offset + rows.length : null, columns: f.columns, caveats: f.caveats,
      rows: rows.map((r, i) => {
        const refs = full.rowEvidence[a.offset + i] ?? []
        const values = a.columns ? Object.fromEntries(a.columns.map(k => [k, r[k]])) : r
        return { index: a.offset + i, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" && v.length > 2400 ? v.slice(0, 2400) + " [text truncated]" : v])), evidence: refs.slice(0, 12).map(ref => ({ ...ref, quote: ref.quote?.slice(0, 600) })), evidenceCount: refs.length, evidencePreviewOnly: refs.length > 12 }
      }) }
  }
  analyze(raw: z.input<typeof AnalysisArgs>): Finding {
    const a = AnalysisArgs.parse(raw), f = this.get(a.findingId), full = this.fullRows(f), op = a.operation
    if (full.rows.length > 200_000) throw new Error("Analysis input exceeds 200000 rows; narrow the retrieval scope.")
    const inputs = new Map([[f.id, f]])
    const caveats = [...f.caveats]
    let columns = [...f.columns], rows: Row[] = [], ev: EvidenceRef[][] = []
    const evidence = (i: number) => full.rowEvidence[i]?.length ? full.rowEvidence[i]! : f.evidence
    const resolve = (o: z.infer<typeof operand>, row: Row): { value: Row[string]; refs: EvidenceRef[] } => {
      if (o.kind === "column") { this.key(f, o.key); return { value: row[o.key] ?? null, refs: [] } }
      if (o.kind === "constant") { const note = `Supplied constant ${JSON.stringify(o.value)}: ${o.reason}. This is a calculation parameter, not independently verified evidence.`; if (!caveats.includes(note)) caveats.push(note); return { value: o.value, refs: [] } }
      const source = this.get(o.findingId); inputs.set(source.id, source)
      if (!Object.hasOwn(source.slots, o.key)) throw new Error(`Unknown slot '${o.key}' in ${source.id}`)
      return { value: source.slots[o.key]!, refs: source.evidence }
    }
    if (op.kind === "calculate") {
      resolve(op.left, {}); resolve(op.right, {})
      if (columns.some(c => c.key === op.output)) throw new Error("Output column already exists; choose a new name.")
      columns.push({ key: op.output, label: op.output, type: "number", unit: op.op === "elapsed_hours" ? "h" : op.op === "elapsed_days" ? "days" : op.unit })
      let invalid = 0
      full.rows.forEach((r, i) => {
        const l = resolve(op.left, r), rr = resolve(op.right, r)
        let value: number | null = null
        if (op.op.startsWith("elapsed_")) {
          const start = timestamp(l.value), end = timestamp(rr.value)
          if (start !== null && end !== null) value = (end - start) / (op.op === "elapsed_days" ? 86400000 : 3600000)
        } else if (numeric(l.value) && numeric(rr.value)) {
          value = op.op === "add" ? l.value + rr.value : op.op === "subtract" ? l.value - rr.value : op.op === "multiply" ? l.value * rr.value : rr.value === 0 ? null : l.value / rr.value
        }
        if (value === null || !Number.isFinite(value)) { value = null; invalid++ }
        rows.push({ ...r, [op.output]: value }); ev.push(unique([...evidence(i), ...l.refs, ...rr.refs]))
      })
      if (invalid) caveats.push(`${invalid} calculation rows are null because inputs are missing/invalid, division is by zero, or the result is nonfinite.`)
    } else if (op.kind === "filter") {
      this.key(f, op.key)
      if (op.op !== "is_null" && !op.value) throw new Error("Filter requires a comparison value.")
      if (op.value) resolve(op.value, {})
      full.rows.forEach((r, i) => {
        const left = r[op.key] ?? null, right = op.value ? resolve(op.value, r) : { value: null, refs: [] }, v = right.value
        const comparable = (numeric(left) && numeric(v)) || (typeof left === "string" && typeof v === "string")
        const keep = op.op === "is_null" ? left === null : left === null || v === null ? false : op.op === "eq" ? left === v : op.op === "ne" ? left !== v : op.op === "contains" ? typeof left === "string" && typeof v === "string" && left.includes(v) : comparable && (op.op === "gt" ? left > v : op.op === "gte" ? left >= v : op.op === "lt" ? left < v : left <= v)
        if (keep) { rows.push(r); ev.push(unique([...evidence(i), ...right.refs])) }
      })
      caveats.push("Filter excludes unknown values except when is_null is requested; absence of a match does not establish absence of an event.")
    } else if (op.kind === "aggregate") {
      op.by.forEach(k => this.key(f, k))
      if (op.op !== "count") { if (!op.key) throw new Error("Aggregate requires a numeric key."); this.key(f, op.key) }
      const groups = new Map<string, number[]>()
      if (!op.by.length) groups.set("[]", [])
      full.rows.forEach((r, i) => { const k = JSON.stringify(op.by.map(k => r[k] ?? null)); const g = groups.get(k) ?? []; g.push(i); groups.set(k, g) })
      if (op.by.some(k => ["value", "input_count", "valid_count"].includes(k))) throw new Error("Group columns conflict with aggregate output names; use a different grouping.")
      columns = [...op.by.map(k => f.columns.find(c => c.key === k)!), { key: "value", label: `${op.op} ${op.key ?? "rows"}`, type: "number", unit: op.op === "count" ? undefined : f.columns.find(c => c.key === op.key)?.unit }, { key: "input_count", label: "Input rows", type: "number" }, { key: "valid_count", label: "Valid values", type: "number" }]
      for (const [k, indices] of groups) {
        const values = indices.map(i => full.rows[i]![op.key!]).filter(numeric).sort((a, b) => a - b)
        const sum = values.reduce((a, b) => a + b, 0), n = values.length
        const value = op.op === "count" ? indices.length : !n ? null : op.op === "sum" ? sum : op.op === "avg" ? sum / n : op.op === "min" ? values[0]! : op.op === "max" ? values[n - 1]! : (values[Math.floor((n - 1) / 2)]! + values[Math.floor(n / 2)]!) / 2
        rows.push({ ...Object.fromEntries(op.by.map((key, i) => [key, JSON.parse(k)[i]])), value: value !== null && Number.isFinite(value) ? value : null, input_count: indices.length, valid_count: op.op === "count" ? indices.length : n }); ev.push(unique(indices.flatMap(evidence)))
      }
      caveats.push("Aggregates describe retrieved input rows only. Missing/non-numeric values are excluded; input_count and valid_count show coverage. Empty numeric groups are null, not zero.")
    } else {
      const right = this.get(op.rightFindingId), rf = this.fullRows(right); inputs.set(right.id, right)
      if (rf.rows.length > 200_000) throw new Error("Join input exceeds 200000 rows.")
      op.keys.forEach(k => { this.key(f, k.left); this.key(right, k.right) })
      if (op.time) { this.key(f, op.time.left); this.key(right, op.time.right); if (op.time.minHours > op.time.maxHours) throw new Error("Invalid time window") }
      const rightColumns = right.columns.map(c => ({ ...c, key: `right_${c.key}` }))
      if (rightColumns.some(c => columns.some(l => l.key === c.key))) throw new Error("Join column collision.")
      columns.push(...rightColumns)
      const key = (r: Row, side: "left" | "right") => { const vals = op.keys.map(k => r[k[side]]); return vals.some(v => v === null || v === undefined) ? null : JSON.stringify(vals) }
      const index = new Map<string, number[]>()
      rf.rows.forEach((r, i) => { const k = key(r, "right"); if (k !== null) { const g = index.get(k) ?? []; g.push(i); index.set(k, g) } })
      let comparisons = 0, unmatched = 0
      const push = (l: Row, i: number, j?: number) => {
        if (rows.length >= 200_000) throw new Error("Join exceeds 200000 output rows; narrow scope or add matching keys.")
        rows.push({ ...l, ...Object.fromEntries(right.columns.map(c => [`right_${c.key}`, j === undefined ? null : rf.rows[j]![c.key] ?? null])) }); ev.push(unique([...evidence(i), ...(j === undefined ? [] : rf.rowEvidence[j] ?? right.evidence)]))
      }
      full.rows.forEach((l, i) => {
        const k = key(l, "left"); let matched = false
        for (const j of k === null ? [] : index.get(k) ?? []) {
          if (++comparisons > 1_000_000) throw new Error("Join exceeds 1000000 candidate comparisons; add entity keys or narrow scope.")
          if (op.time) { const start = timestamp(l[op.time.left]), end = timestamp(rf.rows[j]![op.time.right]); if (start === null || end === null) continue; const hours = (end - start) / 3600000; if (hours < op.time.minHours || hours > op.time.maxHours) continue }
          matched = true; push(l, i, j)
        }
        if (!matched) { unmatched++; if (op.mode === "left") push(l, i) }
      })
      caveats.push(`Join matched exact keys${op.time ? " and the inclusive time window" : ""}; ${unmatched} left rows have no match. Multiple matches remain separate. A temporal match alone does not prove a response, authorization, or equipment replacement.`)
    }
    for (const source of inputs.values()) {
      if (source.datasetId !== f.datasetId) throw new Error("Cannot combine datasets.")
      caveats.push(...source.caveats)
      const available = this.fullRows(source).rows.length
      if (available < source.totalRows) caveats.push(`INCOMPLETE INPUT ${source.id}: ${available} of ${source.totalRows} rows available. Results are partial, not fleet totals.`)
      if (source.tool === "search_documents") caveats.push("Search coverage is limited by query terms and document retrieval limits; these results do not prove exhaustive event coverage.")
    }
    caveats.push(`Derived from ${[...inputs.keys()].join(", ")}; operation ${JSON.stringify(op)}.`)
    const id = `analysis_${crypto.randomUUID()}`
    const result: Finding = { id, handle: id, datasetId: f.datasetId, asOf: f.asOf, workerId: f.workerId, tool: "analyze_findings", shape: "list", title: a.title, columns, rows: rows.slice(0, 50), rowEvidence: ev.slice(0, 50), totalRows: rows.length, evidence: unique(ev.flat()), slots: rows.length === 1 ? Object.fromEntries(Object.entries(rows[0]!).filter((entry): entry is [string, number] => numeric(entry[1]))) : {}, rulesApplied: [...inputs.values()].flatMap(f => f.rulesApplied), conflicts: [...inputs.values()].flatMap(f => f.conflicts), caveats: [...new Set(caveats)] }
    this.derived.set(id, { rows, rowEvidence: ev }); this.findings.set(id, result)
    return result
  }
}
