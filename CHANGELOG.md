# Changelog

All notable changes to Epikloop are recorded here.

- The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- Each plugin follows [semantic versioning](https://semver.org/) on its own.
- Every new rule, gate, hook or skill instruction is entered with the failure it fixes and the date
  it was adopted ([constitution](CONSTITUTION.md), article 1).

## [Unreleased]

### Added

- The `epikloop` marketplace, listing two plugins: `epikloop` and `epikloop-harbor`, both at
  `0.1.0-dev.0`.
- The constitution, plus the doctrine, architecture and roadmap docs.
- Frontmatter and purpose for the core plugin's sixteen skills and its `story-worker` agent. The
  skill bodies are not written yet.
- JSON Schemas, each with an example, for `.epikloop/project.json`, the event line, the cost row and
  `~/.epikloop/config.json`.
- CI that validates the marketplace and both plugins on Linux, macOS and Windows.
- The git guard: a PreToolUse hook on Bash and PowerShell that, inside an Epikloop project, denies
  six git usages and allows the pipeline's own commands. CI runs its self-test on Linux, macOS and
  Windows.
- The emitter: a hooks module that, inside an Epikloop project, writes one file per event under
  `~/.epikloop/events/YYYY-MM-DD/` and one cost row per story-worker under
  `~/.epikloop/projects/<id>/cost/`. It sets each story-worker's effort from its story's tier and
  keeps the worker in the foreground. `bin/fold.mjs` folds those files into `.jsonl` files. CI runs
  the module's `claude plugin test` suite and the fold's self-test on Linux, macOS and Windows.
- The gate runner. Product repos carry it as `.githooks/check.mjs`, beside two-line `pre-commit` and
  `pre-push` hooks that run it, and `scripts/check.sh` runs it by hand and in CI.
  - Its gates are the hooks' modes, solo mode's workflows, the secret scan, the token gate, and the
    stack's lint, typecheck, test, build and end-to-end commands.
  - `--arm` sets `core.hooksPath` from the stack's install step.
  - `--self-test` runs known-bad and known-good samples for every gate, and mutations of the secret
    scan.
  - CI runs the self-test on Linux, macOS and Windows, and on Node 22.0.0.
- The SessionStart briefing: a command hook that, inside an Epikloop project, arms the git hooks
  when nothing else owns them and gives Claude one line on the stage and the next step, followed
  by the pipeline protocol. Outside a project it gives one line. CI runs its self-test on Linux,
  macOS and Windows.
- Project setup, `bin/init.mjs`: given a lane and a mode, it writes `.epikloop/project.json` with
  the project id derived from the git remote, copies `.githooks/` and `scripts/check.sh` from the
  plugin's templates, stages them and arms the hooks. It never overwrites a file and never
  commits. CI runs its self-test on Linux, macOS and Windows.
- The project file formats, in `docs/formats.md`: `spec/<capability>.md`,
  `docs/stories/<N>-<slug>.md`, `docs/queue.md` and `docs/decisions.md`. Each has an example in
  `templates/spec/` or `templates/docs/`. One epic is one phase, tagged `phase-N`. A story is done
  when a commit on the default branch starts `feat(N.M):`.
- The state reader, `bin/state.mjs`. It parses those files and reads git into the stage and the
  fuel gauge, and reports each line it can't place as `file:line what`. The briefing now opens
  with the fuel gauge, covers stages 1 to 7, and names waiting questions and format problems. CI
  runs the reader's self-test on Linux, macOS and Windows.
- The state reader's command line: `node state.mjs` prints the project's state, its waiting
  questions and its unreadable lines, and `--example <name>` prints a project file's template.
- Skill bodies for the path to a frozen plan: `/epikloop`, `discover`, `architect` and `plan`. They
  run the plugin's scripts through `${CLAUDE_PLUGIN_ROOT}`, pre-approved for Bash and PowerShell,
  and receive each format by injection.
- Skill bodies for the batch. `epic`, `next` and `story` run one `story-worker` per story, and
  the worker's body is written too. `spec-delta` applies a story's spec delta, `decide` answers
  the parked questions in one sitting, and `triage` routes a finding.
- The state reader's batch commands:
  - `--ready` lists the stories a batch may start.
  - `--story` prints a worker's brief.
  - `--ids` prints the next question and decision numbers.
  - The reader also reports a question number used twice, or one a decision already answers.
- The protocol says how work lands: by a push in solo mode, and through a pull request in team
  mode.
- Skill bodies for closing the loop:
  - `retro` closes a phase and, in the final phase, signs off the MVP.
  - `release` goes live.
  - `adopt` brings in existing code with an observed spec and architecture.
  - `doctor` checks the machine.
- The stage machine's stages 8 to 10. The briefing covers all ten stages.
- The state reader's ceremony commands: `--retro` and `--release` print the briefs of those two
  skills, and, once their records have landed, the tags those records leave.
- The staging smoke, `bin/smoke.mjs`: one GET to `staging_url` or a given URL, which passes on a
  2xx answer. CI runs its self-test on Linux, macOS and Windows.
- The machine check, `bin/doctor.mjs`. It checks:
  - Node, git and Claude Code against their floors
  - the account's prompt cache
  - in a project: its files, its git hooks, its gate files and this session's events

  It also folds the emitter's files. CI runs its self-test on Linux, macOS and Windows.
- `init.mjs --refresh` copies the plugin's current gate files over a project's missing or stale
  copies, and stages them.
- The `web` and `service` lanes, each a profile, `lanes/<name>.json`, and a fragment,
  `lanes/<name>.md`, with `schemas/lane.schema.json` and the authoring guide, `docs/lanes.md`.
  - The state reader prints the active lane's Plan, Story and Retro sections into the plan, each
    story-worker's brief and the retro's brief.
  - `--lanes` lists the lanes for `discover`, `adopt` and `architect`.
  - An unknown lane is a reader problem, and `init.mjs` refuses one.
  - In a web project, the guard allows `npx playwright test`.
  - `doctor` reports the lanes this machine can build, and whether the web lane's Playwright is
    installed.
- The team-mode workflow, `templates/github/workflows/check.yml`. On each pull request it runs the
  gates the pre-push hook runs, over every commit the pull request adds, with a 10-minute timeout
  and cancel-in-progress. The stack's setup and install go where it marks them.
  - `init.mjs` lays it down in team mode, and `--refresh` lays down a missing one.
  - `plan` lays it down when it records team mode.
  - `doctor` reports a team-mode project without it.
- The product `CLAUDE.md` template, `templates/CLAUDE.template.md`, which `init.mjs` writes where a
  repository has no `CLAUDE.md`.
- This repository's law checks, `tools/laws.mjs`, which CI runs on Linux, macOS and Windows. They
  make existing rules into laws (article 5), and add no rule:
  - **the prompt ceiling** (article 2), counted with each injection replaced by what it prints
  - **one shell file**, `scripts/check.sh` (article 7)
  - **no network call** in what the hooks run, its imports, the git hooks or Harbor (article 6)
  - **a sign-off** with the author's email on every commit but a merge (the DCO)
  - **no AI credits** in any commit's author, committer, trailers or "Generated with" footer
- The self-tests' mutation check, `tools/mutate.mjs`, in its own CI job on Linux.
  - It breaks one rule at a time in a copy of the repository, and expects the self-test that
    covers it to fail. The mutations are listed in `tools/mutations.mjs`.
  - It covers every self-test, the emitter's suite and the laws.
  - A mutation that survives, or whose text no longer matches, fails CI.
  - Its first full run found a gap: no sample of the guard's showed that a pipe or a redirect after
    an allowed command is refused. The guard's self-test now has three.

### Changed

- Stage 3, design, is held until M2 brings design's body. Until then a UI lane goes from its spec
  on to `architect`.
- `adopt`'s design-token extraction is held until M2 brings `design`'s body. Converting
  repositories on an earlier template layout is held until one is adopted.
- `init.mjs` compares gate files without regard to line endings, so a CRLF checkout counts as the
  plugin's own.
- `fold.mjs` runs its self-test only when run itself, not when `doctor.mjs` imports it.
- Lane fragments reach the model through the state reader's briefs, not as internal skills
  ([issue #2](https://github.com/Yheng/Epikloop/issues/2)). `spec-delta` is the one internal skill.
- In M1 a web story's UI evidence is a Playwright test. The screenshot per touched screen and
  retro's full visual compare join with `design` in M2. Perf budgets are held until a project
  needs them.
- When a stack command fails and its output names `.githooks/` or `scripts/check.sh`, the gate
  runner adds a line: those ship as they are, so leave them out of what the command checks.

### Removed

- `gates.ratchet` in the project marker. Brownfield baselines are held until an adoption needs them.

### Founding rules (adopted 2026-10-19)

Each article of the constitution, with the failure it answers:

1. **Cite the failure** — rules added without a failure behind them could never be judged or
   removed.
2. **Prompt ceiling** — prompt prose grew without bound and carried its own change history, which
   the model re-read on every invocation.
3. **Retros delete** — a pipeline that only gains steps slows every project that runs it.
4. **Release cadence** — frequent releases displaced product work instead of serving it.
5. **Laws, not sentences** — the model talked itself past checkable rules written as prose.
6. **Nothing leaves the machine** — a founding commitment rather than a fix. Epikloop reads every
   repository it runs in.
7. **Node only** — shell-based tooling broke on Windows, on locales and on a missing `jq`, and cost
   more to maintain than the pipeline logic.
8. **Exact footprint** — a template-based setup copied the tool's own source, changelog and license
   into every product repository.
9. **Write for Opus 5 and later** — written-out rituals and self-verification instructions spent
   tokens and caused over-verification.
10. **Measure before tuning** — the same high effort for every story, plus per-story rituals, were
    the largest token cost, and no numbers showed it.

### Contributor rules (adopted 2026-10-20)

- **Forward slashes in plugin paths** — on macOS and Linux, Claude Code rejects a plugin component
  path that contains a backslash, as `path escapes plugin directory`, and loads the plugin without
  that component, so a backslash path works on Windows only. Found in Claude Code's plugin
  reference during the hooks-module spike.

### Gate rules (adopted 2026-10-20)

- **The git guard** — an audit of an earlier pipeline's gates found the model could get past them
  with git itself (skipping hooks, repointing `core.hooksPath`) and could destroy work with
  force-push, hard reset, `clean -fdx` and whole-tree checkout or restore.

### Hook rules (adopted 2026-10-21)

- **The emitter** — an earlier pipeline ran every story at the same high effort and kept no
  record of what each story cost, and its activity hooks were shell scripts that broke on Windows.
  The emitter writes the event log and a cost row per story from inside Claude Code, and sets each
  story-worker's effort from its story's tier.
- **Story-workers run in the foreground** — during the hooks-module spike on 2026-10-20, on Claude
  Code 2.1.303, an Agent call that didn't ask for the background had its spawn arrive with
  `background: true`. A cost row is the rise in the session's cost while its worker runs, so it
  holds only while the worker runs in the foreground.

### Gate rules (adopted 2026-10-21)

Most of these failures were reproduced by an audit of an earlier pipeline's gates, on 2026-09-24.
The rest come from the hook spike of 2026-10-21 and from failures the maintainer reported.

**Where the runner lives, and how it fails:**

- **The runner lives in `.githooks/check.mjs`.** JavaScript inside `scripts/check.sh` could be run
  by `sh` alone. Observed on 2026-10-21 on Windows:
  - Node refuses a `.sh` file under `"type": "module"` (`ERR_UNKNOWN_FILE_EXTENSION`).
  - PowerShell has no `sh`.
  - npm runs scripts under `cmd.exe`.
- **The hooks are `#!/usr/bin/env node` files.** On 2026-10-21, both that form and an `sh` wrapper
  ran under Git for Windows and GitHub Desktop's git: from PowerShell, Git Bash and a stripped
  PATH, with LF or CRLF. Choosing Node keeps `scripts/check.sh` the one shell file.
- **Failing is the default.** On 2026-10-21, a hook exited 0 when the runner it imported never
  settled, and again when that import failed under `--unhandled-rejections=warn`. The hooks and the
  runner now set exit code 1 before anything else.
- **Every gate runs on every commit.** The audit found that a commit that only renamed files skipped
  every gate.

**The secret scan:**

- **Secret files at any depth.** The audit found nested `.env` files, nested `secrets/` folders and
  `.dev.vars` passing the path check.
- **Current key formats.** The audit found the pattern check missing every current key format. It
  also found a password-bearing database URL passing both that check and a third-party scanner.
  - A prefixed `sk-` key needs 40 characters, because 20 flagged kebab-case class names.
  - A database URL whose host has no dot is a local service.
- **Every outgoing commit at push.** The audit found that pre-push scanned nothing and that a
  stamp exited before the scan. It also found that `log.showRoot=false` hid the root commit and
  that merges were never diffed. A merge is now read against its first parent.
- **Plumbing reads, and a read check.** The audit found `color.ui=always` and `diff.external`
  blinding the scan, and textconv output being scanned instead of the stored file.
- **NUL-separated paths.** The audit found quoted and split paths dodging the path check.
- **Where, never what.** The audit found the scan printing the matched secret into the model's
  transcript. Command output is now redacted the same way.
- **Binary files are scanned.** The audit found a NUL byte blinding the scan.
- **Added lines only.** The audit found the commit that deletes a secret blocked, because removed
  lines were read.
- **The canary.** On 2026-07-09 an earlier pipeline's secret scan silently matched nothing: grep
  read a pattern's leading dashes as options.

**The other gates:**

- **The token gate's colours and font families.** The audit found the earlier token gate:
  - missing colours in shorthands and other value positions
  - missing colour forms beyond hex
  - missing `.astro`, `.mdx`, `.mjs`, `.less` and `.sass` files
  - splitting paths that held spaces
- **The stamp compares pushed trees.** The audit found the stamp hashing code alone.
  - A stamp now covers the whole working state, the ignored env files, the runner and Node.
  - It skips tests and build only for a pushed tip whose tree it tested.
- **One command per gate.** The audit found `clippy || cargo check` masking lint failures.
- **Arming never overrides, and unarmed hooks are never silent.** The audit found that when husky
  owned `core.hooksPath`, no gate ran and nothing said so.
- **The shims law.** On 2026-10-21, git on Windows added hooks written by Node as `100644`. Git on
  Linux and macOS skips a hook that isn't executable.
- **The solo workflow law.** The maintainer reported on 2026-10-19 that on earlier projects GitHub
  Actions runs kept appearing and spending minutes after CI had been removed on purpose. Framework
  scaffolds, and the model out of habit, had added workflow files nobody asked for or reviewed.
- **A 10-minute cap on every command.** The maintainer reported a CI job on an earlier project that,
  on 2026-08-21, hung for over three hours. It spent metered minutes until someone stopped it by
  hand. The gates also run locally, so the cap applies there too.
- **The self-test and its mutations.** The audit left an open question: a gate that fails open
  produces no failure to cite. So every audit finding is now a sample the self-test must block or
  pass, and a mutation of the scan the self-test must catch.
  - A mutation counts as caught only when its own case fails on the mutated runner's report. A case
    that throws is a harness error, and fails the self-test. On 2026-10-21 a CI run had a case throw
    while its test repo was being copied; inside the mutation check, that throw would have counted
    as a catch. The self-test also turns off git's background maintenance, the likely cause.

### Gate rules (adopted 2026-10-28)

- **The guard runs the gate runner directly from PowerShell.** On 2026-10-21, on the maintainer's
  Windows machine, `.sh` files were associated with Git Bash, so `scripts/check.sh` typed in
  PowerShell would open a Git Bash window instead of running the gates in the session. This was
  read from the association and not run, because running it opens a window. From PowerShell the
  guard now allows `node .githooks/check.mjs`, and no longer allows `scripts/check.sh`.
- **The stamp's scratch index keeps the index's mtime.** On 2026-10-28 the gate runner's
  self-test failed in CI on macOS: a push whose tip lacked the change the stamped run had tested
  skipped its tests.
  - The stamp builds the working tree in a copy of the index. On Linux and macOS a copy takes a
    fresh mtime; on Windows it keeps the original's.
  - git tells a racily clean entry by the index's own mtime. So, against a newer copy, a file
    rewritten at the same size in the second its entry was written passed as unchanged.
  - The copy now keeps the index's timestamps, and a self-test case pins that timing.

### Hook rules (adopted 2026-10-28)

- **The protocol arrives by hook.** An earlier pipeline's prompt prose grew without bound (article
  2), and its template-based setup copied the tool into every product repository (article 8). So
  the protocol is injected at session start and never written into a product's `CLAUDE.md`. On
  2026-10-28 the same text added 446 tokens to a session's first request as hook context, and 667
  in `CLAUDE.md`.
- **Session start arms the hooks and says when it can't.** The 2026-09-24 audit found that when
  husky owned `core.hooksPath`, no gate ran and nothing said so. Each session now arms `.githooks/`
  when nothing else owns git's hooks, using the plugin's own copy of the runner, and the briefing
  names the owner when something does.

### Setup rules (adopted 2026-10-28)

- **Setup writes exactly the footprint.** An earlier pipeline's template-based setup copied the
  tool's own source, changelog and license into every product repository (article 8). `init.mjs`
  writes only the marker and the gate files, each from its own template, and never overwrites one
  that exists.
- **Setup stages the shims as executable.** On 2026-10-21, git on Windows added hooks written by
  Node as `100644`, and the shims gate fails them. `init.mjs` stages the three shims with
  `--chmod=+x`, so the first commit passes on every operating system.

### Format rules (adopted 2026-10-28)

- **A script reads the project's state.** An earlier pipeline's model talked itself past
  checkable rules written as prose (article 5). So each project file has a fixed format, and the
  stage, the next step and the fuel gauge are computed by `bin/state.mjs`, never by the model
  reading the files. The templates are the model's examples, and the reader's self-test parses
  them.

### Skill rules (adopted 2026-10-28)

Each entry names the doctrine principle the instruction carries. The principles were learned on an
earlier pipeline's runs on real projects, from July to September 2026.

- **The front door takes the state from the script** (article 5: the model talked itself past
  checkable rules written as prose).
- **The front door runs its sync and the state command separately.** On 2026-10-28, in a headless
  check, it chained `git remote | grep … && git fetch; node …/state.mjs` into one command. The
  `grep` part matched no rule, so the call needed approval in default mode.
- **A writer gets its format from the script.** `discover`, `architect` and `plan` inject the
  template the reader parses, so what the model writes is what the reader can count (article 5).
- **Only `adopt` marks a requirement `observed`** (doctrine 6: state lives in files). A
  requirement stays observed until a decide batch confirms it, and the stage machine sends
  observed requirements back to `adopt`.
- **`discover` lays down the project with `init.mjs`** (article 8: a template-based setup copied
  the tool into every product repository).
- **`architect` writes nothing until the human confirms the stack and the lane**, and records each
  choice that closes off an alternative as a decision (doctrine 6).
- **`plan`'s tiers** (doctrine 4, risk-tiered verification): most stories are T1. Auth, money,
  migrations on live data and untrusted input are T3. T2 is for quoted business rules that need
  tests of their own.
- **`plan` opens epic 1 with scaffolding and gates, then staging**, a split carried over from the
  earlier pipeline's runs.
- **`plan` freezes the MVP set in a commit** (doctrine 5, a frozen finish line). The freeze date,
  mode, hours per day and deadline are recorded with it. That commit is the queue's baseline, and
  the set moves only through a recorded decision.

### Skill rules (adopted 2026-10-31)

As on 2026-10-28, each entry names the principle or the failure the instruction answers.

- **The batch takes its stories, and each worker its brief, from the script** (article 5: the
  model talked itself past checkable rules written as prose). `state.mjs` computes which story is
  ready and what its worker reads; neither is judged from the files.
- **No story's text passes through the orchestrator.** The spawn prompt names the story, and the
  worker prints its own brief. An earlier pipeline's per-story rituals were its largest token
  cost (article 10), and the orchestrator must stay at a few thousand tokens.
- **A batch starts from a clean, landed default branch, and stops when a story doesn't land.**
  Until M3, workers share one working tree. Otherwise a half-built story would ride into the next
  story's commit, and a story whose commit never landed would be built twice.
- **Work lands by a push in solo mode and through a pull request in team mode** (doctrine 6: state
  lives in the repository). A story counts as done only on the default branch, so a commit that
  is never pushed leaves its story open.
- **In solo mode a T3 story parks `Review N.M`** (doctrine 4: a T3 diff gets the human's review).
  Solo mode has no pull request, so the review rides the queue and `decide`.
- **The worker reports in one line**, which is all the batch keeps (article 10, as above).
- **`decide` splits a story in place and adds rework as new stories.** Story IDs are never
  reused, and done is read from git, so a story that has landed can't be reopened.
- **`retro` and `release` take their scope and their tags from the script** (article 5, as
  above). Which phase closes, what sign-off needs, and when a tag may be placed are computed by
  `state.mjs`, not judged by the model.
- **A ceremony tags only after its record lands** (doctrine 6: state lives in the repository). A
  tag placed before its record reaches the default branch would mark a phase closed, or a product
  live, on a record that isn't there. In team mode the record waits for the human's merge.
- **The MVP sign-off is refused while queue Δ is above 0, or while the staging smoke is red**
  (doctrine 5: the ETA is fiction while the queue grows, and the finish line doesn't move without
  a record). The human's word is needed as well.
- **Every retro deletes one thing from the project's pipeline, or records why nothing qualified**
  (constitution, article 3).
- **Effort changes come from the cost rows** (article 10: measure before tuning). The retro
  proposes an override only where the rows show a tier's effort too high or too low.
- **`adopt` stops on a gate that fails on the code as it stands.** Its own commit would fail the
  pre-commit hook otherwise, and the ratchet that would baseline the old errors is held until an
  adoption needs it.
- **`release` keeps credentials and paid resources with the human, and secrets in the host**
  (doctrine 6, and the secret scan: a secret in the repository fails the gates).
- **`doctor` reports and folds, and fixes nothing.** Its fixes change the human's machine or
  settings, so the human runs them.
- **The stage line marks a next step only the human starts.** On 2026-10-31, in a headless check
  at stage 7, the front door was told "go" but couldn't start `retro`. Its frontmatter keeps the
  model from invoking it, and the front door told the human the install seemed to lack a `retro`
  skill. The state reader now reads the skill's frontmatter and adds "which only the human starts".
  On the same check, the front door then named the command for the human to type.
- **Each shell command runs on its own,** in the protocol and in the worker. On 2026-10-31, in
  headless checks, the model chained `; echo "EXIT $?"`, `2>&1` or `| tail` onto commands in the
  worker, `adopt`, `retro` (three times) and `doctor`. Claude Code refused each part no rule
  allowed, and the model reran the command alone. In an interactive session each would be an
  approval prompt, which stops a batch meant to run unattended.
- **The next decision's number comes with its file.** On 2026-10-31, in a headless check, `adopt`
  had the decisions format and the next number but not the file. It couldn't read the plugin's
  files, and said it was assuming `docs/decisions.md`. `--ids` and the ceremony briefs now name
  `docs/decisions.md`.
- **A web story's UI evidence is a Playwright test of what a person sees** (doctrine 4: a T1 story
  carries acceptance evidence). Until `design` arrives, there is no truth to compare a screenshot
  against. An earlier pipeline's per-story screenshot renders were among its largest token costs.
  So only the specs a story touched run per story, and the whole suite runs at retro.
- **No skill names a lane** (the settled design: contributors add lanes without touching skills).
  The lanes' descriptions come from `--lanes`, and each lane's guidance comes from its fragment,
  printed into the briefs ([issue #2](https://github.com/Yheng/Epikloop/issues/2)).
- **`plan` lays down the team-mode workflow when it records team mode.** `discover` sets every new
  project up in solo mode and leaves the mode to `plan`. Nothing else would lay the required check
  down for a project that chooses team mode. `--refresh` runs once the marker says team: on
  2026-10-31, in a headless check, `plan` ran it before writing the mode, and it laid nothing down
  until `plan` ran it again.
- **Story 1.1, or `adopt`, writes the stack's setup and install into the workflow.** The workflow
  is laid down before `architect` chooses the stack, so it can't know them. Without them, the
  check's lint, test and build would run on a clone with nothing installed.
- **`plan` and `adopt` tell the human to make the check job required.** A workflow blocks no merge
  until the default branch's protection requires it, and that is a GitHub setting no file holds.

### Gate rules (adopted 2026-10-31)

- **A stack command that fails on the gates' own files is told to leave them out.** On
  2026-10-31, in a headless check, story 1.1 set up ESLint, and its recommended rules failed on
  `.githooks/check.mjs`: 15 errors, with Node's globals declared.
  - A project's lint, format check or type check can cover the runner and its shim, which ship
    as they are, and `adopt` stops on a failing gate.
  - The line serves any tool that names the files it fails on. Making the runner ESLint-clean
    was rejected, since other tools and stricter configs would still flag it.

### Hook rules (adopted 2026-10-31)

- **In a web project the guard allows `npx playwright test`, but never an install** (doctrine 2: a
  batch never stops to ask). Without it, each web story's test run would wait for approval. An
  install fetches from the network, so the human approves it.

### Format rules (adopted 2026-10-31)

- **A question number is never reused.** `decide` removes answered questions, so the queue alone
  can't tell which numbers are taken. A reused number would point a decision's `Answers` at the
  wrong question. `--ids` counts the decisions' answers too, and the reader reports a reuse.
- **The closing ceremonies' records have fixed titles:** `Phase N retro`, `MVP sign-off` and
  `Go live`. The reader finds them by title, so the stage machine can tell a recorded ceremony
  that waits only for its tag.
- **`release` tags `live`.** Without a tag, stage 9 couldn't tell a released product from one
  awaiting release.
- **Until the `mvp` tag, queue Δ counts from the start of the current phase, which is the last
  MVP epic once all are tagged.** Counting from the highest tag would reset Δ to 0 the moment the
  final phase is tagged, and the sign-off condition would pass by itself.
- **A project's lane is one the plugin has.** A lane without a profile would leave the briefs and
  the guard nothing to read. So `init.mjs` refuses an unknown lane, and the reader reports one.

### Setup rules (adopted 2026-10-31)

- **`init.mjs --refresh` brings a project's gate files up to the plugin's.** `init.mjs` never
  overwrites a file, so a project set up before a runner fix kept the old runner, with no way to
  take the new one short of copying it by hand. `--refresh` touches only the four gate files, never
  the marker, and doesn't commit.
- **Gate files are compared without regard to line endings.** git on Windows may check them out
  with CRLF, which would otherwise read as drift.
- **`doctor`'s git floor is 2.23**, the first release with `git switch`, which the guard allows
  and team mode lands with.
- **The required check runs the pre-push gates over every commit a pull request adds.** A plain run
  in a fresh checkout scans no commit, since nothing is staged and nothing has changed.
  - A secret that a teammate committed past the hooks, and removed in a later commit, would pass
    unread.
  - The workflow hands the runner the pull request's head and base the way git hands a push to the
    pre-push hook, so the runner itself is unchanged.
- **`CLAUDE.md` and the workflow are laid down once, and never compared with their templates
  again.** The project edits both: its rules, and its stack's setup and install. `--refresh` lays
  down a team project's missing workflow, and never `CLAUDE.md`, which a project may delete.
- **The `CLAUDE.md` template isn't named `CLAUDE.md`.** Claude Code loads a `CLAUDE.md` from any
  folder whose files it reads, so one among the plugin's templates would load in sessions on
  Epikloop itself.
