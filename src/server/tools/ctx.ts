import { eq } from "drizzle-orm"
import type { EvidenceRef, Feedback, Finding, Row, Column } from "../../contracts"
import { getDb, type Db } from "../db/client"
import { feedback as feedbackTable } from "../db/schema"
import { Domain } from "../engine/domain"
import { dedupeEvidence } from "../engine/evidence"
import { getSnapshot } from "../engine/snapshot"

export type ProgressFn = (text: string, counts?: Record<string, number>) => void

export type ToolCtx = {
  datasetId: string
  userId?: string
  /** The user's single thread id (see getOrCreateUserThread) */
  threadId?: string
  messageId?: string
  /** Server clock at the start of this turn; entities written after it are excluded from recall */
  turnStartedAt?: string
  db?: Db
  onProgress?: ProgressFn
  /** Set false to skip writing memory entities for this call */
  remember?: boolean
}

export async function dbOf(ctx: ToolCtx): Promise<Db> {
  return ctx.db ?? (await getDb())
}

export function rowToFeedback(r: typeof feedbackTable.$inferSelect): Feedback {
  return {
    id: r.id,
    datasetId: r.datasetId,
    kind: r.kind as Feedback["kind"],
    targetType: r.targetType as Feedback["targetType"],
    targetId: r.targetId,
    field: r.field ?? undefined,
    originalValue: (r.originalValue ?? undefined) as Feedback["originalValue"],
    newValue: (r.newValue ?? undefined) as Feedback["newValue"],
    scopeType: r.scopeType as Feedback["scopeType"],
    scopeValue: r.scopeValue ?? undefined,
    authorUserId: r.authorUserId,
    reason: r.reason ?? undefined,
    text: r.text,
    validFrom: r.validFrom ?? undefined,
    validTo: r.validTo ?? undefined,
    status: r.status as Feedback["status"],
    conflicts: (r.conflicts ?? []) as Feedback["conflicts"],
    createdAt: r.createdAt,
    supersedesId: r.supersedesId ?? undefined,
  }
}

export async function readFeedback(db: Db, datasetId: string): Promise<Feedback[]> {
  const rows = await db.drizzle.select().from(feedbackTable).where(eq(feedbackTable.datasetId, datasetId))
  return rows.map(rowToFeedback)
}

/** Snapshot (cached by dataset version) plus overlays (read on every call). */
export async function loadDomain(ctx: ToolCtx): Promise<Domain> {
  const db = await dbOf(ctx)
  const [snap, fb] = await Promise.all([getSnapshot(db, ctx.datasetId), readFeedback(db, ctx.datasetId)])
  return new Domain(snap, fb)
}

const FULL = new Map<string, { columns: Column[]; rows: Row[]; rowEvidence: EvidenceRef[][] }>()
let counter = 0

export function getFullFinding(handle: string) {
  return FULL.get(handle)
}

export const DEFAULT_CAP = 50

export type FindingInput = Omit<
  Finding,
  "id" | "datasetId" | "asOf" | "handle" | "totalRows" | "rows" | "evidence" | "rulesApplied" | "conflicts" | "caveats" | "slots"
> & {
  rows: Row[]
  rowEvidence?: EvidenceRef[][]
  evidence?: EvidenceRef[]
  rulesApplied?: Finding["rulesApplied"]
  conflicts?: Finding["conflicts"]
  caveats?: string[]
  slots?: Finding["slots"]
}

export function makeFinding(d: Domain, input: FindingInput, cap = DEFAULT_CAP): Finding {
  const id = `fnd_${Date.now().toString(36)}_${(counter++).toString(36)}`
  const rowEvidence = input.rowEvidence ?? []
  const total = input.rows.length
  FULL.set(id, { columns: input.columns, rows: input.rows, rowEvidence })
  if (FULL.size > 300) FULL.delete(FULL.keys().next().value as string)
  const rows = input.rows.slice(0, cap)
  const caveats = [...(input.caveats ?? [])]
  if (total > rows.length) caveats.push(`Showing ${rows.length} of ${total} rows; the rest are available through the finding handle.`)
  const rulesApplied: Finding["rulesApplied"] = []
  const seen = new Set<string>()
  for (const r of input.rulesApplied ?? []) {
    const k = `${r.key}|${r.value}|${r.source.id}`
    if (!seen.has(k)) {
      seen.add(k)
      rulesApplied.push(r)
    }
  }
  return {
    ...input,
    id,
    datasetId: d.id,
    asOf: d.today,
    handle: id,
    totalRows: total,
    rows,
    rowEvidence: rowEvidence.slice(0, cap),
    slots: { ...input.slots },
    evidence: dedupeEvidence([...(input.evidence ?? []), ...rowEvidence.slice(0, cap).flat()]).slice(0, 120),
    rulesApplied,
    conflicts: input.conflicts ?? [],
    caveats,
  }
}

export function ruleApplied(r: { key: string; value: string; unit?: string; source: EvidenceRef; overriddenBy?: string; manualValue?: string; overrideAuthor?: string }): Finding["rulesApplied"][number] {
  const unit = r.unit ? ` ${r.unit}` : ""
  const value = r.overriddenBy
    ? `${r.value}${unit} (set by ${r.overrideAuthor}; the manual says ${r.manualValue ?? "n/a"})`
    : `${r.value}${unit}`
  return { key: r.key, value, source: r.source, overriddenBy: r.overriddenBy }
}
