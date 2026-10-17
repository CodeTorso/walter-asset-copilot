import { z } from "zod"
import type { EvidenceRef, Finding } from "@/contracts"

// Walter designs the view; code validates and computes. Gemma names columns, sort, limit and an aggregate; every
// key is checked against the finding's columns, aggregates are computed here from the tool's rows (so numbers stay
// grounded and cited), and anything invalid is dropped with a note that goes back to the model.

export const ViewSpec = z.object({
  title: z.string().optional(),
  rowKey: z.string().optional().describe("Heatmap row dimension: a categorical column"),
  colKey: z.string().optional().describe("Heatmap column dimension: a different categorical column"),
  labelKey: z.string().optional().describe("Column for the x axis / bar labels (e.g. well, year, area)"),
  valueKeys: z.array(z.string()).max(4).optional().describe("Number column(s) to plot; several = multi-line"),
  sort: z.enum(["value_desc", "value_asc", "label", "time", "given"]).optional(),
  limit: z.number().int().positive().max(200).optional(),
  aggregate: z
    .object({
      by: z.string().describe("Column to group rows by, or 'year' / 'month' (from the date column)"),
      op: z.enum(["sum", "count", "avg", "max", "min"]),
      valueKey: z.string().optional().describe("Number column to sum/avg/max/min (not needed for count)"),
    })
    .optional(),
  highlight: z.array(z.string()).max(20).optional().describe("Label values (e.g. well IDs) to emphasise"),
})
export type ViewSpec = z.infer<typeof ViewSpec>

/** Column list Walter sees, so he can design the view. */
export const columnList = (f: Finding) => f.columns.map((c) => `${c.key} (${c.type}${c.unit ? `, ${c.unit}` : ""})`)

const isTime = (v: unknown) => typeof v === "string" && /^\d{4}(-\d{2}(-\d{2})?)?/.test(v)

