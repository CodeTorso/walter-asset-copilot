/** Stable turn-local UI identity. Reusing a blockId revises it; repeating content is a no-op. */
export class PresentationRegistry {
  private entries = new Map<string, { surfaceId: string; signature: string }>()
  constructor(private prefix: string) {}
  claim(key: string, content: unknown) {
    const signature = JSON.stringify(content), old = this.entries.get(key)
    if (old?.signature === signature) return { ...old, duplicate: true, created: false }
    if (!old && this.entries.size >= 40) throw new Error("Presentation limit reached: revise an existing blockId instead of adding more blocks.")
    const entry = { surfaceId: old?.surfaceId ?? `${this.prefix}-${this.entries.size}`, signature }
    this.entries.set(key, entry)
    return { ...entry, duplicate: false, created: !old }
  }
}

export function turnLimits(env: Record<string, string | undefined>) {
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key]); return Number.isInteger(value) && value >= min && value <= max ? value : fallback
  }
  return { steps: bounded("WALTER_MAX_STEPS", 24, 4, 80), calls: bounded("WALTER_MAX_TOOL_CALLS", 64, 8, 200), durationMs: bounded("WALTER_MAX_TURN_MS", 240000, 30000, 600000) }
}

/** Counts emitted calls even when the provider never finishes its current step. */
export class StreamCallBudget {
  private calls = 0
  constructor(private maxCalls: number) {}
  observe(): string | null {
    return ++this.calls > this.maxCalls ? `Tool-call stream exceeded the budget of ${this.maxCalls} calls.` : null
  }
}
