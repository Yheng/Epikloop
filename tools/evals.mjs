// The eval suite's runner. `node tools/evals.mjs [case …]` runs the cases in plugins/epikloop/evals/,
// or the named ones, each as a headless Claude Code session under this machine's own login, and
// grades each with its own graders. It prints each case as it finishes, then one summary line, and
// exits 0 when every case passes, 1 when one fails, and 2 when the cost cap stopped the run.
//
// It reads the case files `claude plugin eval` reads and grades them the same way: every grader in
// every run must pass, and there is no LLM judge. That tool's Linux sandbox makes the run's temporary
// folder and .git read-only (Claude Code 2.1.316), so a skill that loads a format through a `!`
// command aborts and nothing can commit. This runner runs the session outside an OS sandbox
// instead, in a throwaway folder, with the plugin's own guard in front of every shell command.
//
// - Each case starts in a new folder under the system's temporary folder: empty, or the fixture its
//   scaffold.sh names, built by evals/fixture.mjs.
// - The session gets Bash, Write and Edit, plus the read-only tools the case lists, and nothing
//   else.
// - The plugin's emitter writes to ~/.epikloop as in any session; the runner deletes what the
//   sessions in its folders wrote there.
// - Ctrl+C stops every session still running, so none goes on spending.
//
// Options: --jobs N runs N cases at once (default 3); --cap USD stops starting runs once their
// estimated cost reaches it (default 5); --keep leaves each case's folder and transcript.
// `node tools/evals.mjs --self-test` checks the parser, the graders and whole runs against a stand-in
// for claude, and makes no model call.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { FIXTURES, SHIM, build } from '../plugins/epikloop/evals/fixture.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLUGIN = path.join(ROOT, 'plugins', 'epikloop')
const EVALS = path.join(PLUGIN, 'evals')
const POSIX = process.platform !== 'win32'
const USAGE = 'usage: node tools/evals.mjs [--jobs N] [--cap USD] [--keep] [case …] | --self-test'
const firstLine = (error) => String(error?.message ?? error).split('\n')[0]

// ---- The subset of YAML the case files use

// A flow collection's inside, split at the commas that aren't inside quotes.
function splitFlow(inside) {
  const parts = []
  let current = ''
  let quote = null
  for (const ch of inside) {
    if (quote !== null) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function scalar(raw, at) {
  const value = raw.trim()
  if (value === '') throw new Error(`${at}: a nested block isn't read here; write the value on its line`)
  if (/^[|>]/.test(value)) throw new Error(`${at}: a block scalar isn't read here; keep the value on one line`)
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) throw new Error(`${at}: a quote isn't closed`)
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new Error(`${at}: a [ isn't closed`)
    return splitFlow(value.slice(1, -1)).map((part) => scalar(part, at))
  }
  if (value.startsWith('{')) {
    if (!value.endsWith('}')) throw new Error(`${at}: a { isn't closed`)
    const out = {}
    for (const part of splitFlow(value.slice(1, -1))) {
      const colon = part.indexOf(':')
      if (colon < 0) throw new Error(`${at}: "${part.trim()}" isn't key: value`)
      out[part.slice(0, colon).trim()] = scalar(part.slice(colon + 1), at)
    }
    return out
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true' || value === 'false') return value === 'true'
  if (value === 'null' || value === '~') return null
  return value
}

// A case.yaml as an object: top-level fields, one level of `context:` and `execution:`, and the
// `graders:` list, with quoted, flow and plain scalars. Anything else throws, naming its line.
export function parseCase(text) {
  const out = {}
  let section = null
  let grader = null
  text.split(/\r?\n/).forEach((raw, i) => {
    const at = `line ${i + 1}`
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) return
    const indent = raw.length - raw.trimStart().length
    let line = raw.trim()
    const pair = (text) => {
      const match = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(text)
      if (match === null) throw new Error(`${at}: "${raw.trim()}" isn't key: value`)
      return [match[1], match[2] ?? '']
    }
    if (indent === 0) {
      const [key, value] = pair(line)
      section = null
      grader = null
      if (value !== '') out[key] = scalar(value, at)
      else {
        section = key
        out[key] = key === 'graders' ? [] : {}
      }
      return
    }
    if (section === null) throw new Error(`${at}: indented, but under no section`)
    if (section === 'graders') {
      if (line.startsWith('- ')) {
        if (indent !== 2) throw new Error(`${at}: a grader's "- " sits two spaces in`)
        grader = {}
        out.graders.push(grader)
        line = line.slice(2).trim()
      } else if (grader === null || indent !== 4) throw new Error(`${at}: a grader's keys sit four spaces in, under its "- "`)
      const [key, value] = pair(line)
      grader[key] = scalar(value, at)
      return
    }
    if (indent !== 2) throw new Error(`${at}: only one level of nesting is read here`)
    const [key, value] = pair(line)
    out[section][key] = scalar(value, at)
  })
  return out
}

