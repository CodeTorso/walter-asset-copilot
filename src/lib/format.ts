// Formatting helpers. Inspection times are UTC; always display them as UTC.
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function fmtNumber(v: unknown, unit?: string, digits = 1): string {
  if (typeof v !== "number" || Number.isNaN(v)) return v == null || v === "" ? "–" : String(v)
  const n = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: digits })
  if (!unit) return n
  if (unit === "USD") return `$${n}`
  return `${n}${/^[°%]/.test(unit) ? "" : " "}${unit}`
}

export function fmtDate(v: unknown): string {
  if (typeof v !== "string" || !v) return "–"
  const d = new Date(v.length <= 10 ? v + "T00:00:00Z" : v)
  if (Number.isNaN(d.getTime())) return v
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
export function fmtDateShort(v: string): string {
  const d = new Date(v.length <= 10 ? v + "T00:00:00Z" : v)
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`
}
export function fmtDateTime(v: unknown): string {
  if (typeof v !== "string" || !v) return "–"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`
}
export function fmtMonth(v: string): string {
  const [y, m] = v.split("-")
  return `${MONTH[Number(m) - 1]} ${y.slice(2)}`
}
export const humanize = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())
export const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : String(n)
