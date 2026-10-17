import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { EvidenceChip, kindIcon, kindLabel, useSurfaceActions } from "./shared"
import type { SchemaProps } from "./schemas"

export function EvidenceList({ title, refs }: SchemaProps<"EvidenceList">) {
  const { openEvidence } = useSurfaceActions()
  const [all, setAll] = useState(false)
  const shown = all ? refs : refs.slice(0, 3)
  if (refs.length === 0) {
    return <p className="caption px-1">No records were opened for this answer.</p>
  }
  return (
    <section aria-label={title ?? "Evidence"} className="surface-flat">
      <h4 className="flex items-center justify-between px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {title ?? "Evidence"}
        <span className="tnum rounded-[3px] bg-muted px-1.5 py-px text-[10px]">{refs.length}</span>
      </h4>
      <ul className="px-1 pb-1">
        {shown.map((r) => {
          const Icon = kindIcon(r.kind)
          return (
            <li key={r.kind + r.id}>
              <button
                type="button"
                onClick={() => openEvidence(r)}
                className="flex w-full items-start gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{r.label}</span>
                  <span className="caption block truncate">
                    {kindLabel(r.kind)} · {r.id}
                    {r.section ? ` · ${r.section}` : ""}
                  </span>
                  {r.quote && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-muted-foreground italic">“{r.quote}”</span>}
                </span>
                {r.overriddenBy && <span className="shrink-0 rounded-[3px] bg-(--fix-soft) px-1 py-px text-[10px] font-medium text-(--fix)">Corrected</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {refs.length > 3 && (
        <button onClick={() => setAll((a) => !a)} className="flex w-full items-center justify-center gap-1 border-t border-border/70 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          {all ? "Show fewer" : `Show all ${refs.length}`}
          <ChevronDown className={cn("size-3 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </section>
  )
}

export { EvidenceChip }
