// Official final-question replay. Never opens the application's database.
// bun --env-file=.env.google scripts/submission-eval.ts --prepare
// bun --env-file=.env.google scripts/submission-eval.ts
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve("RESOURCE/qa-runs/submission-20261017")
const upstream = resolve(root, "upstream")
const dbPath = resolve(root, "pglite")
const runName = process.env.EVAL_RUN ?? ""
if (runName && !/^[a-z0-9-]+$/.test(runName)) throw new Error("Invalid EVAL_RUN label")
const artifact = (name: string) => resolve(root, runName ? `${runName}-${name}` : name)
mkdirSync(root, { recursive: true })
if (!existsSync(resolve(dbPath, "PG_VERSION"))) throw new Error("Prepare the isolated PGlite copy and ingest the final dataset first")
if (realpathSync(dbPath) === realpathSync(resolve(".data/pglite"))) throw new Error("Refusing application database")
// Overrides are set before importing any server module; inherited credentials cannot select Neon.
delete process.env.DATABASE_URL
delete process.env.DATABASE_URL_UNPOOLED
process.env.PGLITE_DIR = dbPath

const source = readFileSync(resolve(upstream, "test-data/final-questions.md"), "utf8")
const userSequences: Record<number, string[]> = {
  1: ["U-201"], 2: ["U-301"], 3: ["U-401"], 4: ["U-402"], 5: ["U-201"], 6: ["U-601"],
  7: ["U-301", "U-301"], 8: ["U-601", "U-601", "U-301", "U-501", "U-601"],
  9: Array(6).fill("U-301"), 10: ["U-201"], 11: ["U-501"],
}
const steps = [...source.matchAll(/^## Q(\d+)\. ([\s\S]*?)(?=^## Q|$(?![\s\S]))/gm)].flatMap((m) => {
  const n = Number(m[1])
  const prompts = [...m[2]!.matchAll(/\*"([\s\S]*?)"\*/g)]
  if (prompts.length !== userSequences[n]?.length) throw new Error(`Question extraction mismatch Q${n}`)
  return prompts.map((p, i) => ({ id: `Q${n}${prompts.length > 1 ? `.${i + 1}` : ""}`, userId: userSequences[n]![i]!, text: p[1]!.replace(/\s*\n\s*/g, " ") }))
})
if (steps.length !== 21) throw new Error(`Expected 21 turns, got ${steps.length}`)
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
const manifest = {
  preparedAt: new Date().toISOString(), upstreamSha: "009e2b596782150f420021f9472ab37e3a2953ee",
  upstreamCommittedAt: "2026-10-17T16:05:49+05:30", datasetId: "submission-test", today: "2027-01-15",
  dbPath, questionSourceSha256: hash(resolve(upstream, "test-data/final-questions.md")), steps,
  limitations: ["The current application has one continuous thread per user and dataset. Requested new-session boundaries cannot be represented by runTurn; memory is preserved.", "Automated checks cover completion, evidence references, and block counts, not factual correctness or rendered browser appearance."],
}
writeFileSync(artifact("manifest.json"), JSON.stringify(manifest, null, 2))
console.log(`Prepared ${steps.length} exact official turns; isolated local database only`)
if (process.argv.includes("--prepare")) process.exit(0)

const { runTurn } = await import("../src/agent/turn")
const { getDb } = await import("../src/server/db/client")
const { getDatasets } = await import("../src/server")
const db = await getDb()
if (db.kind !== "pglite") throw new Error("Refusing nonlocal database")
const dataset = (await getDatasets()).find((d) => d.id === manifest.datasetId)
if (!dataset || dataset.today !== manifest.today) throw new Error("Final dataset or today does not match manifest")
const sourcePaths = ["src/agent/turn.ts", "src/agent/prompt.ts", "src/agent/recipes.ts", "src/agent/view.ts", "src/server/tools/read.ts", "src/lib/surface.ts"]
const sourceHashes = Object.fromEntries(sourcePaths.map((p) => [p, hash(p)]))
writeFileSync(artifact("runtime.json"), JSON.stringify({ startedAt: new Date().toISOString(), sourceHashes, dataset, providerPreference: process.env.WALTER_PROVIDER ?? "default" }, null, 2))
const results: any[] = []
const start = Date.now()
const budgetMs = Number(process.env.EVAL_BUDGET_MS ?? 270000)
const selected = process.env.ONLY ? steps.filter((s) => process.env.ONLY!.split(",").includes(s.id)) : steps
const resultPath = artifact("results.jsonl")
if (existsSync(resultPath)) throw new Error("Results already exist; retain them and choose a new run directory before rerunning")
for (const step of selected) {
  if (Date.now() - start > budgetMs) break
  const events: any[] = []
  const startedAt = new Date().toISOString()
  let answer = "", error: string | undefined
  const t0 = Date.now()
  try {
    await runTurn({ datasetId: manifest.datasetId, ...step, signal: AbortSignal.timeout(Math.min(35000, Math.max(1000, budgetMs - (Date.now() - start)))), emit: (p: any) => {
      events.push(p)
      if (p.type === "text-delta") answer += p.data.delta
      if (p.type === "text") answer = p.data.text
    } })
  } catch (e) { error = e instanceof Error ? e.message : String(e) }
  const evidence = new Set(events.filter((p) => p.type === "data-evidence").flatMap((p) => p.data.refs.map((r: any) => r.id)))
  const cites = [...answer.matchAll(/\[\[([^\]\s]+)\]\]/g)].map((m) => m[1])
  const unresolvedCitations = [...new Set(cites.filter((id) => !evidence.has(id)))]
  const visuals = events.filter((p) => p.type === "data-visual").map((p) => ({ visual: p.data.visual, rows: p.data.finding.rows.length, title: p.data.finding.title, columns: p.data.finding.columns }))
  const components = events.filter((p) => p.type === "data-surface").flatMap((p) => p.data.updateComponents?.components ?? []).map((c: any) => c.component)
  const terminal = [...events].reverse().find((p) => p.type === "data-turn" && p.data.phase !== "started")?.data
  const checks = { completed: terminal?.phase === "completed" && !error, hasAnswer: !!answer.trim(), citationReferencesResolve: unresolvedCitations.length === 0, hasEvidence: evidence.size > 0 }
  const result = { ...step, startedAt, elapsedMs: Date.now() - t0, answer, error, terminal, visuals, components, evidenceCount: evidence.size, citationCount: cites.length, unresolvedCitations, checks, events }
  results.push(result)
  appendFileSync(resultPath, JSON.stringify(result) + "\n")
  writeFileSync(artifact("summary.json"), JSON.stringify({ ...manifest, selectedTurns: selected.map((s) => s.id), startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString(), completedTurns: results.length, remainingTurns: selected.slice(results.length).map((s) => s.id), sourceHashes, sourceChangedDuringRun: sourcePaths.filter((p) => hash(p) !== sourceHashes[p]), results: results.map(({ events: _events, ...r }) => r) }, null, 2))
  console.log(`${step.id}: ${checks.completed ? "completed" : "ERROR"}; ${Math.round(result.elapsedMs / 1000)}s; ${visuals.map((v) => v.visual).join(",") || "no visual"}; ${components.length} components; ${evidence.size} evidence refs`)
}
await db.close()
console.log(`Saved ${results.length}/${selected.length} selected turns; factual and browser review remain separate`)
process.exit(0)
