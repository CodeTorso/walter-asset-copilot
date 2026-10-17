// QA harness: replays the 18 example questions (03-evaluation-queries.md) through the full agent, as the right
// users and in order, and checks each answer the way the organisers grade it:
//   facts   - numbers, IDs, names and dates from the expected answers
//   evidence - every [[ID]] citation in the reply resolves to a record this turn actually retrieved
//   visual  - the visual kind the question asks for (or the guide's default)
//   memory  - corrections, rules and notes carry forward; private history stays private
// Usage: PGLITE_DIR=/tmp/copy bun --env-file=.env.google scripts/qa-agent.ts [report.md]   (ONLY=Q1,Q2 to filter)
import { writeFileSync } from "node:fs"
import { runTurn } from "../src/agent/turn"
import { getDatasets, resetFeedbackAndMemory } from "../src/server"

type Turn = {
  text: string
  visuals: { visual: string; finding: any }[]
  surfaces: any[]
  feedback: any[]
  conflicts: any[]
  evidence: Set<string>
  delegations: string[]
  error?: string
  usage?: any
}
type Check = [label: string, ok: boolean, detail?: string]

const U = { michael: "U-201", jessica: "U-202", tyler: "U-204", jake: "U-102", laura: "U-401" }

// ── helpers ────────────────────────────────────────────────────────────────
const content = (t: Turn) =>
  [t.text, ...t.visuals.map((v) => JSON.stringify(v.finding)), ...t.surfaces.map((s) => JSON.stringify(s)), ...t.feedback.map((f) => JSON.stringify(f)), ...t.conflicts.map((c) => JSON.stringify(c))].join("\n")
const norm = (s: string) => s.replace(/,(?=\d{3})/g, "")
const has = (t: Turn, ...needles: (string | RegExp)[]): Check[] =>
  needles.map((n) => {
    const c = norm(content(t))
    const ok = typeof n === "string" ? c.includes(norm(n)) : n.test(c)
    return [`mentions ${n}`, ok] as Check
  })
const textHas = (t: Turn, re: RegExp, label?: string): Check => [label ?? `reply says ${re}`, re.test(norm(t.text))]
const textLacks = (t: Turn, re: RegExp, label?: string): Check => [label ?? `reply does not say ${re}`, !re.test(norm(t.text))]
const visual = (t: Turn, ...kinds: string[]): Check => {
  const got = t.visuals.map((v) => v.visual)
  return [`visual ${kinds.join("|")}`, got.some((g) => kinds.includes(g)), `got ${got.join(",") || (t.surfaces.length ? "metric/keyvalue only" : "none")}`]
}
const wellsOf = (t: Turn, kind?: string) => {
  const v = t.visuals.filter((x) => !kind || x.visual === kind)
  const set = new Set<string>()
  for (const x of v) for (const r of x.finding.rows ?? []) if (typeof r.well === "string") set.add(r.well)
  return set
}
const sameSet = (label: string, got: Set<string>, want: string[]): Check => {
  const ok = got.size === want.length && want.every((w) => got.has(w))
  return [label, ok, `got ${[...got].sort().join(", ") || "none"}`]
}
const citations = (t: Turn): Check => {
  const ids = [...t.text.matchAll(/\[\[([^\]\s]+)\]\]/g)].map((m) => m[1]!)
  const bad = ids.filter((id) => !t.evidence.has(id))
  return [`all ${ids.length} citations resolve to this answer's records`, ids.length > 0 && bad.length === 0, bad.length ? `unresolved: ${[...new Set(bad)].join(", ")}` : ids.length ? "" : "no citations"]
}
const feedbackOf = (t: Turn, kind?: string) => t.feedback.filter((f) => !kind || f.kind === kind)

