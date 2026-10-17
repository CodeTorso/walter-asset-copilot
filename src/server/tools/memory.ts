import { and, asc, desc, eq, lt } from "drizzle-orm"
import type { Finding } from "../../contracts"
import { conversations, memoryEntities, messages } from "../db/schema"
import type { Db } from "../db/client"
import type { Domain } from "../engine/domain"
import { fmtDate } from "../util/dates"
import { dbOf, loadDomain, makeFinding, type FindingInput, type ToolCtx } from "./ctx"
import type { RecallArgs } from "./schemas"

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export type UserThread = { id: string; datasetId: string; userId: string; createdAt: string }

/** Each user has one continuous thread per dataset. */
export async function getOrCreateUserThread(datasetId: string, userId: string, db?: Db): Promise<UserThread> {
  const d = db ?? (await dbOf({ datasetId }))
  const id = `thread:${datasetId}:${userId}`
  const found = await d.drizzle.select().from(conversations).where(eq(conversations.id, id))
  if (found[0]) return { id, datasetId, userId, createdAt: found[0].createdAt }
  const createdAt = new Date().toISOString()
  await d.drizzle.insert(conversations).values({ id, datasetId, userId, title: null, createdAt }).onConflictDoNothing()
  return { id, datasetId, userId, createdAt }
}

export async function addMessage(
  threadId: string,
  role: "user" | "assistant" | "system",
  parts: unknown,
  opts: { id?: string; db?: Db; datasetId?: string } = {},
): Promise<string> {
  const d = opts.db ?? (await dbOf({ datasetId: opts.datasetId ?? "" }))
  const id = opts.id ?? `msg_${rid()}`
  await d.drizzle.insert(messages).values({ id, conversationId: threadId, role, parts: parts as never, createdAt: new Date().toISOString() })
  return id
}

export async function listMessages(threadId: string, limit = 200, db?: Db) {
  const d = db ?? (await dbOf({ datasetId: "" }))
  const rows = await d.drizzle.select().from(messages).where(eq(messages.conversationId, threadId)).orderBy(desc(messages.createdAt)).limit(limit)
  return rows.reverse()
}

const NO_MEMORY_TOOLS = new Set(["recall", "record_feedback", "get_rule", "search_documents"])

/** Write the entities a finding mentioned into the current user's private memory. */
export async function rememberFinding(ctx: ToolCtx, finding: Finding): Promise<void> {
  if (!ctx.userId || ctx.remember === false || NO_MEMORY_TOOLS.has(finding.tool)) return
  const db = await dbOf(ctx)
  const threadId = ctx.threadId ?? (await getOrCreateUserThread(ctx.datasetId, ctx.userId, db)).id
  const ids: string[] = []
  const labels = new Map<string, string>()
  for (const r of finding.rows) {
    const w = r.well
    if (typeof w === "string" && !ids.includes(w)) {
      ids.push(w)
      if (typeof r.area === "string") labels.set(w, r.area)
    }
  }
  if (!ids.length) return
  const createdAt = new Date().toISOString()
  const meta = { title: finding.title, window: finding.window?.label, tool: finding.tool }
  await db.drizzle.insert(memoryEntities).values(
    ids.map((id) => ({
      id: `mem_${rid()}`,
      datasetId: ctx.datasetId,
      userId: ctx.userId!,
      conversationId: threadId,
      messageId: ctx.messageId ?? null,
      findingId: finding.id,
      sourceTool: finding.tool,
      entityType: "well",
      entityId: id,
      label: labels.get(id) ? `${id} (${labels.get(id)})` : id,
      meta,
      createdAt,
    })),
  )
}

/** makeFinding + follow-ups + memory write. Every read tool ends here. */
export async function finish(ctx: ToolCtx, d: Domain, input: FindingInput, cap?: number): Promise<Finding> {
  const f = makeFinding(d, { ...input, followUps: input.followUps ?? defaultFollowUps(input) }, cap)
  await rememberFinding(ctx, f)
  return f
}

export function defaultFollowUps(input: Pick<FindingInput, "shape" | "tool" | "rows">): string[] {
  const out: string[] = []
  const hasWell = input.rows.some((r) => typeof r.well === "string")
  if (input.shape === "list" || input.shape === "ranking") out.push("Show this as a bar chart or a table")
  if (input.shape === "geo") out.push("Show these on a map")
  if (hasWell && input.tool !== "maintenance") out.push("What have repairs cost for these wells this year?")
  if (hasWell && input.tool !== "well_status") out.push("Which of these wells are not producing right now?")
  if (hasWell && input.tool !== "compliance") out.push("Which rules have these wells broken in the last 12 months?")
  return out.slice(0, 3)
}

