import { useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { Play, RotateCcw, Square } from "lucide-react"
import { z } from "zod"
import type { EvidenceRef, Finding, VisualKind } from "@/contracts"
import { collectEvidence, surfaceFromFinding, surfaceForConflict, type Surface } from "@/lib/surface"
import { useChat } from "@/lib/chat-store"
import { WORKER_ORDER } from "@/lib/workers"
import { findings, fleet, records, states, streams, userNames, proposals } from "@/fixtures"
import { SurfaceRenderer, StatusBadge, type SurfaceActions } from "@/components/catalog"
import { Callout, ConfirmAction, ConflictCallout, CorrectionNotice, EvidenceList, FollowUpChips, RuleBadge } from "@/components/catalog"
import { EvidenceDrawer } from "@/components/lab/EvidenceDrawer"
import { Section, Specimen, surfaceOf } from "@/components/lab/LabParts"
import { CostHistory, DeadlineCountdown, InspectorMix, NoteTimeline, ProposalFrame, RepairStrip, WellDossier } from "@/components/lab/Proposals"
import { BarChart } from "@/components/catalog"
import { cn } from "@/lib/utils"
import { CitationContext, makeCitations } from "@/components/catalog"
import { Markdown } from "@/components/shell/Markdown"
import { OrbView } from "@/components/shell/CallOverlay"
import type { SurfaceMessage } from "@/contracts"

export const Route = createFileRoute("/lab")({
  validateSearch: z.object({ evidence: z.string().optional() }),
  head: () => ({ meta: [{ title: "Component lab" }] }),
  component: Lab,
})

const NAV = [
  ["visuals", "Six visuals"],
  ["blocks", "Blocks and citations"],
  ["states", "States"],
  ["memory", "Evidence and memory"],
  ["stream", "Stream replay"],
  ["safety", "Renderer safety"],
  ["motion", "Motion"],
  ["voice", "Voice orb"],
  ["proposals", "Proposed UIs"],
] as const

const build = (f: Finding, visual: VisualKind, id: string) => surfaceOf(surfaceFromFinding(f, { surfaceId: id, visual }))

function Lab() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/lab" })
  const chat = useChat()
  const ev = useChat((s) => s.evidence)
  const local = useMemo(() => Object.fromEntries(collectEvidence([findings, states])) as Record<string, EvidenceRef>, [])
  const lookup = (id?: string) => (id ? (ev[id] ?? local[id] ?? undefined) : undefined)
  const [openRef, setOpenRef] = useState<EvidenceRef | null>(null)
  const selected = openRef ?? lookup(search.evidence) ?? null

  const actions: SurfaceActions = {
    openEvidence: (r) => { setOpenRef(r); navigate({ search: { evidence: r.id }, replace: true }) },
    confirmFeedback: () => {},
    rejectFeedback: () => {},
    showAs: () => {},
    askFollowup: (t) => { const key = Object.entries(streams).find(([, s]) => s.prompt === t)?.[0]; chat.send(t, key ? streams[key].parts : streams.status.parts) },
  }
  const close = () => { setOpenRef(null); navigate({ search: {}, replace: true }) }

  const S = useMemo(() => {
    const f = findings
    return {
      status: build(f.status, "status_card", "s-status"),
      line: build(f.series, "line_chart", "s-line"),
      bar: build(f.bar, "bar_chart", "s-bar"),
      map: build(f.map, "map", "s-map"),
      heat: build(f.heatmap, "heatmap", "s-heat"),
      table: build(f.tableMaintenance, "table", "s-table"),
      tableIns: build(f.tableInspections, "table", "s-tableins"),
      tableReg: build(f.tableRegulatory, "table", "s-tablereg"),
      empty: build(f.empty, "table", "s-empty"),
      conflict: surfaceOf(surfaceForConflict("s-conf", states.noteConflict)),
    }
  }, [])
  const render = (s: Surface) => <SurfaceRenderer surface={s} actions={actions} users={userNames} />

  // Loading: components exist but their data bindings have not arrived yet.
  const loading: Surface = useMemo(() => ({ surfaceId: "l", rootId: "r", data: {}, components: { r: { id: "r", component: "LineChart", props: { title: "Temperature", columns: { path: "/finding/columns" }, rows: { path: "/finding/rows" }, x: "week", series: ["wellhead_temp_c"] } } } }), [])
  const invalid: Surface = useMemo(() => ({ surfaceId: "i", rootId: "r", data: { f: { rows: [{ a: 1 }] } }, components: { r: { id: "r", component: "BarChart", props: { title: "Broken bar chart", columns: [], rows: { path: "/f/rows" }, labelKey: "a" } } } }), [])
  const unknown: Surface = useMemo(() => ({ surfaceId: "u", rootId: "r", data: {}, components: { r: { id: "r", component: "IframeEmbed", props: { src: "https://example.com" } } } }), [])
  const injected: Surface = useMemo(() => ({ surfaceId: "x", rootId: "r", data: { t: '<img src=x onerror=alert(1)> **bold** <script>alert(2)</script>' }, components: { r: { id: "r", component: "Callout", props: { tone: "warn", title: "Text from data is shown as text", text: { path: "/t" } } } } }), [])

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5">
          <h1 className="text-sm font-semibold">Component lab</h1>
          <a href="/" className="caption underline-offset-2 hover:underline">App shell</a>
          <span className="caption tnum">{fleet.wellCount} wells · dataset sample · as of {states.today}</span>
          <nav aria-label="Lab sections" className="scroll-thin -mx-1 flex min-w-0 gap-1 overflow-x-auto">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="key shrink-0 px-2 py-1 text-xs font-medium whitespace-nowrap">{label}</a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-12 px-4 py-8">
        <Section id="visuals" title="The six graded visuals" desc="Every card below is rendered through the catalog renderer from a Finding built out of real sample rows. Hover a chart, switch Chart/Table, click an evidence chip.">
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen label="Status card" note="one well, now"><div>{render(S.status)}</div></Specimen>
            <Specimen label="Line chart" note="change over time: threshold line + shaded not-producing weeks"><div>{render(S.line)}</div></Specimen>
            <Specimen label="Bar chart" note="compare a few; ties kept"><div>{render(S.bar)}</div></Specimen>
            <Specimen label="Heatmap" note="area × month, single hue, totals"><div>{render(S.heat)}</div></Specimen>
          </div>
          <Specimen label="Map pins" note="MapLibre + OpenFreeMap; plot and list fallbacks"><div>{render(S.map)}</div></Specimen>
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen label="Table: maintenance" note="sortable, sticky header, evidence cells"><div>{render(S.table)}</div></Specimen>
            <Specimen label="Table: inspections" note="status cells carry icon + label"><div>{render(S.tableIns)}</div></Specimen>
          </div>
          <Specimen label="Table: regulator events"><div>{render(S.tableReg)}</div></Specimen>
        </Section>

        <Section id="blocks" title="Small blocks and citations" desc="Metric and KeyValue let an answer say '200 wells' without a 200-row table. Consecutive Metrics in a Stack flow into one row. Walter's markdown cites records with [[ID]] markers, shown as numbered chips; hover, focus or tap to see the record.">
          <BlocksLab actions={actions} local={local} render={render} />
        </Section>

        <Section id="states" title="Empty, loading, error and tie states">
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen label="Loading" note="bindings not yet streamed in"><div>{render(loading)}</div></Specimen>
            <Specimen label="Empty" note="query ran, nothing matched"><div>{render(S.empty)}</div></Specimen>
            <Specimen label="Invalid props" note="schema failure -> safe error card"><div>{render(invalid)}</div></Specimen>
            <Specimen label="Tie" note={`${findings.bar.ties?.length ?? 0} wells share the cutoff`}><div>{render(S.bar)}</div></Specimen>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {(["producing", "breach", "unknown"] as const).map((k) => (
              <Specimen key={k} label={`Status card: ${k}`} note={k === "breach" ? "synthetic state" : k === "unknown" ? "no data" : "real reading"}>
                <div>{render(surfaceOf(surfaceFromFinding({ ...findings.status, conflicts: [], caveats: [], evidence: [], rulesApplied: [], slots: states.statusVariants[k] }, { surfaceId: `sv-${k}`, visual: "status_card" })))}</div>
              </Specimen>
            ))}
          </div>
          <Specimen label="Status badges" note="icon + label, never colour alone">
            <div className="flex flex-wrap gap-2">
              {["producing", "not_producing", "breach", "corrected", "unconfirmed", "disputed", "data"].map((s) => <StatusBadge key={s} status={s} />)}
            </div>
          </Specimen>
        </Section>

        <Section id="memory" title="Evidence and memory" desc="Conflicts keep both sides visible, corrections keep the original, scoped rules say whose rule it is.">
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen label="Evidence list"><EvidenceListDemo actions={actions} /></Specimen>
            <Specimen label="Conflict callout" note="data vs two notes, from real notes"><Wrap actions={actions}><ConflictCallout conflict={states.noteConflict} /></Wrap></Specimen>
            <Specimen label="Conflict: record vs shut-in note"><Wrap actions={actions}><ConflictCallout conflict={findings.status.conflicts[0]} /></Wrap></Specimen>
            <Specimen label="Correction notice: applied"><Wrap actions={actions}><CorrectionNotice feedback={states.feedbackCorrection} /></Wrap></Specimen>
            <Specimen label="Correction notice: unconfirmed claim"><Wrap actions={actions}><CorrectionNotice feedback={states.feedbackClaim} /></Wrap></Specimen>
            <Specimen label="Scoped rule (demo state)" note="synthetic, marked in fixtures"><Wrap actions={actions}><CorrectionNotice feedback={states.feedbackRule} /></Wrap></Specimen>
            <Specimen label="Rule badge: from the manual"><Wrap actions={actions}><RuleBadge rule={states.ruleManual} /></Wrap></Specimen>
            <Specimen label="Rule badge: user's rule overrides"><Wrap actions={actions}><RuleBadge rule={states.ruleUser} overrideAuthor={states.ruleUser.overrideAuthor} /></Wrap></Specimen>
            <Specimen label="Confirm action: pending / confirmed / rejected">
              <div className="space-y-2"><Wrap actions={actions}><ConfirmAction title="Keep this correction?" description="It applies to everyone in scope. The original value stays on record." feedbackId="FB-1" confirmLabel="Confirm correction" /><ConfirmAction title="Correction kept" feedbackId="FB-2" state="confirmed" /><ConfirmAction title="Correction dropped" feedbackId="FB-3" state="rejected" /></Wrap></div>
            </Specimen>
            <Specimen label="Callouts"><div className="space-y-2"><Callout tone="info" text="Weekly inspections only, not live readings." /><Callout tone="warn" title="Window is partial" text="Only 9 of 13 weeks have an inspection." /><Callout tone="error" title="Search failed" text="The document search did not respond. Nothing was changed." /><Callout tone="success" text="Correction recorded. The original value is kept." /></div></Specimen>
            <Specimen label="Follow-up chips" note="end of every answer"><Wrap actions={actions}><FollowUpChips suggestions={["Show the temperature trend for this well", "Which other wells are not producing?", "Open the maintenance history"]} /></Wrap></Specimen>
          </div>
        </Section>

        <Section id="stream" title="Stream replay (fixtures)" desc="Contract data-* parts replayed on timers into the chat store. Workers update from task events. Stop cancels mid-stream and keeps navigation responsive.">
          <StreamLab actions={actions} />
        </Section>

        <Section id="safety" title="Renderer safety" desc="Only allowlisted components render, props are validated against Zod schemas, and text from data is never parsed as HTML.">
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen label="Unknown component"><div>{render(unknown)}</div></Specimen>
            <Specimen label="HTML in data stays text"><div>{render(injected)}</div></Specimen>
          </div>
        </Section>

        <Section id="motion" title="Motion samples" desc="140 to 200 ms entrances, layout animation on state change, soft pulse only while working. All of it collapses under prefers-reduced-motion.">
          <MotionLab />
        </Section>

        <Section id="voice" title="Voice orb" desc="The call floats top-right over the chat instead of taking the screen. The orb follows the live audio level while listening and speaking, swirls while the crew checks, and pulses while ringing. Mute and hang-up appear on hover or focus (always on touch); Esc hangs up.">
          <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
            {([
              ["connecting", "Calling Walter", false, null],
              ["listening", "Listening", false, null],
              ["checking", "Checking with Tess", false, null],
              ["speaking", "Walter is speaking", false, null],
              ["listening", "Muted", true, null],
              ["error", null, false, "Microphone access is blocked. Allow it in the address bar, then call again."],
            ] as const).map(([phase, label, muted, error], i) => (
              <OrbView key={i} phase={phase} label={label} muted={muted} error={error} onMute={() => {}} onHangUp={() => {}} />
            ))}
          </div>
        </Section>

        <Section id="proposals" title="Proposed UIs" desc="Extra views suggested by looking at the data: well metadata, equipment, maintenance cost, regulator events and fines, inspector and method, note validity windows, compliance deadlines. None of these are part of the graded six; they use the same evidence chips and tokens.">
          <div className="space-y-10">
            <ProposalFrame name="Well dossier" why="Operators ask 'tell me about this well'. One card joins metadata, last inspection, equipment and the RCA counter from maintenance rows, so the RCA rule is visible before anyone asks."><WellDossier /></ProposalFrame>
            <ProposalFrame name="Equipment repair strip" why="Maintenance rows are per equipment kind. A timeline per kind shows repeat failures at a glance, which is exactly what the RCA rule counts."><RepairStrip /></ProposalFrame>
            <div className="grid gap-10 lg:grid-cols-2">
              <ProposalFrame name="Maintenance cost history" why="Cost is stored as labor and parts per job. Stacked yearly columns answer 'what did this well cost us' without a table."><CostHistory /></ProposalFrame>
              <ProposalFrame name="Compliance deadline countdown" why="NOV responses (RC-04) and spill verification (SR-03) have deadlines in the SOP text. A countdown with overdue state turns rules into a to-do list."><DeadlineCountdown /></ProposalFrame>
              <ProposalFrame name="Regulator fines by year" why="Regulator events carry fines and status. A bar per year shows the trend using the same BarChart component."><FinesBars /></ProposalFrame>
              <ProposalFrame name="Inspector and method mix" why="Inspections record who and drone vs manual. Workload and method balance is a supervisor question."><InspectorMix /></ProposalFrame>
            </div>
            <ProposalFrame name="Note validity timeline" why="Shared notes have validity windows and expire. A timeline shows which notes still shape answers today and which are open-ended."><NoteTimeline /></ProposalFrame>
          </div>
        </Section>
      </main>

      <EvidenceDrawer evidence={selected} record={selected ? (records[selected.id] ?? null) : null} onClose={close} users={userNames} />
    </div>
  )
}

