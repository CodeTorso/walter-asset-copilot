import { ArrowLeft, Camera, MessageSquareText } from "lucide-react"
import { cn } from "@/lib/utils"
import { sendMessage } from "../send"
import type { FieldWell } from "./data"
import { FLAG_META, STATUS_COLOR, flagsOf, fmtDate, fmtDateTime, isMismatch } from "./data"

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-3">
      <h4 className="mb-2 text-[12.5px] font-semibold text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

export function StatusPill({ status }: { status: FieldWell["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-white px-1.5 py-0.5 text-[12px] font-medium">
      <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {status === "producing" ? "Producing" : status === "not_producing" ? "Not producing" : "Unknown"}
    </span>
  )
}

export function WellDetail({ w, onBack }: { w: FieldWell; onBack: () => void }) {
  const l = w.latest
  const flags = flagsOf(w)
  return (
    <div className="text-[13.5px]">
      <div className="flex items-start gap-2 px-4 pt-3 pb-3">
        <button type="button" onClick={onBack} className="btn-key size-8 shrink-0" aria-label="Back to the overview">
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] leading-tight font-semibold tracking-[-0.01em]">{w.name}</h3>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {w.id} · {w.type} · {w.area}
          </div>
        </div>
        <StatusPill status={w.status} />
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {flags.map((f) => (
            <span key={f} className="inline-flex items-center gap-1.5 rounded-[4px] border px-1.5 py-0.5 text-[12px]" style={{ borderColor: FLAG_META[f].color + "55", color: FLAG_META[f].color, background: FLAG_META[f].color + "0f" }}>
              <span className="size-1.5 rounded-full" style={{ background: FLAG_META[f].color }} />
              {FLAG_META[f].label}
            </span>
          ))}
        </div>
      )}

      <Section title="Latest weekly inspection">
        {l ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Wellhead", Number.isFinite(l.wellhead) ? `${l.wellhead.toFixed(1)} °C` : "–"],
                ["Air", Number.isFinite(l.ambient) ? `${l.ambient.toFixed(1)} °C` : "–"],
                ["Difference", l.delta == null ? "–" : `${l.delta.toFixed(1)} °C`],
              ].map(([k, v], i) => (
                <div key={k} className={cn("rounded-[5px] border border-border bg-[#fafbfc] px-2.5 py-2", i === 2 && w.status === "not_producing" && "border-[#e8c37a] bg-[#fdf6e7]")}>
                  <div className="text-[11.5px] text-muted-foreground">{k}</div>
                  <div data-tnum className="text-[16px] font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
              {w.threshold != null && <>Producing means at least {w.threshold} °C warmer than the air ({w.type} manual). </>}
              Inspected {fmtDateTime(l.at)}
              {l.inspector && <> by {l.inspector}, {l.method}</>}.
            </p>
            {l.notes && <p className="mt-1.5 text-[13px]">“{l.notes}”</p>}
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Camera className="size-3.5" /> No live feed. Wells are inspected weekly; this is the most recent visit.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">No inspections on record.</p>
        )}
      </Section>

      <Section title="Record versus inspection">
        <p>
          The well record says <b className="font-semibold">{w.recordedStatus}</b>; the latest inspection says <b className="font-semibold">{w.status === "producing" ? "producing" : "not producing"}</b>.
          {isMismatch(w) ? " These disagree." : " These agree."}
        </p>
      </Section>

      <Section title={`Spills, last 90 days (${w.spills90.length})`}>
        {w.spills90.length ? (
          <ul className="space-y-1">
            {w.spills90.map((s) => (
              <li key={s.id} className="flex justify-between gap-2">
                <span>{fmtDate(s.at)}</span>
                <span className="text-muted-foreground">{s.bbl == null ? "volume not estimated" : `${s.bbl} bbl`} · {s.id}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">None recorded.</p>
        )}
      </Section>

      <Section title="Open repairs and compliance">
        {w.openRepairs.length + w.openCompliance.length === 0 && <p className="text-muted-foreground">Nothing open.</p>}
        <ul className="space-y-2">
          {w.openRepairs.map((r) => (
            <li key={r.id}>
              <div className="font-medium">{r.issue}</div>
              <div className="text-[12px] text-muted-foreground">Repair {r.id}, open since {fmtDate(r.since)}</div>
            </li>
          ))}
          {w.openCompliance.map((r) => (
            <li key={r.id}>
              <div className="font-medium">{label(r.type)}</div>
              <div className="text-[13px] leading-snug">{r.detail}</div>
              <div className="text-[12px] text-muted-foreground">{r.id}, {fmtDate(r.date)}</div>
            </li>
          ))}
        </ul>
      </Section>

      {w.activeNotes.length > 0 && (
        <Section title="Notes in effect">
          <ul className="space-y-2">
            {w.activeNotes.map((n) => (
              <li key={n.id}>
                <div className="leading-snug">{n.text}</div>
                <div className="text-[12px] text-muted-foreground">
                  {n.author}, {fmtDate(n.at)}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="sticky bottom-0 border-t border-border bg-white/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => sendMessage(`Tell me about ${w.name}. Is it producing right now?`)} className="btn-key btn-ink h-10 w-full text-[14px] font-medium">
          <MessageSquareText className="size-4" /> Ask Walter about {w.name}
        </button>
      </div>
    </div>
  )
}
