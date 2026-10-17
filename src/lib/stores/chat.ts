// Chat + worker state. The stream (live route or fixture replay) owns nothing in React:
// it calls `useChatStore.getState().applyPart(part)` for every UI message part it receives.
// One continuous thread per user ("simple memory"); switching user swaps threads.
import { create } from "zustand"
import type { Conflict, EvidenceRef, Finding, StreamDataTypes, SurfaceMessage, VisualKind, WorkerId, WorkerState } from "@/contracts"
import { WORKERS } from "@/lib/brand"
import { applySurfaceMessage, surfaceForConflict, surfaceForFeedback, surfaceFromFinding, type Surface } from "@/lib/surface"

export type ChatItem =
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "assistant"; id: string; turnId: string; text: string; streaming: boolean }
  | { kind: "delegation"; id: string; taskId: string; workerId: WorkerId; line: string }
  | { kind: "artifact"; id: string; surfaceId: string; findingId?: string }
  | { kind: "notice"; id: string; tone: "cancelled" | "failed"; text: string; retry?: string }
  /** From history: a past answer's artifact, kept as a title only. */
  | { kind: "past-finding"; id: string; title: string; tool: string }

export type Thread = {
  userId: string
  conversationId: string
  items: ChatItem[]
  surfaces: Record<string, Surface>
  evidence: Record<string, EvidenceRef[]> // findingId -> refs
  followUps: string[] // suggestions for the latest completed turn
  loaded?: boolean // history fetched from /api/thread
}

export type TurnState = { turnId: string; userId: string; startedAt: number; phase: "started" | "completed" | "cancelled" | "failed"; words?: number }

/** Wire parts as delivered by AI SDK UI messages (`data-*`) plus plain text. */
export type StreamPart =
  | { type: "data-turn"; data: StreamDataTypes["turn"] }
  | { type: "data-delegation"; data: StreamDataTypes["delegation"] }
  | { type: "data-task"; data: StreamDataTypes["task"] }
  | { type: "data-surface"; data: SurfaceMessage }
  | { type: "data-evidence"; data: StreamDataTypes["evidence"] }
  | { type: "data-conflict"; data: Conflict }
  | { type: "data-feedback"; data: StreamDataTypes["feedback"] }
  | { type: "data-visual"; data: { surfaceId: string; visual: VisualKind; finding: Finding; title?: string } }
  | { type: "data-followups"; data: { suggestions: string[] } }
  | { type: "text"; data: { text: string } }
  | { type: "text-delta"; data: { delta: string } }

const now = () => new Date().toISOString()
let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

const idleWorkers = (): Record<WorkerId, WorkerState> =>
  Object.fromEntries(
    WORKERS.map((w): [WorkerId, WorkerState] => [w.id, { id: w.id, name: w.name, role: w.role, avatar: `dicebear:${w.id}`, status: "idle", progress: [] }]),
  ) as Record<WorkerId, WorkerState>

const emptyThread = (userId: string): Thread => ({
  userId,
  conversationId: `C-${userId}`,
  items: [],
  surfaces: {},
  evidence: {},
  followUps: [],
})

type ChatStore = {
  userId: string
  threads: Record<string, Thread>
  workers: Record<WorkerId, WorkerState>
  /** Tasks seen this turn, newest last (for the rail's "what happened" history). */
  turn: TurnState | null
  /** Called by the transport so Stop can abort the request. */
  abort: (() => void) | null

  setUser: (userId: string) => void
  addUserMessage: (text: string) => { userId: string; conversationId: string }
  /** Drop the failed turn's leftovers (notice, partial text, cards) so the same question can run again. */
  prepareRetry: () => { userId: string; conversationId: string }
  setAbort: (fn: (() => void) | null) => void
  stop: () => void
  applyPart: (part: StreamPart) => void
  reset: (userId?: string) => void
  /** Seed a user's thread from GET /api/thread (only when nothing local exists yet). */
  hydrateThread: (userId: string, threadId: string | null, messages: HistoryMessage[]) => void
}

