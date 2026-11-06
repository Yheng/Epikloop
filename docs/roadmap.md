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
- the project marker and project id (done; `scripts/init.mjs` writes the marker and the gate files)
- the living-spec format (done; [formats](formats.md), the templates, and `scripts/state.mjs`, which
  reads them)
- skill bodies for `/epikloop`, `doctor`, `discover`, `adopt`, `architect`, `plan`,
  `epic`/`next`/`story` (sequential workers), `decide`, `triage`, `retro` and `release`
  - slice 1, the path to a frozen plan, is done: `/epikloop`, `discover`, `architect` and `plan`
  - slice 2, the batch, is done: `epic`/`next`/`story`, the `story-worker` body, `spec-delta`,
    `decide` and `triage`
  - slice 3, closing the loop, is done: `retro`, `release`, `adopt` and `doctor`, with the
    staging smoke, stages 8–10 and `init.mjs --refresh`, which `doctor` names when a product's gate
    files differ from the plugin's
  - stage 3, design, was held until M2 brought design's body; until then a UI lane went on to
    `architect`
  - `adopt`'s token extraction joins `design` later in M2; `doctor`'s Harbor check came with
    Harbor's plugin
- the `web` and `service` lanes (done): each a profile and a fragment, whose sections the state
  reader prints into the plan, the worker's brief and the retro's brief; the guard allows the
  lane's test runner, and `doctor` reports the lanes this machine can build
  - a web story's UI evidence is a Playwright test; the screenshot per touched screen and retro's
    full visual compare joined in M2's second slice
- the team-mode workflow and the `CLAUDE.md` template (done): `init.mjs` lays both down, and
  `plan` lays the workflow down when it records team mode
  - the check runs the pre-push gates over every commit a pull request adds
  - story 1.1, or `adopt`, writes the stack's setup and install into it
  - the human makes it required in the default branch's protection
- CI self-test and lint (done), on top of validation. Lint is laws for the frontmatter, hook and
  schema rules that `CLAUDE.md` states in sentences. The evals run on a contributor's machine
  instead, since CI would need a Claude credential stored on GitHub
- the CI mutation check (done): `tools/mutate.mjs` breaks each rule in a copy and expects its
  self-test to fail, across every self-test, in its own job on Linux
- a plugin eval suite with a fixture project (done): ten cases in `plugins/epikloop/evals/`, each
  with deterministic graders, on fixtures that `fixture.mjs` builds
  - `tools/evals.mjs` runs them on any system, under the contributor's own Claude Code login, a
    plan included. They run in each slice that changes model-facing text, one run each on Sonnet
    5.5, under a $5 cap, at about $2.50 a pass at list price since M2's design cases joined.
  - `claude plugin eval` reads the same files. Its Linux sandbox (Claude Code 2.1.316) makes the
    run's temporary folder and `.git` read-only, so the cases that load a format or commit fail
    there for now.
  - CI runs the fixture's and the runner's self-tests, which make no model call
  - chained shell commands, a watch item, aren't graded yet
- the lane authoring guide (done: [docs/lanes.md](lanes.md))
- this repository's own law checks (done: `tools/laws.mjs`, in CI on all three systems):
  - prompt ceiling
  - a shell only as a thin shim: `check.sh`, and each eval case's `scaffold.sh`
  - no network calls in hook or Harbor code
  - skill and agent frontmatter
  - hooks: exec form on Node, no worktree hooks, no blocking hook on a tool but a shell, the guard
    failing closed, and forward slashes in plugin paths
  - snake_case keys and a format version in Epikloop's JSON
  - no top-level `bin/` in a plugin
  - DCO sign-off on every commit
  - no AI co-author trailers, nor AI authors, committers or "Generated with" footers

**Held until observed.** Each waits for the failure that would justify it:

- **The ratchet:** brownfield baselines, held for an adoption whose old errors would fail every
  commit. Until then `adopt` stops on a gate that fails on today's code.
- **Converting repositories on an earlier template layout,** behind a rollback tag, held for the
  adoption of one.
