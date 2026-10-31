---
description: Take the signed-off MVP live with a production environment, promotion, a rollback note and a post-launch checklist.
effort: high
disable-model-invocation: true
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/smoke.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/smoke.mjs" *)'
  - 'Bash(git pull --ff-only *)'
  - 'PowerShell(git pull --ff-only *)'
---

Outcome: the signed-off MVP runs in production, delivered as the go-live story. The production
environment exists on the host the architecture chose, the build the `mvp` tag marks is promoted
to it from staging, and how to promote and roll back is written down with a post-launch checklist.
After the release the project is in post-MVP mode, where the backlog is visible and new work comes
through `plan --extend`. Scope: going live once the MVP is signed off; product scope doesn't
change here.

What the release covers comes from a script. Run `git fetch` on its own, then
`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --release`, also on its own. It prints staging, where
the hosting is described, the evidence, the record and how it lands. When it names a git command,
run that on its own and read it again. When it says only the tag is left, placing it is the whole
release; any other reason ends it.

Read `spec/architecture.md` and set up production the way staging is hosted, with the human:
accounts, credentials, domains and anything paid are theirs to create, and secrets go into the
host, never into the repository. Production configuration that lives in the repository lands
through the gates like a story's code; in solo mode a deploy workflow is listed in
`gates.allow_workflows`. Once the signed-off build is promoted, smoke production with
`node "${CLAUDE_PLUGIN_ROOT}/bin/smoke.mjs" <production URL>`. A red smoke is fixed, or the build
rolled back, before anything is recorded.

The record: `spec/architecture.md` gains how production runs, how a build is promoted to it and how
it is rolled back, and a decision titled `Go live` records the release, with the post-launch
checklist in its implementation note, numbered as the script says, in this format:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example decisions`

Commit the record and land it. Then run `--release` again, which prints the tag once the commit is
on the default branch.
