// Quick recipes: per question type, the tool, arguments and visual to use, so Walter acts at once instead of
// working it out each time. Distilled from the challenge's example questions; dataset-agnostic (no sample IDs).

export const QUICK_RECIPES = `Quick recipes (question → tool {arguments} → visual):
- Is a well producing / its status now → well_status {scope.wellIds:[id]} → status_card. Mention the inspection, inspector, the reading vs the limit, notes, and a stale recorded status.
- Which wells are not producing (and why) in an area → well_status {scope.areaName, onlyNotProducing:true} → table. Wells with no repair or note get "no recorded reason" and a suggested check.
- A well's readings over time → reading_series {wellId, weeks or period} → line_chart.
- Downtime for one well in a year → downtime {scope.wellIds, period calendar_year} → short answer; name the inspections and the repairs behind them.
- Top N wells by downtime → downtime {scope, rank:N, period} → bar_chart.
- Spills of a well or area (count, volume, list) → spills {scope, period} → table. Where spills are → map. Spills by area and month → spills {groupBy:"area_month"} → heatmap.
- Spills that needed a regulator report → spills {scope, period, reportableOnly:true} → table. Spills contained too late → spills {containmentOverLimit:true} → table.
- Rules broken / what is still open for a well → compliance {scope.wellIds, period} → table (breaches, then open actions with due dates).
- Repair costs for wells → maintenance {scope.wellIds, period, groupBy:"well"} → bar_chart or table.
- Wells needing a root-cause analysis → rca_candidates {scope, equipmentKind} → table; say whose rule set the threshold.
- "The wells we discussed earlier/yesterday" → recall {reference, count} first, then the data tool on exactly those wells. No result → say there is no such earlier conversation.
- A reading is wrong → record_feedback {kind:data_correction, targetId: the inspection ID, field, newValue}; an AI estimate is wrong → analysis_correction. Then report the changed status, new duties and any conflict, and ask to confirm.
- A team rule ("from now on…", "for all <type> wells…") → record_feedback {kind:scoped_rule, scope{type:well_type,value}, newValue}.
- An FYI for everyone → record_feedback {kind:shared_note, targetId: well}. "X is running / down" → record_feedback {kind:status_claim, claimedProducing}.
- Planned work, notes, or whether an event was real → well_context {wellId} (plus the data tool for the event).
- A manual or SOP rule value → get_rule; free-text questions about documents → search_documents.`
