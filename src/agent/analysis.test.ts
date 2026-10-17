import { describe, expect, it } from "vitest"
import { Finding, type EvidenceRef } from "../contracts"
import { FindingAnalysis, timestamp, type FullRows } from "./analysis"

const ref = (id: string): EvidenceRef => ({ id, kind: "maintenance", label: id, datasetId: "sample" })
const base = (extra: Partial<Finding> = {}): Finding => ({ id: "f", handle: "f", datasetId: "sample", asOf: "2027-01-15", workerId: "maintenance", tool: "maintenance", shape: "list", title: "Jobs", columns: [{ key: "well", label: "Well", type: "well" }, { key: "area", label: "Area", type: "text" }, { key: "actual", label: "Actual", type: "number", unit: "days" }, { key: "planned", label: "Planned", type: "number", unit: "days" }, { key: "start", label: "Start", type: "datetime" }, { key: "end", label: "End", type: "datetime" }], rows: [{ well: "W1", area: "A", actual: 0, planned: 2, start: "2026-01-01T00:00:00Z", end: "2026-01-01T08:30:00Z" }, { well: "W2", area: "A", actual: 4, planned: 0, start: "2026-01-01", end: null }, { well: "W3", area: "B", actual: null, planned: 2, start: "2026-02-30", end: "2026-03-01" }], rowEvidence: [[ref("M1")], [ref("M2")], [ref("M3")]], evidence: [ref("M1"), ref("M2"), ref("M3")], slots: { threshold: 2 }, rulesApplied: [], conflicts: [], caveats: [], totalRows: 3, ...extra })
const setup = (f = base(), full?: FullRows) => { const findings = new Map([[f.id, f]]); return { findings, analysis: new FindingAnalysis(findings, () => full) } }
const col = (key: string) => ({ kind: "column" as const, key })

