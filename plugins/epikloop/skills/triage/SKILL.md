---
description: Route something the human found through the same threshold router the batch uses.
argument-hint: '"<what you found>"'
effort: low
disable-model-invocation: true
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
---

Outcome: a finding the human reports lands where the threshold router sends it, and nowhere else.
Mechanical and small: fixed now, in its own commit. Needs a product call: a question parked in
`docs/queue.md` with the conservative default and what it blocks. Real but not MVP-breaking: one
dated backlog line in `docs/queue.md`. Breaks an MVP acceptance criterion: fixed now, or parked as
an explicit scope question. Nothing is filed by default. Scope: routing; fixes beyond the small
mechanical case happen in planned stories.

A parked question or backlog line takes its number and form from
`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --ids`. Commit what the routing writes, and land it.
