---
description: Run epic N as an unattended batch, one isolated worker per story, through hard gates, with questions parked instead of asked.
argument-hint: "<N>"
effort: medium
---

Outcome: every ready story in epic N is built, gated and committed without interrupting the human.
Each story runs in its own `story-worker`, given only its spec, the requirements and decisions it
cites, and the files it touches, at the effort its tier calls for; the orchestrator stays small and
keeps no story's transcript. Questions are parked in `docs/queue.md` with a conservative default
taken, findings are routed by threshold, and a story that outgrows its budget is parked as "split
me". The batch ends with the fuel gauge and what needs the human. Scope: the stories of epic N;
scope changes go to the queue, never into the batch.
