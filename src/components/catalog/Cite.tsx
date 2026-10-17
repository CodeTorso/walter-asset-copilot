// Citation chips: Walter writes [[ID]] after a sentence; the UI shows a small numbered chip.
// Hover (desktop), focus or tap opens the EvidenceRef behind it. Numbers come from the turn's CitationContext.
import { createContext, useContext, useRef, useState } from "react"
import { CircleHelp, PenLine } from "lucide-react"
import type { EvidenceRef } from "@/contracts"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { kindIcon, kindLabel, useSurfaceActions } from "./shared"

export type Citations = {
  /** Evidence lookup by id (exact, then normalised). */
  lookup: (id: string) => EvidenceRef | undefined
  /** 1-based number by first appearance; undefined if never cited in text. */
  number: (id: string) => number | undefined
}
const empty: Citations = { lookup: () => undefined, number: () => undefined }
export const CitationContext = createContext<Citations>(empty)
export const useCitations = () => useContext(CitationContext)

const norm = (id: string) => id.trim().toUpperCase().replace(/\s*§\s*/g, "#").replace(/\s+/g, "")

export function makeCitations(refs: Iterable<EvidenceRef>, order: string[]): Citations {
  const exact = new Map<string, EvidenceRef>()
  const loose = new Map<string, EvidenceRef>()
  for (const r of refs) {
    if (!exact.has(r.id) || (r.quote && !exact.get(r.id)!.quote)) exact.set(r.id, r)
    if (!loose.has(norm(r.id))) loose.set(norm(r.id), r)
  }
  const nums = new Map<string, number>()
  for (const id of order) if (!nums.has(norm(id))) nums.set(norm(id), nums.size + 1)
  return { lookup: (id) => exact.get(id) ?? loose.get(norm(id)), number: (id) => nums.get(norm(id)) }
}

/** Ids in order of first appearance in markdown text. */
export function citationOrder(texts: string[], pattern: RegExp): string[] {
  const out: string[] = []
  for (const t of texts) for (const m of t.matchAll(new RegExp(pattern.source, "g"))) if (!out.includes(m[1]!)) out.push(m[1]!)
  return out
}

export function EvidencePeek({ id, ev }: { id: string; ev?: EvidenceRef }) {
  if (!ev)
    return (
      <div className="flex items-start gap-2">
        <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-mono text-[12px] break-all">{id}</p>
          <p className="caption mt-0.5">Not in this answer's records.</p>
        </div>
      </div>
    )
  const Icon = kindIcon(ev.kind)
  return (
    <div className="flex items-start gap-2">
      <span className="mt-px grid size-6 shrink-0 place-items-center rounded-[4px] border border-border bg-(--panel)">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 font-medium text-pretty">{ev.label}</p>
        <p className="caption break-words">
          {kindLabel(ev.kind)} · {ev.id}
          {ev.section ? ` · ${ev.section}` : ""}
        </p>
        {ev.quote && <blockquote className="mt-1.5 border-l-2 border-(--cite)/40 pl-2 text-[12.5px] leading-[1.45] text-foreground/80 italic">“{ev.quote}”</blockquote>}
        {ev.overriddenBy && (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-[3px] bg-(--fix-soft) px-1.5 py-0.5 text-[11px] font-medium text-(--fix)">
            <PenLine className="size-3" aria-hidden />
            Corrected by {ev.overriddenBy}
          </p>
        )}
      </div>
    </div>
  )
}

/** One citation chip. `n` overrides the context number (e.g. Metric cites not mentioned in text). */
export function CiteChip({ id, n, className }: { id: string; n?: number; className?: string }) {
  const { lookup, number } = useCitations()
  const { openEvidence } = useSurfaceActions()
  const ev = lookup(id)
  const num = n ?? number(id)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hover = (v: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(v), delay)
  }
  const touch = useRef(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          data-cite={id}
          data-known={ev ? "" : undefined}
          aria-label={ev ? `Source ${num ?? ""}: ${ev.label}` : `Source ${id}, not in this answer's records`}
          aria-expanded={open}
          onPointerDown={(e) => (touch.current = e.pointerType !== "mouse")}
          onPointerEnter={(e) => e.pointerType === "mouse" && hover(true, 120)}
          onPointerLeave={(e) => e.pointerType === "mouse" && hover(false, 160)}
          onFocus={() => !touch.current && setOpen(true)}
          onBlur={() => hover(false, 120)}
          onClick={(e) => {
            e.preventDefault()
            if (touch.current) return setOpen((o) => !o)
            if (ev && open) openEvidence(ev)
            else setOpen(true)
          }}
          className={cn("cite-chip", !ev && "cite-chip-unknown", className)}
        >
          {num ?? (ev ? "•" : "?")}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => hover(true, 0)}
        onPointerLeave={() => hover(false, 160)}
        className="w-[min(340px,calc(100vw-24px))] rounded-[6px] p-3 shadow-(--shadow-pop) ring-border"
      >
        <EvidencePeek id={id} ev={ev} />
      </PopoverContent>
    </Popover>
  )
}

export function CiteChips({ ids, className }: { ids?: string[]; className?: string }) {
  const { number } = useCitations()
  if (!ids?.length) return null
  ids = [...new Set(ids)].sort((a, b) => (number(a) ?? 999) - (number(b) ?? 999))
  return (
    <span className={cn("inline-flex gap-0.5 align-super", className)}>
      {ids.map((id) => (
        <CiteChip key={id} id={id} />
      ))}
    </span>
  )
}
