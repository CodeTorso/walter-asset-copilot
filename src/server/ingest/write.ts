import { eq, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import type { AreaRow, InspectionRow, MaintenanceRow, NoteRow, RegulatoryEventRow, UserRow, WellRow } from "../../contracts"
import type { Db } from "../db/client"
import * as t from "../db/schema"
import type { DatasetRows, FactRow, RuleRow, SnapshotRows } from "./types"

async function insertChunks<T extends Record<string, unknown>>(
  db: Db,
  table: PgTable,
  rows: T[],
  perChunk: number,
) {
  for (let i = 0; i < rows.length; i += perChunk) {
    await db.drizzle.insert(table).values(rows.slice(i, i + perChunk) as never)
  }
}

const DATA_TABLES = [
  t.users,
  t.teams,
  t.areas,
  t.wells,
  t.inspections,
  t.maintenance,
  t.regulatoryEvents,
  t.notes,
  t.documents,
  t.documentSections,
  t.reportFacts,
  t.rules,
] as const

export type WriteResult = { datasetId: string; version: number; counts: Record<string, number> }

/** Replace one dataset's data. Feedback and memory for that dataset are kept (use resetDataset to clear them). */
export async function writeDataset(
  db: Db,
  rows: DatasetRows,
  log: (line: string) => void = () => {},
): Promise<WriteResult> {
  const id = rows.meta.id
  const prev = await db.drizzle.select().from(t.datasets).where(eq(t.datasets.id, id))
  const version = (prev[0]?.version ?? 0) + 1

  for (const table of DATA_TABLES) {
    await db.drizzle.delete(table).where(eq((table as typeof t.users).datasetId, id))
  }
  log(`cleared previous rows for dataset ${id}`)

  await insertChunks(db, t.users, rows.users.map((u) => ({ datasetId: id, userId: u.user_id, name: u.name, role: u.role, teamId: u.team_id })), 500)
  await insertChunks(db, t.teams, rows.teams.map((x) => ({ datasetId: id, teamId: x.team_id, name: x.name, leadUserId: x.lead_user_id })), 500)
  await insertChunks(
    db,
    t.areas,
    rows.areas.map((a) => ({
      datasetId: id,
      areaId: a.area_id,
      name: a.name,
      teamId: a.team_id,
      centerLat: a.center.lat,
      centerLon: a.center.lon,
      assetIds: a.asset_ids,
    })),
    200,
  )
  await insertChunks(
    db,
    t.wells,
    rows.wells.map((w) => ({
      datasetId: id,
      assetId: w.asset_id,
      name: w.name,
      wellType: w.well_type,
      areaId: w.area_id,
      teamId: w.team_id,
      inChargeUserId: w.in_charge_user_id,
      lat: w.location.lat,
      lon: w.location.lon,
      installedOn: w.installed_on,
      recordedStatus: w.recorded_status,
      equipment: w.equipment,
      lastInspection: w.last_inspection ?? null,
      raw: w,
    })),
    100,
  )
  log(`wells ${rows.wells.length}`)
  await insertChunks(
    db,
    t.inspections,
    rows.inspections.map((i) => ({
      datasetId: id,
      inspectionId: i.inspection_id,
      assetId: i.asset_id,
      inspectedAt: i.inspected_at,
      inspectorUserId: i.inspector_user_id,
      method: i.method,
      ambientTempC: i.ambient_temp_c,
      wellheadTempC: i.wellhead_temp_c,
      spillDetected: i.spill_detected,
      spillAreaPct: i.spill_area_pct,
      spillEstVolumeBbl: i.spill_est_volume_bbl,
      notes: i.notes,
      raw: i,
    })),
    400,
  )
  log(`inspections ${rows.inspections.length}`)
  await insertChunks(
    db,
    t.maintenance,
    rows.maintenance.map((m) => ({
      datasetId: id,
      maintenanceId: m.maintenance_id,
      assetId: m.asset_id,
      startedAt: m.started_at,
      completedAt: m.completed_at,
      maintenanceType: m.maintenance_type,
      equipmentKind: m.equipment_kind,
      issue: m.issue,
      actionTaken: m.action_taken,
      technicianUserId: m.technician_user_id,
      contractor: m.contractor,
      downtimeHours: m.downtime_hours,
      costLabor: m.cost_usd.labor,
      costParts: m.cost_usd.parts,
      costTotal: m.cost_usd.total,
      triggeredByInspectionId: m.triggered_by_inspection_id,
      reportFile: m.report_file,
      raw: m,
    })),
    300,
  )
  log(`maintenance ${rows.maintenance.length}`)
  await insertChunks(
    db,
    t.regulatoryEvents,
    rows.regEvents.map((e) => ({
      datasetId: id,
      eventId: e.event_id,
      assetId: e.asset_id,
      date: e.date,
      agency: e.agency,
      eventType: e.event_type,
      protocolId: e.protocol_id,
      relatedInspectionId: e.related_inspection_id,
      hoursToReport: e.hours_to_report,
      detail: e.detail,
      fineUsd: e.fine_usd,
      status: e.status,
      raw: e,
    })),
    300,
  )
  await insertChunks(
    db,
    t.notes,
    rows.notes.map((n) => ({
      datasetId: id,
      noteId: n.note_id,
      assetId: n.asset_id,
      createdAt: n.created_at,
      authorUserId: n.author_user_id,
      noteType: n.note_type,
      inspectionId: n.inspection_id ?? null,
      text: n.text,
      validFrom: n.valid_from,
      validTo: n.valid_to,
      raw: n,
    })),
    300,
  )
  await insertChunks(
    db,
    t.documents,
    rows.documents.map((d) => ({
      datasetId: id,
      docId: d.docId,
      kind: d.kind,
      title: d.title,
      wellType: d.wellType ?? null,
      assetId: d.assetId ?? null,
      maintenanceId: d.maintenanceId ?? null,
      path: d.path,
    })),
    400,
  )
  const sections = rows.documents.flatMap((d) =>
    d.sections.map((s, ord) => ({ datasetId: id, docId: d.docId, ord, section: s.section, heading: s.heading, text: s.text })),
  )
  await insertChunks(db, t.documentSections, sections, 300)
  log(`documents ${rows.documents.length} (${sections.length} sections)`)
  await insertChunks(
    db,
    t.reportFacts,
    rows.facts.map((f) => ({
      datasetId: id,
      maintenanceId: f.maintenanceId,
      fact: f.fact,
      key: f.key,
      value: f.value,
      detail: f.detail ?? null,
      quote: f.quote,
      docId: f.docId,
      section: f.section ?? null,
      method: f.method,
      confidence: f.confidence,
    })),
    500,
  )
  log(`report facts ${rows.facts.length}`)
  await insertChunks(
    db,
    t.rules,
    rows.rules.map((r) => ({
      datasetId: id,
      key: r.key,
      wellType: r.wellType,
      status: r.status,
      value: r.value ?? null,
      num: r.num ?? null,
      unit: r.unit ?? null,
      label: r.label,
      docId: r.docId ?? null,
      section: r.section ?? null,
      quote: r.quote ?? null,
      method: r.method,
      inheritedFrom: r.inheritedFrom ?? null,
    })),
    200,
  )

  const counts = {
    users: rows.users.length,
    areas: rows.areas.length,
    wells: rows.wells.length,
    inspections: rows.inspections.length,
    maintenance: rows.maintenance.length,
    regulatoryEvents: rows.regEvents.length,
    notes: rows.notes.length,
    documents: rows.documents.length,
    sections: sections.length,
    reportFacts: rows.facts.length,
    rules: rows.rules.length,
    rulesMissing: rows.rules.filter((r) => r.status === "missing").length,
  }
  const values = {
    id,
    label: rows.meta.label,
    today: rows.meta.today,
    todayOverridden: rows.meta.todayOverridden,
    version,
    sourceHash: rows.meta.sourceHash,
    stats: { ...counts, warnings: rows.warnings.length },
    loadedAt: new Date().toISOString(),
  }
  await db.drizzle
    .insert(t.datasets)
    .values(values)
    .onConflictDoUpdate({ target: t.datasets.id, set: values })
  return { datasetId: id, version, counts }
}

/** Clear feedback, conversations, messages and memory for one dataset. */
export async function resetDataset(db: Db, datasetId: string) {
  const convs = await db.drizzle
    .select({ id: t.conversations.id })
    .from(t.conversations)
    .where(eq(t.conversations.datasetId, datasetId))
  for (const c of convs) await db.drizzle.delete(t.messages).where(eq(t.messages.conversationId, c.id))
  await db.drizzle.delete(t.conversations).where(eq(t.conversations.datasetId, datasetId))
  await db.drizzle.delete(t.memoryEntities).where(eq(t.memoryEntities.datasetId, datasetId))
  await db.drizzle.delete(t.feedback).where(eq(t.feedback.datasetId, datasetId))
  await db.drizzle.delete(t.turnUsage).where(eq(t.turnUsage.datasetId, datasetId))
}

export async function readDatasetRow(db: Db, datasetId: string) {
  const r = await db.drizzle.select().from(t.datasets).where(eq(t.datasets.id, datasetId))
  return r[0] ?? null
}

/** Read a dataset back from the database into the shape the engine needs (no raw JSON, no document text). */
export async function readSnapshotRows(db: Db, datasetId: string): Promise<SnapshotRows> {
  const ds = await readDatasetRow(db, datasetId)
  if (!ds) throw new Error(`Unknown dataset: ${datasetId}`)
  const w = <T extends { datasetId: unknown }>(table: T) => eq(table.datasetId as never, datasetId)
  const d = db.drizzle
  const [users, teams, areas, wells, ins, mnt, reg, notes, facts, rules] = await Promise.all([
    d.select().from(t.users).where(w(t.users)),
    d.select().from(t.teams).where(w(t.teams)),
    d.select().from(t.areas).where(w(t.areas)),
    d.select({
      assetId: t.wells.assetId, name: t.wells.name, wellType: t.wells.wellType, areaId: t.wells.areaId, teamId: t.wells.teamId,
      inCharge: t.wells.inChargeUserId, lat: t.wells.lat, lon: t.wells.lon, installedOn: t.wells.installedOn,
      recordedStatus: t.wells.recordedStatus, equipment: t.wells.equipment, lastInspection: t.wells.lastInspection,
    }).from(t.wells).where(w(t.wells)),
    d.select({
      id: t.inspections.inspectionId, assetId: t.inspections.assetId, at: t.inspections.inspectedAt, by: t.inspections.inspectorUserId,
      method: t.inspections.method, amb: t.inspections.ambientTempC, head: t.inspections.wellheadTempC, spill: t.inspections.spillDetected,
      pct: t.inspections.spillAreaPct, vol: t.inspections.spillEstVolumeBbl, notes: t.inspections.notes,
    }).from(t.inspections).where(w(t.inspections)),
    d.select().from(t.maintenance).where(w(t.maintenance)),
    d.select().from(t.regulatoryEvents).where(w(t.regulatoryEvents)),
    d.select().from(t.notes).where(w(t.notes)),
    d.select().from(t.reportFacts).where(w(t.reportFacts)),
    d.select().from(t.rules).where(w(t.rules)),
  ])
  return {
    meta: { id: ds.id, label: ds.label, today: ds.today, todayOverridden: ds.todayOverridden, sourceHash: ds.sourceHash ?? "" },
    users: users.map((u): UserRow => ({ user_id: u.userId, name: u.name, role: u.role, team_id: u.teamId })),
    teams: teams.map((x) => ({ team_id: x.teamId, name: x.name, lead_user_id: x.leadUserId })),
    areas: areas.map((a): AreaRow => ({
      area_id: a.areaId, name: a.name, team_id: a.teamId ?? "", center: { lat: a.centerLat ?? 0, lon: a.centerLon ?? 0 }, asset_ids: a.assetIds as string[],
    })),
    wells: wells.map((x): WellRow => ({
      asset_id: x.assetId, name: x.name, well_type: x.wellType, area_id: x.areaId, team_id: x.teamId ?? "",
      in_charge_user_id: x.inCharge ?? "", location: { lat: x.lat, lon: x.lon }, installed_on: x.installedOn ?? "",
      equipment: x.equipment as WellRow["equipment"], last_inspection: x.lastInspection as WellRow["last_inspection"],
      recorded_status: x.recordedStatus ?? "",
    })),
    inspections: ins.map((i): InspectionRow => ({
      asset_id: i.assetId, inspection_id: i.id, inspected_at: i.at, inspector_user_id: i.by ?? "", method: i.method ?? "",
      ambient_temp_c: i.amb, wellhead_temp_c: i.head, spill_detected: i.spill, spill_area_pct: i.pct, spill_est_volume_bbl: i.vol,
      evidence_images: [], notes: i.notes,
    })),
    maintenance: mnt.map((m): MaintenanceRow => ({
      asset_id: m.assetId, maintenance_id: m.maintenanceId, started_at: m.startedAt, completed_at: m.completedAt,
      maintenance_type: m.maintenanceType, equipment_kind: m.equipmentKind, issue: m.issue, action_taken: m.actionTaken ?? "",
      technician_user_id: m.technicianUserId, contractor: m.contractor, downtime_hours: m.downtimeHours ?? 0,
      cost_usd: { labor: m.costLabor ?? 0, parts: m.costParts ?? 0, total: m.costTotal ?? 0 },
      triggered_by_inspection_id: m.triggeredByInspectionId, report_file: m.reportFile,
    })),
    regEvents: reg.map((e): RegulatoryEventRow => ({
      asset_id: e.assetId, event_id: e.eventId, date: e.date, agency: e.agency ?? "", event_type: e.eventType, protocol_id: e.protocolId,
      related_inspection_id: e.relatedInspectionId, hours_to_report: e.hoursToReport, detail: e.detail ?? "", fine_usd: e.fineUsd, status: e.status ?? "",
    })),
    notes: notes.map((n): NoteRow => ({
      asset_id: n.assetId, note_id: n.noteId, created_at: n.createdAt, author_user_id: n.authorUserId ?? "", note_type: n.noteType,
      inspection_id: n.inspectionId, text: n.text, valid_from: n.validFrom, valid_to: n.validTo,
    })),
    facts: facts.map((f): FactRow => ({
      maintenanceId: f.maintenanceId, fact: f.fact as FactRow["fact"], key: f.key, value: f.value, detail: f.detail ?? undefined,
      quote: f.quote, docId: f.docId, section: f.section ?? undefined, method: f.method as FactRow["method"], confidence: f.confidence,
    })),
    rules: rules.map((r): RuleRow => ({
      key: r.key, wellType: r.wellType, status: r.status as RuleRow["status"], value: r.value ?? undefined, num: r.num ?? undefined,
      unit: r.unit ?? undefined, label: r.label, docId: r.docId ?? undefined, section: r.section ?? undefined, quote: r.quote ?? undefined,
      method: r.method as RuleRow["method"], inheritedFrom: r.inheritedFrom ?? undefined,
    })),
  }
}

export async function dbSizeReport(db: Db) {
  const total = await db.rows<{ size: string; pretty: string }>(
    sql`select pg_database_size(current_database())::text as size, pg_size_pretty(pg_database_size(current_database())) as pretty`,
  )
  const tables = await db.rows<{ name: string; bytes: string; pretty: string; index_bytes: string }>(
    sql`select c.relname as name, pg_total_relation_size(c.oid)::text as bytes, pg_size_pretty(pg_total_relation_size(c.oid)) as pretty,
        pg_indexes_size(c.oid)::text as index_bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by pg_total_relation_size(c.oid) desc`,
  )
  const idx = await db.rows<{ name: string; bytes: string; pretty: string }>(
    sql`select indexrelname as name, pg_relation_size(indexrelid)::text as bytes, pg_size_pretty(pg_relation_size(indexrelid)) as pretty
        from pg_stat_user_indexes order by pg_relation_size(indexrelid) desc limit 6`,
  )
  return { total: total[0], tables, topIndexes: idx }
}
