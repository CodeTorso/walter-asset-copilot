import { units } from "./markdown"
import type { DocInput, RuleRow } from "./types"

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
}

function toNum(s: string): number | undefined {
  const w = WORDS[s.toLowerCase()]
  if (w !== undefined) return w
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

type Hit = { value: string; num?: number; docId: string; section: string; quote: string }

/** Find the first unit (paragraph, list item or table row) in the docs where `re` matches. */
function scan(
  docs: DocInput[],
  re: RegExp,
  opts: { unitMust?: RegExp; sectionFirst?: string } = {},
): Hit | null {
  for (const doc of docs) {
    const ordered = opts.sectionFirst
      ? [
          ...doc.sections.filter((s) => s.section === opts.sectionFirst),
          ...doc.sections.filter((s) => s.section !== opts.sectionFirst),
        ]
      : doc.sections
    for (const sec of ordered) {
      for (const u of units(sec.text)) {
        if (opts.unitMust && !opts.unitMust.test(u)) continue
        const m = re.exec(u)
        if (!m) continue
        const raw = m[1] ?? ""
        const num = toNum(raw)
        return {
          value: raw,
          num,
          docId: doc.docId,
          section: sec.section,
          quote: u,
        }
      }
    }
  }
  return null
}

type RuleDef = {
  key: string
  label: string
  unit?: string
  scope: "type" | "fleet"
  find: (docs: DocInput[]) => Hit | null
}

const typeRules: RuleDef[] = [
  {
    key: "producing_delta_c",
    label: "Producing when wellhead minus ambient is at least",
    unit: "°C",
    scope: "type",
    find: (d) =>
      scan(d, /(?:at least|minimum of|no less than|not less than|≥|>=)\s*\**\s*(\d+(?:\.\d+)?)\s*(?:°\s*C|degrees?\s*C(?:elsius)?)\**\s+(?:warmer than|hotter than|above)\s+(?:the\s+)?ambient/i),
  },
  {
    key: "temp_alarm_c",
    label: "Wellhead temperature alarm (must stay at or below)",
    unit: "°C",
    scope: "type",
    find: (d) => scan(d, /(?:at or below|no (?:more|higher) than|not (?:exceed|above)|<=|≤)\s*\**\s*(\d+(?:\.\d+)?)\s*(?:°\s*C|degrees?\s*C)/i),
  },
  {
    key: "pad_shutin_pct",
    label: "Immediate shut-in when a spill covers more than this share of the pad",
    unit: "%",
    scope: "type",
    find: (d) => scan(d, /more than\s+\**\s*(\d+(?:\.\d+)?)\s*%\s+of the pad/i),
  },
  {
    key: "rca_count",
    label: "Corrective events on the same equipment kind that require a root-cause analysis",
    unit: "events",
    scope: "type",
    find: (d) =>
      scan(d, /(\w+)\s+or\s+more\s+\**corrective\**\s+maintenance\s+events?/i) ??
      scan(d, /RCA after\s+(\w+)\s+corrective/i),
  },
  {
    key: "rca_window_months",
    label: "Look-back window for the root-cause analysis count",
    unit: "months",
    scope: "type",
    find: (d) => scan(d, /(\d+)\s+months/i, { unitMust: /root-cause|RCA/i }),
  },
]

const fleetRules: RuleDef[] = [
  {
    key: "sr01_hours",
    label: "SR-01 written notice deadline after discovery",
    unit: "h",
    scope: "fleet",
    find: (d) =>
      scan(d, /within\s+\**(\d+)\s*hours\**\s+of discovery/i, { unitMust: /SR-01/, sectionFirst: "SR-01" }),
  },
  {
    key: "sr01_major_hours",
    label: "SR-01 written notice deadline for a major spill",
    unit: "h",
    scope: "fleet",
    find: (d) =>
      scan(d, /within\s+\**(\d+)\s*hours\**\s+for a major/i, { unitMust: /SR-01/, sectionFirst: "SR-01" }),
  },
  {
    key: "sr02_hours",
    label: "SR-02 containment limit after discovery",
    unit: "h",
    scope: "fleet",
    find: (d) => scan(d, /within\s+\**(\d+)\s*hours/i, { unitMust: /SR-02/, sectionFirst: "SR-02" }),
  },
  {
    key: "sr03_days",
    label: "SR-03 agency verification deadline for reportable and major spills",
    unit: "days",
    scope: "fleet",
    find: (d) => scan(d, /within\s+\**(\d+)\s*days/i, { unitMust: /SR-03/, sectionFirst: "SR-03" }),
  },
  {
    key: "spill_class_moderate_bbl",
    label: "Moderate spill class starts at",
    unit: "bbl",
    scope: "fleet",
    find: (d) => scan(d, /^\|\s*Moderate\s*\|\s*(\d+(?:\.\d+)?)\s*bbl/i),
  },
  {
    key: "spill_class_reportable_bbl",
    label: "Reportable spill class starts at",
    unit: "bbl",
    scope: "fleet",
    find: (d) => scan(d, /^\|\s*Reportable\s*\|\s*(\d+(?:\.\d+)?)\s*bbl/i),
  },
  {
    key: "spill_class_major_bbl",
    label: "Major spill class starts at",
    unit: "bbl",
    scope: "fleet",
    find: (d) => scan(d, /^\|\s*Major\s*\|\s*(\d+(?:\.\d+)?)\s*bbl/i),
  },
  {
    key: "rc01_days",
    label: "RC-01 maximum days between inspections",
    unit: "days",
    scope: "fleet",
    find: (d) => scan(d, /once every\s+\**(\d+)\s*days/i, { unitMust: /RC-01/, sectionFirst: "RC-01" }),
  },
  {
    key: "rc02_issue_text",
    label: "RC-02 annual flowline test is recorded as issue",
    scope: "fleet",
    find: (d) => scan(d, /issue\s+"([^"]+)"/i, { unitMust: /RC-02/, sectionFirst: "RC-02" }),
  },
  {
    key: "rc03_days",
    label: "RC-03 consecutive days down before reporting to the supervisor",
    unit: "days",
    scope: "fleet",
    find: (d) =>
      scan(d, /more than\s+\**(\d+)\s*consecutive days/i, { unitMust: /RC-03/, sectionFirst: "RC-03" }),
  },
  {
    key: "rc04_days",
    label: "RC-04 notice of violation response deadline",
    unit: "days",
    scope: "fleet",
    find: (d) => scan(d, /within\s+\**(\d+)\s*days/i, { unitMust: /RC-04/, sectionFirst: "RC-04" }),
  },
]