describe("grounded analysis", () => {
  it("preserves zero, precision and signed arithmetic, with row provenance", () => {
    const { analysis } = setup()
    const result = analysis.analyze({ findingId: "f", title: "Extra days", operation: { kind: "calculate", output: "extra", op: "subtract", left: col("actual"), right: col("planned"), unit: "days" } })
    expect(result.rows.map(r => r.extra)).toEqual([-2, 4, null])
    expect(result.rowEvidence?.[0]?.map(r => r.id)).toEqual(["M1"])
    expect(result.caveats.join(" ")).toContain('"op":"subtract"')
    expect(Finding.safeParse(result).success).toBe(true)
  })
  it("does not turn null or zero division into numeric answers", () => {
    const { analysis } = setup()
    const result = analysis.analyze({ findingId: "f", title: "Ratio", operation: { kind: "calculate", output: "ratio", op: "divide", left: col("actual"), right: col("planned") } })
    expect(result.rows.map(r => r.ratio)).toEqual([0, null, null])
    expect(result.caveats.join(" ")).toContain("2 calculation rows are null")
  })
  it("calculates fractional UTC elapsed hours and rejects missing/rolled/local dates", () => {
    const { analysis } = setup()
    const result = analysis.analyze({ findingId: "f", title: "Elapsed", operation: { kind: "calculate", output: "hours", op: "elapsed_hours", left: col("start"), right: col("end") } })
    expect(result.rows.map(r => r.hours)).toEqual([8.5, null, null])
    expect(timestamp("2026-01-01T12:00:00")).toBeNull()
    expect(timestamp("2026-02-30")).toBeNull()
    expect(timestamp("2026-01-01T05:30:00+05:30")).toBe(timestamp("2026-01-01T00:00:00Z"))
  })
  it("uses full cached inputs beyond preview, supports median and chaining", () => {
    const f = base(), full = { rows: [...f.rows, { ...f.rows[0]!, actual: 8 }], rowEvidence: [...f.rowEvidence!, [ref("M4")]] }
    const { analysis } = setup({ ...f, rows: f.rows.slice(0, 1), totalRows: 4 }, full)
    const result = analysis.analyze({ findingId: "f", title: "Median", operation: { kind: "aggregate", by: ["area"], op: "median", key: "actual" } })
    expect(result.rows).toEqual([{ area: "A", value: 4, input_count: 3, valid_count: 3 }, { area: "B", value: null, input_count: 1, valid_count: 0 }])
    expect(result.rowEvidence?.[0]?.map(r => r.id)).toEqual(["M1", "M2", "M4"])
    const filtered = analysis.analyze({ findingId: result.id, title: "Known medians", operation: { kind: "filter", key: "value", op: "gte", value: { kind: "constant", value: 0, reason: "Select nonnegative values" } } })
    expect(filtered.rows).toHaveLength(1)
    expect(filtered.caveats.join(" ")).toContain("not independently verified")
  })
  it("supports count, sum, avg and even-sized median, distinguishing empty inputs", () => {
    for (const [op, value] of [["count", 3], ["sum", 4], ["avg", 2], ["median", 2]] as const) {
      const { analysis } = setup()
      const result = analysis.analyze({ findingId: "f", title: op, operation: { kind: "aggregate", by: [], op, key: "actual" } })
      expect(result.rows[0]?.value).toBe(value)
    }
    const { analysis } = setup(base({ rows: [], totalRows: 0 }))
    expect(analysis.analyze({ findingId: "f", title: "Empty sum", operation: { kind: "aggregate", by: [], op: "sum", key: "actual" } }).rows[0]?.value).toBeNull()
    expect(analysis.analyze({ findingId: "f", title: "Empty count", operation: { kind: "aggregate", by: [], op: "count" } }).rows[0]?.value).toBe(0)
  })
  it("carries slot evidence and flags incomplete/search coverage", () => {
    const { analysis, findings } = setup(base({ totalRows: 30, tool: "search_documents" }))
    findings.set("rule", base({ id: "rule", handle: "rule", evidence: [ref("RULE")], slots: { limit: 2 } }))
    const result = analysis.analyze({ findingId: "f", title: "Rule ratio", operation: { kind: "calculate", output: "ratio", op: "divide", left: col("actual"), right: { kind: "slot", findingId: "rule", key: "limit" } } })
    expect(result.rowEvidence?.[1]?.map(r => r.id)).toEqual(["M2", "RULE"])
    expect(result.caveats.join(" ")).toContain("INCOMPLETE INPUT f: 3 of 30")
    expect(result.caveats.join(" ")).toContain("do not prove exhaustive")
  })
  it("rejects unknown finding IDs/columns/slots instead of fabricating inputs", () => {
    const { analysis } = setup()
    expect(() => analysis.inspect({ findingId: "outside" })).toThrow("Unknown finding ID")
    expect(() => analysis.inspect({ findingId: "f", columns: ["pressure"] })).toThrow("Retrieve a finding")
    expect(() => analysis.analyze({ findingId: "f", title: "Bad", operation: { kind: "calculate", output: "x", op: "add", left: col("actual"), right: { kind: "slot", findingId: "f", key: "missing" } } })).toThrow("Unknown slot")
  })
  it("pages beyond eight rows without changing findings", () => {
    const f = base(), rows = Array.from({ length: 75 }, (_, actual) => ({ ...f.rows[0]!, actual }))
    const { analysis } = setup({ ...f, rows: rows.slice(0, 8), totalRows: 75 }, { rows, rowEvidence: rows.map((_, i) => [ref(`M${i}`)]) })
    const page = analysis.inspect({ findingId: "f", offset: 60, limit: 10, columns: ["actual"] })
    expect(page.rows[0]?.values).toEqual({ actual: 60 })
    expect(page.nextOffset).toBe(70)
    expect(analysis.inspect({ findingId: "f", offset: 70 }).nextOffset).toBeNull()
    expect(() => analysis.inspect({ findingId: "f", limit: 51 })).toThrow()
  })
  it("joins by entity and inclusive time window with both sources and unmatched rows", () => {
    const { analysis, findings } = setup()
    findings.set("r", base({ id: "r", handle: "r", rows: [{ well: "W1", start: "2026-01-01T08:30:00Z" }, { well: "W1", start: "2026-01-02T00:00:00Z" }, { well: null, start: "2026-01-01" }], rowEvidence: [[ref("R1")], [ref("R2")], [ref("R3")]] }))
    const result = analysis.analyze({ findingId: "f", title: "Responses", operation: { kind: "join", rightFindingId: "r", mode: "left", keys: [{ left: "well", right: "well" }], time: { left: "start", right: "start", minHours: 0, maxHours: 8.5 } } })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]?.right_start).toBe("2026-01-01T08:30:00Z")
    expect(result.rows[1]?.right_start).toBeNull()
    expect(result.rowEvidence?.[0]?.map(r => r.id)).toEqual(["M1", "R1"])
    expect(result.caveats.join(" ")).toContain("does not prove a response")
  })
})
