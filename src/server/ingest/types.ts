import type {
  AreaRow,
  InspectionRow,
  MaintenanceRow,
  NoteRow,
  RegulatoryEventRow,
  UserRow,
  WellRow,
} from "../../contracts"

export type TeamRow = { team_id: string; name: string; lead_user_id: string | null }

export type RuleRow = {
  key: string
  wellType: string // "" = fleet-wide
  status: "found" | "missing"
  value?: string
  num?: number
  unit?: string
  label: string
  docId?: string
  section?: string
  quote?: string
  method: "regex" | "inherited" | "builtin" | "model"
  inheritedFrom?: string
}

export type FactRow = {
  maintenanceId: string
  fact: "containment_hours" | "compliance_row" | "cost_total" | "reported_class"
  key: string // protocol id for compliance_row, else ""
  value: string
  detail?: string
  quote: string
  docId: string
  section?: string
  method: "regex" | "model"
  confidence: number
}

export type DocSection = { section: string; heading: string; text: string }

export type DocInput = {
  docId: string
  kind: "manual" | "sop" | "report"
  title: string
  wellType?: string
  assetId?: string
  maintenanceId?: string
  path: string
  sections: DocSection[]
}

export type DatasetMeta = {
  id: string
  label: string
  today: string
  todayOverridden: boolean
  sourceHash: string
}

/** Everything the engine needs. Built either by parsing a folder or by reading the database back. */
export type SnapshotRows = {
  meta: DatasetMeta
  users: UserRow[]
  teams: TeamRow[]
  areas: AreaRow[]
  wells: WellRow[]
  inspections: InspectionRow[]
  maintenance: MaintenanceRow[]
  regEvents: RegulatoryEventRow[]
  notes: NoteRow[]
  facts: FactRow[]
  rules: RuleRow[]
}

export type DatasetRows = SnapshotRows & {
  documents: DocInput[]
  warnings: string[]
}
