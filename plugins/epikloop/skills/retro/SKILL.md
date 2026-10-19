---
description: Close a phase with a staging smoke and click-through, deep gates, the gate self-test, queue pruning, one pipeline deletion and the phase tag.
effort: medium
disable-model-invocation: true
---

Outcome: a phase closes with evidence and a tag. The evidence is the scripted staging smoke and a
click-through, the deep gates with end-to-end tests, the full visual compare and perf check, and
the gates' self-test, which catches a gate that fails open. The queue in `docs/queue.md` is pruned,
the cost rows are reviewed, and something is deleted from the pipeline or the retro records why
nothing qualified. In the final phase the retro takes the human through MVP sign-off. Scope:
verification and pruning; new work goes to the queue.
