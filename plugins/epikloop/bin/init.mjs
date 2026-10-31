// Epikloop's project setup. `node init.mjs --lane <lane> --mode solo|team` makes the git repository
// it runs in an Epikloop project: it writes .epikloop/project.json with the project id, copies the
// gate runner and its shims from the plugin's templates, lays down CLAUDE.md and, in team mode, the
// required check's workflow, stages what it wrote, and arms the hooks. It never overwrites a file
// and never commits. It prints one summary line, and exits 1 only when it couldn't do its job.
//
// `node init.mjs --refresh` brings an existing project's gate files up to the plugin's: it copies in
// each one that is missing or differs from its template, and stages it, leaving the marker alone.
// In team mode it also lays down the workflow when it is missing.
// `node init.mjs --self-test` runs every case below against throwaway repositories.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { laneNames } from './state.mjs'

const USAGE = 'usage: node init.mjs --lane <lane> --mode solo|team | --refresh'
export const TEMPLATES = path.join(import.meta.dirname, '..', 'templates')
const RUNNER = path.join(TEMPLATES, 'githooks', 'check.mjs')
// Each gate file, the template it is copied from, and whether it is a shim git must run as a
// program.
export const GATE_FILES = [
  ['.githooks/check.mjs', 'githooks/check.mjs', false],
  ['.githooks/pre-commit', 'githooks/pre-commit', true],
  ['.githooks/pre-push', 'githooks/pre-push', true],
  ['scripts/check.sh', 'scripts/check.sh', true],
]
// The files laid down once, where the repository lacks them, and the project's own from then on:
// its rules in either mode, and in team mode the required check, whose install step the project
// writes. Each one, its template, and the mode it needs, or null for either.
export const PROJECT_FILES = [
  ['CLAUDE.md', 'CLAUDE.template.md', null],
  ['.github/workflows/check.yml', 'github/workflows/check.yml', 'team'],
]
const WORKFLOW = '.github/workflows/check.yml'
const PROTECTION = "make the check job required in the default branch's protection on GitHub"
const POSIX = process.platform !== 'win32'

// Whether two copies of a file hold the same text, whatever their line endings: git on Windows may
// check a file out with CRLF.
const sameText = (a, b) => a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8').replace(/\r\n/g, '\n')

// The gate files in the repository at `top` that are missing, or differ from their templates.
export function staleGates(top) {
  return GATE_FILES.filter(([file, template]) => {
    const target = path.join(top, ...file.split('/'))
    return !fs.existsSync(target) || !sameText(fs.readFileSync(target), fs.readFileSync(path.join(TEMPLATES, ...template.split('/'))))
  })
}

// Writes each of `files` that a project in `mode` gets and the repository at `top` lacks, and
// returns those it wrote.
function layDown(top, mode, files = PROJECT_FILES) {
  const wrote = []
  for (const [file, template, needs] of files) {
    const target = path.join(top, ...file.split('/'))
    if ((needs !== null && needs !== mode) || fs.existsSync(target)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, fs.readFileSync(path.join(TEMPLATES, ...template.split('/'))))
    wrote.push(file)
  }
  return wrote
}

function git(cwd, args, env) {
  const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (run.error) throw new Error(`git ${args[0]} failed: ${run.error.message}`)
  return run
}

function gitOk(cwd, args, env) {
  const run = git(cwd, args, env)
  if (run.status !== 0) throw new Error(`git ${args[0]} failed: ${run.stderr.trim().split('\n')[0]}`)
  return run.stdout
}

// A network remote as host/path, lowercased, without its scheme, credentials, port or .git; null
// for a remote on this machine.
function normalizeRemote(url) {
  let rest
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url)
  if (scheme !== null) {
    if (scheme[1].toLowerCase() === 'file') return null
    rest = scheme[2].replace(/^[^/]*@/, '').replace(/^([^/:]*):\d*(?=\/|$)/, '$1')
  } else {
    // The scp form, [user@]host:path. A one-letter host is a Windows drive.
    const scp = /^(?:[^@/]+@)?([^/:]+):(.*)$/.exec(url)
    if (scp === null || scp[1].length === 1) return null
    rest = `${scp[1]}/${scp[2]}`
  }
  rest = rest.replace(/\/+/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '')
  return /^[^/]+\/./.test(rest) ? rest.toLowerCase() : null
}

