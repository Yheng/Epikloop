// Epikloop's machine check. `node doctor.mjs` reports whether this machine can run Epikloop, one
// line per check, each ending "ok" or with its fix: Node, git and Claude Code against their floors,
// the account's prompt cache and, inside a project, its files, its git hooks, its gate files against
// the plugin's templates, team mode's workflow, and whether this session's events are being written.
// It also folds the emitter's files from past days into their .jsonl files. It fixes nothing; the
// human runs the fixes.
//
// `node doctor.mjs --self-test` runs every case below in throwaway repositories and homes.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Written without import.meta.dirname, so that an older Node still gets as far as saying so.
const FILE = fileURLToPath(import.meta.url)
const HERE = path.dirname(FILE)
const DAY = 86_400_000
// Node 22 for the scripts; git 2.23 for `git switch`, which the guard allows and team mode lands
// with; Claude Code 2.1.295 for hooks that fail closed.
const FLOORS = { node: '22.0.0', git: '2.23.0', claude: '2.1.295' }
// How `claude auth status` names a subscription, and the accounts whose cache lasts five minutes.
const SUBSCRIPTION = ['claude.ai', 'oauth_token']
const API = ['api_key', 'api_key_helper', 'third_party']
const SETTING = 'set "promptCacheTtl": "1h" in ~/.claude/settings.json'

const versionOf = (text) => /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '')?.slice(1, 4).map(Number) ?? null
const below = (version, floor) => {
  const want = versionOf(floor)
  for (let i = 0; i < 3; i += 1) if (version[i] !== want[i]) return version[i] < want[i]
  return false
}
const floorShown = (floor) => floor.replace(/\.0$/, '').replace(/^(\d+)\.0$/, '$1')

function entries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

// Runs a program for its output: { status, stdout }, with status null when it couldn't start.
export function exec(program, args, cwd) {
  const options = { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true }
  let run = spawnSync(program, args, options)
  // npm installs programs on Windows as .cmd shims, such as claude's and npx, which only a shell
  // runs. The program and its arguments are always doctor's own.
  if (run.error?.code === 'ENOENT' && process.platform === 'win32') {
    run = spawnSync(`${program} ${args.join(' ')}`, { ...options, shell: true })
  }
  return run.error ? { status: null, stdout: '' } : { status: run.status, stdout: run.stdout ?? '' }
}

// Whether the main conversation's cache is set to an hour: by either environment variable, or in
// the user's or the project's settings.
function hourCache(env, home, root) {
  if (env.CLAUDE_CODE_PROMPT_CACHE_TTL === '1h' || /^(?:1|true|yes)$/i.test(env.ENABLE_PROMPT_CACHING_1H ?? '')) return true
  const files = [path.join(home, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')]
  return files.some((file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).promptCacheTtl === '1h'
    } catch {
      return false
    }
  })
}

// Whether the emitter has written an event for session `id` today or yesterday, by UTC date as it
// names its folders: as a file named for the session, or as a folded line. The gate runner writes
// events under the session's id too, but names its files for its own run, and its lines don't count.
function sessionWrites(home, id, now) {
  const dir = path.join(home, '.epikloop', 'events')
  for (const day of [now, now - DAY].map((ms) => new Date(ms).toISOString().slice(0, 10))) {
    if (entries(path.join(dir, day)).some((entry) => entry.name.includes(`-${id.slice(0, 8)}-`))) return true
    try {
      const lines = fs.readFileSync(path.join(dir, `${day}.jsonl`), 'utf8').split('\n')
      if (lines.some((line) => line.includes(`"session_id":"${id}"`) && !line.includes('"kind":"gate.'))) return true
    } catch {}
  }
  return false
}

// Folds the emitter's files: each past day's events, and every project's cost rows. Today's events
// stay, since the emitter is still writing them.
function foldAll(fold, home, now) {
  const root = path.join(home, '.epikloop')
  const today = new Date(now).toISOString().slice(0, 10)
  let [events, rows] = [0, 0]
  for (const entry of entries(path.join(root, 'events'))) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name) || entry.name >= today) continue
    const folder = path.join(root, 'events', entry.name)
    events += fold(folder, `${folder}.jsonl`).folded
    try {
      fs.rmdirSync(folder)
    } catch {}
  }
  for (const entry of entries(path.join(root, 'projects'))) {
    const folder = path.join(root, 'projects', entry.name, 'cost')
    if (entry.isDirectory() && fs.existsSync(folder)) rows += fold(folder, path.join(root, 'projects', entry.name, 'cost.jsonl')).folded
  }
  return { events, rows }
}

