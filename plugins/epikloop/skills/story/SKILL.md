---
description: Run one named story through a worker and its gates, then stop.
argument-hint: "<X.X>"
effort: medium
---

Outcome: story X.X is built, gated and committed in a `story-worker` exactly as `epic` would run
it, and the run stops with a short report. Scope: that one story, which must be unblocked; anything
it uncovers beyond its scope is parked, not done.
