/// <reference types="node" />
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { Finding } from "../../contracts"
import { ensureSchema, openPglite, setDb, type Db } from "../db/client"
import { parseDataset } from "../ingest/parse"
import type { DatasetRows } from "../ingest/types"
import { readSnapshotRows, writeDataset } from "../ingest/write"
import { getUsers, resetFeedbackAndMemory, tools, type ToolCtx } from "../index"
import { downtimeDays, latestProducing, loadRaw, openRepairs, rcaWells, realSpills, repairCost, spillGrid, type Raw } from "../oracle/oracle"
import { buildSnapshot, clearSnapshotCache } from "./snapshot"
import { Domain } from "./domain"

const ROOT = "RESOURCE/flytbase-ahc-swe-asset-intelligence-dataset/sample-data"
const TH = { T200: 15, T350: 20 }
let db: Db
let rows: DatasetRows
let raw: Raw
const U: Record<string, string> = {}

const ctx = (name: string, extra: Partial<ToolCtx> = {}): ToolCtx => ({ datasetId: "sample", userId: U[name], ...extra })
const wellsOf = (f: Finding) => f.rows.map((r) => String(r.well))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  db = await openPglite("memory://engine-test")
  setDb(db)
  await ensureSchema(db)
  rows = await parseDataset(ROOT, { datasetId: "sample" })
  await writeDataset(db, rows)
  raw = loadRaw(ROOT)
  for (const u of await getUsers("sample")) U[u.name] = u.userId
})

afterAll(async () => {
  await db.close()
})

