---
description: Answer the questions parked in docs/queue.md in one sitting and unblock the stories waiting on them.
effort: low
---

Outcome: every question parked in `docs/queue.md` is answered by the human in one sitting, each
answer is recorded, and the stories it blocked can run again. Each question arrives with the
conservative default the loop took and what it blocks; each answer becomes a `DECISION-XXX` entry
in `docs/decisions.md`, and any work built on an overturned default is routed back for rework.
Scope: questions already parked; new findings belong to `triage`, and no code changes happen here.
