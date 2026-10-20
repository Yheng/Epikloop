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

Skills currently have frontmatter and a purpose paragraph but no bodies. Hooks, scripts, lanes and
templates arrive with M1 (`docs/roadmap.md`).

## Map

- `.claude-plugin/marketplace.json` — lists both plugins by relative path.
- `plugins/epikloop/` — the core:
  - `skills/<name>/SKILL.md` — the skills
  - `agents/story-worker.md` — the worker subagent
  - `schemas/` — JSON Schemas, with `examples/`
  - later: `hooks/`, `bin/`, `lanes/`, `templates/`, `evals/`
- `plugins/epikloop-harbor/` — a manifest only, until M4.
- `CONSTITUTION.md` — the rules for changing Epikloop.
- `docs/doctrine.md`, `docs/architecture.md` (the settled decisions) and `docs/roadmap.md`.

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
```

Validating the marketplace alone skips the plugins' own files, so run all three.

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
