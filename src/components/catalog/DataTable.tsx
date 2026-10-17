import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, CircleHelp, History, Inbox, StickyNote, Wrench } from "lucide-react"
import { getCoreRowModel, getSortedRowModel, useLegacyTable, type LegacyColumnDef } from "@tanstack/react-table/legacy"
import type { Row as DataRow, EvidenceRef } from "@/contracts"
import { cn } from "@/lib/utils"
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format"
import { Artifact, EvidenceChip, StatusBadge } from "./shared"
import type { SchemaProps } from "./schemas"

type Col = SchemaProps<"DataTable">["columns"][number]

const chip = "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap"

/** Well-status cells read like a field report: a recorded status that disagrees with the inspection, and reasons as chips. */
function renderSpecial(col: Col, value: unknown, row: Record<string, unknown> | undefined) {
  if (col.key === "recorded_status" && typeof value === "string") {
    const label = value.charAt(0).toUpperCase() + value.slice(1)
    return row?.recorded_status_out_of_date ? (
      <span className={cn(chip, "border-(--warn)/30 bg-(--warn-soft) text-(--warn)")}>
        <History className="size-3" aria-hidden />
        {label} · out of date
      </span>
    ) : (
      <span className={cn(chip, "border-border bg-muted text-foreground/80")}>{label}</span>
    )
  }
  if (col.key === "reason" && typeof value === "string") {
    if (!value) return <span className="text-muted-foreground">–</span>
    if (value === "No recorded reason")
      return (
        <span className={cn(chip, "border-(--warn)/30 bg-(--warn-soft) text-(--warn)")}>
          <CircleHelp className="size-3" aria-hidden />
          No recorded reason
        </span>
      )
    return (
      <div className="flex flex-col items-start gap-1 whitespace-normal">
        {value.split(" | ").map((part, i) => {
          const repair = /^MNT-/.test(part)
          return (
            <div key={i} className="flex flex-col items-start gap-1">
              <span className={cn(chip, repair ? "border-(--fix)/25 bg-(--fix-soft) text-(--fix)" : "border-border bg-muted text-foreground/80")}>
                {repair ? <Wrench className="size-3" aria-hidden /> : <StickyNote className="size-3" aria-hidden />}
                {repair ? "Open repair" : "Note"}
              </span>
              <span className="text-[12px] leading-snug text-muted-foreground">{part}</span>
            </div>
          )
        })}
      </div>
    )
  }
  return null
}

function renderCell(col: Col, value: unknown, refs: EvidenceRef[] | undefined, row?: Record<string, unknown>) {
  const special = renderSpecial(col, value, row)
  if (special) return special
  if (value == null || value === "") return <span className="text-muted-foreground">–</span>
  switch (col.type) {
    case "evidence": {
      const ref = refs?.find((r) => r.id === value) ?? refs?.[0]
      return ref ? <EvidenceChip evidence={ref} /> : <span>{String(value)}</span>
    }
    case "status":
      return <StatusBadge status={String(value)} size="sm" />
    case "number":
      return <span className="tnum">{col.unit === "USD" ? fmtNumber(value, "USD", 0) : fmtNumber(value)}</span>
    case "date":
      return <span>{fmtDate(value)}</span>
    case "datetime":
      return <span>{fmtDateTime(value)}</span>
    case "well":
      return <span className="font-medium">{String(value)}</span>
    default:
      return <span>{String(value)}</span>
  }
}

export function DataTable({ title, columns, rows, rowEvidence, totalRows, emptyText }: SchemaProps<"DataTable">) {
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([])
  const data = useMemo(() => rows.map((r, i) => ({ ...r, __i: i })), [rows])
  const defs = useMemo<LegacyColumnDef<DataRow & { __i: number }>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorKey: c.key,
        header: c.unit && c.unit !== "USD" ? `${c.label} (${c.unit})` : c.unit === "USD" ? `${c.label} (USD)` : c.label,
        meta: c,
        sortingFn: "alphanumeric",
        cell: (ctx: any) => renderCell(c, ctx.getValue(), rowEvidence?.[ctx.row.original.__i], ctx.row.original),
      })),
    [columns, rowEvidence],
  )
  const table = useLegacyTable({
    data,
    columns: defs,
    state: { sorting },
    onSortingChange: (u: any) => setSorting((prev) => (typeof u === "function" ? u(prev) : u)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  } as any)
  const model = table.getRowModel().rows
  const shown = rows.length
  const total = totalRows ?? shown

  return (
    <Artifact title={title} className="w-full">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
          <Inbox className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No matching rows</p>
          <p className="caption max-w-xs">{emptyText ?? "Nothing in the data matches this question for the period checked."}</p>
        </div>
      ) : (
        <div className="scroll-thin max-h-[22rem] overflow-auto">
          <table className="w-full min-w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map((hg: any) => (
                <tr key={hg.id}>
                  {hg.headers.map((h: any) => {
                    const meta = h.column.columnDef.meta as Col
                    const dir = h.column.getIsSorted() as false | "asc" | "desc"
                    const num = meta.type === "number"
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                        className={cn("border-b border-border bg-(--panel) px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground", num ? "text-right" : "text-left")}
                      >
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn("group -mx-1 inline-flex items-center gap-1 rounded-[3px] px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none", num && "flex-row-reverse")}
                        >
                          {String(h.column.columnDef.header)}
                          {dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60" aria-hidden />}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {model.map((r: any) => (
                <tr key={r.id} className="group hover:bg-muted/50">
                  {r.getVisibleCells().map((c: any) => {
                    const meta = c.column.columnDef.meta as Col
                    return (
                      <td
                        key={c.id}
                        className={cn(
                          "border-b border-border/60 px-3 py-2 align-middle group-last:border-b-0",
                          meta.type === "number" ? "text-right" : "text-left",
                          // Long free text wraps in its own column; everything else stays on one line.
                          meta.key === "reason" || meta.key === "issue" || meta.key === "text" || meta.key === "note" ? "min-w-[12rem] max-w-[22rem] whitespace-normal" : "whitespace-nowrap",
                        )}
                      >
                        {c.column.columnDef.cell(c.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <footer className="caption border-t border-border/70 bg-(--panel) px-3 py-1.5">
          {shown < total ? `Showing ${shown} of ${total.toLocaleString("en-US")} rows. Ask to see more.` : `${total.toLocaleString("en-US")} ${total === 1 ? "row" : "rows"}`}
        </footer>
      )}
    </Artifact>
  )
}
