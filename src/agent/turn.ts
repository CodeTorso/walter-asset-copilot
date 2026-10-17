import { fieldBrief } from "./brief"
import { getDb } from "@/server/db/client"
import { getSnapshot } from "@/server/engine/snapshot"
import { inspectionRef, maintenanceRef, noteRef, regRef, wellRef } from "@/server/engine/evidence"
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
import { VisualKind as VisualKindSchema, type EvidenceRef } from "@/contracts"
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
  if (process.env.WALTER_MODEL_FIRST === "26b") ids.reverse()
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
  /** Name to address the user by when the app shows them under another name */
  displayName?: string
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
  // The guide's defaults when nothing was asked: a short ranking compares a few, so it is a bar chart.
  const model = !asked && modelChoice === "table" && f.shape === "ranking" && f.rows.length <= 10 ? fallback : modelChoice
  for (const v of [asked, model, fallback]) if (v && ok(v)) return v
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
    // Dates and times are checked by the evidence, not as figures ("27 Oct", "Oct 15th", "2026-10-15", "09:45").
    const plain = s
      .replace(/\b[A-Z]{2,5}-[\dA-Z]+(?:-[\dA-Za-z]+)*\b/g, "")
      .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g, "")
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?/gi, "")
      .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi, "")
      .replace(/\b\d{1,2}:\d{2}(?:\s*(?:UTC|am|pm))?/gi, "")
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
    // Consequences the reply must state (status changes, deadlines, breaches, stale reports, corrections).
    mustMention: f.caveats.length ? f.caveats : undefined,
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
        (s) => `${s.status}: ${s.claim}${s.author ? ` (${s.author})` : ""}${s.source?.id ? ` [${s.source.id}]` : ""}`
      ),
      needsConfirmationFrom: c.needsConfirmationFrom,
    })),
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
  // Gemma sometimes groups citations as [[A], [B]] or [[A, B]]; split them into [[A]][[B]] first.
  const split = (ids: string[]) => ids.map((x) => `[[${x.trim()}]]`).join("")
  const normalize = (t: string) =>
    t
      .replace(/\[\[([^\][]+)\]((?:\s*,\s*\[[^\][]+\])+)\]/g, (_, a: string, rest: string) =>
        split([a, ...(rest.match(/\[([^\]]+)\]/g) ?? []).map((x) => x.slice(1, -1))])
      )
      .replace(/\[\[([^\]]+,[^\]]+)\]\]/g, (_, ids: string) => split(ids.split(",")))
  const rewrite = (t: string) =>
    normalize(t).replace(/\[\[([^\]\s]+)\]\]/g, (_, id: string) => {
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
const PERIOD_TOOLS = new Set<string>(["downtime", "spills", "maintenance", "compliance", "reading_series"])
const PNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 }

