// Deterministic DiceBear avatars rendered locally (no calls to api.dicebear.com).
// Walter: `croodles` (hand-drawn family) because croodles-neutral has glasses but no hat.
//   top variant20 = pork-pie hat, eyes variant15 = rectangular glasses, beard variant02 = goatee.
// Workers: `croodles-neutral`, the user's chosen style, each with a distinct face and tint.
import { createAvatar } from "@dicebear/core"
import { croodles, croodlesNeutral } from "@dicebear/collection"
import type { WorkerId } from "@/contracts"

export const WALTER_BG = "cfe8f6"

export function walterSvg(opts: { background?: boolean } = {}) {
  return createAvatar(croodles, {
    seed: "walter",
    top: ["variant20"],
    topColor: ["000000"],
    eyes: ["variant15"],
    nose: ["variant02"],
    mouth: ["variant02"],
    face: ["variant01"],
    beard: ["variant02"],
    beardProbability: 100,
    mustacheProbability: 0,
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
