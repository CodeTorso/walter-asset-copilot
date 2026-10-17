// Shared contracts between the data engine, the agent route and the UI.
// See RESOURCE/orchestration-plan.md §7. Change these deliberately: both lanes import them.
import { z } from "zod"

export const DatasetId = z.string().min(1) // "sample", "test-1"
export type DatasetId = z.infer<typeof DatasetId>

// ── Raw dataset rows (02-dataset-guide.md) ────────────────────────────────────

export const UserRow = z.object({
  user_id: z.string(),
  name: z.string(),
  role: z.string(),
  team_id: z.string().nullable(),
})
export type UserRow = z.infer<typeof UserRow>

export const AreaRow = z.object({
  area_id: z.string(),
  name: z.string(),
  team_id: z.string(),
  center: z.object({ lat: z.number(), lon: z.number() }),
  asset_ids: z.array(z.string()),
})
export type AreaRow = z.infer<typeof AreaRow>

export const WellRow = z.object({
  asset_id: z.string(),
  name: z.string(),
  well_type: z.string(), // "T200" | "T350" today; new types may appear in test data
  area_id: z.string(),
  team_id: z.string(),
  in_charge_user_id: z.string(),
  location: z.object({ lat: z.number(), lon: z.number() }),
  installed_on: z.string(),
  equipment: z.array(
    z.object({ equipment_id: z.string(), kind: z.string(), model: z.string() }),
  ),
  last_inspection: z
    .object({ id: z.string(), time: z.string(), inspector: z.string() })
    .partial()
    .nullable(),
  recorded_status: z.string(),
})
export type WellRow = z.infer<typeof WellRow>

export const InspectionRow = z.object({
  asset_id: z.string(),
  inspection_id: z.string(),
  inspected_at: z.string(),
  inspector_user_id: z.string(),
  method: z.string(),
  ambient_temp_c: z.number(),
  wellhead_temp_c: z.number(),
  spill_detected: z.boolean(),
  spill_area_pct: z.number().nullable(),
  spill_est_volume_bbl: z.number().nullable(),
  evidence_images: z.array(z.string()),
  notes: z.string().nullable(),
})
export type InspectionRow = z.infer<typeof InspectionRow>

export const MaintenanceRow = z.object({
  asset_id: z.string(),
  maintenance_id: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  maintenance_type: z.string(),
  equipment_kind: z.string(),
  issue: z.string(),
  action_taken: z.string(),
  technician_user_id: z.string().nullable(),
  contractor: z.string().nullable(),
  downtime_hours: z.number(),
  cost_usd: z.object({ labor: z.number(), parts: z.number(), total: z.number() }),
  triggered_by_inspection_id: z.string().nullable(),
  report_file: z.string().nullable(),
})
export type MaintenanceRow = z.infer<typeof MaintenanceRow>

export const RegulatoryEventRow = z.object({
  asset_id: z.string(),
  event_id: z.string(),
  date: z.string(),
  agency: z.string(),
  event_type: z.string(),
  protocol_id: z.string().nullable(),
  related_inspection_id: z.string().nullable(),
  hours_to_report: z.number().nullable(),
  detail: z.string(),
  fine_usd: z.number().nullable(),
  status: z.string(),
})
export type RegulatoryEventRow = z.infer<typeof RegulatoryEventRow>

export const NoteRow = z.object({
  asset_id: z.string(),
  note_id: z.string(),
  created_at: z.string(),
  author_user_id: z.string(),
  note_type: z.string(),
  inspection_id: z.string().nullish(),
  text: z.string(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
})
export type NoteRow = z.infer<typeof NoteRow>

// ── Evidence, windows and findings ────────────────────────────────────────────

export const EvidenceKind = z.enum([
  "well",
  "inspection",
  "maintenance",
  "report",
  "regulatory_event",
  "note",
  "feedback",
  "manual",
  "sop",
])
export type EvidenceKind = z.infer<typeof EvidenceKind>

export const EvidenceRef = z.object({
  kind: EvidenceKind,
  id: z.string(), // "INS-0164-0205", "MNT-0151-025", "T200#9.3"
  label: z.string(),
  datasetId: DatasetId,
  section: z.string().optional(),
  quote: z.string().optional(), // verbatim excerpt for documents and report facts
  overriddenBy: z.string().optional(), // feedback id when an overlay changed this record
})
export type EvidenceRef = z.infer<typeof EvidenceRef>

export const Window = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(), // "16 Jun – 16 Oct 2026"
  basis: z.enum(["by_date", "by_start_date"]),
})
export type Window = z.infer<typeof Window>

