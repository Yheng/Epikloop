// Epikloop's SessionStart briefing, a command hook. Inside an Epikloop project it arms the git
// hooks when nothing else owns them, then gives Claude one line on where the project stands,
// followed by the pipeline protocol. Outside one it gives a single line. It prints only its JSON
// answer and exits 0, whatever happens.
//
// The fuel gauge, the stage and its next step come from state.mjs, which reads the project files in
// their formats.
//
// `node brief.mjs --self-test` runs every case below through this file as a spawned hook.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { openProject, readState, summary } from './state.mjs'

const OUTSIDE = 'Not an Epikloop project. `/epikloop` to start.'

// The pipeline protocol, after the briefing line. It reaches the model, so it counts toward the
// prompt ceiling.
const PROTOCOL = `Epikloop protocol for this project:

- The project's state lives in its files and its git history, never in the conversation. spec/
  holds the current requirements, with stable IDs and business rules quoted verbatim, and
  spec/architecture.md the current architecture. docs/decisions.md is append-only.
  docs/stories/<epic>.md holds the stories; each carries a spec delta, applied in the same commit
  as its code. docs/queue.md holds parked questions and backlog lines, each dated. design/ is the
  visual truth. Which stories are done is read from git, never written down.
- Work lands on the default branch. In solo mode a commit is pushed to it when there is a remote;
  in team mode a commit goes on a branch of its own, with a pull request the human merges. A story
  is done once its commit has landed.
- A batch (/epikloop:epic, /epikloop:next or /epikloop:story) never stops to ask the human. A
  question that needs a product call is parked in docs/queue.md with the conservative default
  taken and what it blocks, and the work goes on with that default; /epikloop:decide answers
  parked questions in one sitting.
- A finding goes by threshold: mechanical and small is fixed now in its own commit; one that needs
  a product call is a parked question; real but not MVP-breaking is one dated backlog line; one
  that breaks an MVP acceptance criterion is fixed now or parked as an explicit scope question.
  Nothing is filed by default.`

const failure = (reason) => `Epikloop's briefing couldn't run (${reason}); \`/epikloop\` shows where things stand.`

// The plugin's own copy of the gate runner arms the hooks, so no code from the repository runs at
// session start. Only a repository that carries the runner is armed.
const RUNNER = path.join(import.meta.dirname, '..', 'templates', 'githooks', 'check.mjs')
const ARM_CAP = 5_000

// What arming did, as a fact for the briefing, or what needs the human; empty when there was
// nothing to say.
function arm(root) {
  if (!fs.existsSync(path.join(root, '.githooks', 'check.mjs'))) return {}
  const run = spawnSync(process.execPath, [RUNNER, '--arm'], {
    cwd: root,
    encoding: 'utf8',
    timeout: ARM_CAP,
    windowsHide: true,
  })
  if (run.error) return { needs: `git hooks couldn't be checked (${run.error.code ?? run.error.message})` }
  const line = run.stdout.trim().split('\n').pop()
  const said = /^git hooks: (.*)$/.exec(line)
  if (said === null) return line === '' ? {} : { needs: `git hooks couldn't be checked (${line})` }
  return said[1].startsWith('not armed') ? { needs: `git hooks ${said[1]}` } : { fact: `Git hooks: ${said[1]}.` }
}

// Format problems the briefing names before it counts the rest.
const SHOWN_PROBLEMS = 3

function briefing(opened) {
  const hooks = arm(opened.root)
  const state = opened.problem === null ? readState(opened.root, opened.project) : null
  const { parts, needs } = summary(opened, state)
  if (state !== null) {
    needs.push(...state.problems.slice(0, SHOWN_PROBLEMS))
    if (state.problems.length > SHOWN_PROBLEMS) needs.push(`and ${state.problems.length - SHOWN_PROBLEMS} more`)
  }
  if (hooks.fact) parts.push(hooks.fact)
  if (hooks.needs) needs.push(hooks.needs)
  if (needs.length > 0) parts.push(`Needs the human: ${needs.join('; ')}.`)
  return `${parts.join(' ')}\n\n${PROTOCOL}`
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0]

const answer = (context) => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } })

// Prints its answer as JSON and exits 0. Anything that goes wrong becomes a one-line context.
async function hook() {
  let context
  try {
    let raw = ''
    for await (const chunk of process.stdin.setEncoding('utf8')) raw += chunk
    // Windows PowerShell 5.1 starts piped text with a BOM.
    const input = JSON.parse(raw.replace(/^﻿/, ''))
    const opened = openProject(input.cwd || process.cwd())
    context = opened === null ? OUTSIDE : briefing(opened)
  } catch (error) {
    context = failure(firstLine(error))
  }
  process.stdout.write(JSON.stringify(answer(context)))
}

