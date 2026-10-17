import {
  generateText,
  hasToolCall,
  stepCountIs,
  tool,
  type ModelMessage,
} from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"
import type {
  Finding,
  StreamDataTypes,
  SurfaceMessage,
  VisualKind,
  WorkerId,
} from "@/contracts"
import { VisualKind as VisualKindSchema } from "@/contracts"
import {
  addMessage,
  getDatasets,
  getOrCreateUserThread,
  getUsers,
  listAreas,
  listMessages,
  listWells,
  toolSchemas,
  tools as engineTools,
  type FeedbackResult,
  type ToolCtx,
  type ToolName,
} from "@/server"
import { WORKER_DEFS } from "@/lib/workers"
import {
  TOOL_DESCRIPTIONS,
  TOOL_TASK,
  TOOL_WORKER,
  systemPrompt,
} from "./prompt"

export const DEFAULT_MODEL = process.env.WALTER_MODEL ?? "gemma-4-31b-it"
const FALLBACK_MODEL = "gemma-4-26b-a4b-it"

// Parts streamed to the client, one JSON object per line. Matches the chat store's applyPart.
export type Part =
  | { type: "data-turn"; data: StreamDataTypes["turn"] }
  | { type: "data-delegation"; data: StreamDataTypes["delegation"] }
  | { type: "data-task"; data: StreamDataTypes["task"] }
  | { type: "data-surface"; data: SurfaceMessage }
  | {
      type: "data-visual"
      data: {
        surfaceId: string
        visual: VisualKind
        finding: Finding
        title?: string
      }
    }
  | { type: "data-evidence"; data: StreamDataTypes["evidence"] }
  | { type: "data-conflict"; data: StreamDataTypes["conflict"] }
  | {
      type: "data-feedback"
      data: StreamDataTypes["feedback"] & {
        record?: FeedbackResult["feedback"]
      }
    }
  | { type: "data-followups"; data: { suggestions: string[] } }
  | { type: "text"; data: { text: string } }

export type TurnInput = {
  datasetId?: string
  userId: string
  text: string
  signal?: AbortSignal
  emit: (p: Part) => void
}

const SHAPE_VISUAL: Record<Finding["shape"], VisualKind> = {
  single_entity: "status_card",
  list: "table",
  series: "line_chart",
  ranking: "bar_chart",
  geo: "map",
  matrix: "heatmap",
  scalar: "text",
}

const REQUESTED: [RegExp, VisualKind][] = [
  [/heat ?map/i, "heatmap"],
  [/\bmap\b/i, "map"],
  [/line chart|over time|trend/i, "line_chart"],
  [/bar chart|bar graph/i, "bar_chart"],
  [/\btable\b/i, "table"],
  [/status card|\bcard\b/i, "status_card"],
]

/** Explicit visual named in the user's words wins, if the finding can be drawn that way. */
function pickVisual(
  userText: string,
  modelChoice: VisualKind | undefined,
  f: Finding
): VisualKind {
  const asked = REQUESTED.find(([re]) => re.test(userText))?.[1]
  const fallback = SHAPE_VISUAL[f.shape]
  const hasLatLon =
    f.columns.some((c) => /lat/i.test(c.key)) &&
    f.columns.some((c) => /lon/i.test(c.key))
  const ok = (v: VisualKind) => {
    if (v === "map") return hasLatLon
    if (v === "heatmap") return f.shape === "matrix"
    if (v === "line_chart") return f.shape === "series"
    if (v === "status_card")
      return f.shape === "single_entity" || f.rows.length === 1
    if (v === "bar_chart")
      return f.columns.some((c) => c.type === "number") && f.rows.length > 0
    return true
  }
  for (const v of [asked, modelChoice, fallback]) if (v && ok(v)) return v
  return f.rows.length ? "table" : "text"
}