function Wrap({ children, actions }: { children: React.ReactNode; actions: SurfaceActions }) {
  // Components outside a surface still need the action + user contexts.
  return <ContextShell actions={actions}>{children}</ContextShell>
}
import { ActionsContext, UsersContext } from "@/components/catalog"
function ContextShell({ actions, children }: { actions: SurfaceActions; children: React.ReactNode }) {
  return (
    <ActionsContext.Provider value={actions}>
      <UsersContext.Provider value={userNames}><div className="space-y-2">{children}</div></UsersContext.Provider>
    </ActionsContext.Provider>
  )
}

function EvidenceListDemo({ actions }: { actions: SurfaceActions }) {
  return <Wrap actions={actions}><EvidenceList refs={[...findings.status.evidence, ...findings.tableMaintenance.rowEvidence!.slice(0, 2).flat()]} /></Wrap>
}

function FinesBars() {
  const rows = (proposals.finesByYear as any[]).map((r) => ({ year: r.year, fines: r.fines }))
  return <BarChart title="Fines by year" columns={[{ key: "year", label: "Year", type: "text" }, { key: "fines", label: "Fines", type: "number", unit: "USD" }]} rows={rows.sort((a, b) => a.year.localeCompare(b.year))} labelKey="year" valueKey="fines" order="given" />
}