// The project id: the first 12 hex digits of the SHA-256 of origin's normalized URL, or of the first
// remote's when there is no origin, or of the repository path when no remote is on the network.
function projectId(top) {
  const names = gitOk(top, ['remote']).split('\n').map((name) => name.trim()).filter(Boolean)
  const name = names.includes('origin') ? 'origin' : names[0]
  const url = name === undefined ? null : gitOk(top, ['remote', 'get-url', name]).trim()
  const remote = url === null ? null : normalizeRemote(url)
  const id = crypto.createHash('sha256').update(remote ?? top).digest('hex').slice(0, 12)
  return { id, from: remote ?? 'the repository path' }
}

// What arming did, in the runner's own words. The plugin's copy of the runner arms, as at session
// start.
function arm(top) {
  const run = spawnSync(process.execPath, [RUNNER, '--arm'], { cwd: top, encoding: 'utf8', timeout: 5_000, windowsHide: true })
  if (run.error) return `git hooks couldn't be checked (${run.error.code ?? run.error.message})`
  return run.stdout.trim().split('\n').pop()
}

function init(argv) {
  let options
  try {
    options = parseArgs({ args: argv, options: { lane: { type: 'string' }, mode: { type: 'string' } } }).values
  } catch {
    return console.log(USAGE)
  }
  if (!/^[a-z][a-z0-9-]*$/.test(options.lane ?? '') || !['solo', 'team'].includes(options.mode)) return console.log(USAGE)
  const lanes = laneNames()
  if (!lanes.includes(options.lane)) return console.log(`init: lane "${options.lane}" is not one of ${lanes.join(', ')}`)
  const inside = git(process.cwd(), ['rev-parse', '--show-toplevel'])
  if (inside.status !== 0) return console.log('init: not a git repository; run git init first')
  const top = inside.stdout.trim()
  const parts = []
  const wrote = []
  const shims = []
  // The mode the project ends up in: a kept marker's own, or the one asked for.
  let mode = options.mode

  const marker = path.join(top, '.epikloop', 'project.json')
  if (fs.existsSync(marker)) {
    let kept
    try {
      const project = JSON.parse(fs.readFileSync(marker, 'utf8').replace(/^﻿/, ''))
      mode = project.mode
      const own = [project.lane !== options.lane && `lane ${project.lane}`, project.mode !== options.mode && `mode ${project.mode}`]
      const keeps = own.filter(Boolean)
      kept = `kept (id ${project.id}${keeps.length > 0 ? `; it keeps ${keeps.join(' and ')}` : ''})`
    } catch {
      kept = "kept, though it doesn't parse"
    }
    parts.push(`.epikloop/project.json ${kept}`)
  } else {
    const { id, from } = projectId(top)
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, `${JSON.stringify({ format: 1, id, lane: options.lane, mode: options.mode }, null, 2)}\n`)
    wrote.push('.epikloop/project.json')
    parts.push(`.epikloop/project.json written (id ${id} from ${from}; ${options.lane}, ${options.mode})`)
  }

  const differ = []
  for (const [file, template, shim] of GATE_FILES) {
    const target = path.join(top, ...file.split('/'))
    const content = fs.readFileSync(path.join(TEMPLATES, ...template.split('/')))
    if (fs.existsSync(target)) {
      if (!sameText(fs.readFileSync(target), content)) differ.push(file)
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    if (POSIX && shim) fs.chmodSync(target, 0o755)
    ;(shim ? shims : wrote).push(file)
  }
  const gates = GATE_FILES.map(([file]) => file).filter((file) => shims.includes(file) || wrote.includes(file))
  if (gates.length === GATE_FILES.length) parts.push('.githooks/ and scripts/check.sh written')
  else if (gates.length > 0) parts.push(`${gates.join(', ')} written`)
  const laid = layDown(top, mode)
  wrote.push(...laid)
  if (laid.length > 0) parts.push(`${laid.join(' and ')} written`)
  if (differ.length > 0) {
    const one = differ.length === 1
    parts.push(`kept ${differ.join(', ')}, which ${one ? 'differs' : 'differ'} from the plugin's template; --refresh replaces ${one ? 'it' : 'them'}`)
  }

  // Git on Windows adds a file Node wrote as 100644, and the shims gate wants 100755.
  const plain = wrote.filter((file) => !shims.includes(file))
  if (plain.length > 0) gitOk(top, ['add', '--', ...plain])
  if (shims.length > 0) gitOk(top, ['add', '--chmod=+x', '--', ...shims])
  if (plain.length + shims.length > 0) parts.push('staged')

  const armed = arm(top)
  if (armed) parts.push(armed)
  if (laid.includes(WORKFLOW)) parts.push(PROTECTION)
  console.log(`init: ${parts.join(' · ')}`)
  process.exitCode = 0
}

