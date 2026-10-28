# Architecture

How Epikloop fits together. The decisions described here are settled: to change one, open an issue
and make the case first. The rules for changing Epikloop itself are in the
[constitution](../CONSTITUTION.md).

## Where things live

```
YOUR MACHINE                          PRODUCT REPO (what a teammate clones)       GITHUB
───────────────────────────────       ──────────────────────────────────────      ────────────────────────
epikloop plugin (user scope)          .epikloop/project.json                      origin/main
  skills/  agents/  hooks/            spec/<capability>.md, spec/architecture.md    (staging deploys from
  bin/  lanes/  templates/            design/ (brief, directions/, screens/,          main via the host's
                                               tokens.css, manifest.md)             git deploy)
~/.epikloop/                          docs/stories/, docs/decisions.md,
  events/         append-only log            docs/queue.md                         team mode only:
  projects/<id>/  cost rows, state    scripts/check.sh + .githooks/                  .github/workflows/check.yml
  config.json     effort, harbor      CLAUDE.md (project rules only)                 (required PR check)

epikloop-harbor plugin (optional)
  local server + prebuilt client
```

- Both plugins install at user scope from this repository's marketplace. Nothing of the tool is
  committed into a product repo beyond [the footprint](#the-product-repo-footprint).
- All state lives in files, in the product repo or under `~/.epikloop/`, never in a conversation. A
  power outage, a new teammate or a six-week pause recover the same way.
- There is no status line; Claude Code's default is enough.
- Nothing leaves the machine: no telemetry, and no network calls from hooks or Harbor.

## The product repo footprint

Epikloop owns exactly these files in a product repo:

- `.epikloop/project.json`
- `spec/`
- `design/`
- `docs/` (stories, decisions, queue)
- `scripts/check.sh` and `.githooks/`
- `CLAUDE.md` (project rules only)
- the one entry in the stack's install step that arms `.githooks/`
- `.github/workflows/check.yml`, in team mode only

Nothing else, ever.

- **The project marker.** `.epikloop/project.json`
  ([schema](../plugins/epikloop/schemas/project.schema.json)) makes the project self-describing,
  so teammates get identical behaviour. It holds:
  - the format version, project id, lane and mode
  - effort overrides and the MVP freeze date
  - the ETA inputs and the staging URL
  - the gate configuration
- **Project id.** It is derived once, when the project is created: the first 12 hex digits of the
  SHA-256 of the normalized git remote (`host/owner/repo`, lowercased), or of the repository path
  when there is no remote. It is committed, so a moved or re-cloned repo keeps its state.
- **`CLAUDE.md`** holds project rules only and stays under 200 lines. The pipeline protocol is never
  written into it; the SessionStart hook injects it.
- **Teammates are gated too.**
  - `.githooks/` holds the gate runner, `check.mjs`, and the two-line `pre-commit` and `pre-push`
    hooks that run it. The stack's install step arms them.
  - `scripts/check.sh` (the name is brand-free) is a two-line sh shim that runs the same runner by
    hand and in CI.
  - All of it works in a plain clone without the plugin, which teammates' git hooks and the
    team-mode CI check need.
- **Solo or team.** Team mode is the standard; solo is supported.
  - Team mode adds exactly one GitHub workflow. It runs the same `check.sh` on pull requests
    (10-minute timeout, cancel-in-progress) as a required check under branch protection.
  - Solo mode creates no workflow, and `check.sh` fails if a workflow appears that
    `gates.allow_workflows` doesn't list.

## Hooks

The core plugin's `hooks/hooks.json` is the backbone. Every command hook follows four rules:

- It is written in exec form (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/…"]`), which
  runs without a shell on all three operating systems.
- It prints nothing to stdout but its JSON answer, because SessionStart stdout lands in Claude's
  context.
- It exits 0.
- It never registers `WorktreeCreate` or `WorktreeRemove`. A `WorktreeCreate` hook replaces git's
  worktree creation.

What each event does:

- **SessionStart.** This hook runs inside an Epikloop project, meaning the working directory or an
  ancestor has `.epikloop/project.json`.
  - It injects two things as `additionalContext`: a one-line briefing (stage, fuel gauge, what needs
    the human, next command) and the pipeline protocol (the question protocol and the
    source-of-truth rules).
  - The text is written as plain facts. It stays under the 10,000-character cap; past the cap Claude
    sees only a 2,000-character preview.
  - Outside a project, it injects one line: "Not an Epikloop project. `/epikloop` to start."
  - It never starts an interview unprompted.
  - It arms `.githooks/` by setting `core.hooksPath`, and only when that is unset and no other
    tool's hooks are present.
    - It arms only a repository that carries the runner, and runs the plugin's own copy of the
      runner's `--arm`, so no code from the repository runs at session start.
    - When another tool owns the hooks, the briefing names it as something that needs the human.
  - It is `bin/brief.mjs`, a spawned hook. Every source gets the same answer, so `compact` and
    `clear` get the protocol back.
- **PreToolUse: the guard.** This is one spawned, synchronous hook, registered on `Bash|PowerShell`
  only.
  - Both tools are covered because on Windows without Git Bash there is no Bash tool, and PowerShell
    is on by default for claude.ai and Console accounts.
  - It acts only inside an Epikloop project, found the way SessionStart finds one. Elsewhere it
    gives no answer.
  - It sets `onFailure: "block"`, so a crash fails closed.
  - It denies first, with a reason: `git … --no-verify`, `git commit -n`,
    `git push … -f/--force/+ref/--delete`, `git reset --hard`,
    `git switch -f/--discard-changes`, hooks-path overrides, `git clean -f`, `git checkout -- .`
    and `git restore .`.
  - It then allows the pipeline's own ceremony: the gate runner,
    `git status/diff/log/fetch/add/commit/push/switch/tag/branch`, `gh issue/pr`, and the active
    lane's UI test tool. Merging and deleting are left out: `gh pr merge/close`,
    `git branch -d/-D` and `git tag -d`.
  - The gate runner is `scripts/check.sh` from Bash, and `node .githooks/check.mjs` from
    PowerShell, which on Windows opens a `.sh` file in Git Bash instead of running it.
  - It allows a command only when every part of it is on that list, and nothing in it substitutes
    or redirects, gives git a global option or a URL, or runs a program through a git option.
  - A plugin can't ship a permissions allowlist, so this hook is how the pipeline runs without
    prompts in default, acceptEdits and dontAsk modes. Plan mode and the user's own deny and ask
    rules still apply.
- **PostToolUse** only emits. It can't shorten the logs that matter: a failing command fires
  `PostToolUseFailure`, which can't replace output. Claude Code already truncates long successful
  output, and `check.sh` keeps its own output to failures plus a one-line summary.
- **Other events** only emit: SubagentStart, SubagentStop, TaskCreated, TaskCompleted,
  PermissionRequest, Notification, Stop and SessionEnd. On Stop, a `systemMessage` adds a one-line
  nudge when questions are waiting, without making Claude continue.

No blocking hook is registered on any non-shell tool.

### The emitter

The emitter writes the event log and the cost rows; Harbor only reads what it writes.

- It writes only inside an Epikloop project.
- It never checks whether Harbor is on, because writing an event is cheaper than checking.
- Hook input carries no timestamps, tokens or cost, so the emitter stamps time from its own clock.

The emitter is a hooks module: plain JavaScript that runs inside Claude Code's process, with no
build step and no dependencies. `hooks/hooks.json` names it under `modules`, beside the command
hooks above, and it handles every event that only emits. A spike, the first task of milestone 1,
verified on Claude Code 2.1.303 that such a module loads on a user-scope install, runs on Linux,
macOS and Windows, and reads session cost.

- **Events.** It uses a native module event wherever one exists. `task.created`, `task.completed`
  and `notification` have none, so they come from `classic.*` hooks.
- **Writes.** A module can't append, so each event is one small JSON file in
  `~/.epikloop/events/YYYY-MM-DD/`. The module finds home as Node's `os.homedir()` does:
  `USERPROFILE` on Windows, `HOME` elsewhere.
- **No waiting.** Its tool hooks pass each call on at once and never wait on a write.
- **Compaction.** Harbor and `doctor` fold each day's folder into `events/YYYY-MM-DD.jsonl` with a
  Node append, then delete what they folded. A file that doesn't parse yet is left for the next
  pass, because a module's writes aren't atomic.
- **Cost rows.** A story's `cost` is the rise in the session's cost total, read with
  `$.session.usage()`, from the worker's start to its end. `model` comes from the worker's
  `turn.complete`, `wall` from the module's clock, and `tier` and `effort` from the story. Each
  row is written as a file too, and folded into `projects/<id>/cost.jsonl` the same way.
  - This assumes a foreground, sequential worker, as in M1. With parallel workers the rise is
    shared, so a row's `cost` is an upper bound until M3 settles it.

The module has these limits:

- On a subscription, `cost` is a list-price equivalent, not money spent.
- No module loads under `--bare` or `--safe-mode`, under a managed policy that turns mods off, or
  while Claude Code's rollout switch for mods is off. There, no events or cost rows are written.
  Under `--bare` and `--safe-mode` no plugin hook runs at all, command hooks included.
- Where an organization manages Claude Code, `classic.*` hooks in a plugin a person installs don't
  run, so `task.created`, `task.completed` and `notification` are not emitted. `doctor` reports
  this, and reports when mods can't load on the machine.

The gates' self-test measures two targets:

- no blocking hook on non-shell tools
- blocking time per shell command: median under 150 ms on Windows, max reported. Spawning Node
  alone takes roughly 110–140 ms there.

### Event log and cost rows

- **`~/.epikloop/events/YYYY-MM-DD.jsonl`** has one line per event
  ([schema](../plugins/epikloop/schemas/event.schema.json)).
  - Fields: `format`, `ts`, `project_id`, `cwd`, `session_id` and `kind`, plus optional `story`,
    `tool`, `agent`, `state` and `detail`.
  - Kinds: `session.start|end`, `tool.pre|post`, `subagent.start|stop`, `task.created|completed`,
    `permission.requested`, `notification`, `stop`, `story.started|committed`,
    `gate.passed|failed`, `question.parked`, `decision.recorded` and `phase.tagged`.
  - Events say where, never what: no tool output, prompts, file contents or secret values.
- **`~/.epikloop/projects/<id>/cost.jsonl`** has one row per closed story
  ([schema](../plugins/epikloop/schemas/cost-row.schema.json)): `ts`, `story`, `tier`, `wall`,
  `cost`, `model` and `effort`. The rows are the instrument for tuning effort.
- **`~/.epikloop/config.json`** ([schema](../plugins/epikloop/schemas/config.schema.json)) holds the
  user's effort overrides and the Harbor switch.
- Claude Code transcripts are never parsed. Their format is internal and changes between versions.

## Gates

The gate runner, `.githooks/check.mjs`, runs in these modes. `scripts/check.sh` passes it its
arguments, and the git hooks run it with `--fast` before a commit and `--push` before a push.

| Mode | When | Runs |
|---|---|---|
| `--fast` | pre-commit | the shims and workflow laws, secrets in what is staged, the token gate, lint, typecheck |
| full | per story | the above plus tests and build, with secrets in the working state, untracked files included |
| `--push <remote> <url>` | pre-push | full, with secrets in every outgoing commit |
| `--deep` | retro | full plus end-to-end tests |
| `--self-test` | every retro, and CI | known-bad and known-good samples for each gate, and mutations of the secret scan, so a gate that fails open is noticed |

One more flag, `--arm`, is the install step's entry. It sets `core.hooksPath` to `.githooks`. It
never fails an install, and it leaves alone anything another tool owns.

How the gates run:

- **Commands.** Stack commands come from `gates.commands`. Auto-detection for Node, Python, Go and
  Rust fills any blanks:
  - one command per gate, never a fallback chain
  - nothing that fetches
- **Caps.** Every command is capped at 10 minutes and every git call at 60 seconds.
- **Exit codes.** The runner fails unless it finishes green: the hooks and the runner set exit code
  1 first.
- **Output.**
  - Failures, then one summary line.
  - A failing command shows its last 40 lines, and its full log stays in git's own directory.
  - Everything printed is redacted: key formats, URL userinfo, and the values of ignored `.env`
    files.
- **The stamp.** A green full run stamps the working state. A push whose tips have exactly that
  tree skips tests and build; the secret scan always runs.
- **The ratchet is held.** No brownfield baselines are enforced until an adoption needs them.
- **Events.** Each gate writes a `gate.passed` or `gate.failed` event in the emitter's format, where
  `~/.epikloop/` exists.

The secret scan:

- reads git through plumbing only, so no colour, external-diff or textconv setting can blind it, and
  it fails when it can't read a diff
- covers secret files at any depth, current key formats and password-bearing database URLs
- reads added lines only, across renames, type changes and binary files, with NUL-safe paths
- reads every outgoing commit at push, the root commit and merges included
- reports where a secret is but never what it is
- carries a canary

The token gate:

- flags literal colours and font families in source when `design/tokens.css` exists. Literal
  spacing is held until a project needs it.
- covers `rgb()` and the other colour functions, named colours, shorthand, gradients, Tailwind
  arbitrary values, and `.astro`, `.mdx`, `.mjs`, `.less` and `.sass` files
- accepts exceptions listed in `gates.token_ignore`, each with its reason
- in mobile lanes, reads the lane's theme files instead

Two laws:

- In solo mode, a workflow file that `gates.allow_workflows` doesn't list fails the gates, whether
  it is in the work tree or in a pushed tip.
- The two hooks and `scripts/check.sh` must be tracked as executable.

### Gate layers

| Layer | Gates | Bypassable by |
|---|---|---|
| 1. The plugin's PreToolUse guard | Claude, in any session | a hooks module the user installs, which can approve a call the guard denied; nothing else from inside a session |
| 2. Local git hooks → `check.sh` | anyone who installed the project | `-n`, the web editor, unarmed hooks |
| 3. GitHub required check (team mode) | everyone | nobody |

Solo mode is layers 1 and 2; team mode is all three.

Under `--bare` or `--safe-mode` no plugin hook runs, so layer 1 is absent in those sessions and
only layers 2 and 3 gate them.

## Living spec and project files

- **`spec/<capability>.md`** holds the current requirements with stable IDs (`REQ-AUTH-003`) and
  business rules quoted verbatim. `spec/architecture.md` is the current architecture.
- **`docs/decisions.md`** is append-only: `DECISION-XXX` entries with context, decision, rejected
  options, trade-offs and an implementation note.
- **`docs/stories/<epic>.md`** holds the stories. Each one cites requirement IDs and carries a spec
  delta. Closing a story applies its delta in the same commit as the code, so there is no separate
  document-sync step.
- **`docs/queue.md`** holds parked questions and backlog lines, each dated.
- **Where the spec comes from.** `discover` writes the initial spec. `adopt` reverse-engineers it,
  marking every requirement `observed` until a decide batch confirms it.
- **The todo list is derived, never stored.**
  - Solo: a story is done when a `feat(X.X):` commit exists on main.
  - Team: a story is done when a merged pull request references it. Squash merges collapse
    commits, so pull request titles and `Closes #` are what count.

## Lanes

A lane is a profile inside the core plugin: `lanes/<name>.json`, plus an optional skill fragment. It
declares:

- how visual truth is stored and gated
- how UI is verified (Playwright screenshot, Maestro or Flutter integration test, contract tests)
- how staging works (host git-deploy URL, EAS preview, TestFlight or Play internal track, service
  URL)
- the perf budgets

The 1.0 lane set is `web`, `service` (which skips design), `mobile-expo` and `mobile-flutter`.
Native iOS and Android are community lanes. Contributors add lanes without touching skills, and
`/epikloop:doctor` reports which lanes the machine can build.

## Skills

| Skill | Purpose | effort | Invoked by |
|---|---|---|---|
| `/epikloop` | The front door: sync, detect the stage, fuel gauge, what needs you, recommend, launch on "go". The only command to remember. | low | user, Claude |
| `/epikloop:doctor` | Verify the install and the machine; `--check` runs the gates. | low | user, Claude |
| `/epikloop:discover` | Greenfield: an interview, or a pasted brief with only the gaps asked. Writes `spec/`. | xhigh | user, Claude |
| `/epikloop:adopt` | Brownfield: observed spec, extracted tokens, gate config, confirmation batch. | xhigh | user, Claude |
| `/epikloop:design` | Three directions → pick → every screen as HTML, tokens, manifest, gallery; `amend`, `add`, `audit`, `ingest`. | high | user, Claude |
| `/epikloop:architect` | Stack, schema as code, API contract, pre-mortem, `spec/architecture.md`, lane confirmation. | max | user, Claude |
| `/epikloop:plan` | Epics, tiered stories with requirement IDs and spec deltas, the frozen MVP set; `--extend` for later work. | high | user, Claude |
| `/epikloop:epic N`, `:next`, `:story X.X` | The batch: one story-worker per story, in isolation. | medium | user, Claude |
| `/epikloop:decide` | Batch-answer parked questions, record decisions, unblock. | low | user, Claude |
| `/epikloop:triage "<what you found>"` | Human intake through the same router. | low | user only |
| `/epikloop:retro` | Phase gate: staging smoke, deep gates, self-test, queue pruning, pipeline deletion, tag; MVP sign-off in the final phase. | medium | user only |
| `/epikloop:release` | The go-live story: production, promotion, rollback note, post-launch checklist. | high | user only |
| `/epikloop:harbor on\|off\|open` | Harbor's switch and its view. | low | user only |

The two internal skills are `spec-delta`, which applies a story's spec delta, and the lane
fragments.

**The worker.** The batch's worker is a plugin subagent, `story-worker`:

- It is pinned to Opus with a one-hour prompt cache. Once its spike passes, it also gets worktree
  isolation.
- Each story spawns it with the effort for the story's tier. The defaults are T1 medium, T2 high
  and T3 xhigh.
- Overrides are set per tier. `.epikloop/project.json` takes precedence over
  `~/.epikloop/config.json`.
- The hooks module stamps each tier's effort onto the worker's spawn, by rewriting the Agent
  call's `effort` in its `tool.call` hook. No blocking hook sits on non-shell tools, so the job
  lives in the module.
- The batch starts each spawn's `description` with the story and its tier, as in
  `3.2 T2 login form`, which is how the module knows the tier.

**Frontmatter conventions:**

- `effort` is pinned per skill.
- `model` is pinned only on the worker. A skill whose model differs from the session's makes that
  turn re-read the whole conversation uncached.
- User-only ceremonies set `disable-model-invocation: true`, which also keeps their descriptions out
  of context.
- Only the front door sets `name`, because a `name` also registers a bare command.

## Stage machine

`/epikloop` walks a project from zero to production. Each stage has a mechanical done-test, and the
next step is the first one that fails, so the answer is the same after lunch or after six weeks.

1. Not a project → new product or existing code? → `discover` or `adopt`
2. `spec/` missing, or `observed` requirements unconfirmed → finish `discover` or `adopt`
3. The lane has a UI and `design/manifest.md` is missing, or `audit` reports gaps → `design`
4. `spec/architecture.md` missing → `architect`
5. No stories, or the MVP set isn't frozen → `plan`
6. Unticked MVP stories → `epic N`, or `decide` first when a question blocks or five or more wait
7. Phase complete but not tagged → `retro`
8. All MVP stories done, queue Δ ≤ 0, staging smoke green, no `mvp` tag → MVP sign-off
9. `mvp` tag, no production → `release`
10. Released → post-MVP mode: the backlog becomes visible, and `plan --extend` takes new work

## Token economy

- Effort is pinned per skill, and the global default is medium. Opus 5.5 at medium matches or beats
  Opus 5 at high.
- Model, effort and MCP servers don't change mid-batch.
  - Changing effort keeps the prompt cache on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 with an
    API key or a subscription. Elsewhere it costs a full cache miss.
  - Every model switch costs a full cache miss.
- Story workers run with their own small context and a one-hour cache. The orchestrator never grows
  past a few thousand tokens.
- API-key users get the one-hour main-conversation cache by setting `promptCacheTtl`, and `doctor`
  says so.
- `check.sh` prints failures and a one-line summary, never full logs.
- A product's `CLAUDE.md` stays under 200 lines, with project rules only; the protocol arrives by
  hook.
- Each story takes one screenshot per touched screen; the full visual compare runs once per epic.
- Cost rows per story are the tuning instrument: model, effort, wall time and, when available,
  dollars. The first retro of each dogfood project reviews them.

## Harbor

Harbor lives in the optional `epikloop-harbor` plugin. It reads `~/.epikloop/events/` and each
project's repo files for pipeline state.

How it is built:

- a dependency-free Node server (`http` and `fs` only) on localhost
- server-sent events to a prebuilt client
- Three.js vendored into the bundle
- procedural low-poly geometry generated in code, with a fixed isometric camera
- no asset pipeline and no Docker

There is one dock per active project, with a harbor overview, click to zoom, and a split view.

The visual vocabulary:

| Pipeline state | Harbor shows |
|---|---|
| A phase | built up as keel → frames → planking → deck → rigging |
| A committed story | a plank laid |
| Gates running | an inspector with a lantern |
| A parked question | a signal flag |
| A T3 story awaiting review | the captain at the gangway |
| A permission prompt | a bell |
| A retro | a sea trial |
| The `mvp` tag | the launch |

The loudest motion always means the human is needed.

`/epikloop:harbor on|off` flips one line in `~/.epikloop/config.json`; off means no Harbor process
exists. Later, the Bridge adds review pages on the same server (design pick, T3 diff, decide), and
they write back the same repo files the CLI writes. Nautical imagery belongs to Harbor alone; the
tool's name and docs are not nautical.

## Repository layout

| Path | Contents | Arrives |
|---|---|---|
| `.claude-plugin/marketplace.json` | The marketplace, listing both plugins | now |
| `plugins/epikloop/.claude-plugin/plugin.json` | The core manifest | now |
| `plugins/epikloop/skills/` | Sixteen skills: frontmatter and purpose now, bodies in M1 | now |
| `plugins/epikloop/agents/story-worker.md` | The worker subagent | now |
| `plugins/epikloop/schemas/` | JSON Schemas, with examples | now |
| `plugins/epikloop/hooks/`, `plugins/epikloop/bin/` | Hooks, the emitter, the guard, doctor | M1 |
| `plugins/epikloop/lanes/` | `web` and `service`; then `mobile-expo` and `mobile-flutter` | M1, M3 |
| `plugins/epikloop/templates/` | The gate runner and its hooks in `githooks/`, and `scripts/check.sh`; then `project.json`, `CLAUDE.md`, the team-mode workflow | now, M1 |
| `plugins/epikloop/evals/` | The eval suite and its fixture project, inside the plugin where `claude plugin eval` reads it | M1 |
| `plugins/epikloop-harbor/` | The manifest now; the server, client source and prebuilt `dist/` later | now, M4 |
| `docs/` | Doctrine, architecture, roadmap; the lane authoring guide with the first lanes | now, M1 |
| `.github/workflows/ci.yml` | Validation on Linux, macOS and Windows; self-test, lint and evals as they arrive | now |