// ---- A case, loaded and checked

const KEYS = {
  top: ['schema_version', 'name', 'description', 'tags', 'runs', 'expected_outcome', 'context', 'execution', 'graders'],
  context: ['scaffold_script'],
  execution: ['prompt', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt'],
  grader: ['name', 'type', 'weight', 'arm', 'pattern', 'flags', 'match', 'target', 'tool', 'input_match', 'min', 'max', 'path', 'exists'],
}
const NEEDS = { regex: 'pattern', tool_used: 'tool', file_exists: 'path' }
// The read-only tools a case can list. The rest stay out of its session.
const READ_ONLY = ['Read', 'Glob', 'Grep', 'NotebookRead', 'Skill', 'AskUserQuestion', 'Agent', 'TodoWrite']

// The case in `dir`: { name, kase, fixture, runs, problems }. A problem means the case can't run as
// written, here or under `claude plugin eval`.
export function loadCase(dir) {
  const name = path.basename(dir)
  const problems = []
  const say = (what) => problems.push(`${name}/case.yaml: ${what}`)
  let kase
  try {
    kase = parseCase(fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8'))
  } catch (error) {
    say(firstLine(error))
    return { name, problems }
  }
  const unread = (keys, known, prefix) => {
    for (const key of Object.keys(keys ?? {})) if (!known.includes(key)) say(`${prefix}${key} isn't a field this runner reads`)
  }
  unread(kase, KEYS.top, '')
  unread(kase.context, KEYS.context, 'context.')
  unread(kase.execution, KEYS.execution, 'execution.')
  if (kase.schema_version !== '1.1') say('schema_version isn\'t "1.1"')
  if (kase.name !== name) say(`name is ${JSON.stringify(kase.name)}, not its folder's ${JSON.stringify(name)}`)
  const ex = kase.execution ?? {}
  if (typeof ex.prompt !== 'string' || ex.prompt.trim() === '') say('execution.prompt is missing')
  if (typeof ex.model !== 'string' || ex.model === '') say('execution.model is missing')
  const runs = kase.runs ?? 1
  if (!Number.isInteger(runs) || runs < 1) say('runs is not a whole number of 1 or more')
  for (const tool of ex.allowed_tools ?? []) if (!READ_ONLY.includes(tool)) say(`allowed_tools lists ${tool}, which isn't one of the read-only tools`)
  if (!Array.isArray(kase.graders) || kase.graders.length === 0) say('it has no graders')
  for (const grader of kase.graders ?? []) {
    const label = `grader ${JSON.stringify(grader.name ?? '?')}`
    for (const key of Object.keys(grader)) if (!KEYS.grader.includes(key)) say(`${label}'s ${key} isn't a field this runner reads`)
    if (!Object.hasOwn(NEEDS, grader.type)) say(`${label}'s type ${JSON.stringify(grader.type)} isn't regex, tool_used or file_exists`)
    else if (grader[NEEDS[grader.type]] === undefined) say(`${label} has no ${NEEDS[grader.type]}`)
    for (const key of ['pattern', 'input_match']) {
      if (grader[key] === undefined) continue
      try {
        new RegExp(grader[key], key === 'pattern' ? (grader.flags ?? '') : '')
      } catch (error) {
        say(`${label}'s ${key} doesn't compile: ${firstLine(error)}`)
      }
    }
  }
  let fixture = null
  const shim = path.join(dir, 'scaffold.sh')
  const scaffold = kase.context?.scaffold_script
  if (scaffold !== undefined && scaffold !== 'scaffold.sh') say('context.scaffold_script names a file other than scaffold.sh')
  if (fs.existsSync(shim) !== (scaffold === 'scaffold.sh')) say('scaffold.sh and context.scaffold_script go together')
  if (fs.existsSync(shim)) {
    fixture = SHIM.exec(fs.readFileSync(shim, 'utf8'))?.[1] ?? null
    if (fixture === null || !Object.hasOwn(FIXTURES, fixture)) say("scaffold.sh doesn't name a fixture")
  }
  return { name, kase, fixture, runs, problems }
}

// Every case in `evals`: each folder that holds a case.yaml.
export function loadSuite(evals = EVALS) {
  return fs
    .readdirSync(evals, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(evals, entry.name, 'case.yaml')))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => loadCase(path.join(evals, entry.name)))
}

// ---- Grading, as the eval docs describe it

const globRe = (glob) =>
  new RegExp(`^${glob.split(/(\*\*\/|\*\*|\*)/).map((part) => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`)

