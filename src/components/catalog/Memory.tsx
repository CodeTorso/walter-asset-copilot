import { useState } from "react"
import { motion } from "motion/react"
import { AlertCircle, ArrowRight, BookMarked, CheckCircle2, Check, GitCompareArrows, Info, PenLine, TriangleAlert, X } from "lucide-react"
import type { Conflict } from "@/contracts"
import { cn } from "@/lib/utils"
import { fmtDate } from "@/lib/format"
import { EvidenceChip, StatusBadge, useSurfaceActions, useUserName } from "./shared"
import type { SchemaProps } from "./schemas"

// ── ConflictCallout ───────────────────────────────────────────────────────────
export function ConflictCallout({ conflict }: SchemaProps<"ConflictCallout">) {
  const name = useUserName()
  const two = conflict.sides.length === 2
  return (
    <section aria-label="Sources disagree" className="surface overflow-hidden border-(--warn)/30">
      <header className="flex items-center gap-2 border-b border-border/70 bg-(--warn-soft)/60 px-3 py-2">
        <GitCompareArrows className="size-4 text-(--warn)" aria-hidden />
        <h4 className="text-[13px] font-semibold">Sources disagree</h4>
        <span className="mx-1 text-muted-foreground">·</span>
        <EvidenceChip evidence={conflict.subject} />
      </header>
      <div className={cn("grid gap-px bg-border/70", two ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        {conflict.sides.map((s, i) => (
          <article key={i} className="flex flex-col gap-2 bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <StatusBadge status={s.status} size="sm" />
              <EvidenceChip evidence={s.source} />
            </div>
            <p className={cn("text-[13px] leading-5", s.status === "unconfirmed" && "text-muted-foreground")}>“{s.claim}”</p>
            <p className="caption mt-auto break-words">{s.author ? `${s.author} · ` : ""}{s.source.label}</p>
          </article>
        ))}
      </div>
      <footer className="flex items-center gap-2 border-t border-border/70 bg-(--panel) px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden />
        Not resolved. Both sides stay visible{conflict.needsConfirmationFrom ? <> until <strong className="font-medium text-foreground">{name(conflict.needsConfirmationFrom)}</strong> confirms one.</> : "."}
      </footer>
    </section>
  )
}

// ── CorrectionNotice ──────────────────────────────────────────────────────────
const KIND: Record<string, string> = {
  data_correction: "Data correction",
  analysis_correction: "Analysis correction",
  scoped_rule: "Rule for a scope",
  shared_note: "Shared note",
  status_claim: "Status claim",
}
const scopeText = (t: string, v?: string) => (t === "fleet" ? "Every well in this dataset" : t === "well_type" ? `Every ${v ?? "matching"} well` : `${v ?? "One well"} only`)
const val = (v: unknown) => (v === true ? "yes" : v === false ? "no" : v == null ? "empty" : String(v))

export function CorrectionNotice({ feedback: f }: SchemaProps<"CorrectionNotice">) {
  const name = useUserName()
  const unconfirmed = f.status === "unconfirmed" || f.status === "disputed"
  const hasValues = f.originalValue !== undefined || f.newValue !== undefined
  return (
    <section aria-label={KIND[f.kind] ?? "Correction"} className={cn("surface overflow-hidden", unconfirmed ? "border-dashed border-(--unc)/50" : "border-(--fix)/30")}>
      <header className={cn("flex items-center gap-2 border-b border-border/70 px-3 py-2", unconfirmed ? "bg-(--unc-soft)" : "bg-(--fix-soft)/60")}>
        {unconfirmed ? <AlertCircle className="size-4 text-(--unc)" aria-hidden /> : f.kind === "scoped_rule" ? <BookMarked className="size-4 text-(--fix)" aria-hidden /> : <PenLine className="size-4 text-(--fix)" aria-hidden />}
        <h4 className="text-[13px] font-semibold">{KIND[f.kind] ?? "Correction"}</h4>
        <StatusBadge status={f.status === "applied" ? "corrected" : f.status} label={f.status === "applied" ? "Corrected" : undefined} size="sm" className="ml-auto" />
      </header>
      <div className="space-y-3 p-3">
        {hasValues && (
          <div className="tnum flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">{f.field ? f.field.replaceAll("_", " ") : f.targetId.replaceAll("_", " ")}:</span>
            <span className="rounded-[4px] border border-border bg-muted px-2 py-0.5 text-muted-foreground line-through decoration-muted-foreground/60" aria-label={`Original value ${val(f.originalValue)}`}>{val(f.originalValue)}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="rounded-[4px] border border-(--fix)/30 bg-(--fix-soft) px-2 py-0.5 font-semibold text-(--fix)" aria-label={`Corrected value ${val(f.newValue)}`}>{val(f.newValue)}</span>
          </div>
        )}
        {!hasValues && <p className="text-[13px] leading-5">“{f.text}”</p>}
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Who</dt><dd>{name(f.authorUserId)}<span className="caption"> · {fmtDate(f.createdAt)}</span></dd>
          {f.reason && (<><dt className="text-muted-foreground">Why</dt><dd className="text-pretty">{f.reason}</dd></>)}
          <dt className="text-muted-foreground">Scope</dt><dd>{scopeText(f.scopeType, f.scopeValue)}{f.validTo ? <span className="caption"> · until {fmtDate(f.validTo)}</span> : null}</dd>
          <dt className="text-muted-foreground">Target</dt><dd className="tnum">{f.targetType} {f.targetId}</dd>
        </dl>
      </div>
      <footer className="flex items-center gap-1.5 border-t border-border/70 bg-(--panel) px-3 py-2 text-xs text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        {unconfirmed ? "Kept as a claim. It does not change any record until confirmed." : "The original value stays on record and is shown in the evidence drawer."}
      </footer>
    </section>
  )
}

// ── RuleBadge ─────────────────────────────────────────────────────────────────
export function RuleBadge({ rule, overrideAuthor }: SchemaProps<"RuleBadge">) {
  const over = !!rule.overriddenBy
  return (
    <div className={cn("inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-[4px] border px-2 py-1 text-xs", over ? "border-(--fix)/30 bg-(--fix-soft)" : "border-border bg-(--panel)")}>
      <BookMarked className={cn("size-3.5 shrink-0", over ? "text-(--fix)" : "text-muted-foreground")} aria-hidden />
      <span className="tnum font-medium">{rule.value}</span>
      <span className="text-muted-foreground">
        {over ? `per ${overrideAuthor ?? "a user"}'s rule, not the manual` : rule.source.section ?? rule.source.label}
      </span>
      <EvidenceChip evidence={rule.source} />
    </div>
  )
}

// ── ConfirmAction ─────────────────────────────────────────────────────────────
export function ConfirmAction({ title, description, feedbackId, confirmLabel, rejectLabel, state }: SchemaProps<"ConfirmAction">) {
  const { confirmFeedback, rejectFeedback } = useSurfaceActions()
  const [local, setLocal] = useState<"pending" | "confirmed" | "rejected">(state ?? "pending")
  const s = state ?? local
  return (
    <motion.section layout aria-label="Confirmation needed" className="surface flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{title}</p>
        {description && <p className="caption mt-0.5 max-w-prose text-pretty">{description}</p>}
      </div>
      {s === "pending" ? (
        <div className="flex gap-2">
          <button className="key flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium" onClick={() => { setLocal("rejected"); rejectFeedback(feedbackId) }}><X className="size-3.5" aria-hidden />{rejectLabel ?? "Reject"}</button>
          <button className="key flex items-center gap-1.5 bg-(--ink,#14213d) px-3 py-1.5 text-[13px] font-medium text-white hover:bg-(--ink,#14213d)/90" style={{ background: "#14213d", borderColor: "#14213d", color: "#fff" }} onClick={() => { setLocal("confirmed"); confirmFeedback(feedbackId) }}><Check className="size-3.5" aria-hidden />{confirmLabel ?? "Confirm"}</button>
        </div>
      ) : (
        <p role="status" className={cn("flex items-center gap-1.5 text-[13px] font-medium", s === "confirmed" ? "text-(--ok)" : "text-muted-foreground")}>
          {s === "confirmed" ? <CheckCircle2 className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
          {s === "confirmed" ? "Confirmed" : "Rejected"}
        </p>
      )}
    </motion.section>
  )
}

// ── Callout ───────────────────────────────────────────────────────────────────
const TONES = {
  info: { icon: Info, cls: "border-border bg-(--panel) text-foreground", ic: "text-muted-foreground" },
  warn: { icon: TriangleAlert, cls: "border-(--warn)/30 bg-(--warn-soft) text-foreground", ic: "text-(--warn)" },
  error: { icon: AlertCircle, cls: "border-(--bad)/30 bg-(--bad-soft) text-foreground", ic: "text-(--bad)" },
  success: { icon: CheckCircle2, cls: "border-(--ok)/30 bg-(--ok-soft) text-foreground", ic: "text-(--ok)" },
} as const
export function Callout({ tone, title, text }: SchemaProps<"Callout">) {
  const t = TONES[tone]
  const Icon = t.icon
  return (
    <div role={tone === "error" ? "alert" : "note"} className={cn("flex gap-2 rounded-[6px] border px-3 py-2 text-[13px] leading-5", t.cls)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.ic)} aria-hidden />
      <div className="min-w-0">{title && <p className="font-semibold">{title}</p>}<p className="text-pretty">{text}</p></div>
    </div>
  )
}

// ── FollowUpChips (suggested next questions) ──────────────────────────────────
export function FollowUpChips({ suggestions }: SchemaProps<"FollowUpChips">) {
  const { askFollowup } = useSurfaceActions()
  if (!suggestions.length) return null
  return (
    <div role="group" aria-label="Suggested next questions" className="flex flex-wrap gap-2">
      {suggestions.map((s) => (
        <button key={s} type="button" onClick={() => askFollowup(s)} className="key max-w-full px-2.5 py-1.5 text-left text-[12.5px] leading-4 text-foreground/85">
          {s}
        </button>
      ))}
    </div>
  )
}
export type { Conflict }
