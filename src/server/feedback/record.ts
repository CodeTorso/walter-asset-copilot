import { eq } from "drizzle-orm"
import type { Conflict, EvidenceRef, Feedback, Finding, Row } from "../../contracts"
import { feedback as feedbackTable } from "../db/schema"
import { Domain, ToolError } from "../engine/domain"
import { feedbackRef, inspectionRef, noteRef, reportRef, wellRef } from "../engine/evidence"
import { dbOf, loadDomain, makeFinding, ruleApplied, type ToolCtx } from "../tools/ctx"
import type { RecordFeedbackArgs } from "../tools/schemas"

export type FeedbackResult = Finding & { feedback: Feedback }

const DATA_FIELDS = ["wellhead_temp_c", "ambient_temp_c"]
const ANALYSIS_FIELDS = ["spill_est_volume_bbl", "spill_area_pct", "spill_detected"]
const SHUTDOWN_WORDS = /shut|down|offline|stopp|maintenance|workover|back online|expected back|rod string|repair/i

const rid = () => Math.random().toString(36).slice(2, 8)

function rawValue(d: Domain, inspectionId: string, field: string): number | boolean | null {
  const i = d.ds.inspById.get(inspectionId)!
  const m: Record<string, number | boolean | null> = {
    wellhead_temp_c: i.wellhead_temp_c,
    ambient_temp_c: i.ambient_temp_c,
    spill_est_volume_bbl: i.spill_est_volume_bbl,
    spill_area_pct: i.spill_area_pct,
    spill_detected: i.spill_detected,
  }
  return m[field] ?? null
}

