/// <reference types="node" />
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { z } from "zod"
import {
  AreaRow,
  InspectionRow,
  MaintenanceRow,
  NoteRow,
  RegulatoryEventRow,
  UserRow,
  WellRow,
} from "../../contracts"
import { addDays, dateOf } from "../util/dates"
import { extractReportFacts } from "./facts"
import { splitSections } from "./markdown"
import { extractRules, type RuleFallback } from "./rules"
import type { DatasetRows, DocInput, FactRow, TeamRow } from "./types"

// loose() keeps unknown source fields so the raw row can be stored as-is
const wellSchema = WellRow.loose()
const inspectionSchema = InspectionRow.loose()
const maintenanceSchema = MaintenanceRow.loose()
const regSchema = RegulatoryEventRow.loose()
const noteSchema = NoteRow.loose()
const userSchema = UserRow.loose()
const areaSchema = AreaRow.loose()

export type ParseOptions = {
  datasetId: string
  label?: string
  /** YYYY-MM-DD override for the dataset "today" */
  today?: string
  strict?: boolean
  ruleFallback?: RuleFallback
  onLog?: (line: string) => void
}

function readText(p: string): string {
  return readFileSync(p, "utf8")
}

function readJson(p: string): unknown {
  return JSON.parse(readText(p))
}

function readJsonl(p: string): unknown[] {
  if (!existsSync(p)) return []
  return readText(p)
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) collectFiles(p, out)
    else out.push(p)
  }
  return out
}

export function hashFolder(root: string): string {
  const h = createHash("sha1")
  for (const p of collectFiles(root)) {
    h.update(p.slice(root.length))
    h.update(readFileSync(p))
  }
  return h.digest("hex")
}

class Validator {
  warnings: string[] = []
  constructor(private strict: boolean) {}
  rows<T>(schema: z.ZodType, rows: unknown[], where: string, idKey: string): T[] {
    const out: T[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      const res = schema.safeParse(r)
      if (!res.success) {
        const msg = `${where}: invalid row (${res.error.issues[0]?.path.join(".")}: ${res.error.issues[0]?.message})`
        if (this.strict) throw new Error(msg)
        this.warnings.push(msg)
        continue
      }
      const id = String((res.data as Record<string, unknown>)[idKey] ?? "")
      if (id && seen.has(id)) {
        this.warnings.push(`${where}: duplicate ${idKey} ${id} skipped`)
        continue
      }
      seen.add(id)
      out.push(res.data as T)
    }
    return out
  }
}

function docFromMarkdown(
  md: string,
  base: Omit<DocInput, "sections" | "title"> & { title?: string },
): DocInput {
  const { title, sections } = splitSections(md)
  return { ...base, title: base.title ?? (title || base.docId), sections }
}