const marker = (fields = {}) => JSON.stringify({ format: 1, id: '000000000000', lane: 'web', mode: 'solo', ...fields })
const SPEC = '# Auth\n\n## REQ-AUTH-001 Sign in\n\nPeople sign in.\n'
// A web project that has passed stage 5.
const PLANNED = {
  '.epikloop/project.json': marker({ mvp_frozen: '2026-11-02' }),
  'spec/auth.md': SPEC,
  'spec/architecture.md': '# Architecture\n',
  'design/manifest.md': '# Screens\n',
  'docs/stories/1-auth.md': '# Epic 1: Auth\n\n## 1.1 Sign in\n- Tier: T1\n- MVP: yes\n- Requirements: REQ-AUTH-001\n\n### Spec delta\n- none\n',
}
const SILENT_HOOKS = ['git hooks', 'Git hooks']

// Each case: [name, files, expectations]. Files map a path to its content, or to null to leave it
// out. `says` lists text the context must hold and `silent` text it must not, `exact` is the whole
// context, and `hooksPath` is what git reports afterwards ('' for unset). The layout options are
// `git` (a repository), `armed` (core.hooksPath already .githooks), `foreign` (a hook another
// tool installed), `cwd` (a subdirectory to start in) and `input` (raw hook input).
const CASES = [
  ['outside a project', {}, { exact: OUTSIDE }],
  ['a marker that does not parse', { '.epikloop/project.json': '{' }, { says: ["Needs the human: .epikloop/project.json doesn't parse"] }],
  ['a marker without a valid mode', { '.epikloop/project.json': marker({ mode: 'duo' }) }, { says: ['.epikloop/project.json has no valid mode'] }],
  [
    'requirements missing',
    { '.epikloop/project.json': marker(), 'spec/architecture.md': '# Architecture\n' },
    { says: ['Stage 2 of 10: spec/ holds no requirements yet. Next: /epikloop:discover for a new product'] },
  ],
  [
    'a subdirectory of the project',
    { '.epikloop/project.json': marker(), 'src/app.ts': '' },
    { cwd: 'src', says: ['Epikloop project 000000000000 (web, solo). Stage 2 of 10'] },
  ],
  [
    'a UI lane without screens, until design arrives in M2',
    { '.epikloop/project.json': marker(), 'spec/auth.md': SPEC },
    { says: ['Stage 4 of 10: spec/architecture.md is missing. Next: /epikloop:architect.'] },
  ],
  [
    'the service lane skipping design',
    { '.epikloop/project.json': marker({ lane: 'service' }), 'spec/auth.md': SPEC },
    { says: ['Stage 4 of 10: spec/architecture.md is missing. Next: /epikloop:architect.'] },
  ],
  ['stories missing', { ...PLANNED, 'docs/stories/1-auth.md': null }, { says: ['Stage 5 of 10: docs/stories/ holds no stories yet. Next: /epikloop:plan.'] }],
  [
    'the MVP set not frozen',
    { ...PLANNED, '.epikloop/project.json': marker() },
    { says: ["Stage 5 of 10: the MVP set isn't frozen. Next: /epikloop:plan."] },
  ],
  [
    'planned and frozen, with the gauge first',
    PLANNED,
    { exact_start: 'MVP 0/1 · 0.0 stories/day · ETA unknown · queue Δ unknown. Epikloop project 000000000000 (web, solo). Stage 6 of 10: epic 1 has 1 MVP story left. Next: /epikloop:epic 1.\n' },
  ],
  [
    'waiting questions and format problems',
    {
      ...PLANNED,
      'docs/queue.md': '# Queue\n\n## Questions\n\n### Q-001 One (2026-11-01)\n- Blocks: 1.1\n- Default taken: a\n\n### Q-002 Two (2026-11-01)\n- Blocks: nothing\n- Default taken: b\n',
      'docs/stories/2-more.md': '# Epic 2: More\n\n## 2.1 No fields\n',
    },
    {
      says: [
        'Stage 6 of 10: epic 1 has 1 MVP story left, and Q-001 blocks 1.1. Next: /epikloop:decide, then /epikloop:epic 1.',
        'Needs the human: 2 questions wait in docs/queue.md; docs/stories/2-more.md:3: 2.1 has no Tier; docs/stories/2-more.md:3: 2.1 has no MVP; docs/stories/2-more.md:3: 2.1 has no Requirements; and 1 more.',
      ],
    },
  ],
  ['hooks to arm', { ...PLANNED, '.githooks/check.mjs': '' }, { git: true, says: ['Git hooks: armed (.githooks).'], hooksPath: '.githooks' }],
  ['hooks already armed', { ...PLANNED, '.githooks/check.mjs': '' }, { git: true, armed: true, silent: SILENT_HOOKS, hooksPath: '.githooks' }],
  [
    'hooks another tool owns',
    { ...PLANNED, '.githooks/check.mjs': '' },
    { git: true, foreign: true, says: ['Needs the human: git hooks not armed'], hooksPath: '' },
  ],
  ['a repository without the runner', PLANNED, { git: true, silent: SILENT_HOOKS, hooksPath: '' }],
  ['input that is not JSON', {}, { input: 'not json', says: ["Epikloop's briefing couldn't run"] }],
]

