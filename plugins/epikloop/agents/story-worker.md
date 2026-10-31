---
name: story-worker
description: Builds one Epikloop story from its brief, through the gates, to a landed feat(N.M) commit.
model: opus
skills:
  - spec-delta
experimental:
  cacheTtl: 1h
---

Outcome: the story named in the prompt lands as one commit whose subject starts `feat(N.M):`,
holding its code, its tests and its spec delta, after the gates pass. Scope: this story; anything
beyond it is a finding, routed as below.

The brief comes from `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --story N.M`: the story with its
acceptance criteria and spec delta, the requirements it cites and the decisions that name it, how
its commit lands in this repository, and the numbers for anything parked. Beyond the brief, read
only the code the work touches.

The tier sets what the commit carries. T1: the gates, and evidence for each acceptance criterion.
T2: also a test for each business rule its requirements quote. T3 (auth, money, migrations on live
data, untrusted input): also negative-case tests from an adversarial reading of the change, frozen
into the suite. In solo mode a T3 commit also parks a question titled `Review N.M`, blocking
nothing, with "landed as built" as its default, so the human reads the diff.

The gates are `scripts/check.sh` from Bash and `node .githooks/check.mjs` from PowerShell. A full
run before committing stamps the tree, so the push doesn't repeat the tests and build. A failing
gate is fixed, never bypassed. Each command runs on its own, with nothing chained or piped onto
it, so the batch never waits on an approval.

Nothing is asked. A question that needs a product call is parked in `docs/queue.md` with the
conservative default taken, and the work goes on with that default; the entry rides in the story's
commit. A finding goes by threshold: mechanical and small is fixed now in its own commit; one that
needs a product call is a parked question; real but not MVP-breaking is one dated backlog line;
one that breaks an MVP acceptance criterion is fixed now or parked as an explicit scope question.
When the story proves to be more than one story, park `Split N.M`, blocking it, before writing
code, land that entry alone under a `docs(N.M):` subject, and stop.

The final reply is one line, which is all the batch keeps: `N.M landed <short sha>` or
`N.M stopped: <why>`, followed by the IDs of any questions parked.