function toValue(field: string, v: string | number | boolean | undefined): number | boolean {
  if (v === undefined) throw new ToolError("newValue is required for a correction")
  if (field === "spill_detected") {
    if (typeof v === "boolean") return v
    if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true"
    throw new ToolError("spill_detected must be true or false")
  }
  const text = String(v).trim()
  if (typeof v === "boolean" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    throw new ToolError(`newValue "${v}" is not a number; pass the value without units`)
  const n = Number(text)
  if (!Number.isFinite(n)) throw new ToolError(`newValue "${v}" is not a number`)
  if ((field === "spill_est_volume_bbl" || field === "spill_area_pct") && n < 0)
    throw new ToolError(`${field} cannot be negative`)
  if (field === "spill_area_pct" && n > 100) throw new ToolError("spill_area_pct cannot exceed 100")
  return n
}

const describe = (p: boolean | null) => (p === null ? "unknown" : p ? "producing" : "not producing")

export async function recordFeedback(ctx: ToolCtx, args: RecordFeedbackArgs): Promise<FeedbackResult> {
  if (!ctx.userId) throw new ToolError("record_feedback needs the signed-in user (author)")
  const db = await dbOf(ctx)
  const d = await loadDomain(ctx)
  const author = d.ds.users.get(ctx.userId)
  if (!author) throw new ToolError(`Unknown user ${ctx.userId}`)
  const authorName = author.name
  const now = new Date().toISOString()
  const id = `FB-${now.slice(0, 10).replace(/-/g, "")}-${rid()}`
  const conflicts: Conflict[] = []
  const caveats: string[] = []
  const evidence: EvidenceRef[] = []
  const rows: Row[] = []
  const slots: Finding["slots"] = {}
  const rulesApplied: Finding["rulesApplied"] = []
  const followUps: string[] = []
  let status: Feedback["status"] = "applied"
  let supersedes: Feedback | undefined
  let fb: Feedback

  const active = d.feedback.filter((f) => f.status === "applied" || f.status === "unconfirmed")

  switch (args.kind) {
    case "data_correction":
    case "analysis_correction": {
      const insp = d.ds.inspById.get(args.targetId)
      if (!insp) throw new ToolError(`Unknown inspection "${args.targetId}"`, "Corrections must name an inspection ID such as INS-0164-0205")
      const field = args.field ?? (args.kind === "data_correction" ? "wellhead_temp_c" : "spill_est_volume_bbl")
      if (![...DATA_FIELDS, ...ANALYSIS_FIELDS].includes(field)) throw new ToolError(`Unsupported field "${field}"`, `Supported: ${[...DATA_FIELDS, ...ANALYSIS_FIELDS].join(", ")}`)
      const value = toValue(field, args.newValue)
      const well = d.getWell(insp.asset_id)
      const original = rawValue(d, insp.inspection_id, field)
      const prior = active.find((f) => f.targetType === "inspection" && f.targetId === insp.inspection_id && f.field === field && f.status === "applied")
      if (prior) {
        if (prior.authorUserId === ctx.userId) supersedes = prior
        else {
          status = "disputed"
          conflicts.push({
            subject: inspectionRef(d.id, insp),
            sides: [
              { claim: `${field} corrected to ${prior.newValue}${prior.reason ? ` (${prior.reason})` : ""}`, author: d.userName(prior.authorUserId), source: feedbackRef(d.id, prior), status: "applied" },
              { claim: `${field} should be ${value}${args.reason ? ` (${args.reason})` : ""}`, author: authorName, source: inspectionRef(d.id, insp), status: "disputed" },
            ],
            needsConfirmationFrom: prior.authorUserId,
          })
          caveats.push(`${d.userName(prior.authorUserId)} already corrected this value to ${prior.newValue}. The new value is stored as disputed and not applied until it is confirmed.`)
        }
      }
      fb = {
        id,
        datasetId: d.id,
        kind: args.kind,
        targetType: "inspection",
        targetId: insp.inspection_id,
        field,
        originalValue: original,
        newValue: value,
        scopeType: "well",
        scopeValue: well.asset_id,
        authorUserId: ctx.userId,
        reason: args.reason,
        text: args.text,
        status,
        conflicts: [],
        createdAt: now,
        supersedesId: supersedes?.id,
      }
      // A disputed proposal must not be presented as a change to the effective data.
      const hypo = status === "disputed" ? d : new Domain(d.ds, [...d.feedback.filter((f) => f.id !== supersedes?.id), fb])
      const before = d.eff(insp)
      const after = hypo.eff(insp)
      evidence.push(inspectionRef(d.id, insp, fb.id), feedbackRef(d.id, fb), wellRef(d.id, well))
      rows.push({ field, original: String(original), previous_effective: String(field === "wellhead_temp_c" ? before.wellhead : field === "ambient_temp_c" ? before.ambient : (before.volume ?? "")), corrected: String(value), inspection: insp.inspection_id, well: well.asset_id, author: authorName, reason: args.reason ?? null, status })
      slots.inspection = insp.inspection_id
      slots.well = well.asset_id
      slots.field = field
      slots.originalValue = String(original)
      slots.newValue = String(value)
      slots.author = authorName

      if (DATA_FIELDS.includes(field)) {
        const pBefore = d.producing(before, well)
        const pAfter = hypo.producing(after, well)
        const th = hypo.threshold(well)
        if (th) rulesApplied.push(ruleApplied(th))
        slots.deltaBefore = before.delta
        slots.deltaAfter = after.delta
        slots.thresholdC = th?.num ?? "unknown"
        slots.statusBefore = describe(pBefore)
        slots.statusAfter = describe(pAfter)
        if (insp.notes?.trim())
          conflicts.push({
            subject: inspectionRef(d.id, insp, fb.id),
            sides: [
              { claim: `${field} corrected from ${original} to ${value}${args.reason ? ` (${args.reason})` : ""}`, author: authorName, source: feedbackRef(d.id, fb), status: status === "disputed" ? "disputed" : "applied" },
              { claim: insp.notes.trim(), author: d.userName(insp.inspector_user_id), source: inspectionRef(d.id, insp), status: "data" },
            ],
            needsConfirmationFrom: ctx.userId,
          })
        if (pBefore !== pAfter) caveats.push(`This changes ${well.asset_id} from ${describe(pBefore)} to ${describe(pAfter)} for every user.`)
        followUps.push(`Is ${well.asset_id} producing right now?`)
      } else {
        const beforeVol = before.volume
        const afterVol = after.volume
        const clsBefore = d.spillClass(beforeVol)
        const clsAfter = hypo.spillClass(afterVol)
        slots.classBefore = clsBefore
        slots.classAfter = clsAfter
        const spill = hypo.spills([well]).find((s) => s.eff.insp.inspection_id === insp.inspection_id)
        if (spill) {
          const checks = hypo.checkSpill(spill)
          for (const c of checks)
            rows.push({ protocol: c.protocol, status: c.status, requirement: c.requirement, due: c.due ?? null, actual: c.actual ?? null, detail: c.detail, well: well.asset_id })
          for (const c of checks) {
            evidence.push(...c.evidence)
            slots[`${c.protocol}_status`] = c.status
            if (c.due) slots[`${c.protocol}_due`] = c.due
          }
          const rep = spill.reportedClass
          if (rep && rep.value !== clsAfter) {
            const m = spill.repairs.find((x) => hypo.ds.factsByMnt.get(x.maintenance_id)?.includes(rep))
            caveats.push(`Repair report ${m?.maintenance_id} classed this spill "${rep.value}" from the earlier estimate (${beforeVol} bbl); at ${afterVol} bbl it is "${clsAfter}", so that report sentence is stale.`)
            if (m) evidence.push(reportRef(d.id, m, rep))
          }
          if (clsBefore !== clsAfter) caveats.push(`Class changes from ${clsBefore} to ${clsAfter}; deadlines are recomputed from the SOP.`)
          const sr01 = checks.find((c) => c.protocol === "SR-01")
          if (sr01 && sr01.status === "overdue") caveats.push(`No written notice is on record for ${insp.inspection_id}; possible SR-01 breach (deadline ${sr01.due}).`)
          const notes = hypo.notesForInspection(insp).filter((n) => n.note_type !== "correction")
          if (notes.length)
            conflicts.push({
              subject: inspectionRef(d.id, insp, fb.id),
              sides: [
                { claim: `${field} corrected from ${original} to ${value}`, author: authorName, source: feedbackRef(d.id, fb), status: status === "disputed" ? "disputed" : "applied" },
                ...notes.map((n) => ({ claim: n.text, author: d.userName(n.author_user_id), source: noteRef(d.id, n), status: "data" as const })),
              ],
              needsConfirmationFrom: ctx.userId,
            })
        }
        followUps.push("Which spills needed a report to the regulator in the last 90 days?")
      }
      break
    }

    case "scoped_rule": {
      const known = new Set(d.ds.rows.rules.map((r) => r.key))
      if (!known.has(args.targetId)) throw new ToolError(`Unknown rule "${args.targetId}"`, `Known rules: ${[...known].join(", ")}`)
      const sc = args.scope ?? { type: "fleet" as const }
      let scopeValue = sc.value
      if (sc.type === "well_type") {
        const t = d.ds.wellList.find((w) => w.well_type.toLowerCase() === sc.value?.toLowerCase())?.well_type
        if (!t) throw new ToolError(`Unknown well type "${sc.value}"`)
        scopeValue = t
      }
      if (sc.type === "well") scopeValue = d.getWell(sc.value ?? "").asset_id
      const value = toValue("rule", args.newValue)
      const typeForManual = sc.type === "well_type" ? scopeValue! : sc.type === "well" ? d.getWell(scopeValue!).well_type : ""
      const manual = d.registryRule(args.targetId, typeForManual)
      const prior = active.find((f) => f.kind === "scoped_rule" && f.targetId === args.targetId && f.scopeType === sc.type && f.scopeValue === scopeValue && f.status === "applied")
      if (prior) {
        if (prior.authorUserId === ctx.userId) supersedes = prior
        else {
          status = "disputed"
          conflicts.push({
            subject: feedbackRef(d.id, prior),
            sides: [
              { claim: prior.text, author: d.userName(prior.authorUserId), source: feedbackRef(d.id, prior), status: "applied" },
              { claim: args.text, author: authorName, source: { kind: "feedback", id, label: "New rule proposal", datasetId: d.id, quote: args.text }, status: "disputed" },
            ],
            needsConfirmationFrom: prior.authorUserId,
          })
          caveats.push(`${d.userName(prior.authorUserId)} already set this rule for the same scope. The new value is stored as disputed and not applied.`)
        }
      }
      fb = {
        id,
        datasetId: d.id,
        kind: "scoped_rule",
        targetType: "rule",
        targetId: args.targetId,
        field: "value",
        originalValue: manual?.value ?? null,
        newValue: value as number,
        scopeType: sc.type,
        scopeValue,
        authorUserId: ctx.userId,
        reason: args.reason,
        text: args.text,
        status,
        conflicts: [],
        createdAt: now,
        supersedesId: supersedes?.id,
      }
      const affected = d.ds.wellList.filter((w) => sc.type === "fleet" || (sc.type === "well_type" ? w.well_type === scopeValue : w.asset_id === scopeValue)).length
      rows.push({ rule: args.targetId, scope: `${sc.type}${scopeValue ? `: ${scopeValue}` : ""}`, manual_value: manual?.value ?? null, new_value: value, author: authorName, wells_affected: affected, status })
      slots.rule = args.targetId
      slots.newValue = String(value)
      slots.manualValue = manual?.value ?? "not found"
      slots.scope = `${sc.type}${scopeValue ? `: ${scopeValue}` : ""}`
      slots.wellsAffected = affected
      if (manual) rulesApplied.push(ruleApplied(manual))
      evidence.push(feedbackRef(d.id, fb), ...(manual ? [manual.source] : []))
      caveats.push(`Applies only to ${slots.scope}; wells outside that scope keep the manual value.`)
      followUps.push("Run the earlier question again")
      break
    }

    case "shared_note": {
      const well = d.getWell(args.targetId)
      fb = {
        id,
        datasetId: d.id,
        kind: "shared_note",
        targetType: "well",
        targetId: well.asset_id,
        scopeType: "well",
        scopeValue: well.asset_id,
        authorUserId: ctx.userId,
        reason: args.reason,
        text: args.text,
        validFrom: (args.validFrom ?? d.today).slice(0, 10),
        validTo: args.validTo?.slice(0, 10),
        status,
        conflicts: [],
        createdAt: now,
      }
      const latest = d.latest(well.asset_id)
      evidence.push(feedbackRef(d.id, fb), wellRef(d.id, well))
      rows.push({ well: well.asset_id, note: args.text, author: authorName, valid_from: fb.validFrom ?? null, valid_to: fb.validTo ?? null, status })
      slots.well = well.asset_id
      slots.author = authorName
      slots.validFrom = fb.validFrom ?? ""
      if (fb.validTo) slots.validTo = fb.validTo
      if (latest) caveats.push(`Latest inspection (${latest.date}) shows ${well.asset_id} as ${describe(d.producing(latest, well))}.`)
      if (fb.validFrom! > d.today) caveats.push(`The note starts ${fb.validFrom}, after the dataset date ${d.today}; it is shown as upcoming until then.`)
      for (const other of d.validSharedNotes(well.asset_id).concat(d.upcomingSharedNotes(well.asset_id))) {
        if (other.authorUserId !== ctx.userId)
          conflicts.push({
            subject: wellRef(d.id, well),
            sides: [
              { claim: other.text, author: d.userName(other.authorUserId), source: feedbackRef(d.id, other), status: "applied" },
              { claim: args.text, author: authorName, source: feedbackRef(d.id, fb), status: "applied" },
            ],
          })
      }
      followUps.push(`Is any downtime planned for ${well.asset_id}?`)
      break
    }

    case "status_claim": {
      const well = d.getWell(args.targetId)
      if (args.claimedProducing === undefined) throw new ToolError("status_claim needs claimedProducing (true if the user says the well is producing)")
      const latest = d.latest(well.asset_id)
      const p = latest ? d.producing(latest, well) : null
      const agrees = p !== null && p === args.claimedProducing
      status = agrees ? "applied" : "unconfirmed"
      fb = {
        id,
        datasetId: d.id,
        kind: "status_claim",
        targetType: "well",
        targetId: well.asset_id,
        field: "producing",
        originalValue: describe(p),
        newValue: args.claimedProducing,
        scopeType: "well",
        scopeValue: well.asset_id,
        authorUserId: ctx.userId,
        reason: args.reason,
        text: args.text,
        validFrom: args.validFrom?.slice(0, 10),
        validTo: args.validTo?.slice(0, 10),
        status,
        conflicts: [],
        createdAt: now,
      }
      evidence.push(feedbackRef(d.id, fb), wellRef(d.id, well))
      const dataSide = latest && {
        claim: `Latest inspection ${latest.date}: wellhead ${latest.delta} °C above air (limit ${d.threshold(well)?.num ?? "unknown"} °C): ${describe(p)}`,
        author: d.userName(latest.insp.inspector_user_id),
        source: inspectionRef(d.id, latest.insp),
        status: "data" as const,
      }
      if (latest) {
        evidence.push(inspectionRef(d.id, latest.insp))
        const th = d.threshold(well)
        if (th) rulesApplied.push(ruleApplied(th))
      }
      const priorClaims = d.claims(well.asset_id).filter((c) => c.authorUserId !== ctx.userId)
      const opposed = priorClaims.filter((c) => c.newValue !== args.claimedProducing)
      const agreeing = priorClaims.filter((c) => c.newValue === args.claimedProducing)
      const notes = d.validNotes(well.asset_id).filter((n) => SHUTDOWN_WORDS.test(n.text))
      if (!agrees && dataSide) {
        conflicts.push({
          subject: wellRef(d.id, well),
          sides: [
            { claim: args.text, author: authorName, source: feedbackRef(d.id, fb), status: "unconfirmed" },
            dataSide,
            ...priorClaims.map((c) => ({ claim: c.text, author: d.userName(c.authorUserId), source: feedbackRef(d.id, c), status: c.status === "applied" ? ("applied" as const) : ("unconfirmed" as const) })),
            ...notes.map((n) => ({ claim: n.text, author: d.userName(n.author_user_id), source: noteRef(d.id, n), status: "data" as const })),
          ],
          needsConfirmationFrom: ctx.userId,
        })
        for (const n of notes) {
          evidence.push(noteRef(d.id, n))
          if (n.author_user_id === ctx.userId) caveats.push(`This also contradicts ${authorName}'s own earlier note ${n.note_id}.`)
        }
        caveats.push("Stored as unconfirmed; please confirm or correct it.")
      } else if (agrees) {
        caveats.push(`This agrees with the latest inspection${agreeing.length ? ` and with ${agreeing.map((c) => d.userName(c.authorUserId)).join(", ")}'s earlier statement` : ""}.`)
        for (const c of opposed)
          conflicts.push({
            subject: wellRef(d.id, well),
            sides: [
              { claim: args.text, author: authorName, source: feedbackRef(d.id, fb), status: "applied" },
              { claim: c.text, author: d.userName(c.authorUserId), source: feedbackRef(d.id, c), status: "unconfirmed" },
            ],
          })
      }
      rows.push({ well: well.asset_id, claim: args.text, claimed: args.claimedProducing ? "producing" : "not producing", data: describe(p), author: authorName, status })
      slots.well = well.asset_id
      slots.claimed = args.claimedProducing ? "producing" : "not producing"
      slots.dataStatus = describe(p)
      slots.status = status
      if (latest) {
        slots.deltaC = latest.delta
        slots.inspectedBy = d.userName(latest.insp.inspector_user_id)
        slots.inspectedOn = latest.date
      }
      followUps.push(`What is the latest status of ${well.asset_id}?`)
      break
    }
  }

  fb.conflicts = conflicts
  if (supersedes) await db.drizzle.update(feedbackTable).set({ status: "superseded" }).where(eq(feedbackTable.id, supersedes.id))
  await db.drizzle.insert(feedbackTable).values({
    id: fb.id,
    datasetId: fb.datasetId,
    kind: fb.kind,
    targetType: fb.targetType,
    targetId: fb.targetId,
    field: fb.field ?? null,
    originalValue: (fb.originalValue ?? null) as never,
    newValue: (fb.newValue ?? null) as never,
    scopeType: fb.scopeType,
    scopeValue: fb.scopeValue ?? null,
    authorUserId: fb.authorUserId,
    reason: fb.reason ?? null,
    text: fb.text,
    validFrom: fb.validFrom ?? null,
    validTo: fb.validTo ?? null,
    status: fb.status,
    conflicts: fb.conflicts as never,
    createdAt: fb.createdAt,
    supersedesId: fb.supersedesId ?? null,
  })
  ctx.onProgress?.(`recorded ${fb.kind.replace(/_/g, " ")} ${fb.id} (${fb.status})`, { conflicts: conflicts.length })

  slots.feedbackId = fb.id
  slots.status = slots.status ?? fb.status
  const finding = makeFinding(d, {
    workerId: "memory",
    tool: "record_feedback",
    shape: "single_entity",
    title: `${fb.kind.replace(/_/g, " ")} recorded by ${authorName}`,
    columns: Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k.replace(/_/g, " "), type: "text" as const })),
    rows,
    evidence,
    rulesApplied,
    conflicts,
    caveats,
    slots,
    followUps,
  })
  return Object.assign(finding, { feedback: fb })
}
