// Surface state + builders. Pure TypeScript: safe to import from server or client.
// A "surface" is the A2UI-shaped unit: components (flat, by id) + a JSON data model bound by pointers.
import type { Conflict, EvidenceRef, Feedback, Finding, SurfaceMessage, VisualKind } from "@/contracts"

export type SurfaceComponentDef = {
  id: string
  component: string
  props: Record<string, unknown>
  children?: string[]
}
export type Surface = {
  surfaceId: string
  rootId: string | null
  components: Record<string, SurfaceComponentDef>
  data: Record<string, unknown>
}

export const emptySurface = (surfaceId: string): Surface => ({ surfaceId, rootId: null, components: {}, data: {} })

// ── JSON Pointer ──────────────────────────────────────────────────────────────
const unesc = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~")
export function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return root
  let cur: any = root
  for (const raw of pointer.split("/").slice(1)) {
    if (cur == null) return undefined
    cur = cur[unesc(raw)]
  }
  return cur
}
export function setPointer(root: Record<string, unknown>, pointer: string, value: unknown): Record<string, unknown> {
  if (pointer === "" || pointer === "/") return (value as Record<string, unknown>) ?? {}
  const parts = pointer.split("/").slice(1).map(unesc)
  const next: any = { ...root }
  let cur: any = next
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value
    else {
      cur[p] = Array.isArray(cur[p]) ? [...cur[p]] : { ...(cur[p] ?? {}) }
      cur = cur[p]
    }
  })
  return next
}

/** Apply one server message. Returns the (possibly new) surfaces map; never mutates input. */
export function applySurfaceMessage(surfaces: Record<string, Surface>, msg: SurfaceMessage): Record<string, Surface> {
  if ("createSurface" in msg) {
    const id = msg.createSurface.surfaceId
    return { ...surfaces, [id]: emptySurface(id) }
  }
  if ("deleteSurface" in msg) {
    const { [msg.deleteSurface.surfaceId]: _, ...rest } = surfaces
    return rest
  }
  if ("updateComponents" in msg) {
    const { surfaceId, rootId, components } = msg.updateComponents
    const s = surfaces[surfaceId] ?? emptySurface(surfaceId)
    const map = { ...s.components }
    for (const c of components) map[c.id] = c as SurfaceComponentDef
    return { ...surfaces, [surfaceId]: { ...s, rootId, components: map } }
  }
  if ("updateDataModel" in msg) {
    const { surfaceId, path, value } = msg.updateDataModel
    const s = surfaces[surfaceId] ?? emptySurface(surfaceId)
    return { ...surfaces, [surfaceId]: { ...s, data: setPointer(s.data, path, value) } }
  }
  return surfaces
}

// ── Evidence index (deep walk for EvidenceRef-shaped objects) ─────────────────
export function collectEvidence(value: unknown, out: Map<string, EvidenceRef> = new Map()): Map<string, EvidenceRef> {
  if (Array.isArray(value)) value.forEach((v) => collectEvidence(v, out))
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.kind === "string" && typeof o.id === "string" && typeof o.label === "string" && typeof o.datasetId === "string") {
      out.set(o.id, o as unknown as EvidenceRef)
    }
    for (const v of Object.values(o)) collectEvidence(v, out)
  }
  return out
}

// ── Builders: server composer reuses these to turn a Finding into a surface ───
const bind = (path: string) => ({ path })

export type BuildOptions = {
  surfaceId: string
  visual: VisualKind
  title?: string
  spec?: Partial<Record<string, string | string[]>>
  /** Opt-in: append a full EvidenceList block. Off by default; Walter cites with [[ID]] markers instead. */
  evidenceList?: boolean
  /** Opt-in: render rules and caveats as separate RuleBadge / Callout blocks (old behaviour). Off by default:
   *  the renderer shows them in a collapsed "Details" line under the visual, read from /finding. */
  ruleBlocks?: boolean
}

const keyOf = (f: Finding, types: string[], fallback?: string) => f.columns.find((c) => types.includes(c.type))?.key ?? fallback
const numKeys = (f: Finding) => f.columns.filter((c) => c.type === "number").map((c) => c.key)

/**
 * Finding -> surface. Column conventions (override any of them through opts.spec):
 *  - status_card: Finding.slots keys wellId, wellName, area, wellType, status, delta, threshold, ambient, wellhead,
 *    inspectedAt, inspector, method, recordedStatus, alarmMax, reason.
 *  - line_chart: x = first date/datetime column; series = number columns (except min_ / threshold / limit columns); thresholdKey =
 *    a number column named like min_x, threshold or limit; bandKey = a column named not_producing|band|down (boolean per row).
 *  - bar_chart: label = first well/text column, value = first number column; Finding.ties lists tied row ids (asset_id).
 *  - map: number columns named lat* and lon*; status column drives the pin shape.
 *  - heatmap: first two text columns are row/column dimensions, first number column is the cell value.
 *  - table: Finding.columns/rows/rowEvidence/totalRows as-is.
 */