// What a grader looks at in `run`: the last message, the trace, the files created, or one file's
// contents after the run, which must lie inside the workspace.
function target(spec = 'last_message', run) {
  if (spec === 'last_message') return run.last
  if (spec === 'trace') return run.trace
  if (spec === 'files') return run.created.join('\n')
  if (spec !== null && typeof spec === 'object' && spec.source === 'file' && typeof spec.path === 'string') {
    const file = path.resolve(run.work, ...spec.path.split('/'))
    const relative = path.relative(run.work, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${spec.path} is outside the workspace`)
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  }
  throw new Error(`target ${JSON.stringify(spec)} isn't last_message, trace, files or { source: file, path }`)
}

// One grader's verdict on `run`: { ok, why }.
export function grade(grader, run) {
  if (grader.type === 'regex') {
    const where = typeof grader.target === 'object' ? `file ${grader.target.path}` : (grader.target ?? 'last_message')
    const pattern = new RegExp(grader.pattern, [...new Set(`${grader.flags ?? ''}g`)].join(''))
    const found = [...target(grader.target, run).matchAll(pattern)].length
    if (grader.match === 'not_contains') return { ok: found === 0, why: `${found} matches in ${where}, expected none` }
    const count = /^count:(\d+)$/.exec(grader.match ?? '')
    if (count !== null) return { ok: found === Number(count[1]), why: `${found} matches in ${where}, expected ${count[1]}` }
    return { ok: found > 0, why: found > 0 ? `matched in ${where}` : `pattern not found in ${where}` }
  }
  if (grader.type === 'tool_used') {
    const input = grader.input_match === undefined ? null : new RegExp(grader.input_match)
    const calls = run.tools.filter((tool) => tool.name === grader.tool && (input === null || input.test(JSON.stringify(tool.input ?? {})))).length
    const min = grader.min ?? 1
    const max = grader.max ?? Infinity
    return { ok: calls >= min && calls <= max, why: `${grader.tool} called ${calls}x (expected ${min}..${max === Infinity ? '∞' : max})` }
  }
  if (grader.type === 'file_exists') {
    const glob = globRe(grader.path)
    const hits = run.created.filter((file) => glob.test(file))
    const wanted = grader.exists ?? true
    return { ok: wanted ? hits.length > 0 : hits.length === 0, why: `${hits.length} created files match ${grader.path}${wanted ? '' : ', expected none'}` }
  }
  throw new Error(`type ${JSON.stringify(grader.type)} isn't graded here`)
}

// ---- A session

// The workspace's files, relative and with forward slashes, outside .git.
function listFiles(dir, base = dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

// claude's arguments for one session of `kase`: the plugin from this checkout, no user settings,
// MCP servers or other plugins, and the tools the case is granted.
export function claudeArgs(kase) {
  const ex = kase.execution
  const listed = ex.allowed_tools ?? []
  return [
    '-p',
    '--model', ex.model,
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--plugin-dir', PLUGIN,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(ex.max_turns ?? 10),
    ...(ex.append_system_prompt ? ['--append-system-prompt', ex.append_system_prompt] : []),
    '--allowedTools', 'Bash', 'Write', 'Edit', ...listed,
    '--disallowedTools', 'PowerShell', 'WebFetch', 'WebSearch', ...READ_ONLY.filter((tool) => !listed.includes(tool)),
  ]
}

function stop(child) {
  if (!child?.pid) return
  if (!POSIX) {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

const quoted = (arg) => `"${String(arg).replace(/"/g, '\\"')}"`
// The sessions still running, which an interrupt stops.
const live = new Set()

// Runs `command` with `args` in `cwd`, `input` on stdin, stopped at `ms`: { out, err, code, timedOut,
// error }. npm installs claude on Windows as a .cmd shim, which only a shell runs.
function session(command, args, { cwd, input, env, ms }, shell = false) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let timedOut = false
    let settled = false
    let timer
    let child
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      live.delete(child)
      resolve({ out, err, timedOut, ...result })
    }
    const [file, ...rest] = command
    try {
      child = shell
        ? spawn([file, ...rest, ...args].map(quoted).join(' '), [], { cwd, env, shell: true, windowsHide: true })
        : spawn(file, [...rest, ...args], { cwd, env, windowsHide: true, detached: POSIX })
    } catch (error) {
      finish({ error })
      return
    }
    live.add(child)
    timer = setTimeout(() => {
      timedOut = true
      stop(child)
    }, ms)
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', (error) => {
      if (error.code === 'ENOENT' && !POSIX && !shell) {
        settled = true
        clearTimeout(timer)
        live.delete(child)
        resolve(session(command, args, { cwd, input, env, ms }, true))
      } else finish({ error })
    })
    child.on('close', (code) => finish({ code }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

// What a session's stream-json transcript holds, for grading.
function readTrace(text, work, before) {
  const lines = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const result = lines.filter((line) => line.type === 'result').at(-1) ?? null
  const tools = lines
    .filter((line) => line.type === 'assistant' && Array.isArray(line.message?.content))
    .flatMap((line) => line.message.content.filter((part) => part.type === 'tool_use').map((part) => ({ name: part.name, input: part.input })))
  return {
    result,
    last: typeof result?.result === 'string' ? result.result : '',
    trace: text,
    tools,
    created: listFiles(work).filter((file) => !before.has(file)),
    work,
    cost: Number(result?.total_cost_usd) || 0,
    turns: result?.num_turns ?? 0,
  }
}

// ---- The emitter's files

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
}

function prune(dir, keep) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) prune(path.join(dir, entry.name), false)
  if (!keep && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

// Deletes what the run's sessions wrote under `home`/.epikloop: each event whose cwd lies in
// `root`'s folders, the folders of `projects`, the throwaway projects' ids (a cost row records its
// project, not its folder), and the folders that leaves empty. Returns how many files went.
export function cleanEvents(home, root, projects = []) {
  const base = path.join(home, '.epikloop')
  const norm = (p) => {
    const slashed = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
    return POSIX ? slashed : slashed.toLowerCase()
  }
  let real = root
  try {
    real = fs.realpathSync.native(root)
  } catch {}
  const roots = [...new Set([root, real].map((p) => `${norm(p)}/`))]
  const inside = (cwd) => typeof cwd === 'string' && roots.some((prefix) => `${norm(cwd)}/`.startsWith(prefix))
  let removed = 0
  for (const id of new Set(projects)) {
    if (!/^[0-9a-f]{12}$/.test(id)) continue
    const folder = path.join(base, 'projects', id)
    removed += walk(folder).length
    fs.rmSync(folder, { recursive: true, force: true })
  }
  for (const top of ['events', 'projects']) {
    for (const file of walk(path.join(base, top))) {
      try {
        if (inside(JSON.parse(fs.readFileSync(file, 'utf8')).cwd)) {
          fs.rmSync(file)
          removed += 1
        }
      } catch {}
    }
    prune(path.join(base, top), true)
  }
  return removed
}

// ---- A run of the suite

// Every run of one case, each in its own folder under `ctx.root`: { name, runs, passed, skipped }.
async function runCase(loaded, ctx) {
  const ex = loaded.kase.execution
  const runs = []
  for (let i = 1; i <= loaded.runs; i += 1) {
    if (!ctx.budget()) return { name: loaded.name, runs, passed: false, skipped: true }
    const started = performance.now()
    const work = path.join(ctx.root, loaded.name, String(i))
    fs.mkdirSync(work, { recursive: true })
    if (loaded.fixture !== null) {
      try {
        build(loaded.fixture, work)
      } catch (error) {
        runs.push({ error: `the ${loaded.fixture} fixture didn't build: ${firstLine(error)}`, graded: [], cost: 0, turns: 0, seconds: 0 })
        continue
      }
    }
    const before = new Set(listFiles(work))
    const seconds = ex.timeout_seconds ?? 300
    // git looks for a repository no higher than the run's folder, so a case without a fixture starts
    // outside any repository.
    const env = { ...process.env, DISABLE_AUTOUPDATER: '1', GIT_CEILING_DIRECTORIES: ctx.root, ...ctx.env }
    const ran = await session(ctx.claude, claudeArgs(loaded.kase), { cwd: work, input: ex.prompt, env, ms: seconds * 1000 })
    fs.writeFileSync(path.join(ctx.root, loaded.name, `${i}.jsonl`), ran.out)
    try {
      ctx.projects.push(JSON.parse(fs.readFileSync(path.join(work, '.epikloop', 'project.json'), 'utf8')).id)
    } catch {}
    const run = readTrace(ran.out, work, before)
    ctx.spend(run.cost)
    let error = null
    if (ran.error) error = `claude couldn't start: ${firstLine(ran.error)}`
    else if (ran.timedOut) error = `stopped after ${seconds} s, its timeout`
    else if (run.result === null) error = `claude ended without a result: ${ran.err.trim().split('\n').at(-1) || `exit ${ran.code}`}`
    else if (run.result.is_error === true || (run.result.subtype ?? 'success') !== 'success') error = `the session ended in error (${run.result.subtype ?? 'is_error'})`
    const graded = loaded.kase.graders.map((grader) => {
      try {
        return { name: grader.name, ...grade(grader, run) }
      } catch (problem) {
        return { name: grader.name, ok: false, why: firstLine(problem) }
      }
    })
    runs.push({ error, graded, cost: run.cost, turns: run.turns, seconds: (performance.now() - started) / 1000 })
  }
  const passed = runs.length === loaded.runs && runs.every((run) => run.error === null && run.graded.every((verdict) => verdict.ok))
  return { name: loaded.name, runs, passed, skipped: false }
}

// Runs `cases`, `jobs` at a time, until each has run or the estimated cost reaches `cap`. `claude`
// is the command to start, as an array. Reports each case through `report` as it finishes.
export async function runSuite(cases, { jobs = 3, cap = 5, keep = false, claude = ['claude'], home = os.homedir(), env = {}, report = () => {} } = {}) {
  const started = performance.now()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-evals-'))
  let spent = 0
  const results = []
  const queue = [...cases]
  const ctx = { root, claude, env, projects: [], budget: () => spent < cap, spend: (usd) => (spent += usd) }
  try {
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, async () => {
        while (queue.length > 0) {
          const result = await runCase(queue.shift(), ctx)
          results.push(result)
          report(result)
        }
      }),
    )
  } finally {
    cleanEvents(home, root, ctx.projects)
    if (!keep) fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
  results.sort((a, b) => a.name.localeCompare(b.name))
  return { results, spent, seconds: (performance.now() - started) / 1000, root }
}

function printCase(result) {
  if (result.skipped && result.runs.length === 0) return console.log(`SKIP ${result.name} · the cost cap was reached`)
  const cost = result.runs.reduce((sum, run) => sum + run.cost, 0)
  const turns = result.runs.reduce((sum, run) => sum + run.turns, 0)
  const seconds = result.runs.reduce((sum, run) => sum + run.seconds, 0)
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name} · $${cost.toFixed(2)} · ${turns} turns · ${Math.round(seconds)} s`)
  for (const [i, run] of result.runs.entries()) {
    const label = result.runs.length > 1 ? `run ${i + 1}: ` : ''
    if (run.error !== null) console.log(`  ✗ ${label}${run.error}`)
    for (const verdict of run.graded) if (!verdict.ok) console.log(`  ✗ ${label}${verdict.name}: ${verdict.why}`)
  }
}

async function main(argv) {
  let options
  try {
    options = parseArgs({ args: argv, allowPositionals: true, options: { jobs: { type: 'string' }, cap: { type: 'string' }, keep: { type: 'boolean' } } })
  } catch {
    console.log(USAGE)
    process.exitCode = 1
    return
  }
  const jobs = Number(options.values.jobs ?? 3)
  const cap = Number(options.values.cap ?? 5)
  if (!Number.isInteger(jobs) || jobs < 1 || !(cap > 0)) {
    console.log(USAGE)
    process.exitCode = 1
    return
  }
  const suite = loadSuite()
  const problems = suite.flatMap((loaded) => loaded.problems)
  const unknown = options.positionals.filter((name) => !suite.some((loaded) => loaded.name === name))
  for (const name of unknown) problems.push(`no case is named ${name}`)
  if (problems.length > 0) {
    for (const line of problems) console.log(line)
    console.log(`evals: FAIL · the suite doesn't load`)
    process.exitCode = 1
    return
  }
  const cases = options.positionals.length > 0 ? suite.filter((loaded) => options.positionals.includes(loaded.name)) : suite
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      for (const child of live) stop(child)
      console.log(`evals: stopped by ${signal}; ${live.size} sessions ended`)
      process.exit(130)
    })
  }
  const { results, spent, seconds, root } = await runSuite(cases, { jobs, cap, keep: options.values.keep === true, report: printCase })
  const passed = results.filter((result) => result.passed).length
  const skipped = results.filter((result) => result.skipped).length
  const verdict = passed === results.length ? 'PASS' : results.some((result) => !result.passed && !result.skipped) ? 'FAIL' : `STOPPED at the $${cap} cap`
  console.log(`evals: ${verdict} · ${passed}/${results.length} cases · $${spent.toFixed(2)} at list price · ${(seconds / 60).toFixed(1)} min${options.values.keep ? ` · kept in ${root}` : ''}`)
  process.exitCode = verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : skipped > 0 ? 2 : 1
}