const threadFor = (s: ChatStore, userId: string) => s.threads[userId] ?? emptyThread(userId)

export type HistoryPart =
  | { type: "text"; text?: string }
  | { type: "finding"; title?: string; tool?: string; findingId?: string }
  /** Every stream part of the turn except text and task progress, so the cards come back after a reload. */
  | { type: "parts"; parts?: StreamPart[] }
export type HistoryMessage = { id?: string; role: string; parts: HistoryPart[]; createdAt?: string }

/**
 * Rebuild a stored thread. Assistant turns that carry their stream parts get their delegation lines,
 * cards, evidence, conflicts and feedback back, in the same order a live turn shows them
 * (delegations, Walter's words, then the cards). Older messages fall back to a title line.
 */
export function threadFromHistory(base: Thread, messages: HistoryMessage[]): Thread {
  let surfaces = base.surfaces
  let evidence = base.evidence
  let followUps: string[] = []
  const items: ChatItem[] = []
  const addSurfaces = (msgs: SurfaceMessage[], findingId: string | undefined, out: ChatItem[]) => {
    for (const m of msgs) {
      surfaces = applySurfaceMessage(surfaces, m)
      if ("createSurface" in m && !out.some((i) => i.kind === "artifact" && i.surfaceId === m.createSurface.surfaceId))
        out.push({ kind: "artifact", id: uid("ha"), surfaceId: m.createSurface.surfaceId, findingId })
    }
  }
  for (const m of messages) {
    if (m.role === "user") {
      for (const p of m.parts ?? []) if (p.type === "text" && p.text) items.push({ kind: "user", id: uid("hu"), text: p.text, at: m.createdAt ?? now() })
      continue
    }
    if (m.role !== "assistant") continue
    const stream = (m.parts ?? []).find((p): p is Extract<HistoryPart, { type: "parts" }> => p.type === "parts")?.parts ?? []
    const delegations: ChatItem[] = []
    const cards: ChatItem[] = []
    const texts: ChatItem[] = []
    let turnFollowUps: string[] = []
    for (const p of stream) {
      switch (p.type) {
        case "data-delegation":
          delegations.push({ kind: "delegation", id: uid("hd"), taskId: p.data.taskId, workerId: p.data.workerId, line: p.data.line })
          break
        case "data-visual":
          addSurfaces(surfaceFromFinding(p.data.finding, { surfaceId: p.data.surfaceId, visual: p.data.visual, title: p.data.title }), p.data.finding.id, cards)
          evidence = { ...evidence, [p.data.finding.id]: p.data.finding.evidence }
          break
        case "data-surface":
          addSurfaces([p.data], undefined, cards)
          break
        case "data-evidence":
          evidence = { ...evidence, [p.data.findingId]: p.data.refs }
          break
        case "data-conflict":
          addSurfaces(surfaceForConflict(uid("S-conflict"), p.data), undefined, cards)
          break
        case "data-feedback":
          if (p.data.record) addSurfaces(surfaceForFeedback(uid("S-feedback"), p.data.record, { confirm: false }), undefined, cards)
          break
        case "data-followups":
          turnFollowUps = p.data.suggestions
          break
      }
    }
    for (const p of m.parts ?? []) {
      if (p.type === "text" && p.text) texts.push({ kind: "assistant", id: uid("hm"), turnId: "history", text: p.text, streaming: false })
      else if (p.type === "finding" && p.title && !stream.length) cards.push({ kind: "past-finding", id: uid("hf"), title: p.title, tool: p.tool ?? "" })
    }
    items.push(...delegations, ...texts, ...cards)
    followUps = turnFollowUps
  }
  // Follow-up chips belong to the latest answer only.
  const lastIsAssistant = messages.at(-1)?.role === "assistant"
  return { ...base, items, surfaces, evidence, followUps: lastIsAssistant ? followUps : [] }
}

