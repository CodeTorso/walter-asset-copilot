// Small blocks: Metric (one big number) and KeyValue (compact definition list). Both accept `cite` ids.
import { cn } from "@/lib/utils"
import { CiteChips } from "./Cite"
import type { SchemaProps } from "./schemas"

type Tone = "neutral" | "ok" | "warn" | "bad" | "fix"
const TONE_TEXT: Record<Tone, string> = { neutral: "text-foreground", ok: "text-(--ok)", warn: "text-(--warn)", bad: "text-(--bad)", fix: "text-(--fix)" }
const TONE_BAR: Record<Tone, string> = { neutral: "bg-border", ok: "bg-(--ok)", warn: "bg-(--warn)", bad: "bg-(--bad)", fix: "bg-(--fix)" }

const fmt = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v)

export function Metric({ label, value, unit, tone = "neutral", caption, cite }: SchemaProps<"Metric">) {
  return (
    <section aria-label={label} className="surface relative flex h-full min-w-0 flex-col gap-1 overflow-hidden px-3.5 pt-3 pb-2.5 max-sm:px-2.5">
      {tone !== "neutral" && <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", TONE_BAR[tone])} />}
      <p className="line-clamp-2 text-[12px] leading-4 font-medium text-muted-foreground">{label}</p>
      <p className={cn("flex items-baseline gap-1 leading-none [font-variant-numeric:lining-nums]", TONE_TEXT[tone])}>
        <span className="text-[28px] font-black tracking-[-0.03em] text-ink max-sm:text-[22px]">{fmt(value)}</span>
        {unit && <span className="text-[13px] font-medium text-muted-foreground">{unit}</span>}
        <CiteChips ids={cite} className="ml-0.5 self-start" />
      </p>
      {caption && <p className="caption mt-auto pt-0.5 text-pretty">{caption}</p>}
    </section>
  )
}

export function KeyValue({ title, items }: SchemaProps<"KeyValue">) {
  return (
    <section aria-label={title ?? "Details"} className="surface overflow-hidden">
      {title && <h3 className="border-b border-border/70 px-3.5 py-2 text-[13px] font-semibold">{title}</h3>}
      <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-6 px-3.5 py-1.5 text-[13px]">
        {items.map((it, i) => (
          <div key={i} className="col-span-2 grid grid-cols-subgrid items-baseline border-b border-border/50 py-1.5 last:border-0">
            <dt className="text-muted-foreground">{it.label}</dt>
            <dd className={cn("min-w-0 font-medium break-words", typeof it.value === "number" && "tnum", TONE_TEXT[(it.tone ?? "neutral") as Tone])}>
              {fmt(it.value)}
              <CiteChips ids={it.cite} className="ml-1" />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
