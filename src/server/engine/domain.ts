import type {
  AreaRow,
  Conflict,
  EvidenceRef,
  Feedback,
  InspectionRow,
  MaintenanceRow,
  NoteRow,
  Period,
  RegulatoryEventRow,
  Scope,
  Window,
  WellRow,
} from "../../contracts"
import type { FactRow } from "../ingest/types"
import { addDays, addHours, addMonths, dateOf, fmtDate, fmtRange, hoursBetween } from "../util/dates"
import {
  dedupeEvidence,
  feedbackRef,
  inspectionRef,
  maintenanceRef,
  noteRef,
  regRef,
  reportRef,
  ruleRef,
  wellRef,
} from "./evidence"
import type { Snapshot } from "./snapshot"

export class ToolError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message)
  }
}

const round = (n: number, d = 2) => Number(n.toFixed(d))

export type ResolvedRule = {
  key: string
  value: string
  num?: number
  unit?: string
  source: EvidenceRef
  overriddenBy?: string
  manualValue?: string
  overrideAuthor?: string
}

export type Eff = {
  insp: InspectionRow
  date: string
  wellhead: number
  ambient: number
  delta: number
  spillDetected: boolean
  volume: number | null
  areaPct: number | null
  corrections: { id: string; field: string; original: unknown; value: unknown; author: string; reason?: string }[]
  correctionNote?: NoteRow
}

export type SpillClass = "minor" | "moderate" | "reportable" | "major" | "unknown"

export type Spill = {
  well: WellRow
  eff: Eff
  cls: SpillClass
  repairs: MaintenanceRow[]
  containmentHours?: number
  containmentFact?: FactRow
  reportedClass?: FactRow
  linkedNotes: NoteRow[]
}

export type CheckStatus = "met" | "breach" | "open" | "overdue" | "unknown"

export type ComplianceCheck = {
  protocol: string
  well: WellRow
  subject?: string
  date: string
  requirement: string
  due?: string
  actual?: string
  status: CheckStatus
  detail: string
  evidence: EvidenceRef[]
}

export class Domain {
  private effCache = new Map<string, Eff>()
  private applied: Feedback[]

  constructor(
    public ds: Snapshot,
    public feedback: Feedback[],
  ) {
    this.applied = feedback
      .filter((f) => f.status === "applied")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  get today() {
    return this.ds.today
  }
  get id() {
    return this.ds.datasetId
  }

  userName(id: string | null | undefined): string {
    if (!id) return "unknown"
    return this.ds.users.get(id)?.name ?? id
  }

  // ── scope and periods ───────────────────────────────────────────────────────

  findArea(name: string): AreaRow {
    const q = name.trim().toLowerCase()
    const areas = [...this.ds.areas.values()]
    const hit =
      areas.find((a) => a.area_id.toLowerCase() === q) ??
      areas.find((a) => a.name.toLowerCase() === q) ??
      areas.find((a) => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()))
    if (!hit)
      throw new ToolError(
        `Unknown area "${name}"`,
        `Known areas: ${areas.map((a) => `${a.name} (${a.area_id})`).join(", ")}`,
      )
    return hit
  }

  getWell(id: string): WellRow {
    const raw = id.trim()
    const digits = /^(?:well[-\s]?)?0*(\d{1,4})$/i.exec(raw)
    const canonical = digits ? `WELL-${digits[1]!.padStart(4, "0")}` : raw.toUpperCase()
    const w =
      this.ds.wells.get(raw) ??
      this.ds.wells.get(canonical) ??
      this.ds.wellList.find((x) => x.name.toLowerCase() === raw.toLowerCase())
    if (!w) throw new ToolError(`Unknown well "${id}"`, "Well IDs look like WELL-0001")
    return w
  }

