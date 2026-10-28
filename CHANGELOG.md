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
