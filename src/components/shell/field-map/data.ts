// Field-map data. Today: a fixture built from the raw sample dataset by scripts/build-field-map.ts.
// TODO(live): replace with a server fn that returns the same `FieldWell[]` from the engine (overlays applied).
import raw from "./wells.json"

export type FieldWell = {
  id: string
  name: string
  type: string
  areaId: string
  area: string
  lat: number
  lon: number
  inCharge: string
  recordedStatus: string
  status: "producing" | "not_producing" | "unknown"
  threshold: number | null
  latest: {
    id: string
    at: string
    inspector: string
    method: string
    ambient: number
    wellhead: number
    delta: number | null
    spill: boolean
    notes: string | null
  } | null
  spills90: { id: string; at: string; bbl: number | null }[]
  openRepairs: { id: string; issue: string; since: string }[]
  openCompliance: { id: string; type: string; date: string; detail: string }[]
  activeNotes: { id: string; type: string; author: string; text: string; at: string }[]
  downtime12m: number
}
export type FieldArea = { id: string; name: string; center: { lat: number; lon: number } }

export const FIELD = raw as unknown as { today: string; areas: FieldArea[]; wells: FieldWell[] }

export type Flag = "not_producing" | "spill" | "compliance" | "mismatch"
export const FLAG_META: Record<Flag, { label: string; color: string }> = {
  not_producing: { label: "Not producing", color: "#c27803" },
  spill: { label: "Spill, last 90 days", color: "#c2281c" },
  compliance: { label: "Open compliance item", color: "#6941c6" },
  mismatch: { label: "Record says otherwise", color: "#475467" },
}
/** Record status "active" but the latest inspection says not producing (or the reverse). */
export const isMismatch = (w: FieldWell) =>
  (w.recordedStatus === "active" && w.status === "not_producing") || (w.recordedStatus === "down" && w.status === "producing")
export const flagsOf = (w: FieldWell): Flag[] => {
  const f: Flag[] = []
  if (w.status === "not_producing") f.push("not_producing")
  if (w.spills90.length) f.push("spill")
  if (w.openCompliance.length) f.push("compliance")
  if (isMismatch(w)) f.push("mismatch")
  return f
}
export const STATUS_COLOR = { producing: "#1f8a4c", not_producing: "#c27803", unknown: "#8a96a6" } as const
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"
