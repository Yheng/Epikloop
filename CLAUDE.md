# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Epikloop is an agentic delivery loop for Claude Code. This marketplace distributes it as two
plugins: `epikloop` (the core) and `epikloop-harbor` (an optional local 3D view).

- It takes a product from idea, or from existing code, to production.
- It moves through discover or adopt, design, architect and plan, then runs unattended batches of
  stories that pass deterministic gates.
- Human questions are parked and answered in batches, against a frozen MVP set with a computed ETA.

This is the tool, not a product built with it.

- Product-repo files (`.epikloop/project.json`, `spec/`, `design/`, `docs/stories/`,
  `scripts/check.sh`, `.githooks/`) appear here only as templates and eval fixtures.
- This repository's own `docs/` is documentation about Epikloop.

Every skill has its body except `design` (M2) and `harbor` (M4), which have frontmatter and a
purpose paragraph only, and so does the worker. The git guard, the emitter, the gate runner, the
SessionStart briefing, project setup, the state reader, the staging smoke, `doctor`, the project
file formats, the `web` and `service` lanes, the team-mode workflow and the product `CLAUDE.md`
template are in place; the eval suite arrives with M1 (`docs/roadmap.md`).

## Map

- `.claude-plugin/marketplace.json` — lists both plugins by relative path.
- `plugins/epikloop/` — the core:
  - `skills/<name>/SKILL.md` — the skills
  - `agents/story-worker.md` — the worker subagent
  - `schemas/` — JSON Schemas, with `examples/`
  - `hooks/hooks.json` — the hook registrations
  - `hooks/emit.js` — the emitter, a hooks module, with its suite in `tests/emit.test.ts`
  - `bin/guard.mjs` — the git guard, the PreToolUse hook on `Bash|PowerShell`, with its self-test
  - `bin/brief.mjs` — the SessionStart briefing, which also arms a product's git hooks, with its
    self-test
  - `bin/init.mjs` — project setup, with its self-test: writes the marker with its id and the gate
    files, and lays down `CLAUDE.md` and, in team mode, the workflow; `--refresh` brings a
    project's gate files up to the plugin's
  - `bin/state.mjs` — reads the project files and git into the stage and the fuel gauge, and
    prints the briefs a batch, a retro and a release read, with its self-test; the briefing imports
    it
  - `bin/smoke.mjs` — the staging smoke that `retro` and `release` run, with its self-test
  - `bin/doctor.mjs` — the machine check behind `doctor`, which also folds the emitter's files,
    with its self-test
  - `templates/spec/` and `templates/docs/` — an example of each project file, in the formats
    `docs/formats.md` defines; the state reader's self-test parses them
  - `bin/fold.mjs` — folds the emitter's files into `.jsonl` files, with its self-test
  - `templates/githooks/check.mjs` — the gate runner, which product repos carry as
    `.githooks/check.mjs`, with its self-test. Beside it are `templates/githooks/pre-commit` and
    `pre-push`, and `templates/scripts/check.sh`, the shims that run it. The rest of the plugin
    copies them verbatim.
  - `templates/github/workflows/check.yml` — team mode's required check, which runs the pre-push
    gates over a pull request's commits; and `templates/CLAUDE.template.md`, a product's
    `CLAUDE.md` (named apart, since a `CLAUDE.md` here would load in this repo's sessions). The
    project edits both once `init` lays them down.
  - `lanes/<name>.json` and `lanes/<name>.md` — each lane's profile and fragment
    (`schemas/lane.schema.json`, `docs/lanes.md`); the state reader prints a fragment's sections
    into the plan and the briefs, the guard reads the profile's `ui_test.allow`, and `doctor` its
    `requires`
  - later: `evals/`
- `plugins/epikloop-harbor/` — a manifest only, until M4.
- `CONSTITUTION.md` — the rules for changing Epikloop.
- `docs/doctrine.md`, `docs/architecture.md` (the settled decisions), `docs/formats.md` (the
  project file formats), `docs/lanes.md` (writing a lane) and `docs/roadmap.md`.

## Rules for every change

- **Settled decisions.** The decisions in `docs/architecture.md` are settled; open an issue before
  changing one.
- **Cite the failure.** A new rule, gate, hook or skill instruction needs a `CHANGELOG.md` entry
  naming the failure it fixes and the date it was adopted. No preemptive rules.
- **Laws, not sentences.** Anything mechanically checkable is a script, not a sentence in a prompt.
- **Node, built-ins only.** Shipped scripts use Node built-ins with no runtime dependencies.
  - No bash, `jq` or `timeout`.
  - Node 22 is the floor.
  - Harbor's browser bundle may vendor libraries; the Node side may not.
- **Three operating systems.** Linux, macOS and Windows are equal targets.
  - Build paths with `path`.
  - Write hooks in exec form: `"command": "node", "args": [...]`.
  - Paths in manifests and `hooks.json` use forward slashes, because a backslash path loads on
    Windows only.
- **Hook behaviour.**
  - Hooks print nothing to stdout but their JSON answer, and exit 0.
  - They never register `WorktreeCreate` or `WorktreeRemove`.
  - No blocking hook goes on a non-shell tool. The guard covers `Bash|PowerShell` with
    `onFailure: "block"`.
- **Nothing leaves the machine.** No telemetry, and no network calls from hooks or Harbor.
- **The product-repo footprint is fixed** (constitution, article 8). Never add a file to it.
- **Prompt ceiling.** Model-facing text in the core plugin totals at most 700 lines.
  - Count non-blank lines, wrapped at 100 columns.
  - The count covers skill and agent bodies, their `description`s, supporting files, lane fragments
    and hook-injected text.
  - At the ceiling, delete before adding.
  - Skill text never carries history; history goes in `CHANGELOG.md`.
- **Model-facing text** follows Anthropic's guidance for Opus 5 and later:
  - general instructions rather than step lists
  - explicit scope and the full spec up front
  - a calm tone
  - no instructions to self-verify or to verify via a subagent
- **Skill frontmatter.**
  - The `description` is one sentence, because model-invocable descriptions load on every turn of
    every session.
  - Only the front door sets `name`, because a `name` also registers a bare `/<name>`.
  - `effort` is pinned per skill.
  - `model` is pinned only on the worker agent.
  - Brackets and quotes in YAML values are quoted.
- **JSON that Epikloop writes** uses snake_case keys and a `format` version. Its schemas live in
  `plugins/epikloop/schemas/`.
- **Public text** never names the tool's predecessor, never cites internal planning documents, and
  never includes email addresses.

## Commits

- Sign off every commit for the DCO: `git commit -s`. There is no CLA.
- Never credit Claude: no `Co-Authored-By: Claude …` trailer, and no Claude author or committer
  identity. `.claude/settings.json` turns the trailer off. This applies to every contributor.
- Stage files by explicit path.

## Checks (what CI runs)

`.github/workflows/ci.yml` runs on Ubuntu, macOS and Windows, with Node 22 and a pinned Claude Code:

```
claude plugin validate . --strict
claude plugin validate plugins/epikloop --strict
claude plugin validate plugins/epikloop-harbor --strict
node plugins/epikloop/bin/guard.mjs --self-test
node plugins/epikloop/bin/brief.mjs --self-test
node plugins/epikloop/bin/init.mjs --self-test
node plugins/epikloop/bin/state.mjs --self-test
node plugins/epikloop/bin/smoke.mjs --self-test
node plugins/epikloop/bin/doctor.mjs --self-test
claude plugin test plugins/epikloop
node plugins/epikloop/bin/fold.mjs --self-test
node plugins/epikloop/templates/githooks/check.mjs --self-test
```

Validating the marketplace alone skips the plugins' own files, so run all three validations.

- **The guard's self-test** spawns the guard once per sample, in projects with no lane and in a
  web and a service project that read the real lane files. It prints failures plus one summary
  line with spawn times.
- **The briefing's self-test** spawns the hook once per case, in temporary folders and throwaway
  repos. It prints failures plus one summary line with the largest context and spawn times.
- **The init self-test** runs setup in throwaway repos: remote forms, kept files, staged modes,
  arming, an unknown lane, `CLAUDE.md`, the team workflow and `--refresh`.
  - It holds the workflow template to its settled parts and its pinned gates step, and runs that
    step over a pull request whose secret a later commit removed.
  - Its last case commits through the real pre-commit hook.
- **The state reader's self-test** parses the templates and malformed files, and reads dated
  commits, tags, records and cost rows in throwaway repos into exact stages and gauges, stage 10
  included.
  - It also runs the batch's and the ceremonies' commands there: the ready list against branches,
    a bare remote and a team-mode review; a worker's exact brief; and the retro's and the release's
    briefs and tags.
  - It holds every lane file to its format, and checks `--lanes`, `--lane` and an unknown lane.
- **The smoke's self-test** smokes a server on 127.0.0.1: answers, redirects, a timeout, a closed
  port, the marker's URL, and credentials sent but never printed.
- **The doctor's self-test** runs the checks in process, against throwaway repos and homes, with a
  fake `claude`, git version and `npx`. It covers each floor, each account, the lanes this machine
  can build, the UI test tool, the hooks, the gate files, team mode's workflow, this session's
  events and the fold.
- **The plugin test** runs the emitter's suite against simulated events, with no login.
- **The fold's self-test** folds sample files in a temporary folder.
- **The gate runner's self-test** builds throwaway repos with bare remotes in a temporary folder.
  - It commits and pushes through the real hooks, and runs every gate's samples.
  - Then it checks that each mutation of the secret scan is caught.
  - CI runs it again on Node 22.0.0, the floor.

To load a plugin for one session:

- Run `claude --plugin-dir plugins/epikloop`, and repeat the flag for Harbor.
- Run `/reload-plugins` after edits.
- Pointing `--plugin-dir` at the repository root loads nothing, and gives no error.

`claude plugin details epikloop`, with the plugin loaded, shows its projected token cost.

## Evals

Suites live inside a plugin, in `plugins/<plugin>/evals/`. `claude plugin eval` doesn't read
suites outside a plugin root.

```
claude plugin eval .                                          # whole suite, from a plugin root
claude plugin eval . --case <name> --runs 1 --ablation none   # one case
```

- Every run is a real model call, billed to your plan or API key.
- CI runs need credentials and `--trust-plugin --no-publish`.
- Cases that grant Bash or PowerShell are refused on native Windows, so evals run on Linux and
  macOS.
