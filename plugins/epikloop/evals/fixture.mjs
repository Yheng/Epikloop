// The eval suite's fixture project: a tiny greeter, built as the git repository a case starts in.
//
// `node fixture.mjs <name> [dir]` builds fixture <name> in dir, the current folder by default, which
// must be empty. A case's scaffold.sh runs it in the case's workspace, before Claude starts. Each
// fixture is the greeter at one stage of its life, or the empty repository before it, and its
// commits start `fixture: `, so a grader can tell them from the commits made during the run. A
// story's own commit and its review's keep the subjects the state reader looks for.
//
// `node fixture.mjs --self-test` builds every fixture in a temporary folder, reads each one as the
// briefing does, pushes to the remote the fixtures before a batch carry, and checks that every
// case's scaffold names a fixture.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { openProject, readState } from '../scripts/state.mjs'

const PLUGIN = path.join(import.meta.dirname, '..')
const INIT = path.join(PLUGIN, 'scripts', 'init.mjs')
const USAGE = 'usage: node fixture.mjs <name> [dir] | --self-test'

// ---- The greeter at each stage

const PACKAGE = '{ "name": "greeter", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n'
const CODE = {
  'package.json': PACKAGE,
  'README.md': '# Greeter\n\nGreets a person by name: `greet("Ada")` returns "Hello, Ada!".\n',
  'src/greet.mjs': 'export function greet(name) {\n  return `Hello, ${name}!`\n}\n',
  'test/greet.test.mjs': [
    "import assert from 'node:assert/strict'",
    "import { test } from 'node:test'",
    "import { greet } from '../src/greet.mjs'",
    '',
    "test('greets a person by name', () => {",
    "  assert.equal(greet('Ada'), 'Hello, Ada!')",
    '})',
    '',
  ].join('\n'),
}

const SPEC = `# Greet

A tiny command-line greeter.

## REQ-GREET-001 Greet by name

The tool greets a person by name.

> "Say hello, then the name." (the brief)
`

const ARCHITECTURE = `# Architecture

Node 22 with ES modules and no dependencies. \`src/greet.mjs\` holds the logic, and \`test/\` holds
its tests, which \`node --test\` runs.

## Staging

None: the greeter is a function with nothing to host.

## Pre-mortem

- The greeting drifts from the brief's wording: its tests quote the exact text.
`

const DECISIONS = `# Decisions

## DECISION-001 No dependencies (2026-10-30)
- Context: the greeter is one function and ships as a single folder.
- Decision: Node built-ins only, tests included.
- Rejected: a test framework, because node --test covers one function.
- Trade-offs: none worth recording yet.
- Implementation note: 1.1 keeps to Node built-ins.
`

// Story 1.1 leaves a product call open, so a worker has a question to park.
const STORIES = `# Epic 1: Greeter

## 1.1 Greet by name
- Tier: T1
- MVP: yes
- Requirements: REQ-GREET-001

\`src/greet.mjs\` exports \`greet(name)\`, which returns "Hello, <name>!". Done when a test shows that
\`greet("Ada")\` returns "Hello, Ada!". What it returns for an empty name hasn't been decided.

### Spec delta
- change REQ-GREET-001: the greeting ends with an exclamation mark

## 1.2 Greet in French
- Tier: T1
- MVP: no
- Requirements: none
- After: 1.1

\`greet(name, "fr")\` returns "Bonjour, <name> !".

### Spec delta
- add REQ-GREET-002: the tool greets in French on request
`

const QUEUE = '# Queue\n\n## Questions\n\n## Backlog\n'

const PARKED = `# Queue

## Questions

### Q-001 Empty name (2026-10-31)
- Blocks: 1.1
- Default taken: greet("") returns "Hello, !"

What should the greeting say when the name is empty? 1.1 waits on the answer.

## Backlog
`

// The greeter as a web page, in the web lane, for the design cases.
const WEB_SPEC = `# Greet

A web page that greets a person by name.

## REQ-GREET-001 Greet by name

A person types their name and sees a greeting.

> "Say hello, then the name." (the brief)

## REQ-GREET-002 Ask for a missing name

Asked to greet without a name, the page asks for one.
`

const BRIEF = `# Greeter

A one-page site for anyone who wants a friendly hello. A person types a name and sees the greeting
at once. It should feel calm and friendly, and read well on a phone. The screens: the greeting
page, which also asks for a name when none is given.
`

// A direction's system sheet: its custom properties, then the greeting on them.
const direction = (title, properties) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${title}</title>
<style>
:root { ${properties} }
body { margin: 0; padding: var(--space); background: var(--paper); color: var(--ink); font-family: var(--font); }
button { background: var(--accent); color: var(--paper); border: 0; padding: var(--space); font: inherit; }
</style>
<h1>Hello, Ada!</h1>
<label>Your name <input value="Ada"></label>
<button>Greet</button>
</html>
`

const PICKED = `# Decisions

## DECISION-001 Design direction (2026-11-05)
- Context: three directions were drawn for the greeter page.
- Decision: design/directions/b.html, quiet ink.
- Rejected: a.html, warm paper, and c.html, bright pop, because the page should stay calm.
- Trade-offs: the quiet direction leans on type more than on colour.
- Implementation note: design/tokens.css takes b.html's custom properties.
`

const QUIET = '--paper: #ffffff; --ink: #1f2328; --accent: #0f766e; --font: system-ui, sans-serif; --space: 16px;'

const SCREENS = `# Screens

## greet Greet
- States: default, error
- Requirements: REQ-GREET-001, REQ-GREET-002

