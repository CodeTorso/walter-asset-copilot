import { sql } from "drizzle-orm"
import type { Column, Conflict, EvidenceRef, Finding, Row, WellRow } from "../../contracts"
import type { ComplianceCheck, Domain, Eff, Spill } from "../engine/domain"
import {
  feedbackRef,
  inspectionRef,
  maintenanceRef,
  noteRef,
  regRef,
  reportRef,
  wellRef,
} from "../engine/evidence"
import { addMonths, dateOf, fmtDate, fmtRange, monthKey } from "../util/dates"
import { dbOf, loadDomain, ruleApplied, type ToolCtx } from "./ctx"
import { finish } from "./memory"
import type {
  ComplianceArgs,
  DowntimeArgs,
  GetRuleArgs,
  MaintenanceArgs,
  RcaArgs,
  ReadingSeriesArgs,
  SearchDocsArgs,
  SpillsArgs,
  WellContextArgs,
  WellStatusArgs,
} from "./schemas"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const num = (n: number | null | undefined) => (n === null || n === undefined ? null : n)

function areaName(d: Domain, w: WellRow) {
  return d.ds.areas.get(w.area_id)?.name ?? w.area_id
}

function describeStatus(p: boolean | null) {
  return p === null ? "unknown (rule missing)" : p ? "producing" : "not producing"
}

function repairText(d: Domain, wellId: string) {
  return d.openRepairs(wellId).map((m) => `${m.maintenance_id}: ${m.issue} (${m.equipment_kind}), started ${fmtDate(m.started_at)}, still open`)
}

function correctionConflict(d: Domain, e: Eff, well: WellRow): Conflict[] {
  const out: Conflict[] = []
  const note = e.insp.notes?.trim()
  const dataFix = e.corrections.filter((c) => c.field === "wellhead_temp_c" || c.field === "ambient_temp_c")
  if (dataFix.length && note) {
    const fb = d.feedback.find((f) => f.id === dataFix[0]!.id)!
    out.push({
      subject: inspectionRef(d.id, e.insp, fb.id),
      sides: [
        {
          claim: `${fb.field} corrected from ${fb.originalValue} to ${fb.newValue}${fb.reason ? ` (${fb.reason})` : ""}`,
          author: d.userName(fb.authorUserId),
          source: feedbackRef(d.id, fb),
          status: "applied",
        },
        { claim: note, author: d.userName(e.insp.inspector_user_id), source: inspectionRef(d.id, e.insp), status: "data" },
      ],
      needsConfirmationFrom: fb.authorUserId,
    })
  }
  const nc = d.inspectionNoteConflict(e.insp)
  if (nc) out.push(nc)
  // claims that disagree with the data
  const p = d.producing(e, well)
  for (const c of d.claims(well.asset_id)) {
    if (c.status === "unconfirmed" || c.status === "disputed")
      out.push({
        subject: wellRef(d.id, well),
        sides: [
          { claim: c.text, author: d.userName(c.authorUserId), source: feedbackRef(d.id, c), status: c.status },
          {
            claim: `Latest inspection ${e.date}: wellhead ${e.delta} °C above air, ${describeStatus(p)}`,
            source: inspectionRef(d.id, e.insp),
            status: "data",
          },
        ],
        needsConfirmationFrom: c.authorUserId,
      })
  }
  return out
}

