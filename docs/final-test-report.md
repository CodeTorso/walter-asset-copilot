# Walter final test report

- This report covers the official final-question replay at source revision `7ec3722`, followed by the user-picker UI fix in `a72d333`.

- Evidence comprises [submission write-up](../RESOURCE/submission/Walter-two-page.md), [run report](../RESOURCE/qa-runs/submission-20261017/report.md), [review](../RESOURCE/qa-runs/submission-20261017/review.json), [baseline summary](../RESOURCE/qa-runs/submission-20261017/summary.json), [final summary](../RESOURCE/qa-runs/submission-20261017/final-summary.json), [full final events](../RESOURCE/qa-runs/submission-20261017/final-results.jsonl), `git show 7ec3722`, and the agent prompt and recipes.

- The official dataset is upstream revision `009e2b5`, evaluated as of 15 January 2027 in isolated PGlite storage. It contains 600 wells, seven areas, 125,198 inspections, 17,415 maintenance records and 1,887 notes; it was not imported into production.

- Supplied verification records 65 unit tests passing, typecheck passing and build passing, with deployment READY and public endpoints returning HTTP 200. These checks were not rerun for this report and establish neither answer correctness nor visual acceptance.

- The final replay completed 21/21 turns across 11 question groups in 90.455 seconds of summed turn time, with zero unresolved inline citation IDs. Its monitored source hashes remained stable at revision `7ec3722`; citation resolution establishes that an ID exists, not that its source supports the claim.

- The baseline completed 21 turns in 93.648 seconds, but source changed during execution; the two-turn retest also observed a later source change. Earlier rehearsal results of 13, 20, 21 and 25 passes out of 26, with repeats at 23 to 25, concern a different question suite and cannot grade this final set.

- The harness retains each user's conversation and cannot reproduce the prescribed fresh-session boundaries. Five saved answers were replayed through the actual UI and visually inspected separately; no aggregate factual correctness score is assigned.

- Source inspection confirms removal of forced ranking-to-chart and automatic comparison conversions, preservation of valid table/text choices, exact finding-ID validation, numeric-only deduplicated metrics and explicit key-value slots. Recipes now suggest presentations rather than mandate layouts.

- Document retrieval returns longer excerpts and flags broadened searches; fleet note search includes dates, authors and original evidence. A recorded direct probe retrieved all 26 expected gas reports among 29 matches, while descriptive aggregation protection preserves document, status, rule and compliance fields.

- Calculation fixes cover missing-value handling, empty groups, precision, complete-input aggregation, tied rankings including zero-downtime ties, numeric sorting and aligned row evidence. Unknown producing status has a separate count, repair costs retain cents, and reading/context results carry well IDs for memory.

- Feedback validation rejects malformed numeric and boolean corrections and invalid spill ranges; disputed corrections no longer claim an effective status change. Chart validation falls back to tables, excludes unsuitable default series, and blocks unsafe JSON-pointer paths.

- UI source changes improve text wrapping, chart/table controls, negative and missing bar values, zero gauges, status labels, loading feedback, metric spacing and dataset-derived starters/user names. Five answer captures confirm readable desktop rendering, with long content using scrollable containers; earlier documented fixes also address correction scope/targets, citation handling, recall count and stalled model/database requests.

- Q1 correctly declines the reservoir-pressure map because pressure measurements are absent. It does not substitute temperature readings or invent a pressure layer.

- Q2 correctly declines to name the highest oil producer because production-volume data is absent. Producing status alone cannot establish annual output.

- Q3 improves from zero gas notes in the baseline and eight in the focused retest to listing 26 reports, but wrongly labels every response missed. The independent phrase-based oracle finds 17 timely and nine missed responses, subject to human classification review; WELL-0137 had a response after 8.5 hours within its 12-hour deadline.

- Q4 retrieves the bypass rule and MOC extension but cannot establish installation/removal dates or expired and unapproved bypasses. It therefore leaves the requested current and historical authorization assessment incomplete.

- Q5 retrieves the regulator letter and mentions its laboratory-results deadline, but the visual is a document-excerpt table rather than the requested spill-compliance table. Its narrative selects WELL-0001 outside the stated Northeast scope and evaluates reporting/containment instead of completing the letter-specific laboratory-evidence assessment.

