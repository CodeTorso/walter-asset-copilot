import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Finding } from "@/contracts"

const state = vi.hoisted(() => ({
  act: async (_tools: any) => {}, messages: [] as any[], system: "", results: [] as any[],
}))
vi.mock("ai", () => ({
  tool: (spec: any) => spec, stepCountIs: () => () => false,
  streamText: (options: any) => {
    state.messages = options.messages
    state.system = options.system
    return { fullStream: (async function* () {
      await state.act(options.tools)
      yield { type: "text-delta", text: "The requested view is described above." }
    })() }
  },
}))
vi.mock("./openrouter", () => ({ openRouterModel: async () => ({ id: "test", model: {} }) }))
vi.mock("./brief", () => ({ fieldBrief: async () => "" }))
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}) }))
vi.mock("@/server/engine/snapshot", () => ({ getSnapshot: async () => ({ wells: new Map(), areas: new Map(), inspById: new Map(), mntById: new Map(), notesById: new Map(), rows: { regEvents: [] } }) }))
vi.mock("@/server", async () => {
  const { z } = await import("zod")
  const f: Finding = {
    id: "spills", handle: "spills", tool: "spills", workerId: "field", datasetId: "sample", asOf: "2026-10-17",
    shape: "geo", title: "Spill locations", columns: [
      { key: "well", label: "Well", type: "well" },
      { key: "lat", label: "Latitude", type: "number" },
      { key: "lon", label: "Longitude", type: "number" },
    ], rows: [{ well: "W1", lat: 10, lon: 20 }], totalRows: 1,
    slots: {}, evidence: [], conflicts: [], caveats: [], rulesApplied: [],
  }
  return {
    getDatasets: async () => [{ id: "sample", today: "2026-10-17" }],
    getOrCreateUserThread: async () => ({ id: "thread" }),
    getUsers: async () => [], listAreas: async () => [], listWells: async () => [],
    listMessages: async () => [{ role: "assistant", parts: [{ type: "text", text: "Here is the status." }, { type: "finding", title: "SW23 current producing status", tool: "well_status" }] }],
    addMessage: async () => "message", getFullFinding: async () => ({ rows: f.rows, rowEvidence: [[]] }),
    toolSchemas: { spills: z.object({}) }, tools: { spills: async (_ctx: unknown, args: any) => args.groupBy ? { ...f, id: "grouped", handle: "grouped", shape: "list", columns: [
      { key: "area", label: "Area", type: "text" }, { key: "month", label: "Month", type: "text" }, { key: "volume", label: "Volume", type: "number" },
    ], rows: [{ area: "A", month: "October", volume: 4 }] } : f },
  }
})

import { runTurn, type Part } from "./turn"
const run = async (text = "show me a heatmap of something interesting") => {
  const parts: Part[] = []
  await runTurn({ userId: "user", text, emit: p => parts.push(p) })
  return parts.filter(p => p.type === "data-visual" || p.type === "data-surface")
}

describe("turn presentation boundaries", () => {
  beforeEach(() => { state.results = [] })
  it("does not visualize retrieved evidence when the model skips present", async () => {
    state.act = async tools => { await tools.spills.execute({}) }
    expect(await run()).toEqual([])
    expect(state.messages[0].content).toContain("SW23 current producing status")
  })
  it("returns a failed heatmap to the model and emits no fallback pin map", async () => {
    state.act = async tools => {
      await tools.spills.execute({})
      state.results.push(await tools.present.execute({ blocks: [{ type: "visual", findingId: "spills", visual: "heatmap" }] }))
    }
    expect(await run()).toEqual([])
    expect(state.results[0]).toMatchObject({ ok: false })
    expect(state.results[0].viewProblems.join()).toContain("two categorical dimensions")
  })
  it("renders only chosen blocks and permits multiple intentional blocks", async () => {
    state.act = async tools => {
      await tools.spills.execute({})
      await tools.present.execute({ blocks: [
        { type: "visual", blockId: "records", findingId: "spills", visual: "table" },
        { type: "visual", blockId: "locations", findingId: "spills", visual: "map" },
      ] })
    }
    const parts = await run("Show the records and locations")
    expect(parts.filter(p => p.type === "data-visual").map(p => p.data.visual)).toEqual(["table", "map"])
  })
  it("can retrieve missing dimensions after rejection and present the requested heatmap", async () => {
    state.act = async tools => {
      await tools.spills.execute({})
      state.results.push(await tools.present.execute({ blocks: [{ type: "visual", blockId: "answer", findingId: "spills", visual: "heatmap" }] }))
      await tools.spills.execute({ groupBy: "area_month" })
      state.results.push(await tools.present.execute({ blocks: [{ type: "visual", blockId: "answer", findingId: "grouped", visual: "heatmap", view: { rowKey: "area", colKey: "month", valueKeys: ["volume"] } }] }))
    }
    const parts = await run()
    expect(state.results.map(r => r.ok)).toEqual([false, true])
    expect(parts.filter(p => p.type === "data-visual").map(p => p.data.visual)).toEqual(["heatmap"])
  })
  it("honors a prose-only presentation despite retrieved geographic data", async () => {
    state.act = async tools => {
      await tools.spills.execute({})
      await tools.present.execute({ blocks: [] })
    }
    expect(await run()).toEqual([])
  })
})
