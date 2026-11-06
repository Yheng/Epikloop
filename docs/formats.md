# Project file formats

The project files Epikloop keeps in a product repository, and how their state is read. Each format
a script reads has an example in the core plugin's `templates/`. `scripts/state.mjs` reads these
files, and its self-test parses the templates, so an example can't drift from the reader.

A line the reader can't place is reported as `file:line what`. The SessionStart briefing names the
first three problems under "Needs the human". A root `PIPELINE_VERSION`, which every version of an
earlier template layout carries, is reported first, until `adopt`'s conversion removes it.

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
- **Records.** The closing ceremonies record themselves as entries with fixed titles: `retro`
  writes `Phase N retro`, the MVP sign-off `MVP sign-off`, and `release` `Go live`, or
  `Go live later` when production comes later. The reader finds them by title.
- **Append-only.** The file is never edited above its last entry.

## `design/`

Example: [`templates/design/manifest.md`](../plugins/epikloop/templates/design/manifest.md).

The product's visual truth, in a lane with screens. The lane's profile gives the two widths each
screen is drawn at; the `service` lane skips design.

- **`brief.md`** is free-form under a `#` title naming the product, which the gallery takes as its
  own: who the product is for, the feel it aims at, its constraints and the screens it needs, drawn
  from `spec/` and from the images in `refs/`.
- **`refs/`** holds the images the human adds for the brief.
- **`directions/`** holds three direction variants of the system sheet, each one self-contained HTML
  file with its own custom properties.
- **The pick** is a decision titled `Design direction`, whose Decision names the picked file and
  whose Rejected names the others. A later one replaces an earlier one.
- **`tokens.css`** holds the picked direction's custom properties on `:root`. Its arrival turns the
  token gate on.
- **`screens/`** holds one HTML file per state of each screen, each linking `../tokens.css`:
  `<screen>.html` for the default state, and `<screen>.<state>.html` for `empty`, `loading` and
  `error`.
- **`manifest.md`** lists the screens:
  - Each screen is a `## <screen> Title` heading. The name is lower-case letters, digits and
    hyphens, unique in the manifest, and the name of the screen's files.
  - The heading is followed at once by its fields:
    - `- States:` `default`, then any of `empty`, `loading` and `error`, comma-separated
    - `- Requirements:` the REQ IDs the screen shows, comma-separated, or `none`
  - Free text follows: what the screen is for and how a person reaches it.
  - A screen whose heading or fields don't read is a problem, and isn't counted.
- **`index.html`** is the gallery, which `scripts/gallery.mjs` writes from the manifest and the
  directions: each direction, then each state of each screen, framed at both widths.
- **A design that came with the product.** `adopt` brings in the tokens and screen mockups an
  existing product has as they are: a brief from its design notes, its `tokens.css`, and each
  mockup as the default state of the screen it names, listed in the manifest. It has no directions
  and no pick, and `amend` and `add` follow its tokens.

## What design reads

`state.mjs --design` prints where the design stands, at any stage, and refuses a lane without
screens.

- **Where it stands.** The lane's widths, the brief and the images in `refs/`, the directions,
  the pick or the number its decision will take, the tokens, and the manifest's screens with the
  state files they still lack. With tokens and no directions or pick, it says the design came with
  the product instead of naming a pick.
- **What an audit reads.** The current requirements no screen cites; citations of requirements
  that are retired or not in `spec/`; files in `screens/` the manifest doesn't list; and the
  manifest's unreadable lines.
- **Started and complete.** The design has started once it has `brief.md`, a direction or
  `manifest.md`. It is complete once `tokens.css` exists, the manifest lists a screen, and every
  state it lists has its file.
- **Stage 3.** In a lane with screens, a project is at stage 3 while its design has started and
  isn't complete, or while nothing is planned and its design hasn't started. A project planned
  without a design stays where it is. Requirements that no screen cites never send a project
  back.

## What is read from git

