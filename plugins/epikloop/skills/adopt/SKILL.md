---
description: Bring an existing codebase into Epikloop with an observed spec, extracted design tokens, gate config from its own commands and ratcheted gates.
effort: xhigh
---

Outcome: an existing codebase becomes an Epikloop project without breaking its build. The code is
read into `spec/` with every requirement marked `observed`, design tokens are extracted from the
existing UI, gate commands come from the project's own scripts, and the gates ratchet so they block
new errors without demanding that old ones be fixed first. Repos built on the earlier template
layout are converted in place, behind a rollback tag. It ends with one confirmation batch in which
the human confirms or corrects the observed requirements. Scope: describing and gating what
exists; changing product behaviour is for planned stories.
