// Collapsed "Details" footer under an answer's visual: one line ("Rule: T200 ≥ 15 °C · 2 notes"), expandable.
// Reads rules and caveats from the surface's /finding data model, so the composer emits only the main visual.
import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { BookMarked, ChevronRight, Info } from "lucide-react"
import type { Finding } from "@/contracts"
import { cn } from "@/lib/utils"
import { EvidenceChip } from "./shared"

type Rule = Finding["rulesApplied"][number]

const ruleShort = (r: Rule) => {
  const doc = r.source.id.split("#")[0]
  const prefix = r.source.kind === "manual" && doc && !r.value.includes(doc) ? `${doc} ` : ""
  return `${prefix}${r.value}`
}

export function AnswerDetails({ rules, caveats }: { rules: Rule[]; caveats: string[] }) {
  const [open, setOpen] = useState(false)
  if (!rules.length && !caveats.length) return null
  const parts: string[] = []
  if (rules.length) parts.push(`${rules.length > 1 ? "Rules" : "Rule"}: ${rules.map(ruleShort).join("; ")}`)
  if (caveats.length) parts.push(`${caveats.length} ${caveats.length > 1 ? "notes" : "note"}`)
  return (
    <div className="mt-1.5 text-[12px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex max-w-full items-center gap-1 rounded-[4px] px-1 py-0.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
        <span className="font-medium">Details</span>
        <span aria-hidden>·</span>
        <span className="truncate">{parts.join(" · ")}</span>
        {rules.some((r) => r.overriddenBy) && <span className="ml-1 shrink-0 rounded-[3px] bg-(--fix-soft) px-1 py-px text-[10px] font-medium text-(--fix)">Corrected</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
            <ul className="surface-flat mt-1 space-y-1.5 px-3 py-2">
              {rules.map((r, i) => (
                <li key={`r${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <BookMarked className={cn("size-3.5 shrink-0", r.overriddenBy ? "text-(--fix)" : "text-muted-foreground")} aria-hidden />
                  <span className="font-medium text-foreground">{r.value}</span>
                  <span className="text-muted-foreground">{r.overriddenBy ? `corrected by ${r.overriddenBy}` : (r.source.section ?? r.source.label)}</span>
                  <EvidenceChip evidence={r.source} />
                </li>
              ))}
              {caveats.map((c, i) => (
                <li key={`c${i}`} className="flex items-start gap-2 text-foreground/85">
                  <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="leading-[1.45] text-pretty">{c}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