describe("ingest and registry", () => {
  it("loads the sample with today = latest inspection + 1 day", async () => {
    const snap = await readSnapshotRows(db, "sample")
    expect(snap.meta.today).toBe("2026-10-16")
    expect(snap.wells).toHaveLength(200)
    expect(snap.inspections).toHaveLength(39567)
  })

  it("is idempotent and bumps the version", async () => {
    const r = await writeDataset(db, rows)
    expect(r.version).toBe(2)
    const n = await db.rows<{ n: string }>(sql`select count(*)::text as n from wells where dataset_id = 'sample'`)
    expect(n[0]!.n).toBe("200")
  })

  it("extracts rules with sections and verbatim quotes", () => {
    const t200 = rows.rules.find((r) => r.key === "producing_delta_c" && r.wellType === "T200")!
    expect(t200.num).toBe(15)
    expect(t200.section).toBe("9.3")
    const manual = rows.documents.find((d) => d.docId === "T200")!
    const text = manual.sections.map((s) => s.text).join("\n")
    expect(text).toContain(t200.quote!)
    expect(rows.rules.find((r) => r.key === "producing_delta_c" && r.wellType === "T350")!.num).toBe(20)
    expect(rows.rules.filter((r) => r.status === "missing")).toHaveLength(0)
    expect(rows.rules.find((r) => r.key === "sr03_days")!.num).toBe(60)
  })

  it("full-text search finds manual sections", async () => {
    const f = await tools.search_documents({ datasetId: "sample" }, { query: "root-cause analysis corrective", kinds: ["manual"], limit: 3 })
    expect(f.rows.length).toBeGreaterThan(0)
    expect(f.evidence[0]!.section).toBeTruthy()
  })

  it("searches fleet notes with original note evidence", async () => {
    const f = await tools.search_documents({ datasetId: "sample" }, { query: "pump OR shut", kinds: ["note"], limit: 100 })
    expect(f.rows.length).toBeGreaterThan(0)
    expect(f.rows.every((r) => r.well && r.date && r.snippet)).toBe(true)
    expect(f.rowEvidence?.every((refs) => refs[0]?.kind === "note")).toBe(true)
  })

  it("retrieves document excerpts for a plain-language question with unmatched terms", async () => {
    const f = await tools.search_documents({ datasetId: "sample" }, { query: "Explain the corrective repairs escalation requirements please", kinds: ["manual"], limit: 3 })
    expect(f.rows.length).toBeGreaterThan(0)
    expect(f.rows.every((r) => r.kind === "manual")).toBe(true)
    expect(f.caveats.join(" ")).toContain("some of the terms")
    expect(f.evidence.every((e) => e.datasetId === "sample" && e.quote)).toBe(true)
  })

  it("loads a second dataset alongside with overlapping IDs", async () => {
    const copy = structuredClone(rows)
    copy.meta.id = "second"
    await writeDataset(db, copy)
    const a = await tools.well_status({ datasetId: "sample" }, { scope: { wellIds: ["WELL-0001"] } })
    const b = await tools.well_status({ datasetId: "second" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(a.rows[0]!.status).toBe(b.rows[0]!.status)
    expect(a.datasetId).toBe("sample")
    expect(b.datasetId).toBe("second")
  })
})

describe("server entry", () => {
  it("lists datasets, users, wells and areas", async () => {
    const { getDatasets, listWells, listAreas } = await import("../index")
    expect((await getDatasets()).map((d) => d.id)).toContain("sample")
    expect(Object.keys(U)).toContain("Michael Turner")
    const ws = await listWells("sample", { areaName: "NE-08" })
    expect(ws).toHaveLength(50)
    expect(ws.filter((w) => w.producing === false).map((w) => w.wellId)).toEqual(["WELL-0164", "WELL-0170", "WELL-0172", "WELL-0175"])
    expect((await listAreas("sample")).length).toBe(4)
  })

  it("accepts team scopes and loose well references", async () => {
    const { listWells, tools: t } = await import("../index")
    expect((await listWells("sample", { areaName: "TEAM-NE" })).length).toBe(100)
    const f = await t.well_status({ datasetId: "sample" }, { scope: { wellIds: ["well 1"] } })
    expect(f.rows[0]!.well).toBe("WELL-0001")
    await expect(t.well_status({ datasetId: "sample" }, { scope: { areaName: "Nowhere Block" } })).rejects.toThrow(/Unknown area/)
  })

  it("keeps one continuous thread per user", async () => {
    const { getOrCreateUserThread, addMessage, listMessages } = await import("../index")
    const a = await getOrCreateUserThread("sample", U["Michael Turner"]!)
    const b = await getOrCreateUserThread("sample", U["Michael Turner"]!)
    const c = await getOrCreateUserThread("sample", U["Jessica Reed"]!)
    expect(a.id).toBe(b.id)
    expect(c.id).not.toBe(a.id)
    await addMessage(a.id, "user", [{ type: "text", text: "hello" }])
    expect(await listMessages(a.id)).toHaveLength(1)
    expect(await listMessages(c.id)).toHaveLength(0)
  })
})

describe("Part A1 facts (Q1-Q10)", () => {
  it("Q1 WELL-0001 is not producing, 3.2 degrees, stale recorded status", async () => {
    const f = await tools.well_status(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0001"] } })
    const r = f.rows[0]!
    expect(r.status).toBe("not producing")
    expect(r.delta_c).toBe(3.2)
    expect(r.inspection).toBe("INS-0001-0203")
    expect(r.inspected_by).toBe("Ryan Brooks")
    expect(r.method).toBe("drone")
    expect(r.recorded_status).toBe("active")
    expect(r.recorded_status_out_of_date).toBe(true)
    expect(String(r.reason)).toContain("CTX-0001-003")
    expect(f.rulesApplied[0]!.source.section).toBe("9.3")
  })

  it("Q2 four NE-08 wells with deltas and reasons", async () => {
    const f = await tools.well_status(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 8" }, onlyNotProducing: true })
    expect(wellsOf(f)).toEqual(["WELL-0164", "WELL-0170", "WELL-0172", "WELL-0175"])
    expect(f.rows.map((r) => r.delta_c)).toEqual([4.1, 2.9, 5.7, 0.4])
    expect(String(f.rows[1]!.reason)).toContain("MNT-0170-031")
    expect(String(f.rows[2]!.reason)).toContain("MNT-0172-028")
    expect(f.rows[0]!.reason).toBe("No recorded reason")
    expect(f.rows[3]!.reason).toBe("No recorded reason")
    expect(f.rows[0]!.inspector_note).toBe("Pump jack not moving.")
  })

  it("Q3 thirteen weekly readings, not producing on 8 and 15 Oct", async () => {
    const f = await tools.reading_series(ctx("Michael Turner"), { wellId: "WELL-0001", weeks: 13 })
    expect(f.rows).toHaveLength(13)
    expect(f.rows[0]!.date).toBe("2026-07-23")
    for (const r of f.rows) {
      const source = rows.inspections.find((i) => i.inspection_id === r.inspection)!
      expect(r.inspected_at).toBe(source.inspected_at)
      expect(r.inspection_type).toBe(source.method)
      expect(r.notes).toBe(source.notes)
    }
    expect(f.rows.filter((r) => r.not_producing).map((r) => r.date)).toEqual(["2026-10-08", "2026-10-15"])
  })

  it("Q4 six spills, 15.1 bbl", async () => {
    const f = await tools.spills(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0001"] }, period: { kind: "last_n_months", n: 48 } })
    expect(f.slots.spills).toBe(6)
    expect(f.slots.totalBbl).toBe(15.1)
    expect(f.rows.map((r) => r.volume_bbl)).toEqual([0.5, 2.6, 3.3, 0.3, 6.8, 1.6])
    expect(f.rows.some((r) => r.inspection === "INS-0001-0070")).toBe(false)
  })

  it("Q5 21 days down in 2025", async () => {
    const f = await tools.downtime(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0001"] }, period: { kind: "calendar_year", year: 2025 } })
    expect(f.slots.totalDays).toBe(21)
    expect(f.rows.map((r) => r.date)).toEqual(["2025-07-24", "2025-10-16", "2025-10-23"])
    expect(f.rows.map((r) => r.delta_c)).toEqual([8.5, 3.4, -0.6])
    expect(String(f.rows[0]!.repairs_in_progress)).toContain("MNT-0001-021")
  })

  it("Q6 top three downtime in NE-07", async () => {
    const f = await tools.downtime(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 7" }, period: { kind: "last_n_months", n: 4 }, rank: 3 })
    expect(f.rows.map((r) => [r.well, r.days_down])).toEqual([["WELL-0121", 49], ["WELL-0107", 42], ["WELL-0138", 42]])
    expect(f.slots.nextWell).toBe("WELL-0119")
    expect(f.slots.nextDays).toBe(28)
    expect(f.window!.label).toBe("16 Jun – 16 Oct 2026")
  })

  it("fleet downtime reports the seven-way tie instead of breaking it", async () => {
    const f = await tools.downtime(ctx("Michael Turner"), { scope: { fleet: true }, period: { kind: "last_n_months", n: 4 }, rank: 3 })
    expect(f.rows[0]!.well).toBe("WELL-0121")
    expect(f.rows.slice(1).every((r) => r.days_down === 42)).toBe(true)
    expect(f.rows).toHaveLength(8)
    expect(f.rows.map((r) => r.rank)).toEqual([1, 2, 2, 2, 2, 2, 2, 2])
    expect(f.ties![0]).toContain("7 wells tie at 42")
  })

  it("retains zero-downtime ties instead of returning an empty ranking", async () => {
    const f = await tools.downtime({ datasetId: "sample" }, { scope: { wellIds: ["WELL-0001", "WELL-0002"] }, period: { kind: "between", from: "2000-01-01", to: "2000-01-02" }, rank: 1 })
    expect(f.rows).toHaveLength(2)
    expect(f.rows.map((r) => r.rank)).toEqual([1, 1])
    expect(f.ties![0]).toContain("2 wells tie at 0")
  })

  it("Q7 four NE-08 spills in 90 days with coordinates", async () => {
    const f = await tools.spills(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 8" }, period: { kind: "last_n_days", n: 90 } })
    expect(f.rows.map((r) => [r.well, r.date, r.volume_bbl])).toEqual([
      ["WELL-0186", "2026-07-23", 0.6],
      ["WELL-0165", "2026-07-30", 1.2],
      ["WELL-0175", "2026-07-30", 3.9],
      ["WELL-0151", "2026-09-24", 4.5],
    ])
    expect(f.rows.find((r) => r.well === "WELL-0151")).toMatchObject({ lat: 32.12246, lon: -102.18445 })
    expect(f.window!.from).toBe("2026-07-18")
  })

  it("Q8 2026 heatmap by area and month", async () => {
    const f = await tools.spills(ctx("Michael Turner"), { scope: { fleet: true }, period: { kind: "calendar_year", year: 2026 }, groupBy: "area_month" })
    const byName = Object.fromEntries(f.rows.map((r) => [r.area, r.total]))
    expect(byName).toEqual({ "Southwest Block 23": 35, "Southwest Block 24": 43, "Northeast Block 7": 37, "Northeast Block 8": 26 })
    expect(f.rows[1]).toMatchObject({ "2026-01": 7, "2026-08": 1, "2026-10": 2 })
    expect(f.columns).toHaveLength(12)
  })

  it("Q9 four breaches for WELL-0001 and what is still open", async () => {
    const f = await tools.compliance(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0001"] }, period: { kind: "last_n_months", n: 12 } })
    const key = f.rows.map((r) => `${r.protocol}:${r.status}`).sort()
    expect(key).toEqual(["RC-04:breach", "SR-01:breach", "SR-02:breach", "SR-03:overdue"])
    expect(f.rows.find((r) => r.protocol === "SR-03")!.due).toBe("2026-08-10")
    expect(f.rows.find((r) => r.protocol === "RC-04")!.due).toBe("2026-07-30")
    expect(f.slots.fineOpenUsd).toBe(5000)
    expect(f.caveats.join(" ")).toContain("MNT-0001-028")
    expect(f.caveats.join(" ")).toContain("CTX-0001-003")
    const full = await tools.compliance(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0001"] }, includeMet: true })
    expect(full.rows.find((r) => r.protocol === "RC-02")).toMatchObject({ status: "met" })
    expect(String(full.rows.find((r) => r.protocol === "RC-02")!.actual)).toContain("2026-03-07")
  })

  it("Q10 two SW-24 spills over the containment limit", async () => {
    const f = await tools.spills(ctx("Michael Turner"), { scope: { areaName: "Southwest Block 24" }, period: { kind: "last_n_days", n: 90 }, containmentOverLimit: true })
    expect(f.rows.map((r) => [r.well, r.containment_hours, r.inspection]).sort()).toEqual([
      ["WELL-0082", 7.1, "INS-0082-0198"],
      ["WELL-0100", 8.1, "INS-0100-0196"],
    ])
    expect(f.evidence.some((e) => e.kind === "report" && e.id === "MNT-0082-028" && e.quote)).toBe(true)
  })
})

describe("Part A2 and B sequences (Q11-Q18)", () => {
  beforeEach(async () => {
    await resetFeedbackAndMemory("sample")
  })

  it("remembers a well discussed through readings or context", async () => {
    await tools.reading_series(ctx("Michael Turner"), { wellId: "WELL-0001", weeks: 13 })
    const readings = await tools.recall(ctx("Michael Turner"), { reference: "that well", count: 1 })
    expect(wellsOf(readings)).toEqual(["WELL-0001"])
    await sleep(5)
    await tools.well_context(ctx("Michael Turner"), { wellId: "WELL-0007" })
    const context = await tools.recall(ctx("Michael Turner"), { reference: "that well", count: 1 })
    expect(wellsOf(context)).toEqual(["WELL-0007"])
  })

  it("rejects malformed correction values instead of converting them to zero or false", async () => {
    for (const [field, newValue] of [["wellhead_temp_c", "unknown"], ["wellhead_temp_c", true], ["wellhead_temp_c", "41 or 24"], ["spill_detected", "maybe"], ["spill_est_volume_bbl", -1], ["spill_area_pct", 101]] as const) {
      await expect(tools.record_feedback(ctx("Michael Turner"), { kind: "data_correction", targetId: "INS-0164-0205", field, newValue, text: "Correction" })).rejects.toThrow()
    }
    const f = await tools.well_status(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0164"] } })
    expect(f.rows[0]!.wellhead_c).toBe(24)
  })

  it("a disputed correction does not claim to change the effective status", async () => {
    await tools.record_feedback(ctx("Michael Turner"), { kind: "data_correction", targetId: "INS-0164-0205", newValue: 41, text: "Remeasured at 41" })
    const disputed = await tools.record_feedback(ctx("Jessica Reed"), { kind: "data_correction", targetId: "INS-0164-0205", newValue: 24, text: "I think it was 24" })
    expect(disputed.feedback.status).toBe("disputed")
    expect(disputed.slots.statusBefore).toBe("producing")
    expect(disputed.slots.statusAfter).toBe("producing")
    expect(disputed.slots.deltaAfter).toBe(21.1)
    expect(disputed.caveats.join(" ")).not.toContain("This changes")
    const f = await tools.well_status(ctx("Laura Simmons"), { scope: { wellIds: ["WELL-0164"] } })
    expect(f.rows[0]!.wellhead_c).toBe(41)
  })

  it("Q11 resolves 'the three wells we discussed yesterday' from the user's own turn; Q16 another user has none", async () => {
    const t1 = await tools.downtime(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 7" }, period: { kind: "last_n_months", n: 4 }, rank: 3 })
    expect(t1.rows).toHaveLength(3)
    await sleep(5)
    const turn2 = ctx("Michael Turner", { turnStartedAt: new Date().toISOString() })
    const rec = await tools.recall(turn2, { reference: "the three wells we discussed yesterday", count: 3 })
    expect(wellsOf(rec).sort()).toEqual(["WELL-0107", "WELL-0121", "WELL-0138"])
    expect(rec.caveats.join(" ")).toContain("earlier downtime answer")
    const cost = await tools.maintenance(turn2, { scope: { wellIds: wellsOf(rec) }, period: { kind: "calendar_year", year: 2026 }, groupBy: "well" })
    expect(Object.fromEntries(cost.rows.map((r) => [r.well, r.total_cost_usd]))).toEqual({ "WELL-0107": 5176, "WELL-0121": 25794, "WELL-0138": 46942 })
    expect(cost.caveats.join(" ")).toContain("in progress")
    for (const [index, row] of cost.rows.entries()) {
      const prefix = String(row.well).replace("WELL-", "MNT-") + "-"
      expect(cost.rowEvidence![index]!.every((e) => e.id.startsWith(prefix))).toBe(true)
    }

    const other = await tools.recall({ ...ctx("Jessica Reed"), turnStartedAt: new Date().toISOString() }, { reference: "the three wells we discussed yesterday", count: 3 })
    expect(other.rows).toHaveLength(0)
    expect(other.caveats.join(" ")).toContain("No earlier answers")
  })

  it("Q12 data correction flips WELL-0164 to producing, flags the inspector note, and Q2 drops to three", async () => {
    const r = await tools.record_feedback(ctx("Michael Turner"), {
      kind: "data_correction",
      targetId: "INS-0164-0205",
      field: "wellhead_temp_c",
      newValue: 41.0,
      reason: "Handheld thermal gun was faulty; crew re-measured",
      text: "The 15 Oct reading for WELL-0164 is wrong.",
    })
    expect(r.feedback.status).toBe("applied")
    expect(r.feedback.originalValue).toBe(24)
    expect(r.feedback.authorUserId).toBe(U["Michael Turner"])
    expect(r.slots).toMatchObject({ deltaAfter: 21.1, statusBefore: "not producing", statusAfter: "producing" })
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]!.sides.map((s) => s.claim)).toContain("Pump jack not moving.")
    expect(r.conflicts[0]!.needsConfirmationFrom).toBe(U["Michael Turner"])
    const q2 = await tools.well_status(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 8" }, onlyNotProducing: true })
    expect(wellsOf(q2)).toEqual(["WELL-0170", "WELL-0172", "WELL-0175"])
    // Q15: another user sees the correction
    const jessica = await tools.well_status(ctx("Jessica Reed"), { scope: { wellIds: ["WELL-0164"] } })
    expect(jessica.rows[0]).toMatchObject({ status: "producing", wellhead_c: 41, original_wellhead_c: 24, corrected: true })
    expect(jessica.conflicts.some((c) => c.sides.some((s) => s.claim === "Pump jack not moving."))).toBe(true)
  })

  it("Q13 volume correction makes WELL-0151 reportable with SR-01 and SR-03 consequences; Q15 Laura sees it", async () => {
    const r = await tools.record_feedback(ctx("Michael Turner"), {
      kind: "analysis_correction",
      targetId: "INS-0151-0201",
      field: "spill_est_volume_bbl",
      newValue: 5.4,
      reason: "Field crew measured 5.4 bbl",
      text: "The AI estimated 4.5 bbl but the crew measured 5.4.",
    })
    expect(r.feedback.originalValue).toBe(4.5)
    expect(r.slots).toMatchObject({ classBefore: "moderate", classAfter: "reportable", "SR-01_status": "overdue", "SR-03_due": "2026-11-23", "SR-02_status": "breach" })
    expect(r.caveats.join(" ")).toContain("MNT-0151-025")
    expect(r.caveats.join(" ")).toContain("moderate")
    const laura = await tools.spills(ctx("Laura Simmons"), { scope: { areaName: "Northeast Block 8" }, period: { kind: "last_n_days", n: 90 }, reportableOnly: true })
    expect(wellsOf(laura)).toEqual(["WELL-0151"])
    expect(laura.rows[0]!.written_notice).toContain("overdue")
  })

  it("Q14 a T350-scoped RCA rule adds WELL-0120 but not T200 WELL-0102", async () => {
    const before = await tools.rca_candidates(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 7" }, equipmentKind: "pump_jack" })
    expect(wellsOf(before)).toEqual(["WELL-0108", "WELL-0121", "WELL-0138"])
    expect(before.rows.every((r) => r.corrective_repairs === 3)).toBe(true)
    const rec = await tools.record_feedback(ctx("Michael Turner"), {
      kind: "scoped_rule",
      targetId: "rca_count",
      newValue: 2,
      scope: { type: "well_type", value: "T350" },
      text: "Note for all T350 wells: our team now wants a pump jack root-cause analysis after 2 repairs, not 3.",
    })
    expect(rec.slots).toMatchObject({ manualValue: "three", newValue: "2", scope: "well_type: T350" })
    const after = await tools.rca_candidates(ctx("Michael Turner", { threadId: "new" }), { scope: { areaName: "Northeast Block 7" }, equipmentKind: "pump_jack" })
    expect(wellsOf(after)).toEqual(["WELL-0108", "WELL-0120", "WELL-0121", "WELL-0138"])
    expect(wellsOf(after)).not.toContain("WELL-0102")
    expect(after.rows.find((r) => r.well === "WELL-0120")!.threshold_source).toContain("Michael Turner")
    expect(after.rulesApplied.some((x) => x.overriddenBy)).toBe(true)
  })

  it("Q16 a shared note reaches other users; its dates keep the expired WELL-0007 note out", async () => {
    await tools.record_feedback(ctx("Jake Morales"), {
      kind: "shared_note",
      targetId: "WELL-0007",
      text: "FYI for everyone: WELL-0007 will be shut in from 17 Oct for a 10-day planned workover.",
      validFrom: "2026-10-17",
      validTo: "2026-10-27",
    })
    const f = await tools.well_context(ctx("Michael Turner"), { wellId: "WELL-0007" })
    const upcoming = f.rows.find((r) => r.kind === "shared note")!
    expect(upcoming).toMatchObject({ status: "upcoming", author: "Jake Morales", valid_from: "2026-10-17" })
    expect(f.rows.find((r) => String(r.source).startsWith("Note CTX-0007-001"))).toMatchObject({ status: "expired" })
    const status = await tools.well_status(ctx("Michael Turner"), { scope: { wellIds: ["WELL-0007"] } })
    expect(status.rows[0]!.status).toBeTruthy()
  })

  it("Q17 claims are compared with the data and with each other", async () => {
    const michael = await tools.record_feedback(ctx("Michael Turner"), {
      kind: "status_claim",
      targetId: "WELL-0175",
      claimedProducing: false,
      text: "WELL-0175 has been shut in for planned work since 14 Oct.",
    })
    expect(michael.feedback.status).toBe("applied")
    expect(michael.conflicts).toHaveLength(0)
    const tyler = await tools.record_feedback(ctx("Tyler Hughes"), {
      kind: "status_claim",
      targetId: "WELL-0175",
      claimedProducing: true,
      text: "WELL-0175 is running fine.",
    })
    expect(tyler.feedback.status).toBe("unconfirmed")
    expect(tyler.slots).toMatchObject({ deltaC: 0.4, inspectedBy: "Jessica Reed", dataStatus: "not producing" })
    expect(tyler.conflicts[0]!.sides.map((s) => s.author)).toContain("Michael Turner")
    const jake = await tools.record_feedback(ctx("Jake Morales"), {
      kind: "status_claim",
      targetId: "WELL-0001",
      claimedProducing: true,
      text: "WELL-0001 is back online since 14 Oct.",
    })
    expect(jake.feedback.status).toBe("unconfirmed")
    expect(jake.slots.deltaC).toBe(3.2)
    expect(jake.conflicts[0]!.sides.some((s) => s.source.id === "CTX-0001-003")).toBe(true)
    expect(jake.caveats.join(" ")).toContain("own earlier note")
    const status = await tools.well_status(ctx("Laura Simmons"), { scope: { wellIds: ["WELL-0175"] } })
    expect(status.rows[0]!.status).toBe("not producing")
    expect(status.conflicts.length).toBeGreaterThan(0)
  })

  it("Q18 WELL-0101 20 Aug spill is real and two notes disagree", async () => {
    const f = await tools.spills(ctx("Laura Simmons"), { scope: { wellIds: ["WELL-0101"] }, period: { kind: "between", from: "2026-08-20", to: "2026-08-20" } })
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0]).toMatchObject({ inspection: "INS-0101-0197", volume_bbl: 1, repair: "MNT-0101-029" })
    expect(f.conflicts).toHaveLength(1)
    expect(f.conflicts[0]!.sides.map((s) => s.source.id).sort()).toEqual(["CTX-0101-002", "CTX-0101-003"])
    expect(f.conflicts[0]!.sides.map((s) => s.author).sort()).toEqual(["Chris Dalton", "Ryan Brooks"])
  })

  it("keeps each user's memory separate in the same dataset", async () => {
    await tools.downtime(ctx("Michael Turner"), { scope: { areaName: "Northeast Block 7" }, period: { kind: "last_n_months", n: 4 }, rank: 3 })
    await sleep(5)
    const t = new Date().toISOString()
    const a = await tools.recall({ ...ctx("Michael Turner"), turnStartedAt: t }, { reference: "last answer" })
    const b = await tools.recall({ ...ctx("Tyler Hughes"), turnStartedAt: t }, { reference: "last answer" })
    expect(a.rows.length).toBe(3)
    expect(b.rows.length).toBe(0)
  })
})

describe("oracle agreement across the whole field", () => {
  it("latest producing status matches for all 200 wells", async () => {
    const f = await tools.well_status({ datasetId: "sample" }, { scope: { fleet: true }, limit: 200 })
    const lp = latestProducing(raw, TH)
    expect(f.rows).toHaveLength(200)
    for (const r of f.rows) expect(r.status === "producing").toBe(lp[String(r.well)])
  })

  it("downtime for every well over the last four months matches", async () => {
    const f = await tools.downtime({ datasetId: "sample" }, { scope: { fleet: true }, period: { kind: "last_n_months", n: 4 }, rank: 200 })
    const o = downtimeDays(raw, TH, "2026-06-16", raw.today)
    for (const r of f.rows) expect(r.days_down).toBe(o[String(r.well)])
  })

  it("2026 spill grid, repair cost per well and open repairs match", async () => {
    const f = await tools.spills({ datasetId: "sample" }, { scope: { fleet: true }, period: { kind: "calendar_year", year: 2026 }, groupBy: "area_month" })
    const grid = spillGrid(raw, 2026)
    const areaIdByName = Object.fromEntries(raw.areas.map((a) => [a.name, a.area_id]))
    for (const r of f.rows) expect(Object.values(r).slice(1, 11)).toEqual(grid[areaIdByName[String(r.area)]!]!.slice(0, 10))
    const cost = await tools.maintenance({ datasetId: "sample" }, { scope: { wellIds: ["WELL-0121", "WELL-0001", "WELL-0050"] }, period: { kind: "calendar_year", year: 2026 }, groupBy: "well" })
    for (const r of cost.rows) expect(r.total_cost_usd).toBe(Math.round(repairCost(raw, String(r.well), 2026)))
    const open = await tools.maintenance({ datasetId: "sample" }, { scope: { fleet: true }, openOnly: true, limit: 200 })
    expect(open.rows.map((r) => r.maintenance).sort()).toEqual(openRepairs(raw, raw.today).sort())
    for (const r of open.rows) {
      const source = rows.maintenance.find((m) => m.maintenance_id === r.maintenance)!
      expect(r.started_at).toBe(source.started_at)
      expect(r.completed_at).toBe(source.completed_at)
      expect(r.downtime_hours).toBe(source.downtime_hours)
    }
  })

  it("RCA candidates for pump jacks match counts from the raw files", async () => {
    const f = await tools.rca_candidates({ datasetId: "sample" }, { scope: { fleet: true }, equipmentKind: "pump_jack" })
    const o = rcaWells(raw, "pump_jack", "2025-10-16", () => 3, raw.wells.map((w) => w.asset_id))
    expect(Object.fromEntries(f.rows.map((r) => [r.well, r.corrective_repairs]))).toEqual(o)
  })

  it("recorded status disagrees with the latest inspection for the wells the oracle finds", async () => {
    const f = await tools.well_status({ datasetId: "sample" }, { scope: { fleet: true }, recordedStatusMismatchOnly: true, limit: 200 })
    const lp = latestProducing(raw, TH)
    const expected = raw.wells.filter((w) => (w.recorded_status === "active") !== lp[w.asset_id]).map((w) => w.asset_id)
    expect(wellsOf(f).sort()).toEqual(expected.sort())
    expect(f.rows).toHaveLength(21)
  })

  it("open notices of violation across the field include the old WELL-0160 notice", async () => {
    const f = await tools.compliance({ datasetId: "sample" }, { scope: { fleet: true }, period: { kind: "last_n_months", n: 60 }, events: "open", protocols: ["SR-01"] })
    const openNov = f.rows.filter((r) => r.event_type === "notice_of_violation").map((r) => r.event)
    expect(openNov).toEqual(expect.arrayContaining(["REG-0160-002", "REG-0001-002"]))
    const checks = await tools.compliance({ datasetId: "sample" }, { scope: { wellIds: ["WELL-0160"] }, period: { kind: "last_n_months", n: 60 }, protocols: ["RC-04"] })
    expect(checks.rows.some((r) => r.status === "breach")).toBe(true)
  })

  it("real spill count in the whole history matches", async () => {
    const f = await tools.spills({ datasetId: "sample" }, { scope: { fleet: true }, groupBy: "area" })
    expect(f.slots.totalSpills).toBe(realSpills(raw, "0000-01-01", "9999-12-31").length)
  })
})

describe("mutations change answers without code changes", () => {
  async function loadMutant(id: string, mutate: (r: DatasetRows) => Promise<void> | void) {
    const copy = structuredClone(rows)
    copy.meta.id = id
    await mutate(copy)
    await writeDataset(db, copy)
    clearSnapshotCache()
  }

  it("flipping the latest reading across the threshold changes WELL-0001 status and the NE-08 count", async () => {
    await loadMutant("mut-flip", (r) => {
      const last = r.inspections.filter((i) => i.asset_id === "WELL-0001").at(-1)!
      last.wellhead_temp_c = last.ambient_temp_c + 30
      const l2 = r.inspections.filter((i) => i.asset_id === "WELL-0175").at(-1)!
      l2.wellhead_temp_c = l2.ambient_temp_c + 25
    })
    const a = await tools.well_status({ datasetId: "mut-flip" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(a.rows[0]!.status).toBe("producing")
    const ne8 = await tools.well_status({ datasetId: "mut-flip" }, { scope: { areaName: "Northeast Block 8" }, onlyNotProducing: true })
    expect(wellsOf(ne8)).toEqual(["WELL-0164", "WELL-0170", "WELL-0172"])
    const base = await tools.well_status({ datasetId: "sample" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(base.rows[0]!.status).toBe("not producing")
  })

  it("adding a correction note removes a spill from counts and the grid", async () => {
    await loadMutant("mut-corr", (r) => {
      r.notes.push({ asset_id: "WELL-0001", note_id: "CTX-X-1", created_at: "2026-06-12T00:00:00Z", author_user_id: "U-401", note_type: "correction", inspection_id: "INS-0001-0185", text: "Not crude.", valid_from: "2026-06-11", valid_to: null })
    })
    const f = await tools.spills({ datasetId: "mut-corr" }, { scope: { wellIds: ["WELL-0001"] }, period: { kind: "last_n_months", n: 48 } })
    expect(f.slots.spills).toBe(5)
    expect(f.slots.totalBbl).toBe(8.3)
    const c = await tools.compliance({ datasetId: "mut-corr" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(c.rows.filter((x) => String(x.protocol).startsWith("SR") && (x.status === "breach" || x.status === "overdue"))).toHaveLength(0)
    expect(c.rows.filter((x) => x.protocol === "RC-04")).toHaveLength(1) // the notice itself still stands
  })

  it("changing the T200 threshold text moves every derived answer", async () => {
    const { extractRules } = await import("../ingest/rules")
    await loadMutant("mut-rule", async (r) => {
      for (const d of r.documents) if (d.docId === "T200") for (const s of d.sections) s.text = s.text.replace("**15 °C above ambient**", "**30 °C above ambient**")
      r.rules = await extractRules(r.documents.filter((d) => d.kind !== "report"), ["T200", "T350"])
    })
    const rule = await tools.get_rule({ datasetId: "mut-rule" }, { key: "producing_delta_c", wellType: "T200" })
    expect(rule.rows[0]!.value).toBe("30")
    const o = latestProducing(raw, { T200: 30, T350: 20 })
    const f = await tools.well_status({ datasetId: "mut-rule" }, { scope: { fleet: true }, limit: 200 })
    for (const x of f.rows) expect(x.status === "producing").toBe(o[String(x.well)])
    const base = latestProducing(raw, TH)
    expect(Object.values(o).filter((v) => !v).length).toBeGreaterThan(Object.values(base).filter((v) => !v).length)
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)
    const moved = await tools.downtime({ datasetId: "mut-rule" }, { scope: { fleet: true }, period: { kind: "last_n_months", n: 12 }, rank: 200 })
    const baseline = await tools.downtime({ datasetId: "sample" }, { scope: { fleet: true }, period: { kind: "last_n_months", n: 12 }, rank: 200 })
    const total = (f: Finding) => Number(f.slots.totalDaysAllWells)
    expect(total(moved)).toBe(sum(downtimeDays(raw, { T200: 30, T350: 20 }, "2025-10-16", raw.today)))
    expect(total(moved)).toBeGreaterThan(total(baseline))
    const dt = await tools.downtime({ datasetId: "mut-rule" }, { scope: { wellIds: ["WELL-0001"] }, period: { kind: "calendar_year", year: 2025 } })
    expect(dt.slots.totalDays).toBe(Object.values(downtimeDays(raw, { T200: 30, T350: 20 }, "2025-01-01", "2025-12-31", ["WELL-0001"]))[0])
  })

  it("an unparseable rule is reported as missing, never guessed", async () => {
    const { extractRules } = await import("../ingest/rules")
    await loadMutant("mut-missing", async (r) => {
      for (const d of r.documents) if (d.docId === "T200") for (const s of d.sections) s.text = s.text.replace(/at least \*\*15 °C above ambient\*\*/, "at a sufficient margin over ambient")
      r.rules = await extractRules(r.documents.filter((d) => d.kind !== "report"), ["T200", "T350"])
    })
    const f = await tools.well_status({ datasetId: "mut-missing" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(f.rows[0]!.status).toContain("unknown")
    expect(f.slots.producing).toBe(0)
    expect(f.slots.unknown).toBe(1)
    const g = await tools.get_rule({ datasetId: "mut-missing" }, { key: "producing_delta_c", wellType: "T200" })
    expect(g.caveats.join(" ")).toContain("not guessed")
  })

  it("a new well type with its own manual is picked up", async () => {
    const { extractRules } = await import("../ingest/rules")
    await loadMutant("mut-t500", async (r) => {
      r.documents.push({ docId: "T500", kind: "manual", title: "T500", wellType: "T500", path: "fleet/well-types/T500.md", sections: [{ section: "3", heading: "Production temperature rule", text: "A T500 well is producing when its wellhead temperature is at least **30 °C above ambient** air temperature." }] })
      r.wells.find((w) => w.asset_id === "WELL-0001")!.well_type = "T500"
      r.rules = await extractRules(r.documents.filter((d) => d.kind !== "report"), ["T200", "T350", "T500"])
    })
    const f = await tools.well_status({ datasetId: "mut-t500" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(f.rows[0]).toMatchObject({ threshold_c: 30, status: "not producing" })
    const rr = await tools.rca_candidates({ datasetId: "mut-t500" }, { scope: { wellIds: ["WELL-0001"] } })
    expect(rr.caveats.join(" ")).toContain("T500")
  })

  it("domain-level snapshots round-trip: DB snapshot equals the parsed one", async () => {
    const snap = buildSnapshot(await readSnapshotRows(db, "sample"))
    const d = new Domain(snap, [])
    const parsed = new Domain(buildSnapshot(rows), [])
    for (const w of snap.wellList.slice(0, 40)) expect(d.producing(d.latest(w.asset_id)!, w)).toBe(parsed.producing(parsed.latest(w.asset_id)!, w))
  })
})
