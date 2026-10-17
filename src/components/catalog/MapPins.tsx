import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { List, Map as MapIcon, ScatterChart, X } from "lucide-react"
import type { EvidenceRef } from "@/contracts"
import { cn } from "@/lib/utils"
import { fmtNumber } from "@/lib/format"
import { Artifact, EvidenceChip, StatusBadge, normalizeStatus, statusColor, type StatusKey } from "./shared"
import type { SchemaProps } from "./schemas"

export type Pin = { id: string; label: string; lat: number; lon: number; status: StatusKey; detail: string; refs: EvidenceRef[] }

const TileMap = lazy(() => import("./MapTiles"))

/** Pin glyph: shape differs by status (circle = producing, diamond = not producing, triangle = other) so colour is never the only cue. */
export function PinGlyph({ status, selected, size = 16 }: { status: StatusKey; selected?: boolean; size?: number }) {
  const c = statusColor(status)
  const ring = selected ? "var(--foreground)" : "#fff"
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="drop-shadow-[0_1px_1.5px_rgb(0_0_0/.35)]">
      {status === "producing" ? (
        <circle cx="8" cy="8" r="5.6" fill={c} stroke={ring} strokeWidth="1.8" />
      ) : status === "not_producing" ? (
        <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.5" transform="rotate(45 8 8)" fill={c} stroke={ring} strokeWidth="1.8" />
      ) : (
        <path d="M8 2.2 14 13H2Z" fill={c} stroke={ring} strokeWidth="1.8" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function Detail({ pin, onClose }: { pin: Pin; onClose: () => void }) {
  return (
    <div className="surface absolute top-2 left-2 z-10 w-60 max-w-[calc(100%-1rem)] p-3 shadow-[var(--shadow-pop)]" role="dialog" aria-label={`${pin.label} details`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{pin.label}</p>
          <p className="caption ">{pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}</p>
        </div>
        <button onClick={onClose} aria-label="Close details" className="key -mt-1 -mr-1 grid size-6 place-items-center"><X className="size-3.5" aria-hidden /></button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={pin.status} size="sm" />
        {pin.detail && <span className="text-xs text-muted-foreground">{pin.detail}</span>}
      </div>
      {pin.refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{pin.refs.slice(0, 2).map((r) => <EvidenceChip key={r.id} evidence={r} />)}</div>
      )}
    </div>
  )
}

/** Projected scatter (equirectangular, cos-lat corrected). Works offline; pins are real buttons. */
export function PlotMap({ pins, selected, onSelect }: { pins: Pin[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const box = useMemo(() => {
    const lats = pins.map((p) => p.lat), lons = pins.map((p) => p.lon)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons)
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const w = Math.max((maxLon - minLon) * k, 1e-6), h = Math.max(maxLat - minLat, 1e-6)
    return { minLat, maxLat, minLon, k, w, h }
  }, [pins])
  const PAD = 7
  const pos = (p: Pin) => {
    const x = (((p.lon - box.minLon) * box.k) / box.w) * (100 - PAD * 2) + PAD
    const y = (1 - (p.lat - box.minLat) / box.h) * (100 - PAD * 2) + PAD
    return { x, y }
  }
  return (
    <div className="relative size-full overflow-hidden bg-(--panel)" onClick={() => onSelect(null)}>
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs><pattern id="mapgrid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="oklch(0.93 0 0)" strokeWidth="1" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#mapgrid)" />
      </svg>
      <p className="caption absolute right-2 bottom-1.5">Plot view: lat/lon projected, no basemap. North is up.</p>
      {pins.map((p) => {
        const { x, y } = pos(p)
        return (
          <button
            key={p.id}
            onClick={(e) => { e.stopPropagation(); onSelect(p.id === selected ? null : p.id) }}
            aria-label={`${p.label}, ${normalizeStatus(p.status)}`}
            aria-pressed={p.id === selected}
            className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-offset-1 transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-foreground"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <PinGlyph status={p.status} selected={p.id === selected} />
          </button>
        )
      })}
    </div>
  )
}

function PinList({ pins, selected, onSelect }: { pins: Pin[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="scroll-thin size-full divide-y divide-border/60 overflow-auto text-[13px]">
      {pins.map((p) => (
        <li key={p.id}>
          <button onClick={() => onSelect(p.id)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none", p.id === selected && "bg-muted/60")}>
            <span className="min-w-0"><span className="block truncate font-medium">{p.label}</span><span className="caption ">{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</span></span>
            <span className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{p.detail}</span><StatusBadge status={p.status} size="sm" /></span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function MapPins({ title, rows, rowEvidence, latKey, lonKey, labelKey, statusKey, columns }: SchemaProps<"MapPins">) {
  const [view, setView] = useState<"map" | "plot" | "list">("map")
  const [selected, setSelected] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const deltaCol = columns.find((c) => c.type === "number" && c.key !== latKey && c.key !== lonKey)
  const pins = useMemo<Pin[]>(
    () =>
      rows
        .map((r, i) => ({
          id: String(r.asset_id ?? r[labelKey] ?? i),
          label: String(r[labelKey] ?? ""),
          lat: Number(r[latKey]),
          lon: Number(r[lonKey]),
          status: statusKey ? normalizeStatus(r[statusKey]) : ("data" as StatusKey),
          detail: deltaCol ? `${fmtNumber(r[deltaCol.key], deltaCol.unit)}` : "",
          refs: rowEvidence?.[i] ?? [],
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
    [rows, rowEvidence, latKey, lonKey, labelKey, statusKey, deltaCol],
  )
  const sel = pins.find((p) => p.id === selected) ?? null
  const counts = pins.reduce<Record<string, number>>((m, p) => ((m[p.status] = (m[p.status] ?? 0) + 1), m), {})
  const tabs = [["map", "Map", MapIcon], ["plot", "Plot", ScatterChart], ["list", "List", List]] as const

  return (
    <Artifact
      title={title}
      className="w-full"
      subtitle={pins.length ? `${pins.length} wells` : undefined}
      aside={
        <div role="tablist" aria-label="Map view" className="inline-flex rounded-[4px] border border-border bg-(--panel) p-0.5 text-[11px]">
          {tabs.map(([k, t, Icon]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn("inline-flex items-center gap-1 rounded-[3px] px-2 py-1 font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none", view === k ? "bg-card text-foreground shadow-[0_1px_0_rgb(0_0_0/.05),inset_0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="size-3" aria-hidden />{t}
            </button>
          ))}
        </div>
      }
    >
      {pins.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No wells with coordinates to show.</p>
      ) : (
        <>
          <div className="relative h-72 w-full">
            {view === "map" && mounted && (
              <Suspense fallback={<div className="size-full animate-pulse bg-muted/60" />}>
                <TileMap pins={pins} selected={selected} onSelect={setSelected} onFail={() => setView("plot")} />
              </Suspense>
            )}
            {view === "plot" && <PlotMap pins={pins} selected={selected} onSelect={setSelected} />}
            {view === "list" && <PinList pins={pins} selected={selected} onSelect={(id) => setSelected(id)} />}
            {sel && view !== "list" && <Detail pin={sel} onClose={() => setSelected(null)} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/70 px-4 py-2">
            {(["producing", "not_producing"] as StatusKey[]).filter((k) => counts[k]).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><PinGlyph status={k} size={14} />{k === "producing" ? "Producing" : "Not producing"} <span className="font-medium text-foreground">{counts[k]}</span></span>
            ))}
          </div>
        </>
      )}
    </Artifact>
  )
}
