import { lazy, Suspense, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Box, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FIELD, FLAG_META, STATUS_COLOR, flagsOf, fmtDate, type Flag } from "./data"
import { FieldSvg } from "./FieldSvg"
import { StatusPill, WellDetail } from "./WellDetail"

const FieldMapGL = lazy(() => import("./FieldMapGL"))
const FILTERS: Flag[] = ["not_producing", "spill", "compliance", "mismatch"]

export default function FieldMapPanel({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<Set<Flag>>(new Set(["not_producing", "spill", "compliance"]))
  const [selected, setSelected] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  const [tilt, setTilt] = useState(false)
  const [tilesFailed, setTilesFailed] = useState(false)

  const wells = FIELD.wells
  const byFlag = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, wells.filter((w) => flagsOf(w).includes(f))])) as Record<Flag, typeof wells>, [wells])
  const flagged = useMemo(() => new Set(wells.filter((w) => flagsOf(w).some((f) => active.has(f))).map((w) => w.id)), [wells, active])
  const attention = wells.filter((w) => flagged.has(w.id) && (!area || w.areaId === area))
  const sel = wells.find((w) => w.id === selected) ?? null
  const counts = { producing: wells.filter((w) => w.status === "producing").length, not_producing: wells.filter((w) => w.status === "not_producing").length }
  const focus = useMemo(() => {
    if (sel) return { lon: sel.lon, lat: sel.lat, zoom: 13.5 }
    const a = FIELD.areas.find((x) => x.id === area)
    return a ? { lon: a.center.lon, lat: a.center.lat, zoom: 11.6 } : null
  }, [sel, area])

  const toggle = (f: Flag) => setActive((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n })

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Field map</h2>
          <p className="text-[12px] text-muted-foreground">
            Latest weekly inspection per well, as of {fmtDate(FIELD.today)}
          </p>
        </div>
        <button type="button" aria-pressed={tilt} onClick={() => setTilt((t) => !t)} disabled={tilesFailed} className="btn-key h-8 gap-1.5 px-2.5 text-[12.5px]" title="Tilt the map and raise each well by its downtime in the last 12 months">
          <Box className="size-3.5" /> {tilt ? "Flat view" : "3D downtime"}
        </button>
        <button type="button" onClick={onClose} className="btn-key size-8" aria-label="Close field map">
          <X className="size-4" />
        </button>
      </div>

      <div className="relative h-[42%] min-h-[220px] shrink-0 border-b border-border">
        {tilesFailed ? (
          <FieldSvg wells={wells} flagged={flagged} selected={selected} onSelect={setSelected} />
        ) : (
          <Suspense fallback={<div className="grid size-full place-items-center bg-[#f5f7f9] text-[13px] text-muted-foreground">Loading map…</div>}>
            <FieldMapGL wells={wells} flagged={flagged} selected={selected} onSelect={setSelected} onFail={() => setTilesFailed(true)} tilt={tilt} focus={focus} />
          </Suspense>
        )}
        <div className="pointer-events-none absolute top-2 left-2 flex flex-col gap-1 rounded-[5px] border border-border bg-white/95 px-2 py-1.5 text-[11.5px] shadow-[0_2px_6px_-2px_rgb(16_24_40/.15)]">
          {(["producing", "not_producing"] as const).map((k) => (
            <span key={k} data-tnum className="flex items-center gap-1.5">
              <span className="size-2 rounded-full ring-1 ring-white" style={{ background: STATUS_COLOR[k] }} />
              {k === "producing" ? "Producing" : "Not producing"} <b className="font-semibold">{counts[k]}</b>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border border-[#c2281c] bg-[#c2281c1f]" /> Needs a look
          </span>
          {tilt && <span className="text-muted-foreground">Height = downtime, 12 months</span>}
        </div>
        {tilesFailed && <div className="absolute right-2 bottom-2 rounded-[4px] bg-white/90 px-1.5 py-0.5 text-[11px] text-muted-foreground">Map tiles unavailable, showing positions only</div>}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          {sel ? (
            <motion.div key={sel.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.16 }}>
              <WellDetail w={sel} onBack={() => setSelected(null)} />
            </motion.div>
          ) : (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <div className="space-y-2.5 px-4 pt-3 pb-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Highlight">
                  {FILTERS.map((f) => (
                    <button key={f} type="button" aria-pressed={active.has(f)} onClick={() => toggle(f)} className={cn("btn-key h-8 gap-1.5 px-2.5 text-[12.5px]", active.has(f) && "border-[#9aa6b6] bg-[#eef2f6]")}>
                      <span className={cn("size-2 rounded-full", !active.has(f) && "opacity-35")} style={{ background: FLAG_META[f].color }} />
                      {FLAG_META[f].label}
                      <b data-tnum className="font-semibold">{byFlag[f].length}</b>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Area">
                  {[{ id: null, name: "All areas" }, ...FIELD.areas].map((a) => (
                    <button key={a.id ?? "all"} type="button" aria-pressed={area === a.id} onClick={() => setArea(a.id)} className={cn("h-7 rounded-[4px] border px-2 text-[12px] transition-colors", area === a.id ? "border-ink bg-ink text-white" : "border-border bg-white hover:border-edge")}>
                      {a.id ?? a.name}
                    </button>
                  ))}
                </div>
              </div>
              <h3 className="px-4 pt-2 pb-1.5 text-[12.5px] font-semibold text-muted-foreground">
                Needs a look <span data-tnum>({attention.length})</span>
              </h3>
              <ul className="px-2 pb-3">
                {attention.map((w) => (
                  <li key={w.id}>
                    <button type="button" onClick={() => setSelected(w.id)} className="ring-focus flex w-full items-center gap-3 rounded-[5px] px-2 py-2 text-left hover:bg-[#f3f5f8]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{w.name}</div>
                        <div className="flex flex-wrap gap-x-2 text-[12px] text-muted-foreground">
                          {flagsOf(w).filter((f) => active.has(f)).map((f) => (
                            <span key={f} className="inline-flex items-center gap-1">
                              <span className="size-1.5 rounded-full" style={{ background: FLAG_META[f].color }} />
                              {FLAG_META[f].label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <StatusPill status={w.status} />
                    </button>
                  </li>
                ))}
                {!attention.length && <li className="px-2 py-3 text-[13px] text-muted-foreground">Nothing flagged here with the current highlights.</li>}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