// The report, as lines: a summary, then one line per check.
export async function report({ cwd, env, home, node, exec, now }) {
  const lines = []
  let fixes = 0
  const ok = (what) => lines.push(`- ${what}: ok.`)
  const fix = (what, how) => {
    fixes += 1
    lines.push(`- ${what}. Fix: ${how}.`)
  }
  const note = (what) => lines.push(`- ${what}.`)
  const done = () => [`doctor: ${fixes === 0 ? 'nothing' : fixes === 1 ? '1 thing' : `${fixes} things`} to fix.`, ...lines]

  const nodeVersion = versionOf(node)
  if (below(nodeVersion, FLOORS.node)) {
    fix(`Node ${node} is older than ${floorShown(FLOORS.node)}`, `install Node ${floorShown(FLOORS.node)} or later, which the other checks need`)
    return done()
  }
  ok(`Node ${node}`)

  const git = exec('git', ['--version'], cwd)
  const gitVersion = git.status === 0 ? versionOf(git.stdout) : null
  if (gitVersion === null) fix("git isn't on PATH", `install git ${floorShown(FLOORS.git)} or later`)
  else if (below(gitVersion, FLOORS.git)) fix(`git ${gitVersion.join('.')} is older than ${floorShown(FLOORS.git)}`, `install git ${floorShown(FLOORS.git)} or later`)
  else ok(`git ${gitVersion.join('.')}`)

  const claude = exec('claude', ['--version'], cwd)
  const claudeVersion = claude.status === 0 ? versionOf(claude.stdout) : null
  if (claudeVersion === null) note("Claude Code: claude --version couldn't be read, so its version isn't checked")
  else if (below(claudeVersion, FLOORS.claude)) fix(`Claude Code ${claudeVersion.join('.')} is older than ${FLOORS.claude}`, 'update it with claude update')
  else ok(`Claude Code ${claudeVersion.join('.')}`)

  const { openProject, readState, laneNames, readLane } = await import('./state.mjs')
  const opened = openProject(cwd)
  const auth = exec('claude', ['auth', 'status'], cwd)
  const method = /"authMethod"\s*:\s*"([^"]+)"/.exec(auth.stdout)?.[1] ?? null
  if (SUBSCRIPTION.includes(method)) ok("Prompt cache: a subscription, which keeps an hour's cache")
  else if (API.includes(method) && hourCache(env, home, opened?.root ?? cwd)) ok('Prompt cache: an API key, with the cache set to an hour')
  else if (API.includes(method)) fix("Prompt cache: an API key keeps the conversation's cache for 5 minutes", SETTING)
  else note(`Prompt cache: claude auth status doesn't say which account this is; with an API key, ${SETTING}`)

  // The lanes this machine can build: those whose programs are all on PATH. One the project's lane
  // needs is a fix.
  const found = new Map()
  const onPath = (program) => {
    if (!found.has(program)) found.set(program, exec(program, ['--version'], cwd).status === 0)
    return found.get(program)
  }
  const lanes = laneNames().map((name) => ({ name, missing: (readLane(name)?.requires ?? []).filter((program) => !onPath(program)) }))
  const buildable = lanes.filter((lane) => lane.missing.length === 0).map((lane) => lane.name)
  const blocked = lanes.filter((lane) => lane.missing.length > 0)
  if (blocked.length === 0) ok(`Lanes this machine can build: ${buildable.join(', ')}`)
  else {
    const can = `Lanes this machine can build: ${buildable.length > 0 ? buildable.join(', ') : 'none'}`
    const needs = blocked.map((lane) => `${lane.name} needs ${lane.missing.join(' and ')} on PATH`).join('; ')
    const own = blocked.find((lane) => lane.name === opened?.project?.lane)
    if (own === undefined) note(`${can}; ${needs}`)
    else fix(`${can}; ${needs}`, `install ${own.missing.join(' and ')}, which this project's lane needs`)
  }

  if (opened === null) note("Project: this isn't an Epikloop project, so the project's checks are skipped")
  else if (opened.problem !== null) fix(`Project: .epikloop/project.json ${opened.problem}`, 'correct it')
  else {
    const { problems } = readState(opened.root, opened.project, { now, home })
    if (problems.length === 0) ok('Project files: every line reads')
    else fix(`Project files: ${problems.length === 1 ? "1 line the state reader can't place" : `${problems.length} lines the state reader can't place`}`, '/epikloop lists them')
  }
  if (opened !== null) {
    const hooks = exec('git', ['config', '--get', 'core.hooksPath'], opened.root).stdout.trim()
    if (hooks === '.githooks') ok('Git hooks: armed at .githooks')
    else if (hooks === '') fix("Git hooks: they aren't armed", 'node .githooks/check.mjs --arm')
    else note(`Git hooks: core.hooksPath is ${hooks}, which another tool owns, so the gates don't run on commit or push`)

    const { staleGates } = await import('./init.mjs')
    const stale = staleGates(opened.root).map(([file]) => file)
    if (stale.length === 0) ok("Gate files: the same as the plugin's")
    else {
      const names = stale.length === 1 ? `${stale[0]} isn't` : `${stale.slice(0, -1).join(', ')} and ${stale.at(-1)} aren't`
      fix(`Gate files: ${names} the plugin's current one${stale.length === 1 ? '' : 's'}`, `node "${path.join(HERE, 'init.mjs')}" --refresh, then commit ${stale.length === 1 ? 'it' : 'them'}`)
    }
    // Team mode's required check. Its content is the project's, and whether it is required is a
    // GitHub setting, so only its presence is checked.
    if (opened.project?.mode === 'team') {
      if (fs.existsSync(path.join(opened.root, '.github', 'workflows', 'check.yml'))) ok('Team check: .github/workflows/check.yml is in place')
      else fix('Team check: .github/workflows/check.yml is missing', `node "${path.join(HERE, 'init.mjs')}" --refresh, then commit it`)
    }

    // The lane's UI test tool, by the package a product installs it as: no spawn, no network.
    const ui = readLane(opened.project?.lane)?.ui_test
    if (ui) {
      let version = null
      try {
        version = JSON.parse(fs.readFileSync(path.join(opened.root, 'node_modules', ...ui.package.split('/'), 'package.json'), 'utf8')).version
      } catch {}
      if (typeof version === 'string') ok(`UI tests: ${ui.tool} ${version} is installed`)
      else note(`UI tests: ${ui.tool} isn't installed here yet; the first story with a UI installs it`)
    }

    const session = env.CLAUDE_CODE_SESSION_ID
    if (!session) note("Events: not checked, since doctor isn't running inside Claude Code")
    else if (sessionWrites(home, session, now)) ok("Events: this session's are being written")
    else {
      const how = 'start Claude Code without --bare or --safe-mode; /plugin shows whether the epikloop mod is active, and a managed policy can turn mods off'
      fix("Events: none from this session, so the emitter isn't running", how)
    }
  }

  const { fold } = await import('./fold.mjs')
  const folded = foldAll(fold, home, now)
  if (folded.events + folded.rows > 0) {
    const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`
    const what = [folded.events > 0 && count(folded.events, 'event file'), folded.rows > 0 && count(folded.rows, 'cost row')].filter(Boolean)
    note(`Folded ${what.join(' and ')} into ${folded.events + folded.rows === 1 ? 'its .jsonl file' : 'their .jsonl files'}`)
  }
  return done()
}

// ---- The self-test

const NOW = Date.UTC(2026, 10, 15, 12)
const SESSION = '8d1e5c2a-4b7f-4e0a-9c3d-2f6b8a1e7c90'

async function selfTest() {
  const { GATE_FILES, TEMPLATES } = await import('./init.mjs')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-doctor-'))
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Self Test\n\temail = self-test@example.com\n[init]\n\tdefaultBranch = main\n')
  // git runs in this process, for the state and the hooks, so the scrubbed environment applies here.
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) if (/^(?:GIT_.*|HOME|USERPROFILE|CLAUDE_CODE_.*|ENABLE_PROMPT_CACHING_1H)$/i.test(key)) delete process.env[key]
  Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_CEILING_DIRECTORIES: temp })
  let made = 0
  const k = {
    dir(name) {
      made += 1
      const dir = path.join(temp, `${name}-${made}`)
      fs.mkdirSync(dir)
      return dir
    },
    write(dir, file, content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), content)
    },
    git(dir, ...args) {
      const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true })
      if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.trim()}`)
    },
    // An Epikloop project with the plugin's gate files, armed unless told otherwise, whose one
    // requirement reads cleanly.
    project({ armed = true, marker = {} } = {}) {
      const dir = k.dir('project')
      k.git(dir, 'init', '-q')
      k.write(dir, '.epikloop/project.json', JSON.stringify({ format: 1, id: '000000000000', lane: 'web', mode: 'solo', ...marker }))
      k.write(dir, 'spec/app.md', '# App\n\nWhat it is.\n\n## REQ-APP-001 It works\n\nIt works.\n')
      for (const [file, template] of GATE_FILES) k.write(dir, file, fs.readFileSync(path.join(TEMPLATES, ...template.split('/'))))
      if (armed) k.git(dir, 'config', 'core.hooksPath', '.githooks')
      return dir
    },
    // A home whose events folders hold `events`: { 'YYYY-MM-DD': [file names] }.
    home(events = {}) {
      const home = k.dir('home')
      for (const [day, names] of Object.entries(events)) for (const name of names) k.write(home, `.epikloop/events/${day}/${name}`, '{"format":1}\n')
      return home
    },
    // The report, with a fake claude, git version and npx: `claude` is { version, auth }, either one
    // null for a claude that can't say; `git` is the version git reports, or null for no git; `npx`
    // is npx's version, or null for no npx.
    async run({ cwd = k.dir('plain'), home = k.home(), env = { CLAUDE_CODE_SESSION_ID: SESSION }, node = '22.12.0', claude = {}, git = '2.45.1', npx = '10.9.2' } = {}) {
      const { version = '2.1.314', auth = 'claude.ai' } = claude
      const fake = (program, args, at) => {
        if (program === 'claude' && args[0] === '--version') return version === null ? { status: null, stdout: '' } : { status: 0, stdout: `${version} (Claude Code)\n` }
        if (program === 'claude') return auth === null ? { status: 1, stdout: '' } : { status: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: auth }, null, 2) }
        if (program === 'git' && args[0] === '--version') return git === null ? { status: null, stdout: '' } : { status: 0, stdout: `git version ${git}\n` }
        if (program === 'npx') return npx === null ? { status: null, stdout: '' } : { status: 0, stdout: `${npx}\n` }
        return exec(program, args, at)
      }
      return `${(await report({ cwd, env, home, node, exec: fake, now: NOW })).join('\n')}\n`
    },
    expect: (pairs) => pairs.filter(([actual, wanted]) => actual !== wanted).map(([actual, wanted]) => `got ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`),
    has: (actual, ...parts) => parts.filter((part) => !actual.includes(part)).map((part) => `no ${JSON.stringify(part)} in ${JSON.stringify(actual)}`),
  }
  const today = new Date(NOW).toISOString().slice(0, 10)
  const yesterday = new Date(NOW - DAY).toISOString().slice(0, 10)
  const mine = `${NOW}-${SESSION.slice(0, 8)}-1.json`
  const refresh = `node "${path.join(HERE, 'init.mjs')}" --refresh`
  const cases = [
    [
      'all is well inside a project',
      async () => {
        const out = await k.run({ cwd: path.join(k.project(), 'spec'), home: k.home({ [today]: [mine] }) })
        const wanted = [
          'doctor: nothing to fix.',
          '- Node 22.12.0: ok.',
          '- git 2.45.1: ok.',
          '- Claude Code 2.1.314: ok.',
          "- Prompt cache: a subscription, which keeps an hour's cache: ok.",
          '- Lanes this machine can build: service, web: ok.',
          '- Project files: every line reads: ok.',
          '- Git hooks: armed at .githooks: ok.',
          "- Gate files: the same as the plugin's: ok.",
          "- UI tests: Playwright isn't installed here yet; the first story with a UI installs it.",
          "- Events: this session's are being written: ok.",
          '',
        ]
        return k.expect([[out, wanted.join('\n')]])
      },
    ],
    [
      'a Node older than 22 stops the other checks',
      async () => k.expect([[await k.run({ node: '20.11.1' }), 'doctor: 1 thing to fix.\n- Node 20.11.1 is older than 22. Fix: install Node 22 or later, which the other checks need.\n']]),
    ],
    [
      'git and Claude Code against their floors',
      async () => [
        ...k.has(await k.run({ git: '2.20.1', claude: { version: '2.1.290' } }), 'doctor: 2 things to fix.\n', '- git 2.20.1 is older than 2.23. Fix: install git 2.23 or later.\n', '- Claude Code 2.1.290 is older than 2.1.295. Fix: update it with claude update.\n'),
        ...k.has(await k.run({ git: null, claude: { version: null } }), "- git isn't on PATH. Fix: install git 2.23 or later.\n", "- Claude Code: claude --version couldn't be read, so its version isn't checked.\n"),
      ],
    ],
    [
      'an API key needs the hour set, in either variable or any settings file',
      async () => {
        const api = { auth: 'api_key' }
        const user = k.home()
        k.write(user, '.claude/settings.json', JSON.stringify({ promptCacheTtl: '1h' }))
        const local = k.project()
        k.write(local, '.claude/settings.local.json', JSON.stringify({ promptCacheTtl: '1h' }))
        const set = '- Prompt cache: an API key, with the cache set to an hour: ok.\n'
        return [
          ...k.has(await k.run({ claude: api }), `- Prompt cache: an API key keeps the conversation's cache for 5 minutes. Fix: ${SETTING}.\n`),
          ...k.has(await k.run({ claude: api, home: user }), set),
          ...k.has(await k.run({ claude: api, env: { ENABLE_PROMPT_CACHING_1H: '1' } }), set),
          ...k.has(await k.run({ claude: api, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } }), set),
          ...k.has(await k.run({ claude: { auth: 'api_key_helper' }, cwd: local }), set),
          ...k.has(await k.run({ claude: { auth: null } }), `- Prompt cache: claude auth status doesn't say which account this is; with an API key, ${SETTING}.\n`),
        ]
      },
    ],
    [
      'the lanes this machine can build, and the UI test tool',
      async () => {
        const installed = k.project()
        k.write(installed, 'node_modules/@playwright/test/package.json', JSON.stringify({ name: '@playwright/test', version: '1.49.1' }))
        const service = k.project({ marker: { lane: 'service' } })
        const serviceOut = await k.run({ cwd: service, npx: null })
        return [
          ...k.has(await k.run({ cwd: k.project(), npx: null }), "- Lanes this machine can build: service; web needs npx on PATH. Fix: install npx, which this project's lane needs.\n"),
          ...k.has(serviceOut, '- Lanes this machine can build: service; web needs npx on PATH.\n'),
          ...(serviceOut.includes('UI tests') ? ['spoke of UI tests in a service project'] : []),
          ...k.has(await k.run({ cwd: installed }), '- UI tests: Playwright 1.49.1 is installed: ok.\n'),
        ]
      },
    ],
    [
      "unarmed hooks, and another tool's",
      async () => {
        const owned = k.project({ armed: false })
        k.git(owned, 'config', 'core.hooksPath', '.husky')
        return [
          ...k.has(await k.run({ cwd: k.project({ armed: false }) }), "- Git hooks: they aren't armed. Fix: node .githooks/check.mjs --arm.\n"),
          ...k.has(await k.run({ cwd: owned }), "- Git hooks: core.hooksPath is .husky, which another tool owns, so the gates don't run on commit or push.\n"),
        ]
      },
    ],
    [
      "gate files that aren't the plugin's, though not for line endings",
      async () => {
        const stale = k.project()
        k.write(stale, '.githooks/check.mjs', 'old\n')
        fs.rmSync(path.join(stale, '.githooks', 'pre-push'))
        const crlf = k.project()
        k.write(crlf, '.githooks/check.mjs', fs.readFileSync(path.join(TEMPLATES, 'githooks', 'check.mjs'), 'utf8').replace(/\n/g, '\r\n'))
        return [
          ...k.has(await k.run({ cwd: stale }), `- Gate files: .githooks/check.mjs and .githooks/pre-push aren't the plugin's current ones. Fix: ${refresh}, then commit them.\n`),
          ...k.has(await k.run({ cwd: crlf }), "- Gate files: the same as the plugin's: ok.\n"),
        ]
      },
    ],
    [
      "a team project's required check, there or missing",
      async () => {
        const team = k.project({ marker: { mode: 'team' } })
        k.write(team, '.github/workflows/check.yml', 'name: check\n')
        const events = { [today]: [mine] }
        const there = await k.run({ cwd: team, home: k.home(events) })
        return [
          ...k.has(there, 'doctor: nothing to fix.\n', "- Gate files: the same as the plugin's: ok.\n- Team check: .github/workflows/check.yml is in place: ok.\n"),
          ...k.has(await k.run({ cwd: k.project({ marker: { mode: 'team' } }), home: k.home(events) }), 'doctor: 1 thing to fix.\n', `- Team check: .github/workflows/check.yml is missing. Fix: ${refresh}, then commit it.\n`),
        ]
      },
    ],
    [
      "this session's events: written, folded, missing, or not asked",
      async () => {
        const folded = k.home()
        k.write(folded, `.epikloop/events/${yesterday}.jsonl`, `${JSON.stringify({ format: 1, session_id: SESSION, kind: 'session.start' })}\n`)
        const other = k.home({ [today]: [`${NOW}-00000000-1.json`] })
        const gates = k.home()
        k.write(gates, `.epikloop/events/${yesterday}.jsonl`, `${JSON.stringify({ format: 1, session_id: SESSION, kind: 'gate.passed' })}\n`)
        const none = "- Events: none from this session, so the emitter isn't running. Fix: start Claude Code without --bare or --safe-mode; /plugin shows whether the epikloop mod is active, and a managed policy can turn mods off.\n"
        return [
          ...k.has(await k.run({ cwd: k.project(), home: folded }), "- Events: this session's are being written: ok.\n"),
          ...k.has(await k.run({ cwd: k.project(), home: other }), none),
          ...k.has(await k.run({ cwd: k.project(), home: gates }), none),
          ...k.has(await k.run({ cwd: k.project(), env: {} }), "- Events: not checked, since doctor isn't running inside Claude Code.\n"),
        ]
      },
    ],
    [
      "past days and cost rows are folded, and today's events stay",
      async () => {
        const home = k.home({ [today]: [mine], [yesterday]: [`${NOW - DAY}-${SESSION.slice(0, 8)}-1.json`, `${NOW - DAY}-${SESSION.slice(0, 8)}-2.json`] })
        k.write(home, '.epikloop/projects/000000000000/cost/1-x-1.json', '{"format":1,"tier":"T1","wall":60}\n')
        const out = await k.run({ cwd: k.project(), home })
        const events = path.join(home, '.epikloop', 'events')
        const rowOnly = k.home()
        k.write(rowOnly, '.epikloop/projects/000000000000/cost/1-x-1.json', '{"format":1,"tier":"T1","wall":60}\n')
        return [
          ...k.has(out, '- Folded 2 event files and 1 cost row into their .jsonl files.\n'),
          ...k.has(await k.run({ cwd: k.project(), home: rowOnly }), '- Folded 1 cost row into its .jsonl file.\n'),
          ...(fs.readFileSync(path.join(events, `${yesterday}.jsonl`), 'utf8').split('\n').filter(Boolean).length === 2 ? [] : ["yesterday's lines aren't folded"]),
          ...(fs.existsSync(path.join(events, yesterday)) ? ["yesterday's folder is left"] : []),
          ...(fs.existsSync(path.join(events, today, mine)) && !fs.existsSync(path.join(events, `${today}.jsonl`)) ? [] : ["today's events were folded"]),
          ...(fs.existsSync(path.join(home, '.epikloop', 'projects', '000000000000', 'cost.jsonl')) ? [] : ["the cost row isn't folded"]),
        ]
      },
    ],
    [
      'outside a project, and with project files that need fixing',
      async () => {
        const broken = k.project()
        k.write(broken, 'docs/queue.md', '# Queue\n\n## Later\n')
        const marker = k.project({ marker: { mode: 'duo' } })
        const outside = await k.run()
        return [
          ...k.has(outside, "- Project: this isn't an Epikloop project, so the project's checks are skipped.\n"),
          ...(outside.includes('Git hooks') ? ['checked the hooks outside a project'] : []),
          ...k.has(await k.run({ cwd: broken }), "- Project files: 1 line the state reader can't place. Fix: /epikloop lists them.\n"),
          ...k.has(await k.run({ cwd: marker }), '- Project: .epikloop/project.json has no valid mode. Fix: correct it.\n'),
        ]
      },
    ],
  ]
  const failures = []
  try {
    for (const [name, check] of cases) {
      let problems
      try {
        problems = await check()
      } catch (error) {
        problems = [`threw ${error.message}`]
      }
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    }
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`doctor self-test: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(FILE)) {
  process.exitCode = 1
  try {
    if (process.argv[2] === '--self-test' && process.argv.length === 3) await selfTest()
    else if (process.argv.length > 2) console.log('usage: node doctor.mjs')
    else {
      const lines = await report({ cwd: process.cwd(), env: process.env, home: os.homedir(), node: process.versions.node, exec, now: Date.now() })
      console.log(lines.join('\n'))
      process.exitCode = 0
    }
  } catch (error) {
    console.log(`doctor: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
