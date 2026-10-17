import { sql } from "drizzle-orm"
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core"

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" })

// Every table is keyed by dataset_id so several datasets can live side by side.
// Dates and timestamps stay ISO text so they round-trip exactly between PGlite and Neon.

export const datasets = pgTable("datasets", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  today: text("today").notNull(), // YYYY-MM-DD, latest inspection + 1 day unless overridden
  todayOverridden: boolean("today_overridden").notNull().default(false),
  version: integer("version").notNull().default(1),
  sourceHash: text("source_hash"),
  stats: jsonb("stats"),
  loadedAt: text("loaded_at").notNull(),
})

export const users = pgTable(
  "users",
  {
    datasetId: text("dataset_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    teamId: text("team_id"),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.userId] })],
)

export const teams = pgTable(
  "teams",
  {
    datasetId: text("dataset_id").notNull(),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    leadUserId: text("lead_user_id"),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.teamId] })],
)

export const areas = pgTable(
  "areas",
  {
    datasetId: text("dataset_id").notNull(),
    areaId: text("area_id").notNull(),
    name: text("name").notNull(),
    teamId: text("team_id"),
    centerLat: doublePrecision("center_lat"),
    centerLon: doublePrecision("center_lon"),
    assetIds: jsonb("asset_ids").notNull(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.areaId] })],
)

export const wells = pgTable(
  "wells",
  {
    datasetId: text("dataset_id").notNull(),
    assetId: text("asset_id").notNull(),
    name: text("name").notNull(),
    wellType: text("well_type").notNull(),
    areaId: text("area_id").notNull(),
    teamId: text("team_id"),
    inChargeUserId: text("in_charge_user_id"),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    installedOn: text("installed_on"),
    recordedStatus: text("recorded_status"),
    equipment: jsonb("equipment").notNull(),
    lastInspection: jsonb("last_inspection"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.assetId] })],
)

export const inspections = pgTable(
  "inspections",
  {
    datasetId: text("dataset_id").notNull(),
    inspectionId: text("inspection_id").notNull(),
    assetId: text("asset_id").notNull(),
    inspectedAt: text("inspected_at").notNull(),
    inspectorUserId: text("inspector_user_id"),
    method: text("method"),
    ambientTempC: doublePrecision("ambient_temp_c").notNull(),
    wellheadTempC: doublePrecision("wellhead_temp_c").notNull(),
    spillDetected: boolean("spill_detected").notNull(),
    spillAreaPct: doublePrecision("spill_area_pct"),
    spillEstVolumeBbl: doublePrecision("spill_est_volume_bbl"),
    notes: text("notes"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.datasetId, t.inspectionId] }),
    index("inspections_well_time").on(t.datasetId, t.assetId, t.inspectedAt),
  ],
)

export const maintenance = pgTable(
  "maintenance",
  {
    datasetId: text("dataset_id").notNull(),
    maintenanceId: text("maintenance_id").notNull(),
    assetId: text("asset_id").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    maintenanceType: text("maintenance_type").notNull(),
    equipmentKind: text("equipment_kind").notNull(),
    issue: text("issue").notNull(),
    actionTaken: text("action_taken"),
    technicianUserId: text("technician_user_id"),
    contractor: text("contractor"),
    downtimeHours: doublePrecision("downtime_hours"),
    costLabor: doublePrecision("cost_labor"),
    costParts: doublePrecision("cost_parts"),
    costTotal: doublePrecision("cost_total"),
    triggeredByInspectionId: text("triggered_by_inspection_id"),
    reportFile: text("report_file"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.datasetId, t.maintenanceId] }),
    index("maintenance_well_start").on(t.datasetId, t.assetId, t.startedAt),
  ],
)

export const regulatoryEvents = pgTable(
  "regulatory_events",
  {
    datasetId: text("dataset_id").notNull(),
    eventId: text("event_id").notNull(),
    assetId: text("asset_id").notNull(),
    date: text("date").notNull(),
    agency: text("agency"),
    eventType: text("event_type").notNull(),
    protocolId: text("protocol_id"),
    relatedInspectionId: text("related_inspection_id"),
    hoursToReport: doublePrecision("hours_to_report"),
    detail: text("detail"),
    fineUsd: doublePrecision("fine_usd"),
    status: text("status"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.eventId] })],
)

