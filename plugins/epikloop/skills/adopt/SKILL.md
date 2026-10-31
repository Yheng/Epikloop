---
description: Bring an existing codebase into Epikloop with an observed spec and architecture, gate config from its own commands, and a confirmation batch.
effort: xhigh
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" *)'
---

Outcome: an existing codebase becomes an Epikloop project without any change to what it does.
`spec/` describes it as it is: each capability's requirements marked `observed`, and
`spec/architecture.md` holding the stack, schema, API and hosting as built. The gates run the
project's own commands and pass on its code as it stands, and a confirmation batch with the human
turns the observed requirements into current ones. Scope: describing and gating what exists;
changing product behaviour is for planned stories.

Read the code first. Propose the lane, `web` for a product people use in a browser or `service`
for an API, a command-line tool or a job, and the mode, `team` when the repository merges through
pull requests and `solo` otherwise, and write nothing until the human confirms both. Then run
`node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" --lane <lane> --mode <mode>`, which writes the project
marker and the gate files and stages them.

Each capability file follows this format, which a script reads, so its headings and markers stay
exactly as shown. Every requirement adopt writes carries `Status: observed`, and each business
rule is quoted from the code or its documents, with its source.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example spec`

Where staging exists, its URL goes in `.epikloop/project.json` as `staging_url`. Run the full gates
on the code as it stands: `scripts/check.sh` from Bash, or `node .githooks/check.mjs` from
PowerShell. Set `gates.commands` for any of lint, typecheck, test, build and e2e that the project
runs with a command auto-detection didn't find, and in solo mode list its existing workflows in
`gates.allow_workflows`. A gate that fails on today's code stops the adoption before it commits:
name the failing commands, and leave the choice to the human, to fix the code or narrow the
command. Once the gates pass, commit and land the adoption.

The confirmation batch: while `spec/` holds observed requirements, put them to the human a few at a
time. A confirmed one loses its `Status:` line, a corrected one is rewritten and then confirmed,
and one the product shouldn't keep becomes `Status: retired`. One decision records the batch,
numbered from `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --ids`, in this format:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example decisions`

Commit the spec and the decision together, and land the commit.