- **Done.** A story is done when a commit reachable from the default branch has a subject that
  starts `feat(N.M):`.
  - The default branch is `origin/HEAD`, else `main`, else `master`, else `HEAD`.
  - In team mode, a squash-merged pull request's title carries the same prefix.
- **The next epic** follows every epic a story file or a `feat(N.M):` commit on the default branch
  names, and `state.mjs --ids` prints it. A repository whose history already used those numbers
  never has a story done before it starts.
- **Tags.** `retro` tags a closed phase `phase-N`, MVP sign-off tags `mvp`, and `release` tags
  `live`. Each tag goes on the default branch once the ceremony's record has landed there.
  - `adopt` tags `live` on a product already in production once its adoption lands, and with no
    MVP stories it is in post-MVP mode, where the planned work runs as after a sign-off.
  - `init` tags `before-adoption` on a repository on an earlier template layout: the rollback
    point, never moved once it's there.
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
  numbers. In a project with a design, it also names the screens in `design/manifest.md` that show
  the story's requirements, with their states and files.
- **Landing.** In solo mode the story's commit is pushed to the default branch, when there is a
  remote. In team mode it goes on `story/N.M`, with a pull request titled like the commit, which
  the human merges.

## What a ceremony reads

`state.mjs --retro` and `state.mjs --release` print the closing ceremonies' briefs. Each starts
only at its stages, 7 and 8 for a retro and 9 for a release, and only where a batch would.

- **The retro's brief.** At stage 7: the phase's MVP stories, for the click-through; the evidence,
  which is the deep gates, the gates' self-test, the staging smoke and the click-through; with a
  complete design, how far the visual compare reaches; the queue and its Δ; this machine's cost
  rows per tier and effort; the record; and how it lands, as `chore(phase-N): retro`. When the phase is the last MVP epic, the retro is also the MVP
  sign-off, and the brief says what sign-off needs. At stage 8, the brief is the sign-off's alone,
  landing as `chore(mvp): sign-off`.
- **The release's brief.** Staging, where the hosting is described, the production smoke, the
  record, and how it lands, as `chore(release): go live`, after which it prints the `live` tag.
  Until a `Go live later` is recorded, it also gives that record, for when production comes later,
  landing as `chore(release): go live later`. Once one is, it says that a release which still
  waits records nothing.
- **Tags.** Once a record is on the default branch, the brief prints only the tags it leaves. It
  prints `mvp` only while queue Δ is at 0 or below.
- **The staging smoke.** `smoke.mjs` sends one GET to `staging_url`, or to the URL it is given,
  and passes on a 2xx answer within 15 seconds.
  - Smoking `staging_url`, it also reads the answer's `x-commit` header, the commit staging was
    built from, and passes only when that is the project's HEAD, in full or as a short id.
  - A staging without the header fails, and so does one that is behind HEAD, on a commit HEAD
    doesn't contain, or on one the repository doesn't have; the line says which.
  - A URL it is given, such as production's, is checked for its answer alone.

## The fuel gauge

`MVP done/total · velocity · ETA · queue Δ`, shown once the MVP set is frozen.

- **MVP done/total.** Done and total count the stories marked `MVP: yes`.
- **Velocity.** MVP stories closed per day over the last 14 days, or since the freeze if that is
  sooner.
- **ETA.** The remaining MVP stories' average worker wall time for their tier, from this machine's
  cost rows, divided by `hours_per_day`.
  - A tier with no rows takes the average of all rows.
  - With no rows, or no `hours_per_day`, the ETA is unknown.
- **Queue Δ.** The open entries now minus the open entries at the start of the current phase:
  the highest `phase-N` tag below it, else the commit that froze the MVP set. While queue Δ is
  positive, the ETA is called fiction.
  - Until the `mvp` tag, once every MVP epic is tagged, the current phase is still the last MVP
    epic, so sign-off weighs the queue over the whole final phase.
  - After the `mvp` tag, the base is the highest `phase-N` tag.
