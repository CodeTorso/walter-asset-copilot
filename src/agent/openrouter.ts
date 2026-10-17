import { createOpenRouter } from "@openrouter/ai-sdk-provider"

// OpenRouter routing pinned to the fastest few hosts for a model, chosen from OpenRouter's live
// per-endpoint stats (last 30 min). Only hosts that support tool calling are eligible.
// WALTER_OR_SORT = latency | throughput | e2e (default e2e: time to first token + time to stream 300 tokens).

type Sort = "latency" | "throughput" | "e2e"
type Endpoint = {
  tag?: string
  provider_name?: string
  status?: number
  uptime_last_30m?: number | null
  latency_last_30m?: unknown
  throughput_last_30m?: unknown
  supported_parameters?: string[]
}

const TOP_N = 3
const TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number; slugs: string[] | null }>()

/** p50 from a stats field that may be a number or { p50, p75, ... }. Latency is in ms or s depending on source; normalised to seconds. */
function p50(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : v && typeof v === "object"
        ? (v as Record<string, unknown>).p50
        : null
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

function score(e: Endpoint, sort: Sort): number | null {
  const tput = p50(e.throughput_last_30m)
  let lat = p50(e.latency_last_30m)
  if (lat != null && lat > 50) lat = lat / 1000
  if (sort === "throughput") return tput != null ? -tput : null
  if (sort === "latency") return lat
  return lat != null && tput ? lat + 300 / tput : null
}

export async function fastestProviders(
  model: string,
  sort: Sort,
  apiKey: string
): Promise<string[] | null> {
  const key = `${model}|${sort}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.slugs
  let slugs: string[] | null = null
  try {
    const res = await fetch(
      `https://openrouter.ai/api/v1/models/${model}/endpoints`,
      {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(4000),
      }
    )
    const eps: Endpoint[] = (await res.json())?.data?.endpoints ?? []
    const ranked = eps
      .filter(
        (e) =>
          (e.supported_parameters ?? []).includes("tools") &&
          (e.status ?? 0) === 0 &&
          (e.uptime_last_30m ?? 100) >= 95
      )
      .map((e) => ({
        slug: (e.tag ?? e.provider_name ?? "").split("/")[0]!.toLowerCase(),
        s: score(e, sort),
      }))
      .filter((e): e is { slug: string; s: number } => !!e.slug && e.s != null)
      .sort((a, b) => a.s - b.s)
    const unique = [...new Set(ranked.map((r) => r.slug))].slice(0, TOP_N)
    slugs = unique.length ? unique : null
  } catch {
    slugs = null
  }
  cache.set(key, { at: Date.now(), slugs })
  if (slugs)
    console.info(
      `[walter] openrouter ${model} top ${TOP_N} by ${sort}: ${slugs.join(", ")}`
    )
  return slugs
}

export async function openRouterModel(model: string) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  const sort = (process.env.WALTER_OR_SORT as Sort) || "e2e"
  const top = await fastestProviders(model, sort, apiKey)
  const provider = top
    ? {
        only: top,
        order: top,
        allow_fallbacks: false,
        require_parameters: true,
      }
    : {
        // No live stats: let OpenRouter sort, and push slow hosts to the back.
        sort: sort === "throughput" ? "throughput" : "latency",
        require_parameters: true,
        preferred_min_throughput: { p50: 60 },
        preferred_max_latency: { p50: 1 },
      }
  return {
    id: `openrouter:${model}${top ? ` [${top.join(",")}]` : ` [sort ${provider.sort}]`}`,
    model: createOpenRouter({ apiKey }).chat(model, {
      extraBody: { provider },
      usage: { include: true },
    } as any),
  }
}
