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
