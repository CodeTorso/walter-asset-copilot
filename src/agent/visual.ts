import type { Finding, VisualKind } from "@/contracts"
import { heatmapKeys, pickValueKey } from "@/lib/surface"

const SHAPE_VISUAL: Record<Finding["shape"], VisualKind> = {
  single_entity: "status_card",
  list: "table",
  series: "line_chart",
  ranking: "bar_chart",
  geo: "map",
  matrix: "heatmap",
  scalar: "text",
}

const REQUESTED: [RegExp, VisualKind][] = [
  [/\b(?:plain text|text only|in words|no charts?|without (?:a )?(?:chart|graph))\b/i, "text"],
  [/heat ?map/i, "heatmap"],
  [/\bmap\b/i, "map"],
  [/line chart|line graph/i, "line_chart"],
  [/bar chart|bar graph/i, "bar_chart"],
  [/\btable\b/i, "table"],
  [/status card|\bcard\b/i, "status_card"],
]

/** Validate the agent choice. An incompatible requested view needs more evidence, never a different chart. */
export function pickVisual(
  userText: string,
  modelChoice: VisualKind | undefined,
  f: Finding
): VisualKind | undefined {
  const asked = REQUESTED.filter(([re, visual]) => re.test(userText) && !(visual === "map" && /heat ?map/i.test(userText))).map(([, visual]) => visual)
  const fallback = ["search_documents", "get_rule", "well_context", "recall"].includes(f.tool)
    ? "text" : SHAPE_VISUAL[f.shape]
  const hasLatLon =
    f.columns.some((c) => /lat/i.test(c.key)) &&
    f.columns.some((c) => /lon/i.test(c.key))
  const ok = (v: VisualKind) => {
    if (v === "map") return hasLatLon
    if (v === "heatmap") return !!heatmapKeys(f)
    if (v === "line_chart") return f.shape === "series"
    if (v === "status_card")
      return f.tool === "well_status" && f.rows.length === 1
    if (v === "bar_chart")
      return !!pickValueKey(f) && f.rows.length > 0
    return true
  }
  if (modelChoice) return ok(modelChoice) ? modelChoice : undefined
  if (asked.length) return asked.find(ok)
  return ok(fallback) ? fallback : f.rows.length ? "table" : "text"
}

