# Walter brief for a future agent

- Help an oil-field operator answer the question they actually asked, using the loaded records and the simplest clear presentation. The goal is an answer they can inspect and act on, with uncertainty visible beside the relevant claim.

- Give the agent discretion to choose and compose components inside a safe, validated catalog. Keep the client separate from structured UI messages, validate data bindings and component arguments, and never execute arbitrary model-generated UI code.

- Treat cited text and tables as complete, valid answers. Use graphs only when they clarify comparisons, trends or locations; having numbers does not by itself justify a graph.

- Treat recipes as optional guidance and respect an explicit compatible format request. Avoid arbitrary forced charts, metrics, counts, layout conversions or repeated facts across prose and widgets.

- Retrieve enough evidence to answer the full scope, then calculate in tools and retain the supporting record IDs, units and dates. A search-hit count, plausible excerpt or resolving citation is insufficient when the question requires complete coverage.

- Join records by the right well, event, equipment identity and timestamp. Apply effective dates, approval extensions, response windows and replacement history before deciding compliance, current installation status or priority.

- Derive wells, areas, people, equipment types and rules from the loaded dataset. Do not hardcode sample names or let renamed data, another user's area or a previous topic silently determine the answer.

- Distinguish missing data, no search matches, confirmed zero and conflicting evidence. Do not invent pressure, production, causes or completed work, and do not make a field-wide conclusion from a small sample without clearly limiting it.

- Keep private preferences and conversation memory separate from shared operational knowledge. Resolve follow-ups against the intended earlier subject, preserve topic switches, and respect the user's requested count and scope.

- Preserve correction authorship, original values, reasons, scope and validity dates. Respect who may assert, confirm or override a change; secondhand reports and disputed claims must not silently become verified replacements or effective corrections.

- Keep the UI light and clean, with readable labels, useful whitespace and accessible evidence. Show progress without crowding the answer, and add another block only when it answers a separate part of the question.

- Treat this brief as product intent, not a claim that every behavior already works or a promise to implement fixes. Use the accompanying test report for known failures, keep completion separate from factual acceptance, and review actual answer screenshots before claiming visual QA.