// The context the hook gave, or why its run is not a valid answer.
function contextOf({ status, stdout, error }) {
  if (error || status !== 0) return { wrong: `exit ${status ?? error.code}` }
  let output
  try {
    output = JSON.parse(stdout).hookSpecificOutput
  } catch {
    return { wrong: 'output that is not JSON' }
  }
  if (output?.hookEventName !== 'SessionStart' || typeof output.additionalContext !== 'string') {
    return { wrong: `an answer that is not SessionStart context: ${stdout}` }
  }
  return { context: output.additionalContext }
}

async function selfTest() {
  const os = await import('node:os')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-brief-'))
  const home = path.join(temp, 'home')
  fs.mkdirSync(home)
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '')
  // git and the hook run without the machine's git settings or CI, which would skip arming.
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:GIT_.*|CI|HOME|USERPROFILE)$/i.test(key)) env[key] = value
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CEILING_DIRECTORIES: temp,
    HOME: home,
    USERPROFILE: home,
  })
  const git = (cwd, ...args) => {
    const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true })
    if (run.error) throw run.error
    return run
  }
  const failures = []
  const times = []
  let largest = 0
  try {
    for (const [n, [name, files, expect]] of CASES.entries()) {
      const dir = path.join(temp, `case-${n}`)
      fs.mkdirSync(dir)
      if (expect.git) git(dir, 'init', '-q')
      for (const [file, content] of Object.entries(files)) {
        if (content === null) continue
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        fs.writeFileSync(path.join(dir, file), content)
      }
      if (expect.armed) git(dir, 'config', 'core.hooksPath', '.githooks')
      if (expect.foreign) fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n# husky\n')
      const cwd = path.join(dir, expect.cwd ?? '')
      const input = expect.input ?? JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'self-test', cwd })
      const start = performance.now()
      const run = spawnSync(process.execPath, [import.meta.filename], { input, env, encoding: 'utf8', windowsHide: true })
      times.push(performance.now() - start)
      const { context, wrong } = contextOf(run)
      const problems = []
      if (wrong) problems.push(`gave ${wrong}`)
      else {
        largest = Math.max(largest, context.length)
        if (context.length >= 10_000) problems.push(`gave ${context.length} characters, past the 10,000 cap`)
        if (expect.exact !== undefined && context !== expect.exact) problems.push(`gave ${JSON.stringify(context)}`)
        if (expect.exact_start !== undefined && !context.startsWith(expect.exact_start)) problems.push(`starts ${JSON.stringify(context.slice(0, 220))}`)
        for (const text of expect.says ?? []) if (!context.includes(text)) problems.push(`lacks ${JSON.stringify(text)}`)
        for (const text of expect.silent ?? []) if (context.includes(text)) problems.push(`holds ${JSON.stringify(text)}`)
        const inside = '.epikloop/project.json' in files && expect.input === undefined
        if (inside && !context.endsWith(`\n\n${PROTOCOL}`)) problems.push('lacks the protocol at its end')
        if (!inside && context.includes(PROTOCOL)) problems.push('holds the protocol')
        if (problems.length > 0) problems.push(`in ${JSON.stringify(context.split('\n')[0])}`)
      }
      if (expect.hooksPath !== undefined) {
        const set = git(dir, 'config', '--local', '--get', 'core.hooksPath').stdout.trim()
        if (set !== expect.hooksPath) problems.push(`left core.hooksPath ${JSON.stringify(set)}, not ${JSON.stringify(expect.hooksPath)}`)
      }
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  times.sort((a, b) => a - b)
  const median = Math.round(times[Math.floor(times.length / 2)])
  const max = Math.round(times[times.length - 1])
  const passed = CASES.length - failures.length
  console.log(
    `brief self-test: ${passed}/${CASES.length} as expected; largest context ${largest} characters (cap 10,000);` +
      ` spawn median ${median} ms, max ${max} ms`,
  )
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (process.argv[2] === '--self-test') await selfTest()
else await hook()