  resolveWells(scope: Scope = {}): WellRow[] {
    let list = this.ds.wellList
    if (scope.wellIds?.length) {
      const ids = new Set(scope.wellIds.map((i) => this.getWell(i).asset_id))
      list = list.filter((w) => ids.has(w.asset_id))
    }
    if (scope.areaName) {
      const q = scope.areaName.trim().toLowerCase()
      const team = this.ds.rows.teams.find((t) => t.team_id.toLowerCase() === q || t.name.toLowerCase() === q)
      const isArea = [...this.ds.areas.values()].some((a) => a.area_id.toLowerCase() === q || a.name.toLowerCase() === q)
      if (team && !isArea) list = list.filter((w) => w.team_id === team.team_id)
      else {
        const a = this.findArea(scope.areaName)
        list = list.filter((w) => w.area_id === a.area_id)
      }
    }
    if (scope.wellType) {
      const t = scope.wellType.toLowerCase()
      const known = new Set(this.ds.wellList.map((w) => w.well_type.toLowerCase()))
      if (!known.has(t)) throw new ToolError(`Unknown well type "${scope.wellType}"`, `Known types: ${[...known].join(", ")}`)
      list = list.filter((w) => w.well_type.toLowerCase() === t)
    }
    return list
  }

  scopeLabel(scope: Scope = {}): string {
    const parts: string[] = []
    if (scope.wellIds?.length) parts.push(scope.wellIds.join(", "))
    if (scope.areaName) {
      const q = scope.areaName.trim().toLowerCase()
      const team = this.ds.rows.teams.find((t) => t.team_id.toLowerCase() === q || t.name.toLowerCase() === q)
      parts.push(team && ![...this.ds.areas.values()].some((a) => a.area_id.toLowerCase() === q || a.name.toLowerCase() === q) ? team.name : this.findArea(scope.areaName).name)
    }
    if (scope.wellType) parts.push(`${scope.wellType} wells`)
    return parts.length ? parts.join(" · ") : "whole field"
  }

  resolvePeriod(period: Period | undefined, basis: Window["basis"]): Window | undefined {
    if (!period || period.kind === "latest") return undefined
    const today = this.today
    let from: string
    let to = today
    let label: string
    switch (period.kind) {
      case "last_n_days": {
        const n = period.n ?? 30
        from = addDays(today, -n)
        label = `last ${n} days: ${fmtRange(from, to)}`
        break
      }
      case "last_n_months": {
        const n = period.n ?? 1
        from = addMonths(today, -n)
        label = `last ${n} month${n === 1 ? "" : "s"}: ${fmtRange(from, to)}`
        break
      }
      case "calendar_year": {
        const y = period.year ?? Number(today.slice(0, 4))
        from = `${y}-01-01`
        const end = `${y}-12-31`
        to = end < today ? end : today
        label = to === end ? `${y}` : `${fmtRange(from, to)}`
        break
      }
      case "between": {
        from = (period.from ?? "0000-01-01").slice(0, 10)
        to = (period.to ?? today).slice(0, 10)
        label = fmtRange(from, to)
        break
      }
    }
    return { from, to, label: label.replace(/^last \d+ \w+: /, ""), basis }
  }

  inWindow(date: string, w?: Window): boolean {
    if (!w) return true
    const d = dateOf(date)
    return d >= w.from && d <= w.to
  }

  // ── rules ───────────────────────────────────────────────────────────────────