export const RULE_KEYS = [...typeRules, ...fleetRules].map((r) => ({
  key: r.key,
  label: r.label,
  unit: r.unit,
  scope: r.scope,
}))

const DOWNTIME: RuleRow = {
  key: "downtime_days_per_inspection",
  wellType: "",
  status: "found",
  value: "7",
  num: 7,
  unit: "days",
  label: "Downtime counted for each inspection that finds the well not producing",
  docId: "dataset-guide",
  section: "Inspections",
  quote:
    "every inspection in a period that finds the well not producing oil counts as 7 days of downtime. A missed inspection adds no downtime.",
  method: "builtin",
}

export type RuleFallback = (ctx: {
  key: string
  label: string
  wellType: string
  docs: DocInput[]
}) => Promise<Omit<RuleRow, "key" | "wellType" | "label" | "status"> | null>

function parentOf(doc: DocInput, ownType: string): string | null {
  const text = doc.sections.map((s) => s.text).join("\n")
  const m =
    /follow(?:s)? the\s+(T\w+)\s+manual/i.exec(text) ?? /Same as\s+(T\w+)\b/i.exec(text)
  return m && m[1]!.toUpperCase() !== ownType.toUpperCase() ? m[1]!.toUpperCase() : null
}

function toRow(def: RuleDef, wellType: string, hit: Hit, method: RuleRow["method"], inheritedFrom?: string): RuleRow {
  return {
    key: def.key,
    wellType,
    status: "found",
    value: hit.value,
    num: hit.num,
    unit: def.unit,
    label: def.label,
    docId: hit.docId,
    section: hit.section,
    quote: hit.quote,
    method,
    inheritedFrom,
  }
}

/** Extract the rules registry from manuals and SOPs. Rules that cannot be found are stored as `missing`; a model fallback can fill them via `fallback`. */
export async function extractRules(
  docs: DocInput[],
  wellTypes: string[],
  fallback?: RuleFallback,
): Promise<RuleRow[]> {
  const manuals = docs.filter((d) => d.kind === "manual" && d.wellType)
  const sops = docs.filter((d) => d.kind === "sop")
  const out: RuleRow[] = []
  const types = [...new Set([...manuals.map((m) => m.wellType!), ...wellTypes])]
  const byType = new Map(manuals.map((m) => [m.wellType!, m]))

  for (const t of types) {
    const own = byType.get(t)
    const parentType = own ? parentOf(own, t) : null
    const parent = parentType ? byType.get(parentType) : undefined
    for (const def of typeRules) {
      let hit = own ? def.find([own]) : null
      if (hit) {
        out.push(toRow(def, t, hit, "regex"))
        continue
      }
      hit = parent ? def.find([parent]) : null
      if (hit && parent) {
        out.push(toRow(def, t, hit, "inherited", parent.wellType))
        continue
      }
      const fb = fallback ? await fallback({ key: def.key, label: def.label, wellType: t, docs: [own, parent].filter(Boolean) as DocInput[] }) : null
      if (fb) out.push({ key: def.key, wellType: t, label: def.label, status: "found", unit: def.unit, ...fb })
      else out.push({ key: def.key, wellType: t, status: "missing", unit: def.unit, label: def.label, method: "regex" })
    }
  }
  for (const def of fleetRules) {
    const hit = def.find(sops)
    if (hit) {
      out.push(toRow(def, "", hit, "regex"))
      continue
    }
    const fb = fallback ? await fallback({ key: def.key, label: def.label, wellType: "", docs: sops }) : null
    if (fb) out.push({ key: def.key, wellType: "", label: def.label, status: "found", unit: def.unit, ...fb })
    else out.push({ key: def.key, wellType: "", status: "missing", unit: def.unit, label: def.label, method: "regex" })
  }
  out.push(DOWNTIME)
  return out
}
