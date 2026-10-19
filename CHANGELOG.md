# Changelog

All notable changes to Epikloop are recorded here.

- The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- Each plugin follows [semantic versioning](https://semver.org/) on its own.
- Every new rule, gate, hook or skill instruction is entered with the failure it fixes and the date
  it was adopted ([constitution](CONSTITUTION.md), article 1).

## [Unreleased]

### Added

- The `epikloop` marketplace, listing two plugins: `epikloop` and `epikloop-harbor`, both at
  `0.1.0-dev.0`.
- The constitution, plus the doctrine, architecture and roadmap docs.
- Frontmatter and purpose for the core plugin's sixteen skills and its `story-worker` agent. The
  skill bodies are not written yet.
- JSON Schemas, each with an example, for `.epikloop/project.json`, the event line, the cost row and
  `~/.epikloop/config.json`.
- CI that validates the marketplace and both plugins on Linux, macOS and Windows.

### Founding rules (adopted 2026-10-19)

Each article of the constitution, with the failure it answers:

1. **Cite the failure** — rules added without a failure behind them could never be judged or
   removed.
2. **Prompt ceiling** — prompt prose grew without bound and carried its own change history, which
   the model re-read on every invocation.
3. **Retros delete** — a pipeline that only gains steps slows every project that runs it.
4. **Release cadence** — frequent releases displaced product work instead of serving it.
5. **Laws, not sentences** — the model talked itself past checkable rules written as prose.
6. **Nothing leaves the machine** — a founding commitment rather than a fix. Epikloop reads every
   repository it runs in.
7. **Node only** — shell-based tooling broke on Windows, on locales and on a missing `jq`, and cost
   more to maintain than the pipeline logic.
8. **Exact footprint** — a template-based setup copied the tool's own source, changelog and license
   into every product repository.
9. **Write for Opus 5 and later** — written-out rituals and self-verification instructions spent
   tokens and caused over-verification.
10. **Measure before tuning** — the same high effort for every story, plus per-story rituals, were
    the largest token cost, and no numbers showed it.
