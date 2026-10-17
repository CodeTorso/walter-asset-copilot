import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Check, CircleDashed, Clock3, Loader2, TriangleAlert } from "lucide-react"
import type { WorkerState } from "@/contracts"
import { WORKER_BY_ID } from "@/lib/brand"
import { cn } from "@/lib/utils"
import { WorkerAvatar } from "@/components/brand/Avatar"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

export const STATUS_META: Record<WorkerState["status"], { label: string; dot: string; text: string; Icon: typeof Check }> = {
  idle: { label: "Idle", dot: "bg-[#b3bdca]", text: "text-muted-foreground", Icon: CircleDashed },
  queued: { label: "Queued", dot: "bg-[#d39b2a]", text: "text-[#8a5a00]", Icon: Clock3 },
  working: { label: "Working", dot: "bg-crystal", text: "text-[#1f6fa6]", Icon: Loader2 },
  done: { label: "Done", dot: "bg-[#1f8a4c]", text: "text-[#17663a]", Icon: Check },
  failed: { label: "Failed", dot: "bg-[#c2281c]", text: "text-[#a1241a]", Icon: TriangleAlert },
}

export function StatusDot({ status, className }: { status: WorkerState["status"]; className?: string }) {
  const m = STATUS_META[status]
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", m.dot, status === "working" && "working-pulse", className)} />
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

export function WorkerDetails({ w }: { w: WorkerState }) {
  const p = WORKER_BY_ID[w.id]
  const m = STATUS_META[w.status]
  return (
    <div className="w-72 text-sm">
      <div className="flex items-center gap-3 border-b border-border px-3.5 py-3">
        <WorkerAvatar id={w.id} size={36} />
        <div className="min-w-0">
          <div className="font-semibold">{p.name}</div>
          <div className="text-xs text-muted-foreground">{p.role}</div>
        </div>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 text-xs font-medium", m.text)}>
          <StatusDot status={w.status} />
          {m.label}
        </span>
      </div>
      <div className="space-y-3 px-3.5 py-3">
        <p className="text-[13px] leading-snug text-muted-foreground">{p.blurb}</p>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Current task</div>
          <div className="text-[13px]">{w.currentTask?.title ?? "Nothing assigned"}</div>
        </div>
        {w.progress.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Progress</div>
            <ol className="space-y-1.5">
              {w.progress.map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug">
                  <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[#1f8a4c]" />
                  <span className="min-w-0 flex-1">
                    {s.text}
                    {s.counts && (
                      <span data-tnum className="ml-1 text-muted-foreground">
                        ({Object.entries(s.counts).map(([k, v]) => `${v} ${k}`).join(", ")})
                      </span>
                    )}
                  </span>
                  <time data-tnum className="shrink-0 text-[11px] text-muted-foreground">{clock(s.at)}</time>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

/** Hover (mouse), keyboard focus and tap all reveal the details popover. */
export function useRevealPopover() {
  const [open, setOpen] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  const anchor = useRef<HTMLButtonElement>(null)
  const clear = () => clearTimeout(t.current)
  useEffect(() => clear, [])
  return {
    open,
    setOpen,
    trigger: {
      ref: anchor,
      onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === "mouse") { clear(); t.current = setTimeout(() => setOpen(true), 120) } },
      onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === "mouse") { clear(); t.current = setTimeout(() => setOpen(false), 160) } },
      onFocus: (e: React.FocusEvent) => { if (e.currentTarget.matches(":focus-visible")) setOpen(true) },
      onBlur: () => { clear(); t.current = setTimeout(() => setOpen(false), 120) },
      onClick: () => setOpen((o) => !o),
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") setOpen(false) },
    },
    content: {
      onInteractOutside: (e: Event) => { if (anchor.current?.contains(e.target as Node)) e.preventDefault() },
      onPointerEnter: () => clear(),
      onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === "mouse") { t.current = setTimeout(() => setOpen(false), 160) } },
    },
  }
}

export function WorkerCard({ w }: { w: WorkerState }) {
  const p = WORKER_BY_ID[w.id]
  const m = STATUS_META[w.status]
  const r = useRevealPopover()
  const line = w.status === "idle" ? p.role : (w.progress.at(-1)?.text ?? w.currentTask?.title ?? m.label)
  return (
    <Popover open={r.open} onOpenChange={r.setOpen}>
      <PopoverAnchor asChild>
        <motion.button
          layout
          type="button"
          {...r.trigger}
          aria-expanded={r.open}
          aria-label={`${p.name}, ${p.role}. ${m.label}${w.currentTask ? `: ${w.currentTask.title}` : ""}`}
          className={cn(
            "tile tile-hover group flex w-full items-center gap-3 p-2.5 text-left",
            w.status === "working" && "border-[#9ccbea] bg-[#fbfdff]",
          )}
        >
          <div className="relative">
            <WorkerAvatar id={w.id} size={40} />
            <span className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-white ring-1 ring-black/10">
              <StatusDot status={w.status} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-semibold tracking-[-0.005em]">{p.name}</span>
              <span className={cn("text-[11.5px] font-medium", m.text)}>{m.label}</span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={line}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.16 }}
                className="truncate text-[12.5px] text-muted-foreground"
              >
                {line}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.button>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        {...r.content}
        className="w-auto rounded-md border border-edge p-0 shadow-[0_1px_0_rgb(16_24_40/.05),0_16px_40px_-12px_rgb(16_24_40/.28)]"
      >
        <WorkerDetails w={w} />
      </PopoverContent>
    </Popover>
  )
}

export function WorkerChip({ w }: { w: WorkerState }) {
  const p = WORKER_BY_ID[w.id]
  const m = STATUS_META[w.status]
  const r = useRevealPopover()
  return (
    <Popover open={r.open} onOpenChange={r.setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          {...r.trigger}
          aria-label={`${p.name}, ${m.label}`}
          className={cn("btn-key h-9 shrink-0 gap-2 py-0 pr-2.5 pl-1", w.status === "working" && "border-[#9ccbea]")}
        >
          <WorkerAvatar id={w.id} size={28} className="rounded-[3px]" />
          <span className="text-[13px] font-semibold">{p.name}</span>
          <StatusDot status={w.status} />
        </button>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="start" sideOffset={8} onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()} {...r.content} className="w-auto rounded-md border border-edge p-0 shadow-[0_16px_40px_-12px_rgb(16_24_40/.28)]">
        <WorkerDetails w={w} />
      </PopoverContent>
    </Popover>
  )
}