export function surfaceFromFinding(finding: Finding, opts: BuildOptions): SurfaceMessage[] {
  const { surfaceId, visual } = opts
  const root = "/finding"
  const spec = opts.spec ?? {}
  const comps: Array<{ id: string; component: any; props: Record<string, any>; children?: string[] }> = []
  const kids: string[] = []
  const title = opts.title ?? finding.title
  const rowsBind = bind(`${root}/rows`)
  const colsBind = bind(`${root}/columns`)
  const add = (id: string, component: string, props: Record<string, any>, children?: string[]) => {
    comps.push({ id, component, props, ...(children ? { children } : {}) })
    kids.push(id)
  }

  switch (visual) {
    case "status_card":
      add("main", "StatusCard", { title, slots: bind(`${root}/slots`) })
      break
    case "line_chart": {
      const x = (spec.x as string) ?? keyOf(finding, ["date", "datetime"], finding.columns[0]?.key)
      const series = (spec.series as string[]) ?? numKeys(finding).filter((k) => k !== spec.thresholdKey && !/min_|threshold/.test(k))
      const thresholdKey = (spec.thresholdKey as string) ?? numKeys(finding).find((k) => /min_|threshold|limit/.test(k))
      const bandKey = (spec.bandKey as string) ?? finding.columns.find((c) => /not_producing|band|down/.test(c.key))?.key
      add("main", "LineChart", { title, columns: colsBind, rows: rowsBind, rowEvidence: bind(`${root}/rowEvidence`), x, series, ...(thresholdKey ? { thresholdKey } : {}), ...(bandKey ? { bandKey } : {}), ...(finding.window ? { windowLabel: finding.window.label } : {}) })
      break
    }
    case "bar_chart": {
      const labelKey = (spec.labelKey as string) ?? keyOf(finding, ["well", "text"], finding.columns[0]?.key)
      const valueKey = (spec.valueKey as string) ?? numKeys(finding)[0]
      add("main", "BarChart", { title, columns: colsBind, rows: rowsBind, rowEvidence: bind(`${root}/rowEvidence`), labelKey, valueKey, ties: bind(`${root}/ties`) })
      break
    }
    case "map": {
      const latKey = (spec.latKey as string) ?? finding.columns.find((c) => /^lat/i.test(c.key))?.key ?? "lat"
      const lonKey = (spec.lonKey as string) ?? finding.columns.find((c) => /^(lon|lng)/i.test(c.key))?.key ?? "lon"
      const labelKey = (spec.labelKey as string) ?? keyOf(finding, ["well"], "name")
      const statusKey = (spec.statusKey as string) ?? keyOf(finding, ["status"])
      add("main", "MapPins", { title, columns: colsBind, rows: rowsBind, rowEvidence: bind(`${root}/rowEvidence`), latKey, lonKey, labelKey, ...(statusKey ? { statusKey } : {}) })
      break
    }
    case "heatmap": {
      const t = finding.columns.filter((c) => c.type === "text")
      const rowKey = (spec.rowKey as string) ?? t[0]?.key
      const colKey = (spec.colKey as string) ?? t[1]?.key
      const valueKey = (spec.valueKey as string) ?? numKeys(finding)[0]
      add("main", "Heatmap", { title, columns: colsBind, rows: rowsBind, rowKey, colKey, valueKey })
      break
    }
    case "table":
    case "text":
    default:
      add("main", "DataTable", { title, columns: colsBind, rows: rowsBind, rowEvidence: bind(`${root}/rowEvidence`), totalRows: bind(`${root}/totalRows`) })
  }

  // Only the main visual by default. Rules + caveats live in the renderer's collapsed Details footer (reads /finding).
  if (opts.ruleBlocks) finding.rulesApplied.forEach((_, i) => add(`rule${i}`, "RuleBadge", { rule: bind(`${root}/rulesApplied/${i}`) }))
  finding.conflicts.forEach((_, i) => add(`conflict${i}`, "ConflictCallout", { conflict: bind(`${root}/conflicts/${i}`) }))
  if (opts.ruleBlocks) finding.caveats.forEach((_, i) => add(`caveat${i}`, "Callout", { tone: "info", text: bind(`${root}/caveats/${i}`) }))
  if (opts.evidenceList && finding.evidence.length) add("evidence", "EvidenceList", { refs: bind(`${root}/evidence`) })

  comps.push({ id: "root", component: "Stack", props: {}, children: kids })
  return [
    { createSurface: { surfaceId, catalogId: "app:catalog/v1" } },
    { updateDataModel: { surfaceId, path: root, value: finding } },
    { updateComponents: { surfaceId, rootId: "root", components: comps } },
  ] as SurfaceMessage[]
}

export function surfaceForConflict(surfaceId: string, conflict: Conflict): SurfaceMessage[] {
  return [
    { createSurface: { surfaceId, catalogId: "app:catalog/v1" } },
    { updateDataModel: { surfaceId, path: "/conflict", value: conflict } },
    {
      updateComponents: {
        surfaceId,
        rootId: "root",
        components: [
          { id: "c", component: "ConflictCallout", props: { conflict: bind("/conflict") } },
          { id: "e", component: "EvidenceList", props: { refs: bind("/conflict/refs") } },
          { id: "root", component: "Stack", props: {}, children: ["c", "e"] },
        ],
      },
    },
    { updateDataModel: { surfaceId, path: "/conflict/refs", value: [conflict.subject, ...conflict.sides.map((s) => s.source)] } },
  ] as SurfaceMessage[]
}

export function surfaceForFeedback(surfaceId: string, fb: Feedback, opts: { confirm?: boolean } = {}): SurfaceMessage[] {
  const ids = ["n"]
  const comps: any[] = [{ id: "n", component: "CorrectionNotice", props: { feedback: bind("/feedback") } }]
  if (opts.confirm) {
    comps.push({ id: "a", component: "ConfirmAction", props: { title: "Keep this correction?", description: "It applies to everyone in scope. The original value stays on record.", feedbackId: fb.id, confirmLabel: "Confirm correction", rejectLabel: "Reject" } })
    ids.push("a")
  }
  comps.push({ id: "root", component: "Stack", props: {}, children: ids })
  return [
    { createSurface: { surfaceId, catalogId: "app:catalog/v1" } },
    { updateDataModel: { surfaceId, path: "/feedback", value: fb } },
    { updateComponents: { surfaceId, rootId: "root", components: comps } },
  ] as SurfaceMessage[]
}
