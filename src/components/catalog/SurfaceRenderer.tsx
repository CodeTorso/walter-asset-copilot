import { Component, type ComponentType, type ReactNode } from "react"
import { MotionConfig, motion } from "motion/react"
import { AlertOctagon } from "lucide-react"
import { CatalogComponent } from "@/contracts"
import { resolvePointer, type Surface, type SurfaceComponentDef } from "@/lib/surface"
import { Skeleton } from "@/components/ui/skeleton"
import { Schemas } from "./schemas"
import { ActionsContext, UsersContext, type SurfaceActions } from "./shared"
import { StatusCard } from "./StatusCard"
import { DataTable } from "./DataTable"
import { LineChart } from "./LineChart"
import { BarChart } from "./BarChart"
import { MapPins } from "./MapPins"
import { Heatmap } from "./Heatmap"
import { EvidenceList } from "./Evidence"
import { Callout, ConfirmAction, ConflictCallout, CorrectionNotice, FollowUpChips, RuleBadge } from "./Memory"
import { cn } from "@/lib/utils"

// Allowlist: only these names can render. Anything else becomes a safe error card. No HTML, no dynamic imports.
const REGISTRY: Record<string, ComponentType<any>> = {
  StatusCard, DataTable, LineChart, BarChart, MapPins, Heatmap, EvidenceList, ConflictCallout,
  CorrectionNotice, RuleBadge, ConfirmAction, Callout, FollowUpChips,
}
export const CATALOG_NAMES = CatalogComponent.options

export function SafeErrorCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="alert" className="flex gap-2 rounded-[6px] border border-dashed border-(--bad)/40 bg-(--bad-soft) px-3 py-2 text-[13px]">
      <AlertOctagon className="mt-0.5 size-4 shrink-0 text-(--bad)" aria-hidden />
      <div className="min-w-0"><p className="font-semibold">{title}</p>{detail && <p className="caption mt-0.5 break-words">{detail}</p>}</div>
    </div>
  )
}

class Boundary extends Component<{ name: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : "render failed" } }
  render() {
    return this.state.err ? <SafeErrorCard title={`${this.props.name} could not be shown`} detail={this.state.err} /> : this.props.children
  }
}

const PENDING = Symbol("pending")

function resolveProps(def: SurfaceComponentDef, data: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  let pending = false
  for (const [k, v] of Object.entries(def.props ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && "path" in v) {
      const path = String((v as { path: string }).path)
      const r = resolvePointer(data, path)
      // Pending only while the bound root has not streamed in yet; a missing optional leaf is simply omitted.
      if (r === undefined) { if (resolvePointer(data, "/" + path.split("/")[1]) === undefined) pending = true; continue }
      out[k] = r
    } else out[k] = v
  }
  return { props: out, pending: pending ? PENDING : null }
}

function LoadingBlock({ name }: { name: string }) {
  return (
    <div role="status" aria-label={`Loading ${name}`} className="surface w-full space-y-3 p-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

function Node({ id, surface, depth, index }: { id: string; surface: Surface; depth: number; index: number }) {
  const def = surface.components[id]
  if (!def) return depth === 0 ? null : <SafeErrorCard title="Missing component" detail={`No component with id "${id}" in this surface.`} />
  if (depth > 6) return <SafeErrorCard title="Layout too deep" />
  if (def.component === "Stack" || def.component === "Grid") {
    const parsed = Schemas[def.component].safeParse(def.props ?? {})
    const cols = def.component === "Grid" && parsed.success ? ((parsed.data as { columns?: number }).columns ?? 2) : 1
    return (
      <div
        className={cn(def.component === "Grid" ? "grid gap-3" : "flex flex-col gap-3")}
        style={def.component === "Grid" ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.floor(560 / cols)}px), 1fr))` } : undefined}
      >
        {(def.children ?? []).map((c, i) => <Node key={c} id={c} surface={surface} depth={depth + 1} index={i} />)}
      </div>
    )
  }
  const Cmp = REGISTRY[def.component]
  if (!Cmp || !(def.component in Schemas)) return <SafeErrorCard title="Unknown component" detail={`"${String(def.component).slice(0, 40)}" is not in the catalog.`} />
  const { props, pending } = resolveProps(def, surface.data)
  if (pending) return <LoadingBlock name={def.component} />
  const parsed = (Schemas as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[]; message: string }[] } } }>)[def.component].safeParse(props)
  if (!parsed.success) {
    const issue = parsed.error!.issues[0]
    return <SafeErrorCard title={`${def.component} got invalid data`} detail={`${issue.path.map(String).join(".") || "props"}: ${issue.message}`} />
  }
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, delay: Math.min(index * 0.04, 0.2), ease: [0.2, 0, 0, 1] }} className="min-w-0">
      <Boundary name={def.component}><Cmp {...(parsed.data as object)} /></Boundary>
    </motion.div>
  )
}

/** Render one surface. `users` maps user_id to a display name for author labels. */
export function SurfaceRenderer({ surface, actions, users }: { surface: Surface; actions?: Partial<SurfaceActions>; users?: Record<string, string> }) {
  const base: SurfaceActions = { openEvidence: () => {}, confirmFeedback: () => {}, rejectFeedback: () => {}, showAs: () => {}, askFollowup: () => {}, ...actions }
  if (!surface.rootId) return <LoadingBlock name="answer" />
  return (
    <MotionConfig reducedMotion="user">
      <ActionsContext.Provider value={base}>
        <UsersContext.Provider value={users ?? {}}>
          <Node id={surface.rootId} surface={surface} depth={0} index={0} />
        </UsersContext.Provider>
      </ActionsContext.Provider>
    </MotionConfig>
  )
}
