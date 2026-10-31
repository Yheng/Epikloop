# The web lane

## Plan

The first story with a UI installs Playwright, this lane's UI test tool: `@playwright/test` as a
dev dependency, its Chromium through `npx playwright install chromium`, a `playwright.config`
whose `webServer` starts the app, and a `test:e2e` script that runs `playwright test`, which the
gates take as the e2e command. Staging, in 1.2, is the host's deploy from the default branch, and
`staging_url` is its address.

## Story

Each acceptance criterion a person sees has a Playwright test of what they see and do, found by
role and text rather than by markup. Run the specs this story touched with
`npx playwright test <files>` before committing; the whole suite runs at retro.

## Retro

The deep gates run the whole Playwright suite as the e2e gate.
