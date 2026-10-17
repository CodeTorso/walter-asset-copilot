import { useMemo } from "react"
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { fmtDateShort, fmtNumber } from "@/lib/format"
import { Artifact, EvidenceChip, Legend } from "./shared"
import { ChartWithTable } from "./ChartTable"
import type { SchemaProps } from "./schemas"

const SERIES_COLORS = ["var(--series-1)", "#64748b", "#1baf7a", "#6250d6"]

/** Line chart for change over time, with an optional threshold line and shaded not-producing weeks. */
export function LineChart({ title, columns, rows, x, series, thresholdKey, bandKey, windowLabel, rowEvidence }: SchemaProps<"LineChart">) {
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k
  const unit = columns.find((c) => c.key === series[0])?.unit
  const bands = useMemo(() => {
    if (!bandKey) return []
    const out: { from: string; to: string }[] = []
    let start: string | null = null
    rows.forEach((r, i) => {
      const on = r[bandKey] === true
      const xv = String(r[x])
      if (on && start == null) start = xv
      const next = rows[i + 1]
      if (on && !(next && next[bandKey] === true)) {
        out.push({ from: start!, to: xv })
        start = null
      }
    })
    return out
  }, [rows, bandKey, x])
  const lastIdx = rows.length - 1
  const empty = rows.length === 0

  const chart = (
    <div className="h-64 w-full px-1 pb-2 pt-1" role="img" aria-label={`${title ?? "Line chart"}: ${series.map(label).join(", ")}${thresholdKey ? `, with ${label(thresholdKey)}` : ""}${bands.length ? `. ${bands.length} shaded ranges mark weeks the well was not producing.` : ""}`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 240 }}>
        <ComposedChart data={rows} margin={{ top: 14, right: 40, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="oklch(0.94 0 0)" vertical={false} />
          <XAxis dataKey={x} tickFormatter={(v) => fmtDateShort(String(v))} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "oklch(0.9 0 0)" }} minTickGap={18} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} tickFormatter={(v) => `${v}`} unit={unit ? ` ${unit}`.trim() : undefined} />
          {bands.map((b, i) => (
            <ReferenceArea key={i} x1={b.from} x2={b.to} fill="var(--warn)" fillOpacity={0.13} stroke="var(--warn)" strokeOpacity={0.25} strokeDasharray="2 3" ifOverflow="visible" />
          ))}
          {thresholdKey && <Line dataKey={thresholdKey} name={label(thresholdKey)} stroke="oklch(0.3 0 0)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />}
          {series.map((s, i) => (
            <Line
              key={s}
              dataKey={s}
              name={label(s)}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={(p: any) => (p.index === lastIdx ? <circle key={p.index} cx={p.cx} cy={p.cy} r={4.5} fill={SERIES_COLORS[i % SERIES_COLORS.length]} stroke="var(--card)" strokeWidth={2} /> : <g key={p.index} />)}
              activeDot={{ r: 4.5, stroke: "var(--card)", strokeWidth: 2 }}
              animationDuration={400}
            />
          ))}
          <Tooltip
            cursor={{ stroke: "oklch(0.75 0 0)", strokeWidth: 1 }}
            content={({ active, payload, label: l }) => {
              if (!active || !payload?.length) return null
              const idx = rows.findIndex((r) => String(r[x]) === String(l))
              const row = rows[idx]
              return (
                <div className="surface tnum min-w-40 px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
                  <p className="mb-1 font-medium">{fmtDateShort(String(l))} {String(l).slice(0, 4)}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} />{p.name}</span>
                      <span className="font-medium">{fmtNumber(p.value as number, unit)}</span>
                    </p>
                  ))}
                  {bandKey && row?.[bandKey] === true && <p className="mt-1 font-medium text-(--warn)">Not producing this week</p>}
                </div>
              )
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )

  return (
    <Artifact title={title} subtitle={windowLabel} className="w-full">
      {empty ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No readings in this window.</p>
      ) : (
        <>
          <ChartWithTable label={title ?? "Line chart"} columns={columns.filter((c) => [x, ...series, thresholdKey, bandKey].includes(c.key))} rows={rows} chart={chart} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2.5">
            <Legend
              items={[
                ...series.map((s, i) => ({ label: label(s), swatch: <span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} /> })),
                ...(thresholdKey ? [{ label: label(thresholdKey), swatch: <svg width="16" height="2" aria-hidden><line x1="0" y1="1" x2="16" y2="1" stroke="oklch(0.3 0 0)" strokeWidth="1.5" strokeDasharray="4 3" /></svg> }] : []),
                ...(bandKey ? [{ label: "Not producing", swatch: <span className="inline-block size-3 rounded-[2px] border border-dashed border-(--warn)/60 bg-(--warn)/15" /> }] : []),
              ]}
            />
            {rowEvidence?.at(-1)?.[0] && <EvidenceChip evidence={rowEvidence.at(-1)![0]} />}
          </div>
        </>
      )}
    </Artifact>
  )
}
