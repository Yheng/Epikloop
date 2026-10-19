---
description: Apply a story's spec delta to spec/ in the same commit as the story's code.
user-invocable: false
---

Outcome: `spec/` describes the product as it stands after the story, because the delta the story
carries is applied in the same commit as its code. Requirements are added, changed or retired
under their stable IDs, business rules stay quoted verbatim, and `spec/architecture.md` stays
current. Scope: the delta the story declares; anything beyond it is a finding for the queue.
