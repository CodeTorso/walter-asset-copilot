// Live transport: POST /api/chat streams NDJSON parts; each line goes straight to the store.
// `?transport=fixture` swaps in the recorded-fixture replay (no model quota).
import { useBootstrap } from "./bootstrap"
import { useChatStore, type StreamPart } from "./chat"
import { simulateTurn } from "./simulate"
import { CREDITS } from "@/components/shell/users"

export const transportMode = (): "live" | "fixture" =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("transport") === "fixture" ? "fixture" : "live"

export async function liveTurn(text: string) {
  const store = useChatStore.getState()
  if (store.turn?.phase === "started") return
  const { userId, conversationId } = store.addUserMessage(text)
  const datasetId = useBootstrap.getState().datasetId ?? "sample"
  const emit = (p: StreamPart) => useChatStore.getState().applyPart(p)
  // Local placeholder turn so the UI is busy at once; the server's own "started" replaces it.
  const local = { turnId: `local-${Date.now().toString(36)}`, userId, conversationId, datasetId }
  emit({ type: "data-turn", data: { ...local, phase: "started" } })
  const ctrl = new AbortController()
  useChatStore.getState().setAbort(() => ctrl.abort())
  const finish = (phase: "cancelled" | "failed") => {
    const t = useChatStore.getState().turn
    if (t?.phase === "started") emit({ type: "data-turn", data: { ...local, turnId: t.turnId, phase } })
  }
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, text, datasetId, displayName: CREDITS.find((c) => c.userId === userId)?.name }),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) throw new Error(`chat ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          emit(JSON.parse(line) as StreamPart)
        } catch (e) {
          console.warn("[chat] bad part", e, line.slice(0, 200))
        }
      }
    }
    if (buf.trim()) emit(JSON.parse(buf) as StreamPart)
    // Stream ended without a terminal phase: treat as failed so the composer unlocks.
    finish("failed")
  } catch (e) {
    finish(ctrl.signal.aborted ? "cancelled" : "failed")
    if (!ctrl.signal.aborted) console.warn("[chat] turn failed:", e instanceof Error ? e.message : e)
  }
}

export function startTurn(text: string) {
  if (transportMode() === "fixture") simulateTurn(text)
  else void liveTurn(text)
}

// ── Thread history (GET /api/thread) ───────────────────────────────────────────
type HistoryPart = { type: "text"; text: string } | { type: "finding"; findingId: string; title: string; tool: string }
type HistoryMessage = { id?: string; role: string; parts: HistoryPart[]; createdAt?: string }

export async function loadThread(userId: string) {
  if (transportMode() === "fixture") return
  const s = useChatStore.getState()
  if (s.threads[userId]?.items.length || s.threads[userId]?.loaded) return
  try {
    const ds = useBootstrap.getState().datasetId
    const r = await fetch(`/api/thread?userId=${encodeURIComponent(userId)}${ds ? `&dataset=${encodeURIComponent(ds)}` : ""}`)
    if (!r.ok) throw new Error(`thread ${r.status}`)
    const j = (await r.json()) as { threadId?: string; messages?: HistoryMessage[] }
    useChatStore.getState().hydrateThread(userId, j.threadId ?? null, j.messages ?? [])
  } catch (e) {
    console.warn("[thread] history unavailable:", e instanceof Error ? e.message : e)
    useChatStore.getState().hydrateThread(userId, null, [])
  }
}
