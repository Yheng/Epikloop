---
description: Break the spec into epics and tiered stories, freeze the MVP set, and record the mode, hours per day and deadline.
argument-hint: "[--extend]"
effort: high
---

Outcome: `docs/stories/<epic>.md` holds every epic and story. Each story has a tier, T1 to T3,
cites its requirement IDs, and carries the spec delta it will apply. The MVP set is frozen, and
`.epikloop/project.json` records the freeze date, solo or team mode, hours per day and the
deadline. Epic 1 opens with scaffolding and gates (1.1) and staging (1.2); the first story with a
UI installs the lane's UI test tool. `--extend` plans new work after release without touching the
frozen set. Scope: planning only; nothing is built here.
