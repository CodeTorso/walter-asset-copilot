import { eq } from "drizzle-orm"
import type {
  AreaRow,
  InspectionRow,
  MaintenanceRow,
  NoteRow,
  RegulatoryEventRow,
  UserRow,
  WellRow,
} from "../../contracts"
import type { Db } from "../db/client"
import { datasets } from "../db/schema"
import { readSnapshotRows } from "../ingest/write"
import type { FactRow, RuleRow, SnapshotRows } from "../ingest/types"

export type Snapshot = {
  datasetId: string
  version: number
  today: string
  label: string
  rows: SnapshotRows
  users: Map<string, UserRow>
  areas: Map<string, AreaRow>
  wells: Map<string, WellRow>
  wellList: WellRow[]
  inspByWell: Map<string, InspectionRow[]>
  inspById: Map<string, InspectionRow>
  mntByWell: Map<string, MaintenanceRow[]>
  mntById: Map<string, MaintenanceRow>
  mntByTrigger: Map<string, MaintenanceRow[]>
  regByWell: Map<string, RegulatoryEventRow[]>
  regByInsp: Map<string, RegulatoryEventRow[]>
  notesByWell: Map<string, NoteRow[]>
  notesById: Map<string, NoteRow>
  factsByMnt: Map<string, FactRow[]>
  rules: Map<string, RuleRow>
}

function group<T>(items: T[], key: (t: T) => string | null | undefined, sort?: (a: T, b: T) => number) {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    if (!k) continue
    const l = m.get(k)
    if (l) l.push(it)
    else m.set(k, [it])
  }
  if (sort) for (const l of m.values()) l.sort(sort)
  return m
}

export function buildSnapshot(rows: SnapshotRows, version = 1): Snapshot {
  const rules = new Map<string, RuleRow>()
  for (const r of rows.rules) rules.set(`${r.key}|${r.wellType}`, r)
  return {
    datasetId: rows.meta.id,
    version,
    today: rows.meta.today,
    label: rows.meta.label,
    rows,
    users: new Map(rows.users.map((u) => [u.user_id, u])),
    areas: new Map(rows.areas.map((a) => [a.area_id, a])),
    wells: new Map(rows.wells.map((w) => [w.asset_id, w])),
    wellList: [...rows.wells].sort((a, b) => a.asset_id.localeCompare(b.asset_id)),
    inspByWell: group(rows.inspections, (i) => i.asset_id, (a, b) => a.inspected_at.localeCompare(b.inspected_at)),
    inspById: new Map(rows.inspections.map((i) => [i.inspection_id, i])),
    mntByWell: group(rows.maintenance, (m) => m.asset_id, (a, b) => a.started_at.localeCompare(b.started_at)),
    mntById: new Map(rows.maintenance.map((m) => [m.maintenance_id, m])),
    mntByTrigger: group(rows.maintenance, (m) => m.triggered_by_inspection_id),
    regByWell: group(rows.regEvents, (e) => e.asset_id, (a, b) => a.date.localeCompare(b.date)),
    regByInsp: group(rows.regEvents, (e) => e.related_inspection_id),
    notesByWell: group(rows.notes, (n) => n.asset_id, (a, b) => a.created_at.localeCompare(b.created_at)),
    notesById: new Map(rows.notes.map((n) => [n.note_id, n])),
    factsByMnt: group(rows.facts, (f) => f.maintenanceId),
    rules,
  }
}

const cache = new Map<string, Snapshot>()
const key = Symbol.for("asset-copilot.snapshots")
const store = ((globalThis as Record<symbol, unknown>)[key] ??= cache) as Map<string, Snapshot>

/** Snapshot per dataset, cached by (datasetId, version). The version check is one small query. */
export async function getSnapshot(db: Db, datasetId: string): Promise<Snapshot> {
  const r = await db.drizzle.select({ version: datasets.version }).from(datasets).where(eq(datasets.id, datasetId))
  if (!r[0]) throw new Error(`Unknown dataset: ${datasetId}`)
  const hit = store.get(datasetId)
  if (hit && hit.version === r[0].version) return hit
  const rows = await readSnapshotRows(db, datasetId)
  const snap = buildSnapshot(rows, r[0].version)
  store.set(datasetId, snap)
  return snap
}

export function clearSnapshotCache() {
  store.clear()
}