/** StatusCard reads well-level slots; derive them from the single well row the engine returns. */
function withStatusSlots(f: Finding): Finding {
  const r = f.rows[0]
  if (!r) return f
  const pick = (...keys: string[]) =>
    keys.map((k) => r[k]).find((v) => v !== undefined && v !== null)
  const slots: Finding["slots"] = { ...f.slots }
  const set = (k: string, v: unknown) => {
    if (typeof v === "string" || typeof v === "number") slots[k] = v
    else if (typeof v === "boolean") slots[k] = String(v)
  }
  set("wellId", pick("well", "well_id", "asset_id"))
  set("wellName", pick("well_name", "name"))
  set("area", pick("area", "area_name"))
  set("wellType", pick("well_type"))
  set("status", pick("status"))
  set("delta", pick("delta_c"))
  set("threshold", pick("threshold_c"))
  set("ambient", pick("ambient_c"))
  set("wellhead", pick("wellhead_c"))
  set("inspectedAt", pick("inspected_at"))
  set("inspector", pick("inspected_by", "inspector"))
  set("method", pick("method"))
  set("recordedStatus", pick("recorded_status"))
  set("alarmMax", pick("alarm_max_c", "alarm_c"))
  set("reason", pick("reason"))
  if (r.corrected === true) set("originalWellhead", pick("original_wellhead_c"))
  return { ...f, slots }
}

const NUM = /-?\d[\d,]*(?:\.\d+)?/g
const norm = (s: string) => Number(s.replace(/,/g, ""))

/** Numbers the narrative may cite: everything that appears in the findings the model saw. */
function allowedNumbers(
  findings: Finding[],
  userText: string,
  today: string
): Set<number> {
  const out = new Set<number>()
  const add = (v: unknown) => {
    if (typeof v === "number") out.add(Math.round(v * 100) / 100)
    else if (typeof v === "string")
      for (const m of v.match(NUM) ?? [])
        out.add(Math.round(norm(m) * 100) / 100)
  }
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
    else add(v)
  }
  findings.forEach(walk)
  add(userText)
  add(today)
  return out
}

/** Drop narrative sentences that cite numbers no tool produced. Returns kept sentences and whether any were dropped. */
function checkNarrative(sentences: string[], allowed: Set<number>) {
  const kept: string[] = []
  let dropped = 0
  for (const s of sentences) {
    // Well and record IDs (WELL-0164, INS-0164-0205) are checked as text, not numbers.
    const plain = s
      .replace(/\b[A-Z]{2,5}-[\dA-Z]+(?:-[\dA-Za-z]+)*\b/g, "")
      .replace(/§\s*[\d.]+/g, "")
    const nums = (plain.match(NUM) ?? []).map(
      (m) => Math.round(norm(m) * 100) / 100
    )
    if (nums.every((n) => allowed.has(n) || allowed.has(Math.abs(n))))
      kept.push(s)
    else dropped++
  }
  return { kept, dropped }
}

// Drop empty fields so tool results stay small (Gemma's per-minute input-token quota is tight).
const lean = (r: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(r).filter(
      ([, v]) => v !== null && v !== false && v !== "" && v !== undefined
    )
  )

function compact(f: Finding) {
  return {
    findingId: f.id,
    title: f.title,
    window: f.window?.label,
    asOf: f.asOf,
    totalRows: f.totalRows,
    columns: f.columns.map((c) => c.key + (c.unit ? ` (${c.unit})` : "")),
    rows: f.rows.slice(0, 8).map(lean),
    slots: f.slots,
    rules: f.rulesApplied.map(
      (r) =>
        `${r.key} = ${r.value} [${r.source.id}${r.source.section ? " " + r.source.section : ""}]`
    ),
    conflicts: f.conflicts.map((c) => ({
      about: c.subject.id,
      sides: c.sides.map(
        (s) => `${s.status}: ${s.claim}${s.author ? ` (${s.author})` : ""}`
      ),
      needsConfirmationFrom: c.needsConfirmationFrom,
    })),
    caveats: f.caveats,
    ties: f.ties,
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => (clearTimeout(t), reject(signal.reason)),
      { once: true }
    )
  })

