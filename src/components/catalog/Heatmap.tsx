import { useMemo, useState } from "react"
import { fmtMonth } from "@/lib/format"
import { Artifact } from "./shared"
import { ChartWithTable } from "./ChartTable"
import type { SchemaProps } from "./schemas"

const fmtCol = (c: string) => (/^\d{4}-\d{2}$/.test(c) ? fmtMonth(c) : c)
const cell = (v: number, max: number) => {
  const t = max > 0 ? v / max : 0
  const L = 0.975 - t * 0.5
  const C = v === 0 ? 0 : 0.025 + t * 0.14
  return { bg: v === 0 ? "oklch(0.985 0 0)" : `oklch(${L.toFixed(3)} ${C.toFixed(3)} var(--seq-hue, 250))`, fg: t > 0.5 ? "#fff" : "oklch(0.25 0 0)" }
}

/** Two dimensions as a single-hue sequential grid, with value labels and totals. */
export function Heatmap({ title, columns, rows, rowKey, colKey, valueKey }: SchemaProps<"Heatmap">) {
  const [hover, setHover] = useState<string | null>(null)
  const unit = columns.find((c) => c.key === valueKey)?.unit
  const { rs, cs, grid, rowTot, colTot, total, max } = useMemo(() => {
    const rs = [...new Set(rows.map((r) => String(r[rowKey])))]
    const cs = [...new Set(rows.map((r) => String(r[colKey])))].sort()
    const grid = new Map<string, number>()
    for (const r of rows) grid.set(`${r[rowKey]}|${r[colKey]}`, (grid.get(`${r[rowKey]}|${r[colKey]}`) ?? 0) + Number(r[valueKey] ?? 0))
    const rowTot = Object.fromEntries(rs.map((a) => [a, cs.reduce((s, c) => s + (grid.get(`${a}|${c}`) ?? 0), 0)]))
    const colTot = Object.fromEntries(cs.map((c) => [c, rs.reduce((s, a) => s + (grid.get(`${a}|${c}`) ?? 0), 0)]))
    return { rs, cs, grid, rowTot, colTot, total: Object.values(rowTot).reduce((a, b) => a + b, 0), max: Math.max(0, ...grid.values()) }
  }, [rows, rowKey, colKey, valueKey])

  const chart = (
    <div className="scroll-thin overflow-x-auto px-4 pb-3 pt-2">
      <table className="tnum w-full min-w-[27rem] border-separate border-spacing-[2px] text-[12px]" aria-label={title ?? "Heatmap"}>
        <thead>
          <tr>
            <th className="w-24 text-left" />
            {cs.map((c) => (
              <th key={c} scope="col" className="px-0.5 pb-1 text-center text-[11px] font-medium text-muted-foreground">{fmtCol(c)}</th>
            ))}
            <th scope="col" className="pl-2 pb-1 text-right text-[11px] font-medium text-muted-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {rs.map((a) => (
            <tr key={a}>
              <th scope="row" className="max-w-24 truncate pr-2 text-left text-[12px] font-medium" title={a}>{a}</th>
              {cs.map((c) => {
                const v = grid.get(`${a}|${c}`) ?? 0
                const s = cell(v, max)
                const k = `${a}|${c}`
                return (
                  <td
                    key={c}
                    tabIndex={0}
                    onMouseEnter={() => setHover(k)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(k)}
                    onBlur={() => setHover(null)}
                    aria-label={`${a}, ${fmtCol(c)}: ${v}${unit ? " " + unit : ""}`}
                    className="h-8 min-w-7 rounded-[3px] text-center font-medium outline-offset-1 focus-visible:outline-2 focus-visible:outline-foreground"
                    style={{ background: s.bg, color: v === 0 ? "oklch(0.7 0 0)" : s.fg, boxShadow: hover === k ? "0 0 0 1.5px oklch(0.25 0 0)" : undefined }}
                  >
                    {v}
                  </td>
                )
              })}
              <td className="pl-2 text-right font-semibold">{rowTot[a]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="pt-1 text-left text-[11px] font-medium text-muted-foreground">Total</th>
            {cs.map((c) => (
              <td key={c} className="pt-1 text-center font-semibold">{colTot[c]}</td>
            ))}
            <td className="pl-2 pt-1 text-right font-semibold">{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
  return (
    <Artifact title={title} className="w-full">
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No data for this grid.</p>
      ) : (
        <>
          <ChartWithTable label={title ?? "Heatmap"} columns={columns} rows={rows} chart={chart} />
          <div className="flex items-center gap-2 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
            <span>0</span>
            <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(90deg, oklch(0.985 0 0), oklch(0.82 0.06 var(--seq-hue,250)), oklch(0.475 0.165 var(--seq-hue,250)))" }} aria-hidden />
            <span className="tnum">{max}</span>
            <span className="ml-auto">{unit ?? columns.find((c) => c.key === valueKey)?.label} per cell</span>
          </div>
        </>
      )}
    </Artifact>
  )
}