export async function wellStatus(ctx: ToolCtx, args: WellStatusArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const wells = d.resolveWells(args.scope)
  ctx.onProgress?.(`read ${wells.length} wells`, { wells: wells.length })
  const rows: Row[] = []
  const rowEvidence: EvidenceRef[][] = []
  const conflicts: Conflict[] = []
  const rules: Finding["rulesApplied"] = []
  const noReason: string[] = []
  let latestCount = 0
  let openCount = 0
  let staleCount = 0
  const droppedByCorrection: string[] = []
  for (const w of wells) {
    const list = d.ds.inspByWell.get(w.asset_id) ?? []
    const insp = args.at ? [...list].reverse().find((i) => dateOf(i.inspected_at) <= args.at!.slice(0, 10)) : list[list.length - 1]
    if (!insp) continue
    latestCount++
    const e = d.eff(insp)
    const th = d.threshold(w)
    const p = d.producing(e, w)
    if (args.onlyNotProducing && p !== false) {
      // A well that drops out of the list only because someone corrected its reading must still be explained.
      const fix = e.corrections.find((c) => c.field === "wellhead_temp_c" || c.field === "ambient_temp_c")
      const t = d.threshold(w)?.num
      if (fix && t !== undefined) {
        const head = fix.field === "wellhead_temp_c" ? Number(fix.original) : e.wellhead
        const air = fix.field === "ambient_temp_c" ? Number(fix.original) : e.ambient
        if (head - air < t)
          droppedByCorrection.push(
            `${w.asset_id} is no longer listed: its ${dateOf(insp.inspected_at)} ${fix.field === "wellhead_temp_c" ? "wellhead" : "air"} reading (${insp.inspection_id}) was corrected from ${fix.original} to ${fix.value} °C by ${fix.author} (${fix.id}), so it now counts as producing.`,
          )
      }
      continue
    }
    const recProd = w.recorded_status === "active" ? true : w.recorded_status === "down" ? false : null
    if (args.recordedStatusMismatchOnly && !(p !== null && recProd !== null && p !== recProd)) continue
    if (th) rules.push(ruleApplied(th))
    const repairs = repairText(d, w.asset_id)
    openCount += repairs.length
    const notes = d.validNotes(w.asset_id)
    const shared = d.validSharedNotes(w.asset_id)
    const reasonParts = [
      ...repairs,
      ...notes.map((n) => `${n.note_id} (${d.userName(n.author_user_id)}): ${n.text}`),
      ...shared.map((n) => `${n.id} (${d.userName(n.authorUserId)}): ${n.text}`),
    ]
    const recordedProducing = w.recorded_status === "active" ? true : w.recorded_status === "down" ? false : null
    const stale = p !== null && recordedProducing !== null && p !== recordedProducing
    if (stale) staleCount++
    if (p === false && !reasonParts.length) noReason.push(w.asset_id)
    const orig = e.corrections.find((c) => c.field === "wellhead_temp_c")?.original
    rows.push({
      well: w.asset_id,
      area: areaName(d, w),
      well_type: w.well_type,
      inspection: insp.inspection_id,
      inspected_at: insp.inspected_at,
      inspected_by: d.userName(insp.inspector_user_id),
      method: insp.method,
      wellhead_c: e.wellhead,
      ambient_c: e.ambient,
      delta_c: e.delta,
      threshold_c: th?.num ?? null,
      alarm_max_c: d.ruleNum("temp_alarm_c", w.well_type, w.asset_id) ?? null,
      status: describeStatus(p),
      recorded_status: w.recorded_status,
      recorded_status_out_of_date: stale,
      reason: p === false ? (reasonParts.length ? reasonParts.join(" | ") : "No recorded reason") : reasonParts.join(" | "),
      open_repairs: repairs.length,
      inspector_note: insp.notes || null,
      corrected: e.corrections.length > 0,
      original_wellhead_c: typeof orig === "number" ? orig : null,
    })
    rowEvidence.push([
      wellRef(d.id, w),
      inspectionRef(d.id, insp, e.corrections[0]?.id),
      ...(th ? [th.source] : []),
      ...d.openRepairs(w.asset_id).map((m) => maintenanceRef(d.id, m)),
      ...notes.map((n) => noteRef(d.id, n)),
      ...shared.map((n) => feedbackRef(d.id, n)),
      ...e.corrections.map((c) => feedbackRef(d.id, d.feedback.find((f) => f.id === c.id)!)),
    ])
    conflicts.push(...correctionConflict(d, e, w))
  }
  ctx.onProgress?.(`${latestCount} latest inspections · ${openCount} open repairs`, { inspections: latestCount, openRepairs: openCount })
  const notProd = rows.filter((r) => r.status === "not producing").length
  const caveats: string[] = []
  if (noReason.length) caveats.push(`No recorded reason for ${noReason.join(", ")}: no repair or valid note explains the stop. A field check is suggested; no cause is inferred.`)
  if (staleCount) caveats.push(`${staleCount} well(s) have a recorded status that disagrees with the latest inspection; the inspection is treated as the truth.`)
  caveats.push(...droppedByCorrection)
  const corrected = rows.filter((r) => r.corrected).map((r) => r.well)
  if (corrected.length) caveats.push(`Reading corrected by feedback for ${corrected.join(", ")}; original values are kept.`)
  // Fit a chat column: area only when the answer spans areas; the rule limit lives in the caption.
  const manyAreas = new Set(rows.map((r) => r.area)).size > 1
  const columns: Column[] = [
    { key: "well", label: "Well", type: "well" },
    ...(manyAreas ? [{ key: "area", label: "Area", type: "text" as const }] : []),
    { key: "well_type", label: "Type", type: "text" },
    { key: "delta_c", label: "Wellhead above air", type: "number", unit: "°C" },
    { key: "status", label: "Status", type: "status" },
    { key: "recorded_status", label: "Recorded status", type: "text" },
    { key: "reason", label: "Reason", type: "text" },
  ]
  return finish(
    ctx,
    d,
    {
      workerId: "field",
      tool: "well_status",
      shape: rows.length === 1 ? "single_entity" : "list",
      title: `Well status: ${d.scopeLabel(args.scope)}${args.at ? ` as of ${args.at}` : ""}`,
      columns,
      rows,
      rowEvidence,
      rulesApplied: rules,
      conflicts,
      caveats,
      slots: { wells: rows.length, notProducing: notProd, producing: rows.length - notProd },
    },
    args.limit,
  )
}

export async function readingSeries(ctx: ToolCtx, args: ReadingSeriesArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const well = d.getWell(args.wellId)
  const period = args.weeks ? { kind: "last_n_days" as const, n: args.weeks * 7 } : args.period
  const win = d.resolvePeriod(period, "by_date")
  const readings = d.inspections(well.asset_id, win)
  ctx.onProgress?.(`read ${readings.length} weekly readings for ${well.asset_id}`, { readings: readings.length })
  const th = d.threshold(well)
  const rows: Row[] = readings.map((e) => {
    const p = d.producing(e, well)
    return {
      date: e.date,
      inspection: e.insp.inspection_id,
      wellhead_c: e.wellhead,
      ambient_c: e.ambient,
      delta_c: e.delta,
      threshold_c: th?.num ?? null,
      producing: p,
      not_producing: p === false,
      corrected: e.corrections.length > 0,
    }
  })
  const notProd = rows.filter((r) => r.not_producing).map((r) => String(r.date))
  return finish(ctx, d, {
    workerId: "field",
    tool: "reading_series",
    shape: "series",
    title: `${well.asset_id} wellhead vs air temperature${win ? ` (${win.label})` : ""}`,
    window: win,
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "wellhead_c", label: "Wellhead", type: "number", unit: "°C" },
      { key: "ambient_c", label: "Air", type: "number", unit: "°C" },
      { key: "delta_c", label: "Above air", type: "number", unit: "°C" },
      { key: "not_producing", label: "Not producing", type: "status" },
    ],
    rows,
    rowEvidence: readings.map((e) => [inspectionRef(d.id, e.insp, e.corrections[0]?.id)]),
    rulesApplied: th ? [ruleApplied(th)] : [],
    slots: { readings: rows.length, notProducingCount: notProd.length, notProducingDates: notProd.join(", "), thresholdC: th?.num ?? "unknown" },
    caveats: th ? [] : ["The producing-temperature rule is missing for this well type, so producing status is unknown."],
    followUps: ["How many days was this well down in 2025?", "Why is this well not producing?"],
  })
}

