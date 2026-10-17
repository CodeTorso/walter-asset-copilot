import { motion } from "motion/react"
import { AlertTriangle, Clock, Thermometer } from "lucide-react"
import { Artifact, StatusBadge, normalizeStatus } from "./shared"
import { fmtDateTime, fmtNumber } from "@/lib/format"
import type { SchemaProps } from "./schemas"

/** One well, now. Reads Finding slots: status, delta, threshold, ambient, wellhead, inspectedAt, inspector, method, recordedStatus. */
export function StatusCard({ title, slots }: SchemaProps<"StatusCard">) {
  const status = normalizeStatus(slots.status)
  const delta = Number(slots.delta)
  const threshold = Number(slots.threshold)
  const hasGauge = Number.isFinite(delta) && Number.isFinite(threshold) && threshold > 0
  const max = hasGauge ? Math.max(threshold * 2, delta + 4) : 1
  const pct = hasGauge ? Math.min(100, Math.max(2, (Math.max(delta, 0) / max) * 100)) : 0
  const tick = hasGauge ? (threshold / max) * 100 : 0
  const recorded = slots.recordedStatus != null ? normalizeStatus(slots.recordedStatus) : null
  const stale = recorded && status !== "unknown" && recorded !== status
  const above = delta >= threshold
  return (
    <Artifact label={title ?? "Well status"} className="max-w-xl">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg leading-6 font-semibold tracking-[-0.01em]">{String(slots.wellName ?? slots.wellId ?? title ?? "Well")}</h3>
          <p className="caption mt-0.5">
            {[slots.wellId, slots.area, slots.wellType].filter(Boolean).join("  · ")}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {hasGauge && (
        <div className="px-4 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[28px] leading-8 font-semibold tracking-[-0.02em]">
              {fmtNumber(delta, "°C")}
              <span className="ml-1.5 text-[13px] font-normal tracking-normal text-muted-foreground">above ambient</span>
            </p>
            <p className="text-xs text-muted-foreground">rule: at least {fmtNumber(threshold, "°C")}</p>
          </div>
          <div className="relative mt-3 h-2 rounded-full bg-muted" role="img" aria-label={`${delta} degrees above ambient; the producing rule needs at least ${threshold}`}>
            <motion.div
              className="absolute inset-y-0 left-0 origin-left rounded-full"
              style={{ background: status === "breach" ? "var(--bad)" : above ? "var(--ok)" : "var(--warn)", width: `${pct}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            />
            <div className="absolute -top-1 -bottom-1 w-px bg-foreground/70" style={{ left: `${tick}%` }} aria-hidden />
          </div>
          <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${tick}%` }}>{threshold}</span>
          </div>
        </div>
      )}

      {typeof slots.reason === "string" && <p className="px-4 pt-3 text-[13px] leading-5 text-pretty text-muted-foreground">{slots.reason}</p>}

      <dl className="tnum mt-3 grid grid-cols-3 gap-px border-t border-border/70 bg-border/70 text-sm">
        {[
          ["Wellhead", fmtNumber(slots.wellhead, "°C")],
          ["Ambient", fmtNumber(slots.ambient, "°C")],
          ["Alarm limit", slots.alarmMax ? `≤ ${fmtNumber(slots.alarmMax, "°C")}` : "–"],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-2.5">
            <dt className="caption">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {(slots.inspectedAt || slots.inspector) && (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/70 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-3.5" aria-hidden />
          <span>{fmtDateTime(slots.inspectedAt)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Thermometer className="size-3.5" aria-hidden />
          {slots.method ? `${slots.method} inspection` : "Inspection"} by {String(slots.inspector ?? "unknown")}
        </span>
        {stale && (
          <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-(--unc)/50 bg-(--unc-soft) px-1.5 py-0.5 font-medium text-(--unc)">
            <AlertTriangle className="size-3.5" aria-hidden />
            Stale status: record says {String(slots.recordedStatus)}
          </span>
        )}
      </div>
      )}
    </Artifact>
  )
}