The one page: a name field, the greeting below it, and a request for a name when none is given.
`

// The greeter page's architecture. It leaves the tokens unmentioned, so a plan that names them
// took them from the lane.
const WEB_ARCHITECTURE = `# Architecture

A single web page, served from \`public/\` by a dependency-free Node 22 server, \`server.mjs\`. The
page's script greets in place, with no request to the server. Unit tests run on \`node --test\`, and
the page's tests on Playwright.

## Staging

A static host's deploy from main. The host's commit variable gives the \`x-commit\` header.

## Pre-mortem

- The greeting drifts from the brief's wording: its tests quote the exact text.
`

const WEB_DECISIONS = `${PICKED}
## DECISION-002 One static page (2026-11-06)
- Context: the greeter is one page with nothing to store.
- Decision: a static page, served by a dependency-free Node server.
- Rejected: a framework, because one page needs none.
- Trade-offs: no client-side routing, which one page doesn't need.
- Implementation note: 1.1 lays down the server and the page.
`

// Each commit: its subject after `fixture: `, its date, and what it writes. `init` runs the plugin's
// own setup first in that lane, as discover does; `marker` adds fields to the project marker;
// `executable` names the files staged as programs; `armed` points git's hooks at .githooks/.
const SPECIFY = { subject: 'spec the greeter', date: '2026-10-29', init: 'service', files: { 'spec/greet.md': SPEC } }
const ARCHITECT = {
  subject: 'architect the greeter',
  date: '2026-10-30',
  files: { 'spec/architecture.md': ARCHITECTURE, 'docs/decisions.md': DECISIONS, 'package.json': PACKAGE },
  // The gates run node --test itself, so no gate needs npm or its cache in the user's home.
  marker: { gates: { commands: { test: 'node --test' } } },
}
const PLAN = {
  subject: 'plan the greeter',
  date: '2026-10-31',
  files: { 'docs/stories/1-greeter.md': STORIES, 'docs/queue.md': QUEUE },
  marker: { mvp_frozen: '2026-10-31', hours_per_day: 2, deadline: null },
}
const PARK = { subject: 'park a question', date: '2026-10-31', files: { 'docs/queue.md': PARKED } }

// The greeter planned with 1.1 as a T3 story, since the name it greets is untrusted input.
const RISKY_STORIES = STORIES.replace(
  /## 1\.1 Greet by name[\s\S]*?(?=## 1\.2 )/,
  `## 1.1 Greet by name
- Tier: T3
- MVP: yes
- Requirements: REQ-GREET-001

\`src/greet.mjs\` exports \`greet(name)\`, which returns "Hello, <name>!". The name comes from whoever
runs the tool, so it is untrusted input: the greeting is pasted into a web page as it is, and a
name that holds \`<\` or \`>\` is refused with an error. Done when tests show that \`greet("Ada")\`
returns "Hello, Ada!" and that \`greet("<b>Ada</b>")\` throws.

### Spec delta
- change REQ-GREET-001: the greeting ends with an exclamation mark, and a name with markup is refused

`,
)

const LANDED_SPEC = SPEC.replace(
  'The tool greets a person by name.\n',
  'The tool greets a person by name, and the greeting ends with an exclamation mark. A name that holds\n`<` or `>` is refused with an error.\n',
)

const REVIEWED = `# Queue

## Questions

### Q-001 Review 1.1 (2026-11-02)
- Blocks: nothing
- Default taken: landed as built
- Severity: high

The review of 1.1 found one thing:

1. \`src/greet.mjs:2\` (high): a name with markup is greeted as it is, though 1.1 says a name that
   holds \`<\` or \`>\` is refused with an error. \`greet("<b>Ada</b>")\` returns the markup, and no
   test sends such a name.

## Backlog
`

const PLAN_RISKY = { ...PLAN, files: { 'docs/stories/1-greeter.md': RISKY_STORIES, 'docs/queue.md': QUEUE } }
// 1.1 as a worker landed it: the greeting and its test, with the spec's delta applied, but no
// refusal of a name with markup and no test of one. `raw` keeps a subject as it is.
const LAND = {
  subject: 'feat(1.1): greet by name',
  raw: true,
  date: '2026-11-01',
  files: { 'src/greet.mjs': CODE['src/greet.mjs'], 'test/greet.test.mjs': CODE['test/greet.test.mjs'], 'spec/greet.md': LANDED_SPEC },
}
const REVIEW = { subject: 'review(1.1): 1 finding', raw: true, date: '2026-11-02', files: { 'docs/queue.md': REVIEWED } }
const WEB_SPECIFY = { subject: 'spec the greeter page', date: '2026-11-04', init: 'web', files: { 'spec/greet.md': WEB_SPEC } }
const PICK = {
  subject: 'pick a direction',
  date: '2026-11-05',
  files: {
    'design/brief.md': BRIEF,
    'design/directions/a.html': direction('Warm paper', '--paper: #fbf7f0; --ink: #2b2118; --accent: #b4532a; --font: Georgia, serif; --space: 18px;'),
    'design/directions/b.html': direction('Quiet ink', QUIET),
    'design/directions/c.html': direction('Bright pop', '--paper: #fff8d6; --ink: #24124a; --accent: #7c3aed; --font: "Trebuchet MS", sans-serif; --space: 20px;'),
    'docs/decisions.md': PICKED,
  },
}
// The design drawn but for the greeting's error state.
const DRAW = {
  subject: 'draw the greeting',
  date: '2026-11-06',
  files: {
    'design/tokens.css': `:root { ${QUIET} }\n`,
    'design/manifest.md': SCREENS,
    'design/screens/greet.html': '<!doctype html>\n<html lang="en">\n<link rel="stylesheet" href="../tokens.css">\n<title>Greet</title>\n<h1>Hello, Ada!</h1>\n</html>\n',
  },
}
const DRAW_ERROR = {
  subject: 'draw the request for a name',
  date: '2026-11-06',
  files: {
    'design/screens/greet.error.html': '<!doctype html>\n<html lang="en">\n<link rel="stylesheet" href="../tokens.css">\n<title>Greet</title>\n<h1>Who should I greet?</h1>\n</html>\n',
  },
}
const WEB_ARCHITECT = {
  subject: 'architect the greeter page',
  date: '2026-11-06',
  files: { 'spec/architecture.md': WEB_ARCHITECTURE, 'docs/decisions.md': WEB_DECISIONS, 'package.json': PACKAGE },
  marker: ARCHITECT.marker,
}
// The greeter page with a drawing model named in its marker, one no eval's session runs on, so
// the design has to hand its drawing to subagents started on it.
const MODEL = { subject: 'name the drawing model', date: '2026-11-05', files: {}, marker: { model: { design: 'haiku' } } }