const uid = (p: string) =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export async function runTurn({
  datasetId: requested,
  userId,
  text,
  signal,
  emit,
}: TurnInput) {
  const turnId = uid("turn")
  const t0 = Date.now()
  const turnStartedAt = new Date().toISOString()
  const datasets = await getDatasets()
  const ds = datasets.find((d) => d.id === requested) ?? datasets[0]
  if (!ds) throw new Error("No dataset loaded. Run the importer first.")
  const datasetId = ds.id
  const thread = await getOrCreateUserThread(datasetId, userId)
  emit({
    type: "data-turn",
    data: {
      turnId,
      userId,
      conversationId: thread.id,
      datasetId,
      phase: "started",
    },
  })

  const [users, areas, wells, history] = await Promise.all([
    getUsers(datasetId),
    listAreas(datasetId),
    listWells(datasetId),
    listMessages(thread.id, 12),
  ])
  const me = users.find((u) => u.userId === userId)
  const userMessageId = await addMessage(
    thread.id,
    "user",
    [{ type: "text", text }],
    { datasetId }
  )

  const ctx: ToolCtx = {
    datasetId,
    userId,
    threadId: thread.id,
    messageId: userMessageId,
    turnStartedAt,
  }
  const findings = new Map<string, Finding>()
  const feedbackRecords: FeedbackResult["feedback"][] = []
  const delegated = new Set<WorkerId>()
  const toolCache = new Map<string, unknown>()

  const aiTools = Object.fromEntries(
    (Object.keys(engineTools) as ToolName[]).map((name) => [
      name,
      tool({
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: toolSchemas[name] as z.ZodType<any>,
        execute: async (args: any) => {
          // A model retry must not re-run a tool (record_feedback writes); reuse this turn's result.
          const key = `${name}:${JSON.stringify(args)}`
          const cached = toolCache.get(key)
          if (cached) return cached
          const out = await runTool(name, args)
          toolCache.set(key, out)
          return out
        },
      }),
    ])
  )

  async function runTool(name: ToolName, args: any) {
    {
      const workerId = TOOL_WORKER[name]
      const worker = WORKER_DEFS[workerId]
      const taskId = uid("task")
      if (!delegated.has(workerId)) {
        delegated.add(workerId)
        emit({
          type: "data-delegation",
          data: {
            taskId,
            workerId,
            line: `I'll get ${worker.name} to ${TOOL_TASK[name]}.`,
          },
        })
      }
      const progress: StreamDataTypes["task"]["progress"] = []
      const title = TOOL_TASK[name].replace(/^\w/, (c) => c.toUpperCase())
      const task = (
        status: StreamDataTypes["task"]["status"],
        extra: Partial<StreamDataTypes["task"]> = {}
      ) =>
        emit({
          type: "data-task",
          data: {
            taskId,
            workerId,
            title,
            status,
            progress: [...progress],
            ...extra,
          },
        })
      task("working")
      try {
        const finding = (await (engineTools[name] as any)(
          {
            ...ctx,
            onProgress: (t: string, counts?: Record<string, number>) => {
              progress.push({ at: new Date().toISOString(), text: t, counts })
              task("working")
            },
          },
          args
        )) as Finding | FeedbackResult
        findings.set(finding.id, finding)
        if ("feedback" in finding && finding.feedback)
          feedbackRecords.push(finding.feedback)
        progress.push({
          at: new Date().toISOString(),
          text: `Done: ${finding.title} (${finding.totalRows} rows)`,
        })
        task("done", { findingId: finding.id })
        return compact(finding)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        task("failed", { error: msg })
        return { error: msg }
      }
    }
  }

  const composeAnswer = tool({
    description:
      "Final step: the answer shown to the user. Call exactly once, after the data tools.",
    inputSchema: z.object({
      findingIds: z
        .array(z.string())
        .describe(
          "findingId values from tool results to show, most important first"
        ),
      visual: VisualKindSchema.describe("Visual for the first finding"),
      headline: z
        .string()
        .describe("One short sentence answering the question"),
      narrative: z
        .array(z.string())
        .max(5)
        .describe("Short supporting sentences; only numbers from tool results"),
      followUps: z
        .array(z.string())
        .max(3)
        .optional()
        .describe("Natural next questions the user might ask"),
    }),
  })

  const historyMessages: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => {
      const parts = (m.parts as any[]) ?? []
      const content = parts
        .filter((p) => p?.type === "text")
        .map((p) => p.text)
        .join("\n")
      return {
        role: m.role as "user" | "assistant",
        content: content || "(answer shown as a visual)",
      }
    })
    .filter((m) => m.content)

  const system = systemPrompt({
    today: ds.today,
    userName: me?.name ?? userId,
    userRole: me?.role ?? "user",
    areas: areas.map((a) => a.name),
    wellTypes: [...new Set(wells.map((w) => w.wellType))],
  })

  let result: any = null
  let modelUsed = DEFAULT_MODEL
  const candidates: { id: string; model: any }[] = [
    { id: DEFAULT_MODEL, model: google(DEFAULT_MODEL) },
    { id: FALLBACK_MODEL, model: google(FALLBACK_MODEL) },
  ]
  // Optional paid fallback through Vercel AI Gateway (same Gemma models), only when explicitly allowed.
  if (process.env.WALTER_ALLOW_GATEWAY === "1")
    candidates.push({
      id: "gateway:google/gemma-4-31b-it",
      model: "google/gemma-4-31b-it",
    })
  let waitMs = 0
  for (let round = 0; round < 2 && !result; round++) {
    if (round > 0 && waitMs) await sleep(Math.min(waitMs, 40_000), signal)
    for (const c of candidates) {
      try {
        modelUsed = c.id
        result = await generateText({
          model: c.model,
          system,
          messages: [...historyMessages, { role: "user", content: text }],
          tools: { ...aiTools, compose_answer: composeAnswer },
          stopWhen: [hasToolCall("compose_answer"), stepCountIs(5)],
          abortSignal: signal,
          maxRetries: 0,
        })
        break
      } catch (e) {
        if (signal?.aborted) throw e
        const msg = e instanceof Error ? e.message : String(e)
        const retry = /retry in ([\d.]+)s/i.exec(msg)
        if (retry) waitMs = Math.max(waitMs, Number(retry[1]) * 1000 + 500)
        console.warn(`[walter] ${c.id} failed: ${msg.slice(0, 160)}`)
        if (round === 1 && c === candidates[candidates.length - 1]) throw e
      }
    }
  }
  if (!result) throw new Error("No model result")

  const compose = result.steps
    .flatMap((s: any) => s.toolCalls as any[])
    .find((c: any) => c.toolName === "compose_answer")?.input as
    | {
        findingIds: string[]
        visual: VisualKind
        headline: string
        narrative: string[]
        followUps?: string[]
      }
    | undefined

  const all = [...findings.values()]
  const shown = (compose?.findingIds ?? [])
    .map((id) => findings.get(id))
    .filter((f): f is Finding => !!f)
  const display = shown.length ? shown : all.slice(-1)

  const allowed = allowedNumbers(all, text, ds.today)
  const sentences = compose
    ? [compose.headline, ...compose.narrative]
    : result.text
      ? [result.text]
      : []
  const { kept, dropped } = checkNarrative(sentences, allowed)
  let answer = kept.join(" ")
  if (!answer)
    answer = all.length
      ? "Here is what the records show."
      : "I couldn't find data to answer that. Could you name the well, area or period?"
  if (dropped)
    answer += " (I left out a statement I couldn't back with the records.)"
  emit({ type: "text", data: { text: answer } })

  for (const fb of feedbackRecords) {
    emit({
      type: "data-feedback",
      data: {
        feedbackId: fb.id,
        kind: fb.kind,
        status: fb.status,
        summary: fb.text,
        conflicts: fb.conflicts,
        record: fb,
      },
    })
  }
  display.forEach((f, i) => {
    if ("feedback" in f) return
    const visual = pickVisual(text, i === 0 ? compose?.visual : undefined, f)
    if (visual !== "text" || f.rows.length)
      emit({
        type: "data-visual",
        data: {
          surfaceId: `S-${f.id}`,
          visual,
          finding: visual === "status_card" ? withStatusSlots(f) : f,
        },
      })
    else
      emit({
        type: "data-evidence",
        data: { findingId: f.id, refs: f.evidence },
      })
    for (const c of f.conflicts) emit({ type: "data-conflict", data: c })
  })
  const followUps = compose?.followUps?.length
    ? compose.followUps
    : display.flatMap((f) => f.followUps ?? []).slice(0, 3)
  if (followUps.length)
    emit({ type: "data-followups", data: { suggestions: followUps } })

  await addMessage(
    thread.id,
    "assistant",
    [
      { type: "text", text: answer },
      ...display.map((f) => ({
        type: "finding",
        findingId: f.id,
        title: f.title,
        tool: f.tool,
      })),
    ],
    { datasetId }
  )

  const usage = {
    model: modelUsed,
    requests: result.steps.length,
    inputTokens: result.totalUsage.inputTokens ?? 0,
    outputTokens: result.totalUsage.outputTokens ?? 0,
    ms: Date.now() - t0,
  }
  emit({
    type: "data-turn",
    data: {
      turnId,
      userId,
      conversationId: thread.id,
      datasetId,
      phase: "completed",
      usage,
    },
  })
  return { turnId, usage, answer, findings: display }
}
