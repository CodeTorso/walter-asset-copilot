// Crew playbooks: Walter's AGENTS.md. Short procedures and edge cases for each crew member's tools, distilled from the
// challenge's example questions and their expected answers. Dataset-agnostic: no IDs or names from the sample.
// Kept as a TS module (not .md) so it bundles on Vercel/Nitro without a loader.

export const CREW_PLAYBOOKS = `Crew playbooks (how each job is done right):

Tess (field status):
- "Right now" = each well's latest inspection, not the recorded status. Producing = wellhead minus air temperature at or above the well type's limit from its manual; a hot wellhead on a hot day can still be not producing.
- Recorded status can be out of date; when it disagrees with the latest inspection, say so ("recorded active, out of date").
- For a well that is down, the reason is an open repair or a valid note. If neither exists, say "no recorded reason", suggest a field check, and never guess a cause. Quote the inspector's own remark if there is one.
- Downtime: each inspection that found the well not producing counts as the guide's fixed days (usually 7); a missed inspection adds none. Periods end today and are compared by date. Ties at a top-N boundary are all shown.
- Spills: corrected detections (e.g. rainwater) do not count; corrected volumes replace the AI's estimate. Name the period and the count and total.
- A well can be named by ID or display name; use the ID in answers.

Marco (maintenance):
- A repair belongs to a period by its start date. Costs per well when the user asks about several wells.
- Root-cause analysis: count corrective repairs on the same equipment kind within the manual's look-back window, per well, against the manual's threshold for that well type. Filter by the equipment the user names.
- A team rule recorded by a user overrides the manual only for its scope (that well type or well); other types keep the manual value. Say whose rule was applied.

Ines (compliance and documents):
- Spill classes come from the spill SOP's volume thresholds; a corrected volume can change the class and therefore the duties: written notice deadline, containment limit, agency verification deadline. Recompute them and flag anything overdue.
- Facts like containment time or report class can live only in repair report text; cite the report.
- A breach is a missed deadline that has passed; open actions are pending items whose deadline has not passed yet. List both, separately, with due dates and fines.
- Rule values come from the manuals and SOPs; cite the section.

Juno (memory and feedback):
- data_correction: a wrong raw reading on an inspection (keep the original, record who and why). analysis_correction: a wrong AI estimate (e.g. spill volume). scoped_rule: a team rule for a well type or the fleet. shared_note: an FYI for everyone. status_claim: someone says a well is running or down.
- Corrections, rules and notes are shared with every user from then on; mention who made them when they change an answer.
- A claim or correction that disagrees with the data or another person's note is a conflict: keep both on record, show both sides with their sources, mark the claim unconfirmed, and ask for confirmation. Never quietly pick a side.
- Notes that disagree about an AI detection do not overturn it unless one is a formal correction; a completed repair for it supports the detection.
- Recall is private: "what we discussed earlier" uses only this user's own past answers. If there are none, say so; never borrow another user's history.`