export async function downtime(ctx: ToolCtx, args: DowntimeArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const wells = d.resolveWells(args.scope)
  const win = d.resolvePeriod(args.period, "by_date")
  const per = d.ruleNum("downtime_days_per_inspection", "")
  const stats = wells.map((w) => ({ well: w, ...d.downtime(w, win) }))
  const total = stats.reduce((s, x) => s + x.inspections, 0)
  ctx.onProgress?.(`read ${wells.length} wells · ${total} inspections`, { wells: wells.length, inspections: total })
  const rules: Finding["rulesApplied"] = []
  const types = [...new Set(wells.map((w) => w.well_type))]
  for (const t of types) {
    const th = d.rule("producing_delta_c", t)
    if (th) rules.push(ruleApplied(th))
  }
  const dr = d.rule("downtime_days_per_inspection", "")
  if (dr) rules.push(ruleApplied(dr))
  const caveats: string[] = ["Downtime counts each inspection in the period that finds the well not producing as 7 days; a missed inspection adds nothing. Repair downtime_hours is not used."]
  if (win) caveats[0] += ` Compared by inspection date (${win.label}).`
  const unknown = stats.reduce((s, x) => s + x.unknown, 0)
  if (unknown) caveats.push(`${unknown} readings could not be classified because the producing rule is missing for their well type.`)

  if (args.detail || (wells.length === 1 && !args.rank)) {
    const rows: Row[] = []
    const rowEvidence: EvidenceRef[][] = []
    for (const s of stats)
      for (const e of s.down) {
        const covering = (d.ds.mntByWell.get(s.well.asset_id) ?? []).filter(
          (m) => dateOf(m.started_at) <= e.date && (!m.completed_at || dateOf(m.completed_at) >= e.date),
        )
        const triggered = d.ds.mntByTrigger.get(e.insp.inspection_id) ?? []
        const overlapping = [...new Map([...triggered, ...covering].map((m) => [m.maintenance_id, m])).values()]
        rows.push({
          well: s.well.asset_id,
          date: e.date,
          inspection: e.insp.inspection_id,
          wellhead_c: e.wellhead,
          ambient_c: e.ambient,
          delta_c: e.delta,
          threshold_c: d.threshold(s.well)?.num ?? null,
          days: per ?? null,
          repairs_in_progress: overlapping.map((m) => `${m.maintenance_id}: ${m.issue}`).join(" | ") || null,
        })
        rowEvidence.push([inspectionRef(d.id, e.insp, e.corrections[0]?.id), ...overlapping.map((m) => maintenanceRef(d.id, m))])
      }
    const days = stats.reduce((s, x) => s + (x.days ?? 0), 0)
    return finish(ctx, d, {
      workerId: "field",
      tool: "downtime",
      shape: "list",
      title: `Downtime ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
      window: win,
      columns: [
        { key: "date", label: "Date", type: "date" },
        { key: "delta_c", label: "Above air", type: "number", unit: "°C" },
        { key: "threshold_c", label: "Limit", type: "number", unit: "°C" },
        { key: "days", label: "Counted", type: "number", unit: "days" },
        { key: "repairs_in_progress", label: "Repair (triggered or in progress)", type: "text" },
      ],
      rows,
      rowEvidence,
      rulesApplied: rules,
      caveats,
      slots: { totalDays: days, notProducingInspections: rows.length, wells: wells.length },
      followUps: ["Show a line chart of these readings", "What repairs were done in that period?"],
    })
  }

  stats.sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || a.well.asset_id.localeCompare(b.well.asset_id))
  let shown = stats
  const ties: string[] = []
  if (args.rank && stats.length > args.rank) {
    const cut = stats[args.rank - 1]!.days ?? 0
    shown = stats.filter((s) => (s.days ?? 0) >= cut && ((s.days ?? 0) > 0 || cut > 0))
    const atCut = stats.filter((s) => (s.days ?? 0) === cut)
    if (shown.length > args.rank) {
      const first = stats.findIndex((s) => (s.days ?? 0) === cut) + 1
      ties.push(`${atCut.length} wells tie at ${cut} days (places ${first} to ${first + atCut.length - 1}): ${atCut.map((s) => s.well.asset_id).join(", ")}. All tied wells are shown; ties are not broken.`)
    }
  }
  const rows = shown.map((s, i) => ({
    rank: i + 1,
    well: s.well.asset_id,
    area: areaName(d, s.well),
    well_type: s.well.well_type,
    days_down: s.days ?? null,
    not_producing_inspections: s.down.length,
    inspections_in_period: s.inspections,
    threshold_c: d.threshold(s.well)?.num ?? null,
  }))
  const next = args.rank ? stats[shown.length] : undefined
  return finish(ctx, d, {
    workerId: "field",
    tool: "downtime",
    shape: "ranking",
    title: `Downtime ranking: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
    window: win,
    columns: [
      { key: "rank", label: "#", type: "number" },
      { key: "well", label: "Well", type: "well" },
      { key: "days_down", label: "Days down", type: "number", unit: "days" },
      { key: "well_type", label: "Type", type: "text" },
      { key: "not_producing_inspections", label: "Not-producing inspections", type: "number" },
    ],
    rows,
    rowEvidence: shown.map((s) => [wellRef(d.id, s.well), ...s.down.slice(0, 12).map((e) => inspectionRef(d.id, e.insp, e.corrections[0]?.id))]),
    rulesApplied: rules,
    ties: ties.length ? ties : undefined,
    caveats,
    slots: {
      wellsRanked: rows.length,
      topDays: rows[0]?.days_down ?? 0,
      totalDaysAllWells: stats.reduce((a, x) => a + (x.days ?? 0), 0),
      ...(next ? { nextWell: next.well.asset_id, nextDays: next.days ?? 0 } : {}),
    },
    followUps: ["What have repairs cost for these wells this year?", "Show downtime details for the top well"],
  }, Math.min(200, Math.max(shown.length, 1)))
}

function spillRow(d: Domain, s: Spill) {
  const e = s.eff
  const checks = d.checkSpill(s)
  const sr01 = checks.find((c) => c.protocol === "SR-01")
  const orig = e.corrections.find((c) => c.field === "spill_est_volume_bbl")?.original
  const lim = d.ruleNum("sr02_hours", s.well.well_type, s.well.asset_id)
  return {
    well: s.well.asset_id,
    area: areaName(d, s.well),
    date: e.date,
    inspected_at: e.insp.inspected_at,
    inspection: e.insp.inspection_id,
    volume_bbl: num(e.volume),
    original_volume_bbl: typeof orig === "number" ? orig : null,
    spill_area_pct: num(e.areaPct),
    class: s.cls,
    written_notice: sr01 ? (sr01.status === "met" ? `filed (${sr01.actual})` : sr01.status === "overdue" ? "overdue: no written notice on record" : sr01.status === "breach" ? `late: ${sr01.actual}` : sr01.status) : "not required",
    containment_hours: s.containmentHours ?? null,
    containment_over_limit: s.containmentHours !== undefined && lim !== undefined ? s.containmentHours > lim : null,
    report_class: s.reportedClass?.value ?? null,
    repair: s.repairs.map((m) => m.maintenance_id).join(", ") || null,
    lat: s.well.location.lat,
    lon: s.well.location.lon,
    inspector_note: e.insp.notes || null,
  }
}

export async function spills(ctx: ToolCtx, args: SpillsArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const wells = d.resolveWells(args.scope)
  const win = d.resolvePeriod(args.period, "by_date")
  let list = d.spills(wells, win)
  const rawDetections = wells.reduce((s, w) => s + d.inspections(w.asset_id, win).filter((e) => e.spillDetected).length, 0)
  const excluded = rawDetections - list.length
  ctx.onProgress?.(`read ${wells.length} wells · ${list.length} real spills · ${excluded} corrected detections excluded`, { wells: wells.length, spills: list.length, excluded })
  const rules: Finding["rulesApplied"] = []
  const rr = d.rule("spill_class_reportable_bbl", "")
  if (rr) rules.push(ruleApplied(rr))
  if (args.reportableOnly) list = list.filter((s) => s.cls === "reportable" || s.cls === "major")
  if (args.minVolumeBbl !== undefined) list = list.filter((s) => (s.eff.volume ?? 0) >= args.minVolumeBbl!)
  if (args.containmentOverLimit) {
    const r = d.rule("sr02_hours", "")
    if (r) rules.push(ruleApplied(r))
    list = list.filter((s) => {
      const lim = d.ruleNum("sr02_hours", s.well.well_type, s.well.asset_id)
      return s.containmentHours !== undefined && lim !== undefined && s.containmentHours > lim
    })
  }
  const caveats = ["Detections later corrected by a context note (e.g. rainwater) or by feedback are excluded. Volumes are the AI estimate unless corrected."]
  // Name each excluded detection and the note that overturned it, so the answer can say why the count is lower.
  const extraEvidence: EvidenceRef[] = []
  const excludedList = wells.flatMap((w) => d.inspections(w.asset_id, win).filter((e) => e.spillDetected && e.correctionNote))
  if (excludedList.length > 3) caveats.push(`${excludedList.length} detections in this period were corrected by notes (e.g. rainwater) and are not counted.`)
  else for (const e of excludedList) {
    const n = e.correctionNote!
    caveats.push(`Not counted: detection ${e.insp.inspection_id} (${dateOf(e.insp.inspected_at)}) was corrected by note ${n.note_id} (${d.userName(n.author_user_id)}): ${n.text}`)
    extraEvidence.push(noteRef(d.id, n), inspectionRef(d.id, e.insp))
  }
  const total = list.reduce((s, x) => s + (x.eff.volume ?? 0), 0)
  const conflicts: Conflict[] = []
  const seen = new Set<string>()
  for (const s of list) {
    const c = d.inspectionNoteConflict(s.eff.insp)
    if (c && !seen.has(s.eff.insp.inspection_id)) {
      seen.add(s.eff.insp.inspection_id)
      conflicts.push(c)
      const fix = s.repairs[0]
      if (list.length <= 10) caveats.push(
        `Notes disagree about ${s.eff.insp.inspection_id}; none is a formal correction${fix ? ` and a spill repair (${fix.maintenance_id}) was done` : ""}, so the detection stands.`,
      )
      if (fix) extraEvidence.push(maintenanceRef(d.id, fix))
    }
  }
  for (const s of list) {
    const stale = s.reportedClass && s.cls !== "unknown" && s.reportedClass.value !== s.cls && s.eff.corrections.length
    if (stale) caveats.push(`${s.well.asset_id} ${s.eff.date}: repair report ${s.repairs[0]?.maintenance_id} classed this spill "${s.reportedClass!.value}" from the earlier estimate; with the corrected volume it is "${s.cls}".`)
  }
  const groupBy = args.groupBy ?? "none"

  if (groupBy === "area_month" && win) {
    const months: string[] = []
    for (let m = monthKey(win.from); m <= monthKey(win.to); m = monthKey(addMonths(`${m}-01`, 1))) months.push(m)
    const areas = args.scope.areaName ? [d.findArea(args.scope.areaName)] : [...d.ds.areas.values()]
    const rows: Row[] = areas.map((a) => {
      const r: Row = { area: a.name }
      let t = 0
      for (const m of months) {
        const n = list.filter((s) => s.well.area_id === a.area_id && monthKey(s.eff.date) === m).length
        r[m] = n
        t += n
      }
      r.total = t
      return r
    })
    return finish(ctx, d, {
      workerId: "field",
      tool: "spills",
      shape: "matrix",
      title: `Spills by area and month (${win.label})`,
      window: win,
      columns: [
        { key: "area", label: "Area", type: "text" },
        ...months.map((m) => ({ key: m, label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`, type: "number" as const })),
        { key: "total", label: "Total", type: "number" as const },
      ],
      rows,
      rulesApplied: rules,
      caveats: [...caveats, `${excluded} corrected detection(s) removed from these counts.`],
      slots: { totalSpills: list.length, correctedExcluded: excluded, ...Object.fromEntries(rows.map((r) => [`total_${String(r.area).replace(/\W+/g, "_")}`, r.total as number])) },
      evidence: [...list.slice(0, 40).map((s) => inspectionRef(d.id, s.eff.insp)), ...extraEvidence],
      followUps: ["Show this as a table", "Which area had the most spills in a single month?"],
    })
  }

  if (groupBy === "area" || groupBy === "well" || groupBy === "month" || groupBy === "year") {
    const keyOf = (s: Spill) =>
      groupBy === "area" ? areaName(d, s.well) : groupBy === "well" ? s.well.asset_id : groupBy === "year" ? s.eff.date.slice(0, 4) : monthKey(s.eff.date)
    const g = new Map<string, Spill[]>()
    for (const s of list) g.set(keyOf(s), [...(g.get(keyOf(s)) ?? []), s])
    // Time groups read left to right in time (every year in the window, even with no spills); others rank by count.
    if (groupBy === "year" && win) for (let y = Number(win.from.slice(0, 4)); y <= Number(win.to.slice(0, 4)); y++) if (!g.has(String(y))) g.set(String(y), [])
    const chrono = groupBy === "year" || groupBy === "month"
    const excludedBy = (k: string) => excludedList.filter((e) => (groupBy === "year" ? dateOf(e.insp.inspected_at).slice(0, 4) : monthKey(dateOf(e.insp.inspected_at))) === k).length
    const rows: Row[] = [...g.entries()]
      .sort((a, b) => (chrono ? a[0].localeCompare(b[0]) : b[1].length - a[1].length || a[0].localeCompare(b[0])))
      .map(([k, v]) => ({
        [groupBy === "well" ? "well" : groupBy]: k,
        spills: v.length,
        total_bbl: Number(v.reduce((s, x) => s + (x.eff.volume ?? 0), 0).toFixed(2)),
        ...(chrono ? { excluded: excludedBy(k) } : {}),
      }))
    return finish(ctx, d, {
      workerId: "field",
      tool: "spills",
      shape: "ranking",
      title: `Spills by ${groupBy}: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
      window: win,
      columns: [
        { key: groupBy === "well" ? "well" : groupBy, label: groupBy, type: groupBy === "well" ? "well" : "text" },
        { key: "spills", label: "Spills", type: "number" },
        { key: "total_bbl", label: "Volume", type: "number", unit: "bbl" },
        ...(groupBy === "year" || groupBy === "month" ? [{ key: "excluded", label: "Corrected detections excluded", type: "number" as const }] : []),
      ],
      rows,
      rulesApplied: rules,
      caveats,
      slots: { totalSpills: list.length, totalBbl: Number(total.toFixed(2)), correctedExcluded: excluded },
      evidence: [...list.slice(0, 40).map((s) => inspectionRef(d.id, s.eff.insp)), ...extraEvidence],
    })
  }

  list.sort((a, b) => a.eff.insp.inspected_at.localeCompare(b.eff.insp.inspected_at))
  const rows = list.map((s) => spillRow(d, s))
  return finish(
    ctx,
    d,
    {
      workerId: "field",
      tool: "spills",
      shape: "geo",
      title: `Spills: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
      window: win,
      columns: [
        { key: "well", label: "Well", type: "well" },
        { key: "date", label: "Date", type: "date" },
        { key: "volume_bbl", label: "Volume", type: "number", unit: "bbl" },
        { key: "class", label: "Class", type: "text" },
        { key: "written_notice", label: "Written notice", type: "text" },
        { key: "containment_hours", label: "Contained after", type: "number", unit: "h" },
        { key: "lat", label: "Lat", type: "number" },
        { key: "lon", label: "Lon", type: "number" },
      ],
      rows,
      rowEvidence: list.map((s) => [
        inspectionRef(d.id, s.eff.insp, s.eff.corrections[0]?.id),
        wellRef(d.id, s.well),
        ...s.repairs.map((m) => maintenanceRef(d.id, m)),
        ...s.linkedNotes.map((n) => noteRef(d.id, n)),
        ...s.eff.corrections.map((c) => feedbackRef(d.id, d.feedback.find((f) => f.id === c.id)!)),
        ...(s.containmentFact && args.containmentOverLimit ? [reportRef(d.id, s.repairs.find((m) => d.ds.factsByMnt.get(m.maintenance_id)?.includes(s.containmentFact!))!, s.containmentFact)] : []),
      ]),
      rulesApplied: rules,
      conflicts,
      caveats,
      slots: { spills: rows.length, totalBbl: Number(total.toFixed(2)), correctedExcluded: excluded },
      followUps: ["Show these on a map", "Which of these were not contained within the SOP limit?"],
    },
    args.limit,
  )
}

export async function maintenance(ctx: ToolCtx, args: MaintenanceArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const wells = d.resolveWells(args.scope)
  const win = d.resolvePeriod(args.period, "by_start_date")
  const type = args.maintenanceType ?? "all"
  const jobs = wells
    .flatMap((w) => (d.ds.mntByWell.get(w.asset_id) ?? []).map((m) => ({ m, w })))
    .filter(({ m }) => d.inWindow(m.started_at, win))
    .filter(({ m }) => type === "all" || m.maintenance_type === type)
    .filter(({ m }) => !args.equipmentKind || m.equipment_kind === args.equipmentKind)
    .filter(({ m }) => !args.openOnly || d.isOpen(m))
  ctx.onProgress?.(`read ${wells.length} wells · ${jobs.length} repair records`, { wells: wells.length, repairs: jobs.length })
  const totalCost = jobs.reduce((s, x) => s + x.m.cost_usd.total, 0)
  const inProgress = jobs.filter((x) => d.isOpen(x.m))
  const caveats = [`Jobs belong to a period by their start date${win ? ` (${win.label})` : ""}; all maintenance types are included unless filtered.`]
  if (inProgress.length) caveats.push(`${inProgress.length} job(s) are still in progress; their cost is the interim figure: ${inProgress.map((x) => x.m.maintenance_id).join(", ")}.`)
  const groupBy = args.groupBy ?? "none"
  const slots: Finding["slots"] = { jobs: jobs.length, totalCostUsd: Math.round(totalCost) }

  if (groupBy !== "none") {
    const keyOf = ({ m, w }: (typeof jobs)[number]) =>
      groupBy === "well" ? w.asset_id : groupBy === "year" ? m.started_at.slice(0, 4) : groupBy === "month" ? monthKey(m.started_at) : groupBy === "area" ? areaName(d, w) : m.equipment_kind
    const g = new Map<string, typeof jobs>()
    for (const j of jobs) g.set(keyOf(j), [...(g.get(keyOf(j)) ?? []), j])
    const label = groupBy === "well" ? "well" : groupBy
    const rows: Row[] = [...g.entries()]
      .sort((a, b) => {
        if (groupBy === "year" || groupBy === "month") return a[0].localeCompare(b[0])
        const cost = (v: typeof jobs) => v.reduce((x, j) => x + j.m.cost_usd.total, 0)
        return cost(b[1]) - cost(a[1]) || a[0].localeCompare(b[0])
      })
      .map(([k, v]) => ({
        [label]: k,
        ...(groupBy === "well" ? { area: areaName(d, v[0]!.w) } : {}),
        jobs: v.length,
        corrective: v.filter((x) => x.m.maintenance_type === "corrective").length,
        in_progress: v.filter((x) => d.isOpen(x.m)).length,
        total_cost_usd: Math.round(v.reduce((s, x) => s + x.m.cost_usd.total, 0)),
      }))
    if (groupBy === "well") for (const r of rows) slots[`cost_${r.well}`] = r.total_cost_usd as number
    return finish(ctx, d, {
      workerId: "maintenance",
      tool: "maintenance",
      shape: groupBy === "well" || groupBy === "area" || groupBy === "equipment" ? "ranking" : "series",
      title: `Repair cost by ${groupBy}: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
      window: win,
      columns: [
        { key: label, label, type: groupBy === "well" ? "well" : "text" },
        { key: "jobs", label: "Jobs", type: "number" },
        { key: "corrective", label: "Corrective", type: "number" },
        { key: "in_progress", label: "In progress", type: "number" },
        { key: "total_cost_usd", label: "Cost", type: "number", unit: "USD" },
      ],
      rows,
      rowEvidence: [...g.values()].map((v) => v.slice(0, 15).map((x) => maintenanceRef(d.id, x.m))),
      caveats,
      slots,
      followUps: ["List the individual repairs", "Which of these repairs are still open?"],
    })
  }
  jobs.sort((a, b) => a.m.started_at.localeCompare(b.m.started_at))
  const rows: Row[] = jobs.map(({ m, w }) => ({
    well: w.asset_id,
    maintenance: m.maintenance_id,
    started: dateOf(m.started_at),
    completed: m.completed_at ? dateOf(m.completed_at) : null,
    type: m.maintenance_type,
    equipment: m.equipment_kind,
    issue: m.issue,
    open: d.isOpen(m),
    cost_usd: m.cost_usd.total,
    triggered_by: m.triggered_by_inspection_id,
  }))
  return finish(
    ctx,
    d,
    {
      workerId: "maintenance",
      tool: "maintenance",
      shape: "list",
      title: `Repairs: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
      window: win,
      columns: [
        { key: "well", label: "Well", type: "well" },
        { key: "maintenance", label: "Job", type: "evidence" },
        { key: "started", label: "Started", type: "date" },
        { key: "equipment", label: "Equipment", type: "text" },
        { key: "issue", label: "Issue", type: "text" },
        { key: "open", label: "Open", type: "status" },
        { key: "cost_usd", label: "Cost", type: "number", unit: "USD" },
      ],
      rows,
      rowEvidence: jobs.map(({ m }) => [maintenanceRef(d.id, m), ...(m.report_file ? [reportRef(d.id, m)] : [])]),
      caveats,
      slots,
    },
    args.limit,
  )
}

export async function rcaCandidates(ctx: ToolCtx, args: RcaArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const wells = d.resolveWells(args.scope)
  const rows: Row[] = []
  const rowEvidence: EvidenceRef[][] = []
  const rules: Finding["rulesApplied"] = []
  const caveats: string[] = []
  const missing = new Set<string>()
  let overridden = false
  for (const w of wells) {
    const r = d.rcaCounts(w, args.equipmentKind)
    if (r.missing) {
      missing.add(w.well_type)
      continue
    }
    for (const row of r.rows) {
      if (!row.meets) continue
      const t = r.threshold
      if (t.overriddenBy) overridden = true
      rules.push(ruleApplied(t))
      rows.push({
        well: w.asset_id,
        area: areaName(d, w),
        well_type: w.well_type,
        equipment: row.kind,
        corrective_repairs: row.jobs.length,
        threshold: t.num ?? null,
        threshold_source: t.overriddenBy ? `${t.overrideAuthor}'s rule (manual: ${t.manualValue})` : "manual",
        window_from: r.from,
        repairs: row.jobs.map((m) => m.maintenance_id).join(", "),
      })
      rowEvidence.push([wellRef(d.id, w), ...row.jobs.map((m) => maintenanceRef(d.id, m)), t.source, ...(r.manual ? [r.manual.source] : [])])
    }
  }
  if (missing.size) caveats.push(`The RCA rule could not be found for well type(s) ${[...missing].join(", ")}; those wells were not evaluated.`)
  if (overridden) caveats.push("At least one threshold comes from a user-recorded rule for its scope, not from the manual; wells outside that scope still use the manual value.")
  const months = d.ruleNum("rca_window_months", wells[0]?.well_type ?? "")
  const win = months === undefined ? undefined : { from: addMonths(d.today, -months), to: d.today }
  ctx.onProgress?.(`read ${wells.length} wells · ${rows.length} root-cause candidates`, { wells: wells.length, candidates: rows.length })
  return finish(ctx, d, {
    workerId: "maintenance",
    tool: "rca_candidates",
    shape: "list",
    title: `Root-cause analysis candidates${args.equipmentKind ? ` (${args.equipmentKind})` : ""}: ${d.scopeLabel(args.scope)}`,
    window: win && { from: win.from, to: win.to, label: fmtRange(win.from, win.to), basis: "by_start_date" },
    columns: [
      { key: "well", label: "Well", type: "well" },
      { key: "well_type", label: "Type", type: "text" },
      { key: "equipment", label: "Equipment", type: "text" },
      { key: "corrective_repairs", label: "Corrective repairs", type: "number" },
      { key: "threshold", label: "Threshold", type: "number" },
      { key: "threshold_source", label: "Threshold from", type: "text" },
    ],
    rows,
    rowEvidence,
    rulesApplied: rules,
    caveats,
    slots: { candidates: rows.length, wellsEvaluated: wells.length },
    followUps: ["Show the repairs behind each candidate", "What does the manual say about root-cause analysis?"],
  })
}

const STATUS_ORDER: Record<string, number> = { breach: 0, overdue: 1, open: 2, unknown: 3, met: 4 }

export async function compliance(ctx: ToolCtx, args: ComplianceArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const wells = d.resolveWells(args.scope)
  const win = d.resolvePeriod(args.period ?? { kind: "last_n_months", n: 12 }, "by_date")
  if (args.events) {
    const evs = wells
      .flatMap((w) => (d.ds.regByWell.get(w.asset_id) ?? []).map((e) => ({ e, w })))
      .filter(({ e }) => d.inWindow(e.date, win) && (args.events === "all" || e.status === "open"))
      .filter(({ e }) => !args.protocols?.length || (e.protocol_id && args.protocols.map((x) => x.toUpperCase()).includes(e.protocol_id)))
      .sort((a, b) => a.e.date.localeCompare(b.e.date))
    ctx.onProgress?.(`read ${wells.length} wells · ${evs.length} regulator events`, { wells: wells.length, events: evs.length })
    return finish(ctx, d, {
      workerId: "compliance",
      tool: "compliance",
      shape: "list",
      title: `Regulator events: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
      window: win,
      columns: [
        { key: "well", label: "Well", type: "well" },
        { key: "event", label: "Event", type: "evidence" },
        { key: "date", label: "Date", type: "date" },
        { key: "event_type", label: "Type", type: "text" },
        { key: "protocol", label: "Protocol", type: "text" },
        { key: "fine_usd", label: "Fine", type: "number", unit: "USD" },
        { key: "status", label: "Status", type: "status" },
        { key: "detail", label: "Detail", type: "text" },
      ],
      rows: evs.map(({ e, w }) => ({ well: w.asset_id, event: e.event_id, date: e.date, event_type: e.event_type, protocol: e.protocol_id, fine_usd: e.fine_usd, status: e.status, detail: e.detail, hours_to_report: e.hours_to_report })),
      rowEvidence: evs.map(({ e }) => [regRef(d.id, e)]),
      caveats: [],
      slots: { events: evs.length, openFinesUsd: evs.filter(({ e }) => e.status === "open").reduce((a, { e }) => a + (e.fine_usd ?? 0), 0) },
    }, args.limit)
  }
  let checks: ComplianceCheck[] = wells.flatMap((w) => d.complianceFor(w, win))
  ctx.onProgress?.(`read ${wells.length} wells · ${checks.length} protocol checks`, { wells: wells.length, checks: checks.length })
  if (args.protocols?.length) {
    const p = new Set(args.protocols.map((x) => x.toUpperCase()))
    checks = checks.filter((c) => p.has(c.protocol))
  }
  const counts = (s: string) => checks.filter((c) => c.status === s).length
  const all = checks
  if (!args.includeMet) checks = checks.filter((c) => c.status !== "met")
  checks.sort((a, b) => a.well.asset_id.localeCompare(b.well.asset_id) || (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.protocol.localeCompare(b.protocol))
  const rows: Row[] = checks.map((c) => ({
    well: c.well.asset_id,
    protocol: c.protocol,
    status: c.status,
    requirement: c.requirement,
    due: c.due ?? null,
    actual: c.actual ?? null,
    inspection: c.subject ?? null,
    detail: c.detail,
  }))
  const rules: Finding["rulesApplied"] = []
  for (const w of wells.slice(0, 5))
    for (const k of ["sr01_hours", "sr02_hours", "sr03_days", "rc04_days", "rc01_days"]) {
      const r = d.rule(k, w.well_type, w.asset_id)
      if (r) rules.push(ruleApplied(r))
    }
  const caveats = ["Breaches are checked against the SOP rules in force; 'overdue' means the deadline passed with no record that the duty was met."]
  const stale = d.spills(wells, win).filter((s) => s.reportedClass && s.cls !== "unknown" && s.reportedClass.value !== s.cls && s.eff.corrections.length)
  for (const s of stale) caveats.push(`Report ${s.repairs[0]?.maintenance_id} classed the ${s.eff.date} spill at ${s.well.asset_id} as "${s.reportedClass!.value}" from the earlier estimate; the corrected volume makes it "${s.cls}".`)
  const open = wells.flatMap((w) => d.validNotes(w.asset_id).map((n) => ({ w, n })))
  const rca = wells.flatMap((w) => d.rcaCounts(w).rows.filter((r) => r.meets).map((r) => `${w.asset_id} ${r.kind} (${r.jobs.length} corrective repairs: ${r.jobs.map((m) => m.maintenance_id).join(", ")})`))
  const contextNotes = open.map(({ w, n }) => `${w.asset_id} ${n.note_id}: ${n.text}`)
  if (rca.length) caveats.push(`Root-cause analysis pending (manual escalation rule): ${rca.join("; ")}.`)
  if (contextNotes.length) caveats.push(`Notes in effect: ${contextNotes.join(" | ")}`)
  return finish(ctx, d, {
    workerId: "compliance",
    tool: "compliance",
    shape: "list",
    title: `Protocol checks: ${d.scopeLabel(args.scope)}${win ? ` (${win.label})` : ""}`,
    window: win,
    columns: [
      { key: "well", label: "Well", type: "well" },
      { key: "protocol", label: "Protocol", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "requirement", label: "Requirement", type: "text" },
      { key: "due", label: "Due", type: "text" },
      { key: "actual", label: "Actual", type: "text" },
      { key: "detail", label: "Detail", type: "text" },
    ],
    rows,
    rowEvidence: checks.map((c) => c.evidence),
    rulesApplied: rules,
    caveats,
    slots: {
      breaches: counts("breach") + counts("overdue"),
      breach: counts("breach"),
      overdue: counts("overdue"),
      open: counts("open"),
      met: all.filter((c) => c.status === "met").length,
      fineOpenUsd: wells.reduce((s, w) => s + (d.ds.regByWell.get(w.asset_id) ?? []).filter((e) => e.status === "open" && d.inWindow(e.date, win)).reduce((x, e) => x + (e.fine_usd ?? 0), 0), 0),
    },
  }, args.limit)
}

export async function searchDocuments(ctx: ToolCtx, args: SearchDocsArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const db = await dbOf(ctx)
  const kinds = args.kinds?.length ? args.kinds : ["manual", "sop", "report"]
  const kindList = sql.join(kinds.map((k) => sql`${k}`), sql`, `)
  const res = await db.rows<{ doc_id: string; kind: string; section: string; heading: string; snippet: string; rank: number; maintenance_id: string | null }>(sql`
    select s.doc_id, d.kind, s.section, s.heading,
      ts_headline('english', s.text, websearch_to_tsquery('english', ${args.query}), 'MaxFragments=1, MaxWords=40, MinWords=15') as snippet,
      ts_rank(s.tsv, websearch_to_tsquery('english', ${args.query})) as rank,
      d.maintenance_id
    from document_sections s join documents d on d.dataset_id = s.dataset_id and d.doc_id = s.doc_id
    where s.dataset_id = ${ctx.datasetId} and d.kind in (${kindList}) and s.tsv @@ websearch_to_tsquery('english', ${args.query})
    order by rank desc, s.doc_id limit ${args.limit ?? 8}`)
  ctx.onProgress?.(`searched documents · ${res.length} matching sections`, { matches: res.length })
  const rows: Row[] = res.map((r) => ({ document: r.doc_id, kind: r.kind, section: r.section, heading: r.heading, snippet: r.snippet.replace(/<\/?b>/g, "") }))
  return finish(ctx, d, {
    workerId: "compliance",
    tool: "search_documents",
    shape: "list",
    title: `Documents matching "${args.query}"`,
    columns: [
      { key: "document", label: "Document", type: "evidence" },
      { key: "section", label: "Section", type: "text" },
      { key: "snippet", label: "Excerpt", type: "text" },
    ],
    rows,
    rowEvidence: res.map((r) => [
      {
        kind: r.kind === "report" ? ("report" as const) : r.kind === "manual" ? ("manual" as const) : ("sop" as const),
        id: r.kind === "report" ? r.doc_id : `${r.doc_id}#${r.section}`,
        label: `${r.doc_id} §${r.section}`,
        datasetId: d.id,
        section: r.section,
        quote: r.snippet.replace(/<\/?b>/g, ""),
      },
    ]),
    caveats: res.length ? [] : ["No document section matched. Try different words."],
    slots: { matches: rows.length },
  })
}

