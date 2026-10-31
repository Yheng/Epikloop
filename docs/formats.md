# Project file formats

The four project files Epikloop keeps in a product repository, and how their state is read. Each
format has an example in the core plugin's `templates/`. `bin/state.mjs` reads these files, and
its self-test parses the templates, so an example can't drift from the reader.

A line the reader can't place is reported as `file:line what`. The SessionStart briefing names the
first three problems under "Needs the human".

## `spec/<capability>.md`

Example: [`templates/spec/capability.md`](../plugins/epikloop/templates/spec/capability.md).

- **Title.** A `# Title`, then a sentence on what the capability is for.
- **Requirements.** Each requirement is a `## REQ-<CODE>-<NNN> Title` heading.
  - CODE is 2 to 12 uppercase letters or digits. NNN is three or more digits.
  - IDs are unique across `spec/`, never renumbered and never reused.
- **Status.** An optional first line after the heading says `Status: observed` or
  `Status: retired`. A requirement without one is current.
  - `adopt` marks every requirement `observed` until a decide batch confirms it.
  - A retired requirement stays in place, so its ID is never taken again.
- **Business rules.** Each rule is a blockquote, quoted verbatim, with its source in parentheses.
  A T2 or T3 story's commit carries a test for each rule its requirements quote.

`spec/architecture.md` is free-form.

## `docs/stories/<N>-<slug>.md`

Example: [`templates/docs/stories/epic.md`](../plugins/epikloop/templates/docs/stories/epic.md).

- **One file per epic.** It opens with `# Epic N: Title`. One epic is one phase.
- **Stories.** Each story is a `## N.M Title` heading, followed at once by its fields:
  - `- Tier: T1`, `T2` or `T3`
  - `- MVP: yes` or `no`
  - `- Requirements:` the REQ IDs it cites, comma-separated, or `none`
  - `- After:` the stories it waits for, optional
- **Body.** Free text with the acceptance criteria follows the fields.
- **Spec delta.** Each story ends with a `### Spec delta` section. Each line is
  `- add|change|retire REQ-… [: what]`, or the single line `- none`. Closing the story applies the
  delta in the same commit as the code.
- **Plan order** is epic number, then story number. Story IDs are never reused.

## `docs/queue.md`

Example: [`templates/docs/queue.md`](../plugins/epikloop/templates/docs/queue.md).

- **Two sections:** `## Questions` and `## Backlog`.
- **A parked question** is `### Q-NNN Title (YYYY-MM-DD)`, followed by its fields, then the
  question itself:
  - `- Blocks:` the stories it blocks, or `nothing`
  - `- Default taken:` the conservative default the work went on with
- **"Split me".** A story that outgrows its budget is parked as a question titled `Split N.M`.
- **Review.** In solo mode a T3 story's commit parks a question titled `Review N.M`, blocking
  nothing, so the human reads its diff in `decide`.
- **Numbers.** A question number is never reused: the next one follows the highest in the queue
  and in the decisions' `Answers`, and `state.mjs --ids` prints it. A number listed twice, or one
  a decision already answers, is reported.
- **Backlog lines.** Each is `- YYYY-MM-DD what`.
- **Answering.** `decide` removes an answered question in the same commit that appends its
  decision. `retro` prunes backlog lines. The queue's open entries are its questions and backlog
  lines.

## `docs/decisions.md`

Example: [`templates/docs/decisions.md`](../plugins/epikloop/templates/docs/decisions.md).

- **Entries.** Each entry is `## DECISION-NNN Title (YYYY-MM-DD)`, with these fields: `- Context:`,
  `- Decision:`, `- Rejected:`, `- Trade-offs:` and `- Implementation note:`.
- **Answers.** An entry that answers a parked question also carries `- Answers: Q-NNN`.
- **Append-only.** The file is never edited above its last entry.

## What is read from git

- **Done.** A story is done when a commit reachable from the default branch has a subject that
  starts `feat(N.M):`.
  - The default branch is `origin/HEAD`, else `main`, else `master`, else `HEAD`.
  - In team mode, a squash-merged pull request's title carries the same prefix.
- **Tags.** `retro` tags a closed phase `phase-N`, and MVP sign-off tags `mvp`.
- **The current phase** is the lowest epic that has MVP stories and no `phase-N` tag.
- **In review.** A story whose `feat(N.M):` commit is on another branch, local or remote, and not
  yet on the default branch is in review.

## What a batch reads

`state.mjs --ready [N | N.M]` lists the stories a batch may start, one `N.M Tn Title` line each,
in plan order. That line is the worker's spawn description.

- **Ready.** A story is ready when it isn't done or in review, every story in its `After` is done,
  and no parked question blocks it. Before the `mvp` tag only MVP stories are ready; named alone,
  as `N.M`, any story can be.
- **Which stories.** Without an argument, the current phase's epic, or every epic once all MVP
  epics are tagged. Nothing is ready before stage 6, or while the phase waits for `retro`.
- **Where a batch starts.** Only from a clean checkout of the default branch that its remote
  neither leads nor trails. Otherwise the list gives the reason, with the git command that fixes
  it when there is one.
- **The brief.** `state.mjs --story N.M` prints the story, the requirements it cites and the
  decisions that name it, each verbatim; how its commit lands; and the next question and decision
  numbers.
- **Landing.** In solo mode the story's commit is pushed to the default branch, when there is a
  remote. In team mode it goes on `story/N.M`, with a pull request titled like the commit, which
  the human merges.

## The fuel gauge

`MVP done/total · velocity · ETA · queue Δ`, shown once the MVP set is frozen.

- **MVP done/total.** Done and total count the stories marked `MVP: yes`.
- **Velocity.** MVP stories closed per day over the last 14 days, or since the freeze if that is
  sooner.
- **ETA.** The remaining MVP stories' average worker wall time for their tier, from this machine's
  cost rows, divided by `hours_per_day`.
  - A tier with no rows takes the average of all rows.
  - With no rows, or no `hours_per_day`, the ETA is unknown.
- **Queue Δ.** The open entries now minus the open entries at the last `phase-N` tag. Before the
  first tag, the base is the commit that froze the MVP set. While queue Δ is positive, the ETA is
  called fiction.
