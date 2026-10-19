# Epikloop

**Epikloop: an agentic delivery loop for Claude Code.** Spec it, story it, run the epic unattended
through hard gates, decide, run again, ship.

> **Status: pre-release.** This repository holds Epikloop's structure: the constitution, the plugin
> manifests, skill definitions, JSON schemas and docs. Skill bodies, hooks and gates arrive with
> milestone 1. See the [roadmap](docs/roadmap.md).

## What it is

Epikloop is an agentic delivery workflow for Claude Code, distributed as Claude Code plugins. It
takes a product to production, starting from an idea or from an existing codebase.

- It moves through a fixed set of phases: discover or adopt, design, architect, plan.
- It then runs a loop of autonomous batches of stories, and every story passes deterministic gates.
- Human questions are parked and answered in batches.
- Progress is measured against a frozen finish line, with a computed ETA.

## How it differs

Compared with Spec Kit, OpenSpec, BMAD and Superpowers, Epikloop leads with the unattended batch:

- Mechanical rules are enforced by scripts the model cannot talk past.
- The human is interrupted at most twice a day.
- Scope can only grow by a recorded human decision.

## Install

In Claude Code:

```
/plugin marketplace add Yheng/Epikloop
/plugin install epikloop@epikloop
```

Harbor, the optional local 3D view of your projects, is a second plugin:
`/plugin install epikloop-harbor@epikloop`.

## First run

Open Claude Code in a repository and run `/epikloop`. It tells you where the project stands and the
one next step: `discover` for a new product, or `adopt` for existing code. It starts that step when
you say "go". It is the only command to remember.

## Requirements

- Claude Code 2.1.295 or later
- Node 22 or later
- git

Linux, macOS and Windows are all supported.

## Documentation

- [Doctrine](docs/doctrine.md) — the principles the pipeline enforces
- [Architecture](docs/architecture.md) — how it fits together, and the settled decisions
- [Roadmap](docs/roadmap.md) — milestones and versions
- [Constitution](CONSTITUTION.md) — the rules for changing Epikloop
- [Changelog](CHANGELOG.md)

## Contributing

Contributions are welcome under the Developer Certificate of Origin; there is no CLA. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