// ---- The self-test

// A stand-in for claude: it reads the prompt, does what FAKE_PLAN says, and prints a transcript.
const FAKE = `const fs = require('fs')
const path = require('path')
let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  const plan = JSON.parse(process.env.FAKE_PLAN || '{}')
  if (plan.sleep) return setTimeout(() => {}, plan.sleep)
  for (const [file, text] of Object.entries(plan.files || {})) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  if (plan.event) {
    const day = path.join(process.env.FAKE_HOME, '.epikloop', 'events', '2026-11-01')
    fs.mkdirSync(day, { recursive: true })
    fs.writeFileSync(path.join(day, process.pid + '.json'), JSON.stringify({ format: 1, cwd: process.cwd(), kind: 'stop' }))
    const id = JSON.parse(fs.readFileSync('.epikloop/project.json', 'utf8')).id
    const cost = path.join(process.env.FAKE_HOME, '.epikloop', 'projects', id, 'cost')
    fs.mkdirSync(cost, { recursive: true })
    fs.writeFileSync(path.join(cost, process.pid + '.json'), JSON.stringify({ format: 1, story: '1.1', cost: 0.2 }))
  }
  const reply = [plan.reply || '', 'prompt=' + input, 'marker=' + fs.existsSync('.epikloop/project.json'), 'args=' + process.argv.slice(2).join(' ')].join(' | ')
  const lines = [
    { type: 'system', subtype: 'init', cwd: process.cwd() },
    ...(plan.tools || []).map((tool) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: tool.name, input: tool.input }] } })),
    { type: 'result', subtype: plan.subtype || 'success', is_error: false, num_turns: 2, total_cost_usd: plan.cost === undefined ? 0.01 : plan.cost, result: reply },
  ]
  process.stdout.write(lines.map((line) => JSON.stringify(line)).join('\\n') + '\\n')
})
`