/** "last 4 months", "last 90 days", "last 13 weeks", "last 4 years", "in 2025", "this year" → an exact Period. */
function periodFromText(text: string, today?: string): any | null {
  const m = /\b(?:last|past|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s+(day|week|month|year)s?\b/i.exec(text)
  if (m) {
    const n = PNUM[m[1]!.toLowerCase()] ?? Number(m[1])
    const unit = m[2]!.toLowerCase()
    if (unit === "day") return { kind: "last_n_days", n }
    if (unit === "week") return { kind: "last_n_days", n: n * 7 }
    if (unit === "month") return { kind: "last_n_months", n }
    return { kind: "last_n_months", n: n * 12 }
  }
  const y = /\b(?:in|during|for|of)\s+((?:19|20)\d{2})\b/i.exec(text) ?? /\b((?:19|20)\d{2})\s+(?:spills|repairs|downtime|costs?)\b/i.exec(text)
  if (y) return { kind: "calendar_year", year: Number(y[1]) }
  if (/\bthis year\b/i.test(text) && today) return { kind: "calendar_year", year: Number(today.slice(0, 4)) }
  return null
}

/** The dataset's own vocabulary, so normalizers don't assume the sample's well types or equipment names. */
type Vocab = { wellTypes: string[]; equipment: string[]; today?: string }
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function normalizeArgs(name: ToolName, args: any, userText: string, vocab: Vocab = { wellTypes: [], equipment: EQUIPMENT }) {
  const EQUIP = vocab.equipment.length ? vocab.equipment : EQUIPMENT
  const a = { ...args }
  if (typeof a.equipmentKind === "string") {
    const k = a.equipmentKind
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
    a.equipmentKind =
      EQUIP.find((e) => e.replace(/_/g, "") === k.replace(/_/g, "")) ?? k
  }
  // The period the user named, stated exactly (Gemma often turns "last 4 months" into ~120 days or the wrong year).
  if (PERIOD_TOOLS.has(name)) {
    const p = periodFromText(userText, vocab.today)
    if (p) a.period = p
  }
  // Filters the question clearly asks for, which Gemma tends to leave out (or sets to false).
  if (name === "spills") {
    if (/heat ?map/i.test(userText) && (!a.groupBy || a.groupBy === "none")) a.groupBy = "area_month"
    if (/not contained|contain(ed|ment)\b.{0,40}\b(limit|within|time|late|over)/i.test(userText)) a.containmentOverLimit = true
    if (a.reportableOnly == null && /\b(reportable|report(ed)? to the regulator|needed a report|needs? a report|regulator report)/i.test(userText)) a.reportableOnly = true
  }
  if (name === "maintenance" && !a.groupBy && (a.scope?.wellIds?.length ?? 0) > 1 && /\bcost/i.test(userText)) a.groupBy = "well"
  // The user's words decide the scope when Gemma leaves it out.
  if (name === "rca_candidates" && !a.equipmentKind) {
    const said = userText.toLowerCase().replace(/[\s-]+/g, "_")
    const k = EQUIP.find((e) => said.includes(e) || said.replace(/_/g, "").includes(e.replace(/_/g, "")))
    if (k) a.equipmentKind = k
  }
  if (name === "record_feedback" && a.kind === "scoped_rule" && (!a.scope || a.scope.type === "fleet")) {
    const t = vocab.wellTypes.find((wt) => new RegExp(`\\b${esc(wt)}\\b`, "i").test(userText))
    if (t) a.scope = { type: "well_type", value: t }
  }
  if (name === "record_feedback" && a.kind === "status_claim" && typeof a.claimedProducing !== "boolean") {
    const t = userText.toLowerCase()
    if (/\b(not producing|isn'?t producing|down|shut[ -]?in|stopped|dead|offline|not running)\b/.test(t)) a.claimedProducing = false
    else if (/\b(producing|running|back online|online|fine|working|flowing|up and running)\b/.test(t)) a.claimedProducing = true
  }
  if (name === "record_feedback" && a.kind === "scoped_rule" && (a.newValue === undefined || a.newValue === "")) {
    const n = /(?:^|[^\w.])(\d+(?:\.\d+)?)(?![\w.])/.exec(vocab.wellTypes.reduce((acc, wt) => acc.replace(new RegExp(`\\b${esc(wt)}\\b`, "gi"), ""), userText))
    if (n) a.newValue = Number(n[1])
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

/** Keep stored answers small: a finding's rows are capped (the card shows totalRows) and evidence lists trimmed. */
function trimPart(p: Part): Part {
  if (p.type === "data-visual") {
    const f = p.data.finding
    return { ...p, data: { ...p.data, finding: { ...f, totalRows: f.totalRows ?? f.rows.length, rows: f.rows.slice(0, 50), rowEvidence: f.rowEvidence?.slice(0, 50), evidence: f.evidence.slice(0, 60) } } } as Part
  }
  if (p.type === "data-evidence") return { ...p, data: { ...p.data, refs: p.data.refs.slice(0, 60) } } as Part
  return p
}

const uid = (p: string) =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** "15 Oct", "Oct 15", "24 Sep" or "2026-10-15" in the user's text, as a MM-DD (or full date) suffix. */
function mentionedDay(text: string): string | null {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)
  if (iso) return iso[1]!
  const m =
    /\b(\d{1,2})\s+([a-z]{3})[a-z]*\b/i.exec(text) ?? /\b([a-z]{3})[a-z]*\s+(\d{1,2})\b/i.exec(text)
  if (!m) return null
  const [day, mon] = /\d/.test(m[1]!) ? [m[1]!, m[2]!] : [m[2]!, m[1]!]
  const mi = MONTHS.indexOf(mon.toLowerCase())
  return mi < 0 ? null : `${String(mi + 1).padStart(2, "0")}-${day.padStart(2, "0")}`
}

/** Corrections must name an inspection; Gemma often passes the well. Use the inspection on the date the user named, else the latest. */
async function resolveCorrection(datasetId: string, a: any, userText: string) {
  if (!["data_correction", "analysis_correction"].includes(a.kind) || typeof a.targetId !== "string") return a
  const snap = await getSnapshot(await getDb(), datasetId)
  let pick = snap.inspById.get(a.targetId)
  if (!pick) {
    const well = snap.wells.get(a.targetId) ?? snap.wellList.find((w) => w.name.toLowerCase() === a.targetId.toLowerCase())
    const insps = well ? snap.inspByWell.get(well.asset_id) ?? [] : []
    if (!insps.length) return a
    const day = mentionedDay(userText)
    const sorted = [...insps].sort((x, y) => (x.inspected_at < y.inspected_at ? 1 : -1))
    pick = (day && sorted.find((i) => i.inspected_at.slice(0, 10).endsWith(day))) || sorted[0]!
  }
  const out = { ...a, targetId: pick.inspection_id }
  if (!out.field) out.field = /\bbbl\b|barrel/i.test(userText) ? "spill_est_volume_bbl" : /ambient|air temp/i.test(userText) ? "ambient_temp_c" : "wellhead_temp_c"
  // The new value is the figure the user gives that differs from the record (e.g. "estimated 4.5 bbl … measured 5.4 bbl"
  // → 5.4); also repairs a correction Gemma sent with the original value.
  const original = Number((pick as any)[out.field])
  if (out.newValue === undefined || Number(out.newValue) === original) {
    const unit = out.field.includes("bbl") ? /([\d.]+)\s*(?:bbl|barrels?)/gi : /([\d.]+)\s*°?\s*C\b/g
    const figures = [...userText.matchAll(unit)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n !== original)
    if (figures.length) out.newValue = figures[figures.length - 1]
  }
  return out
}

export async function runTurn({
  datasetId: requested,
  userId,
  displayName,
  text,
  signal,
  emit: emitOut,
}: TurnInput) {
  // Everything the answer showed (not the token stream or task progress) is saved with the message,
  // so a reloaded thread can rebuild the same cards, citations and follow-ups.
  const kept: Part[] = []
  const KEEP = new Set(["data-delegation", "data-visual", "data-surface", "data-evidence", "data-conflict", "data-feedback", "data-followups"])
  const evidenceIds = new Set<string>()
  const emit = (p: Part) => {
    if (KEEP.has(p.type)) kept.push(p)
    if (p.type === "data-evidence") for (const r of p.data.refs) evidenceIds.add(r.id)
    emitOut(p)
  }
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
  const snapForVocab = await getSnapshot(await getDb(), datasetId)
  const vocab: Vocab = {
    wellTypes: [...new Set(wells.map((w) => w.wellType))],
    equipment: [...new Set(snapForVocab.rows.maintenance.map((m) => m.equipment_kind).filter(Boolean))],
    today: ds.today,
  }
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
          let a = normalizeArgs(name, args, text, vocab)
          if (name === "record_feedback") a = await resolveCorrection(datasetId, a, text).catch(() => a)
          const out = await runTool(name, a)
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
  const shownVisuals = new Set<VisualKind>()
  let followUps: string[] = []
  let presented = false

  const evidenceSent = new Set<string>()
  // A finding's evidence is its records plus the manual/SOP sections it applied and both sides of any conflict,
  // so every [[ID]] Walter can cite resolves to a chip.
  const conflictsSent = new Set<string>()
  const sendConflicts = (f: Finding) => {
    for (const c of f.conflicts) {
      const key = JSON.stringify(c.sides.map((x) => x.source?.id))
      if (conflictsSent.has(key)) continue
      conflictsSent.add(key)
      emit({ type: "data-conflict", data: c })
    }
  }
  const sendEvidence = (f: Finding) => {
    if (evidenceSent.has(f.id)) return
    evidenceSent.add(f.id)
    const refs = new Map<string, EvidenceRef>()
    for (const r of [...f.evidence, ...f.rulesApplied.map((r) => r.source), ...f.conflicts.flatMap((c) => c.sides.map((x) => x.source))])
      if (r?.id && !refs.has(r.id)) refs.set(r.id, r)
    emit({ type: "data-evidence", data: { findingId: f.id, refs: [...refs.values()] } })
  }

  const slotValue = (f: Finding, key?: string) =>
    key && key in f.slots ? f.slots[key] : undefined
  const resolveSlot = (f: Finding, key?: string) => {
    if (!key) return undefined
    if (key in f.slots) return key
    const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "")
    return Object.keys(f.slots).find((k) => norm(k) === norm(key))
  }

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
                  label: b.label ?? b.slot!.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
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
    // Gemma sometimes invents an id ("reading_series_result"): match it by tool name, else the latest finding.
    const findFinding = (id: string) => {
      const hit = findings.get(id)
      if (hit) return hit
      const all = [...findings.values()].filter((x) => !("feedback" in x) || x.rows.length)
      return all.filter((x) => id.includes(x.tool)).slice(-1)[0] ?? all.slice(-1)[0]
    }
    for (const b of blocks.slice(0, 4)) {
      const f = findFinding(b.findingId)
      if (!f) continue
      // A feedback result is drawn only when it carries rows (e.g. the SOP checks a corrected spill now triggers).
      if ("feedback" in f && (b.type !== "visual" || !f.rows.length)) continue
      sendEvidence(f)
      if (b.type === "metric") {
        // Gemma sometimes names metric keys in `slots` (the keyvalue field) or with other casing.
        const keys = [b.slot, ...(b.slots ?? [])].map((k) => resolveSlot(f, k)).filter((k): k is string => !!k)
        ;[...new Set(keys)].forEach((slot, i) => metrics.push({ f, b: { ...b, slot, label: i === 0 ? b.label : undefined } }))
        continue
      }
      flushMetrics()
      if (b.type === "keyvalue") {
        const asked = (b.slots ?? []).map((k) => resolveSlot(f, k)).filter((k): k is string => !!k)
        const items = (asked.length ? asked : Object.keys(f.slots))
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
      shownVisuals.add(visual)
      emit({
        type: "data-visual",
        data: {
          surfaceId: `S-${f.id}`,
          visual,
          finding: visual === "status_card" ? withStatusSlots(f) : f,
        },
      })
      sendConflicts(f)
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
      const shown = renderBlocks(blocks)
      console.info(`[walter] present ${JSON.stringify(blocks).slice(0, 400)} -> ${shown.join(" | ") || "nothing"}`)
      return {
        ok: true,
        shown,
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
    userName: displayName ?? me?.name ?? userId,
    userRole: me?.role ?? "user",
    areas: areas.map((a) => a.name),
    wellTypes: [...new Set(wells.map((w) => w.wellType))],
    brief: await fieldBrief(datasetId).catch(() => undefined),
  })

  // Gemma sometimes cites a findingId; swap it for that finding's own record ids.
  const knownIds = () => {
    const ids = new Set<string>()
    for (const f of findings.values()) {
      for (const e of f.evidence) ids.add(e.id)
      for (const r of f.rulesApplied) ids.add(r.source.id)
      for (const c of f.conflicts) for (const x of c.sides) if (x.source?.id) ids.add(x.source.id)
      if ("feedback" in f) ids.add((f as any).feedback?.id)
    }
    return ids
  }
  const citations = citationRewriter((id) => {
    const f = findings.get(id)
    if (!f) {
      if (id.startsWith("fnd_")) return []
      const ids = knownIds()
      if (ids.has(id)) return [id]
      // "SR-01" or "9.3" → "spill-response-sop#SR-01" / "T200#9.3" when that is what the tools returned.
      const match = [...ids].find((k) => k.endsWith(`#${id}`) || k.toLowerCase() === id.toLowerCase())
      if (match) return [match]
      // A real record from earlier in the chat is kept (its chip is looked up after the answer); an invented ID is dropped.
      const real =
        snapForVocab.inspById.has(id) || snapForVocab.mntById.has(id) || snapForVocab.notesById.has(id) || snapForVocab.wells.has(id) ||
        snapForVocab.rows.regEvents.some((e) => e.event_id === id)
      return real ? [id] : []
    }
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
  let toolCalls = 0
  let done = false
  for (let round = 0; round < 2 && !done; round++) {
    if (round > 0 && waitMs) await sleep(Math.min(waitMs, 40_000), signal)
    for (const c of candidates) {
      modelUsed = c.id
      let produced = false
      // A host can accept the request and then go silent; without this the turn hangs until the
      // function is killed. No first part in 15s: try the next route. Silent 20s mid-answer: stop there.
      const stall = new AbortController()
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      const arm = (ms: number) => {
        clearTimeout(stallTimer)
        stallTimer = setTimeout(() => stall.abort(new Error(`stalled ${ms / 1000}s`)), ms)
      }
      arm(15_000)
      try {
        const result = streamText({
          model: c.model,
          system,
          messages: [...historyMessages, { role: "user", content: text }],
          tools: { ...aiTools, present },
          stopWhen: stepCountIs(8),
          abortSignal: signal ? AbortSignal.any([signal, stall.signal]) : stall.signal,
          maxRetries: 0,
        })
        for await (const part of result.fullStream as AsyncIterable<any>) {
          arm(20_000)
          if (process.env.WALTER_DEBUG) console.info(`[walter] part ${part.type}${part.type === "tool-call" ? ` ${part.toolName} ${JSON.stringify(part.input).slice(0, 200)}` : ""}`)
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
            // Gemma can loop on one call forever inside a step; cut the turn off and answer with what we have.
            if (++toolCalls > 12) stall.abort(new Error("too many tool calls"))
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
        clearTimeout(stallTimer)
        const rest = citations.flush()
        if (rest) {
          streamed += rest
          emit({ type: "text-delta", data: { delta: rest } })
        }
        done = true
        break
      } catch (e) {
        clearTimeout(stallTimer)
        if (signal?.aborted) throw e
        const msg = stall.signal.aborted ? String(stall.signal.reason?.message ?? "stalled") : e instanceof Error ? e.message : String(e)
        console.warn(`[walter] ${c.id} failed: ${msg.slice(0, 160)}`)
        // Once text or tools went out, switching models would duplicate the answer.
        if (produced && stall.signal.aborted) {
          const rest = citations.flush()
          if (rest) {
            streamed += rest
            emit({ type: "text-delta", data: { delta: rest } })
          }
          done = true
          break
        }
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
    const last = all.filter((f) => !("feedback" in f) || f.rows.length).slice(-1)[0]
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
  // Every view the user asked for gets drawn, even if Gemma presented something else (e.g. metrics for "list them in a table").
  const askedVisual = REQUESTED.find(([re]) => re.test(text))?.[1]
  if (askedVisual && !shownVisuals.has(askedVisual)) {
    const fit = all.filter((f) => !("feedback" in f) && pickVisual(text, askedVisual, f) === askedVisual).slice(-1)[0]
    if (fit && !shownFindings.has(fit.id)) renderBlocks([{ type: "visual", findingId: fit.id, visual: askedVisual }])
  }
  all.forEach(sendEvidence)
  all.forEach(sendConflicts)
  // Walter may cite a real record he saw earlier in the conversation; look it up so the chip resolves.
  {
    const cited = [...new Set([...streamed.matchAll(/\[\[([^\]\s]+)\]\]/g)].map((m) => m[1]!))].filter((id) => !evidenceIds.has(id))
    if (cited.length) {
      const snap = await getSnapshot(await getDb(), datasetId)
      const refs: EvidenceRef[] = []
      for (const id of cited) {
        const insp = snap.inspById.get(id)
        const mnt = snap.mntById.get(id)
        const note = snap.notesById.get(id)
        const reg = snap.rows.regEvents.find((e) => e.event_id === id)
        if (insp) refs.push(inspectionRef(datasetId, insp))
        else if (mnt) refs.push(maintenanceRef(datasetId, mnt))
        else if (note) refs.push(noteRef(datasetId, note))
        else if (reg) refs.push(regRef(datasetId, reg))
        else if (snap.wells.has(id)) refs.push(wellRef(datasetId, snap.wells.get(id)!))
      }
      if (refs.length) emit({ type: "data-evidence", data: { findingId: "cited", refs } })
    }
  }

  const allowed = allowedNumbers(
    all,
    [text, ...areas.map((a: any) => a.name ?? a), ...historyMessages.map((m) => String(m.content))].join("\n"),
    ds.today
  )
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
      { type: "parts", parts: kept.map(trimPart) },
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
