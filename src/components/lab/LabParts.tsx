import type { ReactNode } from "react"
import type { SurfaceMessage } from "@/contracts"
import { applySurfaceMessage, type Surface } from "@/lib/surface"
import { cn } from "@/lib/utils"

export const surfaceOf = (msgs: SurfaceMessage[]): Surface => msgs.reduce((acc, m) => applySurfaceMessage(acc, m), {} as Record<string, Surface>)[firstId(msgs)]
const firstId = (msgs: SurfaceMessage[]) => {
  const m = msgs[0] as any
  return (m.createSurface ?? m.updateComponents ?? m.updateDataModel).surfaceId as string
}

export function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-5 border-t border-border pt-8 first:border-0 first:pt-0">
      <div>
        <h2 id={`${id}-h`} className="text-xl font-semibold tracking-[-0.015em]">{title}</h2>
        {desc && <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

export function Specimen({ label, children, className, note }: { label: string; children: ReactNode; className?: string; note?: string }) {
  return (
    <figure className={cn("min-w-0 space-y-2", className)}>
      <figcaption className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {note && <span className="caption">{note}</span>}
      </figcaption>
      {children}
    </figure>
  )
}