// The greeter page's one story, which shows both requirements on its one screen.
const WEB_STORIES = `# Epic 1: Greeter page

## 1.1 Greet by name
- Tier: T1
- MVP: yes
- Requirements: REQ-GREET-001, REQ-GREET-002

\`src/greet.mjs\` exports \`greet(name)\`, which the page calls: "Hello, <name>!" for a name, and
"Who should I greet?" for none. Done when tests show both.

### Spec delta
- none
`
const WEB_PLAN = {
  subject: 'plan the greeter page',
  date: '2026-11-07',
  files: { 'docs/stories/1-greeter.md': WEB_STORIES, 'docs/queue.md': QUEUE },
  marker: { mvp_frozen: '2026-11-07', hours_per_day: 2, deadline: null },
}
const WEB_LAND = {
  subject: 'feat(1.1): greet by name',
  raw: true,
  date: '2026-11-08',
  files: {
    '.gitignore': 'node_modules/\ntest-results/\n',
    'src/greet.mjs': "export function greet(name) {\n  return name ? `Hello, ${name}!` : 'Who should I greet?'\n}\n",
    'test/greet.test.mjs': [
      "import assert from 'node:assert/strict'",
      "import { test } from 'node:test'",
      "import { greet } from '../src/greet.mjs'",
      '',
      "test('greets a person by name', () => {",
      "  assert.equal(greet('Ada'), 'Hello, Ada!')",
      '})',
      '',
      "test('asks for a missing name', () => {",
      "  assert.equal(greet(''), 'Who should I greet?')",
      '})',
      '',
    ].join('\n'),
  },
}

// A small picture of one colour, as a PNG's bytes: enough for a session to open it, and for the
// visual compare to read its size.
function png(width, height, colour) {
  const crc = (bytes) => {
    let c = 0xffffffff
    for (const byte of bytes) {
      c ^= byte
      for (let bit = 0; bit < 8; bit += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  // Eight bits a channel, in red, green and blue.
  head[8] = 8
  head[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width * 3 }, (_, i) => colour[i % 3]))])
  const rows = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

// What the page's screens spec left when the deep gates last ran: each state of its one screen at
// both widths, from the design and from the app, which here are the same picture.
const PICTURES = Object.fromEntries(
  [
    ['default', [240, 253, 250]],
    ['error', [254, 242, 242]],
  ].flatMap(([state, colour]) => [390, 1280].flatMap((width) => ['app', 'design'].map((kind) => [`test-results/screens/greet.${state}.${width}.${kind}.png`, png(width, 240, colour)]))),
)
// The review of 1.1, which found nothing in a T1 story, so its commit holds nothing. `untracked`
// is written after the commit, and stays out of it.
const WEB_REVIEW = { subject: 'review(1.1): no findings', raw: true, date: '2026-11-09', files: {}, empty: true, untracked: PICTURES }

