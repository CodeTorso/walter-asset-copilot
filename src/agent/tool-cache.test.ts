import { expect, it } from "vitest"
import { ToolCallCache } from "./tool-cache"
import { compact } from "./turn"
import type { Finding } from "../contracts"

it("coalesces parallel duplicate calculations and preserves the original finding ID with repair feedback", async () => {
  const cache = new ToolCallCache(); let calls = 0
  const execute = async () => { calls++; return { findingId: "derived1", value: 0 } }
  const results = await Promise.all(Array.from({ length: 5 }, () => cache.run("analyze", { a: 1, b: 2 }, execute)))
  expect(calls).toBe(1)
  expect(results.every(r => r.findingId === "derived1")).toBe(true)
  expect(results[4]?.error).toContain("makes no progress")
  expect(results[1]?.next).toContain("change the inputs")
  await cache.run("analyze", { b: 2, a: 1 }, execute)
  expect(calls).toBe(1)
  await cache.run("analyze", { a: 2, b: 2 }, execute)
  expect(calls).toBe(2)
})
it("marks previews explicitly and preserves false, zero and null", () => {
  const finding = { id: "f", title: "Rows", tool: "maintenance", rows: Array.from({ length: 11 }, () => ({ complete: false, actual: 0, end: null, note: "" })), columns: [], slots: {}, totalRows: 11, caveats: [], rulesApplied: [], conflicts: [], evidence: [], asOf: "2026-01-01" } as unknown as Finding
  const result = compact(finding)
  expect(result.previewRowCount).toBe(8)
  expect(result.totalRows).toBe(11)
  expect(result.previewOnly).toBe(true)
  expect(result.rows[0]).toEqual({ complete: false, actual: 0, end: null, note: "" })
  expect(result.coverage).toContain("Omitted rows are NOT missing data")
})