// Copies the plugin's current gate files over a project's missing or stale copies, lays down a team
// project's missing workflow, and stages them.
function refresh(argv) {
  if (argv.length > 0) return console.log(USAGE)
  const inside = git(process.cwd(), ['rev-parse', '--show-toplevel'])
  if (inside.status !== 0) return console.log('init: not a git repository; run git init first')
  const top = inside.stdout.trim()
  const marker = path.join(top, '.epikloop', 'project.json')
  if (!fs.existsSync(marker)) return console.log('init: not an Epikloop project, so there are no gate files to refresh')
  let mode = null
  try {
    mode = JSON.parse(fs.readFileSync(marker, 'utf8').replace(/^﻿/, '')).mode
  } catch {}
  const stale = staleGates(top)
  for (const [file, template, shim] of stale) {
    const target = path.join(top, ...file.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, fs.readFileSync(path.join(TEMPLATES, ...template.split('/'))))
    if (POSIX && shim) fs.chmodSync(target, 0o755)
  }
  const laid = layDown(top, mode, PROJECT_FILES.filter(([file]) => file === WORKFLOW))
  const plain = [...stale.filter(([, , shim]) => !shim).map(([file]) => file), ...laid]
  const shims = stale.filter(([, , shim]) => shim).map(([file]) => file)
  if (plain.length > 0) gitOk(top, ['add', '--', ...plain])
  if (shims.length > 0) gitOk(top, ['add', '--chmod=+x', '--', ...shims])
  const parts = []
  if (stale.length > 0) parts.push(`refreshed ${stale.map(([file]) => file).join(', ')}`)
  if (laid.length > 0) parts.push(`${laid.join(' and ')} written`)
  if (parts.length === 0) console.log("init: the gate files already match the plugin's")
  else console.log(`init: ${[...parts, 'staged', ...(laid.length > 0 ? [PROTECTION] : [])].join(' · ')}`)
  process.exitCode = 0
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)

// The required check's settled parts, line by line, and its gates step, pinned: a change to either
// changes what the check runs.
const SETTLED = [
  'on:',
  '  pull_request:',
  '  contents: read',
  '  cancel-in-progress: true',
  '    timeout-minutes: 10',
  '          fetch-depth: 0',
  '          persist-credentials: false',
  '          node-version: 22',
]
const GATES_STEP = [
  '        env:',
  '          HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
  '          BASE_SHA: ${{ github.event.pull_request.base.sha }}',
  '        run: echo "pull-request $HEAD_SHA base $BASE_SHA" | scripts/check.sh --push origin origin',
]

