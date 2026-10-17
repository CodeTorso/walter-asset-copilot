import "./catalog.css"
import { createContext, useContext, type ReactNode } from "react"
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FileText,
  Gavel,
  GitCompareArrows,
  MapPin,
  NotebookPen,
  PauseCircle,
  PenLine,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import type { EvidenceRef } from "@/contracts"
import { cn } from "@/lib/utils"

// ── Actions: the allowlist from contracts (open_evidence, confirm_feedback, …) ─
export type SurfaceActions = {
  openEvidence: (ref: EvidenceRef) => void
  confirmFeedback: (feedbackId: string) => void
  rejectFeedback: (feedbackId: string) => void
  showAs: (surfaceId: string, visual: string) => void
  askFollowup: (text: string) => void
}
const noop = () => {}
const defaultActions: SurfaceActions = { openEvidence: noop, confirmFeedback: noop, rejectFeedback: noop, showAs: noop, askFollowup: noop }
export const ActionsContext = createContext<SurfaceActions>(defaultActions)
export const useSurfaceActions = () => useContext(ActionsContext)

// ── User directory (id -> display name), provided by the app; falls back to the id ──
export const UsersContext = createContext<Record<string, string>>({})
export const useUserName = () => {
  const m = useContext(UsersContext)
  return (id?: string | null) => (id ? (m[id] ?? id) : "unknown")
}

// ── Status semantics: always icon + label, never colour alone ─────────────────
export type StatusKey =
  | "producing"
  | "not_producing"
  | "breach"
  | "corrected"
  | "unconfirmed"
  | "disputed"
  | "applied"
  | "data"
  | "unknown"

const STATUS: Record<StatusKey, { label: string; icon: LucideIcon; cls: string }> = {
  producing: { label: "Producing", icon: CheckCircle2, cls: "bg-(--ok-soft) text-(--ok) border-(--ok)/25" },
  not_producing: { label: "Not producing", icon: PauseCircle, cls: "bg-(--warn-soft) text-(--warn) border-(--warn)/30" },
  breach: { label: "Breach", icon: AlertTriangle, cls: "bg-(--bad-soft) text-(--bad) border-(--bad)/25" },
  corrected: { label: "Corrected", icon: PenLine, cls: "bg-(--fix-soft) text-(--fix) border-(--fix)/25" },
  applied: { label: "Applied", icon: PenLine, cls: "bg-(--fix-soft) text-(--fix) border-(--fix)/25" },
  unconfirmed: { label: "Unconfirmed", icon: CircleDashed, cls: "bg-(--unc-soft) text-(--unc) border-dashed border-(--unc)/50" },
  disputed: { label: "Disputed", icon: GitCompareArrows, cls: "bg-(--bad-soft) text-(--bad) border-(--bad)/25" },
  data: { label: "From data", icon: ClipboardList, cls: "bg-muted text-foreground/80 border-border" },
  unknown: { label: "Unknown", icon: CircleDashed, cls: "bg-(--unc-soft) text-(--unc) border-dashed border-(--unc)/50" },
}

export function normalizeStatus(s: unknown): StatusKey {
  const k = String(s ?? "").toLowerCase().replace(/[\s-]+/g, "_")
  return (k in STATUS ? k : k === "active" ? "producing" : k === "down" ? "not_producing" : "unknown") as StatusKey
}

export function StatusBadge({ status, label, className, size = "md" }: { status: StatusKey | string; label?: string; className?: string; size?: "sm" | "md" }) {
  const k = normalizeStatus(status)
  const s = STATUS[k]
  const Icon = s.icon
  return (
    <span
      data-status={k}
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border font-medium leading-none whitespace-nowrap",
        size === "sm" ? "px-1.5 py-[3px] text-[11px]" : "px-2 py-1 text-xs",
        s.cls,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      {label ?? s.label}
    </span>
  )
}
export const statusColor = (k: StatusKey) => ({ producing: "var(--ok)", not_producing: "var(--warn)", breach: "var(--bad)", corrected: "var(--fix)", applied: "var(--fix)", unconfirmed: "var(--unc)", disputed: "var(--bad)", data: "var(--unc)", unknown: "var(--unc)" })[k]

// ── Evidence chip ─────────────────────────────────────────────────────────────
const KIND_ICON: Record<string, LucideIcon> = {
  well: MapPin,
  inspection: ClipboardList,
  maintenance: Wrench,
  report: FileText,
  regulatory_event: Gavel,
  note: NotebookPen,
  feedback: PenLine,
  manual: BookOpen,
  sop: BookOpen,
}
export const kindIcon = (k: string) => KIND_ICON[k] ?? FileText
export const kindLabel = (k: string) => ({ regulatory_event: "Regulator event", sop: "SOP", manual: "Manual" })[k] ?? k.charAt(0).toUpperCase() + k.slice(1)

export function EvidenceChip({ evidence, className, compact }: { evidence: EvidenceRef; className?: string; compact?: boolean }) {
  const { openEvidence } = useSurfaceActions()
  const Icon = kindIcon(evidence.kind)
  return (
    <button
      type="button"
      onClick={() => openEvidence(evidence)}
      title={evidence.label}
      aria-label={`Open evidence: ${evidence.label}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-[4px] border border-border bg-background px-1.5 py-[3px] text-[11px] leading-none text-foreground/80 shadow-[inset_0_1px_0_var(--hairline)] transition-colors hover:border-foreground/30 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        className,
      )}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{compact ? evidence.id : evidence.id}</span>
    </button>
  )
}

// ── Artifact frame ────────────────────────────────────────────────────────────
export function Artifact({ title, subtitle, aside, children, className, label }: { title?: string; subtitle?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label ?? title} className={cn("surface overflow-hidden", className)}>
      {(title || aside) && (
        <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] leading-5 font-semibold tracking-[-0.005em] text-balance">{title}</h3>}
            {subtitle && <p className="caption mt-0.5">{subtitle}</p>}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Legend({ items, className }: { items: { label: string; swatch: ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  )
}
