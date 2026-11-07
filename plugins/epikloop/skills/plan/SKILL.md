---
description: Break the spec into epics and tiered stories, freeze the MVP set, and record the mode, hours per day and deadline.
argument-hint: "[--extend]"
effort: high
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" *)'
---

Outcome: `docs/stories/<epic>.md` holds every epic and story. Each story has a tier, T1 to T3,
cites its requirement IDs, and carries the spec delta it will apply. The MVP set is frozen, and
`.epikloop/project.json` records the freeze date, solo or team mode, hours per day and the
deadline. Scope: planning only; nothing is built here.

Each epic file follows this format. A script reads it for the stage, what is done and the fuel
gauge, so its headings and fields stay exactly as shown:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example stories`

Every current requirement in `spec/` is cited by at least one story. Most stories are T1; auth,
money, migrations on live data and untrusted input are T3; T2 is for a story whose quoted business
rules need tests of their own. Epics are numbered from
`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --ids`, after every number already in the history.
The first epic opens with two stories. The first adds `node .githooks/check.mjs --arm` to the
stack's install step, sets `gates.commands` in `.epikloop/project.json` where auto-detection won't
find them and, in team mode, writes the stack's setup and install into `.github/workflows/check.yml`
where it marks them. The second brings up staging. An adopted project leaves out what it has.
`After` names only the stories a story builds on. The project's lane adds this:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --lane plan`

Propose the MVP set and let the human decide it, along with solo or team mode, hours per day and
any deadline. Record them in `.epikloop/project.json` as `mvp_frozen` (today's date), `mode`,
`hours_per_day` and `deadline`, and commit them with the plan. Team mode needs a check GitHub can
require: one GitHub Actions runs, required by branch protection, which a private repository has only
on a paid plan. In team mode, once the marker says so,
`node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --refresh` lays down the check each pull request
runs, `.github/workflows/check.yml`, for the same commit, or refuses where GitHub says the branch
can't be protected; tell the human to make its check job required in the default branch's
protection. The plan's commit is the queue's baseline: in solo
mode push it when the repository has a remote, and in team mode it lands through a pull request.
The MVP set moves afterwards only through a recorded decision. With `--extend`, new epics follow
on, their stories marked `MVP: no`, and frozen epics stay as they are.
