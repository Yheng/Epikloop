---
description: Bring an existing codebase into Epikloop with an observed spec and architecture, gate config from its own commands, and a confirmation batch.
effort: xhigh
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/gallery.mjs")'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/gallery.mjs")'
---

Outcome: an existing codebase becomes an Epikloop project without any change to what it does.
`spec/` describes it as it is: each capability's requirements marked `observed`, and
`spec/architecture.md` holding the stack, schema, API and hosting as built. The gates run the
project's own commands and pass on its code as it stands, and a confirmation batch with the human
turns the observed requirements into current ones. Scope: describing and gating what exists;
changing product behaviour is for planned stories.

Read the code first. Propose the lane, the one of these that fits it:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --lanes`

Propose the mode too, `team` when the repository merges through pull requests and GitHub can
require its check, and `solo` otherwise. Team mode's check runs on GitHub Actions and is required
by branch protection, which GitHub gives a private repository only on a paid plan, so a project
that has decided against Actions stays solo. Write nothing until the human confirms both. Then run
`git fetch` on its own, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --lane <lane> --mode <mode>`,
which writes the project marker and the gate files and stages them. It refuses a checkout that
isn't the default branch level with its remote, and team mode where GitHub says the branch can't
be protected.

A repository with `PIPELINE_VERSION` at its root was set up from an earlier delivery template, and
adopting it converts it, from the default branch with a clean tree. `init.mjs` tags its last commit
`before-adoption`, the rollback point, which is pushed with the adoption. The template's own files
go: its version files, its session commands, hooks and status line in `.claude/`, its gate scripts,
config and stamps, and its git hooks, which `init.mjs --refresh` replaces with Epikloop's, armed
from the stack's install step by `node .githooks/check.mjs --arm`. Product tests and scripts that
run, test or read what goes, such as a gate's pass receipt, change with it, and the product's own
checks stay, run by its commands. `CLAUDE.md` is rebuilt on Epikloop's template, keeping the
project rules that still hold and none of the earlier protocol. Its requirements, architecture and API documents are
read into `spec/` with the code, and then what `spec/` holds is removed: the old PRD, architecture,
roadmap, todo, stories and verification screenshots; reference documents stay. Its decisions file
stays where it is, as the record from before the adoption, which `CLAUDE.md` names, and its quoted
business rules move into `spec/`. The adoption's commit records the conversion as a decision in
`docs/decisions.md`, numbered after the earlier record's last: what went, what stayed and where the
history is. Open issues on its tracker become backlog lines that cite their numbers.

Where the product has design tokens and screen mockups, they come into `design/` as they are, with
what they load from outside copied in beside them: `design/brief.md` from its design notes, its
`tokens.css` kept, and each mockup the default state of the screen it names, listed in `design/manifest.md` with the requirements it shows, in the format
`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example manifest` prints; then
`node "${CLAUDE_PLUGIN_ROOT}/scripts/gallery.mjs"` writes the gallery. A product already in
production stays there: `spec/architecture.md` records how it runs, deploys and rolls back, and once
the adoption has landed, `live` is tagged on it and pushed, so the project goes on after the MVP.

Each capability file follows this format, which a script reads, so its headings and markers stay
exactly as shown. Every requirement adopt writes carries `Status: observed`, and each business
rule is quoted from the code or its documents, with its source.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example spec`

Where staging exists, its URL goes in `.epikloop/project.json` as `staging_url`. Run the full gates
on the code as it stands: `scripts/check.sh` from Bash, or `node .githooks/check.mjs` from
PowerShell. Set `gates.commands` for any of lint, typecheck, test, build and e2e that the project
runs with a command auto-detection didn't find. In solo mode, list its existing workflows in
`gates.allow_workflows`; in team mode, write the stack's setup and install, as its existing CI
runs them, into `.github/workflows/check.yml` where it marks them, and tell the human to make its
check job required in the default branch's protection. A gate that fails on today's code stops the
adoption before it commits: name the failing commands, and leave the choice to the human, to fix
the code or narrow the command. Once the gates pass, commit and land the adoption.

The confirmation batch: while `spec/` holds observed requirements, put them to the human a few at a
time. A confirmed one loses its `Status:` line, a corrected one is rewritten and then confirmed,
and one the product shouldn't keep becomes `Status: retired`. Weigh a requirement against the whole
decision record, since a later decision may refine an earlier one, and put one whose premise the
code or production contradicts as a correction rather than offering to confirm it. One decision records the batch,
numbered from `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --ids`, in this format:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example decisions`

Commit the spec and the decision together, and land the commit.
