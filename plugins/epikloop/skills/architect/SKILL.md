---
description: Choose the stack and write the architecture, with the schema as code, the API contract, a pre-mortem and the confirmed lane.
effort: max
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
---

Outcome: `spec/architecture.md` describes how the product will be built: the stack, the data
schema as code, the API contract, and a pre-mortem of how the project could fail. The lane is
confirmed in `.epikloop/project.json`, and each choice that closes off an alternative is appended
to `docs/decisions.md` as a `DECISION-XXX` entry. Scope: architecture only; epics, stories and the
MVP set belong to `plan`.

Read `spec/` and `docs/decisions.md` first. Propose the stack and the lane, and write nothing until
the human confirms both. `spec/architecture.md` then holds the stack; the schema as code in the
stack's own language; the API contract for every requirement that crosses a process boundary; how
staging is hosted; and the pre-mortem, each way the project could fail paired with what guards
against it.

Each decision is appended, numbered after the last, in this format, which a script reads:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example decisions`

Set the confirmed lane in `.epikloop/project.json`, then commit.
