import { useState, type ReactNode } from "react"
import { BarChart3, Table2 } from "lucide-react"
import type { Column, Row } from "@/contracts"
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Chart | Table switch. Every chart ships a table view so identity is never colour-only. */
export function ChartWithTable({
  chart,
  columns,
  rows,
  label,
}: {
  chart: ReactNode
  columns: Column[]
  rows: Row[]
  label: string
}) {
  const [view, setView] = useState<"chart" | "table">("chart")
  return (
    <div>
      <div className="flex justify-end px-3 pt-2">
        <div role="tablist" aria-label={`${label} view`} className="inline-flex rounded-[4px] border border-border bg-(--panel) p-0.5 text-[11px]">
          {(
            [
              ["chart", "Chart", BarChart3],
              ["table", "Table", Table2],
            ] as const
          ).map(([k, text, Icon]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={cn("inline-flex items-center gap-1 rounded-[3px] px-2 py-1 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none", view === k ? "bg-card text-foreground shadow-[0_1px_0_rgb(0_0_0/.05),inset_0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon className="size-3" aria-hidden />
              {text}
            </button>
          ))}
        </div>
      </div>
      {view === "chart" ? (
        chart
      ) : (
        <div className="scroll-thin max-h-72 overflow-auto px-3 pb-3 pt-2">
          <table className="w-full min-w-max text-[12px]">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn("sticky top-0 border-b border-border bg-card px-2 py-1.5 font-medium text-muted-foreground", c.type === "number" ? "text-right" : "text-left")}>
                    {c.label}
                    {c.unit ? ` (${c.unit})` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("tnum px-2 py-1", c.type === "number" ? "text-right" : "text-left")}>
                      {c.type === "date" ? fmtDate(r[c.key]) : c.type === "datetime" ? fmtDateTime(r[c.key]) : c.type === "number" ? fmtNumber(r[c.key]) : String(r[c.key] ?? "–")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