function StreamLab({ actions }: { actions: SurfaceActions }) {
  const { messages, surfaces, workers, streaming, send, stop, reset } = useChat()
  const keys = Object.keys(streams)
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <div className="space-y-3">
        <div className="surface-flat space-y-1.5 p-2">
          <p className="caption px-1">Replay a question</p>
          {keys.map((k) => (
            <button key={k} disabled={streaming} onClick={() => send(streams[k].prompt, streams[k].parts)} className="key flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs disabled:opacity-50">
              <Play className="size-3 shrink-0" aria-hidden /><span className="truncate"><span className="font-medium">{k}</span></span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={stop} disabled={!streaming} className="key flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium disabled:opacity-40"><Square className="size-3" aria-hidden />Stop</button>
          <button onClick={reset} className="key flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium"><RotateCcw className="size-3" aria-hidden />Clear</button>
        </div>
        <ul aria-label="Workers" className="surface-flat divide-y divide-border/60">
          {WORKER_ORDER.map((id) => {
            const w = workers[id]
            return (
              <li key={id} className="px-3 py-2 text-xs">
                <p className="flex items-center gap-2 font-medium">
                  <span className={cn("size-2 rounded-full", w.status === "working" ? "pulse-soft bg-(--ok)" : w.status === "done" ? "bg-(--ok)" : w.status === "failed" ? "bg-(--bad)" : "bg-muted-foreground/40")} aria-hidden />
                  {w.name}<span className="font-normal text-muted-foreground">{w.status}</span>
                </p>
                {w.currentTask && w.status !== "idle" && <p className="caption mt-0.5 truncate">{w.currentTask.title}</p>}
                {w.progress.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">{w.progress.map((p, i) => <li key={i} className="truncate">· {p.text}</li>)}</ul>}
              </li>
            )
          })}
        </ul>
      </div>
      <div className="surface-flat min-h-80 space-y-4 p-4" aria-live="polite">
        {messages.length === 0 && <p className="caption py-16 text-center">Pick a question to replay. Parts arrive on timers like the live stream will.</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("space-y-3", m.role === "user" && "flex justify-end")}>
            {m.role === "user" ? (
              <p className="max-w-[80%] rounded-[8px] rounded-br-[3px] bg-[#f3f3f3] px-3.5 py-2.5 text-[13px] text-ink">{m.items[0].kind === "text" && m.items[0].text}</p>
            ) : (
              m.items.map((it, i) => (
                <div key={i}>
                  {it.kind === "delegation" && <p className="text-[13px] text-muted-foreground italic">{it.line}</p>}
                  {it.kind === "text" && <p className="max-w-prose text-[13.5px] leading-5 text-pretty">{it.text}</p>}
                  {it.kind === "notice" && <Callout tone={it.tone === "failed" ? "error" : "warn"} text={it.text} />}
                  {it.kind === "surface" && surfaces[it.surfaceId] && <SurfaceRenderer surface={surfaces[it.surfaceId]} actions={actions} users={userNames} />}
                </div>
              ))
            )}
          </div>
        ))}
        {!streaming && messages.at(-1)?.role === "assistant" && <FollowUpDemo actions={actions} />}
      </div>
    </div>
  )
}
function FollowUpDemo({ actions }: { actions: SurfaceActions }) {
  return <Wrap actions={actions}><FollowUpChips suggestions={[streams.series.prompt, streams.bar.prompt, streams.heatmap.prompt]} /></Wrap>
}

