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
  | { kind: "notice"; id: string; tone: "cancelled" | "failed"; text: string }

export type Thread = {
  userId: string
  conversationId: string
  items: ChatItem[]
  surfaces: Record<string, Surface>
  evidence: Record<string, EvidenceRef[]> // findingId -> refs
  followUps: string[] // suggestions for the latest completed turn
}

export type TurnState = { turnId: string; userId: string; startedAt: number; phase: "started" | "completed" | "cancelled" | "failed" }

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
  setAbort: (fn: (() => void) | null) => void
  stop: () => void
  applyPart: (part: StreamPart) => void
  reset: (userId?: string) => void
}

const threadFor = (s: ChatStore, userId: string) => s.threads[userId] ?? emptyThread(userId)

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
            if (d.phase !== "completed")
              next = {
                ...next,
                items: [
                  ...next.items,
                  {
                    kind: "notice",
                    id: uid("n"),
                    tone: d.phase === "cancelled" ? "cancelled" : "failed",
                    text: d.phase === "cancelled" ? "Stopped. Nothing after this point was used." : "Walter couldn't finish this answer. Try asking again.",
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
        case "text-delta":
          appendText(part.data.delta, false)
          return
      }
    },
  }
})

export const selectThread = (s: ChatStore) => s.threads[s.userId]
export const selectStreaming = (s: ChatStore) => s.turn?.phase === "started"
