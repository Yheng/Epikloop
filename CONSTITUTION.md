# Constitution

These articles govern how Epikloop itself is built and changed. They bind both plugins, the scripts
they ship, and this repository. The principles the pipeline enforces in product work are in
[docs/doctrine.md](docs/doctrine.md).

1. **Cite the failure.** Every rule, gate, hook and skill instruction exists because of an observed
   failure. The [CHANGELOG](CHANGELOG.md) entry that adds it names that failure and the date the
   rule was adopted; the rule text itself carries no citation. Preemptive rules are rejected in
   review.

2. **Prompt ceiling.** Model-facing text in the core plugin totals at most 700 lines. The count is
   mechanical: non-blank lines, wrapped at 100 columns, across skill and agent bodies and their
   `description` fields, supporting files, lane skill fragments, and text that hooks inject. At the
   ceiling, adding requires deleting. Skill text never carries history.

3. **Retros delete.** Every retro of a dogfood project deletes something from the pipeline or
   records why nothing qualified.

4. **Release cadence.** Releases follow semver. Prompt and process changes ship only at retro
   cadence, each with its cited failure. Script, lane and platform fixes ship any time.

5. **Laws, not sentences.** Anything mechanically checkable is enforced by a script. Prompt space is
   reserved for judgment.

6. **Nothing leaves the machine.** No telemetry, and no network calls from hooks or Harbor. Network
   traffic happens only where the user directs it — git push, deploys, the staging smoke — and
   reaches only the project's own hosts.

7. **Node only.** Every script Epikloop ships is Node using built-ins only, with no runtime
   dependencies. No bash, no `jq`, no `timeout`; a shell appears only as a thin shim that hands off
   to Node. Browser code in Harbor may vendor libraries into its prebuilt bundle; the Node side
   stays dependency-free. Linux, macOS and Windows are equal targets, and all three run in CI.

8. **Exact footprint.** In a product repo, Epikloop owns exactly these, and nothing else, ever:
   - `.epikloop/project.json`
   - `spec/`
   - `design/`
   - `docs/` — stories, decisions, queue
   - `scripts/check.sh` and `.githooks/`
   - `CLAUDE.md` — project rules only
   - the one entry in the stack's install step that arms `.githooks/`
   - `.github/workflows/check.yml`, in team mode only

9. **Write for Opus 5 and later.** Model-facing text gives general instructions rather than step
   lists, states its scope, puts the full spec up front, keeps a calm tone, and never tells the
   model to verify its own work or to use a subagent to verify it.

10. **Measure before tuning.** Effort levels and process changes are justified by the cost rows the
    emitter writes, never by feel.
