// Field-map data. Today: a fixture built from the raw sample dataset by scripts/build-field-map.ts.
// TODO(live): replace with a server fn that returns the same `FieldWell[]` from the engine (overlays applied).
import { useMemo } from "react"
import { useBootstrap } from "@/lib/stores/bootstrap"
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

const FIXTURE_BY_ID = new Map(FIELD.wells.map((w) => [w.id, w]))

/**
 * Wells for the map: live status from /api/bootstrap (overlays applied) when available, enriched with
 * fixture details (spills, open items, notes) for the sample dataset only. Falls back to the fixture.
 */
export function useFieldWells(): { wells: FieldWell[]; areas: FieldArea[]; today: string; live: boolean } {
  const { wells, areas, datasetId, today } = useBootstrap()
  return useMemo(() => {
    if (!wells) return { wells: FIELD.wells, areas: FIELD.areas, today: FIELD.today, live: false }
    const enrich = datasetId === "sample"
    const out = wells.map((b): FieldWell => {
      const f = enrich ? FIXTURE_BY_ID.get(b.wellId) : undefined
      const status = b.producing == null ? "unknown" : b.producing ? "producing" : "not_producing"
      return {
        id: b.wellId,
        name: b.name,
        type: b.wellType,
        areaId: b.areaId,
        area: b.areaName,
        lat: b.lat,
        lon: b.lon,
        inCharge: f?.inCharge ?? "",
        recordedStatus: b.recordedStatus,
        status,
        threshold: f?.threshold ?? null,
        latest:
          f?.latest && f.latest.at === b.lastInspectedAt
            ? { ...f.latest, delta: b.deltaC }
            : b.lastInspectedAt
              ? { id: "", at: b.lastInspectedAt, inspector: "", method: "", ambient: NaN, wellhead: NaN, delta: b.deltaC, spill: false, notes: null }
              : null,
        spills90: f?.spills90 ?? [],
        openRepairs: f?.openRepairs ?? [],
        openCompliance: f?.openCompliance ?? [],
        activeNotes: f?.activeNotes ?? [],
        downtime12m: f?.downtime12m ?? 0,
      }
    })
    const ar = areas.length ? areas.map((a) => ({ id: a.areaId, name: a.name, center: a.center })) : FIELD.areas
    return { wells: out, areas: ar, today: today ?? FIELD.today, live: true }
  }, [wells, areas, datasetId, today])
}