// Each case: [name, check]. A check gets a kit and returns the problems it found.
const CASES = [
  ...[
    ['an https remote with credentials', 'https://user:tok@GitHub.com/Owner/Repo.git', 'github.com/owner/repo'],
    ['an scp-form remote', 'git@github.com:Owner/Repo.git', 'github.com/owner/repo'],
    ['an ssh URL with a port', 'ssh://git@host.example:2222/owner/repo.git/', 'host.example/owner/repo'],
    ['a GitLab subgroup', 'https://gitlab.com/Group/Sub/Repo.git', 'gitlab.com/group/sub/repo'],
    ['a relative-path remote', '../elsewhere.git', null],
    ['a Windows drive remote', 'C:/repos/app.git', null],
    ['a file URL remote', 'file:///srv/app.git', null],
  ].map(([name, url, normalized]) => [
    name,
    (k) => {
      const dir = k.repo()
      k.git(dir, 'remote', 'add', 'origin', url)
      return k.marks(dir, k.init(dir), normalized)
    },
  ]),
  [
    'origin over another remote',
    (k) => {
      const dir = k.repo()
      k.git(dir, 'remote', 'add', 'aaa', 'https://example.com/a/b.git')
      k.git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
      return k.marks(dir, k.init(dir), 'github.com/o/r')
    },
  ],
  [
    'the one remote, without origin',
    (k) => {
      const dir = k.repo()
      k.git(dir, 'remote', 'add', 'upstream', 'git@host.example:team/app.git')
      return k.marks(dir, k.init(dir), 'host.example/team/app')
    },
  ],
  [
    'no remote',
    (k) => {
      const dir = k.repo()
      return k.marks(dir, k.init(dir), null)
    },
  ],
  [
    'an existing marker',
    (k) => {
      const dir = k.repo()
      const before = JSON.stringify({ format: 1, id: 'abcdefabcdef', lane: 'service', mode: 'solo' })
      k.write(dir, '.epikloop/project.json', before)
      const run = k.init(dir, ['--lane', 'web', '--mode', 'team'])
      const problems = k.says(run, '.epikloop/project.json kept (id abcdefabcdef; it keeps lane service and mode solo)')
      if (fs.existsSync(path.join(dir, '.github')) || run.stdout.includes('protection')) problems.push("laid down team mode's workflow, which the kept marker doesn't use")
      if (k.read(dir, '.epikloop/project.json') !== before) problems.push('changed the marker')
      return problems
    },
  ],
  [
    'a runner that differs',
    (k) => {
      const dir = k.repo()
      k.write(dir, '.githooks/check.mjs', 'old\n')
      const run = k.init(dir)
      const problems = k.says(run, "kept .githooks/check.mjs, which differs from the plugin's template; --refresh replaces it")
      if (k.read(dir, '.githooks/check.mjs') !== 'old\n') problems.push('overwrote the runner')
      problems.push(...k.says(run, '.githooks/pre-commit, .githooks/pre-push, scripts/check.sh written'))
      return problems
    },
  ],
  [
    'the copies, their modes and arming',
    (k) => {
      const dir = k.repo()
      const run = k.init(dir)
      const problems = k.says(run, '.githooks/ and scripts/check.sh written · CLAUDE.md written · staged · git hooks: armed (.githooks)')
      for (const [file, template, shim] of [...GATE_FILES, ['CLAUDE.md', 'CLAUDE.template.md', false]]) {
        if (!k.same(dir, file, template)) problems.push(`${file} is not its template`)
        if (POSIX && shim && (fs.statSync(path.join(dir, file)).mode & 0o111) === 0) problems.push(`${file} is not executable`)
      }
      if (fs.existsSync(path.join(dir, '.github')) || run.stdout.includes('protection')) problems.push('laid down a workflow in solo mode')
      const staged = k.git(dir, 'ls-files', '-s').stdout
      for (const [file, , shim] of [...GATE_FILES, ['CLAUDE.md', null, false]]) {
        const mode = shim ? '100755' : '100644'
        if (!k.staged(staged, file, mode)) problems.push(`${file} is not staged as ${mode}`)
      }
      if (!/\t\.epikloop\/project\.json$/m.test(staged)) problems.push('the marker is not staged')
      const set = k.git(dir, 'config', '--local', '--get', 'core.hooksPath').stdout.trim()
      if (set !== '.githooks') problems.push(`left core.hooksPath ${JSON.stringify(set)}`)
      return problems
    },
  ],
  [
    'hooks another tool owns',
    (k) => {
      const dir = k.repo()
      k.write(dir, '.git/hooks/pre-commit', '#!/bin/sh\n# husky\n')
      const problems = k.says(k.init(dir), 'git hooks: not armed')
      if (k.git(dir, 'config', '--local', '--get', 'core.hooksPath').stdout.trim() !== '') problems.push('set core.hooksPath')
      return problems
    },
  ],
  [
    'team mode lays down the required check',
    (k) => {
      const dir = k.repo()
      const run = k.init(dir, ['--lane', 'web', '--mode', 'team'])
      const problems = k.says(run, `.githooks/ and scripts/check.sh written · CLAUDE.md and ${WORKFLOW} written · staged · git hooks: armed (.githooks) · ${PROTECTION}`)
      if (!k.same(dir, WORKFLOW, 'github/workflows/check.yml')) problems.push('the workflow is not its template')
      if (!k.staged(k.git(dir, 'ls-files', '-s').stdout, WORKFLOW, '100644')) problems.push('the workflow is not staged as 100644')
      return problems
    },
  ],
  [
    "a repository's own CLAUDE.md and workflow",
    (k) => {
      const dir = k.repo()
      k.write(dir, 'CLAUDE.md', 'Our rules.\n')
      k.write(dir, WORKFLOW, 'name: ours\n')
      const run = k.init(dir, ['--lane', 'web', '--mode', 'team'])
      const problems = k.says(run, '.githooks/ and scripts/check.sh written · staged · git hooks: armed (.githooks)')
      if (run.stdout.includes('protection')) problems.push('asked for branch protection, though it laid no workflow down')
      if (k.read(dir, 'CLAUDE.md') !== 'Our rules.\n') problems.push('overwrote CLAUDE.md')
      if (k.read(dir, WORKFLOW) !== 'name: ours\n') problems.push('overwrote the workflow')
      if (/\t(?:CLAUDE\.md|\.github\/.*)$/m.test(k.git(dir, 'ls-files', '-s').stdout)) problems.push('staged a file it kept')
      return problems
    },
  ],
  [
    'refresh copies in what is missing or stale, stages it, and leaves the marker',
    (k) => {
      const dir = k.repo()
      k.init(dir)
      const marker = k.read(dir, '.epikloop/project.json')
      k.write(dir, '.githooks/check.mjs', 'old\n')
      fs.rmSync(path.join(dir, '.githooks', 'pre-push'))
      k.git(dir, 'rm', '-q', '--cached', '--', '.githooks/pre-push')
      const problems = k.says(k.init(dir, ['--refresh']), 'init: refreshed .githooks/check.mjs, .githooks/pre-push · staged')
      for (const [file, template] of GATE_FILES) {
        if (!fs.readFileSync(path.join(dir, file)).equals(fs.readFileSync(path.join(TEMPLATES, template)))) problems.push(`${file} is not its template`)
      }
      const staged = k.git(dir, 'ls-files', '-s').stdout
      if (!/^100644 \S+ 0\t\.githooks\/check\.mjs$/m.test(staged)) problems.push('the runner is not staged as 100644')
      if (!/^100755 \S+ 0\t\.githooks\/pre-push$/m.test(staged)) problems.push('pre-push is not staged as 100755')
      if (k.git(dir, 'diff', '--quiet').status !== 0) problems.push('left the refreshed files unstaged')
      if (k.read(dir, '.epikloop/project.json') !== marker) problems.push('changed the marker')
      return problems
    },
  ],
  [
    'refresh leaves a copy that differs only in its line endings',
    (k) => {
      const dir = k.repo()
      k.init(dir)
      const crlf = k.read(dir, '.githooks/check.mjs').replace(/\n/g, '\r\n')
      k.write(dir, '.githooks/check.mjs', crlf)
      const problems = k.says(k.init(dir, ['--refresh']), "init: the gate files already match the plugin's")
      if (k.read(dir, '.githooks/check.mjs') !== crlf) problems.push('rewrote the CRLF copy')
      return problems
    },
  ],
  [
    "refresh lays down a team project's missing workflow, and leaves one that differs",
    (k) => {
      const dir = k.repo()
      k.init(dir, ['--lane', 'web', '--mode', 'team'])
      fs.rmSync(path.join(dir, '.github'), { recursive: true })
      k.git(dir, 'rm', '-q', '--cached', '--', WORKFLOW)
      // A marker saved with a byte-order mark still reads as team mode, as the state reader reads it.
      k.write(dir, '.epikloop/project.json', `﻿${k.read(dir, '.epikloop/project.json')}`)
      const problems = k.says(k.init(dir, ['--refresh']), `init: ${WORKFLOW} written · staged · ${PROTECTION}`)
      if (!k.same(dir, WORKFLOW, 'github/workflows/check.yml')) problems.push('the workflow is not its template')
      if (!k.staged(k.git(dir, 'ls-files', '-s').stdout, WORKFLOW, '100644')) problems.push('the workflow is not staged as 100644')
      k.write(dir, WORKFLOW, 'name: ours\n')
      problems.push(...k.says(k.init(dir, ['--refresh']), "init: the gate files already match the plugin's"))
      if (k.read(dir, WORKFLOW) !== 'name: ours\n') problems.push('replaced a workflow that differs')
      return problems
    },
  ],
  [
    'refresh lays down no workflow in solo mode, and never CLAUDE.md',
    (k) => {
      const dir = k.repo()
      k.init(dir)
      fs.rmSync(path.join(dir, 'CLAUDE.md'))
      const problems = k.says(k.init(dir, ['--refresh']), "init: the gate files already match the plugin's")
      if (fs.existsSync(path.join(dir, '.github'))) problems.push('laid down a workflow in solo mode')
      if (fs.existsSync(path.join(dir, 'CLAUDE.md'))) problems.push('recreated CLAUDE.md')
      return problems
    },
  ],
  [
    "the required check's settled parts",
    () => {
      const lines = fs.readFileSync(path.join(TEMPLATES, 'github', 'workflows', 'check.yml'), 'utf8').split(/\r?\n/)
      const problems = SETTLED.filter((line) => !lines.includes(line)).map((line) => `lacks ${JSON.stringify(line.trim())}`)
      if (!lines.join('\n').includes(GATES_STEP.join('\n'))) problems.push('lacks the gates step as pinned')
      if (lines.some((line) => line.includes('pull_request_target'))) problems.push('runs on pull_request_target')
      return problems
    },
  ],
  [
    'the required check reads every commit a pull request adds',
    (k) => {
      const dir = k.repo()
      const problems = k.says(k.init(dir, ['--lane', 'web', '--mode', 'team']), PROTECTION)
      k.commit(dir, 'set up')
      const base = k.head(dir)
      k.git(dir, 'switch', '-q', '-c', 'leak')
      k.write(dir, 'config.txt', `url = ${'postgres'}://app:Tr0ub4dor@db.example.com/app\n`)
      k.commit(dir, 'add the database', ['-n'])
      const leaked = k.head(dir)
      fs.rmSync(path.join(dir, 'config.txt'))
      k.commit(dir, 'drop the database')
      const leak = k.gates(dir, k.head(dir), base)
      if (leak.status !== 1 || !leak.stdout.includes(`secrets: ${leaked.slice(0, 7)} config.txt:1 database URL with a password`)) {
        problems.push(`missed the leak (exit ${leak.status}): ${leak.stdout.trim().split('\n').slice(-2).join(' | ')}`)
      }
      k.git(dir, 'switch', '-q', '-c', 'clean', base)
      k.write(dir, 'notes.txt', 'Nothing to hide.\n')
      k.commit(dir, 'add notes')
      const clean = k.gates(dir, k.head(dir), base)
      if (clean.status !== 0 || !/^check --push: PASS/m.test(clean.stdout)) problems.push(`failed a clean pull request (exit ${clean.status}): ${clean.stdout.trim().split('\n').slice(-2).join(' | ')}`)
      return problems
    },
  ],
  [
    'refresh outside a project',
    (k) => {
      const dir = k.repo()
      return k.fails(k.init(dir, ['--refresh']), 'init: not an Epikloop project, so there are no gate files to refresh', dir)
    },
  ],
  [
    'outside a repository',
    (k) => {
      const dir = k.folder()
      return k.fails(k.init(dir), 'init: not a git repository; run git init first', dir)
    },
  ],
  [
    'a lane the schema refuses',
    (k) => {
      const dir = k.repo()
      return k.fails(k.init(dir, ['--lane', 'Web', '--mode', 'solo']), USAGE, dir)
    },
  ],
  [
    'a lane the plugin lacks',
    (k) => {
      const dir = k.repo()
      return k.fails(k.init(dir, ['--lane', 'desktop', '--mode', 'solo']), 'init: lane "desktop" is not one of service, web', dir)
    },
  ],
  [
    'a missing mode',
    (k) => {
      const dir = k.repo()
      return k.fails(k.init(dir, ['--lane', 'web']), USAGE, dir)
    },
  ],
  [
    'the first commit through the gates',
    (k) => {
      const dir = k.repo()
      const problems = k.says(k.init(dir), 'git hooks: armed (.githooks)')
      const commit = k.git(dir, '-c', 'user.name=Self Test', '-c', 'user.email=self-test@example.com', 'commit', '-q', '-m', 'init')
      if (commit.status !== 0) problems.push(`the commit failed: ${`${commit.stdout}${commit.stderr}`.trim().split('\n').slice(-3).join(' | ')}`)
      return problems
    },
  ],
]

