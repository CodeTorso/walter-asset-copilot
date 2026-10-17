import { useMemo } from "react"
import { motion } from "motion/react"
import { Equal } from "lucide-react"
import { fmtNumber } from "@/lib/format"
import { Artifact, EvidenceChip } from "./shared"
import { ChartWithTable } from "./ChartTable"
import type { SchemaProps } from "./schemas"

/** Horizontal bars for comparing a few things. Ties are never broken silently: tied rows are grouped and labelled. */
export function BarChart({ title, columns, rows, rowEvidence, labelKey, valueKey, ties, order, highlight }: SchemaProps<"BarChart">) {
  const hl = new Set(highlight ?? [])
  const unit = columns.find((c) => c.key === valueKey)?.unit
  const items = useMemo(
    () =>
      rows
        .map((r, i) => ({ r, i, label: String(r[labelKey] ?? ""), value: r[valueKey] == null || r[valueKey] === "" ? NaN : Number(r[valueKey]), id: String(r.asset_id ?? r[labelKey]) }))
        // Years and months read in time order; everything else largest first.
        .sort((a, b) =>
          order === "given"
            ? a.i - b.i
            : /^\d{4}(-\d{2})?$/.test(a.label) && /^\d{4}(-\d{2})?$/.test(b.label)
              ? a.label.localeCompare(b.label)
              : (Number.isFinite(b.value) ? b.value : -Infinity) - (Number.isFinite(a.value) ? a.value : -Infinity) || a.label.localeCompare(b.label),
        ),
    [rows, labelKey, valueKey, order],
  )
  // More than ~15 bars is unreadable in a chat column; the table toggle keeps the full set.
  const CAP = 15
  const all = items.length
  const shown = items.slice(0, CAP)
  const min = Math.min(0, ...shown.map((i) => Number.isFinite(i.value) ? i.value : 0))
  const max = Math.max(0, ...shown.map((i) => Number.isFinite(i.value) ? i.value : 0))
  const range = max - min || 1
  const zero = (-min / range) * 100
  const tieSet = new Set(ties ?? [])
  const tied = items.filter((i) => tieSet.has(i.id))
  const tieValue = tied.length > 1 && Number.isFinite(tied[0].value) ? tied[0].value : null

  const chart = (
    <ol className="space-y-1 px-4 py-3" aria-label={title ?? "Bar chart"}>
      {shown.map((it, k) => {
        const isTie = tieValue != null && it.value === tieValue && tieSet.has(it.id)
        const ev = rowEvidence?.[it.i]?.[0]
        return (
          <li key={it.id + k} className="grid grid-cols-[minmax(4rem,8rem)_minmax(2rem,1fr)_auto] items-center gap-2 py-0.5 text-[13px]">
            <span className="break-words font-medium leading-5" title={it.label}>{it.label}</span>
            <div className="flex items-center gap-2">
              <div className="relative h-[18px] min-w-0 flex-1">
                {min < 0 && <span aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: `${zero}%` }} />}
                <motion.div
                  className={`absolute h-full rounded-[4px] ${hl.has(it.label) || hl.has(it.id) ? "bg-(--warn)" : "bg-(--series-1)"}`}
                  style={{ transformOrigin: it.value < 0 ? "right" : "left", left: `${Number.isFinite(it.value) ? ((Math.min(it.value, 0) - min) / range) * 100 : zero}%`, width: `${Number.isFinite(it.value) ? (Math.abs(it.value) / range) * 100 : 0}%` }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.2, delay: Math.min(k * 0.02, 0.12), ease: [0.2, 0, 0, 1] }}
                  role="img"
                  aria-label={`${it.label}: ${Number.isFinite(it.value) ? fmtNumber(it.value, unit) : "No data"}`}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className="tnum min-w-14 text-right font-semibold">{Number.isFinite(it.value) ? fmtNumber(it.value, unit) : "No data"}</span>
              {isTie && (
                <span className="inline-flex items-center gap-0.5 rounded-[4px] border border-border bg-(--panel) px-1 py-[2px] text-[10px] font-medium text-muted-foreground" title={`Tied with ${tied.length - 1} other wells`}>
                  <Equal className="size-3" aria-hidden />tie
                </span>
              )}
              {ev && <EvidenceChip evidence={ev} className="hidden sm:inline-flex" />}
            </div>
          </li>
        )
      })}
    </ol>
  )
  return (
    <Artifact title={title} className="w-full">
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing to compare in this window.</p>
      ) : (
        <ChartWithTable label={title ?? "Bar chart"} columns={columns} rows={rows} chart={chart} />
      )}
      {all > CAP && <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">Chart shows {CAP} of {all} items. Switch to Table for all of them.</p>}
      {tieValue != null && (
        <p className="border-t border-border/70 bg-(--panel) px-4 py-2 text-xs text-muted-foreground">
          <Equal className="mr-1 -mt-0.5 inline size-3.5" aria-hidden />
          {tied.length} wells tie at {fmtNumber(tieValue, unit)}. Tied values have equal rank. {tied.some((item) => !shown.includes(item)) && "Switch to Table to see all tied items."}
        </p>
      )}
    </Artifact>
  )
}
