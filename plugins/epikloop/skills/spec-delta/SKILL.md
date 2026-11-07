---
description: Apply a story's spec delta to spec/ in the same commit as the story's code.
user-invocable: false
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
---

Outcome: `spec/` describes the product as it stands once the story lands, because the story's
delta is applied in the same commit as its code. Scope: the delta the story declares, and any
requirement the story's code makes untrue, changed with it; any other change to the spec is a
finding for the queue.

Each delta line acts on one requirement under its stable ID, which is never renumbered or reused.
`add` writes a new requirement into the capability file that holds its CODE, or into a new
capability file when none does. `change` rewrites the requirement in place. `retire` adds
`Status: retired` as its first line and leaves it standing, so its ID is never taken again.
Business rules stay quoted verbatim with their source, and a change to how the product is built
also updates `spec/architecture.md`. A script reads these files, so headings and markers follow
this format exactly:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example spec`
