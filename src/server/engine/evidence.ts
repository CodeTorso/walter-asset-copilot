import type {
  EvidenceRef,
  Feedback,
  InspectionRow,
  MaintenanceRow,
  NoteRow,
  RegulatoryEventRow,
  WellRow,
} from "../../contracts"
import { fmtDate } from "../util/dates"
import type { FactRow, RuleRow } from "../ingest/types"

export function wellRef(datasetId: string, w: WellRow): EvidenceRef {
  return { kind: "well", id: w.asset_id, label: `${w.asset_id} · ${w.name} (${w.well_type})`, datasetId }
}

export function inspectionRef(datasetId: string, i: InspectionRow, overriddenBy?: string): EvidenceRef {
  return {
    kind: "inspection",
    id: i.inspection_id,
    label: `Inspection ${i.inspection_id} · ${fmtDate(i.inspected_at)}`,
    datasetId,
    overriddenBy,
  }
}

export function maintenanceRef(datasetId: string, m: MaintenanceRow): EvidenceRef {
  return {
    kind: "maintenance",
    id: m.maintenance_id,
    label: `${m.maintenance_id} · ${m.issue} (${fmtDate(m.started_at)})`,
    datasetId,
  }
}

export function reportRef(datasetId: string, m: MaintenanceRow, fact?: FactRow): EvidenceRef {
  return {
    kind: "report",
    id: m.maintenance_id,
    label: `Report ${m.maintenance_id}`,
    datasetId,
    section: fact?.section,
    quote: fact?.quote,
  }
}

export function regRef(datasetId: string, e: RegulatoryEventRow): EvidenceRef {
  return {
    kind: "regulatory_event",
    id: e.event_id,
    label: `${e.event_id} · ${e.event_type.replace(/_/g, " ")} (${fmtDate(e.date)})`,
    datasetId,
    quote: e.detail,
  }
}

export function noteRef(datasetId: string, n: NoteRow): EvidenceRef {
  return {
    kind: "note",
    id: n.note_id,
    label: `Note ${n.note_id} (${n.note_type.replace(/_/g, " ")})`,
    datasetId,
    quote: n.text,
  }
}

export function feedbackRef(datasetId: string, f: Feedback): EvidenceRef {
  return {
    kind: "feedback",
    id: f.id,
    label: `Feedback ${f.id} (${f.kind.replace(/_/g, " ")})`,
    datasetId,
    quote: f.text,
  }
}

export function ruleRef(datasetId: string, r: RuleRow): EvidenceRef {
  const manual = r.wellType !== ""
  const docId = r.docId ?? "unknown"
  return {
    kind: manual ? "manual" : "sop",
    id: `${docId}#${r.section ?? ""}`,
    label: r.section ? `${docId} §${r.section}` : docId,
    datasetId,
    section: r.section,
    quote: r.quote,
  }
}

export function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>()
  const out: EvidenceRef[] = []
  for (const r of refs) {
    const k = `${r.kind}:${r.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}