  /** Scoped overlay (well > well_type > fleet, newest first) over the registry (type-specific, then fleet). */
  rule(key: string, wellType: string, wellId?: string): ResolvedRule | null {
    const base = this.registryRule(key, wellType)
    const rank = (f: Feedback) => (f.scopeType === "well" ? 3 : f.scopeType === "well_type" ? 2 : 1)
    const overlays = this.applied
      .filter(
        (f) =>
          f.kind === "scoped_rule" &&
          f.targetId === key &&
          ((f.scopeType === "well" && f.scopeValue === wellId) ||
            (f.scopeType === "well_type" && f.scopeValue?.toLowerCase() === wellType.toLowerCase()) ||
            f.scopeType === "fleet"),
      )
      .sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt))
    const top = overlays[overlays.length - 1]
    if (top) {
      const num = typeof top.newValue === "number" ? top.newValue : Number(top.newValue)
      return {
        key,
        value: String(top.newValue),
        num: Number.isFinite(num) ? num : undefined,
        unit: base?.unit,
        source: feedbackRef(this.id, top),
        overriddenBy: top.id,
        manualValue: base?.value,
        overrideAuthor: this.userName(top.authorUserId),
      }
    }
    return base
  }

  registryRule(key: string, wellType: string): ResolvedRule | null {
    const r =
      this.ds.rules.get(`${key}|${wellType}`) ?? this.ds.rules.get(`${key}|`) ?? undefined
    if (!r || r.status !== "found") return null
    return {
      key,
      value: r.value ?? "",
      num: r.num ?? (r.value !== undefined && Number.isFinite(Number(r.value)) ? Number(r.value) : undefined),
      unit: r.unit,
      source: ruleRef(this.id, r),
    }
  }

  ruleNum(key: string, wellType: string, wellId?: string): number | undefined {
    return this.rule(key, wellType, wellId)?.num
  }

  // ── inspections with overlays ───────────────────────────────────────────────

  eff(insp: InspectionRow): Eff {
    const hit = this.effCache.get(insp.inspection_id)
    if (hit) return hit
    let wellhead = insp.wellhead_temp_c
    let ambient = insp.ambient_temp_c
    let spill = insp.spill_detected
    let volume = insp.spill_est_volume_bbl
    let areaPct = insp.spill_area_pct
    const corrections: Eff["corrections"] = []
    for (const f of this.applied) {
      if (f.targetType !== "inspection" || f.targetId !== insp.inspection_id || !f.field) continue
      const v = f.newValue
      switch (f.field) {
        case "wellhead_temp_c":
          wellhead = Number(v)
          break
        case "ambient_temp_c":
          ambient = Number(v)
          break
        case "spill_est_volume_bbl":
          volume = Number(v)
          break
        case "spill_area_pct":
          areaPct = Number(v)
          break
        case "spill_detected":
          spill = Boolean(v)
          break
        default:
          continue
      }
      corrections.push({
        id: f.id,
        field: f.field,
        original: f.originalValue,
        value: v,
        author: this.userName(f.authorUserId),
        reason: f.reason,
      })
    }
    const correctionNote = (this.ds.notesByWell.get(insp.asset_id) ?? []).find(
      (n) => n.note_type === "correction" && n.inspection_id === insp.inspection_id,
    )
    const e: Eff = {
      insp,
      date: dateOf(insp.inspected_at),
      wellhead,
      ambient,
      delta: round(wellhead - ambient),
      spillDetected: spill,
      volume,
      areaPct,
      corrections,
      correctionNote,
    }
    this.effCache.set(insp.inspection_id, e)
    return e
  }

  inspections(wellId: string, w?: Window): Eff[] {
    return (this.ds.inspByWell.get(wellId) ?? []).filter((i) => this.inWindow(i.inspected_at, w)).map((i) => this.eff(i))
  }

  latest(wellId: string): Eff | undefined {
    const l = this.ds.inspByWell.get(wellId)
    return l?.length ? this.eff(l[l.length - 1]!) : undefined
  }

  threshold(well: WellRow): ResolvedRule | null {
    return this.rule("producing_delta_c", well.well_type, well.asset_id)
  }

  /** true/false, or null when the producing rule is missing for this well type */
  producing(e: Eff, well: WellRow): boolean | null {
    const t = this.threshold(well)?.num
    return t === undefined ? null : e.delta >= t
  }

  isRealSpill(e: Eff): boolean {
    return e.spillDetected && !e.correctionNote
  }

  spillClass(volume: number | null): SpillClass {
    if (volume === null || volume === undefined) return "unknown"
    const mod = this.ruleNum("spill_class_moderate_bbl", "")
    const rep = this.ruleNum("spill_class_reportable_bbl", "")
    const maj = this.ruleNum("spill_class_major_bbl", "")
    if (mod === undefined || rep === undefined || maj === undefined) return "unknown"
    if (volume >= maj) return "major"
    if (volume >= rep) return "reportable"
    if (volume >= mod) return "moderate"
    return "minor"
  }

  // ── notes, repairs, claims ──────────────────────────────────────────────────

  /** Notes in effect on a date. Formal corrections are excluded: they act on a record, not on a well. */
  validNotes(wellId: string, date = this.today): NoteRow[] {
    return (this.ds.notesByWell.get(wellId) ?? []).filter(
      (n) => n.note_type !== "correction" && (!n.valid_from || n.valid_from.slice(0, 10) <= date) && (!n.valid_to || n.valid_to.slice(0, 10) >= date),
    )
  }

  upcomingNotes(wellId: string, date = this.today): NoteRow[] {
    return (this.ds.notesByWell.get(wellId) ?? []).filter(
      (n) => n.note_type !== "correction" && n.valid_from && n.valid_from.slice(0, 10) > date,
    )
  }

  sharedNotes(wellId: string): Feedback[] {
    return this.feedback.filter((f) => f.kind === "shared_note" && f.targetId === wellId && f.status !== "superseded")
  }

  validSharedNotes(wellId: string, date = this.today): Feedback[] {
    return this.sharedNotes(wellId).filter(
      (f) => (!f.validFrom || f.validFrom.slice(0, 10) <= date) && (!f.validTo || f.validTo.slice(0, 10) >= date),
    )
  }

  upcomingSharedNotes(wellId: string, date = this.today): Feedback[] {
    return this.sharedNotes(wellId).filter((f) => f.validFrom && f.validFrom.slice(0, 10) > date)
  }

  claims(wellId: string): Feedback[] {
    return this.feedback.filter((f) => f.kind === "status_claim" && f.targetId === wellId && f.status !== "superseded")
  }

  isOpen(m: MaintenanceRow): boolean {
    return !m.completed_at || dateOf(m.completed_at) > this.today
  }

  openRepairs(wellId: string): MaintenanceRow[] {
    return (this.ds.mntByWell.get(wellId) ?? []).filter((m) => this.isOpen(m))
  }

  /** Notes tied to an inspection by field or by mentioning its ID in the text. */
  notesForInspection(insp: InspectionRow): NoteRow[] {
    const id = insp.inspection_id
    return (this.ds.notesByWell.get(insp.asset_id) ?? []).filter(
      (n) => n.inspection_id === id || n.text.includes(id),
    )
  }

  inspectionNoteConflict(insp: InspectionRow): Conflict | null {
    const notes = this.notesForInspection(insp).filter((n) => n.note_type !== "correction")
    const authors = new Set(notes.map((n) => n.author_user_id))
    if (notes.length < 2 || authors.size < 2) return null
    return {
      subject: inspectionRef(this.id, insp),
      sides: notes.map((n) => ({
        claim: n.text,
        author: this.userName(n.author_user_id),
        source: noteRef(this.id, n),
        status: "data" as const,
      })),
    }
  }

  // ── spills ──────────────────────────────────────────────────────────────────

  containmentFor(repairs: MaintenanceRow[]): { hours?: number; fact?: FactRow; repair?: MaintenanceRow } {
    for (const m of repairs) {
      const f = (this.ds.factsByMnt.get(m.maintenance_id) ?? []).find((x) => x.fact === "containment_hours")
      if (f) return { hours: Number(f.value), fact: f, repair: m }
    }
    return {}
  }

  spills(wells: WellRow[], w?: Window): Spill[] {
    const out: Spill[] = []
    for (const well of wells) {
      for (const e of this.inspections(well.asset_id, w)) {
        if (!this.isRealSpill(e)) continue
        const repairs = this.ds.mntByTrigger.get(e.insp.inspection_id) ?? []
        const c = this.containmentFor(repairs)
        const rc = repairs
          .flatMap((m) => this.ds.factsByMnt.get(m.maintenance_id) ?? [])
          .find((f) => f.fact === "reported_class")
        out.push({
          well,
          eff: e,
          cls: this.spillClass(e.volume),
          repairs,
          containmentHours: c.hours,
          containmentFact: c.fact,
          reportedClass: rc,
          linkedNotes: this.notesForInspection(e.insp).filter((n) => n.note_type !== "correction"),
        })
      }
    }
    return out
  }

  // ── protocol checks ─────────────────────────────────────────────────────────

  private wellEventsFor(insp: string): RegulatoryEventRow[] {
    return this.ds.regByInsp.get(insp) ?? []
  }

  checkSpill(s: Spill): ComplianceCheck[] {
    const out: ComplianceCheck[] = []
    const { well, eff } = s
    const type = well.well_type
    const ts = eff.insp.inspected_at
    const base = { well, subject: eff.insp.inspection_id, date: eff.date }
    const inspEv = inspectionRef(this.id, eff.insp, eff.corrections[0]?.id)
    const events = this.wellEventsFor(eff.insp.inspection_id)
    const reportable = s.cls === "reportable" || s.cls === "major"

    if (reportable) {
      const major = s.cls === "major"
      const r = this.rule(major ? "sr01_major_hours" : "sr01_hours", type, well.asset_id)
      const limit = r?.num
      const filed = events.find((e) => e.event_type === "spill_report_filed")
      const nov = events.find((e) => e.event_type === "notice_of_violation")
      if (limit === undefined) {
        out.push({ ...base, protocol: "SR-01", requirement: "Written notice deadline unknown (rule missing)", status: "unknown", detail: "SR-01 deadline not found in the SOP", evidence: [inspEv] })
      } else if (filed) {
        const h = filed.hours_to_report
        const breach = h !== null && h > limit
        out.push({
          ...base,
          protocol: "SR-01",
          requirement: `Written notice within ${limit} h of discovery`,
          due: addHours(ts, limit).slice(0, 16) + "Z",
          actual: h !== null ? `${h} h (${filed.event_id})` : filed.event_id,
          status: h === null ? "unknown" : breach ? "breach" : "met",
          detail: `${filed.detail}${nov ? ` Notice of violation ${nov.event_id}${nov.fine_usd ? `, fine USD ${nov.fine_usd}` : ""} (${nov.status}).` : ""}`,
          evidence: [inspEv, regRef(this.id, filed), ...(nov ? [regRef(this.id, nov)] : []), r!.source],
        })
      } else {
        const due = addHours(ts, limit)
        const overdue = due < `${this.today}T00:00:00Z`
        out.push({
          ...base,
          protocol: "SR-01",
          requirement: `Written notice within ${limit} h of discovery`,
          due: due.slice(0, 16) + "Z",
          actual: "no written notice on record",
          status: overdue ? "overdue" : "open",
          detail: overdue ? "No spill report is recorded for this inspection and the deadline has passed: possible SR-01 breach" : "No spill report recorded yet; deadline not reached",
          evidence: [inspEv, r!.source],
        })
      }
    }

    // SR-02 containment (all spills, from report text)
    {
      const r = this.rule("sr02_hours", type, well.asset_id)
      const limit = r?.num
      if (limit !== undefined) {
        if (s.containmentHours === undefined) {
          out.push({ ...base, protocol: "SR-02", requirement: `Contained within ${limit} h of discovery`, status: "unknown", detail: "No containment time found in a repair report", evidence: [inspEv, r!.source] })
        } else {
          const rep = s.repairs.find((m) => this.ds.factsByMnt.get(m.maintenance_id)?.includes(s.containmentFact!))!
          out.push({
            ...base,
            protocol: "SR-02",
            requirement: `Contained within ${limit} h of discovery`,
            actual: `${s.containmentHours} h`,
            status: s.containmentHours > limit ? "breach" : "met",
            detail: s.containmentFact!.quote.replace(/\*\*/g, "").replace(/\s+/g, " "),
            evidence: [inspEv, reportRef(this.id, rep, s.containmentFact), r!.source],
          })
        }
      }
    }

    if (reportable) {
      const r = this.rule("sr03_days", type, well.asset_id)
      const days = r?.num
      if (days !== undefined) {
        const due = addDays(eff.date, days)
        const closed = events.find((e) => e.protocol_id === "SR-03" && e.event_type === "site_inspection" && e.status === "closed")
        const open = events.find((e) => e.protocol_id === "SR-03" && e.event_type === "site_inspection")
        out.push({
          ...base,
          protocol: "SR-03",
          requirement: `Agency verification within ${days} days of discovery`,
          due,
          actual: closed ? `closed ${closed.date}` : "not verified",
          status: closed ? "met" : due < this.today ? "overdue" : "open",
          detail: closed ? closed.detail : open ? open.detail : "No passing agency site inspection on record",
          evidence: [inspEv, ...(closed ? [regRef(this.id, closed)] : open ? [regRef(this.id, open)] : []), r!.source],
        })
      }
    }

    for (const nov of events.filter((e) => e.event_type === "notice_of_violation")) {
      const c = this.checkNov(well, nov)
      if (c) out.push({ ...c, subject: eff.insp.inspection_id })
    }
    return out
  }


  /** RC-04: a notice of violation must be answered within the SOP deadline. */
  checkNov(well: WellRow, nov: RegulatoryEventRow): ComplianceCheck | null {
    const r = this.rule("rc04_days", well.well_type, well.asset_id)
    const days = r?.num
    if (days === undefined) return null
    const due = addDays(nov.date, days)
    const resp = (this.ds.regByWell.get(well.asset_id) ?? []).find(
      (e) => e.event_type === "nov_response_filed" && e.date >= nov.date && (!e.related_inspection_id || e.related_inspection_id === nov.related_inspection_id),
    )
    return {
      well,
      protocol: "RC-04",
      subject: nov.related_inspection_id ?? undefined,
      date: nov.date,
      requirement: `Respond to notice of violation within ${days} days`,
      due,
      actual: resp ? `response filed ${resp.date}` : "no response recorded",
      status: resp ? "met" : nov.status === "closed" ? "unknown" : due < this.today ? "breach" : "open",
      detail: `${nov.event_id}: ${nov.detail} Fine USD ${nov.fine_usd ?? 0}, ${nov.status}.`,
      evidence: [regRef(this.id, nov), ...(resp ? [regRef(this.id, resp)] : []), r!.source],
    }
  }

  /** Compliance checks for one well over a window (spill-driven SR/RC-04 plus RC-01 gaps and RC-02). */
  complianceFor(well: WellRow, w?: Window): ComplianceCheck[] {
    const checks = this.spills([well], w).flatMap((s) => this.checkSpill(s))
    const type = well.well_type
    const seenNov = new Set(checks.filter((c) => c.protocol === "RC-04").map((c) => c.evidence[0]?.id))
    for (const nov of this.ds.regByWell.get(well.asset_id) ?? []) {
      if (nov.event_type !== "notice_of_violation" || !this.inWindow(nov.date, w) || seenNov.has(nov.event_id)) continue
      const c = this.checkNov(well, nov)
      if (c) checks.push(c)
    }
    const gap = this.ruleNum("rc01_days", type, well.asset_id)
    if (gap !== undefined) {
      const r = this.rule("rc01_days", type, well.asset_id)!
      const list = this.inspections(well.asset_id, w)
      for (let i = 1; i < list.length; i++) {
        const d = Math.round(hoursBetween(list[i]!.insp.inspected_at, list[i - 1]!.insp.inspected_at) / 24)
        if (d > gap)
          checks.push({
            well,
            protocol: "RC-01",
            subject: list[i]!.insp.inspection_id,
            date: list[i]!.date,
            requirement: `Inspect at least every ${gap} days`,
            actual: `${d} days between ${list[i - 1]!.date} and ${list[i]!.date}`,
            status: "breach",
            detail: "Gap between consecutive inspections exceeds the limit",
            evidence: [inspectionRef(this.id, list[i - 1]!.insp), inspectionRef(this.id, list[i]!.insp), r.source],
          })
      }
    }
    if (gap !== undefined && (!w || w.to >= this.today)) {
      const last = this.ds.inspByWell.get(well.asset_id)?.at(-1)
      if (last) {
        const d = Math.round((Date.parse(`${this.today}T00:00:00Z`) - Date.parse(last.inspected_at)) / 86_400_000)
        if (d > gap)
          checks.push({
            well,
            protocol: "RC-01",
            subject: last.inspection_id,
            date: dateOf(last.inspected_at),
            requirement: `Inspect at least every ${gap} days`,
            actual: `${d} days since the last inspection (${dateOf(last.inspected_at)})`,
            status: "breach",
            detail: "No inspection recorded within the limit before the dataset date",
            evidence: [inspectionRef(this.id, last), this.rule("rc01_days", type, well.asset_id)!.source],
          })
      }
    }
    const rc03 = this.rule("rc03_days", type, well.asset_id)
    if (rc03?.num !== undefined) {
      const per = this.ruleNum("downtime_days_per_inspection", "") ?? 7
      let run: Eff[] = []
      const flush = () => {
        if (run.length * per > rc03.num!)
          checks.push({
            well,
            protocol: "RC-03",
            subject: run[0]!.insp.inspection_id,
            date: run[0]!.date,
            requirement: `Report downtime of more than ${rc03.num} consecutive days to the area production supervisor`,
            actual: `${run.length * per} days not producing (${run[0]!.date} to ${run[run.length - 1]!.date})`,
            status: "open",
            detail: "Whether the supervisor was told is not recorded in inspections; check the notes",
            evidence: [...run.slice(0, 4).map((e) => inspectionRef(this.id, e.insp)), rc03.source],
          })
        run = []
      }
      for (const e of this.inspections(well.asset_id, w)) {
        if (this.producing(e, well) === false) run.push(e)
        else flush()
      }
      flush()
    }
    const issue = this.rule("rc02_issue_text", type, well.asset_id)
    if (issue) {
      const year = this.today.slice(0, 4)
      const test = (this.ds.mntByWell.get(well.asset_id) ?? []).find(
        (m) => m.issue.toLowerCase() === issue.value.toLowerCase() && m.started_at.startsWith(year),
      )
      checks.push({
        well,
        protocol: "RC-02",
        date: test ? dateOf(test.started_at) : this.today,
        requirement: `Flowline integrity test once per calendar year (${year})`,
        actual: test ? `done ${dateOf(test.started_at)} (${test.maintenance_id})` : "not recorded this year",
        status: test ? "met" : "open",
        detail: test ? `${test.issue}: ${test.action_taken}` : "No annual flowline integrity test recorded yet this calendar year",
        evidence: [...(test ? [maintenanceRef(this.id, test)] : []), issue.source],
      })
    }
    return checks
  }

  // ── downtime ────────────────────────────────────────────────────────────────

  downtime(well: WellRow, w?: Window) {
    const per = this.ruleNum("downtime_days_per_inspection", "")
    const list = this.inspections(well.asset_id, w)
    const down = list.filter((e) => this.producing(e, well) === false)
    const unknown = list.filter((e) => this.producing(e, well) === null).length
    return { inspections: list.length, down, unknown, days: per === undefined ? undefined : down.length * per, perInspection: per }
  }

  // ── root-cause analysis ─────────────────────────────────────────────────────

  rcaCounts(well: WellRow, equipmentKind?: string) {
    const months = this.ruleNum("rca_window_months", well.well_type, well.asset_id)
    const count = this.rule("rca_count", well.well_type, well.asset_id)
    if (months === undefined || count?.num === undefined) return { missing: true as const, rows: [] as never[] }
    const from = addMonths(this.today, -months)
    const jobs = (this.ds.mntByWell.get(well.asset_id) ?? []).filter(
      (m) =>
        m.maintenance_type === "corrective" &&
        dateOf(m.started_at) >= from &&
        dateOf(m.started_at) <= this.today &&
        (!equipmentKind || m.equipment_kind === equipmentKind),
    )
    const byKind = new Map<string, MaintenanceRow[]>()
    for (const m of jobs) byKind.set(m.equipment_kind, [...(byKind.get(m.equipment_kind) ?? []), m])
    return {
      missing: false as const,
      from,
      months,
      threshold: count,
      manual: this.registryRule("rca_count", well.well_type),
      rows: [...byKind.entries()].map(([kind, ms]) => ({ kind, jobs: ms, meets: ms.length >= count.num! })),
    }
  }

  // ── conflicts and evidence helpers ──────────────────────────────────────────

  evidenceForWell(w: WellRow) {
    return wellRef(this.id, w)
  }

  collect(refs: EvidenceRef[]) {
    return dedupeEvidence(refs)
  }

  describeDate(d: string) {
    return fmtDate(d)
  }
}
