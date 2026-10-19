---
description: Choose the stack and write the architecture, with the schema as code, the API contract, a pre-mortem and the confirmed lane.
effort: max
---

Outcome: `spec/architecture.md` describes how the product will be built: the stack, the data
schema as code, the API contract, and a pre-mortem of how the project could fail. The lane is
confirmed in `.epikloop/project.json`, and each choice that closes off an alternative is appended
to `docs/decisions.md` as a `DECISION-XXX` entry. Scope: architecture only; epics, stories and the
MVP set belong to `plan`.