export async function getRule(ctx: ToolCtx, args: GetRuleArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const well = args.wellId ? d.getWell(args.wellId) : undefined
  const types = args.wellType ? [args.wellType] : well ? [well.well_type] : [...new Set(d.ds.wellList.map((w) => w.well_type))]
  const keys = args.key ? [args.key] : [...new Set(d.ds.rows.rules.map((r) => r.key))]
  const rows: Row[] = []
  const rules: Finding["rulesApplied"] = []
  const rowEvidence: EvidenceRef[][] = []
  const missing: string[] = []
  for (const k of keys) {
    const perType = d.ds.rows.rules.some((r) => r.key === k && r.wellType !== "")
    for (const t of perType ? types : [""]) {
      const r = d.rule(k, t, well?.asset_id)
      const label = d.ds.rows.rules.find((x) => x.key === k)?.label ?? k
      if (!r) {
        missing.push(`${k}${t ? ` (${t})` : ""}`)
        rows.push({ key: k, well_type: t || "all", value: null, unit: null, source: "not found in the documents", method: "missing", label })
        continue
      }
      rules.push(ruleApplied(r))
      rowEvidence.push([r.source])
      rows.push({ key: k, well_type: t || "all", value: r.value, unit: r.unit ?? null, source: r.source.label, method: r.overriddenBy ? "user rule" : (d.ds.rules.get(`${k}|${t}`)?.method ?? "regex"), label, quote: r.source.quote ?? null })
    }
  }
  return finish(ctx, d, {
    workerId: "compliance",
    tool: "get_rule",
    shape: rows.length === 1 ? "single_entity" : "list",
    title: args.key ? `Rule ${args.key}` : "Rules in force",
    columns: [
      { key: "key", label: "Rule", type: "text" },
      { key: "well_type", label: "Well type", type: "text" },
      { key: "value", label: "Value", type: "text" },
      { key: "unit", label: "Unit", type: "text" },
      { key: "source", label: "Source", type: "evidence" },
    ],
    rows,
    rowEvidence,
    rulesApplied: rules,
    caveats: missing.length ? [`Rule not found in the manuals or SOPs: ${missing.join(", ")}. It was not guessed.`] : [],
    slots: { rules: rows.length, missing: missing.length },
  }, 200)
}

