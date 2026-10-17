import { getDb } from "@/server/db/client"
import { getSnapshot } from "@/server/engine/snapshot"

// Walter's standing brief for a dataset, his AGENTS.md: the shape of the field, the rules from the
// manuals and who is who. It lets him pick the right tool and arguments without exploring first.
// Built from the loaded data, so a new dataset gets its own brief. Cached per dataset version.

const cache = new Map<string, string>()

export async function fieldBrief(datasetId: string): Promise<string> {
  const s = await getSnapshot(await getDb(), datasetId)
  const key = `${datasetId}|${s.version}`
  const hit = cache.get(key)
  if (hit) return hit

  const wells = s.wellList
  const byArea = new Map<string, typeof wells>()
  for (const w of wells) {
    const l = byArea.get(w.area_id) ?? []
    l.push(w)
    byArea.set(w.area_id, l)
  }
  const areaLines = [...byArea.entries()].map(([id, ws]) => {
    const name = s.areas.get(id)?.name ?? id
    const ids = ws.map((w) => w.asset_id).sort()
    const types = [...new Set(ws.map((w) => w.well_type))].join("/")
    return `- ${name}: ${ws.length} wells (${types}), ${ids[0]} to ${ids[ids.length - 1]}`
  })
  const sample = wells.slice(0, 2).map((w) => `${w.asset_id} = "${w.name}"`)

  let latest = ""
  for (const l of s.inspByWell.values()) for (const i of l) if (i.inspected_at > latest) latest = i.inspected_at

  const rules = [...s.rules.values()]
    .filter((r) => r.status === "found")
    .map((r) => `- ${r.label}${r.wellType ? ` (${r.wellType})` : ""}: ${r.value}${r.unit ? ` ${r.unit}` : ""} [${r.docId}${r.section ? `#${r.section}` : ""}]`)

  const people = [...s.users.values()].map((u) => `${u.name} (${u.role.replace(/_/g, " ")})`).join(", ")

  const brief = `Field brief (background so you know where to look; answers still come from tool results):
- ${wells.length} wells in ${byArea.size} areas, inspected weekly; latest inspection ${latest.slice(0, 10) || "unknown"}.
${areaLines.join("\n")}
- Wells have IDs and display names, e.g. ${sample.join(", ")}.
Rules from the manuals and SOPs (use get_rule or the data tools to quote them in an answer):
${rules.join("\n")}
People in the records: ${people}.`
  cache.set(key, brief)
  return brief
}
