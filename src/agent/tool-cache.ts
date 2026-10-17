const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
  return JSON.stringify(value) ?? "null"
}

/** Coalesce concurrent identical calls, retain derived IDs, and explain non-progress. */
export class ToolCallCache {
  private results = new Map<string, Promise<Record<string, unknown>>>()
  private repeats = new Map<string, number>()
  async run(name: string, args: unknown, execute: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const key = `${name}:${canonical(args)}`
    const previous = this.results.get(key)
    if (!previous) {
      const pending = Promise.resolve().then(execute)
      this.results.set(key, pending)
      return pending
    }
    const count = (this.repeats.get(key) ?? 0) + 1
    this.repeats.set(key, count)
    const result = await previous
    return { ...result, cached: true, repeatedCalls: count,
      ...(count >= 3 ? { error: "Repeated identical call makes no progress. The existing result is returned; no new work was performed." } : {}),
      next: "Reuse this findingId. If a different result is needed, change the inputs or operation, inspect another page, retrieve missing evidence, or present the result. Repeating these exact arguments cannot add evidence or fix coverage." }
  }
}
