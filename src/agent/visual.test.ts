import { describe, expect, it } from "vitest"
import { Finding, SurfaceMessage } from "@/contracts"
import { pickVisual } from "./visual"
import { applyView, ViewSpec } from "./view"
import { surfaceFromFinding } from "@/lib/surface"

const finding = (extra: Partial<Finding> = {}): Finding => ({
  id: "derived", workerId: "field", tool: "analyze_findings", datasetId: "sample", asOf: "2026-10-17",
  shape: "list", title: "Grouped values", columns: [
    { key: "well", label: "Well", type: "well" },
    { key: "month", label: "Month", type: "date" },
    { key: "value", label: "Value", type: "number" },
  ], rows: [{ well: "W1", month: "2026-10-01", value: 2 }],
  slots: {}, evidence: [], rulesApplied: [], conflicts: [], caveats: [], handle: "derived", totalRows: 1, ...extra,
})

describe("explicit visual selection", () => {
  it("keeps every cell of a 7 by 12 heatmap beyond the table preview limit", () => {
    const rows = Array.from({ length: 84 }, (_, i) => ({ well: `W${Math.floor(i / 12)}`, month: `2026-${String(i % 12 + 1).padStart(2, "0")}`, value: i }))
    const f = finding({ shape: "matrix", rows: rows.slice(0, 50), totalRows: 84 })
    const result = applyView(f, {}, { rows, rowEvidence: rows.map(() => []) })
    expect(result.finding.rows).toHaveLength(84)
    expect(result.finding.rows.at(-1)?.value).toBe(83)
    expect(applyView(f, { rowKey: "well", colKey: "month", valueKeys: ["value"] }, { rows, rowEvidence: [] }).finding.rows).toHaveLength(84)
  })
  it("supports derived list heatmaps with two categorical dimensions and a measure", () => {
    const f = finding()
    expect(pickVisual("show something interesting", "heatmap", f)).toBe("heatmap")
    const messages = surfaceFromFinding(f, { surfaceId: "s", visual: "heatmap" })
    for (const message of messages) expect(SurfaceMessage.safeParse(message).success).toBe(true)
    const update = messages.find(m => "updateComponents" in m)!
    if (!("updateComponents" in update)) throw new Error("No component update")
    expect(update.updateComponents.components.find(c => c.id === "main")).toMatchObject({
      component: "Heatmap", props: { rowKey: "well", colKey: "month", valueKey: "value" },
    })
  })
  it("returns incompatible heatmaps for repair instead of falling back to a map", () => {
    const f = finding({ shape: "geo", columns: [
      { key: "well", label: "Well", type: "well" },
      { key: "lat", label: "Latitude", type: "number" },
      { key: "lon", label: "Longitude", type: "number" },
    ] })
    expect(pickVisual("heatmap", "heatmap", f)).toBeUndefined()
    expect(pickVisual("heat map", undefined, f)).toBeUndefined()
    expect(pickVisual("show locations", "map", f)).toBe("map")
  })
  it("lets the agent choose a table from the offered formats", () => {
    expect(pickVisual("Show this as a bar chart or a table", "table", finding())).toBe("table")
    expect(pickVisual("Show this as a bar chart or a table", undefined, finding({ columns: [{ key: "status", label: "Status", type: "status" }] }))).toBe("table")
    expect(pickVisual("Show this", "text", finding())).toBe("text")
  })
  it("does not mistake coordinates or rank for a chart measure", () => {
    expect(pickVisual("bar chart", "bar_chart", finding({ columns: [{ key: "rank", label: "Rank", type: "number" }] }))).toBeUndefined()
  })
  it("carries explicit heatmap dimensions through the validated wire contract", () => {
    const f = finding({ columns: [{ key: "area", label: "Area", type: "text" }, ...finding().columns] })
    const spec = ViewSpec.parse({ rowKey: "month", colKey: "well", valueKeys: ["value"] })
    const result = applyView(f, spec)
    expect(result.notes).toEqual([])
    const wire = Finding.parse(result.finding)
    const update = surfaceFromFinding(wire, { surfaceId: "s", visual: "heatmap" }).find(m => "updateComponents" in m)!
    if (!("updateComponents" in update)) throw new Error("No components")
    expect(update.updateComponents.components[0]?.props).toMatchObject({ rowKey: "month", colKey: "well", valueKey: "value" })
    expect(applyView(f, { rowKey: "well", colKey: "well" }).notes.join()).toContain("distinct categorical")
    expect(applyView(f, { rowKey: "value", colKey: "well" }).notes.join()).toContain("distinct categorical")
    expect(applyView(f, { labelKey: "well", colKey: "month", valueKeys: ["value"] }).notes).toEqual([])
  })
})