- Q6 preserves a detailed 75-row status table, improving on the baseline's well/count output. It still equates recorded-status discrepancies with operator-note disagreements and treats inspections as decisive without establishing the required note precedence.

- Q7.1 fails the fleet-wide top-ten request by restricting itself to WELL-0332 from conversation history. Q7.2 then selects three different wells and shows a broad protocol table, without preserving a verified candidate list from the preceding answer.

- Q8.1 records the WELL-0333 replacement claim and Q8.2 acknowledges private sorting/cost preferences, but neither proves durable preference handling or verified replacement status. Q8.3 concludes no recalled pumps remain from replacement records, leaving installed-lot coverage unestablished.

- Q8.4 records the secondhand WELL-0577 replacement claim without resolving the requested authority distinction. Q8.5 loses the user's area, describes previously returned pumps as remaining, substitutes area-level total maintenance costs for installation costs, and duplicates prose.

- Q9.1 repeats the unsupported no-recalled-pumps conclusion; Q9.2 omits the Northwest lead and cites equipment manuals for its 150-well claim. Q9.3 misses OPS-5 freeze protection and incorrectly reports no cold-weather breaches using spill-procedure citations.

- Q9.4 locates the gas note but claims no H2S reading, without establishing an exhaustive response-record search. Q9.5 follows WELL-0332 instead of the original pump set, and Q9.6 prioritizes that same well without demonstrating comparison across all previously discussed wells.

- Q10 generalizes contractor delays from limited reports and supplies ranges instead of a complete area breakdown with typical extra days. Q11 acknowledges limited sampling but still names a hottest region from a few wells, shows one well's temperature series, and emits a numeric-mismatch warning.

- The remaining failures concern evidence coverage, temporal joins, installed-equipment tracking, authority, scope and multi-topic memory. Completed streams, passing software checks and reachable deployment endpoints do not resolve those failures, and this report promises no new code or factual fixes.

- Screenshot capture exposed a separate user-picker defect that restricted a new dataset to four role representatives. The final UI patch exposes every loaded user, preserves sample aliases, and passed typecheck; the 21-turn agent replay predates this UI-only patch.

- The five screenshots preserve Q1, Q5, Q9.4, Q9.6 and Q11 exactly as recorded, including incorrect conclusions and the Q11 numeric warning. They document rendering and known failures, not five passing answers; repeated follow-up suggestions remain a visible cleanup item.

## Agent control and calculation update

- Walter now chooses retrieval scope and arguments without heuristic rewrites. Short-answer and one-or-two-tool preferences were removed so the model can work through the user's full request.

- New tools provide paged row inspection, arithmetic, exact elapsed time, filters, grouped aggregates including median, and entity/time joins. Derived findings retain source evidence, null values and coverage caveats.

- Retrieval, calculation and UI calls can interleave, and stable block IDs let Walter revise an existing card. The model can request more records to complete its chosen presentation; code validates bindings and prevents arbitrary executable UI.

- Crew names remain labels for tool groups within one reasoning loop. This update does not introduce independently reasoning model subagents.

- Execution defaults increased to 24 steps, 64 tool calls and 240 seconds, with configurable bounds. Identical calls reuse results, truncated previews are explicitly labelled, and cancellation or budget exhaustion is reported rather than silently treated as a full answer.

- Verification passed 82 distinct tests across engine, surface, calculation, presentation, call-cache and chat-store suites, plus full typecheck and production build. These checks verify software behavior, not universal factual correctness.

- A fresh-process live probe correctly returned all 11 completed WELL-0001 jobs started in 2026, exact elapsed hours and a median extra downtime of zero in 15.881 seconds. An independent raw-record oracle confirmed the job values; the answer included a job-level Markdown table and a structured median table.

- The fleet comparison probe remained incomplete: it repeatedly requested an average without the required numeric column and exhausted 24 steps in 24.402 seconds. The UI displayed an explicit partial-work notice; this is a failed answer check, not a pass or proof that fleet reasoning is fixed.

- The two probes used the isolated official dataset and retained user history; they do not replace the earlier 21-turn evaluation or establish fresh-session correctness. The five existing screenshots document that earlier evaluation and remain labelled accordingly.
