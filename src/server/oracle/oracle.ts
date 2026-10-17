/// <reference types="node" />
// Independent oracle: reads the raw dataset files directly and recomputes answers with plain loops.
// It shares no code with the engine (no registry, no overlays, no snapshot). Thresholds are inputs.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

type J = Record<string, any>

export type Raw = {
  wells: J[]
  insp: J[]
  mnt: J[]
  reg: J[]
  notes: J[]
  areas: J[]
  today: string
}

const jsonl = (p: string): J[] =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : []

export function loadRaw(root: string): Raw {
  const assets = join(root, "assets")
  const wells: J[] = []
  const insp: J[] = []
  const mnt: J[] = []
  const reg: J[] = []
  const notes: J[] = []
  for (const d of readdirSync(assets).sort()) {
    const meta = join(assets, d, "metadata.json")
    if (!existsSync(meta)) continue
    wells.push(JSON.parse(readFileSync(meta, "utf8")))
    insp.push(...jsonl(join(assets, d, "inspections.jsonl")))
    mnt.push(...jsonl(join(assets, d, "maintenance.jsonl")))
    reg.push(...jsonl(join(assets, d, "regulatory-events.jsonl")))
    notes.push(...jsonl(join(assets, d, "context.jsonl")))
  }
  const areas = JSON.parse(readFileSync(join(root, "fleet", "areas.json"), "utf8")).areas
  const last = insp.map((i) => i.inspected_at as string).sort().pop()!
  const t = new Date(last.slice(0, 10) + "T00:00:00Z")
  t.setUTCDate(t.getUTCDate() + 1)
  return { wells, insp, mnt, reg, notes, areas, today: t.toISOString().slice(0, 10) }
}

export type Thresholds = Record<string, number>

const typeOf = (raw: Raw, id: string) => raw.wells.find((w) => w.asset_id === id)!.well_type as string
const corrected = (raw: Raw) => new Set(raw.notes.filter((n) => n.note_type === "correction").map((n) => n.inspection_id as string))

/** latest-inspection producing flag for every well */
export function latestProducing(raw: Raw, th: Thresholds, overrides: Record<string, number> = {}): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const w of raw.wells) {
    const mine = raw.insp.filter((i) => i.asset_id === w.asset_id).sort((a, b) => (a.inspected_at < b.inspected_at ? -1 : 1))
    const l = mine[mine.length - 1]
    if (!l) continue
    const head = overrides[l.inspection_id] ?? l.wellhead_temp_c
    out[w.asset_id] = head - l.ambient_temp_c >= th[w.well_type]! - 1e-9
  }
  return out
}

export function downtimeDays(raw: Raw, th: Thresholds, from: string, to: string, wellIds?: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const w of raw.wells) {
    if (wellIds && !wellIds.includes(w.asset_id)) continue
    let n = 0
    for (const i of raw.insp) {
      if (i.asset_id !== w.asset_id) continue
      const d = (i.inspected_at as string).slice(0, 10)
      if (d < from || d > to) continue
      if (i.wellhead_temp_c - i.ambient_temp_c < th[w.well_type]! - 1e-9) n++
    }
    out[w.asset_id] = n * 7
  }
  return out
}

export function realSpills(raw: Raw, from: string, to: string, volumeOverrides: Record<string, number> = {}) {
  const fixed = corrected(raw)
  return raw.insp
    .filter((i) => i.spill_detected && !fixed.has(i.inspection_id))
    .filter((i) => (i.inspected_at as string).slice(0, 10) >= from && (i.inspected_at as string).slice(0, 10) <= to)
    .map((i) => ({ well: i.asset_id as string, date: (i.inspected_at as string).slice(0, 10), id: i.inspection_id as string, vol: (volumeOverrides[i.inspection_id] ?? i.spill_est_volume_bbl) as number }))
}

export function spillGrid(raw: Raw, year: number) {
  const area = new Map<string, string>()
  for (const w of raw.wells) area.set(w.asset_id, w.area_id)
  const grid: Record<string, number[]> = {}
  for (const a of raw.areas) grid[a.area_id] = Array(12).fill(0)
  for (const s of realSpills(raw, `${year}-01-01`, `${year}-12-31`)) grid[area.get(s.well)!]![Number(s.date.slice(5, 7)) - 1]!++
  return grid
}

export function repairCost(raw: Raw, wellId: string, year: number): number {
  return raw.mnt.filter((m) => m.asset_id === wellId && (m.started_at as string).startsWith(String(year))).reduce((s, m) => s + m.cost_usd.total, 0)
}

export function openRepairs(raw: Raw, today: string): string[] {
  return raw.mnt.filter((m) => !m.completed_at || (m.completed_at as string).slice(0, 10) > today).map((m) => m.maintenance_id)
}

export function rcaWells(raw: Raw, kind: string, fromDate: string, minCount: (type: string) => number, wellIds: string[]) {
  const out: Record<string, number> = {}
  for (const id of wellIds) {
    const n = raw.mnt.filter((m) => m.asset_id === id && m.maintenance_type === "corrective" && m.equipment_kind === kind && (m.started_at as string).slice(0, 10) >= fromDate).length
    if (n >= minCount(typeOf(raw, id))) out[id] = n
  }
  return out
}
