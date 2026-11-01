# Contributing to Epikloop

Thanks for helping. Epikloop is small on purpose, and these rules keep it that way.

## Before you start

- Read the [constitution](CONSTITUTION.md). It governs every change.
- The decisions recorded in [docs/architecture.md](docs/architecture.md) are settled. To change one,
  [open an issue](https://github.com/Yheng/Epikloop/issues) and make the case there first.
- To add a lane, see [Writing a lane](docs/lanes.md).

## What a change needs

- **A cited failure.** A new rule, gate, hook or skill instruction gets a [changelog](CHANGELOG.md)
  entry naming the failure it fixes and the date it was adopted. Preemptive rules are declined.
- **The right cadence.** Prompt and process changes ship only at retro cadence. Script, lane and
  platform fixes ship any time.
- **Node, built-ins only.** Shipped scripts use Node built-ins with no runtime dependencies.
  - No bash, `jq` or `timeout`.
  - A shell appears only as a thin shim that hands off to Node.
  - Harbor's browser bundle may vendor libraries; its server may not.
- **Three operating systems.** Linux, macOS and Windows are equal targets. Build paths with `path`,
  and write hooks in exec form: `"command": "node", "args": [...]`.
- **Nothing leaves the machine.** No telemetry, and no network calls from hooks or Harbor.
- **The prompt ceiling.** Model-facing text in the core plugin totals at most 700 lines.
  - It covers skill and agent bodies and their descriptions, supporting files, lane fragments and
    hook-injected text.
  - Count non-blank lines, wrapped at 100 columns.
  - At the ceiling, delete before you add.
  - Skill text carries no history; history goes in the changelog.
- **Model-facing style.** Write for Opus 5 and later:
  - general instructions rather than step lists
  - explicit scope and the full spec up front
  - a calm tone
  - no instructions to verify one's own work, or to verify through a subagent

  Keep each skill `description` to one sentence; the laws check it.

## Checking your change

Run the same checks CI runs (Claude Code 2.1.295 or later):

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
node plugins/epikloop/evals/fixture.mjs --self-test
node tools/evals.mjs --self-test
node tools/laws.mjs --self-test
node tools/laws.mjs
node tools/mutate.mjs --self-test
node tools/mutate.mjs
```

- **`tools/laws.mjs`** checks this repository against its mechanical rules:
  - the prompt ceiling
  - a shell only as a thin shim: `scripts/check.sh`, and each eval case's `scaffold.sh`
  - no network call in hook or Harbor code
  - skill and agent frontmatter, by the rules in `CLAUDE.md`
  - hooks: exec form on Node, no worktree hooks, no blocking hook on a tool but a shell, the guard
    failing closed, and forward slashes in `hooks.json` and the manifests
  - snake_case keys and a `format` version in the schemas, their examples and the lanes
  - a sign-off on every commit but a merge
  - no AI credits

  The two commit laws read the whole history, so they fail in a shallow clone.
- **`tools/mutate.mjs`** breaks one rule at a time in a copy of the repository, and expects the
  self-test that covers the rule to fail.
  - The mutations live in `tools/mutations.mjs`. When you change code that a mutation breaks,
    change the mutation with it: one that survives, or whose text no longer matches, fails CI.
  - `node tools/mutate.mjs init` runs only the mutations that `init`'s self-test catches.

To try a plugin:

- Start a session with `claude --plugin-dir plugins/epikloop`. Repeat the flag to add Harbor.
- Run `/reload-plugins` after each edit.
- Point `--plugin-dir` at a plugin's directory; at the repository root it loads nothing.

The core plugin's eval suite is in `plugins/epikloop/evals/`: one folder per case, and
`fixture.mjs`, which builds the fixture project a case starts in. From the repository's root:

- `node tools/evals.mjs` runs the whole suite.
- `node tools/evals.mjs <case> …` runs the named cases.
- `--keep` leaves each case's folder and transcript for inspection.

Each case runs as a headless Claude Code session under whatever Claude Code is logged in with, so
a Claude plan is enough; you don't need an API key. It works on Linux, macOS and Windows alike.
Every run is a real model call. A pass comes to about $1.50 at list price, which a plan counts
against its usage limits. The sessions run as you, in throwaway folders, with no OS sandbox.

- **When.** Run the suite when your change touches model-facing text:
  - the skills, the worker or the lanes
  - the briefing or the state reader
  - the hooks or the project file templates
  - the evals

  CI doesn't run it, since that would need a Claude credential stored on GitHub.
- **A new case** needs a grader for each thing its skill promises.
- **A changed skill** may need its case's graders changed with it.
- **A new fixture** goes in `fixture.mjs`, with its expected stage in the fixture's self-test.

## Commits

Every commit is signed off under the Developer Certificate of Origin below. Use `git commit -s`,
which adds a `Signed-off-by:` line with your name and email. There is no CLA.

Commits never carry AI co-author trailers such as `Co-Authored-By: Claude …`, and a commit's author
and committer are people. This applies to every contributor. CI checks every commit for both.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