export async function recall(ctx: ToolCtx, args: RecallArgs): Promise<Finding> {
  if (!ctx.userId) throw new Error("recall needs a userId")
  const d = await loadDomain(ctx)
  const db = await dbOf(ctx)
  const before = ctx.turnStartedAt ?? new Date(Date.now() + 1000).toISOString()
  // Only this user's own entities: the userId filter is part of every query.
  const rows = await db.drizzle
    .select()
    .from(memoryEntities)
    .where(
      and(
        eq(memoryEntities.datasetId, ctx.datasetId),
        eq(memoryEntities.userId, ctx.userId),
        eq(memoryEntities.entityType, "well"),
        lt(memoryEntities.createdAt, before),
      ),
    )
    .orderBy(desc(memoryEntities.createdAt), asc(memoryEntities.id))
  ctx.onProgress?.(`read ${rows.length} remembered entities for this user`, { entities: rows.length })

  type Group = { key: string; at: string; tool: string; title: string; window?: string; wells: { id: string; label: string }[] }
  const groups = new Map<string, Group>()
  for (const r of rows) {
    const key = r.findingId ?? r.createdAt
    const m = (r.meta ?? {}) as { title?: string; window?: string; tool?: string }
    const g = groups.get(key) ?? { key, at: r.createdAt, tool: r.sourceTool ?? m.tool ?? "", title: m.title ?? "", window: m.window, wells: [] }
    if (!g.wells.some((w) => w.id === r.entityId)) g.wells.push({ id: r.entityId, label: r.label })
    groups.set(key, g)
  }
  const all = [...groups.values()].sort((a, b) => b.at.localeCompare(a.at))
  const wantsYesterday = /yesterday/i.test(args.reference)
  const nowDate = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const sized = args.count ? all.filter((g) => g.wells.length === args.count) : all
  // A stated count must match: "the three wells we discussed" never borrows a one-well answer.
  const pool = args.count ? sized : all
  const fromYesterday = pool.filter((g) => g.at.slice(0, 10) === yesterday)
  const chosen = (wantsYesterday && fromYesterday.length ? fromYesterday : pool)[0]

  const caveats: string[] = []
  if (!chosen) {
    caveats.push(
      all.length && args.count
        ? `None of your earlier answers listed ${args.count} wells, so I can't tell which ones you mean. Nobody else's history is used.`
        : "No earlier answers are stored for this user, so there is nothing to refer back to. Nobody else's history is used.",
    )
    return finish(ctx, d, {
      workerId: "memory",
      tool: "recall",
      shape: "list",
      title: "Recalled from your earlier turns",
      columns: [],
      rows: [],
      slots: { found: 0 },
      caveats,
    })
  }
  const usedDate = chosen.at.slice(0, 10)
  if (wantsYesterday && usedDate !== yesterday)
    caveats.push(`None of your turns is from yesterday; the closest match is from ${usedDate === nowDate ? "today" : fmtDate(usedDate)}.`)
  if (args.count && chosen.wells.length !== args.count)
    caveats.push(`You mentioned ${args.count} wells; the closest earlier answer listed ${chosen.wells.length}.`)
  const rowsOut = chosen.wells.slice(0, args.limit ?? 50).map((w) => ({
    well: w.id,
    label: w.label,
    from_tool: chosen.tool,
    answer: chosen.title,
    window: chosen.window ?? null,
    discussed_at: chosen.at,
  }))
  return finish(ctx, d, {
    workerId: "memory",
    tool: "recall",
    shape: "list",
    title: `Wells from your earlier answer "${chosen.title}"`,
    columns: [
      { key: "well", label: "Well", type: "well" },
      { key: "answer", label: "Earlier answer", type: "text" },
      { key: "discussed_at", label: "Discussed at (UTC)", type: "datetime" },
    ],
    rows: rowsOut,
    slots: { found: rowsOut.length, discussedAt: chosen.at, fromTool: chosen.tool, earlierAnswer: chosen.title },
    caveats: [`Used your own earlier ${chosen.tool} answer from ${chosen.at.replace("T", " ").slice(0, 16)} UTC.`, ...caveats],
    evidence: rowsOut.map((r) => ({ kind: "well" as const, id: r.well, label: r.label, datasetId: d.id })),
  })
}
