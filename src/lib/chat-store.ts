// Small zustand store: transcript + surfaces + worker state, fed by contract `data-*` parts.
// Live wiring: call `applyPart({ type: "data-task", data })` etc. for each streamed part. Fixture replay uses the same entry point.
import { create } from "zustand"
import { SurfaceMessage, type EvidenceRef, type WorkerId, type WorkerState } from "@/contracts"
import { applySurfaceMessage, collectEvidence, type Surface } from "@/lib/surface"
import { initialWorkers } from "@/lib/workers"
import { replay, type LivePart } from "@/lib/replay"

export type Item =
  | { kind: "text"; text: string }
  | { kind: "delegation"; taskId: string; workerId: WorkerId; line: string }
  | { kind: "surface"; surfaceId: string }
  | { kind: "notice"; tone: "cancelled" | "failed"; text: string }
export type Msg = { id: string; role: "user" | "assistant"; items: Item[]; turnId?: string }

type State = {
  messages: Msg[]
  surfaces: Record<string, Surface>
  workers: Record<WorkerId, WorkerState>
  evidence: Record<string, EvidenceRef>
  streaming: boolean
  cancel: (() => void) | null
  applyPart: (p: LivePart) => void
  send: (prompt: string, parts?: { t: number; type: string; data: any }[]) => void
  stop: () => void
  reset: () => void
}

let n = 0
const lastAssistant = (m: Msg[]) => (m.at(-1)?.role === "assistant" ? m.at(-1)! : null)
const withAssistant = (msgs: Msg[], fn: (a: Msg) => Msg): Msg[] => {
  const a = lastAssistant(msgs)
  if (!a) return [...msgs, fn({ id: `m${++n}`, role: "assistant", items: [] })]
  return [...msgs.slice(0, -1), fn(a)]
}

export const useChat = create<State>((set, get) => ({
  messages: [],
  surfaces: {},
  workers: initialWorkers(),
  evidence: {},
  streaming: false,
  cancel: null,
  applyPart: (p) =>
    set((s) => {
      switch (p.type) {
        case "data-turn":
          if (p.data.phase === "started") return { streaming: true }
          if (p.data.phase === "cancelled") return { streaming: false, messages: withAssistant(s.messages, (a) => ({ ...a, items: [...a.items, { kind: "notice", tone: "cancelled", text: "Stopped. Nothing was changed." }] })) }
          if (p.data.phase === "failed") return { streaming: false, messages: withAssistant(s.messages, (a) => ({ ...a, items: [...a.items, { kind: "notice", tone: "failed", text: "That turn failed before an answer was ready." }] })) }
          return { streaming: false }
        case "data-delegation":
          return { messages: withAssistant(s.messages, (a) => ({ ...a, items: [...a.items, { kind: "delegation", ...p.data }] })) }
        case "data-task": {
          const w = s.workers[p.data.workerId]
          const prog = p.data.progress
          return {
            workers: {
              ...s.workers,
              [p.data.workerId]: {
                ...w,
                status: p.data.status,
                currentTask: p.data.status === "working" || p.data.status === "queued" ? { taskId: p.data.taskId, title: p.data.title, startedAt: w.currentTask?.taskId === p.data.taskId ? w.currentTask.startedAt : new Date().toISOString() } : w.currentTask,
                progress: prog.length ? prog : w.progress,
              },
            },
          }
        }
        case "data-surface": {
          const checked = SurfaceMessage.safeParse(p.data)
          if (!checked.success) {
            // Invalid or non-allowlisted surface message: show a safe error card, never render it.
            const raw = p.data as any
            const sid = String(raw?.updateComponents?.surfaceId ?? raw?.createSurface?.surfaceId ?? raw?.updateDataModel?.surfaceId ?? `invalid-${++n}`)
            const bad: Surface = { surfaceId: sid, rootId: "root", data: {}, components: { root: { id: "root", component: "__invalid__", props: {} } } }
            return { surfaces: { ...s.surfaces, [sid]: bad }, messages: s.surfaces[sid] ? s.messages : withAssistant(s.messages, (a) => ({ ...a, items: [...a.items, { kind: "surface", surfaceId: sid }] })) }
          }
          const msg = checked.data
          const id = ("createSurface" in msg ? msg.createSurface.surfaceId : "updateComponents" in msg ? msg.updateComponents.surfaceId : "updateDataModel" in msg ? msg.updateDataModel.surfaceId : msg.deleteSurface.surfaceId) as string
          const surfaces = applySurfaceMessage(s.surfaces, msg)
          const next: Partial<State> = { surfaces }
          if ("createSurface" in msg) next.messages = withAssistant(s.messages, (a) => ({ ...a, items: [...a.items, { kind: "surface", surfaceId: id }] }))
          if ("updateDataModel" in msg) {
            const found = collectEvidence(msg.updateDataModel.value)
            if (found.size) next.evidence = { ...s.evidence, ...Object.fromEntries(found) }
          }
          return next
        }
        case "data-evidence":
          return { evidence: { ...s.evidence, ...Object.fromEntries(p.data.refs.map((r) => [r.id, r])) } }
        case "text":
          return { messages: withAssistant(s.messages, (a) => ({ ...a, items: [...a.items, { kind: "text", text: p.data.text }] })) }
        default:
          return {}
      }
    }),
  send: (prompt, parts) => {
    get().cancel?.()
    set((s) => ({ messages: [...s.messages, { id: `m${++n}`, role: "user", items: [{ kind: "text", text: prompt }] }], streaming: true }))
    if (!parts) return
    const cancel = replay(parts, (p) => get().applyPart(p), (cancelled) => {
      if (cancelled) {
        get().applyPart({ type: "data-turn", data: { turnId: "cancel", userId: "", conversationId: "", datasetId: "", phase: "cancelled" } })
        set((s) => ({ workers: Object.fromEntries(Object.entries(s.workers).map(([k, w]) => [k, w.status === "working" ? { ...w, status: "failed" as const } : w])) as State["workers"] }))
      }
      set({ cancel: null })
    })
    set({ cancel })
  },
  stop: () => get().cancel?.(),
  reset: () => set({ messages: [], surfaces: {}, workers: initialWorkers(), evidence: {}, streaming: false, cancel: null }),
}))