// The greeter page on an earlier template layout, for adopting one: the template's version file,
// session command, hook and gate, a test that holds the hook, its rules and protocol in CLAUDE.md,
// its PRD, architecture, decisions, story and todo, and its design notes, tokens and one mockup.
const EARLIER_HOOK = '#!/bin/sh\n# The gate, on every commit.\nexec node scripts/gate.mjs\n'
const EARLIER_LAYOUT = {
  subject: 'set up from the earlier template',
  date: '2026-07-08',
  executable: ['.githooks/pre-commit'],
  armed: true,
  files: {
    'package.json': '{ "name": "greeter", "private": true, "type": "module", "scripts": { "prepare": "git config core.hooksPath .githooks", "test": "node --test" } }\n',
    'README.md': '# Greeter\n\nA web page that greets a person by name.\n',
    'src/greet.mjs': CODE['src/greet.mjs'],
    'test/greet.test.mjs': CODE['test/greet.test.mjs'],
    'public/index.html': [
      '<!doctype html>',
      '<html lang="en">',
      '<meta charset="utf-8">',
      '<title>Greeter</title>',
      '<link rel="stylesheet" href="../design/tokens.css">',
      '<style>body { margin: 0; padding: var(--space); background: var(--paper); color: var(--ink); font-family: var(--font); }</style>',
      '<h1 id="greeting">Who should I greet?</h1>',
      '<label>Your name <input id="name"></label>',
      '<script type="module">',
      "import { greet } from '../src/greet.mjs'",
      "const name = document.getElementById('name')",
      "name.addEventListener('input', () => { document.getElementById('greeting').textContent = name.value ? greet(name.value) : 'Who should I greet?' })",
      '</script>',
      '</html>',
      '',
    ].join('\n'),
    PIPELINE_VERSION: 'v1.0.1\n',
    '.claude/commands/build.md': '# /build\n\nBuild one story: claim its issue, branch, write the code, open a pull request, then run /verify.\n',
    '.githooks/pre-commit': EARLIER_HOOK,
    'scripts/gate.mjs': "// The gate the pre-commit hook runs: the tests.\nimport { spawnSync } from 'node:child_process'\n\nprocess.exitCode = spawnSync(process.execPath, ['--test'], { stdio: 'inherit' }).status ?? 1\n",
    'test/gate-hook.test.mjs': [
      "import assert from 'node:assert/strict'",
      "import fs from 'node:fs'",
      "import { test } from 'node:test'",
      '',
      "test('the pre-commit hook runs the gate', () => {",
      "  assert.match(fs.readFileSync('.githooks/pre-commit', 'utf8'), /scripts\\/gate\\.mjs/)",
      '})',
      '',
    ].join('\n'),
    'CLAUDE.md': [
      '# Greeter',
      '',
      '## Operating Mode',
      '',
      '**Mode:** team · **Tracker:** GitHub Issues · **Merge flow:** branch-per-story + PR',
      '',
      '## Source of Truth Rules',
      '',
      '1. `design/screens/` and `design/tokens.css` are the visual truth.',
      '2. `docs/context/decisions.md` is the decision record.',
      '3. Story files are the spec.',
      '',
      '## Conventions',
      '',
      '- A greeting always ends with an exclamation mark.',
      '',
      '## Session Protocol',
      '',
      'Start every session with /status. One story per /build, then /verify. Commit and push at story boundaries.',
      '',
    ].join('\n'),
    'docs/PRD.md': [
      '# Greeter: product requirements',
      '',
      '## 1. Identity and vision',
      '',
      'A web page that greets a person by name.',
      '',
      '## 2. Features',
      '',
      '- A person types their name and sees a greeting.',
      '- With no name typed, the page asks for one.',
      '',
      '> IMPLEMENTATION RULE: The greeting uses the name exactly as typed, capitals included.',
      '',
    ].join('\n'),
    'docs/ARCH.md': '# Architecture\n\n## 1. Tech stack\n\nOne static page in `public/`, its logic in `src/greet.mjs`, tested by `node --test`. Nothing is hosted yet.\n',
    'docs/context/decisions.md': [
      '# Decisions and business rules',
      '',
      '## Architecture decisions',
      '',
      '### [DECISION-001] No dependencies',
      '**Context:** the greeter is one page. **Decision:** Node built-ins only. **Rejected alternatives:** a framework. **Trade-offs:** none yet. **Implementation note:** `src/greet.mjs` keeps to built-ins.',
      '',
      '### [DECISION-002] Greet on the page, without a server',
      '**Context:** nothing is stored. **Decision:** the page greets in place. **Rejected alternatives:** a round trip to a server. **Trade-offs:** none. **Implementation note:** `public/index.html` loads `src/greet.mjs`.',
      '',
      '## Business rules (verbatim from the PRD)',
      '',
      '### [RULE-001] The name is used exactly as typed',
      '**Source:** PRD §2. **Rule (verbatim):** "The greeting uses the name exactly as typed, capitals included." **Affected stories:** 1.1.',
      '',
    ].join('\n'),
    'docs/stories/epic-1-greet.md': '# Epic 1 — Greet\n\n**Phase:** 1 · **Depends on:** none\n\n## Story 1.1: Greet by name\n**Effort:** Small **Depends on:** none\n\n### Acceptance criteria\n- [x] `greet("Ada")` returns "Hello, Ada!"\n',
    'docs/todo.md': '# Todo\n\n- [x] 1.1 Greet by name\n',
    'design/DESIGN-SYSTEM.md': '# Design system\n\n## 1. Character\n\nCalm and friendly: quiet ink on white, one teal accent and plenty of room. It reads well on a phone.\n\n## 2. Tokens\n\nEvery value is in `tokens.css`.\n',
    'design/tokens.css': `:root { ${QUIET} }\n`,
    'design/screens/greet.html': [
      '<!doctype html>',
      '<html lang="en">',
      '<meta charset="utf-8">',
      '<title>Greeter · Greet</title>',
      '<style>',
      'body { margin: 0; padding: 16px; background: #ffffff; color: #1f2328; font-family: system-ui, sans-serif; }',
      '</style>',
      '<h1>Hello, Ada!</h1>',
      '<label>Your name <input value="Ada"></label>',
      '</html>',
      '',
    ].join('\n'),
  },
}

export const FIXTURES = {
  // A new folder after git init, as discover expects. The run's home is itself a repository that
  // holds the workspace, so a case that starts with no repository of its own would set up there.
  empty: [],
  // Code with tests and no Epikloop files, for adopt.
  existing: [{ subject: 'greet by name', date: '2026-10-28', files: CODE }],
  specified: [SPECIFY],
  architected: [SPECIFY, ARCHITECT],
  planned: [SPECIFY, ARCHITECT, PLAN],
  parked: [SPECIFY, ARCHITECT, PLAN, PARK],
  // A T3 story that landed without what it promised, before its review and after it.
  landed: [SPECIFY, ARCHITECT, PLAN_RISKY, LAND],
  reviewed: [SPECIFY, ARCHITECT, PLAN_RISKY, LAND, REVIEW],
  // The greeter page at stage 3: before its design, after the pick, and drawn but for one state.
  'web-specified': [WEB_SPECIFY],
  'web-picked': [WEB_SPECIFY, PICK],
  'web-incomplete': [WEB_SPECIFY, PICK, DRAW],
  // The greeter page after the pick, with a drawing model that no session of the suite runs on.
  'web-modelled': [WEB_SPECIFY, PICK, MODEL],
  // The greeter page at stage 5, its design complete and its architecture written.
  'web-architected': [WEB_SPECIFY, PICK, DRAW, DRAW_ERROR, WEB_ARCHITECT],
  // The greeter page at its phase's retro: its one story landed and reviewed, and the pictures of
  // its screen where the deep gates leave them.
  'web-closing': [WEB_SPECIFY, PICK, DRAW, DRAW_ERROR, WEB_ARCHITECT, WEB_PLAN, WEB_LAND, WEB_REVIEW],
  // The greeter page on an earlier template layout, outside a project, for adopt to convert.
  earlier: [EARLIER_LAYOUT],
}

