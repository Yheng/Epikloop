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
template are in place. CI checks this repository's laws, lint among them, and the self-tests'
mutations, and the eval suite runs on a contributor's machine. M1 is done when Harbor's own web app
has been built with Epikloop and an existing production repo adopted, each end to end
(`docs/roadmap.md`).

## Map

- `.claude-plugin/marketplace.json` — lists both plugins by relative path.
- `plugins/epikloop/` — the core:
  - `skills/<name>/SKILL.md` — the skills
  - `agents/story-worker.md` — the worker subagent
  - `schemas/` — JSON Schemas, with `examples/`
  - `hooks/hooks.json` — the hook registrations
  - `hooks/emit.js` — the emitter, a hooks module, with its suite in `tests/emit.test.ts`
  - `scripts/guard.mjs` — the git guard, the PreToolUse hook on `Bash|PowerShell`, with its
    self-test
  - `scripts/brief.mjs` — the SessionStart briefing, which also arms a product's git hooks, with
    its self-test
  - `scripts/init.mjs` — project setup, with its self-test: writes the marker with its id and the
    gate files, and lays down `CLAUDE.md` and, in team mode, the workflow; `--refresh` brings a
    project's gate files up to the plugin's
  - `scripts/state.mjs` — reads the project files and git into the stage and the fuel gauge, and
    prints the briefs a batch, a retro and a release read, with its self-test; the briefing imports
    it
  - `scripts/smoke.mjs` — the staging smoke that `retro` and `release` run, with its self-test
  - `scripts/doctor.mjs` — the machine check behind `doctor`, which also folds the emitter's
    files, with its self-test
  - `templates/spec/` and `templates/docs/` — an example of each project file, in the formats
    `docs/formats.md` defines; the state reader's self-test parses them
  - `scripts/fold.mjs` — folds the emitter's files into `.jsonl` files, with its self-test
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
  - `evals/<case>/case.yaml` — the eval suite, one folder per case: its prompt, its run fields and
    its graders; a case that starts in a fixture project also has `scaffold.sh`, the two-line shim
    that names it
  - `evals/fixture.mjs` — builds each fixture project, a greeter repository at the stage a case
    starts from, with its self-test
- `plugins/epikloop-harbor/` — a manifest only, until M4.
- `tools/` — this repository's own checks, which no plugin ships:
  - `laws.mjs` checks the mechanical rules: the constitution's, and those below for frontmatter,
    hooks, plugin paths and layout, and JSON
  - `mutate.mjs`, with its list in `mutations.mjs`, is the self-tests' mutation check
  - `evals.mjs` runs the eval suite, each case as a headless session under the machine's own
    login, with its self-test
- `CONSTITUTION.md` — the rules for changing Epikloop.
- `docs/doctrine.md`, `docs/architecture.md` (the settled decisions), `docs/formats.md` (the
  project file formats), `docs/lanes.md` (writing a lane) and `docs/roadmap.md`.

## Rules for every change

- **Settled decisions.** The decisions in `docs/architecture.md` are settled; open an issue before
  changing one.
- **Cite the failure.** A new rule, gate, hook or skill instruction needs a `CHANGELOG.md` entry
  naming the failure it fixes and the date it was adopted. No preemptive rules.
- **Laws, not sentences.** Anything mechanically checkable is a script, not a sentence in a prompt.
  `node tools/laws.mjs` checks the rules below for the prompt ceiling, shells, network calls, skill
  frontmatter, hooks, plugin paths and layout, and JSON.
- **Node, built-ins only.** Shipped scripts use Node built-ins with no runtime dependencies.
  - No bash, `jq` or `timeout`.
  - Node 22 is the floor.
  - Harbor's browser bundle may vendor libraries; the Node side may not.
- **Three operating systems.** Linux, macOS and Windows are equal targets.
  - Build paths with `path`.
  - Write hooks in exec form: `"command": "node", "args": [...]`.
  - Paths in manifests and `hooks.json` use forward slashes, because a backslash path loads on
    Windows only.
- **Plugin layout.** No plugin has a top-level `bin/`, which claude.ai and Cowork refuse to
  install. The plugin's scripts live in `scripts/`, reached through `${CLAUDE_PLUGIN_ROOT}`.
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
  - `node tools/laws.mjs` counts it, with each `!` injection replaced by what it prints. It also
    counts the product `CLAUDE.md` template, and CI fails above 700.
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
  - `effort` is pinned on every skill a person can invoke. `spec-delta`, which the worker
    preloads, has none, so it keeps the worker's tier effort.
  - `model` is pinned only on the worker agent.
  - Brackets and quotes in YAML values are quoted: a bracket or a double quote anywhere, or a
    single quote that opens the value. An apostrophe inside a word is text.
- **JSON that Epikloop writes** uses snake_case keys and a `format` version. Its schemas live in
  `plugins/epikloop/schemas/`.
- **Public text** never names the tool's predecessor, never cites internal planning documents, and
  never includes email addresses.

## Commits

- Sign off every commit for the DCO: `git commit -s`. There is no CLA.
- Never credit Claude: no `Co-Authored-By: Claude …` trailer, and no Claude author or committer
  identity. `.claude/settings.json` turns the trailer off. This applies to every contributor.
- CI checks every commit for both: a sign-off with its author's email, unless it's a merge, and
  no credit to an AI tool.
- Stage files by explicit path.

## Checks (what CI runs)

`.github/workflows/ci.yml` runs on Ubuntu, macOS and Windows, with Node 22 and a pinned Claude Code:

