import { stepCountIs, streamText, tool, type ModelMessage } from "ai"
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
import { openRouterModel } from "./openrouter"
import {
  TOOL_DESCRIPTIONS,
  TOOL_TASK,
  TOOL_WORKER,
  systemPrompt,
} from "./prompt"

// Gemma 4 everywhere, three routes in priority order:
// OpenRouter pinned to its fastest tool-capable hosts (see openrouter.ts), Vercel AI Gateway
// (about 1 s to first token), then Google AI Studio's free tier (15-20 s, 16k input tokens/min).
// WALTER_PROVIDER = openrouter | gateway | google moves that route to the front.
export async function modelCandidates(): Promise<{ id: string; model: any }[]> {
  const ids = ["google/gemma-4-31b-it", "google/gemma-4-26b-a4b-it"]
  const routes: Record<string, { id: string; model: any }[]> = {
    openrouter: (await Promise.all(ids.map(openRouterModel))).filter(
      (m): m is NonNullable<typeof m> => !!m
    ),
    gateway:
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL
        ? ids.map((m) => ({ id: `gateway:${m}`, model: m }))
        : [],
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY
      ? ids.map((m) => ({
          id: `google:${m.split("/")[1]}`,
          model: google(m.split("/")[1]!),
        }))
      : [],
  }
  const first = process.env.WALTER_PROVIDER
  const order =
    first && first in routes
      ? [first, ...Object.keys(routes).filter((k) => k !== first)]
      : Object.keys(routes)
  return order.flatMap((k) => routes[k]!)
}

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
  | { type: "text-delta"; data: { delta: string } }

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
    cite: [
      ...new Set([
        ...f.rulesApplied.map((r) => r.source.id),
        ...f.evidence.map((e) => e.id),
      ]),
    ].slice(0, 14),
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

/** Streams text through, holding back an unfinished "[[" so citation ids can be rewritten whole. */
function citationRewriter(resolve: (id: string) => string[]) {
  let buf = ""
  const rewrite = (t: string) =>
    t.replace(/\[\[([^\]\s]+)\]\]/g, (_, id: string) => {
      const ids = resolve(id)
      return ids.map((x) => `[[${x}]]`).join("")
    })
  return {
    push(delta: string) {
      buf += delta
      const open = buf.lastIndexOf("[[")
      const cut = open >= 0 && buf.indexOf("]]", open) < 0 ? open : buf.length
      // Also hold a trailing single "[" that may start a marker.
      const end = cut === buf.length && buf.endsWith("[") ? buf.length - 1 : cut
      const ready = buf.slice(0, end)
      buf = buf.slice(end)
      return rewrite(ready)
    },
    flush() {
      const out = rewrite(buf)
      buf = ""
      return out
    },
  }
}