export const notes = pgTable(
  "notes",
  {
    datasetId: text("dataset_id").notNull(),
    noteId: text("note_id").notNull(),
    assetId: text("asset_id").notNull(),
    createdAt: text("created_at").notNull(),
    authorUserId: text("author_user_id"),
    noteType: text("note_type").notNull(),
    inspectionId: text("inspection_id"),
    text: text("text").notNull(),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.noteId] })],
)

export const documents = pgTable(
  "documents",
  {
    datasetId: text("dataset_id").notNull(),
    docId: text("doc_id").notNull(), // "T200", "spill-response-sop", "MNT-0001-029"
    kind: text("kind").notNull(), // manual | sop | report
    title: text("title").notNull(),
    wellType: text("well_type"),
    assetId: text("asset_id"),
    maintenanceId: text("maintenance_id"),
    path: text("path").notNull(),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.docId] })],
)

export const documentSections = pgTable(
  "document_sections",
  {
    datasetId: text("dataset_id").notNull(),
    docId: text("doc_id").notNull(),
    ord: integer("ord").notNull(),
    section: text("section").notNull(), // "9.3", "SR-01", "Compliance check"
    heading: text("heading").notNull(),
    text: text("text").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(text, ''))`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.datasetId, t.docId, t.ord] }),
    index("document_sections_tsv").using("gin", t.tsv),
  ],
)

export const reportFacts = pgTable(
  "report_facts",
  {
    datasetId: text("dataset_id").notNull(),
    maintenanceId: text("maintenance_id").notNull(),
    fact: text("fact").notNull(), // containment_hours | compliance_row | cost_total | reported_class
    key: text("key").notNull().default(""), // protocol id for compliance_row
    value: text("value").notNull(), // numeric facts as text; compliance rows as result
    detail: text("detail"),
    quote: text("quote").notNull(),
    docId: text("doc_id").notNull(),
    section: text("section"),
    method: text("method").notNull(), // regex | model
    confidence: doublePrecision("confidence").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.maintenanceId, t.fact, t.key] })],
)

export const rules = pgTable(
  "rules",
  {
    datasetId: text("dataset_id").notNull(),
    key: text("key").notNull(),
    wellType: text("well_type").notNull().default(""), // "" = fleet-wide
    status: text("status").notNull(), // found | missing
    value: text("value"),
    num: doublePrecision("num"),
    unit: text("unit"),
    label: text("label").notNull(),
    docId: text("doc_id"),
    section: text("section"),
    quote: text("quote"),
    method: text("method").notNull(), // regex | inherited | builtin | model
    inheritedFrom: text("inherited_from"),
  },
  (t) => [primaryKey({ columns: [t.datasetId, t.key, t.wellType] })],
)

export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id").notNull(),
    kind: text("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    field: text("field"),
    originalValue: jsonb("original_value"),
    newValue: jsonb("new_value"),
    scopeType: text("scope_type").notNull(),
    scopeValue: text("scope_value"),
    authorUserId: text("author_user_id").notNull(),
    reason: text("reason"),
    text: text("text").notNull(),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    status: text("status").notNull(),
    conflicts: jsonb("conflicts").notNull().default([]),
    createdAt: text("created_at").notNull(),
    supersedesId: text("supersedes_id"),
  },
  (t) => [index("feedback_dataset").on(t.datasetId, t.targetId)],
)

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("conversations_user").on(t.datasetId, t.userId)],
)

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("messages_conversation").on(t.conversationId, t.createdAt)],
)

export const memoryEntities = pgTable(
  "memory_entities",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id").notNull(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    messageId: text("message_id"),
    findingId: text("finding_id"),
    sourceTool: text("source_tool"),
    entityType: text("entity_type").notNull(), // well | area | window | rule
    entityId: text("entity_id").notNull(),
    label: text("label").notNull(),
    meta: jsonb("meta"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("memory_user").on(t.datasetId, t.userId, t.createdAt)],
)

export const turnUsage = pgTable("turn_usage", {
  turnId: text("turn_id").primaryKey(),
  datasetId: text("dataset_id").notNull(),
  userId: text("user_id").notNull(),
  conversationId: text("conversation_id"),
  model: text("model").notNull(),
  requests: integer("requests").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  ms: integer("ms").notNull(),
  createdAt: text("created_at").notNull(),
})
