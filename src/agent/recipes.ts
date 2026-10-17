// Quick recipes: per question type, the tool, arguments and visual to use, so Walter acts at once instead of
// working it out each time. Distilled from the challenge's example questions; dataset-agnostic (no sample IDs).

export const QUICK_RECIPES = `Quick recipes (question → tool {arguments} → suggested presentation). Choose another compatible presentation if it answers more clearly; an explicit user format wins:
- Is a well producing / its status now → well_status {scope.wellIds:[id]} → status_card. Mention the inspection, inspector, the reading vs the limit, notes, and a stale recorded status.
- Which wells are not producing (and why) in an area → well_status {scope.areaName, onlyNotProducing:true} → table. Wells with no repair or note get "no recorded reason" and a suggested check.
- A well's readings over time → reading_series {wellId, weeks or period} → line_chart.
- Downtime for one well in a year → downtime {scope.wellIds, period calendar_year} → short answer; name the inspections and the repairs behind them.
- Top N wells by downtime → downtime {scope, rank:N, period} → bar_chart for a compact comparison, or table when exact values and reasons matter.
- Spills of a well or area → spills {scope, period} → one metric for a requested count or total volume; table for a requested list. Where spills are → map. Spills by area and month → spills {groupBy:"area_month"} → heatmap.
- Spills that needed a regulator report → spills {scope, period, reportableOnly:true} → table. Spills contained too late → spills {containmentOverLimit:true} → table.
- Rules broken / what is still open for a well → compliance {scope.wellIds, period} → table (breaches, then open actions with due dates).
- Repair costs for wells → maintenance {scope.wellIds, period, groupBy:"well"} → bar_chart or table.
- Wells needing a root-cause analysis → rca_candidates {scope, equipmentKind} → table; say whose rule set the threshold.
- "The wells we discussed earlier/yesterday" → recall {reference, count} to identify the intended earlier subject, then retrieve current data for that subject. Keep new fleet-wide requests broad. No result means recall found no matching conversation, not proof none occurred.
- A reading is wrong → record_feedback {kind:data_correction, targetId: the inspection ID, field, newValue}; an AI estimate is wrong → analysis_correction. Then report the changed status, new duties and any conflict, and ask to confirm.
- A team rule ("from now on…", "for all <type> wells…") → record_feedback {kind:scoped_rule, scope{type:well_type,value}, newValue}.
- An FYI for everyone → record_feedback {kind:shared_note, targetId: well}. "X is running / down" → record_feedback {kind:status_claim, claimedProducing}.
- Planned work, notes, or whether an event was real → well_context {wellId} (plus the data tool for the event).
- A manual or SOP rule value → get_rule → explain the value, unit and applicability with its section citation. Free-text questions about documents → search_documents → a direct cited explanation, or a short ordered list for a procedure. Use present {blocks:[]} when prose is clearest. Never present the number of matched sections as the answer.
- Notes, who said what, or why an event happened → well_context plus relevant event records → a concise cited explanation; show the conflict if accounts disagree. Do not invent a cause when records only establish a status.
- When a chart helps, you design it: in present's view pick labelKey and valueKeys from the finding's columns yourself, set sort (value_desc for rankings, time for years/months) and limit, and use aggregate for totals per year/area/well (e.g. per-spill rows → {by:"year", op:"sum", valueKey:"volume_bbl"}).`
