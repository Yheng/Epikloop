---
description: Run the next ready story through a worker and its gates, then stop.
effort: medium
---

Outcome: the next ready story, the first unblocked and unfinished one in plan order, is built,
gated and committed in a `story-worker` exactly as `epic` would run it, and the run stops with a
short report. Scope: one story; `epic` runs a batch.
