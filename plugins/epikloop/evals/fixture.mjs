// The eval suite's fixture project: a tiny greeter, built as the git repository a case starts in.
//
// `node fixture.mjs <name> [dir]` builds fixture <name> in dir, the current folder by default, which
// must be empty. A case's scaffold.sh runs it in the case's workspace, before Claude starts. Each
// fixture is the greeter at one stage of its life, or the empty repository before it, and its
// commits start `fixture: `, so a grader can tell them from the commits made during the run.
//
// `node fixture.mjs --self-test` builds every fixture in a temporary folder, reads each one as the
// briefing does, and checks that every case's scaffold names a fixture.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openProject, readState } from '../bin/state.mjs'

const PLUGIN = path.join(import.meta.dirname, '..')
const INIT = path.join(PLUGIN, 'bin', 'init.mjs')
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

// Each commit: its subject after `fixture: `, its date, and what it writes. `init` runs the plugin's
// own setup first, as discover does; `marker` adds fields to the project marker.
const SPECIFY = { subject: 'spec the greeter', date: '2026-10-29', init: true, files: { 'spec/greet.md': SPEC } }
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
}

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
  for (const commit of commits) {
    if (commit.init) run(dir, process.execPath, [INIT, '--lane', 'service', '--mode', 'solo'])
    for (const [file, text] of Object.entries(commit.files)) write(dir, file, text)
    if (commit.marker) addToMarker(dir, commit.marker)
    git(dir, ['add', '-A'])
    const when = `${commit.date}T10:00:00Z`
    // The fixture's history is set, not gated; the run's own commits are the ones that matter.
    git(dir, ['commit', '-q', '--no-verify', '-m', `fixture: ${commit.subject}`], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when })
  }
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