export const useChatStore = create<ChatStore>((set, get) => {
  /** Mutate the thread the current turn belongs to (not necessarily the visible one). */
  const edit = (fn: (t: Thread) => Thread) =>
    set((s) => {
      const uidFor = s.turn?.userId ?? s.userId
      return { threads: { ...s.threads, [uidFor]: fn(threadFor(s, uidFor)) } }
    })
  const push = (item: ChatItem) => edit((t) => ({ ...t, items: [...t.items, item] }))
  const applySurfaces = (msgs: SurfaceMessage[], findingId?: string) =>
    edit((t) => {
      let surfaces = t.surfaces
      let items = t.items
      for (const m of msgs) {
        surfaces = applySurfaceMessage(surfaces, m)
        if ("createSurface" in m && !items.some((i) => i.kind === "artifact" && i.surfaceId === m.createSurface.surfaceId)) {
          items = [...items, { kind: "artifact", id: uid("a"), surfaceId: m.createSurface.surfaceId, findingId }]
        }
      }
      return { ...t, surfaces, items }
    })
  const closeStreamingText = (t: Thread): Thread => ({
    ...t,
    items: t.items.map((i) => (i.kind === "assistant" && i.streaming ? { ...i, streaming: false } : i)),
  })
  const appendText = (text: string, replace: boolean) =>
    edit((t) => {
      const turnId = get().turn?.turnId ?? "T?"
      const at = t.items.findIndex((i) => i.kind === "assistant" && i.turnId === turnId && i.streaming)
      if (at >= 0) {
        const cur = t.items[at] as Extract<ChatItem, { kind: "assistant" }>
        const items = [...t.items]
        items[at] = { ...cur, text: replace ? text : cur.text + text }
        return { ...t, items }
      }
      // Answer first: place Walter's words above this turn's artifacts (after the delegation lines).
      let turnStart = 0
      t.items.forEach((i, k) => i.kind === "user" && (turnStart = k + 1))
      let pos = t.items.findIndex((i, k) => k >= turnStart && i.kind === "artifact")
      if (pos < 0) pos = t.items.length
      const item: ChatItem = { kind: "assistant", id: uid("m"), turnId, text, streaming: true }
      return { ...t, items: [...t.items.slice(0, pos), item, ...t.items.slice(pos)] }
    })

  return {
    userId: "U-201",
    threads: {},
    workers: idleWorkers(),
    turn: null,
    abort: null,

    setUser: (userId) => set({ userId }),
    addUserMessage: (text) => {
      const s = get()
      const t = threadFor(s, s.userId)
      set({
        threads: {
          ...s.threads,
          [s.userId]: { ...t, followUps: [], items: [...t.items, { kind: "user", id: uid("u"), text, at: now() }] },
        },
      })
      return { userId: s.userId, conversationId: t.conversationId }
    },
    prepareRetry: () => {
      const s = get()
      const t = threadFor(s, s.userId)
      let lastUser = -1
      t.items.forEach((i, k) => i.kind === "user" && (lastUser = k))
      set({ threads: { ...s.threads, [s.userId]: { ...t, followUps: [], items: t.items.slice(0, lastUser + 1) } } })
      return { userId: s.userId, conversationId: t.conversationId }
    },
    setAbort: (fn) => set({ abort: fn }),
    stop: () => {
      const { abort, turn } = get()
      abort?.()
      if (turn && turn.phase === "started") {
        get().applyPart({
          type: "data-turn",
          data: { turnId: turn.turnId, userId: turn.userId, conversationId: `C-${turn.userId}`, datasetId: "sample", phase: "cancelled" },
        })
      }
    },
    reset: (userId) =>
      set((s) => {
        const id = userId ?? s.userId
        return { threads: { ...s.threads, [id]: emptyThread(id) }, workers: idleWorkers(), turn: null }
      }),

    hydrateThread: (userId, threadId, messages) =>
      set((s) => {
        const cur = threadFor(s, userId)
        if (cur.items.length) return { threads: { ...s.threads, [userId]: { ...cur, loaded: true } } }
        const next = threadFromHistory(cur, messages)
        return { threads: { ...s.threads, [userId]: { ...next, conversationId: threadId ?? cur.conversationId, loaded: true } } }
      }),

    applyPart: (part) => {
      switch (part.type) {
        case "data-turn": {
          const d = part.data
          if (d.phase === "started") {
            set({ turn: { turnId: d.turnId, userId: d.userId, startedAt: Date.now(), phase: "started" }, workers: idleWorkers() })
            return
          }
          const turn = get().turn
          if (turn?.phase !== "started") return
          edit((t) => {
            let next = closeStreamingText(t)
            const asked = [...t.items].reverse().find((i): i is Extract<ChatItem, { kind: "user" }> => i.kind === "user")?.text
            if (d.phase !== "completed")
              next = {
                ...next,
                items: [
                  ...next.items,
                  {
                    kind: "notice",
                    id: uid("n"),
                    tone: d.phase === "cancelled" ? "cancelled" : "failed",
                    text: d.phase === "cancelled" ? "Stopped. Nothing after this point was used." : "Walter couldn't finish this answer.",
                    ...(asked ? { retry: asked } : {}),
                  },
                ],
              }
            return next
          })
          // Anything still running is cancelled with the turn.
          set((s) => ({
            turn: { ...turn, phase: d.phase },
            abort: null,
            workers: Object.fromEntries(
              Object.entries(s.workers).map(([k, w]) => [
                k,
                w.status === "working" || w.status === "queued" ? { ...w, status: d.phase === "completed" ? "done" : "failed" } : w,
              ]),
            ) as Record<WorkerId, WorkerState>,
          }))
          return
        }
        case "data-delegation": {
          const d = part.data
          push({ kind: "delegation", id: uid("d"), taskId: d.taskId, workerId: d.workerId, line: d.line })
          set((s) => ({
            workers: { ...s.workers, [d.workerId]: { ...s.workers[d.workerId], status: "queued", progress: [], currentTask: { taskId: d.taskId, title: "Waiting to start", startedAt: now() } } },
          }))
          return
        }
        case "data-task": {
          const d = part.data
          set((s) => {
            const w = s.workers[d.workerId]
            return {
              workers: {
                ...s.workers,
                [d.workerId]: {
                  ...w,
                  status: d.status,
                  currentTask: { taskId: d.taskId, title: d.title, startedAt: w.currentTask?.taskId === d.taskId ? w.currentTask.startedAt : now() },
                  progress: d.error ? [...d.progress, { at: now(), text: d.error }] : d.progress,
                },
              },
            }
          })
          return
        }
        case "data-surface":
          applySurfaces([part.data])
          return
        case "data-visual": {
          const { surfaceId, visual, finding, title } = part.data
          applySurfaces(surfaceFromFinding(finding, { surfaceId, visual, title }), finding.id)
          edit((t) => ({
            ...t,
            evidence: { ...t.evidence, [finding.id]: finding.evidence },
            followUps: finding.followUps?.length ? finding.followUps : t.followUps,
          }))
          return
        }
        case "data-evidence":
          edit((t) => ({ ...t, evidence: { ...t.evidence, [part.data.findingId]: part.data.refs } }))
          return
        case "data-conflict":
          applySurfaces(surfaceForConflict(uid("S-conflict"), part.data))
          return
        case "data-feedback": {
          const fb = part.data.record
          if (fb) applySurfaces(surfaceForFeedback(uid("S-feedback"), fb, { confirm: fb.status === "unconfirmed" }))
          else appendText(part.data.summary, false)
          return
        }
        case "data-followups":
          edit((t) => ({ ...t, followUps: part.data.suggestions }))
          return
        case "text":
          appendText(part.data.text, true)
          return
        case "text-delta": {
          appendText(part.data.delta, false)
          const t = get().turn
          const words = (part.data.delta.match(/\S+/g) ?? []).length
          if (t?.phase === "started" && words) set({ turn: { ...t, words: (t.words ?? 0) + words } })
          return
        }
      }
    },
  }
})

export const selectThread = (s: ChatStore) => s.threads[s.userId]
export const selectStreaming = (s: ChatStore) => s.turn?.phase === "started"