```
claude plugin validate . --strict
claude plugin validate plugins/epikloop --strict
claude plugin validate plugins/epikloop-harbor --strict
node plugins/epikloop/scripts/guard.mjs --self-test
node plugins/epikloop/scripts/brief.mjs --self-test
node plugins/epikloop/scripts/init.mjs --self-test
node plugins/epikloop/scripts/state.mjs --self-test
node plugins/epikloop/scripts/smoke.mjs --self-test
node plugins/epikloop/scripts/doctor.mjs --self-test
claude plugin test plugins/epikloop
node plugins/epikloop/scripts/fold.mjs --self-test
node plugins/epikloop/templates/githooks/check.mjs --self-test
node plugins/epikloop/evals/fixture.mjs --self-test
node tools/evals.mjs --self-test
node tools/laws.mjs --self-test
node tools/laws.mjs
```

A separate job on Ubuntu runs the mutation check:

```
node tools/mutate.mjs --self-test
node tools/mutate.mjs
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
- **The fixture's self-test** builds every eval fixture in a temporary folder with a home of its
  own. It reads each fixture's stage as the briefing does, runs `existing`'s tests and the gates on
  `planned`, and checks that each case's scaffold names a fixture.
- **The eval runner's self-test** loads every case, holds its YAML reader and graders to samples,
  and runs whole cases against a stand-in for `claude`. Those runs cover the fixture, the prompt,
  the tools granted, a timeout, the cost cap and the cleaned events. It makes no model call.
- **The laws** check this repository:
  - the prompt ceiling
  - a shell only as a thin shim: the `check.sh` template, and each eval case's `scaffold.sh`,
    exactly the two lines that hand a fixture's name to `fixture.mjs`
  - no network call in hook code (what `hooks.json` runs, its imports and the git hooks) or in
    Harbor
  - skill and agent frontmatter: a one-sentence description, `name` only on the front door,
    `effort` on every skill a person can invoke, `model` only on the worker, and brackets and
    quotes quoted. Frontmatter the laws can't read fails, naming its line.
  - hooks: exec form on Node, no worktree hooks, no blocking hook on a tool but a shell, and the
    guard registered with `onFailure: "block"`; forward slashes in `hooks.json` and the manifests
  - JSON formats: each schema requires a `format` version, and every key in the schemas, their
    examples and the lane profiles is snake_case, apart from `$schema` and the tiers `T1`–`T3`
  - no top-level `bin/` in a plugin, among its tracked files
  - a sign-off on every commit but a merge
  - no AI credits

  The commit laws read the whole history, so CI checks out with `fetch-depth: 0`. The laws'
  self-test runs each one over samples in throwaway folders and repos.
- **The mutation check** breaks one rule at a time in a copy of the repository and expects the
  self-tests named for it to fail.
  - It first runs those self-tests unmutated, so a failing one can't pass for a catch.
  - A mutation that survives, or whose text no longer appears exactly once, fails CI, so
    `tools/mutations.mjs` changes with the code it breaks.
  - `node tools/mutate.mjs <test>` runs one self-test's mutations.

To load a plugin for one session:

- Run `claude --plugin-dir plugins/epikloop`, and repeat the flag for Harbor.
- Run `/reload-plugins` after edits.
- Pointing `--plugin-dir` at the repository root loads nothing, and gives no error.

`claude plugin details epikloop`, with the plugin loaded, shows its projected token cost.

## Evals

The suite is in `plugins/epikloop/evals/`, in the format `claude plugin eval` reads, inside the
plugin root where it looks. From the repository's root:

```
node tools/evals.mjs              # the whole suite
node tools/evals.mjs story plan   # the named cases
```

- **Login and cost.** Runs use whatever Claude Code is logged in with, so a Claude plan is
  enough; neither Epikloop nor its evals need an API key. Every run is a real model call, and a
  pass comes to about $1.50 at list price, which a plan counts against its usage limits.
- **When.** Run the suite in each slice whose change touches model-facing text, before reporting:
  - the skills, the worker or the lanes
  - the briefing or the state reader
  - the hooks or the project file templates
  - the evals
- **Each case sets its own run.**
  - `runs: 1` and `model: claude-sonnet-5-5`; the worker keeps its pinned Opus.
  - Its graders are deterministic: `regex`, `tool_used` and `file_exists`, with no LLM judge.
- **How a case runs.** The runner starts a headless `claude -p` session in `dontAsk` mode.
  - It loads the plugin from this checkout, with no user settings, MCP servers or other plugins.
  - It grants Bash, Write and Edit, plus the read-only tools the case lists.
  - It starts in a throwaway folder: empty, or the fixture its `scaffold.sh` names.
  - Its environment is the runner's, with `PWD` set to that folder and none of the variables naming
    the Claude Code session the runner was started from, so its effort and its shell are its own.
  - There's no OS sandbox. The guard stands in front of each shell command, and the runner deletes
    what the sessions wrote to `~/.epikloop`.
  - `--cap` (default $5) stops starting runs, `--jobs` (default 3) sets how many run at once, and
    `--keep` keeps the folders and transcripts.
- **Graders that work under both runners.** They read git state from `.git/logs/HEAD`, because
  `claude plugin eval` switches git hooks off. A slash-command prompt doesn't count as a Skill
  call there.
- **`claude plugin eval`** reads the same files. From `plugins/epikloop`:
  `claude plugin eval . --ablation none --scaffold --allow-tools Bash Write Edit --max-cost-usd 5`,
  on Linux, macOS or WSL2 with `bubblewrap` and `socat`.
  - On Claude Code 2.1.316, its Linux sandbox makes the run's temporary folder and `.git`
    read-only. So the seven cases whose skills load a format or commit fail there.
  - The run's home there is itself a git repository holding the workspace. That's why a case that
    needs a repository starts in a fixture, `empty` at least.
- **Not in CI.** CI would need a Claude credential stored on GitHub. A plan token there can't be
  revoked before its year is up, so CI runs only the fixture's and the runner's self-tests, which
  make no model call.
