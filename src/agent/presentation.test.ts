import { describe, expect, it } from "vitest"
import { PresentationRegistry, turnLimits } from "./presentation"
import { applySurfaceMessage, surfaceFromFinding, type Surface } from "../lib/surface"
import type { Finding } from "../contracts"

describe("incremental presentation", () => {
  it("deduplicates repeat calls and revises one stable surface after further retrieval", () => {
    const registry = new PresentationRegistry("turn"), first = registry.claim("answer", { findingId: "one" })
    expect(first.created).toBe(true)
    expect(registry.claim("answer", { findingId: "one" }).duplicate).toBe(true)
    const next = registry.claim("answer", { findingId: "two" })
    expect(next.surfaceId).toBe(first.surfaceId)
    expect(next.created).toBe(false)
    expect(next.duplicate).toBe(false)
    const f = (id: string, value: number): Finding => ({ id, handle: id, workerId: "field", datasetId: "sample", asOf: "2026-01-01", tool: "analyze_findings", shape: "list", title: "Answer", columns: [{ key: "value", label: "Value", type: "number" }], rows: [{ value }], slots: {}, totalRows: 1, evidence: [], conflicts: [], caveats: [], rulesApplied: [] })
    let surfaces: Record<string, Surface> = {}
    for (const [claim, finding] of [[first, f("one", 1)], [next, f("two", 2)]] as const) {
      for (const message of surfaceFromFinding(finding, { surfaceId: claim.surfaceId, visual: "table" })) surfaces = applySurfaceMessage(surfaces, message)
    }
    expect(Object.keys(surfaces)).toEqual([first.surfaceId])
    expect(JSON.stringify(surfaces)).toContain('"value":2')
    expect(registry.claim("another", {}).surfaceId).not.toBe(first.surfaceId)
  })
  it("bounds new surfaces but allows revisions", () => {
    const registry = new PresentationRegistry("t")
    for (let i = 0; i < 40; i++) registry.claim(String(i), {})
    expect(() => registry.claim("extra", {})).toThrow("revise an existing")
    expect(registry.claim("0", { changed: true }).created).toBe(false)
  })
  it("bounds configurable runaway limits and rejects invalid env values", () => {
    expect(turnLimits({})).toEqual({ steps: 24, calls: 64, durationMs: 240000 })
    expect(turnLimits({ WALTER_MAX_STEPS: "40", WALTER_MAX_TOOL_CALLS: "100", WALTER_MAX_TURN_MS: "300000" })).toEqual({ steps: 40, calls: 100, durationMs: 300000 })
    expect(turnLimits({ WALTER_MAX_STEPS: "9999", WALTER_MAX_TOOL_CALLS: "NaN", WALTER_MAX_TURN_MS: "-1" })).toEqual(turnLimits({}))
  })
})

it("stops a single unfinished stream at the emitted-call cap", async () => {
  const { StreamCallBudget } = await import("./presentation")
  const budget = new StreamCallBudget(64)
  for (let i = 0; i < 64; i++) expect(budget.observe()).toBeNull()
  expect(budget.observe()).toContain("budget of 64 calls")
  expect(budget.observe()).toContain("budget of 64 calls")
})
