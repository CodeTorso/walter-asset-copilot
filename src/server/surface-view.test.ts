import { describe, expect, it } from "vitest"
import { Finding, SurfaceMessage } from "../contracts"
import { applyView } from "../agent/view"
import { applySurfaceMessage, resolvePointer, setPointer, surfaceFromFinding, type Surface } from "../lib/surface"

const finding = (extra: Partial<Finding> = {}): Finding => ({
  id: "f", workerId: "maintenance", tool: "maintenance", datasetId: "sample", asOf: "2026-10-17",
  shape: "list", title: "Maintenance costs", columns: [{ key: "area", label: "Area", type: "text" }, { key: "cost", label: "Cost", type: "number", unit: "USD" }],
  rows: [{ area: "A", cost: 1 }, { area: "A", cost: null }, { area: "B", cost: null }],
  slots: {}, evidence: [], rulesApplied: [], conflicts: [], caveats: [], handle: "full", totalRows: 3, ...extra,
})
const surface = (f: Finding, visual: Parameters<typeof surfaceFromFinding>[1]["visual"], spec?: Parameters<typeof surfaceFromFinding>[1]["spec"]) => {
  const messages = surfaceFromFinding(f, { surfaceId: "s", visual, spec })
  messages.forEach((m) => expect(SurfaceMessage.safeParse(m).success).toBe(true))
  return messages.reduce<Record<string, Surface>>(applySurfaceMessage, {}).s!
}

describe("view computations", () => {
  it("preserves descriptive document rows when the model asks to count search hits", () => {
    const f = finding({ tool: "search_documents" })
    const result = applyView(f, { aggregate: { by: "area", op: "count" } })
    expect(result.finding.rows).toEqual(f.rows)
    expect(result.notes.join(" ")).toContain("discard the answer fields")
  })
  it.each(["avg", "sum", "min", "max"] as const)("%s ignores missing values and leaves empty groups null", (op) => {
    const { finding: result } = applyView(finding(), { aggregate: { by: "area", op, valueKey: "cost" } })
    expect(result.rows).toEqual([{ area: "A", count: 2, [`${op}_cost`]: 1 }, { area: "B", count: 1, [`${op}_cost`]: null }])
    expect(Finding.safeParse(result).success).toBe(true)
  })
  it("preserves precision and computes over the full set before limiting", () => {
    const f = finding({ rows: [{ area: "A", cost: 0.001 }], totalRows: 3 })
    const result = applyView(f, { aggregate: { by: "area", op: "sum", valueKey: "cost" }, limit: 1 }, {
      rows: [{ area: "A", cost: 0.001 }, { area: "A", cost: 0.002 }, { area: "B", cost: 2 }], rowEvidence: [],
    }).finding
    expect(result.rows[0]!.sum_cost).toBe(0.003)
    expect(result.totalRows).toBe(2)
  })
  it("refuses to aggregate a truncated finding", () => {
    const f = finding({ totalRows: 100 })
    const result = applyView(f, { aggregate: { by: "area", op: "sum", valueKey: "cost" } })
    expect(result.finding.rows).toEqual(f.rows)
    expect(result.notes.join(" ")).toContain("all source rows")
  })
  it("does not overwrite a grouping column named count", () => {
    const f = finding({ columns: [{ key: "count", label: "Count", type: "number" }], rows: [{ count: 7 }, { count: 7 }], totalRows: 2 })
    const result = applyView(f, { aggregate: { by: "count", op: "count" } }).finding
    expect(result.rows).toEqual([{ count: "7", row_count: 2 }])
    expect(new Set(result.columns.map((c) => c.key)).size).toBe(result.columns.length)
  })
  it("rejects invalid runtime specifications without altering the finding", () => {
    const f = finding()
    expect(applyView(f, { limit: -1 }).finding).toBe(f)
  })
  it("orders columns without duplication or losing unselected fields", () => {
    const result = applyView(finding(), { labelKey: "cost", valueKeys: ["cost", "cost"] }).finding
    expect(result.columns.map((c) => c.key)).toEqual(["cost", "area"])
  })
  it("keeps row evidence aligned after sorting", () => {
    const ref = { kind: "maintenance" as const, id: "m1", datasetId: "sample", label: "Job" }
    const f = finding({ rows: [{ area: "A", cost: 1 }, { area: "B", cost: 2 }], totalRows: 2, rowEvidence: [[ref], []] })
    const result = applyView(f, { valueKeys: ["cost"], sort: "value_desc" }).finding
    expect(result.rowEvidence).toEqual([[], [ref]])
  })
  it("keeps null values last and includes ties at an explicit top-N boundary", () => {
    const f = finding({ rows: [{ area: "A", cost: null }, { area: "B", cost: -1 }, { area: "C", cost: -1 }, { area: "D", cost: -2 }], totalRows: 4 })
    const result = applyView(f, { valueKeys: ["cost"], sort: "value_desc", limit: 1 }).finding
    expect(result.rows.map((r) => r.area)).toEqual(["B", "C"])
  })
  it("does not turn every aggregate into a ranked-chart default", () => {
    expect(applyView(finding(), { aggregate: { by: "area", op: "count" } }).finding.shape).toBe("list")
  })
})

describe("surface semantics and boundaries", () => {
  it("uses one compact text block while retaining every field", () => {
    const f = finding({ rows: [{ area: "A", cost: null }], totalRows: 1 })
    const s = surface(f, "text")
    expect(s.components.main!.component).toBe("KeyValue")
    expect(s.data.textItems).toEqual([{ label: "Area", value: "A", cite: [] }, { label: "Cost (USD)", value: "Not recorded", cite: [] }])
    expect(s.data.finding).toBe(f)
  })
  it("keeps multi-row text results in a table", () => {
    expect(surface(finding(), "text").components.main!.component).toBe("DataTable")
  })
  it("falls back from charts without compatible columns", () => {
    const f = finding({ columns: [{ key: "area", label: "Area", type: "text" }] })
    for (const visual of ["bar_chart", "line_chart", "heatmap", "map"] as const) expect(surface(f, visual).components.main!.component).toBe("DataTable")
  })
  it("does not plot rank, coordinates or limits as default line series", () => {
    const f = finding({ columns: [
      { key: "date", label: "Date", type: "date" },
      ...["rank", "lat", "limit", "cost"].map((key) => ({ key, label: key, type: "number" as const })),
    ] })
    const s = surface(f, "line_chart", { series: ["invented"] })
    expect(s.components.main!.props.series).toEqual(["cost"])
  })
  it("uses a table when a line has no independent series", () => {
    expect(surface(finding({ columns: [{ key: "cost", label: "Cost", type: "number" }] }), "line_chart").components.main!.component).toBe("DataTable")
  })
  it("blocks inherited/prototype paths and preserves immutable normal updates", () => {
    const root = { nested: { value: 1 } }
    expect(setPointer(root, "/__proto__/polluted", true)).toBe(root)
    expect(resolvePointer(root, "/constructor")).toBeUndefined()
    expect(resolvePointer(root, "nested/value")).toBeUndefined()
    expect(setPointer(root, "/nested/value", 2)).toEqual({ nested: { value: 2 } })
    expect(root.nested.value).toBe(1)
  })
})
