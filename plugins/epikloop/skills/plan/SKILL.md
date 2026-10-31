---
description: Break the spec into epics and tiered stories, freeze the MVP set, and record the mode, hours per day and deadline.
argument-hint: "[--extend]"
effort: high
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
---

Outcome: `docs/stories/<epic>.md` holds every epic and story. Each story has a tier, T1 to T3,
cites its requirement IDs, and carries the spec delta it will apply. The MVP set is frozen, and
`.epikloop/project.json` records the freeze date, solo or team mode, hours per day and the
deadline. Scope: planning only; nothing is built here.

Each epic file follows this format. A script reads it for the stage, what is done and the fuel
gauge, so its headings and fields stay exactly as shown:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example stories`

Every current requirement in `spec/` is cited by at least one story. Most stories are T1; auth,
money, migrations on live data and untrusted input are T3; T2 is for a story whose quoted business
rules need tests of their own. Epic 1 opens with 1.1, which adds `node .githooks/check.mjs --arm`
to the stack's install step and sets `gates.commands` in `.epikloop/project.json` where
auto-detection won't find them, and 1.2, which brings up staging. `After` names only the stories a
story builds on. The project's lane adds this:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --lane plan`

Propose the MVP set and let the human decide it, along with solo or team mode, hours per day and
any deadline. Record them in `.epikloop/project.json` as `mvp_frozen` (today's date), `mode`,
`hours_per_day` and `deadline`, and commit them with the plan. That commit is the queue's
baseline, and the MVP set moves afterwards only through a recorded decision. With `--extend`, new
epics follow the last one with their stories marked `MVP: no`, and frozen epics stay as they are.