export async function wellContext(ctx: ToolCtx, args: WellContextArgs): Promise<Finding> {
  const d = await loadDomain(ctx)
  const w = d.getWell(args.wellId)
  const latest = d.latest(w.asset_id)
  const rows: Row[] = []
  const rowEvidence: EvidenceRef[][] = []
  const add = (kind: string, status: string, text: string, author: string | null, from: string | null, to: string | null, ev: EvidenceRef) => {
    rows.push({ kind, status, text, author, valid_from: from, valid_to: to, source: ev.label })
    rowEvidence.push([ev])
  }
  for (const n of d.validNotes(w.asset_id)) add("note", "in effect", n.text, d.userName(n.author_user_id), n.valid_from, n.valid_to, noteRef(d.id, n))
  for (const n of d.upcomingNotes(w.asset_id)) add("note", "upcoming", n.text, d.userName(n.author_user_id), n.valid_from, n.valid_to, noteRef(d.id, n))
  for (const f of d.validSharedNotes(w.asset_id)) add("shared note", "in effect", f.text, d.userName(f.authorUserId), f.validFrom ?? null, f.validTo ?? null, feedbackRef(d.id, f))
  for (const f of d.upcomingSharedNotes(w.asset_id)) add("shared note", "upcoming", f.text, d.userName(f.authorUserId), f.validFrom ?? null, f.validTo ?? null, feedbackRef(d.id, f))
  for (const f of d.claims(w.asset_id)) add("status claim", f.status, f.text, d.userName(f.authorUserId), null, null, feedbackRef(d.id, f))
  const expired = (d.ds.notesByWell.get(w.asset_id) ?? []).filter((n) => n.note_type !== "correction" && n.valid_to && n.valid_to.slice(0, 10) < d.today).slice(-3)
  for (const n of expired) add("note", "expired", n.text, d.userName(n.author_user_id), n.valid_from, n.valid_to, noteRef(d.id, n))
  for (const m of d.openRepairs(w.asset_id)) add("open repair", "open", `${m.issue} (${m.equipment_kind}), started ${fmtDate(m.started_at)}, planned end ${m.completed_at ? fmtDate(m.completed_at) : "unknown"}`, null, dateOf(m.started_at), m.completed_at ? dateOf(m.completed_at) : null, maintenanceRef(d.id, m))
  for (const f of d.feedback.filter((x) => (x.targetType === "inspection" && d.ds.inspById.get(x.targetId)?.asset_id === w.asset_id) || x.scopeValue === w.asset_id))
    if (f.kind === "data_correction" || f.kind === "analysis_correction") add("correction", f.status, `${f.field}: ${f.originalValue} → ${f.newValue}. ${f.reason ?? f.text}`, d.userName(f.authorUserId), null, null, feedbackRef(d.id, f))
  const conflicts = latest ? correctionConflict(d, latest, w) : []
  ctx.onProgress?.(`read context for ${w.asset_id} · ${rows.length} items`, { items: rows.length })
  return finish(ctx, d, {
    workerId: "memory",
    tool: "well_context",
    shape: "list",
    title: `Context for ${w.asset_id}`,
    columns: [
      { key: "kind", label: "Kind", type: "text" },
      { key: "status", label: "Status", type: "status" },
      { key: "text", label: "Text", type: "text" },
      { key: "author", label: "Author", type: "text" },
      { key: "valid_from", label: "From", type: "date" },
      { key: "valid_to", label: "To", type: "date" },
    ],
    rows: [{ kind: "well", status: describeStatus(latest ? d.producing(latest, w) : null), text: `${w.name}, ${w.well_type}, ${areaName(d, w)}; recorded status ${w.recorded_status}`, author: null, valid_from: null, valid_to: null, source: w.asset_id }, ...rows],
    rowEvidence: [[wellRef(d.id, w)], ...rowEvidence],
    conflicts,
    caveats: rows.length ? [] : ["No notes, shared notes, claims or open repairs are on record for this well."],
    slots: { items: rows.length, upcoming: rows.filter((r) => r.status === "upcoming").length },
    followUps: [`Is ${w.asset_id} producing right now?`],
  })
}