- **Literal spacing in the token gate,** and Tailwind's spacing utilities.
- **Perf budgets in a lane,** held for a project whose performance regresses unnoticed. Harbor's
  own page loads about 5 MB of art, so no generic web budget fits the first dogfood project.

**Open questions to settle along the way:**

- **Auto mode.** Partly settled on 2026-11-01, from Claude Code's permission-mode docs.
  - The classifier allows a batch's own commands by default: pushing to any branch of the
    repository being worked in, the default branch included, ordinary commits and local commands.
    What it blocks by default, such as a force push or `git reset --hard`, the guard already
    denies. So a batch runs unattended in auto mode.
  - Default, acceptEdits and dontAsk modes honour the guard's `allow`; plan mode does not.
  - Whether that `allow` skips the classifier isn't documented. It changes only the classifier's
    work per shell command, and the first dogfood project runs in auto mode.
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
  - The hooks are Node files, so `scripts/check.sh` stays the one shell file a product carries.
  - The self-test's real commits and pushes confirm Linux and macOS in CI.
- **Worker effort.** Settled: mechanically, inside the hooks module, by rewriting the Agent call's
  `effort` in a `tool.call` hook. The spike saw the rewrite reach the subagent's requests.
- **`bin/` or `scripts/`.** Settled on 2026-11-01: the core plugin's scripts live in `scripts/`.
  - claude.ai and Cowork don't install a plugin that has a top-level `bin/`, so Anthropic's
    directory couldn't list one.
  - All `bin/` added was its files on the Bash tool's `PATH`, which nothing used. The hooks and the
    skills reach every script through `${CLAUDE_PLUGIN_ROOT}`, which Claude Code substitutes in hook
    commands, skill bodies and `allowed-tools`.
  - The laws keep a top-level `bin/` out of every plugin.

**Done when:**

- Harbor's own web app has been built with Epikloop, end to end.
  - Started on 2026-11-01, in a private repository of its own, from a brief drawn from the
    architecture's Harbor section. Its build joined `epikloop-harbor` on 2026-11-06, as below.
- An existing production repo has been adopted, end to end.

## Harbor, between M1 and M2 (done)

Done on 2026-11-06 ([issue #5](https://github.com/Yheng/Epikloop/issues/5)).
Harbor's app was ready, and its release waited on the plugin, so it shipped ahead of the design
phase:

- `epikloop-harbor` carries Harbor's build, copied unchanged from where Harbor is built
- its start-of-session hook records where the plugin is installed and starts Harbor while the
  switch is on
- `/epikloop:harbor on|off|open`, through the core's switch, and `doctor`'s Harbor check
- the network law's two exceptions, one call each in one file of the build
- a CI check that serves the copied build from a throwaway home on Linux, macOS and Windows

The Bridge's review pages need design, so they stay in M4.

## M2 — Design phase

- **Slice 1, the design skill (done):**
  - the brief, drawn from the spec and the design references in `design/refs/`
  - direction variants and the pick, which a decision records
  - all screens, each state a file, with the tokens and the manifest
  - `amend`, `add`, `audit` and `ingest`
  - the gallery, which a script writes from the manifest
  - stage 3, for a project with nothing planned or a design it has started
    ([issue #6](https://github.com/Yheng/Epikloop/issues/6))
- **Slice 2, the screens as the truth (done):**
  - the web lane's screens spec renders each designed state at both widths, from its design file
    and from the app
  - a story's brief names the screens that show its requirements, and the story reads one
    screenshot per screen it touches beside its design
  - each retro's full visual compare reads every designed state at both widths
  - the web lane's first story with a UI loads `design/tokens.css`
- `adopt`'s design-token extraction, which also settles design for an adopted product. Until it
  lands, an adopted web product goes on to `design` as a new one does.

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

## M4 — The Bridge

Harbor shipped between M1 and M2. This milestone delivers the Bridge's review pages on Harbor's
server: the design pick, the T3 diff and decide. They write back the same repository files the CLI
writes.