export function applyView(
  f: Finding,
  spec: ViewSpec | undefined,
  full?: { rows: Record<string, unknown>[]; rowEvidence: EvidenceRef[][] },
  /** Attributes the rows don't carry but their well does (area, well_type), for aggregate.by. */
  derive?: (by: string, row: Record<string, unknown>) => string | undefined,
): { finding: Finding; notes: string[] } {
  if (!spec || !Object.keys(spec).length) return { finding: f.shape === "matrix" && full ? { ...f, rows: full.rows as Finding["rows"], rowEvidence: full.rowEvidence } : f, notes: [] }
  const parsed = ViewSpec.safeParse(spec)
  if (!parsed.success) return { finding: f, notes: ["Invalid view specification; kept the original finding."] }
  spec = parsed.data
  // Gemma often copies keys with their annotation ("area (text)") or in another case: match to the real key.
  const real = (k?: string) => {
    if (!k) return k
    const bare = k.replace(/\s*\(.*\)\s*$/, "").trim()
    return f.columns.find((c) => c.key === bare)?.key ?? f.columns.find((c) => c.key.toLowerCase() === bare.toLowerCase())?.key ?? (/^(year|month)$/i.test(bare) ? bare.toLowerCase() : bare)
  }
  spec = {
    ...spec,
    rowKey: real(spec.rowKey),
    colKey: real(spec.colKey),
    labelKey: real(spec.labelKey),
    valueKeys: spec.valueKeys?.map((k) => real(k)!),
    ...(spec.aggregate ? { aggregate: { ...spec.aggregate, by: real(spec.aggregate.by)!, valueKey: real(spec.aggregate.valueKey) } } : {}),
  }
  const notes: string[] = []
  // Counting retrieved passages or status rows erases the evidence the question needs.
  // Counts for these tools already have grounded slots; keep their descriptive rows intact.
  if (spec.aggregate && ["search_documents", "well_status", "well_context", "get_rule", "compliance", "rca_candidates"].includes(f.tool)) {
    notes.push("This finding contains descriptions, status or rules. Use its numeric slots for counts; aggregation would discard the answer fields.")
    spec = { ...spec, aggregate: undefined }
  }
  let columns = f.columns
  // Aggregates and sorts run over every row the tool produced (the finding itself carries at most 50).
  const srcRows = full?.rows ?? f.rows
  const srcEv = full?.rowEvidence ?? f.rowEvidence ?? []
  let rows = srcRows.map((r, i) => ({ r, ev: srcEv[i] ?? [] }))
  const keys = () => columns.map((c) => c.key)
  const isNum = (k: string) => columns.find((c) => c.key === k)?.type === "number"

  // 1. Aggregate (deterministic, over every row the tool returned).
  let aggLabel: string | undefined
  let aggValue: string | undefined
  if (spec.aggregate && srcRows.length < f.totalRows) {
    notes.push("Aggregation needs all source rows; kept the original rows instead of computing a partial total.")
  } else if (spec.aggregate) {
    const { by, op, valueKey } = spec.aggregate
    const dateCol = columns.find((c) => c.type === "date" || c.type === "datetime")?.key
    const derived = (by === "year" || by === "month") && !keys().includes(by) ? dateCol : undefined
    const viaWell = !keys().includes(by) && !derived && !!derive && rows.some(({ r }) => derive(by, r) !== undefined)
    const byOk = keys().includes(by) || !!derived || viaWell
    const valOk = op === "count" || (!!valueKey && keys().includes(valueKey) && isNum(valueKey))
    if (!byOk) notes.push(`aggregate.by '${by}' not in columns [${keys().join(", ")}] (use 'year' or 'month' to bucket a date column)`)
    else if (!valOk) notes.push(`aggregate.valueKey '${valueKey ?? ""}' must be a number column from [${columns.filter((c) => c.type === "number").map((c) => c.key).join(", ")}]`)
    else {
      const keyOf = (r: Record<string, unknown>) => {
        if (viaWell) return derive!(by, r) ?? "–"
        const v = derived ? r[derived] : r[by]
        if (derived) return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v)) ? v.slice(0, by === "year" ? 4 : 7) : "Unknown date"
        return String(v ?? "–")
      }
      const groups = new Map<string, { rows: Record<string, unknown>[]; ev: EvidenceRef[] }>()
      for (const { r, ev } of rows) {
        const k = keyOf(r)
        const g = groups.get(k) ?? { rows: [], ev: [] }
        g.rows.push(r)
        if (g.ev.length < 3) g.ev.push(...ev.slice(0, 3 - g.ev.length))
        groups.set(k, g)
      }
      // Grouping by an existing count column must not overwrite the group label.
      const countKey = by === "count" ? "row_count" : "count"
      const valueName = op === "count" ? countKey : `${op}_${valueKey}`
      const label = op === "count" ? "Count" : `${{ sum: "Total", avg: "Average", max: "Max", min: "Min" }[op]} ${columns.find((c) => c.key === valueKey)?.label ?? valueKey}`
      const unit = op === "count" ? undefined : columns.find((c) => c.key === valueKey)?.unit
      const agg = (vals: number[]) => {
        if (!vals.length) return null
        const value = op === "sum" ? vals.reduce((a, b) => a + b, 0) : op === "avg" ? vals.reduce((a, b) => a + b, 0) / vals.length : op === "max" ? Math.max(...vals) : Math.min(...vals)
        return Number.isFinite(value) ? value : null
      }
      const byLabel = derived ? (by === "year" ? "Year" : "Month") : (columns.find((c) => c.key === by)?.label ?? by.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))
      rows = [...groups.entries()].map(([k, g]) => {
        const out: Record<string, unknown> = { [by]: k, [countKey]: g.rows.length }
        if (op !== "count") out[valueName] = agg(g.rows.map((r) => r[valueKey!]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)))
        return { r: out as any, ev: g.ev }
      })
      columns = [
        { key: by, label: byLabel, type: by === "well" ? "well" : "text" },
        ...(op !== "count" ? [{ key: valueName, label, type: "number" as const, ...(unit ? { unit } : {}) }] : []),
        { key: countKey, label: "Count", type: "number" },
      ]
      aggLabel = by
      aggValue = valueName
      if (derived || rows.every((x) => isTime(x.r[by]))) rows.sort((a, b) => String(a.r[by]).localeCompare(String(b.r[by])))
    }
  }

  // 2. Keys.
  let labelKey = spec.labelKey ?? aggLabel
  if (labelKey && !keys().includes(labelKey)) {
    notes.push(`labelKey '${labelKey}' not in columns [${keys().join(", ")}]`)
    labelKey = aggLabel
  }
  let valueKeys = spec.valueKeys?.filter((k) => {
    const ok = keys().includes(k) && isNum(k)
    if (!ok) notes.push(`valueKey '${k}' is not a number column in [${columns.filter((c) => c.type === "number").map((c) => c.key).join(", ")}]`)
    return ok
  })
  if (!valueKeys?.length) valueKeys = aggValue ? [aggValue] : undefined

  // 3. Sort and limit.
  const total = rows.length
  const sort = spec.sort
  if (sort && sort !== "given") {
    const v = valueKeys?.[0]
    if ((sort === "value_desc" || sort === "value_asc") && !v) notes.push(`sort '${sort}' needs a valid valueKey`)
    else if ((sort === "label" || sort === "time") && !labelKey) notes.push(`sort '${sort}' needs a valid labelKey`)
    else
      rows.sort((a, b) => {
        if (sort === "value_desc" || sort === "value_asc") {
          const av = a.r[v!], bv = b.r[v!]
          const aValid = typeof av === "number" && Number.isFinite(av)
          const bValid = typeof bv === "number" && Number.isFinite(bv)
          if (!aValid || !bValid) return aValid ? -1 : bValid ? 1 : 0
          return sort === "value_desc" ? bv - av : av - bv
        }
        return String(a.r[labelKey!] ?? "").localeCompare(String(b.r[labelKey!] ?? ""), undefined, { numeric: true })
      })
  }
  let limit = spec.limit ?? (f.shape === "matrix" || spec.rowKey || spec.colKey ? rows.length : 50)
  const valueKey = valueKeys?.[0]
  // An explicit top-N includes all equal values at its boundary.
  if (spec.limit && valueKey && (sort === "value_desc" || sort === "value_asc")) {
    const boundary = rows[limit - 1]?.r[valueKey]
    if (typeof boundary === "number" && Number.isFinite(boundary)) {
      while (limit < rows.length && rows[limit]!.r[valueKey] === boundary) limit++
    }
  }
  rows = rows.slice(0, limit)

  // Heatmap dimensions travel in column order, which the Finding wire contract preserves.
  if (spec.rowKey || spec.colKey) {
    const categorical = columns.filter(c => ["text", "well", "status", "date", "datetime"].includes(c.type))
    const requestedCol = spec.colKey
    const rowKey = spec.rowKey ?? spec.labelKey ?? categorical.find(c => c.key !== requestedCol)?.key
    const colKey = spec.colKey ?? categorical.find(c => c.key !== rowKey)?.key
    const dimensions = [rowKey, colKey]
    if (new Set(dimensions).size !== 2 || dimensions.some(k => !columns.some(c => c.key === k && ["text", "well", "status", "date", "datetime"].includes(c.type)))) {
      return { finding: f, notes: ["Heatmap rowKey and colKey must name two distinct categorical columns. Retrieve or derive them first."] }
    }
    spec = { ...spec, rowKey, colKey }
    columns = [...dimensions.map(k => columns.find(c => c.key === k)!), ...columns.filter(c => !dimensions.includes(c.key))]
  }

  // 4. Table column order follows the design: label, values, then the rest.
  if (labelKey || valueKeys?.length) {
    const first = [...new Set([spec.rowKey, spec.colKey, labelKey, ...(valueKeys ?? [])].filter((k): k is string => !!k))]
    columns = [...first.map((k) => columns.find((c) => c.key === k)!).filter(Boolean), ...columns.filter((c) => !first.includes(c.key))]
  }
  // Highlighting (nearly) everything highlights nothing.
  const hlRaw = spec.highlight?.filter((h) => rows.some((x) => Object.values(x.r).includes(h)))
  const highlight = hlRaw && hlRaw.length * 2 <= rows.length ? hlRaw : undefined

  const view: NonNullable<Finding["view"]> = {
    ...(labelKey ? { labelKey } : {}),
    ...(valueKeys?.length ? { valueKeys } : {}),
    sort: "given", // rows are already in the designed order
    ...(highlight?.length ? { highlight } : {}),
  }
  const aggregated = !!aggValue
  return {
    finding: {
      ...f,
      id: aggregated ? `${f.id}_agg` : f.id,
      title: spec.title ?? f.title,
      // Grouping alone is not a request for a ranked chart. The agent can still choose a bar explicitly.
      shape: aggregated ? "list" : f.shape,
      columns,
      rows: rows.map((x) => x.r) as Finding["rows"],
      rowEvidence: rows.map((x) => x.ev),
      totalRows: aggregated ? total : Math.max(f.totalRows, total),
      ties: aggregated ? undefined : f.ties,
      view,
    },
    notes,
  }
}
