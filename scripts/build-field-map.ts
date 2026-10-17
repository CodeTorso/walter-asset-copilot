// Builds the field-map fixture from the raw sample dataset (read-only).
// Output: src/components/shell/field-map/wells.json. Replace with the live engine once wired.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = "RESOURCE/flytbase-ahc-swe-asset-intelligence-dataset/sample-data"
const TODAY = "2026-10-16"
const DELTA: Record<string, number> = { T200: 15, T350: 20 } // well-type manuals (§ producing threshold)
const jsonl = (p: string) => {
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
const users = Object.fromEntries(
  JSON.parse(readFileSync(join(ROOT, "fleet/users.json"), "utf8")).users.map((u: any) => [u.user_id, u.name]),
)
const areas = JSON.parse(readFileSync(join(ROOT, "fleet/areas.json"), "utf8")).areas
const areaName = Object.fromEntries(areas.map((a: any) => [a.area_id, a.name]))
const cutoff = new Date(new Date(TODAY).getTime() - 90 * 864e5).toISOString()

const wells = readdirSync(join(ROOT, "assets")).sort().map((id) => {
  const dir = join(ROOT, "assets", id)
  const m = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"))
  const notes = jsonl(join(dir, "context.jsonl"))
  const corrected = new Set(notes.filter((n) => n.note_type === "correction" && n.inspection_id).map((n) => n.inspection_id))
  const ins = jsonl(join(dir, "inspections.jsonl")).sort((a, b) => a.inspected_at.localeCompare(b.inspected_at))
  const last = ins.at(-1)
  const delta = last ? +(last.wellhead_temp_c - last.ambient_temp_c).toFixed(1) : null
  const threshold = DELTA[m.well_type] ?? null
  const status = delta == null || threshold == null ? "unknown" : delta >= threshold ? "producing" : "not_producing"
  const spills90 = ins.filter((i) => i.spill_detected && i.inspected_at >= cutoff && !corrected.has(i.inspection_id))
  const mnt = jsonl(join(dir, "maintenance.jsonl"))
  const openRepairs = mnt.filter((x) => !x.completed_at).map((x) => ({ id: x.maintenance_id, issue: x.issue, since: x.started_at.slice(0, 10) }))
  const reg = jsonl(join(dir, "regulatory-events.jsonl"))
  const openCompliance = reg.filter((r) => r.status === "open").map((r) => ({ id: r.event_id, type: r.event_type, date: r.date, detail: r.detail }))
  const activeNotes = notes
    .filter((n) => n.note_type !== "correction" && (!n.valid_to || n.valid_to >= TODAY) && (!n.valid_from || n.valid_from <= TODAY))
    .slice(-3)
    .map((n) => ({ id: n.note_id, type: n.note_type, author: users[n.author_user_id] ?? n.author_user_id, text: n.text, at: n.created_at.slice(0, 10) }))
  const downtime12m = mnt
    .filter((x) => x.started_at >= new Date(new Date(TODAY).getTime() - 365 * 864e5).toISOString())
    .reduce((s, x) => s + (x.downtime_hours ?? 0), 0)
  return {
    id,
    name: m.name,
    type: m.well_type,
    areaId: m.area_id,
    area: areaName[m.area_id] ?? m.area_id,
    lat: m.location.lat,
    lon: m.location.lon,
    inCharge: users[m.in_charge_user_id] ?? m.in_charge_user_id,
    recordedStatus: m.recorded_status,
    status,
    threshold,
    latest: last
      ? {
          id: last.inspection_id,
          at: last.inspected_at,
          inspector: users[last.inspector_user_id] ?? last.inspector_user_id,
          method: last.method,
          ambient: last.ambient_temp_c,
          wellhead: last.wellhead_temp_c,
          delta,
          spill: last.spill_detected,
          notes: last.notes || null,
        }
      : null,
    spills90: spills90.map((s) => ({ id: s.inspection_id, at: s.inspected_at.slice(0, 10), bbl: s.spill_est_volume_bbl })),
    openRepairs,
    openCompliance,
    activeNotes,
    downtime12m,
  }
})

writeFileSync(
  "src/components/shell/field-map/wells.json",
  JSON.stringify({ today: TODAY, areas: areas.map((a: any) => ({ id: a.area_id, name: a.name, center: a.center })), wells }),
)
const c = (f: (w: any) => boolean) => wells.filter(f).length
console.log({ wells: wells.length, notProducing: c((w) => w.status === "not_producing"), spills: c((w) => w.spills90.length), repairs: c((w) => w.openRepairs.length), compliance: c((w) => w.openCompliance.length) })
