import { useMemo } from "react"
import type { FieldWell } from "./data"
import { STATUS_COLOR } from "./data"

/** Projected scatter fallback when map tiles are unavailable. Same interactions, no basemap. */
export function FieldSvg({ wells, flagged, selected, onSelect }: { wells: FieldWell[]; flagged: Set<string>; selected: string | null; onSelect: (id: string | null) => void }) {
  const W = 440, H = 300, PAD = 18
  const pos = useMemo(() => {
    const lats = wells.map((w) => w.lat), lons = wells.map((w) => w.lon)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons)
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const sx = (maxLon - minLon) * k, sy = maxLat - minLat
    const s = Math.min((W - PAD * 2) / sx, (H - PAD * 2) / sy)
    const ox = (W - sx * s) / 2, oy = (H - sy * s) / 2
    return (w: FieldWell) => ({ x: ox + (w.lon - minLon) * k * s, y: H - oy - (w.lat - minLat) * s })
  }, [wells])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="size-full bg-canvas" role="img" aria-label="Well locations (offline plot)" onClick={() => onSelect(null)}>
      {wells.map((w) => {
        const p = pos(w)
        return (
          <g key={w.id} onClick={(e) => { e.stopPropagation(); onSelect(w.id) }} className="cursor-pointer">
            {flagged.has(w.id) && <circle cx={p.x} cy={p.y} r={6.5} fill="rgba(194,40,28,.12)" stroke="#c2281c" strokeWidth={1} />}
            <circle cx={p.x} cy={p.y} r={3.4} fill={STATUS_COLOR[w.status]} stroke="#fff" strokeWidth={1} />
            {w.id === selected && <circle cx={p.x} cy={p.y} r={8.5} fill="none" stroke="#1c1c1c" strokeWidth={2} />}
            <title>{w.name}</title>
          </g>
        )
      })}
    </svg>
  )
}
