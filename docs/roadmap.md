# Roadmap

Each milestone is usable on its own, and nothing from a later milestone starts early.

## Versions

Each plugin follows semver on its own:

- The core plugin ships 0.x pre-releases through M1–M3 and becomes 1.0.0 when the full lane set
  lands.
- Harbor starts at 0.1.0.
- Releases are tagged `<plugin>--v<version>`.

## M1 — Core that builds a web app

**First task, done: the hooks-module spike.** All three held on 2026-10-20, on Claude Code
2.1.303:

- a plugin can ship a hooks module that loads on a user-scope install
- the module runs on Linux, macOS and Windows
- the module reads session cost

So the emitter is a hooks module (see [architecture](architecture.md#the-emitter)).

**Then:**

- the emitter and the event log (done)
- `check.sh` in Node, with its hook shims, the secret and token gates, and the self-test (done; the
  runner is `.githooks/check.mjs`)
- the guard allows `node .githooks/check.mjs` in PowerShell, and stops allowing `scripts/check.sh`
  there, where it opens Git Bash instead of running (done)
- the PreToolUse guard (done; the active lane's UI test tool joins its allow list with the lanes)
  - baseline on 2026-10-20, on the maintainer's Windows 11 laptop: spawn median 128–133 ms, max
    175–209 ms; GitHub's windows-latest runner measures ~50 ms median
- the SessionStart briefing (done: stages 1–10, the fuel gauge, the protocol and arming)
- the project marker and project id (done; `bin/init.mjs` writes the marker and the gate files)
- the living-spec format (done; [formats](formats.md), the templates, and `bin/state.mjs`, which
  reads them)
- skill bodies for `/epikloop`, `doctor`, `discover`, `adopt`, `architect`, `plan`,
  `epic`/`next`/`story` (sequential workers), `decide`, `triage`, `retro` and `release`
  - slice 1, the path to a frozen plan, is done: `/epikloop`, `discover`, `architect` and `plan`
  - slice 2, the batch, is done: `epic`/`next`/`story`, the `story-worker` body, `spec-delta`,
    `decide` and `triage`
  - slice 3, closing the loop, is done: `retro`, `release`, `adopt` and `doctor`, with the
    staging smoke, stages 8–10 and `init.mjs --refresh`, which `doctor` names when a product's gate
    files differ from the plugin's
  - stage 3, design, is held until M2 brings design's body; until then a UI lane goes on to
    `architect`
  - `adopt`'s token extraction joins with `design` in M2, and `doctor`'s Harbor check with Harbor
    in M4
- the `web` and `service` lanes (done): each a profile and a fragment, whose sections the state
  reader prints into the plan, the worker's brief and the retro's brief; the guard allows the
  lane's test runner, and `doctor` reports the lanes this machine can build
  - a web story's UI evidence is a Playwright test; the screenshot per touched screen and retro's
    full visual compare join with `design` in M2
- the team-mode workflow and the `CLAUDE.md` template (done): `init.mjs` lays both down, and
  `plan` lays the workflow down when it records team mode
  - the check runs the pre-push gates over every commit a pull request adds
  - story 1.1, or `adopt`, writes the stack's setup and install into it
  - the human makes it required in the default branch's protection
- CI self-test, lint and evals, on top of validation
- CI mutation check — break one guard rule in a copy and expect the self-test to fail
- a plugin eval suite with a fixture project
- the lane authoring guide (done: [docs/lanes.md](lanes.md))
- this repository's own law checks:
  - prompt ceiling
  - no `.sh` beyond the shims
  - no network calls in hook or Harbor code
  - DCO sign-off on every commit
  - no AI co-author trailers

**Held until observed.** Each waits for the failure that would justify it:

- **The ratchet:** brownfield baselines, held for an adoption whose old errors would fail every
  commit. Until then `adopt` stops on a gate that fails on today's code.
- **Converting repositories on an earlier template layout,** behind a rollback tag, held for the
  adoption of one.
- **Literal spacing in the token gate,** and Tailwind's spacing utilities.
- **Perf budgets in a lane,** held for a project whose performance regresses unnoticed. Harbor's
  own app vendors Three.js, so no generic web budget fits the first dogfood project.

**Open questions to settle along the way:**

- **Auto mode.** Does a PreToolUse `allow` skip the auto-mode classifier? Default, acceptEdits and
  dontAsk modes honour it; plan mode does not.
- **Where the protocol lives.** Settled on 2026-10-28: SessionStart `additionalContext`.
  - A committed `CLAUDE.md` include can't name the plugin's files, whose install path differs by
    machine and version, so the only alternative was pasting the text into `CLAUDE.md`.
  - The same 1,334 characters of briefing and protocol added 446 tokens to a session's first
    request as hook context, and 667 in `CLAUDE.md`. Measured headless on Claude Code 2.1.312
    with Sonnet, against a session without them.
  - Hook text must stay under 10,000 characters; the briefing's self-test checks every case.
- **Cost-row fidelity.** Settled: the module reads the session's cost, so rows carry dollars. On a
  subscription they are a list-price equivalent, and with parallel workers an upper bound until
  M3 (see [architecture](architecture.md#the-emitter)).
- **Windows git hooks.** Settled on 2026-10-21.
  - Git for Windows and GitHub Desktop's git run a `#!/usr/bin/env node` hook and a two-line `sh`
    wrapper alike: from PowerShell, Git Bash and a stripped PATH, with LF or CRLF.
  - Both fail closed without Node.
  - The hooks are Node files, so `scripts/check.sh` stays the one shell file.
  - The self-test's real commits and pushes confirm Linux and macOS in CI.
- **Worker effort.** Settled: mechanically, inside the hooks module, by rewriting the Agent call's
  `effort` in a `tool.call` hook. The spike saw the rewrite reach the subagent's requests.
- **`bin/` or `scripts/`.** claude.ai and Cowork don't install a plugin that has a top-level
  `bin/`, whose files go on the Bash tool's `PATH`. The hooks call their scripts through
  `${CLAUDE_PLUGIN_ROOT}`, and `check.sh` lives in product repos. If nothing needs `PATH`, rename
  `bin/` to `scripts/` before the first release.
  - Skills reach plugin scripts the same way: Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` in a
    plugin skill's body and its `allowed-tools`. The slice-1 skill bodies do so, and nothing needs
    `PATH` so far.

**Done when:**

- Harbor's own web app has been built with Epikloop, end to end.
- An existing production repo has been adopted, end to end.

## M2 — Design phase

- direction variants and the pick
- all screens
- `amend`, `add`, `audit` and `ingest`
- the gallery
- design references
- with the screens as the truth: a screenshot per touched screen at story time, and retro's full
  visual compare, the web lane's
- `adopt`'s design-token extraction

## M3 — Speed

**First, a spike:** worker subagents with worktree isolation, with the plugin's hooks firing inside
each one. It also settles per-story cost when workers run in parallel and share the session's cost
rise. Known so far:

- hooks fire inside subagents and identify them
- plugin subagents support worktree isolation
- nothing may register a `WorktreeCreate` hook

**Then:**

- parallel workers, where the dependency graph allows
- the story-size law: a worker that exceeds its file count or time budget parks "split me" and
  stops. A plugin agent's `maxTurns` is a candidate for the time budget.
- the `mobile-expo` and `mobile-flutter` lanes

With the full lane set in place, the core becomes 1.0.0, and the Node floor (22 today) is revisited.

## M4 — Harbor, then the Bridge

The emitter already exists. This milestone delivers the server, the 3D scene and, later, the
Bridge's review pages.
