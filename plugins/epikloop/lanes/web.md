# The web lane

## Plan

The first story with a UI installs Playwright, this lane's UI test tool: `@playwright/test` as a
dev dependency, its Chromium through `npx playwright install chromium`, a `playwright.config`
whose `webServer` starts the app, a `test:e2e` script that runs `playwright test`, which the gates
take as the e2e command, and `test-results/` in `.gitignore`. Where `design/tokens.css` exists, the
same story makes the app load it, so every colour and font in the product's styles comes from its
custom properties. Staging, in 1.2, is the host's deploy from the default branch, and
`staging_url` is its address. Staging's answers carry an `x-commit` header naming the commit it was
built from, from the host's commit variable or `git rev-parse HEAD` at build; the retro's smoke
passes only when that is HEAD.

## Story

Each acceptance criterion a person sees has a Playwright test of what they see and do, found by
role and text rather than by markup. Run the specs this story touched with
`npx playwright test <files>` before committing; the whole suite runs at retro.

Where the brief names screens, the story keeps the project's screens spec in step with the ones it
builds or changes, creating the spec when there is none. The spec renders each state in
`design/manifest.md` at both widths, once from its design file and once from the app, as
`test-results/screens/<screen>.<state>.<width>.design.png` and `.app.png`, each test titled by its
screen and state, so `npx playwright test <spec> -g <screen>` renders one screen. The story's UI
evidence includes each screen it touches in its default state at the narrow width, as built, read
beside its design render; what differs is fixed, or parked as a question when the design should
change instead.

## Retro

The deep gates run the whole Playwright suite as the e2e gate. Where the project has a design, that
run leaves every render of the screens spec in `test-results/screens/`, and the full visual compare
reads each state's app render beside its design render at both widths: a difference is a finding,
and so is a state in `design/manifest.md` that nothing renders.
