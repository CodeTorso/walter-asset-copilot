// Resolved-prop schemas, one per catalog component. The renderer resolves `{path}` bindings against the
// surface data model, then validates here. Anything that fails renders a safe error card.
import { z } from "zod"
import { Cell, Column, Conflict, EvidenceRef, Feedback, KeyValueProps, MetricProps, Row } from "@/contracts"

const cols = z.array(Column)
const rows = z.array(Row)
const rowEv = z.array(z.array(EvidenceRef)).optional()
const str = z.string()

export const Schemas = {
  StatusCard: z.object({
    title: str.optional(),
    slots: z.record(str, z.union([z.number(), str])),
  }),
  DataTable: z.object({
    title: str.optional(),
    columns: cols,
    rows,
    rowEvidence: rowEv,
    totalRows: z.number().int().optional(),
    emptyText: str.optional(),
  }),
  LineChart: z.object({
    title: str.optional(),
    columns: cols,
    rows,
    x: str,
    series: z.array(str).min(1),
    thresholdKey: str.optional(),
    bandKey: str.optional(),
    windowLabel: str.optional(),
    rowEvidence: rowEv,
  }),
  BarChart: z.object({
    title: str.optional(),
    columns: cols,
    rows,
    rowEvidence: rowEv,
    labelKey: str,
    valueKey: str,
    ties: z.array(str).optional(),
    order: z.enum(["value", "given"]).optional(),
    highlight: z.array(str).optional(),
  }),
  MapPins: z.object({
    title: str.optional(),
    columns: cols,
    rows,
    rowEvidence: rowEv,
    latKey: str,
    lonKey: str,
    labelKey: str,
    statusKey: str.optional(),
  }),
  Heatmap: z.object({
    title: str.optional(),
    columns: cols,
    rows,
    rowKey: str,
    colKey: str,
    valueKey: str,
  }),
  EvidenceList: z.object({ title: str.optional(), refs: z.array(EvidenceRef) }),
  ConflictCallout: z.object({ conflict: Conflict }),
  CorrectionNotice: z.object({ feedback: Feedback }),
  RuleBadge: z.object({
    rule: z.object({ key: str, value: str, source: EvidenceRef, overriddenBy: str.optional() }),
    overrideAuthor: str.optional(),
  }),
  ConfirmAction: z.object({
    title: str,
    description: str.optional(),
    feedbackId: str,
    confirmLabel: str.optional(),
    rejectLabel: str.optional(),
    state: z.enum(["pending", "confirmed", "rejected"]).optional(),
  }),
  Callout: z.object({ tone: z.enum(["info", "warn", "error", "success"]).default("info"), title: str.optional(), text: str }),
  FollowUpChips: z.object({ suggestions: z.array(str) }),
  Metric: MetricProps,
  KeyValue: KeyValueProps,
  Stack: z.object({ gap: z.number().optional() }),
  Grid: z.object({ columns: z.number().int().min(1).max(4).optional() }),
} as const

export type SchemaProps<K extends keyof typeof Schemas> = z.infer<(typeof Schemas)[K]>
export type CellValue = z.infer<typeof Cell>