// ── the 18 questions ───────────────────────────────────────────────────────
type Step = { id: string; user: string; q: string; check: (t: Turn) => Check[] }
const steps: Step[] = [
  { id: "Q1", user: U.michael, q: "Is WELL-0001 producing oil right now? When was it last inspected, and by whom? Show me its status card.",
    check: (t) => [visual(t, "status_card"), textHas(t, /not producing/i), ...has(t, "INS-0001-0203", "Ryan Brooks", "3.2", "CTX-0001-003", /out of date|stale|says active|recorded.{0,30}active/i), citations(t)] },
  { id: "Q2", user: U.michael, q: "Which wells in Northeast Block 8 are not producing oil right now, and why? Show them in a table.",
    check: (t) => [visual(t, "table"), sameSet("table wells", wellsOf(t, "table"), ["WELL-0164", "WELL-0170", "WELL-0172", "WELL-0175"]), ...has(t, "MNT-0170-031", "MNT-0172-028", /no recorded reason/i), citations(t)] },
  { id: "Q3", user: U.michael, q: "Show a line chart of WELL-0001's wellhead temperature against air temperature for the last 13 weeks, and mark when it was not producing oil.",
    check: (t) => {
      const rows = t.visuals.find((v) => v.visual === "line_chart")?.finding.rows ?? []
      return [visual(t, "line_chart"), ["13 weekly readings", rows.length === 13, `got ${rows.length}`], ...has(t, "2026-10-08", "2026-10-15"), citations(t)]
    } },
  { id: "Q4", user: U.michael, q: "How many oil spills has WELL-0001 had in the last 4 years, and how much oil in total? List them in a table.",
    check: (t) => {
      const rows = t.visuals.find((v) => v.visual === "table")?.finding.rows ?? []
      return [visual(t, "table"), ["6 spill rows", rows.length === 6, `got ${rows.length}`], textHas(t, /\b6\b/), textHas(t, /15\.1/), ...has(t, "CTX-0001-001"), citations(t)]
    } },
  { id: "Q5", user: U.michael, q: "How many days was WELL-0001 down in 2025?",
    check: (t) => [textHas(t, /\b21\b/), ...has(t, "MNT-0001-021", "MNT-0001-023"), citations(t)] },
  { id: "Q6", user: U.michael, q: "Which 3 wells in Northeast Block 7 had the most downtime in the last 4 months? Show a bar chart.",
    check: (t) => [visual(t, "bar_chart"), sameSet("top 3 wells", wellsOf(t, "bar_chart"), ["WELL-0121", "WELL-0138", "WELL-0107"]), ...has(t, /WELL-0121[^}]*49/), citations(t)] },
  { id: "Q7", user: U.michael, q: "Show on a map every well in Northeast Block 8 with a real spill in the last 90 days.",
    check: (t) => [visual(t, "map"), sameSet("map pins", wellsOf(t, "map"), ["WELL-0151", "WELL-0165", "WELL-0175", "WELL-0186"]), citations(t)] },
  { id: "Q8", user: U.michael, q: "Show a heatmap of 2026 spills by geographic area and month.",
    check: (t) => [visual(t, "heatmap"), textHas(t, /141|43/), ...has(t, /Southwest Block 24/), citations(t)] },
  { id: "Q9", user: U.michael, q: "Which rules has WELL-0001 broken in the last 12 months, and what is still open?",
    check: (t) => [...has(t, "SR-01", "SR-02", "SR-03", "RC-04", "REG-0001-002", /5000/), citations(t)] },
  { id: "Q10", user: U.michael, q: "In Southwest Block 24, which spills in the last 90 days were not contained within the SOP time limit?",
    check: (t) => [visual(t, "table"), sameSet("breached spills", wellsOf(t), ["WELL-0082", "WELL-0100"]), ...has(t, "7.1", "8.1"), citations(t)] },
  { id: "Q11", user: U.michael, q: "For the three wells we discussed yesterday, what have repairs cost this year?",
    check: (t) => [...has(t, /25794/, /46942/, /5176/), sameSet("recalled wells", wellsOf(t), ["WELL-0121", "WELL-0138", "WELL-0107"]), citations(t)] },
  { id: "Q12a", user: U.michael, q: "The 15 Oct reading for WELL-0164 is wrong. The handheld thermal gun used in that inspection was faulty; the field crew re-measured the wellhead at 41.0 °C.",
    check: (t) => {
      const fb = feedbackOf(t, "data_correction")[0]
      return [["correction recorded", !!fb, fb ? `${fb.feedbackId} ${fb.status}` : "none"], ...has(t, "INS-0164-0205", /24(\.0)?\b/, /pump jack not moving/i), textHas(t, /\bproducing\b/i), textHas(t, /confirm/i, "asks to confirm"), citations(t)]
    } },
  { id: "Q12b", user: U.michael, q: "Which wells in Northeast Block 8 are not producing oil right now, and why? Show them in a table.",
    check: (t) => [visual(t, "table"), sameSet("table wells after correction", wellsOf(t, "table"), ["WELL-0170", "WELL-0172", "WELL-0175"]), textHas(t, /WELL-0164/, "explains WELL-0164"), citations(t)] },
  { id: "Q13", user: U.michael, q: "The AI estimated the 24 Sep spill at WELL-0151 as 4.5 bbl. The field crew measured 5.4 bbl.",
    check: (t) => [["analysis correction recorded", feedbackOf(t, "analysis_correction").length > 0], ...has(t, "INS-0151-0201", /reportable/i, "SR-01", "MNT-0151-025", /23 Nov|2026-11-23/), citations(t)] },
  { id: "Q14a", user: U.michael, q: "Which wells in Northeast Block 7 need a root-cause analysis on their pump jack?",
    check: (t) => [sameSet("RCA wells", wellsOf(t), ["WELL-0108", "WELL-0121", "WELL-0138"]), citations(t)] },
  { id: "Q14b", user: U.michael, q: "Note for all T350 wells: our team now wants a pump jack root-cause analysis after 2 repairs, not 3.",
    check: (t) => {
      const fb = feedbackOf(t, "scoped_rule")[0]
      return [["scoped rule recorded", !!fb, fb ? fb.summary : "none"], textLacks(t, /keep (that|this|it) in mind/i, "doesn't call a saved rule temporary")]
    } },
  { id: "Q14c", user: U.michael, q: "Which wells in Northeast Block 7 need a root-cause analysis on their pump jack?",
    check: (t) => [sameSet("RCA wells with T350 rule", wellsOf(t), ["WELL-0108", "WELL-0120", "WELL-0121", "WELL-0138"]), ["WELL-0102 (T200) not added", !wellsOf(t).has("WELL-0102")], ...has(t, /Michael Turner/), citations(t)] },
  { id: "Q15a", user: U.jessica, q: "Is WELL-0164 producing oil right now?",
    check: (t) => [textHas(t, /\b(yes|is producing)\b/i), textLacks(t, /\bnot producing\b/i), ...has(t, "41", /Michael Turner/, /pump jack not moving/i), citations(t)] },
  { id: "Q15b", user: U.laura, q: "Which spills in Northeast Block 8 in the last 90 days needed a report to the regulator?",
    check: (t) => [textHas(t, /WELL-0151/), sameSet("reportable spills", wellsOf(t), ["WELL-0151"]), ...has(t, "5.4", /overdue|no written notice|not recorded|none is recorded/i), citations(t)] },
  { id: "Q16a", user: U.jake, q: "FYI for everyone: WELL-0007 will be shut in from 17 Oct for a 10-day planned workover.",
    check: (t) => [["shared note recorded", feedbackOf(t, "shared_note").length > 0]] },
  { id: "Q16b", user: U.michael, q: "Is any downtime planned for WELL-0007?",
    check: (t) => [textHas(t, /17 Oct|2026-10-17|October 17/i), textHas(t, /10[- ]day/i), textHas(t, /Jake Morales/), citations(t)] },
  { id: "Q16c", user: U.jessica, q: "For the three wells we discussed yesterday, what have repairs cost this year?",
    check: (t) => [textLacks(t, /25794|46942|5176/, "no costs from Michael's history"), textHas(t, /(\bno\b|can'?t|cannot|couldn'?t|don'?t|not).{0,60}(earlier|previous|conversation|discuss|record)/i, "says there is no such earlier conversation")] },
  { id: "Q17a", user: U.michael, q: "WELL-0175 has been shut in for planned work since 14 Oct.",
    check: (t) => [["note recorded", t.feedback.length > 0]] },
  { id: "Q17b", user: U.tyler, q: "WELL-0175 is running fine.",
    check: (t) => {
      const fb = feedbackOf(t, "status_claim")[0]
      return [["claim recorded as unconfirmed", !!fb && fb.status !== "applied", fb ? fb.status : "none"], textHas(t, /0\.4/), textHas(t, /not producing/i), ...has(t, /Jessica Reed/, /Michael Turner/), textHas(t, /confirm/i, "asks to confirm"), citations(t)]
    } },
  { id: "Q17c", user: U.jake, q: "WELL-0001 is back online since 14 Oct.",
    check: (t) => {
      const fb = feedbackOf(t, "status_claim")[0]
      return [["claim recorded as unconfirmed", !!fb && fb.status !== "applied", fb ? fb.status : "none"], textHas(t, /not producing/i), ...has(t, "CTX-0001-003", /20 Oct|2026-10-20/), citations(t)]
    } },
  { id: "Q18", user: U.laura, q: "Was the 20 Aug spill at WELL-0101 real oil?",
    check: (t) => [textHas(t, /\byes\b/i), ...has(t, "INS-0101-0197", /Ryan Brooks/, /Chris Dalton/, "CTX-0101-002", "CTX-0101-003", "MNT-0101-029"), citations(t)] },
]

// ── run ────────────────────────────────────────────────────────────────────
// QA_REMAP="WELL-=PAD-,T200=K12": run the same questions on a renamed copy of the dataset (robustness rehearsal).
// Questions are translated into the copy's names and every streamed part is translated back before checking.
const remap = (process.env.QA_REMAP ?? "").split(",").filter(Boolean).map((x) => x.split("=") as [string, string])
const fwd = (x: string) => remap.reduce((acc, [a, b]) => acc.split(a).join(b), x)
const back = (x: string) => remap.reduce((acc, [a, b]) => acc.split(b).join(a), x)
const only = process.env.ONLY?.split(",")
// A full run starts from the original sample: no feedback, no chat history.
if (!only) await resetFeedbackAndMemory((await getDatasets())[0]!.id)
const lines: string[] = []
const summary: string[] = ["| Q | User | Result | Failed checks | Visual | Time |", "|---|---|---|---|---|---|"]
let passed = 0, total = 0, totalMs = 0
for (const s of steps) {
  if (only && !only.includes(s.id)) continue
  const t: Turn = { text: "", visuals: [], surfaces: [], feedback: [], conflicts: [], evidence: new Set(), delegations: [] }
  try {
    await runTurn({
      userId: s.user,
      text: fwd(s.q),
      emit: (raw: any) => {
        const p = remap.length ? JSON.parse(back(JSON.stringify(raw))) : raw
        if (p.type === "text-delta") t.text += p.data.delta
        else if (p.type === "data-delegation") t.delegations.push(p.data.line)
        else if (p.type === "data-visual") {
          t.visuals.push({ visual: p.data.visual, finding: p.data.finding })
          for (const r of p.data.finding.rulesApplied ?? []) t.evidence.add(r.source?.id)
        } else if (p.type === "data-surface" && p.data.updateComponents) t.surfaces.push(p.data.updateComponents.components)
        else if (p.type === "data-evidence") for (const r of p.data.refs) t.evidence.add(r.id)
        else if (p.type === "data-feedback") {
          t.feedback.push(p.data)
          t.evidence.add(p.data.feedbackId)
        } else if (p.type === "data-conflict") {
          t.conflicts.push(p.data)
          for (const side of p.data.sides ?? []) if (side.source?.id) t.evidence.add(side.source.id)
        } else if (p.type === "data-turn" && p.data.phase !== "started") t.usage = { phase: p.data.phase, ...p.data.usage }
      },
    })
  } catch (e) {
    t.error = (e as Error).message
  }
  const checks: Check[] = t.error ? [["turn completed", false, t.error]] : s.check(t)
  const failed = checks.filter((c) => !c[1])
  total++
  if (!failed.length) passed++
  totalMs += t.usage?.ms ?? 0
  const vis = t.visuals.map((v) => v.visual).join(", ") || (t.surfaces.length ? "metric" : "–")
  summary.push(`| ${s.id} | ${s.user} | ${failed.length ? "FAIL" : "PASS"} | ${failed.map((c) => `${c[0]}${c[2] ? ` (${c[2]})` : ""}`).join("; ").replace(/\|/g, "/") || "–"} | ${vis} | ${((t.usage?.ms ?? 0) / 1000).toFixed(1)}s |`)
  lines.push(
    `## ${s.id} (${s.user}) ${failed.length ? "FAIL" : "PASS"}\n> ${s.q}\n\n${t.delegations.map((d) => `- ${d}`).join("\n")}\n\n${t.text}\n\n` +
      checks.map((c) => `- [${c[1] ? "x" : " "}] ${c[0]}${c[2] ? ` (${c[2]})` : ""}`).join("\n") +
      `\n\n_${JSON.stringify(t.usage)}_\n`,
  )
  console.log(`${s.id}: ${failed.length ? "FAIL" : "pass"} ${((t.usage?.ms ?? 0) / 1000).toFixed(1)}s ${failed.map((c) => `${c[0]}${c[2] ? ` (${c[2]})` : ""}`).join("; ")}`)
}
const head = `# QA run ${new Date().toISOString()}\n\n**${passed}/${total} questions pass** · ${(totalMs / 1000).toFixed(0)} s model time\n\n`
writeFileSync(process.argv[2] ?? "qa-report.md", head + summary.join("\n") + "\n\n" + lines.join("\n"))
console.log(`${passed}/${total} pass`)
process.exit(0)
