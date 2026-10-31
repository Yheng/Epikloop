# Writing a lane

A lane is a profile for one kind of product. The core plugin ships `web` and `service`, and M3 adds
`mobile-expo` and `mobile-flutter`. A contributor adds a lane without touching a skill. This guide
is for writing one.

## The two files

- `plugins/epikloop/lanes/<name>.json` is the profile
  ([schema](../plugins/epikloop/schemas/lane.schema.json)). Code reads every field.
- `plugins/epikloop/lanes/<name>.md` is the fragment, the lane's text for the model. It is
  optional.

The name is lower-case letters, digits and hyphens, and it is the same in both file names and in
the profile's `name`. A project takes a lane through `lane` in its `.epikloop/project.json`.
`init.mjs --lane` refuses a name the plugin has no profile for, and the state reader reports an
unknown lane as a problem.

## The profile

| Field | Read by | Meaning |
|---|---|---|
| `format` | the state reader | `1` |
| `name` | everything | The lane's name, the same as its file's |
| `description` | `state.mjs --lanes`, which `discover`, `adopt` and `architect` inject | The kind of product the lane is for, in a few lower-case words |
| `requires` | `doctor` | Programs a machine needs on `PATH` to build in the lane, beyond Node and git. `doctor` runs each with `--version` |
| `ui_test` | the guard and `doctor` | The lane's UI test tool, or `null` for a lane without screens |
| `ui_test.tool` | `doctor` | The tool's name, as `doctor` reports it |
| `ui_test.package` | `doctor` | The npm package a product installs it as. `doctor` reads `node_modules/<package>/package.json` for its version, without running anything |
| `ui_test.allow` | the guard | Command prefixes the guard allows in the lane's projects |

A field that nothing reads doesn't belong in the profile yet. Perf budgets, for example, wait for a
project that shows the failure they would catch.

## The fragment

The fragment holds up to three sections, each printed by the state reader where a skill reads it:

| Section | Printed into | By |
|---|---|---|
| `## Plan` | the `plan` skill's body | `state.mjs --lane plan`, injected |
| `## Story` | each story-worker's brief | `state.mjs --story N.M` |
| `## Retro` | the retro's brief, after its evidence | `state.mjs --retro` |

- **Not printed.** Anything above the first section, such as the file's `#` title, is for people
  and is never printed.
- **The only place.** Skills name no lane, so a lane's guidance lives in its fragment and nowhere
  else.
- **How to write it.** Write a section the way the skills are written:
  - calm, general instructions, with the scope stated
  - no step lists
  - nothing that tells the model to check its own work
- **The ceiling.** A section is model-facing text, counted toward the core plugin's 700-line prompt
  ceiling ([constitution](../CONSTITUTION.md), article 2). Keep it to what the lane changes.

## The guard's allow list

- **Prefixes.** `ui_test.allow` holds command prefixes. A part of a command is allowed when it is
  one of them, or one of them followed by a space and plain arguments.
- **Every other rule still applies.** No substitution, no redirect, no character outside the
  guard's plain set, and every other part of the command must be allowed too.
- **Never a command that fetches.** That rules out installs, `npx` of a package that isn't
  installed, and anything that downloads; the human approves those.
- **Plain characters only.** An entry has only letters, digits, spaces and `._/:=+,-`, so it reads
  the same from Bash and PowerShell.

## What a lane can't do

- **Add a file to a product repository.** The footprint is fixed
  ([constitution](../CONSTITUTION.md), article 8). A lane's tests, configuration and scripts are
  the product's own code, written by its stories.
- **Carry gate configuration.** Teammates and the team-mode check run the gates without the
  plugin, so the gates read only the project's `.epikloop/project.json`.
- **Change a skill.** If a lane needs a skill to say something new, the skill gains a section that
  every lane can fill.

## Checking a lane

- **The state reader's self-test** holds every profile and fragment to the format:
  - the fields and their types
  - a name that matches the file
  - plain allow entries
  - only the three sections
- **The guard's self-test** runs a web project and a service project against the real lane files.
  A new lane adds its own samples there: what its allow list lets through, and what it doesn't.
- **The `CHANGELOG.md` entry** that adds a lane says what its guidance answers, with the date
  ([constitution](../CONSTITUTION.md), article 1).
