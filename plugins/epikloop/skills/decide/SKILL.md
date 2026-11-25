---
description: Answer the questions parked in docs/queue.md in one sitting and unblock the stories waiting on them.
effort: low
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
---

Outcome: the human answers the questions parked in `docs/queue.md` in one sitting. Each answer is
appended to `docs/decisions.md` as a decision naming the question it answers, the question leaves
the queue in the same commit, and the stories it blocked can run. Scope: questions already parked;
new findings belong to `triage`, and no product code changes here.

The waiting questions come from `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; read each in
`docs/queue.md`. Put them to the human a few at a time, those marked `Severity: high` first, each
with the default the loop took and what it blocks. Keeping a default is an answer too. Some
questions carry their own work:

- `Review N.M` holds a reviewer's record of that story. Each finding goes to the human on its own,
  in plain words: where it is, what happens and what it risks. A finding ends as a rework story or
  as accepted as built, and one that isn't high may end as a backlog line; the decision records
  each finding's end. A review that found nothing is closed by keeping its default.
- `Split N.M` rewrites N.M in place as the first part, keeping its ID, and adds the rest as new
  stories at the end of its epic, numbered after the last, with N.M's MVP mark and an `After`
  where they build on it.
- An answer that overturns a default a built story took, or sends a finding to rework, adds a
  rework story at the end of that story's epic, after it, with its tier and MVP mark and
  `- Reworks: N.M` as its last field. A story not built yet is rewritten in place.
- The decision names every story it adds, since the MVP set moves only by a recorded decision.
- A story written here keeps the form of the stories beside it, which a script reads: its fields,
  its text, then `### Spec delta` with its delta lines, or `- none` alone.

Decisions are numbered from `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --ids`, and each carries
`- Answers: Q-NNN`, in this format, which a script reads:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example decisions`

Commit the decisions, the queue and any story changes together, and land the commit.
