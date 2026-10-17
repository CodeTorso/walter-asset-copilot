# Walter final test report

## Walter | Architecture and evaluation

FlytBase Hack Day 2026 | 17 October 2026 | 1 of 4

Current deployment revision: 8363ebe, as supplied for this report. The 21-turn replay tested 7ec3722; later software checks and autonomy probes are separate evidence.

### Architecture summary

- Walter answers oil-field questions from inspections, maintenance, manuals and notes, with cited text and catalog-based tables, charts, maps and cards. Voice questions use Gemini Live and the same answer pipeline.

- Dataset-scoped Postgres storage uses Neon in production and PGlite locally. Structured lookups and section-level full-text search retrieve records; imported rules retain source documents, sections and quotes.

- One Gemma 4 31B reasoning loop chooses tools, scope, calculations and presentation. Tess, Marco, Ines and Juno label tool groups, not independently reasoning agents.

- Finding IDs bind UI values to retrieved evidence, and the client validates catalog components. Private conversation history is separated by user and dataset; shared corrections retain authorship, scope, dates and disputed status.

- The autonomy update adds paged inspection, arithmetic, elapsed time, filters, grouped aggregates and temporal joins. Retrieval and presentation can interleave; defaults are 24 steps, 64 tool calls and 240 seconds, with explicit incomplete-work notices.

### Evaluation scope

- Official dataset 009e2b5 was evaluated as of 15 January 2027 in isolated PGlite: 600 wells, seven areas, 125,198 inspections, 17,415 maintenance records and 1,887 notes. This test import did not replace production data.

- All 21 final turns across 11 question groups completed in 90.455 seconds of summed turn time, with zero unresolved citation IDs. Completion and resolving IDs do not establish factual correctness; no aggregate factual pass score is assigned.

- The harness retained each user's history and did not reproduce prescribed fresh-session boundaries. Earlier rehearsal scores of 13, 20, 21 and 25 out of 26, with repeats at 23-25, concern a different suite.

## Final replay | Questions 1-7

Historical answer findings at 7ec3722 | 2 of 4

- Q1 and Q2 correctly decline to invent reservoir pressure or annual oil-production volumes. Temperature and producing status cannot substitute for the missing measurements.

- Q3 lists 26 gas reports but wrongly marks every response late. The phrase-based raw-data oracle finds 17 timely and nine missed responses, pending human classification review; WELL-0137 received a response after 8.5 hours within a 12-hour deadline.

- Q4 retrieves the bypass rule and MOC extension but fails to establish installation/removal dates and expired or absent approvals. Current and historical authorization remain incomplete.

- Q5 retrieves the regulator letter but shows excerpts instead of the requested spill-compliance table. It selects WELL-0001 outside the Northeast scope and does not complete the letter-specific laboratory-evidence assessment.

- Q6 preserves a detailed 75-row status table but equates recorded-status discrepancies with operator-note disagreements. It treats inspections as decisive without establishing note precedence.

- Q7.1 restricts the fleet-wide top-ten request to WELL-0332 from prior conversation. Q7.2 switches to three other wells and a broad protocol table without a verified candidate list.

### Recorded improvements and their limits

- Retrieval now returns longer excerpts and dated, attributed fleet notes; a direct search found all 26 expected gas reports among 29 matches. The final answer still failed the deadline calculation.

- Recorded calculation fixes address nulls, empty groups, precision, full-input aggregation, tied rankings and evidence alignment. Presentation fixes preserve descriptive rows and valid text/table choices instead of forcing charts.

- Feedback checks reject malformed corrections and unsafe ranges, and disputed claims do not silently become effective changes. These software changes do not resolve the factual failures above.

## Final replay | Questions 8-11

Historical answer findings at 7ec3722 | 3 of 4

- Q8.1 records the WELL-0333 replacement claim and Q8.2 acknowledges private sort/cost preferences. Neither proves durable preference handling or a verified replacement.

- Q8.3 concludes no recalled pumps remain using replacement records without establishing installed-lot coverage. Q8.4 records a secondhand WELL-0577 claim without resolving the requested authority distinction.

- Q8.5 loses the user's area, describes previously returned pumps as remaining and substitutes area-level maintenance totals for installation costs. The answer also duplicates prose.

- Q9.1 repeats the unsupported no-recalled-pumps conclusion. Q9.2 omits the Northwest lead and cites equipment manuals for its 150-well claim.

- Q9.3 misses OPS-5 freeze protection and claims no cold-weather breaches using spill-procedure citations. The cited material does not establish that conclusion.

- Q9.4 locates the gas note but claims there is no H2S reading without an exhaustive response-record search. Absence remains unverified.

- Q9.5 follows WELL-0332 instead of the original pump set. Q9.6 prioritizes that same well without comparing all previously discussed wells.

- Q10 generalizes contractor delays from limited reports and gives ranges instead of a complete area breakdown with typical extra days.

- Q11 names a hottest region from a few wells, plots one well's temperature series and emits a numeric-mismatch warning. Acknowledging limited sampling does not support a fleet-wide regional conclusion.

### Unresolved work

- The remaining answer failures concern evidence coverage, temporal joins, installed-equipment tracking, authority, scope and memory across topic changes. The later probes do not establish that these 21-turn failures are fixed.

- The user-picker patch followed the replay, and additional UI work is separate. Historical screenshots are evidence of those saved answers, not acceptance of the current deployment.

## Latest probes | Verification and evidence

Separate from the 21-turn replay | 4 of 4

- Supplied verification records 82 distinct tests passing across engine, surface, calculation, presentation, call-cache and chat-store suites, plus typecheck and production build. This report edit did not rerun those checks or certify every answer.

- The fresh-process WELL-0001 probe passed its answer check: all 11 completed jobs started in 2026, exact elapsed hours and zero median extra downtime matched the independent raw-record oracle. It completed in 15.881 seconds with a job table and structured median table.

- The fleet comparison probe failed: repeated average requests omitted the required numeric column and exhausted 24 steps in 24.402 seconds. Walter displayed a partial-work notice; that notice is not a passing answer.

- Both probes used the isolated official dataset with retained user history. They do not replace the earlier final replay or establish fresh-session correctness.

### Screenshot appendix, outside this document

- walter-report-and-screenshots.zip contains this report and five original captures from RESOURCE/submission/screenshots. Screenshots remain outside the four-page PDF.

- Q1 shows a valid missing-pressure refusal; Q5 shows the incomplete regulator assessment; Q9.4 shows the unsupported no-reading claim; Q9.6 shows the unverified priority/map; Q11 shows the numeric warning. These are examples of rendering and known failures, not five factual passes.

### Evidence locations

- RESOURCE/qa-runs/submission-20261017/: report.md, review.json, final-summary.json and final-results.jsonl preserve the evaluation and full final answers; raw-oracle.json and note-tool-probe.json preserve gas-report checks.

- The same directory holds autonomy-final-results.jsonl and autonomy-oracle.json for the two later probes. docs/final-test-report.md and RESOURCE/submission/Walter-test-report.md hold this concise report.

Live app: https://asset-copilot.vercel.app
Source: https://github.com/CodeTorso/walter-asset-copilot