export const Period = z.object({
  kind: z.enum(["latest", "last_n_days", "last_n_months", "calendar_year", "between"]),
  n: z.number().int().positive().optional(),
  year: z.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})
export type Period = z.infer<typeof Period>

export const Scope = z.object({
  wellIds: z.array(z.string()).optional(),
  areaName: z.string().optional(), // by name ("Northeast Block 8") or id ("NE-08")
  wellType: z.string().optional(),
  fleet: z.boolean().optional(),
})
export type Scope = z.infer<typeof Scope>

export const Conflict = z.object({
  subject: EvidenceRef,
  sides: z.array(
    z.object({
      claim: z.string(),
      author: z.string().optional(),
      source: EvidenceRef,
      status: z.enum(["data", "applied", "unconfirmed", "disputed"]),
    }),
  ),
  needsConfirmationFrom: z.string().optional(), // user id
})
export type Conflict = z.infer<typeof Conflict>

export const Column = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "date", "datetime", "well", "status", "evidence"]),
  unit: z.string().optional(), // "°C", "bbl", "USD", "days", "h"
})
export type Column = z.infer<typeof Column>

export const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const Row = z.record(z.string(), Cell)
export type Row = z.infer<typeof Row>

export const WorkerId = z.enum(["field", "maintenance", "compliance", "memory"])
export type WorkerId = z.infer<typeof WorkerId>

export const FindingShape = z.enum([
  "single_entity",
  "list",
  "series",
  "ranking",
  "geo",
  "matrix",
  "scalar",
])
export type FindingShape = z.infer<typeof FindingShape>

export const Finding = z.object({
  id: z.string(),
  workerId: WorkerId,
  tool: z.string(),
  datasetId: DatasetId,
  asOf: z.string(), // dataset "today"
  window: Window.optional(),
  shape: FindingShape,
  title: z.string(),
  columns: z.array(Column),
  rows: z.array(Row), // capped; `handle` fetches the full set
  rowEvidence: z.array(z.array(EvidenceRef)).optional(), // parallel to rows
  slots: z.record(z.string(), z.union([z.number(), z.string()])), // values narrative may cite
  evidence: z.array(EvidenceRef),
  rulesApplied: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      source: EvidenceRef,
      overriddenBy: z.string().optional(),
    }),
  ),
  conflicts: z.array(Conflict),
  caveats: z.array(z.string()),
  ties: z.array(z.string()).optional(),
  handle: z.string(),
  totalRows: z.number().int(),
})
export type Finding = z.infer<typeof Finding>

// ── Feedback and memory ───────────────────────────────────────────────────────

export const FeedbackKind = z.enum([
  "data_correction",
  "analysis_correction",
  "scoped_rule",
  "shared_note",
  "status_claim",
])
export type FeedbackKind = z.infer<typeof FeedbackKind>

