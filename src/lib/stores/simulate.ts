// Fixture transport: replays recorded contract-shaped streams (src/fixtures/streams.json) through the
// same store actions the live route will call. Swap for the live transport without touching the UI.
import streams from "@/fixtures/streams.json"
import type { StreamPart } from "./chat"
import { useChatStore } from "./chat"

type Fixture = { prompt: string; parts: Array<{ t: number; type: string; data: any }> }
const FIXTURES = streams as unknown as Record<string, Fixture>

const ROUTES: Array<[RegExp, string]> = [
  [/trend|temperature|series|over time|chart/i, "series"],
  [/downtime|most|rank|top/i, "bar"],
  [/map|where|location|block 8|area/i, "map"],
  [/heat|by month|by area|spills? by/i, "heatmap"],
  [/maintenance|repair|cost|job/i, "table"],
  [/conflict|disagree|block 7|was there/i, "conflict"],
  [/correct|wrong|fix|actually/i, "correction"],
  [/last 7 days|this week|any spills/i, "empty"],
  [/every well in every|compare everything/i, "cancelled"],
  [/report said|reports? say/i, "error"],
]

// Demo-only suggestions shown under fixture answers. The live engine sends Finding.followUps instead.
const FOLLOW_UPS: Record<string, string[]> = {
  status: ["Show its temperature trend", "Any open repairs on this well?", "Who inspected it last?"],
  series: ["When did it stop producing?", "Compare with the area average", "Show it as a table"],
  bar: ["Why was the top well down?", "Show downtime cost", "Only Northeast Block 8"],
  map: ["Which of these are not producing?", "Spills here in the last 90 days", "Show it as a table"],
  heatmap: ["Which month was worst?", "List the spills over 2 bbl", "Any reports filed late?"],
  table: ["Total cost this year", "Which equipment fails most?", "Is an RCA due?"],
  conflict: ["Who should confirm this?", "Show the inspection", "Any other disputed notes?"],
  correction: ["What else changed because of this?", "Undo this correction", "Show the original record"],
  empty: ["What about the last 90 days?", "Spills by area this year"],
}

export function pickFixture(text: string) {
  for (const [re, key] of ROUTES) if (re.test(text) && FIXTURES[key]) return key
  return "status"
}

/** Start a simulated turn for `text`. Returns a cancel function (also registered as the store's abort). */
export function simulateTurn(text: string, opts: { speed?: number } = {}) {
  const store = useChatStore.getState()
  if (store.turn?.phase === "started") return () => {}
  const { userId, conversationId } = store.addUserMessage(text)
  const key = pickFixture(text)
  const fx = FIXTURES[key]
  const speed = opts.speed ?? 1.4
  const turnId = `T-${Date.now().toString(36)}`
  const timers: ReturnType<typeof setTimeout>[] = []
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms * speed))
  const emit = (p: StreamPart) => useChatStore.getState().applyPart(p)
  let end = 0
  let finalTurn = null as Extract<StreamPart, { type: "data-turn" }> | null

  for (const raw of fx.parts) {
    const t = raw.t + 300
    end = Math.max(end, t)
    if (raw.type === "data-turn") {
      const data = { ...raw.data, turnId, userId, conversationId }
      if (data.phase === "started") emit({ type: "data-turn", data })
      else finalTurn = { type: "data-turn", data }
      continue
    }
    if (raw.type === "text") {
      // Stream words as deltas so the UI shows a live answer.
      const words = String(raw.data.text).split(/(?<=\s)/)
      words.forEach((w, i) => at(t + i * 28, () => emit({ type: "text-delta", data: { delta: w } })))
      end = Math.max(end, t + words.length * 28)
      continue
    }
    at(t, () => emit({ type: raw.type, data: raw.data } as StreamPart))
  }
  const ups = FOLLOW_UPS[key]
  const completes = !finalTurn || finalTurn.data.phase === "completed"
  if (ups && completes) at(end + 60, () => emit({ type: "data-followups", data: { suggestions: ups } }))
  const last = finalTurn
  if (last) at(end + 120, () => emit(last))

  const cancel = () => timers.forEach(clearTimeout)
  useChatStore.getState().setAbort(cancel)
  return cancel
}