const EQUIPMENT = [
  "wellhead",
  "pump_jack",
  "rod_string",
  "downhole_pump",
  "flowline",
  "separator",
]
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/** Small, generic repairs to Gemma's arguments: data vocabulary for equipment, and counts the user stated. */
function normalizeArgs(name: ToolName, args: any, userText: string) {
  const a = { ...args }
  if (typeof a.equipmentKind === "string") {
    const k = a.equipmentKind
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
    a.equipmentKind =
      EQUIPMENT.find((e) => e.replace(/_/g, "") === k.replace(/_/g, "")) ?? k
  }
  if (name === "recall" && a.count == null) {
    const m =
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:wells?|of them)\b/i.exec(
        userText
      )
    if (m) a.count = NUMBER_WORDS[m[1]!.toLowerCase()] ?? Number(m[1])
  }
  return a
}

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
          const out = await runTool(name, normalizeArgs(name, args, text))
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
        if ("feedback" in finding && finding.feedback) {
          const fb = finding.feedback
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

  // Blocks Gemma can pair into an answer. It names findings and slots; the server fills in the values.
  const BlockArg = z.object({
    type: z.enum(["visual", "metric", "keyvalue"]),
    findingId: z.string(),
    visual: VisualKindSchema.optional().describe("For type=visual"),
    slot: z
      .string()
      .optional()
      .describe("For type=metric: a key from the finding's slots"),
    label: z
      .string()
      .optional()
      .describe("For type=metric: short label, e.g. 'Wells operated'"),
    unit: z.string().optional(),
    slots: z
      .array(z.string())
      .max(8)
      .optional()
      .describe("For type=keyvalue: slot keys to list"),
    title: z.string().optional(),
  })
  type Block = z.infer<typeof BlockArg>

  const shownFindings = new Set<string>()
  let followUps: string[] = []
  let presented = false

  const evidenceSent = new Set<string>()
  const sendEvidence = (f: Finding) => {
    if (evidenceSent.has(f.id)) return
    evidenceSent.add(f.id)
    emit({ type: "data-evidence", data: { findingId: f.id, refs: f.evidence } })
  }

  const slotValue = (f: Finding, key?: string) =>
    key && key in f.slots ? f.slots[key] : undefined

  function renderBlocks(blocks: Block[]) {
    const out: string[] = []
    let metrics: { f: Finding; b: Block }[] = []
    const flushMetrics = () => {
      if (!metrics.length) return
      const surfaceId = uid("S-metrics")
      const ids = metrics.map((_, i) => `m${i}`)
      emit({
        type: "data-surface",
        data: { createSurface: { surfaceId, catalogId: "app:catalog/v1" } },
      })
      emit({
        type: "data-surface",
        data: {
          updateComponents: {
            surfaceId,
            rootId: "row",
            components: [
              { id: "row", component: "Grid", props: {}, children: ids },
              ...metrics.map(({ f, b }, i) => ({
                id: ids[i]!,
                component: "Metric" as const,
                props: {
                  label: b.label ?? b.slot!,
                  value: slotValue(f, b.slot)!,
                  ...(b.unit ? { unit: b.unit } : {}),
                  ...(f.evidence[0] ? { cite: [f.evidence[0].id] } : {}),
                } as any,
              })),
            ],
          },
        },
      })
      out.push(`metrics: ${metrics.map(({ b }) => b.slot).join(", ")}`)
      metrics = []
    }
    for (const b of blocks.slice(0, 4)) {
      const f = findings.get(b.findingId)
      if (!f || "feedback" in f) continue
      sendEvidence(f)
      if (b.type === "metric") {
        if (slotValue(f, b.slot) !== undefined) metrics.push({ f, b })
        continue
      }
      flushMetrics()
      if (b.type === "keyvalue") {
        const items = (b.slots ?? Object.keys(f.slots))
          .filter((k) => slotValue(f, k) !== undefined)
          .slice(0, 8)
          .map((k) => ({
            label: k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "),
            value: slotValue(f, k)!,
          }))
        if (!items.length) continue
        const surfaceId = uid("S-kv")
        emit({
          type: "data-surface",
          data: { createSurface: { surfaceId, catalogId: "app:catalog/v1" } },
        })
        emit({
          type: "data-surface",
          data: {
            updateComponents: {
              surfaceId,
              rootId: "kv",
              components: [
                {
                  id: "kv",
                  component: "KeyValue",
                  props: {
                    ...(b.title ? { title: b.title } : {}),
                    items,
                  } as any,
                },
              ],
            },
          },
        })
        out.push(`keyvalue: ${items.length} items`)
        continue
      }
      const visual = pickVisual(text, b.visual, f)
      if (visual === "text") continue
      shownFindings.add(f.id)
      emit({
        type: "data-visual",
        data: {
          surfaceId: `S-${f.id}`,
          visual,
          finding: visual === "status_card" ? withStatusSlots(f) : f,
        },
      })
      for (const c of f.conflicts) emit({ type: "data-conflict", data: c })
      out.push(`${visual}: ${f.title}`)
    }
    flushMetrics()
    return out
  }

  const present = tool({
    description:
      "Show the answer's blocks, once, after the data tools and before you write your reply. Pick the fewest blocks that answer the question: usually ONE visual, or 1-3 metrics for a single number. Values come from the findings; you only name findingId and slot keys.",
    inputSchema: z.object({
      blocks: z.array(BlockArg).max(4),
      followUps: z
        .array(z.string())
        .max(3)
        .optional()
        .describe("Natural next questions the user might ask"),
    }),
    execute: async ({ blocks, followUps: f }) => {
      if (presented)
        return { ok: true, note: "Already shown. Now write the reply." }
      presented = true
      followUps = f ?? []
      return {
        ok: true,
        shown: renderBlocks(blocks),
        next: "Now write the reply in markdown with [[ID]] citations.",
      }
    },
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

  // Gemma sometimes cites a findingId; swap it for that finding's own record ids.
  const citations = citationRewriter((id) => {
    const f = findings.get(id)
    if (!f) return id.startsWith("fnd_") ? [] : [id]
    return [
      ...new Set([
        ...f.rulesApplied.map((r) => r.source.id),
        ...f.evidence.map((e) => e.id),
      ]),
    ].slice(0, 2)
  })

  const candidates = await modelCandidates()
  if (!candidates.length) throw new Error("No model route configured")
  let streamed = ""
  let modelUsed = candidates[0]!.id
  let usageTotals = { requests: 0, inputTokens: 0, outputTokens: 0 }
  let waitMs = 0
  let done = false
  for (let round = 0; round < 2 && !done; round++) {
    if (round > 0 && waitMs) await sleep(Math.min(waitMs, 40_000), signal)
    for (const c of candidates) {
      modelUsed = c.id
      let produced = false
      try {
        const result = streamText({
          model: c.model,
          system,
          messages: [...historyMessages, { role: "user", content: text }],
          tools: { ...aiTools, present },
          stopWhen: stepCountIs(6),
          abortSignal: signal,
          maxRetries: 0,
        })
        for await (const part of result.fullStream as AsyncIterable<any>) {
          if (part.type === "text-delta") {
            const delta: string = part.text ?? part.delta ?? ""
            if (!delta) continue
            produced = true
            const out = citations.push(delta)
            if (out) {
              streamed += out
              emit({ type: "text-delta", data: { delta: out } })
            }
          } else if (part.type === "tool-call") {
            produced = true
          } else if (part.type === "finish-step") {
            usageTotals.requests++
            usageTotals.inputTokens += part.usage?.inputTokens ?? 0
            usageTotals.outputTokens += part.usage?.outputTokens ?? 0
          } else if (part.type === "error") {
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error?.message ?? part.error))
          }
        }
        const rest = citations.flush()
        if (rest) {
          streamed += rest
          emit({ type: "text-delta", data: { delta: rest } })
        }
        done = true
        break
      } catch (e) {
        if (signal?.aborted) throw e
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[walter] ${c.id} failed: ${msg.slice(0, 160)}`)
        // Once text or tools went out, switching models would duplicate the answer.
        if (produced) throw e
        const retry = /retry in ([\d.]+)s/i.exec(msg)
        if (retry) waitMs = Math.max(waitMs, Number(retry[1]) * 1000 + 500)
        if (round === 1 && c === candidates[candidates.length - 1]) throw e
      }
    }
  }

  const all = [...findings.values()]
  // If Gemma skipped present, show the most recent finding the default way.
  if (!presented) {
    const last = all.filter((f) => !("feedback" in f)).slice(-1)[0]
    if (last) {
      if (last.shape === "scalar")
        renderBlocks(
          Object.keys(last.slots)
            .slice(0, 3)
            .map((k) => ({ type: "metric", findingId: last.id, slot: k }))
        )
      else renderBlocks([{ type: "visual", findingId: last.id }])
    }
  }
  all.forEach(sendEvidence)

  const allowed = allowedNumbers(all, text, ds.today)
  const sentences = streamed
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/\[\[[^\]]+\]\]/g, "").replace(/\$[^$]*\$/g, ""))
  const { dropped } = checkNarrative(sentences, allowed)
  if (!streamed.trim()) {
    const fallback = all.length
      ? "Here is what the records show."
      : "I couldn't find data to answer that. Could you name the well, area or period?"
    streamed = fallback
    emit({ type: "text-delta", data: { delta: fallback } })
  } else if (dropped) {
    const note =
      "\n\n_One figure above doesn't match a record I retrieved; please double-check it._"
    streamed += note
    emit({ type: "text-delta", data: { delta: note } })
  }

  const suggestions = followUps.length
    ? followUps
    : all.flatMap((f) => f.followUps ?? []).slice(0, 3)
  if (suggestions.length)
    emit({ type: "data-followups", data: { suggestions } })

  await addMessage(
    thread.id,
    "assistant",
    [
      { type: "text", text: streamed },
      ...all
        .filter((f) => shownFindings.has(f.id))
        .map((f) => ({
          type: "finding",
          findingId: f.id,
          title: f.title,
          tool: f.tool,
        })),
    ],
    { datasetId }
  )

  const usage = { model: modelUsed, ...usageTotals, ms: Date.now() - t0 }
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
  return { turnId, usage, answer: streamed, findings: all }
}
