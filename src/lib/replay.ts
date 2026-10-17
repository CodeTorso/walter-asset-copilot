// Fixture stream replay. Parts follow the contract `data-*` shapes; `data-visual` is a fixture-only convenience that is
// expanded into real surface messages with surfaceFromFinding, so the renderer path is identical to the live one.
import type { Feedback, Finding, StreamDataTypes, SurfaceMessage, VisualKind } from "@/contracts"
import { surfaceForConflict, surfaceForFeedback, surfaceFromFinding } from "@/lib/surface"

export type LivePart =
  | { type: "data-turn"; data: StreamDataTypes["turn"] }
  | { type: "data-delegation"; data: StreamDataTypes["delegation"] }
  | { type: "data-task"; data: StreamDataTypes["task"] }
  | { type: "data-surface"; data: SurfaceMessage }
  | { type: "data-evidence"; data: StreamDataTypes["evidence"] }
  | { type: "data-conflict"; data: StreamDataTypes["conflict"] }
  | { type: "data-feedback"; data: StreamDataTypes["feedback"] }
  | { type: "text"; data: { text: string } }

/** Fixture-only parts get expanded into surface messages; live parts pass through unchanged. */
export function expandPart(part: { type: string; data: any }): LivePart[] {
  if (part.type === "data-visual") {
    const d = part.data as { surfaceId: string; visual: VisualKind; finding: Finding }
    return surfaceFromFinding(d.finding, { surfaceId: d.surfaceId, visual: d.visual }).map((m) => ({ type: "data-surface", data: m }) as LivePart)
  }
  if (part.type === "data-conflict") {
    const id = `S-conflict-${(part.data as any).subject.id}`
    return [part as LivePart, ...surfaceForConflict(id, part.data).map((m) => ({ type: "data-surface", data: m }) as LivePart)]
  }
  if (part.type === "data-feedback" && (part.data as any).record) {
    const fb = (part.data as any).record as Feedback
    return [part as LivePart, ...surfaceForFeedback(`S-fb-${fb.id}`, fb).map((m) => ({ type: "data-surface", data: m }) as LivePart)]
  }
  return [part as LivePart]
}

/** Replays a fixture on timers. Returns a cancel function (Stop button). */
export function replay(parts: { t: number; type: string; data: any }[], onPart: (p: LivePart) => void, onDone?: (cancelled: boolean) => void) {
  const timers: ReturnType<typeof setTimeout>[] = []
  let done = false
  parts.forEach((p, i) => {
    timers.push(
      setTimeout(() => {
        expandPart(p).forEach(onPart)
        if (i === parts.length - 1) {
          done = true
          onDone?.(false)
        }
      }, p.t),
    )
  })
  return () => {
    if (done) return
    timers.forEach(clearTimeout)
    onDone?.(true)
  }
}
