// Runs the example-question sequence through the full agent (model + tools) and writes a review log.
// Usage: PGLITE_DIR=/tmp/copy bun --env-file=.env.google scripts/regress-agent.ts [out.md]
// Expected answers are not used here; compare the log with 03-evaluation-queries.md by hand.
import { writeFileSync } from "node:fs"
import { runTurn } from "../src/agent/turn"

const U = { michael: "U-201", jessica: "U-202", tyler: "U-204", jake: "U-102", laura: "U-401" }
const steps: [string, string, string][] = [
  ["Q1", U.michael, "Is WELL-0001 producing oil right now? When was it last inspected, and by whom? Show me its status card."],
  ["Q2", U.michael, "Which wells in Northeast Block 8 are not producing oil right now, and why? Show them in a table."],
  ["Q3", U.michael, "Show a line chart of WELL-0001's wellhead temperature against air temperature for the last 13 weeks, and mark when it was not producing oil."],
  ["Q4", U.michael, "How many oil spills has WELL-0001 had in the last 4 years, and how much oil in total? List them in a table."],
  ["Q5", U.michael, "How many days was WELL-0001 down in 2025?"],
  ["Q6", U.michael, "Which 3 wells in Northeast Block 7 had the most downtime in the last 4 months? Show a bar chart."],
  ["Q7", U.michael, "Show on a map every well in Northeast Block 8 with a real spill in the last 90 days."],
  ["Q8", U.michael, "Show a heatmap of 2026 spills by geographic area and month."],
  ["Q9", U.michael, "Which rules has WELL-0001 broken in the last 12 months, and what is still open?"],
  ["Q10", U.michael, "In Southwest Block 24, which spills in the last 90 days were not contained within the SOP time limit?"],
  ["Q11", U.michael, "For the three wells we discussed yesterday, what have repairs cost this year?"],
  ["Q12a", U.michael, "The 15 Oct reading for WELL-0164 is wrong. The handheld thermal gun used in that inspection was faulty; the field crew re-measured the wellhead at 41.0 °C."],
  ["Q12b", U.michael, "Which wells in Northeast Block 8 are not producing oil right now, and why? Show them in a table."],
  ["Q13", U.michael, "The AI estimated the 24 Sep spill at WELL-0151 as 4.5 bbl. The field crew measured 5.4 bbl."],
  ["Q14a", U.michael, "Which wells in Northeast Block 7 need a root-cause analysis on their pump jack?"],
  ["Q14b", U.michael, "Note for all T350 wells: our team now wants a pump jack root-cause analysis after 2 repairs, not 3."],
  ["Q14c", U.michael, "Which wells in Northeast Block 7 need a root-cause analysis on their pump jack?"],
  ["Q15a", U.jessica, "Is WELL-0164 producing oil right now?"],
  ["Q15b", U.laura, "Which spills in Northeast Block 8 in the last 90 days needed a report to the regulator?"],
  ["Q16a", U.jake, "FYI for everyone: WELL-0007 will be shut in from 17 Oct for a 10-day planned workover."],
  ["Q16b", U.michael, "Is any downtime planned for WELL-0007?"],
  ["Q16c", U.jessica, "For the three wells we discussed yesterday, what have repairs cost this year?"],
  ["Q17a", U.michael, "WELL-0175 has been shut in for planned work since 14 Oct."],
  ["Q17b", U.tyler, "WELL-0175 is running fine."],
  ["Q17c", U.jake, "WELL-0001 is back online since 14 Oct."],
  ["Q18", U.laura, "Was the 20 Aug spill at WELL-0101 real oil?"],
]
const only = process.env.ONLY?.split(",")
const out: string[] = [`# Agent regression ${new Date().toISOString()}\n`]
let totalMs = 0, totalIn = 0, totalOut = 0, requests = 0
for (const [id, user, q] of steps) {
  if (only && !only.includes(id)) continue
  let text = ""
  const blocks: string[] = []
  const delegations: string[] = []
  let usage: any
  try {
    await runTurn({
      userId: user,
      text: q,
      emit: (p: any) => {
        if (p.type === "text-delta") text += p.data.delta
        else if (p.type === "data-delegation") delegations.push(p.data.line)
        else if (p.type === "data-visual") blocks.push(`${p.data.visual}: ${p.data.finding.title} (${p.data.finding.totalRows} rows) ${JSON.stringify(p.data.finding.rows.slice(0, 6))}`.slice(0, 900))
        else if (p.type === "data-surface" && p.data.updateComponents)
          blocks.push(p.data.updateComponents.components.map((c: any) => `${c.component}${c.props.label ? ` ${c.props.label}=${c.props.value}` : ""}`).join(" "))
        else if (p.type === "data-feedback") blocks.push(`feedback ${p.data.kind} ${p.data.status}; conflicts: ${p.data.conflicts.map((c: any) => c.sides.map((s: any) => s.claim).join(" vs ")).join(" | ")}`.slice(0, 600))
        else if (p.type === "data-turn" && p.data.phase !== "started") usage = { phase: p.data.phase, ...p.data.usage }
      },
    })
  } catch (e) {
    text += `\n[ERROR] ${(e as Error).message}`
  }
  totalMs += usage?.ms ?? 0; totalIn += usage?.inputTokens ?? 0; totalOut += usage?.outputTokens ?? 0; requests += usage?.requests ?? 0
  const entry = `## ${id} (${user})\n> ${q}\n\n${delegations.map((d) => `- ${d}`).join("\n")}\n\n${text}\n\n${blocks.map((b) => `- block: ${b}`).join("\n")}\n\n_${JSON.stringify(usage)}_\n`
  out.push(entry)
  console.log(`${id}: ${(usage?.ms / 1000).toFixed(1)}s ${usage?.model} | ${text.replace(/\n+/g, " ").slice(0, 220)}`)
}
out.push(`\nTotals: ${(totalMs / 1000).toFixed(0)} s, ${requests} model requests, ${totalIn} input / ${totalOut} output tokens\n`)
writeFileSync(process.argv[2] ?? "regression.md", out.join("\n"))
console.log(`Totals: ${(totalMs / 1000).toFixed(0)} s, ${requests} requests, ${totalIn} in / ${totalOut} out tokens`)
process.exit(0)
