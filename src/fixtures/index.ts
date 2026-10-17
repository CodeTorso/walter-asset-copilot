// Typed, schema-validated access to the generated fixture JSON (see scripts/fixtures/make-fixtures.ts).
import { z } from "zod"
import { Conflict, EvidenceRef, Feedback, Finding } from "@/contracts"
import findingsJson from "./findings.json"
import statesJson from "./states.json"
import fleetJson from "./fleet.json"
import streamsJson from "./streams.json"
import recordsJson from "./records.json"
import proposalsJson from "./proposals.json"

const Findings = z.object({
  status: Finding, series: Finding, bar: Finding, map: Finding, heatmap: Finding,
  tableInspections: Finding, tableMaintenance: Finding, tableRegulatory: Finding, empty: Finding,
})
export const findings = Findings.parse(findingsJson)

const Rule = z.object({ key: z.string(), value: z.string(), source: EvidenceRef, overriddenBy: z.string().optional(), overrideAuthor: z.string().optional() })
export const states = z
  .object({
    today: z.string(),
    noteConflict: Conflict,
    feedbackCorrection: Feedback,
    feedbackClaim: Feedback,
    feedbackRule: Feedback.extend({ synthetic: z.boolean().optional() }),
    ruleManual: Rule,
    ruleUser: Rule,
    statusWellId: z.string(),
    statusVariants: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number()]))),
  })
  .passthrough()
  .parse(statesJson)

export const fleet = fleetJson as { users: { user_id: string; name: string; role: string; team_id: string | null }[]; areas: { area_id: string; name: string; team_id: string; wellCount: number }[]; wellCount: number; today: string }
export const userNames: Record<string, string> = Object.fromEntries(fleet.users.map((u) => [u.user_id, u.name]))
export const records = recordsJson as Record<string, Record<string, unknown>>
export type StreamPart = { t: number; type: string; data: any }
export type StreamFixture = { prompt: string; parts: StreamPart[] }
export const streams = streamsJson as unknown as Record<string, StreamFixture>
export const proposals = proposalsJson as any
export const TODAY = states.today