export async function parseDataset(root: string, opts: ParseOptions): Promise<DatasetRows> {
  const log = opts.onLog ?? (() => {})
  const v = new Validator(Boolean(opts.strict))
  const fleet = join(root, "fleet")
  const assetsDir = join(root, "assets")
  if (!existsSync(assetsDir)) throw new Error(`No assets/ folder under ${root}`)

  const usersFile = join(fleet, "users.json")
  const areasFile = join(fleet, "areas.json")
  const usersRaw = existsSync(usersFile) ? (readJson(usersFile) as { users?: unknown[] }) : {}
  const users = v.rows<UserRow>(userSchema, usersRaw.users ?? [], "fleet/users.json", "user_id")
  const areasJson = existsSync(areasFile)
    ? (readJson(areasFile) as { areas?: unknown[]; teams?: TeamRow[] })
    : {}
  const areas = v.rows<AreaRow>(areaSchema, areasJson.areas ?? [], "fleet/areas.json", "area_id")
  const teams: TeamRow[] = (areasJson.teams ?? []).map((t) => ({
    team_id: t.team_id,
    name: t.name,
    lead_user_id: t.lead_user_id ?? null,
  }))

  // Fleet documents: manuals by filename (well type), SOPs by filename
  const documents: DocInput[] = []
  for (const f of listFiles(join(fleet, "well-types"), ".md")) {
    const type = basename(f, ".md")
    documents.push(
      docFromMarkdown(readText(join(fleet, "well-types", f)), {
        docId: type,
        kind: "manual",
        wellType: type,
        path: `fleet/well-types/${f}`,
      }),
    )
  }
  for (const f of listFiles(join(fleet, "sops"), ".md")) {
    documents.push(
      docFromMarkdown(readText(join(fleet, "sops", f)), {
        docId: basename(f, ".md"),
        kind: "sop",
        path: `fleet/sops/${f}`,
      }),
    )
  }

  const wells: WellRow[] = []
  const inspections: InspectionRow[] = []
  const maintenance: MaintenanceRow[] = []
  const regEvents: RegulatoryEventRow[] = []
  const notes: NoteRow[] = []
  const facts: FactRow[] = []

  const wellDirs = readdirSync(assetsDir)
    .filter((d) => existsSync(join(assetsDir, d, "metadata.json")))
    .sort()
  for (const d of wellDirs) {
    const dir = join(assetsDir, d)
    const meta = v.rows<WellRow>(wellSchema, [readJson(join(dir, "metadata.json"))], `${d}/metadata.json`, "asset_id")
    if (!meta.length) continue
    const well = meta[0]!
    wells.push(well)
    const id = well.asset_id
    const withAsset = (rows: unknown[]) =>
      rows.map((r) => ({ asset_id: id, ...(r as object) }))
    inspections.push(
      ...v.rows<InspectionRow>(inspectionSchema, withAsset(readJsonl(join(dir, "inspections.jsonl"))), `${d}/inspections.jsonl`, "inspection_id"),
    )
    const mnt = v.rows<MaintenanceRow>(maintenanceSchema, withAsset(readJsonl(join(dir, "maintenance.jsonl"))), `${d}/maintenance.jsonl`, "maintenance_id")
    maintenance.push(...mnt)
    regEvents.push(
      ...v.rows<RegulatoryEventRow>(regSchema, withAsset(readJsonl(join(dir, "regulatory-events.jsonl"))), `${d}/regulatory-events.jsonl`, "event_id"),
    )
    notes.push(...v.rows<NoteRow>(noteSchema, withAsset(readJsonl(join(dir, "context.jsonl"))), `${d}/context.jsonl`, "note_id"))

    for (const m of mnt) {
      if (!m.report_file) continue
      const p = join(dir, m.report_file)
      if (!existsSync(p)) {
        v.warnings.push(`${m.maintenance_id}: report_file ${m.report_file} not found`)
        continue
      }
      const md = readText(p)
      const doc = docFromMarkdown(md, {
        docId: m.maintenance_id,
        kind: "report",
        assetId: id,
        maintenanceId: m.maintenance_id,
        path: `assets/${d}/${m.report_file}`,
      })
      documents.push(doc)
      facts.push(...extractReportFacts(m.maintenance_id, doc.docId, md))
    }
  }

  // Dataset "today": latest inspection date + 1 day, unless overridden
  const maxInspection = inspections.reduce((mx, i) => (i.inspected_at > mx ? i.inspected_at : mx), "")
  const computedToday = maxInspection ? addDays(dateOf(maxInspection), 1) : dateOf(new Date().toISOString())
  const today = opts.today ?? computedToday

  const wellTypes = [...new Set(wells.map((w) => w.well_type))]
  const rules = await extractRules(documents.filter((d) => d.kind !== "report"), wellTypes, opts.ruleFallback)

  log(`parsed ${wells.length} wells, ${inspections.length} inspections, ${maintenance.length} maintenance, ${documents.length} documents`)

  return {
    meta: {
      id: opts.datasetId,
      label: opts.label ?? opts.datasetId,
      today,
      todayOverridden: Boolean(opts.today),
      sourceHash: hashFolder(root),
    },
    users,
    teams,
    areas,
    wells,
    inspections,
    maintenance,
    regEvents,
    notes,
    facts,
    rules,
    documents,
    warnings: v.warnings,
  }
}
