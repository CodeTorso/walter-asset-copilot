import { useMemo } from "react"
import { motion } from "motion/react"
import { Equal } from "lucide-react"
import { fmtNumber } from "@/lib/format"
import { Artifact, EvidenceChip } from "./shared"
import { ChartWithTable } from "./ChartTable"
import type { SchemaProps } from "./schemas"

/** Horizontal bars for comparing a few things. Ties are never broken silently: tied rows are grouped and labelled. */
export function BarChart({ title, columns, rows, rowEvidence, labelKey, valueKey, ties, order }: SchemaProps<"BarChart">) {
  const unit = columns.find((c) => c.key === valueKey)?.unit
  const items = useMemo(
    () =>
      rows
        .map((r, i) => ({ r, i, label: String(r[labelKey] ?? ""), value: Number(r[valueKey] ?? 0), id: String(r.asset_id ?? r[labelKey]) }))
        .sort((a, b) => (order === "given" ? a.i - b.i : b.value - a.value || a.label.localeCompare(b.label))),
    [rows, labelKey, valueKey, order],
  )
  // More than ~15 bars is unreadable in a chat column; the table toggle keeps the full set.
  const CAP = 15
  const all = items.length
  const shown = items.slice(0, CAP)
  const max = Math.max(1, ...shown.map((i) => i.value))
  const tieSet = new Set(ties ?? [])
  const tied = items.filter((i) => tieSet.has(i.id))
  const tieValue = tied.length > 1 ? tied[0].value : null

  const chart = (
    <ol className="space-y-1 px-4 py-3" aria-label={title ?? "Bar chart"}>
      {shown.map((it, k) => {
        const isTie = tieValue != null && it.value === tieValue && tieSet.has(it.id)
        const ev = rowEvidence?.[it.i]?.[0]
        return (
          <li key={it.id + k} className="grid grid-cols-[minmax(5.5rem,9rem)_1fr_auto] items-center gap-3 py-0.5 text-[13px]">
            <span className="truncate font-medium" title={it.label}>{it.label}</span>
            <div className="flex items-center gap-2">
              <div className="h-[18px] flex-1">
                <motion.div
                  className="h-full rounded-r-[4px] bg-(--series-1)"
                  style={{ transformOrigin: "left", width: `${Math.max(1.5, (it.value / max) * 100)}%` }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.2, delay: Math.min(k * 0.02, 0.12), ease: [0.2, 0, 0, 1] }}
                  role="img"
                  aria-label={`${it.label}: ${fmtNumber(it.value, unit)}`}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className="tnum min-w-14 text-right font-semibold">{fmtNumber(it.value, unit)}</span>
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
      {all > CAP && <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">Showing the top {CAP} of {all}. Switch to Table for all of them.</p>}
      {tieValue != null && (
        <p className="border-t border-border/70 bg-(--panel) px-4 py-2 text-xs text-muted-foreground">
          <Equal className="mr-1 -mt-0.5 inline size-3.5" aria-hidden />
          {tied.length} wells tie at {fmtNumber(tieValue, unit)}. All of them are shown, none is ranked above another.
        </p>
      )}
    </Artifact>
  )
}
