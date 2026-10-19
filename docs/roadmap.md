# Roadmap

Each milestone is usable on its own, and nothing from a later milestone starts early.

## Versions

Each plugin follows semver on its own:

- The core plugin ships 0.x pre-releases through M1–M3 and becomes 1.0.0 when the full lane set
  lands.
- Harbor starts at 0.1.0.
- Releases are tagged `<plugin>--v<version>`.

## M1 — Core that builds a web app

**First task: the hooks-module spike.** It passes when all three hold:

- a plugin can ship a hooks module that loads on a user-scope install
- the module runs on Linux, macOS and Windows
- the module reads session cost

The result decides how the emitter is built (see [architecture](architecture.md#the-emitter)).

**Then:**

- the emitter and the event log
- `check.sh` in Node, with its hook shims, the secret and token gates, and the self-test
- the PreToolUse guard
- the SessionStart briefing
- the project marker and project id
- the living-spec format
- skill bodies for `/epikloop`, `doctor`, `discover`, `adopt`, `architect`, `plan`,
  `epic`/`next`/`story` (sequential workers), `decide`, `triage`, `retro` and `release`
- the `web` and `service` lanes
- CI self-test, lint and evals, on top of validation
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
- **Cost-row fidelity.** Hooks report no cost, so real dollars depend on the hooks-module spike.
- **Windows git hooks.** Git for Windows runs hook shims through its own `sh`. Confirm whether a
  `#!/usr/bin/env node` shim or a two-line `sh` wrapper calling `node` works on all three
  operating systems.
- **Worker effort.** Should each tier's effort be stamped onto worker spawns mechanically, inside the
  hooks module, or not at all?

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
each one. Known so far:

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
