// All dataset dates are UTC ISO strings; these helpers never touch the local time zone.

export function dateOf(iso: string): string {
  return iso.slice(0, 10)
}

function toUtc(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, day!))
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: string, n: number): string {
  const x = toUtc(d)
  x.setUTCDate(x.getUTCDate() + n)
  return fromUtc(x)
}

export function addMonths(d: string, n: number): string {
  const x = toUtc(d)
  const day = x.getUTCDate()
  x.setUTCDate(1)
  x.setUTCMonth(x.getUTCMonth() + n)
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
  x.setUTCDate(Math.min(day, last))
  return fromUtc(x)
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86_400_000)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function fmtDate(d: string, withYear = true): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number)
  return `${day} ${MONTHS[m! - 1]}${withYear ? ` ${y}` : ""}`
}

export function fmtRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  return `${fmtDate(from, !sameYear)} – ${fmtDate(to)}`
}

export function monthKey(d: string): string {
  return d.slice(0, 7)
}

export function addHours(iso: string, h: number): string {
  return new Date(new Date(iso).getTime() + h * 3_600_000).toISOString()
}

export function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(aIso).getTime() - new Date(bIso).getTime()) / 3_600_000
}