// The fixtures before a batch carry the remote a new repository on GitHub gives a project: a
// network URL that nothing has been pushed to yet, from which init.mjs reads the project id. A push
// goes to a bare repository inside .git, where git never looks, so nothing leaves the machine. The
// other fixtures have no remote, so the skills that run `git fetch` never reach the network.
const REMOTE = new Set(['empty', 'specified', 'architected', 'web-specified', 'web-picked', 'web-modelled', 'web-architected'])
// A fixture a batch has pushed from carries that remote with its commits on it. There a fetch goes
// to the bare repository too, so `git fetch` answers at once, and without the network.
const PUSHED = new Set(['landed', 'web-closing'])

// ---- Building one

function run(cwd, command, args, env = {}) {
  const ran = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (ran.error) throw new Error(`${path.basename(command)} ${args[0]} failed: ${ran.error.message}`)
  if (ran.status !== 0) throw new Error(`${path.basename(command)} ${args[0]} failed: ${`${ran.stderr}${ran.stdout}`.trim().split('\n')[0]}`)
  return ran.stdout
}

const git = (cwd, args, env) => run(cwd, 'git', args, env)

function write(dir, file, text) {
  const target = path.join(dir, ...file.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}

function addToMarker(dir, fields) {
  const marker = path.join(dir, '.epikloop', 'project.json')
  const project = JSON.parse(fs.readFileSync(marker, 'utf8'))
  fs.writeFileSync(marker, `${JSON.stringify({ ...project, ...fields }, null, 2)}\n`)
}

// Builds fixture `name` in `dir`, which must be empty, so a mistyped folder is never committed to.
export function build(name, dir) {
  if (!Object.hasOwn(FIXTURES, name)) throw new Error(`no fixture named "${name}"; the fixtures are ${Object.keys(FIXTURES).join(', ')}`)
  const commits = FIXTURES[name]
  fs.mkdirSync(dir, { recursive: true })
  if (fs.readdirSync(dir).length > 0) throw new Error(`${dir} isn't empty, and a fixture is built only in an empty folder`)
  git(dir, ['init', '-q', '-b', 'main'])
  // The repository carries its own identity, so its commits, and the run's, work in any home.
  for (const [key, value] of [['user.name', 'Eval'], ['user.email', 'eval@example.invalid'], ['commit.gpgsign', 'false']]) git(dir, ['config', key, value])
  // Before the commits, so init reads the id from the remote. The random part keeps runs apart.
  if (REMOTE.has(name) || PUSHED.has(name)) {
    const bare = path.join(dir, '.git', 'origin.git').split(path.sep).join('/')
    const url = `https://example.invalid/greeter-${crypto.randomBytes(4).toString('hex')}.git`
    git(dir, ['init', '-q', '--bare', bare])
    git(dir, ['remote', 'add', 'origin', url])
    git(dir, ['config', `url.${bare}.${PUSHED.has(name) ? 'insteadOf' : 'pushInsteadOf'}`, url])
  }
  for (const commit of commits) {
    if (commit.init) run(dir, process.execPath, [INIT, '--lane', commit.init, '--mode', 'solo'])
    for (const [file, text] of Object.entries(commit.files)) write(dir, file, text)
    if (commit.marker) addToMarker(dir, commit.marker)
    git(dir, ['add', '-A'])
    // A hook git must run as a program, on every system.
    for (const file of commit.executable ?? []) {
      fs.chmodSync(path.join(dir, ...file.split('/')), 0o755)
      git(dir, ['update-index', '--chmod=+x', '--', file])
    }
    const when = `${commit.date}T10:00:00Z`
    // The fixture's history is set, not gated; the run's own commits are the ones that matter.
    git(dir, ['commit', '-q', '--no-verify', ...(commit.empty ? ['--allow-empty'] : []), '-m', commit.raw ? commit.subject : `fixture: ${commit.subject}`], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when })
    // Armed as the earlier template's install step armed it.
    if (commit.armed) git(dir, ['config', 'core.hooksPath', '.githooks'])
    for (const [file, bytes] of Object.entries(commit.untracked ?? {})) write(dir, file, bytes)
  }
  if (PUSHED.has(name)) git(dir, ['push', '-q', '--no-verify', 'origin', 'main'])
}

// ---- The scaffolds

// A case's scaffold.sh, exactly: the thin shim that hands its fixture's name to this file. The
// shell law holds every scaffold to the same form. It finds this file with dirname, because on
// Windows the harness gives the script a backslash path, which ${0%/*} can't cut.
export const SHIM = /^#!\/bin\/sh\nexec node "\$\(dirname "\$0"\)\/\.\.\/fixture\.mjs" ([a-z][a-z0-9-]*)\n$/