export const Feedback = z.object({
  id: z.string(),
  datasetId: DatasetId,
  kind: FeedbackKind,
  targetType: z.enum(["inspection", "maintenance", "well", "rule", "note"]),
  targetId: z.string(),
  field: z.string().optional(),
  originalValue: Cell.optional(),
  newValue: Cell.optional(),
  scopeType: z.enum(["well", "well_type", "fleet"]),
  scopeValue: z.string().optional(),
  authorUserId: z.string(),
  reason: z.string().optional(),
  text: z.string(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  status: z.enum(["applied", "unconfirmed", "disputed", "superseded"]),
  conflicts: z.array(Conflict),
  createdAt: z.string(),
  supersedesId: z.string().optional(),
})
export type Feedback = z.infer<typeof Feedback>

// ── Visuals and A2UI-shaped surfaces ──────────────────────────────────────────

export const VisualKind = z.enum([
  "status_card",
  "table",
  "line_chart",
  "bar_chart",
  "map",
  "heatmap",
  "text",
])
export type VisualKind = z.infer<typeof VisualKind>

// Catalog component names. The renderer maps each to a React component; anything else is rejected.
export const CatalogComponent = z.enum([
  "StatusCard",
  "DataTable",
  "LineChart",
  "BarChart",
  "MapPins",
  "Heatmap",
  "EvidenceList",
  "ConflictCallout",
  "CorrectionNotice",
  "RuleBadge",
  "ConfirmAction",
  "Callout",
  "Stack",
  "Grid",
])
export type CatalogComponent = z.infer<typeof CatalogComponent>

// A JSON Pointer binding into the surface data model, or a literal.
export const Bound = z.union([
  z.object({ path: z.string().startsWith("/") }),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const SurfaceComponent = z.object({
  id: z.string(),
  component: CatalogComponent,
  props: z.record(z.string(), z.union([Bound, z.array(z.string())])).default({}),
  children: z.array(z.string()).optional(),
})
export type SurfaceComponent = z.infer<typeof SurfaceComponent>

export const A2UIAction = z.enum([
  "open_evidence",
  "confirm_feedback",
  "reject_feedback",
  "show_as",
  "ask_followup",
])

// Subset of A2UI v0.9.1 server-to-client messages (one key per message).
export const SurfaceMessage = z.union([
  z.object({ createSurface: z.object({ surfaceId: z.string(), catalogId: z.literal("app:catalog/v1") }) }),
  z.object({
    updateComponents: z.object({
      surfaceId: z.string(),
      rootId: z.string(),
      components: z.array(SurfaceComponent),
    }),
  }),
  z.object({
    updateDataModel: z.object({ surfaceId: z.string(), path: z.string(), value: z.unknown() }),
  }),
  z.object({ deleteSurface: z.object({ surfaceId: z.string() }) }),
])
export type SurfaceMessage = z.infer<typeof SurfaceMessage>

// ── Workers and stream events (AI SDK UI message `data-*` parts) ──────────────

export const WorkerStatus = z.enum(["idle", "queued", "working", "done", "failed"])

export const WorkerState = z.object({
  id: WorkerId,
  name: z.string(),
  role: z.string(),
  avatar: z.string(),
  status: WorkerStatus,
  currentTask: z
    .object({ taskId: z.string(), title: z.string(), startedAt: z.string() })
    .optional(),
  progress: z.array(
    z.object({
      at: z.string(),
      text: z.string(), // factual tool events only, never model reasoning
      counts: z.record(z.string(), z.number()).optional(),
    }),
  ),
})
export type WorkerState = z.infer<typeof WorkerState>

export const Usage = z.object({
  model: z.string(),
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  ms: z.number(),
})

export const StreamData = {
  turn: z.object({
    turnId: z.string(),
    userId: z.string(),
    conversationId: z.string(),
    datasetId: DatasetId,
    phase: z.enum(["started", "completed", "cancelled", "failed"]),
    usage: Usage.optional(),
  }),
  delegation: z.object({ taskId: z.string(), workerId: WorkerId, line: z.string() }),
  task: z.object({
    taskId: z.string(),
    workerId: WorkerId,
    title: z.string(),
    status: WorkerStatus,
    progress: WorkerState.shape.progress,
    findingId: z.string().optional(),
    error: z.string().optional(),
  }),
  surface: SurfaceMessage,
  evidence: z.object({ findingId: z.string(), refs: z.array(EvidenceRef) }),
  conflict: Conflict,
  feedback: z.object({
    feedbackId: z.string(),
    kind: FeedbackKind,
    status: Feedback.shape.status,
    summary: z.string(),
    conflicts: z.array(Conflict),
  }),
} as const

export type StreamDataTypes = { [K in keyof typeof StreamData]: z.infer<(typeof StreamData)[K]> }
