---
description: Turn a new product idea into a living spec, by interview or from a pasted brief that leaves only the gaps to ask about.
argument-hint: "[pasted brief]"
effort: xhigh
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" *)'
---

Outcome: a greenfield product described in `spec/`, one file per capability, each requirement with
a stable ID such as `REQ-AUTH-003` and each business rule quoted verbatim, plus a new
`.epikloop/project.json`. The source is a short interview, or a brief the human pastes, in which
case only what it leaves open gets asked. Scope: product intent only; design, architecture and
planning are later stages, and nothing is written beyond `spec/` and the files `init.mjs` lays
down.

Each capability file follows this format, which a script reads, so its headings and markers stay
exactly as shown. No requirement is marked `observed`; that marker belongs to `adopt`.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example spec`

The project files come from a script. In a git repository, after `git init` in a new folder, run
`node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" --lane <lane> --mode solo`; `plan` settles the mode. It
writes the project marker and the gate files and stages them. Commit the spec with them, and the
git hooks run the gates on that commit. The lane is the one of these that fits the product:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --lanes`
