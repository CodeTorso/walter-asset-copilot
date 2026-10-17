import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { EvidenceRef } from "@/contracts"
import { kindIcon, kindLabel } from "@/components/catalog/shared"
import { humanize } from "@/lib/format"

/** Evidence drawer: label, source section/quote, and the raw record fields when the host can supply them. */
export function EvidenceDrawer({ evidence, record, onClose }: { evidence: EvidenceRef | null; record?: Record<string, unknown> | null; onClose: () => void }) {
  const Icon = evidence ? kindIcon(evidence.kind) : null
  return (
    <Sheet open={!!evidence} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {evidence && (
          <>
            <SheetHeader className="border-b border-border/70">
              <p className="caption flex items-center gap-1.5">{Icon && <Icon className="size-3.5" aria-hidden />}{kindLabel(evidence.kind)}</p>
              <SheetTitle className="text-[15px] leading-5">{evidence.label}</SheetTitle>
              <SheetDescription className="tnum">{evidence.id} · dataset {evidence.datasetId}{evidence.section ? ` · ${evidence.section}` : ""}</SheetDescription>
            </SheetHeader>
            <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
              {evidence.quote && (
                <blockquote className="rounded-[4px] border-l-2 border-foreground/30 bg-(--panel) px-3 py-2 text-[13px] leading-5 text-pretty">“{evidence.quote}”</blockquote>
              )}
              {evidence.overriddenBy && <p className="rounded-[4px] border border-(--fix)/30 bg-(--fix-soft) px-3 py-2 text-xs">This record was changed by correction {evidence.overriddenBy}. The original stays on file.</p>}
              {record ? (
                <dl className="tnum divide-y divide-border/60 rounded-[6px] border border-border text-[12.5px]">
                  {Object.entries(record).filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-3 py-1.5">
                      <dt className="text-muted-foreground">{humanize(k)}</dt>
                      <dd className="break-words">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="caption">The full record is fetched by handle in the live app.</p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
