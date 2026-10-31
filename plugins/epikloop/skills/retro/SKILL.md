---
description: Close a phase with a staging smoke and click-through, deep gates, the gate self-test, queue pruning, one pipeline deletion and the phase tag.
effort: medium
disable-model-invocation: true
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/smoke.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/smoke.mjs" *)'
  - 'Bash(git pull --ff-only *)'
  - 'PowerShell(git pull --ff-only *)'
---

Outcome: the current phase closes with its evidence on record and its tag, and in the final phase
the MVP is signed off. The evidence is the deep gates, the gates' self-test, the staging smoke and
the human's click-through. The queue is pruned with the human, the cost rows are reviewed, and one
thing is deleted from the project's pipeline, or the record says why nothing qualified. Scope:
verification and pruning; new work goes to the queue through the threshold router, and no product
code changes here.

What the retro covers comes from a script. Run `git fetch` on its own, then
`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --retro`, also on its own. It prints the phase and its
stories, the evidence to gather, the queue and its delta, the cost rows, whether this retro also
signs off the MVP and what sign-off needs, the record and how it lands. When it names a git
command, run that on its own and read it again. When it says only the tags are left, placing them
is the whole retro; any other reason ends it.

Gather the evidence first; the staging smoke is `node "${CLAUDE_PLUGIN_ROOT}/bin/smoke.mjs"`, and
then the human clicks through the stories on staging. A failing gate or smoke, like anything the
human finds, is routed as a finding, and the phase isn't tagged while one breaks an MVP acceptance
criterion. Then, with the human, each backlog line is kept, dropped or turned into a parked
question. Where the cost rows show a tier's effort costing more than its stories need, or too
little to land them, propose an override for that tier; the human decides, and it goes in
`.epikloop/project.json`. Propose one deletion: a rule in `CLAUDE.md`, a gate exception or allowed
workflow, an effort override, or another part of the project's pipeline that the phase showed
costs more than it catches. Friction in Epikloop itself is an issue the human files.

The MVP is signed off only on the human's word, and only when the smoke is green and
`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs"` shows queue Δ at 0 or below after the pruning;
otherwise the record says what sign-off waits for. The record is a decision titled
`Phase N retro`, holding the evidence, the pruning, the cost review and the deletion, and one
titled `MVP sign-off` when the human signs off, numbered as the script says, in this format:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example decisions`

Commit the record with the queue and any other change, and land it. Then run `--retro` again,
which prints the tags once the commit is on the default branch.