// Each case folder with a scaffold, and the fixture it names, or the problems found.
function scaffolds(evals = import.meta.dirname) {
  const named = []
  const problems = []
  const entries = fs.readdirSync(evals, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'results') continue
    const shim = path.join(evals, entry.name, 'scaffold.sh')
    const yaml = path.join(evals, entry.name, 'case.yaml')
    const runs = fs.existsSync(yaml) && /^\s+scaffold_script: scaffold\.sh\s*$/m.test(fs.readFileSync(yaml, 'utf8'))
    if (!fs.existsSync(shim)) {
      if (runs) problems.push(`${entry.name}: case.yaml names scaffold.sh, which isn't there`)
      continue
    }
    if (!runs) {
      problems.push(`${entry.name}: scaffold.sh is there, but case.yaml doesn't name it as its scaffold_script`)
      continue
    }
    const fixture = SHIM.exec(fs.readFileSync(shim, 'utf8'))?.[1]
    if (fixture === undefined) problems.push(`${entry.name}: scaffold.sh isn't the scaffold shim`)
    else if (!Object.hasOwn(FIXTURES, fixture)) problems.push(`${entry.name}: scaffold.sh names "${fixture}", which isn't a fixture`)
    else named.push([entry.name, fixture])
  }
  return { named, problems }
}

// ---- The self-test