function MotionLab() {
  const [on, setOn] = useState(false)
  const [n, setN] = useState(0)
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Specimen label="Entrance 160 ms"><div className="surface-flat flex h-28 items-center justify-center"><button className="key px-3 py-1.5 text-xs font-medium" onClick={() => setN((x) => x + 1)}>Add card</button>
        <div className="ml-3 flex gap-1"><AnimatePresence>{Array.from({ length: Math.min(n, 4) }).map((_, i) => <motion.span key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="surface block size-8" />)}</AnimatePresence></div></div></Specimen>
      <Specimen label="Layout change on worker state"><div className="surface-flat flex h-28 items-center justify-center p-3"><motion.button layout transition={{ duration: 0.2 }} onClick={() => setOn((v) => !v)} className={cn("key flex items-center gap-2 px-3 py-2 text-xs font-medium", on && "pb-8")}><span className={cn("size-2 rounded-full bg-(--ok)", on && "pulse-soft")} />Tess {on ? "working: reading 13 inspections" : "idle"}</motion.button></div></Specimen>
      <Specimen label="Pulse only while working"><div className="surface-flat flex h-28 items-center justify-center gap-6 text-xs"><span className="flex items-center gap-2"><span className="pulse-soft size-2.5 rounded-full bg-(--ok)" />working</span><span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-muted-foreground/40" />idle</span></div></Specimen>
    </div>
  )
}