async function selfTest() {
  const os = await import('node:os')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-init-'))
  const home = path.join(temp, 'home')
  fs.mkdirSync(home)
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[maintenance]\n\tauto = false\n')
  // git and init run without the machine's git settings or CI, which would skip arming.
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:GIT_.*|CI|HOME|USERPROFILE)$/i.test(key)) env[key] = value
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CEILING_DIRECTORIES: temp,
    GIT_TERMINAL_PROMPT: '0',
    HOME: home,
    USERPROFILE: home,
  })
  let made = 0
  const k = {
    folder() {
      made += 1
      const dir = path.join(temp, `case-${made}`)
      fs.mkdirSync(dir)
      return dir
    },
    repo() {
      const dir = k.folder()
      gitOk(dir, ['init', '-q'], env)
      return dir
    },
    git: (dir, ...args) => git(dir, args, env),
    write(dir, file, content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), content)
    },
    read: (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8'),
    same(dir, file, template) {
      const target = path.join(dir, ...file.split('/'))
      return fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(path.join(TEMPLATES, ...template.split('/'))))
    },
    staged: (listing, file, mode) => new RegExp(`^${mode} \\S+ 0\\t${file.replace(/\./g, '\\.')}$`, 'm').test(listing),
    head: (dir) => gitOk(dir, ['rev-parse', 'HEAD'], env).trim(),
    // Commits everything, through the hooks unless `flags` skips them.
    commit(dir, message, flags = []) {
      gitOk(dir, ['add', '-A'], env)
      const run = git(dir, ['-c', 'user.name=Self Test', '-c', 'user.email=self-test@example.com', 'commit', '-q', ...flags, '-m', message], env)
      if (run.status !== 0) throw new Error(`the commit "${message}" failed: ${`${run.stdout}${run.stderr}`.trim().split('\n').slice(-3).join(' | ')}`)
    },
    // The workflow's gates step as pinned: its echo's line on stdin, its arguments to the runner
    // that scripts/check.sh hands them to, and CI set, as GitHub sets it.
    gates(dir, head, base) {
      const [, line, args] = /^ +run: echo "(.*)" \| scripts\/check\.sh (.*)$/.exec(GATES_STEP.at(-1))
      const input = `${line.replace('$HEAD_SHA', head).replace('$BASE_SHA', base)}\n`
      const runner = path.join(dir, '.githooks', 'check.mjs')
      return spawnSync(process.execPath, [runner, ...args.split(' ')], { cwd: dir, env: { ...env, CI: 'true' }, input, encoding: 'utf8', windowsHide: true })
    },
    init: (dir, args = ['--lane', 'web', '--mode', 'solo']) =>
      spawnSync(process.execPath, [import.meta.filename, ...args], { cwd: dir, env, encoding: 'utf8', windowsHide: true }),
    says(run, text) {
      const out = run.stdout.trim()
      if (run.status !== 0) return [`exit ${run.status}: ${out}`]
      return out.includes(text) ? [] : [`lacks ${JSON.stringify(text)} in ${JSON.stringify(out)}`]
    },
    fails(run, line, dir) {
      const problems = []
      if (run.status !== 1) problems.push(`exit ${run.status}, not 1`)
      if (run.stdout.trim() !== line) problems.push(`said ${JSON.stringify(run.stdout.trim())}`)
      if (fs.existsSync(path.join(dir, '.epikloop'))) problems.push('wrote a marker')
      return problems
    },
    // The marker's id must hash the normalized remote, or the repository path when it is null.
    marks(dir, run, normalized) {
      const top = gitOk(dir, ['rev-parse', '--show-toplevel'], env).trim()
      const id = sha(normalized ?? top)
      const problems = k.says(run, `written (id ${id} from ${normalized ?? 'the repository path'}; web, solo)`)
      const expected = `${JSON.stringify({ format: 1, id, lane: 'web', mode: 'solo' }, null, 2)}\n`
      if (fs.existsSync(path.join(dir, '.epikloop', 'project.json')) && k.read(dir, '.epikloop/project.json') !== expected) {
        problems.push(`wrote ${JSON.stringify(k.read(dir, '.epikloop/project.json'))}`)
      }
      return problems
    },
  }
  const failures = []
  try {
    for (const [name, check] of CASES) {
      let problems
      try {
        problems = check(k)
      } catch (error) {
        problems = [`threw ${error.message}`]
      }
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`init self-test: ${CASES.length - failures.length}/${CASES.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  process.exitCode = 1
  try {
    if (process.argv[2] === '--self-test') await selfTest()
    else if (process.argv[2] === '--refresh') refresh(process.argv.slice(3))
    else init(process.argv.slice(2))
  } catch (error) {
    console.log(`init: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
