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

- the emitter and the event log
- `check.sh` in Node, with its hook shims, the secret and token gates, and the self-test
- the PreToolUse guard (done; the active lane's UI test tool joins its allow list with the lanes)
  - baseline on 2026-10-20, on Windows: spawn median 128–133 ms, max 175–209 ms
- the SessionStart briefing
- the project marker and project id
- the living-spec format
- skill bodies for `/epikloop`, `doctor`, `discover`, `adopt`, `architect`, `plan`,
  `epic`/`next`/`story` (sequential workers), `decide`, `triage`, `retro` and `release`
- the `web` and `service` lanes
- CI self-test, lint and evals, on top of validation
- CI mutation check — break one guard rule in a copy and expect the self-test to fail
- a plugin eval suite with a fixture project
- the lane authoring guide
- this repository's own law checks:
  - prompt ceiling
  - no `.sh` beyond the shims
  - no network calls in hook or Harbor code
  - DCO sign-off on every commit
  - no AI co-author trailers

**Open questions to settle along the way:**

- **Auto mode.** Does a PreToolUse `allow` skip the auto-mode classifier? Default, acceptEdits and
  dontAsk modes honour it; plan mode does not.
- **Where the protocol lives.** It could be SessionStart `additionalContext` or a small committed
  `CLAUDE.md` include. Measure the token cost of each. Hook text must stay under 10,000 characters.
- **Cost-row fidelity.** Settled: the module reads the session's cost, so rows carry dollars. On a
  subscription they are a list-price equivalent, and with parallel workers an upper bound until
  M3 (see [architecture](architecture.md#the-emitter)).
- **Windows git hooks.** Git for Windows runs hook shims through its own `sh`. Confirm whether a
  `#!/usr/bin/env node` shim or a two-line `sh` wrapper calling `node` works on all three
  operating systems.
- **Worker effort.** Settled: mechanically, inside the hooks module, by rewriting the Agent call's
  `effort` in a `tool.call` hook. The spike saw the rewrite reach the subagent's requests.
- **`bin/` or `scripts/`.** claude.ai and Cowork don't install a plugin that has a top-level
  `bin/`, whose files go on the Bash tool's `PATH`. The hooks call their scripts through
  `${CLAUDE_PLUGIN_ROOT}`, and `check.sh` lives in product repos. If nothing needs `PATH`, rename
  `bin/` to `scripts/` before the first release.

**Done when:**

- Harbor's own web app has been built with Epikloop, end to end.
- An existing production repo has been adopted, end to end.

## M2 — Design phase

- direction variants and the pick
- all screens
- `amend`, `add`, `audit` and `ingest`
- the gallery
- design references

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
  stops
- the `mobile-expo` and `mobile-flutter` lanes

With the full lane set in place, the core becomes 1.0.0, and the Node floor (22 today) is revisited.

## M4 — Harbor, then the Bridge

The emitter already exists. This milestone delivers the server, the 3D scene and, later, the
Bridge's review pages.