const BLOCKS_MD = `**WELL-0001 is not producing**: 3.2 °C above ambient at the last inspection [[INS-0001-0203]], below the manual's line [[T200#9.3]].

$$
\\Delta T = T_{\\text{wellhead}} - T_{\\text{ambient}} \\ge 15\\,^{\\circ}\\mathrm{C}
$$

| Reading | °C |
|---|--:|
| Wellhead | 25.6 |
| Ambient | 22.4 |

A shut-in note may explain it [[CTX-0001-003]]; an id we don't hold renders muted [[MNT-9999-000]].`

function blocksSurface(): SurfaceMessage[] {
  const id = "s-blocks"
  return [
    { createSurface: { surfaceId: id, catalogId: "app:catalog/v1" } },
    {
      updateComponents: {
        surfaceId: id,
        rootId: "root",
        components: [
          { id: "m1", component: "Metric", props: { label: "Wells in the field", value: 200, caption: "6 areas, 2 types" } },
          { id: "m2", component: "Metric", props: { label: "Not producing now", value: 37, unit: "wells", tone: "warn", cite: ["T200#9.3"] } },
          { id: "m3", component: "Metric", props: { label: "Latest ΔT, WELL-0001", value: 3.2, unit: "°C", tone: "bad", caption: "Rule needs ≥ 15 °C", cite: ["INS-0001-0203"] } },
          { id: "kv", component: "KeyValue", props: { title: "SW-23 Well 001", items: [
            { label: "Type", value: "T200" },
            { label: "Last inspection", value: "15 Oct 2026, drone", cite: ["INS-0001-0203"] },
            { label: "Recorded status", value: "active", tone: "warn" },
            { label: "Note on file", value: "Shut in for planned work", tone: "fix", cite: ["CTX-0001-003"] },
          ] } },
          { id: "root", component: "Stack", props: {}, children: ["m1", "m2", "m3", "kv"] },
        ],
      },
    },
  ] as SurfaceMessage[]
}

function BlocksLab({ actions, local, render }: { actions: SurfaceActions; local: Record<string, EvidenceRef>; render: (s: Surface) => React.ReactNode }) {
  const cites = useMemo(() => makeCitations(Object.values(local), ["INS-0001-0203", "T200#9.3", "CTX-0001-003", "MNT-9999-000"]), [local])
  const surface = useMemo(() => surfaceOf(blocksSurface()), [])
  return (
    <Wrap actions={actions}>
      <CitationContext.Provider value={cites}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen label="Metric row + KeyValue" note="Stack of [Metric, Metric, Metric, KeyValue]"><div>{render(surface)}</div></Specimen>
          <Specimen label="Markdown with citations and LaTeX" note="Fallback only: Walter uses markdown tables and LaTeX when no catalog block fits"><Markdown text={BLOCKS_MD} /></Specimen>
        </div>
      </CitationContext.Provider>
    </Wrap>
  )
}