async function selfTest() {
  const started = performance.now()
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-fixture-'))
  const home = path.join(temp, 'home')
  fs.mkdirSync(home)
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[core]\n\tautocrlf = false\n[maintenance]\n\tauto = false\n')
  // Each fixture builds as the scaffold builds it: with nothing from this machine's git setup, and a
  // home of its own, so the gates' events never reach this machine's ~/.epikloop.
  for (const key of Object.keys(process.env)) if (/^(?:GIT_.*|EMAIL|CLAUDE_CODE_SESSION_ID)$/i.test(key)) delete process.env[key]
  Object.assign(process.env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CEILING_DIRECTORIES: temp,
    GIT_TERMINAL_PROMPT: '0',
    HOME: home,
    USERPROFILE: home,
  })

  const built = (name) => {
    const dir = path.join(temp, name)
    build(name, dir)
    return dir
  }
  // The stage the briefing would give, with nothing it couldn't read.
  const stage = (name, n, next) => {
    const dir = built(name)
    const opened = openProject(dir)
    if (opened === null) return [`${name} isn't an Epikloop project`]
    if (opened.problem !== null) return [`${name}'s marker ${opened.problem}`]
    const state = readState(opened.root, opened.project, { home })
    const problems = state.problems.map((problem) => `${name}: ${problem}`)
    if (state.stage.n !== n || state.stage.next !== next) problems.push(`${name} is at stage ${state.stage.n} → ${state.stage.next}, not ${n} → ${next}`)
    return problems
  }
  const passes = (dir, args, what) => {
    const ran = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 120_000, windowsHide: true })
    return ran.status === 0 ? [] : [`${what} failed: ${`${ran.stdout}${ran.stderr}`.trim().split('\n').at(-1)}`]
  }

  const CASES = [
    [
      'empty is a repository of its own with no commits, outside a project',
      () => {
        const dir = built('empty')
        const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', windowsHide: true }).stdout.trim()
        const head = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: dir, encoding: 'utf8', windowsHide: true })
        return [
          ...(fs.realpathSync.native(top || temp) === fs.realpathSync.native(dir) ? [] : [`its repository is ${top}`]),
          ...(head.status === 0 ? ['it has a commit'] : []),
          ...(openProject(dir) === null ? [] : ['it is an Epikloop project']),
        ]
      },
    ],
    [
      'existing is outside a project, and its tests pass',
      () => {
        const dir = built('existing')
        return [...(openProject(dir) === null ? [] : ['existing is an Epikloop project']), ...passes(dir, ['--test'], "existing's node --test")]
      },
    ],
    [
      'earlier is outside a project, on an earlier layout whose armed hook runs its gate, and its tests pass',
      () => {
        const dir = built('earlier')
        const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true })
        const problems = [
          ...(openProject(dir) === null ? [] : ['earlier is an Epikloop project']),
          ...(fs.existsSync(path.join(dir, 'PIPELINE_VERSION')) ? [] : ['earlier has no PIPELINE_VERSION']),
          ...(run(['config', '--get', 'core.hooksPath']).stdout.trim() === '.githooks' ? [] : ["earlier's hooks aren't armed"]),
          ...(/^100755 /.test(run(['ls-files', '-s', '--', '.githooks/pre-commit']).stdout) ? [] : ["earlier's pre-commit isn't executable"]),
          ...(fs.readFileSync(path.join(dir, 'docs', 'context', 'decisions.md'), 'utf8').includes('[DECISION-002]') ? [] : ["earlier's decisions are missing"]),
          ...passes(dir, ['--test'], "earlier's node --test"),
        ]
        // A commit goes through the earlier hook, which runs the tests.
        write(dir, 'notes.md', 'A note.\n')
        run(['add', 'notes.md'])
        const committed = run(['commit', '-q', '-m', 'a note'])
        if (committed.status !== 0) problems.push(`a commit through the earlier hook failed: ${`${committed.stderr}${committed.stdout}`.trim().split('\n').at(-1)}`)
        return problems
      },
    ],
    ['specified is at stage 4', () => stage('specified', 4, '/epikloop:architect')],
    ['architected is at stage 5', () => stage('architected', 5, '/epikloop:plan')],
    [
      'planned is at stage 6, and the gates pass on it as built',
      () => {
        const problems = stage('planned', 6, '/epikloop:epic 1')
        return [...problems, ...passes(path.join(temp, 'planned'), [path.join('.githooks', 'check.mjs')], "planned's gates")]
      },
    ],
    ['parked is at stage 6, with its question first', () => stage('parked', 6, '/epikloop:decide, then /epikloop:epic 1')],
    [
      'landed is at stage 7, held until 1.1 is reviewed, and its tests and its gates pass as it stands',
      () => {
        const problems = stage('landed', 7, '/epikloop:epic 1')
        const dir = path.join(temp, 'landed')
        const state = readState(dir, openProject(dir).project, { home })
        const why = "epic 1's MVP stories are done, and it has no phase-1 tag, and 1.1 waits for its review"
        return [
          ...problems,
          ...(state.stage.why === why ? [] : [`landed waits because ${state.stage.why}`]),
          // T3, so its review parks a question whatever it finds.
          ...(state.stories.get('1.1')?.tier === 'T3' ? [] : ["landed's 1.1 isn't T3"]),
          // Its remote holds what landed, so a review's commit is the one thing left to push.
          ...(spawnSync('git', ['rev-list', '--count', 'refs/remotes/origin/main..HEAD'], { cwd: dir, encoding: 'utf8', windowsHide: true }).stdout.trim() === '0' ? [] : ["landed's remote doesn't hold its commits"]),
          ...(spawnSync('git', ['fetch'], { cwd: dir, encoding: 'utf8', windowsHide: true }).status === 0 ? [] : ["landed's fetch doesn't reach its remote"]),
          ...passes(dir, ['--test'], "landed's node --test"),
          ...passes(dir, [path.join('.githooks', 'check.mjs')], "landed's gates"),
        ]
      },
    ],
    [
      'reviewed is at stage 7, held until the review of 1.1 is closed, with its high question first',
      () => {
        const problems = stage('reviewed', 7, '/epikloop:decide')
        const dir = path.join(temp, 'reviewed')
        const state = readState(dir, openProject(dir).project, { home })
        const asked = state.questions.map((q) => `${q.id} ${q.review} ${q.severity}`).join(', ')
        return asked === 'Q-001 1.1 high' ? problems : [...problems, `reviewed asks ${asked}`]
      },
    ],
    ['web-specified is at stage 3, before its design', () => stage('web-specified', 3, '/epikloop:design')],
    [
      'web-picked is at stage 3, with its direction picked',
      () => {
        const problems = stage('web-picked', 3, '/epikloop:design')
        const dir = path.join(temp, 'web-picked')
        const state = readState(dir, openProject(dir).project, { home })
        const why = 'the direction is picked, and design/tokens.css is missing'
        return state.stage.why === why ? problems : [...problems, `web-picked waits because ${state.stage.why}`]
      },
    ],
    ['web-architected is at stage 5, its design complete', () => stage('web-architected', 5, '/epikloop:plan')],
    [
      'web-modelled is at stage 3, with its direction picked and a drawing model named in its marker',
      () => {
        const problems = stage('web-modelled', 3, '/epikloop:design')
        const dir = path.join(temp, 'web-modelled')
        const named = openProject(dir).project.model?.design
        return named === 'haiku' ? problems : [...problems, `web-modelled names ${JSON.stringify(named)} as its drawing model`]
      },
    ],
    [
      "web-closing is at stage 7, at its retro, with its screen's pictures outside git, and its gates pass as it stands",
      () => {
        const problems = stage('web-closing', 7, '/epikloop:retro')
        const dir = path.join(temp, 'web-closing')
        const screens = path.join(dir, 'test-results', 'screens')
        const pictures = fs.existsSync(screens) ? fs.readdirSync(screens).sort() : []
        const sizes = pictures.map((name) => {
          const bytes = fs.readFileSync(path.join(screens, name))
          return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
        })
        const read = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).stdout.trim()
        return [
          ...problems,
          ...(pictures.length === 8 && pictures[0] === 'greet.default.1280.app.png' ? [] : [`web-closing's pictures are ${pictures.join(', ') || 'missing'}`]),
          ...(new Set(sizes).size === 2 && sizes.includes('390x240') && sizes.includes('1280x240') ? [] : [`web-closing's pictures measure ${[...new Set(sizes)].join(', ')}`]),
          ...(read(['status', '--porcelain']) === '' ? [] : ["web-closing's tree isn't clean"]),
          ...(read(['rev-list', '--count', 'refs/remotes/origin/main..HEAD']) === '0' ? [] : ["web-closing's remote doesn't hold its commits"]),
          ...passes(dir, ['--test'], "web-closing's node --test"),
          ...passes(dir, [path.join('.githooks', 'check.mjs')], "web-closing's gates"),
        ]
      },
    ],
    [
      'web-incomplete is at stage 3, with one state left to draw',
      () => {
        const problems = stage('web-incomplete', 3, '/epikloop:design')
        const dir = path.join(temp, 'web-incomplete')
        const { design } = readState(dir, openProject(dir).project, { home })
        return design.missing.join(' ') === 'design/screens/greet.error.html' ? problems : [...problems, `web-incomplete lacks ${design.missing.join(', ')}`]
      },
    ],
    [
      'the fixtures before a batch carry a network remote nothing has been pushed to, and a push lands inside .git',
      () => {
        const problems = []
        const read = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).stdout.trim()
        const pushLog = (dir) => path.join(dir, '.git', 'logs', 'refs', 'remotes', 'origin', 'main')
        for (const name of REMOTE) {
          const dir = path.join(temp, `remote-${name}`)
          build(name, dir)
          const url = read(dir, ['remote', 'get-url', 'origin'])
          if (!/^https:\/\/example\.invalid\/greeter-[0-9a-f]{8}\.git$/.test(url)) problems.push(`${name}'s origin is ${JSON.stringify(url)}`)
          if (fs.existsSync(pushLog(dir))) problems.push(`${name} has been pushed to already`)
          const marker = path.join(dir, '.epikloop', 'project.json')
          const fromRemote = crypto.createHash('sha256').update(url.slice('https://'.length, -'.git'.length)).digest('hex').slice(0, 12)
          if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).id !== fromRemote) problems.push(`${name}'s project id isn't read from its remote`)
        }
        const dir = path.join(temp, 'remote-architected')
        const pushed = spawnSync('git', ['push', '-q', '--no-verify', 'origin', 'main'], { cwd: dir, encoding: 'utf8', windowsHide: true })
        if (pushed.status !== 0) return [...problems, `the push failed: ${`${pushed.stderr}${pushed.stdout}`.trim().split('\n')[0]}`]
        if (!(fs.existsSync(pushLog(dir)) && /\tupdate by push$/m.test(fs.readFileSync(pushLog(dir), 'utf8')))) problems.push("the push left no update by push in origin/main's log")
        if (read(dir, ['--git-dir', '.git/origin.git', 'rev-parse', 'refs/heads/main']) !== read(dir, ['rev-parse', 'HEAD'])) problems.push("the bare repository's main isn't HEAD")
        return problems
      },
    ],
    [
      'the other fixtures have no remote',
      () =>
        Object.keys(FIXTURES)
          .filter((name) => !REMOTE.has(name) && !PUSHED.has(name))
          .flatMap((name) => {
            const dir = path.join(temp, `local-${name}`)
            build(name, dir)
            const remotes = spawnSync('git', ['remote'], { cwd: dir, encoding: 'utf8', windowsHide: true }).stdout.trim()
            return remotes === '' ? [] : [`${name} has a remote: ${remotes.split('\n').join(', ')}`]
          }),
    ],
    [
      'a fixture builds only in an empty folder',
      () => {
        const dir = path.join(temp, 'occupied')
        write(dir, 'notes.txt', 'mine\n')
        try {
          build('planned', dir)
          return ['built over a folder that had a file in it']
        } catch (error) {
          return String(error.message).includes("isn't empty") ? [] : [`refused for another reason: ${error.message}`]
        }
      },
    ],
    [
      "a scaffold that isn't the shim, names no fixture, or isn't run, is reported",
      () => {
        const evals = path.join(temp, 'evals')
        const shim = (fixture) => `#!/bin/sh\nexec node "$(dirname "$0")/../fixture.mjs" ${fixture}\n`
        const runs = 'schema_version: "1.1"\ncontext:\n  scaffold_script: scaffold.sh\n'
        write(evals, 'more/scaffold.sh', `${shim('planned')}echo more\n`)
        write(evals, 'more/case.yaml', runs)
        write(evals, 'unknown/scaffold.sh', shim('nosuch'))
        write(evals, 'unknown/case.yaml', runs)
        write(evals, 'unrun/scaffold.sh', shim('planned'))
        write(evals, 'unrun/case.yaml', 'schema_version: "1.1"\n')
        write(evals, 'missing/case.yaml', runs)
        write(evals, 'fine/scaffold.sh', shim('planned'))
        write(evals, 'fine/case.yaml', runs)
        const { named, problems } = scaffolds(evals)
        const expected = [
          "more: scaffold.sh isn't the scaffold shim",
          'unknown: scaffold.sh names "nosuch", which isn\'t a fixture',
          "unrun: scaffold.sh is there, but case.yaml doesn't name it as its scaffold_script",
          "missing: case.yaml names scaffold.sh, which isn't there",
        ]
        return [
          ...expected.filter((line) => !problems.includes(line)).map((line) => `didn't report "${line}"`),
          ...(problems.length === expected.length ? [] : [`reported ${problems.length} problems, not ${expected.length}`]),
          ...(JSON.stringify(named) === JSON.stringify([['fine', 'planned']]) ? [] : [`named ${JSON.stringify(named)}`]),
        ]
      },
    ],
    [
      'every scaffold names a fixture, and every fixture has a case',
      () => {
        const { named, problems } = scaffolds()
        const used = new Set(named.map(([, fixture]) => fixture))
        const unused = Object.keys(FIXTURES).filter((name) => !used.has(name))
        return [...problems, ...unused.map((name) => `no case's scaffold builds ${name}`)]
      },
    ],
  ]

  const failures = []
  let failed = 0
  for (const [name, body] of CASES) {
    let problems
    try {
      problems = await body()
    } catch (error) {
      problems = [`threw: ${String(error?.message ?? error).split('\n')[0]}`]
    }
    if (problems.length > 0) failed += 1
    for (const problem of problems) failures.push(`${name}: ${problem}`)
  }
  fs.rmSync(temp, { recursive: true, force: true })
  for (const line of failures) console.log(line)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`fixture self-test: ${CASES.length - failed}/${CASES.length} as expected · ${scaffolds().named.length} scaffolds · ${seconds} s`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {
  const [first, dir] = process.argv.slice(2)
  try {
    if (first === '--self-test') await selfTest()
    else if (first === undefined || first.startsWith('-') || process.argv.length > 4) {
      console.log(USAGE)
      process.exitCode = 1
    } else {
      build(first, path.resolve(dir ?? '.'))
      console.log(`fixture: ${first} built`)
    }
  } catch (error) {
    console.log(`fixture: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
