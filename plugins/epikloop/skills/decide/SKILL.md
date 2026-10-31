---
description: Answer the questions parked in docs/queue.md in one sitting and unblock the stories waiting on them.
effort: low
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
---

Outcome: the human answers the questions parked in `docs/queue.md` in one sitting. Each answer is
appended to `docs/decisions.md` as a decision naming the question it answers, the question leaves
the queue in the same commit, and the stories it blocked can run. Scope: questions already parked;
new findings belong to `triage`, and no product code changes here.

The waiting questions come from `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs"`; read each in
`docs/queue.md`. Put them to the human a few at a time, each with the default the loop took and
what it blocks. Keeping a default is an answer too. Some questions carry their own work:

- `Review N.M` shows the human the diff of the story's `feat(N.M):` commit before they answer.
- `Split N.M` rewrites N.M in place as the first part, keeping its ID, and adds the rest as new
  stories at the end of its epic, numbered after the last, with N.M's MVP mark and an `After`
  where they build on it.
- An answer that overturns a default a built story took adds a rework story at the end of that
  story's epic, after it, with its tier and MVP mark. A story not built yet is rewritten in place.
- The decision names every story it adds, since the MVP set moves only by a recorded decision.

Decisions are numbered from `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --ids`, and each carries
`- Answers: Q-NNN`, in this format, which a script reads:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example decisions`

Commit the decisions, the queue and any story changes together, and land the commit.
