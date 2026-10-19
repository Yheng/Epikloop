# Contributing to Epikloop

Thanks for helping. Epikloop is small on purpose, and these rules keep it that way.

## Before you start

- Read the [constitution](CONSTITUTION.md). It governs every change.
- The decisions recorded in [docs/architecture.md](docs/architecture.md) are settled. To change one,
  [open an issue](https://github.com/Yheng/Epikloop/issues) and make the case there first.

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

  Keep each skill `description` to one sentence.

## Checking your change

Run the same checks CI runs (Claude Code 2.1.295 or later):

```
claude plugin validate . --strict
claude plugin validate plugins/epikloop --strict
claude plugin validate plugins/epikloop-harbor --strict
```

To try a plugin:

- Start a session with `claude --plugin-dir plugins/epikloop`. Repeat the flag to add Harbor.
- Run `/reload-plugins` after each edit.
- Point `--plugin-dir` at a plugin's directory; at the repository root it loads nothing.

Eval suites live inside each plugin, in `plugins/<plugin>/evals/`. From a plugin's directory:

- `claude plugin eval .` runs the whole suite.
- `claude plugin eval . --case <name> --runs 1 --ablation none` runs one case.

Every run is a real model call, charged to your plan or API key. Cases that grant Bash or
PowerShell can't run on native Windows; use Linux, macOS or WSL2.

## Commits

Every commit is signed off under the Developer Certificate of Origin below. Use `git commit -s`,
which adds a `Signed-off-by:` line with your name and email. There is no CLA.

Commits never carry AI co-author trailers such as `Co-Authored-By: Claude …`, and a commit's author
and committer are people. This applies to every contributor.

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
