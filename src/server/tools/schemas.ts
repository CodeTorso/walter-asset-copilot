import { z } from "zod"
import { FeedbackKind, Period, Scope } from "../../contracts"

// Typed arguments for every tool. The agent route can reuse these as tool input schemas.

const limit = z.number().int().positive().max(200).optional()

export const wellStatusArgs = z.object({
  scope: Scope,
  at: z.string().optional().describe("ISO date; status as of the latest inspection on or before it. Default: latest."),
  onlyNotProducing: z.boolean().optional(),
  recordedStatusMismatchOnly: z.boolean().optional().describe("Only wells whose recorded status disagrees with the latest inspection"),
  limit,
})
export const readingSeriesArgs = z.object({
  wellId: z.string(),
  period: Period.optional(),
  weeks: z.number().int().positive().max(260).optional().describe("Shortcut: last N weeks (N x 7 days)"),
})
export const downtimeArgs = z.object({
  scope: Scope,
  period: Period.optional(),
  rank: z.number().int().positive().optional().describe("Top N wells by downtime (ties at the boundary are all shown)"),
  detail: z.boolean().optional().describe("List each not-producing reading with overlapping repairs"),
})
export const spillsArgs = z.object({
  scope: Scope,
  period: Period.optional(),
  groupBy: z.enum(["none", "area_month", "area", "well", "month", "year"]).optional().describe("year: one row per year (totals); area_month: heatmap"),
  minVolumeBbl: z.number().optional(),
  reportableOnly: z.boolean().optional().describe("Only spills at or above the reportable class"),
  containmentOverLimit: z.boolean().optional().describe("Only spills contained later than the SR-02 limit (from report text)"),
  limit,
})
export const maintenanceArgs = z.object({
  scope: Scope,
  period: Period.optional(),
  maintenanceType: z.enum(["corrective", "scheduled", "all"]).optional(),
  equipmentKind: z.string().optional(),
  openOnly: z.boolean().optional(),
  groupBy: z.enum(["none", "well", "year", "month", "area", "equipment"]).optional(),
  limit,
})
export const rcaArgs = z.object({ scope: Scope, equipmentKind: z.string().optional() })
export const complianceArgs = z.object({
  scope: Scope,
  period: Period.optional(),
  protocols: z.array(z.string()).optional(),
  includeMet: z.boolean().optional(),
  events: z.enum(["all", "open"]).optional().describe("List regulator events (spill reports, notices, fines, site visits) instead of protocol checks"),
  limit,
})
export const searchDocsArgs = z.object({
  query: z.string().min(1),
  kinds: z.array(z.enum(["manual", "sop", "report"])).optional(),
  limit: z.number().int().positive().max(20).optional(),
})
export const getRuleArgs = z.object({
  key: z.string().optional().describe("Rule key, e.g. producing_delta_c, rca_count, sr01_hours. Omit to list all."),
  wellType: z.string().optional(),
  wellId: z.string().optional(),
})
export const wellContextArgs = z.object({ wellId: z.string() })
export const recallArgs = z.object({
  reference: z.string().describe("What the user referred to, e.g. 'the three wells we discussed yesterday'"),
  count: z.number().int().positive().optional().describe("How many wells the user said, if any"),
  limit,
})
export const recordFeedbackArgs = z.object({
  kind: FeedbackKind,
  targetId: z.string().describe("Inspection ID for corrections, rule key for scoped_rule, well ID for notes and claims"),
  field: z.string().optional().describe("wellhead_temp_c | ambient_temp_c | spill_est_volume_bbl | spill_area_pct | spill_detected"),
  newValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  scope: z.object({ type: z.enum(["well", "well_type", "fleet"]), value: z.string().optional() }).optional(),
  reason: z.string().optional(),
  text: z.string().describe("The user's statement, verbatim"),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  claimedProducing: z.boolean().optional().describe("For status_claim: the user says the well is producing (true) or not (false)"),
})

export type WellStatusArgs = z.infer<typeof wellStatusArgs>
export type ReadingSeriesArgs = z.infer<typeof readingSeriesArgs>
export type DowntimeArgs = z.infer<typeof downtimeArgs>
export type SpillsArgs = z.infer<typeof spillsArgs>
export type MaintenanceArgs = z.infer<typeof maintenanceArgs>
export type RcaArgs = z.infer<typeof rcaArgs>
export type ComplianceArgs = z.infer<typeof complianceArgs>
export type SearchDocsArgs = z.infer<typeof searchDocsArgs>
export type GetRuleArgs = z.infer<typeof getRuleArgs>
export type WellContextArgs = z.infer<typeof wellContextArgs>
export type RecallArgs = z.infer<typeof recallArgs>
export type RecordFeedbackArgs = z.infer<typeof recordFeedbackArgs>
