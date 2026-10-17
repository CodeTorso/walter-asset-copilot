// Deterministic DiceBear avatars rendered locally (no calls to api.dicebear.com).
// Everyone uses `croodles-neutral` so Walter and the workers read as one family.
// Walter: rectangular glasses (eyes variant15; Cass has the round pair), calm smile, his own crystal-blue tint.
// A cap overlay was tried and dropped: the neutral style has no head outline, so a hat floats.
import { createAvatar } from "@dicebear/core"
import { croodlesNeutral } from "@dicebear/collection"
import type { WorkerId } from "@/contracts"

export const WALTER_BG = "cfe8f6"

export function walterSvg(opts: { background?: boolean } = {}) {
  return createAvatar(croodlesNeutral, {
    seed: "walter",
    eyes: ["variant15"],
    nose: ["variant02"],
    mouth: ["variant02"],
    backgroundColor: opts.background === false ? [] : [WALTER_BG],
  }).toString()
}

const WORKER_FACE: Record<WorkerId, { eyes: string; mouth: string; nose: string; bg: string }> = {
  field: { eyes: "variant02", mouth: "variant07", nose: "variant03", bg: "fde3c0" },
  maintenance: { eyes: "variant09", mouth: "variant10", nose: "variant05", bg: "d9dde6" },
  compliance: { eyes: "variant14", mouth: "variant04", nose: "variant01", bg: "cdeedb" },
  memory: { eyes: "variant03", mouth: "variant12", nose: "variant07", bg: "f6d6e4" },
}

export function workerSvg(id: WorkerId) {
  const f = WORKER_FACE[id]
  return createAvatar(croodlesNeutral, {
    seed: id,
    eyes: [f.eyes as never],
    mouth: [f.mouth as never],
    nose: [f.nose as never],
    backgroundColor: [f.bg],
  }).toString()
}

const cache = new Map<string, string>()
export function svgDataUri(key: string, make: () => string) {
  let v = cache.get(key)
  if (!v) {
    v = `data:image/svg+xml;utf8,${encodeURIComponent(make())}`
    cache.set(key, v)
  }
  return v
}