async function selfTest() {
  const started = performance.now()
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-evals-test-'))
  const home = path.join(temp, 'home')
  fs.mkdirSync(home)
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[core]\n\tautocrlf = false\n')
  // The fixtures build as the scaffold builds them, and the gates' events go to this home.
  for (const key of Object.keys(process.env)) if (/^(?:GIT_.*|EMAIL|CLAUDE_CODE_SESSION_ID)$/i.test(key)) delete process.env[key]
  Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_TERMINAL_PROMPT: '0', HOME: home, USERPROFILE: home })
  const fake = path.join(temp, 'fake-claude.cjs')
  fs.writeFileSync(fake, FAKE)
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  // A suite folder holding the given cases, each case.yaml text and an optional fixture name.
  let suites = 0
  const suiteOf = (cases) => {
    suites += 1
    const dir = path.join(temp, `suite-${suites}`)
    for (const [name, yaml, fixture] of cases) {
      write(path.join(dir, name, 'case.yaml'), yaml)
      if (fixture) write(path.join(dir, name, 'scaffold.sh'), `#!/bin/sh\nexec node "$(dirname "$0")/../fixture.mjs" ${fixture}\n`)
    }
    return dir
  }
  const yaml = (name, { prompt = 'hello', extra = '', graders = "  - name: replied\n    type: regex\n    pattern: 'prompt=hello'\n", context = '' } = {}) =>
    `schema_version: "1.1"\nname: ${name}\nruns: 1\n${context}execution:\n  prompt: ${prompt}\n  model: claude-sonnet-5-5\n  timeout_seconds: 60\n  allowed_tools: [Read, Skill]\n${extra}graders:\n${graders}`
  const run = (cases, options = {}) => runSuite(loadSuite(suiteOf(cases)), { claude: [process.execPath, fake], home, jobs: 1, ...options })
  const fakeRun = (work, extra = {}) => ({ last: '', trace: '', tools: [], created: [], work, ...extra })
  const has = (problems, ...texts) => texts.filter((text) => !problems.some((problem) => problem.includes(text))).map((text) => `nothing said ${JSON.stringify(text)} in ${JSON.stringify(problems)}`)
  const verdicts = (run, cases) => cases.flatMap(([grader, ok]) => (grade(grader, run).ok === ok ? [] : [`${JSON.stringify(grader)} gave ${!ok}, not ${ok}`]))

  const CASES = [
    [
      'every case in the suite loads, each with a fixture or none',
      () => {
        const suite = loadSuite()
        const problems = suite.flatMap((loaded) => loaded.problems)
        if (suite.length < 10) problems.push(`only ${suite.length} cases loaded`)
        return problems
      },
    ],
    [
      'the parser reads the subset the cases use',
      () => {
        const text = [
          'schema_version: "1.1"',
          'name: sample',
          'runs: 2',
          '# a comment',
          'tags: [a, b]',
          'execution:',
          "  prompt: '/epikloop:plan The human''s decisions, given: one, two'",
          '  max_turns: 40',
          'graders:',
          '  - name: commits',
          '    type: regex',
          '    target: { source: file, path: .git/logs/HEAD }',
          "    pattern: '\\tcommit: (?!fixture: )'",
          '    exists: false',
        ].join('\n')
        const want = {
          schema_version: '1.1',
          name: 'sample',
          runs: 2,
          tags: ['a', 'b'],
          execution: { prompt: "/epikloop:plan The human's decisions, given: one, two", max_turns: 40 },
          graders: [{ name: 'commits', type: 'regex', target: { source: 'file', path: '.git/logs/HEAD' }, pattern: '\\tcommit: (?!fixture: )', exists: false }],
        }
        const got = parseCase(text)
        return JSON.stringify(got) === JSON.stringify(want) ? [] : [`parsed ${JSON.stringify(got)}`]
      },
    ],
    [
      "a case this runner can't run as written is reported",
      () => {
        const dir = suiteOf([
          ['block', 'schema_version: "1.1"\nname: block\nexecution:\n  prompt: |\n    hello\n'],
          ['typo', yaml('typo', { extra: '  max_turn: 5\n' })],
          ['renamed', yaml('other')],
          ['judged', yaml('judged', { graders: '  - name: rubric\n    type: llm\n' })],
          ['broken', yaml('broken', { graders: "  - name: bad\n    type: regex\n    pattern: '('\n" })],
          ['granted', yaml('granted').replace('[Read, Skill]', '[Read, Bash]')],
          ['unrun', yaml('unrun'), 'planned'],
        ])
        const problems = loadSuite(dir).flatMap((loaded) => loaded.problems)
        return has(
          problems,
          'block/case.yaml: line 4: a block scalar',
          "typo/case.yaml: execution.max_turn isn't a field this runner reads",
          'renamed/case.yaml: name is "other"',
          'judged/case.yaml: grader "rubric"\'s type "llm"',
          'broken/case.yaml: grader "bad"\'s pattern doesn\'t compile',
          "granted/case.yaml: allowed_tools lists Bash, which isn't one of the read-only tools",
          'unrun/case.yaml: scaffold.sh and context.scaffold_script go together',
        )
      },
    ],
    [
      'regex graders read the reply, the trace, the files created and a file inside the workspace',
      () => {
        const work = path.join(temp, 'regex')
        write(path.join(work, 'docs', 'queue.md'), '# Queue\n\n- 2026-11-01 Spanish one day\n')
        const run = fakeRun(work, { last: 'Story 1.1 landed as 3238a73. MVP: 1/1', trace: '{"a":"b"}\n{"c":"d"}', created: ['test/greet.test.mjs'] })
        const problems = verdicts(run, [
          [{ type: 'regex', pattern: '1\\.1 landed\\b[^\\n]*\\b[0-9a-f]{7}\\b' }, true],
          [{ type: 'regex', pattern: 'mvp\\W{0,6}1/1' }, false],
          [{ type: 'regex', pattern: 'mvp\\W{0,6}1/1', flags: 'i' }, true],
          [{ type: 'regex', pattern: 'landed', match: 'not_contains' }, false],
          [{ type: 'regex', pattern: 'nowhere', match: 'not_contains' }, true],
          [{ type: 'regex', pattern: '"\\w":', target: 'trace', match: 'count:2' }, true],
          [{ type: 'regex', pattern: '"\\w":', target: 'trace', match: 'count:3' }, false],
          [{ type: 'regex', pattern: '^test/', target: 'files' }, true],
          [{ type: 'regex', pattern: '\\n- \\d{4}-\\d{2}-\\d{2} [^\\n]*[Ss]panish', target: { source: 'file', path: 'docs/queue.md' } }, true],
          [{ type: 'regex', pattern: 'Q-001', target: { source: 'file', path: 'docs/missing.md' }, match: 'not_contains' }, true],
        ])
        try {
          grade({ type: 'regex', pattern: 'x', target: { source: 'file', path: '../outside.md' } }, run)
          problems.push('read a file outside the workspace')
        } catch (error) {
          if (!String(error.message).includes('outside the workspace')) problems.push(`refused for another reason: ${error.message}`)
        }
        return problems
      },
    ],
    [
      'tool_used counts the matching calls between min and max, at least one by default',
      () => {
        const run = fakeRun(temp, { tools: [{ name: 'Bash', input: { command: 'node "/p/bin/state.mjs" --ready 1.1' } }, { name: 'Bash', input: { command: 'git fetch' } }, { name: 'Agent', input: { subagent_type: 'epikloop:story-worker' } }] })
        return verdicts(run, [
          [{ type: 'tool_used', tool: 'Bash', input_match: 'state\\.mjs' }, true],
          [{ type: 'tool_used', tool: 'Write' }, false],
          [{ type: 'tool_used', tool: 'Write', min: 0, max: 0 }, true],
          [{ type: 'tool_used', tool: 'Bash', max: 1 }, false],
          [{ type: 'tool_used', tool: 'Agent', input_match: 'epikloop:story-worker' }, true],
        ])
      },
    ],
    [
      'file_exists sees only the files the run created',
      () => {
        const run = fakeRun(temp, { created: ['src/greet.mjs', 'test/greet.test.mjs'] })
        return verdicts(run, [
          [{ type: 'file_exists', path: '**/*.test.*' }, true],
          [{ type: 'file_exists', path: '*.test.*' }, false],
          [{ type: 'file_exists', path: 'spec/*.md' }, false],
          [{ type: 'file_exists', path: '**/*', exists: false }, false],
          [{ type: 'file_exists', path: 'docs/**', exists: false }, true],
        ])
      },
    ],
    [
      'a case runs in its fixture, with its prompt on stdin and only its own tools, and its events are cleaned',
      async () => {
        const outside = path.join(home, '.epikloop', 'events', '2026-10-31', 'mine.json')
        write(outside, JSON.stringify({ format: 1, cwd: path.join(temp, 'elsewhere'), kind: 'stop' }))
        const other = path.join(home, '.epikloop', 'projects', '0123456789ab', 'cost', 'mine.json')
        write(other, JSON.stringify({ format: 1, story: '2.1', cost: 0.1 }))
        const plan = { files: { 'notes/new.md': 'new\n' }, event: true, tools: [{ name: 'Bash', input: { command: 'git status' } }] }
        const graders = [
          "  - name: prompt\n    type: regex\n    pattern: 'prompt=Say hi\\.'\n",
          "  - name: fixture\n    type: regex\n    pattern: 'marker=true'\n",
          "  - name: tools\n    type: regex\n    pattern: '--allowedTools Bash Write Edit Read Skill --disallowedTools PowerShell WebFetch WebSearch Glob Grep NotebookRead AskUserQuestion Agent TodoWrite'\n",
          "  - name: plugin\n    type: regex\n    pattern: '--plugin-dir \\S*epikloop --output-format stream-json'\n",
          '  - name: bash\n    type: tool_used\n    tool: Bash\n',
          "  - name: created\n    type: file_exists\n    path: 'notes/new.md'\n",
          "  - name: kept-the-fixture-out\n    type: file_exists\n    path: 'spec/*.md'\n    exists: false\n",
        ].join('')
        const { results } = await run([['fixtured', yaml('fixtured', { prompt: "'Say hi.'", graders, context: 'context:\n  scaffold_script: scaffold.sh\n' }), 'specified']], { env: { FAKE_PLAN: JSON.stringify(plan), FAKE_HOME: home } })
        const problems = results[0].passed ? [] : [`it failed: ${JSON.stringify(results[0].runs)}`]
        const left = walk(path.join(home, '.epikloop')).map((file) => path.relative(home, file))
        if (left.length !== 2 || !fs.existsSync(outside) || !fs.existsSync(other)) problems.push(`left ${JSON.stringify(left)} in the home, not only the files from elsewhere`)
        return problems
      },
    ],
    [
      'a session that ends in error fails its case, whatever its graders say',
      async () => {
        const { results } = await run([['errored', yaml('errored')]], { env: { FAKE_PLAN: JSON.stringify({ subtype: 'error_max_turns' }) } })
        return results[0].passed ? ['an error_max_turns session passed'] : has(results[0].runs.map((r) => r.error ?? ''), 'ended in error (error_max_turns)')
      },
    ],
    [
      'a session past its timeout is stopped, and its case fails',
      async () => {
        const began = performance.now()
        const slow = yaml('slow').replace('timeout_seconds: 60', 'timeout_seconds: 1')
        const { results } = await run([['slow', slow]], { env: { FAKE_PLAN: JSON.stringify({ sleep: 30_000 }) } })
        const problems = has(results[0].runs.map((r) => r.error ?? ''), 'stopped after 1 s, its timeout')
        if ((performance.now() - began) / 1000 > 20) problems.push('the session ran on past its timeout')
        return problems
      },
    ],
    [
      'the cost cap stops starting runs once it is reached',
      async () => {
        const { results, spent } = await run([['a', yaml('a')], ['b', yaml('b')], ['c', yaml('c')]], { cap: 5, env: { FAKE_PLAN: JSON.stringify({ cost: 3 }) } })
        const skipped = results.filter((result) => result.skipped).map((result) => result.name)
        return JSON.stringify(skipped) === '["c"]' && spent === 6 ? [] : [`skipped ${JSON.stringify(skipped)} after $${spent}`]
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
      problems = [`threw: ${firstLine(error)}`]
    }
    if (problems.length > 0) failed += 1
    for (const problem of problems) failures.push(`${name}: ${problem}`)
  }
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 })
  for (const line of failures) console.log(line)
  console.log(`evals self-test: ${CASES.length - failed}/${CASES.length} as expected · ${((performance.now() - started) / 1000).toFixed(1)} s`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {
  try {
    if (process.argv[2] === '--self-test') await selfTest()
    else await main(process.argv.slice(2))
  } catch (error) {
    console.log(`evals: ${firstLine(error)}`)
    process.exitCode = 1
  }
}
