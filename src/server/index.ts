// Framework-agnostic entry point for the agent route and UI server functions.
import { eq } from "drizzle-orm"
import type { Feedback, Finding, Scope } from "../contracts"
import { getDb, type Db } from "./db/client"
import { datasets, users as usersTable } from "./db/schema"
import { getSnapshot } from "./engine/snapshot"
import { recordFeedback, type FeedbackResult } from "./feedback/record"
import { resetDataset } from "./ingest/write"
import { dbOf, loadDomain, readFeedback, type ToolCtx } from "./tools/ctx"
import { recall } from "./tools/memory"
import {
  compliance,
  downtime,
  getRule,
  maintenance,
  rcaCandidates,
  readingSeries,
  searchDocuments,
  spills,
  wellContext,
  wellStatus,
} from "./tools/read"
import * as Z from "./tools/schemas"
import type * as S from "./tools/schemas"

export * from "./tools/schemas"
export { getFullFinding, type ToolCtx, type ProgressFn } from "./tools/ctx"
export { ToolError } from "./engine/domain"
export { getOrCreateUserThread, addMessage, listMessages, recall } from "./tools/memory"
export { recordFeedback, type FeedbackResult } from "./feedback/record"
export {
  compliance,
  downtime,
  getRule,
  maintenance,
  rcaCandidates,
  readingSeries,
  searchDocuments,
  spills,
  wellContext,
  wellStatus,
} from "./tools/read"

export type DatasetInfo = { id: string; label: string; today: string; version: number; loadedAt: string; stats: unknown }

export async function getDatasets(db?: Db): Promise<DatasetInfo[]> {
  const d = db ?? (await getDb())
  const rows = await d.drizzle.select().from(datasets)
  return rows
    .map((r) => ({ id: r.id, label: r.label, today: r.today, version: r.version, loadedAt: r.loadedAt, stats: r.stats }))
    .sort((a, b) => b.loadedAt.localeCompare(a.loadedAt))
}

export async function getUsers(datasetId: string, db?: Db) {
  const d = db ?? (await getDb())
  const rows = await d.drizzle.select().from(usersTable).where(eq(usersTable.datasetId, datasetId))
  return rows.map((u) => ({ userId: u.userId, name: u.name, role: u.role, teamId: u.teamId })).sort((a, b) => a.userId.localeCompare(b.userId))
}

export type WellListItem = {
  wellId: string
  name: string
  wellType: string
  areaId: string
  areaName: string
  lat: number
  lon: number
  recordedStatus: string
  producing: boolean | null
  deltaC: number | null
  lastInspectedAt: string | null
}

/** Wells in scope with their derived latest status (overlays applied). For maps, pickers and the header. */
export async function listWells(datasetId: string, scope: Scope = {}, db?: Db): Promise<WellListItem[]> {
  const d = await loadDomain({ datasetId, db })
  return d.resolveWells(scope).map((w) => {
    const e = d.latest(w.asset_id)
    return {
      wellId: w.asset_id,
      name: w.name,
      wellType: w.well_type,
      areaId: w.area_id,
      areaName: d.ds.areas.get(w.area_id)?.name ?? w.area_id,
      lat: w.location.lat,
      lon: w.location.lon,
      recordedStatus: w.recorded_status,
      producing: e ? d.producing(e, w) : null,
      deltaC: e?.delta ?? null,
      lastInspectedAt: e?.insp.inspected_at ?? null,
    }
  })
}

export async function listAreas(datasetId: string, db?: Db) {
  const snap = await getSnapshot(db ?? (await getDb()), datasetId)
  return [...snap.areas.values()].map((a) => ({ areaId: a.area_id, name: a.name, teamId: a.team_id, center: a.center, wellCount: a.asset_ids.length }))
}

export async function listFeedback(datasetId: string, db?: Db): Promise<Feedback[]> {
  return readFeedback(db ?? (await getDb()), datasetId)
}

/** Clear feedback, threads, messages and memory for a dataset (repeatable Part A/B runs). */
export async function resetFeedbackAndMemory(datasetId: string, db?: Db) {
  await resetDataset(db ?? (await getDb()), datasetId)
}

export const tools = {
  well_status: (ctx: ToolCtx, a: S.WellStatusArgs): Promise<Finding> => wellStatus(ctx, a),
  reading_series: (ctx: ToolCtx, a: S.ReadingSeriesArgs): Promise<Finding> => readingSeries(ctx, a),
  downtime: (ctx: ToolCtx, a: S.DowntimeArgs): Promise<Finding> => downtime(ctx, a),
  spills: (ctx: ToolCtx, a: S.SpillsArgs): Promise<Finding> => spills(ctx, a),
  maintenance: (ctx: ToolCtx, a: S.MaintenanceArgs): Promise<Finding> => maintenance(ctx, a),
  rca_candidates: (ctx: ToolCtx, a: S.RcaArgs): Promise<Finding> => rcaCandidates(ctx, a),
  compliance: (ctx: ToolCtx, a: S.ComplianceArgs): Promise<Finding> => compliance(ctx, a),
  search_documents: (ctx: ToolCtx, a: S.SearchDocsArgs): Promise<Finding> => searchDocuments(ctx, a),
  get_rule: (ctx: ToolCtx, a: S.GetRuleArgs): Promise<Finding> => getRule(ctx, a),
  well_context: (ctx: ToolCtx, a: S.WellContextArgs): Promise<Finding> => wellContext(ctx, a),
  recall: (ctx: ToolCtx, a: S.RecallArgs): Promise<Finding> => recall(ctx, a),
  record_feedback: (ctx: ToolCtx, a: S.RecordFeedbackArgs): Promise<FeedbackResult> => recordFeedback(ctx, a),
} as const

export const toolSchemas = {
  well_status: Z.wellStatusArgs,
  reading_series: Z.readingSeriesArgs,
  downtime: Z.downtimeArgs,
  spills: Z.spillsArgs,
  maintenance: Z.maintenanceArgs,
  rca_candidates: Z.rcaArgs,
  compliance: Z.complianceArgs,
  search_documents: Z.searchDocsArgs,
  get_rule: Z.getRuleArgs,
  well_context: Z.wellContextArgs,
  recall: Z.recallArgs,
  record_feedback: Z.recordFeedbackArgs,
} as const

export type ToolName = keyof typeof tools
export { dbOf }
