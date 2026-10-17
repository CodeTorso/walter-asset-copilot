import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Wrench } from "lucide-react"
import type { EvidenceRef } from "@/contracts"
import { cn } from "@/lib/utils"
import { fmtDate, humanize } from "@/lib/format"
import { Artifact, EvidenceChip, Legend, StatusBadge } from "@/components/catalog/shared"
import { proposals, TODAY } from "@/fixtures"

export function ProposalFrame({ name, why, children }: { name: string; why: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-[4px] border border-dashed border-(--fix)/50 bg-(--fix-soft) px-1.5 py-0.5 text-[11px] font-semibold text-(--fix)">Proposal</span>
        <h3 className="text-sm font-semibold">{name}</h3>
      </div>
      <p className="caption max-w-prose text-pretty">{why}</p>
      {children}
    </div>
  )
}

const dayMs = 864e5
const t = (d: string) => Date.parse(d.slice(0, 10) + "T00:00:00Z")

// ── 1. Well dossier ───────────────────────────────────────────────────────────
export function WellDossier() {
  const d = proposals.dossier
  return (
    <Artifact label="Well dossier" className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="text-lg font-semibold tracking-[-0.01em]">{d.well.name}</h3>
          <p className="caption ">{d.well.id} · {d.well.area} · type {d.well.type} · installed {fmtDate(d.well.installedOn)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status="unconfirmed" label={`Record says ${d.well.recordedStatus}`} size="sm" />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-px border-y border-border/70 bg-border/70 sm:grid-cols-4">
        {[
          ["In charge", d.well.inCharge],
          ["Last inspection", fmtDate(d.lastInspection.at)],
          ["Inspector", `${d.lastInspection.inspector}, ${d.lastInspection.method}`],
          ["Open regulator events", String(d.openEvents.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-2.5"><dt className="caption">{k}</dt><dd className="text-[13px] font-medium">{v}</dd></div>
        ))}
      </dl>
      <ul className="divide-y divide-border/60">
        {d.equipment.map((e: any) => (
          <li key={e.equipment_id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] sm:grid-cols-[10rem_1fr_auto]">
            <div className="min-w-0"><p className="font-medium">{humanize(e.kind)}</p><p className="caption truncate">{e.model}</p></div>
            <p className="caption hidden sm:block">{e.last ? `Last job ${fmtDate(e.last.date)}, ${e.last.type}` : "No jobs on record"}</p>
            <div className="flex items-center gap-2" title={`${e.correctiveLast12m} corrective in the last 12 months; the manual requires an RCA at ${d.rcaThreshold}`}>
              <span className="flex gap-0.5" aria-hidden>
                {Array.from({ length: d.rcaThreshold }).map((_, i) => (
                  <span key={i} className={cn("size-2.5 rounded-[2px] border", i < e.correctiveLast12m ? (e.rcaRequired ? "border-(--bad) bg-(--bad)" : "border-(--warn) bg-(--warn)") : "border-border bg-card")} />
                ))}
              </span>
              <span className="text-xs text-muted-foreground">{e.correctiveLast12m}/{d.rcaThreshold}</span>
              {e.rcaRequired && <StatusBadge status="breach" label="RCA due" size="sm" />}
            </div>
          </li>
        ))}
      </ul>
      <p className="caption border-t border-border/70 bg-(--panel) px-4 py-2">Squares count corrective jobs on the same equipment in the 12 months before today; the RCA threshold is read from the manual.</p>
    </Artifact>
  )
}

// ── 2. Equipment repair strip ─────────────────────────────────────────────────
export function RepairStrip() {
  const eq = proposals.dossier.equipment as any[]
  const all = eq.flatMap((e) => e.history.map((h: any) => t(h.date)))
  const min = Math.min(...all), max = Math.max(t(TODAY), ...all)
  const x = (d: string) => ((t(d) - min) / (max - min)) * 100
  const years = [...new Set(all.map((a) => new Date(a).getUTCFullYear()))]
  const maxCost = Math.max(...eq.flatMap((e) => e.history.map((h: any) => h.cost)))
  return (
    <Artifact title="Repair history by equipment" subtitle="Each mark is one maintenance job. Square = corrective, circle = scheduled. Size follows cost." className="w-full">
      <div className="px-4 py-3">
        <div className="relative ml-24 h-4 text-[11px] text-muted-foreground " aria-hidden>
          {years.map((y) => (<span key={y} className="absolute" style={{ left: `${Math.max(0, x(`${y}-01-01`))}%` }}>{y}</span>))}
        </div>
        <ul className="space-y-1.5">
          {eq.map((e) => (
            <li key={e.equipment_id} className="flex items-center gap-2">
              <span className="w-22 shrink-0 truncate text-xs font-medium">{humanize(e.kind)}</span>
              <div className="relative h-6 flex-1 rounded-[3px] bg-muted/60">
                {e.history.map((h: any) => {
                  const size = 7 + (h.cost / maxCost) * 9
                  const corrective = h.type === "corrective"
                  return (
                    <span
                      key={h.id}
                      title={`${h.id} · ${fmtDate(h.date)} · ${h.type} · $${h.cost.toLocaleString("en-US")} · ${h.issue}`}
                      className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2", corrective ? "rounded-[2px] bg-(--bad)" : "rounded-full border-[1.5px] border-(--series-1) bg-card")}
                      style={{ left: `${x(h.date)}%`, width: size, height: size }}
                    />
                  )
                })}
                <span className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${x(TODAY)}%` }} aria-hidden />
              </div>
            </li>
          ))}
        </ul>
        <Legend className="mt-3" items={[
          { label: "Corrective", swatch: <span className="inline-block size-2.5 rounded-[2px] bg-(--bad)" /> },
          { label: "Scheduled", swatch: <span className="inline-block size-2.5 rounded-full border-[1.5px] border-(--series-1)" /> },
          { label: "Today", swatch: <span className="inline-block h-3 w-px bg-foreground/60" /> },
        ]} />
      </div>
    </Artifact>
  )
}

// ── 3. Maintenance cost history ───────────────────────────────────────────────
export function CostHistory() {
  const c = proposals.costHistory
  const max = Math.max(...c.years.map((y: any) => y.labor + y.parts))
  return (
    <Artifact title={`${c.well.name}: maintenance spend by year`} subtitle="Labor and parts, USD" className="w-full">
      <div className="flex items-end gap-4 px-4 pt-4 pb-2" style={{ height: 200 }}>
        {c.years.map((y: any) => {
          const tot = y.labor + y.parts
          return (
            <div key={y.year} className="flex h-full flex-1 flex-col justify-end gap-1" title={`${y.year}: $${tot.toLocaleString("en-US")}`}>
              <span className="text-center text-[11px] font-semibold">${(tot / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K</span>
              <div className="flex flex-col gap-[2px]" style={{ height: `${(tot / max) * 80}%` }}>
                <div className="rounded-t-[4px] bg-(--series-1)" style={{ flex: y.parts }} />
                <div className="bg-(--series-1)/45" style={{ flex: y.labor }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 px-4 text-xs">
        {c.years.map((y: any) => (<div key={y.year} className="flex-1 text-center"><p className="font-medium">{y.year}</p><p className="caption">{y.jobs} jobs, {y.corrective} corrective</p></div>))}
      </div>
      <div className="px-4 py-3"><Legend items={[{ label: "Parts", swatch: <span className="inline-block size-2.5 rounded-[2px] bg-(--series-1)" /> }, { label: "Labor", swatch: <span className="inline-block size-2.5 rounded-[2px] bg-(--series-1)/45" /> }]} /></div>
    </Artifact>
  )
}

// ── 4. Compliance deadline countdown ──────────────────────────────────────────
export function DeadlineCountdown() {
  const rows = proposals.deadlines as any[]
  const status = (d: any) => (d.done ? "done" : d.daysLeft < 0 ? "overdue" : d.daysLeft <= 14 ? "soon" : "ok")
  return (
    <Artifact title="Compliance deadlines" subtitle={`As of ${fmtDate(TODAY)}. Windows come from the SOP text.`} className="w-full">
      <ul className="divide-y divide-border/60">
        {rows.map((d) => {
          const s = status(d)
          const Icon = s === "done" ? CheckCircle2 : s === "overdue" ? ShieldAlert : s === "soon" ? Clock : Clock
          return (
            <li key={d.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5">
              <span className={cn("grid size-8 place-items-center rounded-[4px] border", s === "overdue" ? "border-(--bad)/30 bg-(--bad-soft) text-(--bad)" : s === "soon" ? "border-(--warn)/30 bg-(--warn-soft) text-(--warn)" : s === "done" ? "border-(--ok)/25 bg-(--ok-soft) text-(--ok)" : "border-border bg-muted text-muted-foreground")}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{d.protocol}: {d.label}</p>
                <p className="caption ">{d.wellName} · due {fmtDate(d.due)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={cn("tnum text-[13px] font-semibold", s === "overdue" && "text-(--bad)", s === "soon" && "text-(--warn)")}>
                  {s === "done" ? "Closed" : d.daysLeft < 0 ? `${-d.daysLeft} days overdue` : `${d.daysLeft} days left`}
                </span>
                <EvidenceChip evidence={d.evidence as EvidenceRef} />
              </div>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No open obligations.</li>}
      </ul>
    </Artifact>
  )
}

// ── 5. Inspector and method mix ───────────────────────────────────────────────
export function InspectorMix() {
  const rows = (proposals.inspMix as any[]).sort((a, b) => b.drone + b.manual - (a.drone + a.manual))
  const max = Math.max(...rows.map((r) => r.drone + r.manual))
  return (
    <Artifact title="Who inspected, and how" subtitle="Inspections in the last 12 months, by method" className="w-full">
      <ul className="space-y-1.5 px-4 py-3">
        {rows.map((r) => (
          <li key={r.inspector} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-[13px]">
            <span className="truncate font-medium">{r.inspector}</span>
            <div className="flex h-4 gap-[2px]" style={{ width: `${((r.drone + r.manual) / max) * 100}%` }}>
              <div className="rounded-l-[2px] bg-(--series-1)" style={{ flex: r.drone }} title={`Drone ${r.drone}`} />
              <div className="rounded-r-[4px] bg-(--series-1)/40" style={{ flex: r.manual }} title={`Manual ${r.manual}`} />
            </div>
            <span className="text-right font-semibold">{r.drone + r.manual}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-border/70 px-4 py-2.5"><Legend items={[{ label: "Drone", swatch: <span className="inline-block size-2.5 rounded-[2px] bg-(--series-1)" /> }, { label: "Manual", swatch: <span className="inline-block size-2.5 rounded-[2px] bg-(--series-1)/40" /> }]} /></div>
    </Artifact>
  )
}

// ── 6. Note validity timeline ─────────────────────────────────────────────────
export function NoteTimeline() {
  const notes = proposals.activeNotes as any[]
  const start = Math.min(...notes.map((n) => t(n.from ?? n.createdAt)), t(TODAY) - 30 * dayMs)
  const end = Math.max(...notes.map((n) => (n.to ? t(n.to) : t(TODAY))), t(TODAY)) + 20 * dayMs
  const pos = (ms: number) => ((ms - start) / (end - start)) * 100
  return (
    <Artifact title="Notes still in force" subtitle="Validity windows of shared notes. Open-ended notes run off the right edge." className="w-full">
      <ul className="space-y-2 px-4 py-3">
        {notes.map((n) => {
          const from = t(n.from ?? n.createdAt), to = n.to ? t(n.to) : end
          return (
            <li key={n.id} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-center">
              <div className="min-w-0"><p className="truncate text-[12.5px] font-medium">{n.well}</p><p className="caption truncate">{n.author}</p></div>
              <div className="relative h-6 rounded-[3px] bg-muted/60" title={`${n.text} (${fmtDate(n.from)} to ${n.to ? fmtDate(n.to) : "open"})`}>
                <div className={cn("absolute inset-y-1 rounded-[3px] border", n.to ? "border-(--series-1)/50 bg-(--series-1)/20" : "border-dashed border-(--unc)/50 bg-(--unc-soft)")} style={{ left: `${pos(from)}%`, width: `${Math.max(1.5, pos(to) - pos(from))}%` }} />
                <span className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${pos(t(TODAY))}%` }} aria-hidden />
              </div>
            </li>
          )
        })}
      </ul>
      <p className="caption border-t border-border/70 bg-(--panel) px-4 py-2"><AlertTriangle className="mr-1 -mt-0.5 inline size-3" aria-hidden />Vertical line is today ({fmtDate(TODAY)}). Expired notes drop out of answers automatically.</p>
    </Artifact>
  )
}

export { Wrench }
