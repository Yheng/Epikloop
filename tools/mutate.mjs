// The self-tests' mutation check. `node tools/mutate.mjs [test …]` copies this repository's files,
// breaks one rule at a time in a copy, and expects the self-tests named for that rule to fail. The
// mutations are in tools/mutations.mjs; naming tests runs only the mutations that name them.
//
// - First it runs each named self-test once on an unmutated copy. A self-test that fails there
//   would make every mutation look caught, so the run stops.
// - A mutation is caught when one of its self-tests fails, or runs past its cap and is stopped.
// - The run fails on a mutation that survives, one whose text no longer appears exactly once, and
//   a self-test that can't start.
// It prints those, then one summary line.
//
// `node tools/mutate.mjs --self-test` checks the check with the guard's self-test: an edit that
// changes nothing survives, a text that isn't there is stale, and a broken rule is caught.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MUTATIONS } from './mutations.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const POSIX = process.platform !== 'win32'
// A self-test that runs longer than this is stopped, and its mutation counts as caught.
const CAP = 600_000
const JOBS = Math.max(1, Math.min(Number(process.env.MUTATE_JOBS) || os.availableParallelism(), 8))

// Each self-test a mutation can name, as the command that runs it from the repository's root.
const TESTS = {
  guard: [process.execPath, 'plugins/epikloop/bin/guard.mjs', '--self-test'],
  brief: [process.execPath, 'plugins/epikloop/bin/brief.mjs', '--self-test'],
  init: [process.execPath, 'plugins/epikloop/bin/init.mjs', '--self-test'],
  state: [process.execPath, 'plugins/epikloop/bin/state.mjs', '--self-test'],
  smoke: [process.execPath, 'plugins/epikloop/bin/smoke.mjs', '--self-test'],
  doctor: [process.execPath, 'plugins/epikloop/bin/doctor.mjs', '--self-test'],
  fold: [process.execPath, 'plugins/epikloop/bin/fold.mjs', '--self-test'],
  check: [process.execPath, 'plugins/epikloop/templates/githooks/check.mjs', '--self-test'],
  emit: ['claude', 'plugin', 'test', 'plugins/epikloop'],
  laws: [process.execPath, 'tools/laws.mjs', '--self-test'],
}

// The repository's files as a copy needs them: tracked, and new ones not yet ignored.
function files() {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`git ls-files failed: ${(run.stderr || run.error?.message || '').trim().split('\n')[0]}`)
  return [...new Set(run.stdout.split('\0').filter(Boolean))].filter((file) => fs.existsSync(path.join(ROOT, file)))
}

function copy(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-mutant-'))
  for (const file of list) {
    const target = path.join(dir, ...file.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(ROOT, ...file.split('/')), target)
  }
  return dir
}

// Ends a self-test and everything it started.
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

// Runs one self-test in `dir`: { code, hung, error, out }. npm installs claude on Windows as a .cmd
// shim, which only a shell runs; the command is always this file's own.
function runTest(dir, name, shell = false) {
  return new Promise((resolve) => {
    const [file, ...args] = TESTS[name]
    let child
    let out = ''
    let hung = false
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ out, hung, ...result })
    }
    const timer = setTimeout(() => {
      hung = true
      stop(child)
    }, CAP)
    try {
      child = spawn(shell ? `${file} ${args.join(' ')}` : file, shell ? [] : args, { cwd: dir, shell, windowsHide: true, detached: POSIX, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ error })
      return
    }
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    child.on('error', (error) => {
      if (error.code === 'ENOENT' && !POSIX && !shell) {
        done = true
        clearTimeout(timer)
        resolve(runTest(dir, name, true))
      } else finish({ error })
    })
    child.on('close', (code) => finish({ code }))
  })
}

// A mutation's outcome: caught (by which self-test), survived, stale, or broken (a self-test that
// couldn't start).
async function mutate(list, mutation) {
  const source = fs.readFileSync(path.join(ROOT, ...mutation.file.split('/')), 'utf8')
  const count = source.split(mutation.from).length - 1
  if (count !== 1) return { outcome: 'stale', why: `its text appears ${count} times in ${mutation.file}` }
  const dir = copy(list)
  try {
    fs.writeFileSync(path.join(dir, ...mutation.file.split('/')), source.replace(mutation.from, () => mutation.to))
    for (const name of mutation.tests) {
      const result = await runTest(dir, name)
      if (result.error) return { outcome: 'broken', why: `${name} couldn't start: ${result.error.message}` }
      if (result.hung) return { outcome: 'caught', by: `${name} (stopped at its cap)` }
      if (result.code !== 0) return { outcome: 'caught', by: name }
    }
    return { outcome: 'survived', why: `${mutation.tests.join(' and ')} still pass${mutation.tests.length === 1 ? 'es' : ''}` }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  }
}

// Runs tasks a few at a time, keeping their order.
async function pool(tasks) {
  const results = new Array(tasks.length)
  let next = 0
  const lane = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, tasks.length) }, lane))
  return results
}

// Each named self-test on an unmutated copy; the ones that don't pass, as lines.
async function baseline(list, names) {
  const dir = copy(list)
  try {
    const results = await pool(names.map((name) => () => runTest(dir, name)))
    return names.flatMap((name, i) => {
      const r = results[i]
      if (r.error) return [`baseline: ${name} couldn't start: ${r.error.message}`]
      if (r.hung || r.code !== 0) return [`baseline: ${name} fails without any mutation: ${r.out.trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`]
      return []
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  }
}

const line = (mutation, result) => {
  const label = { survived: 'SURVIVED', stale: 'STALE', broken: 'BROKEN' }[result.outcome]
  return `${label} ${mutation.file}: ${mutation.name}: ${result.why}`
}

async function main(names) {
  const started = performance.now()
  const unknown = names.filter((name) => !(name in TESTS))
  if (unknown.length > 0) return console.log(`usage: node tools/mutate.mjs [--self-test | ${Object.keys(TESTS).join(' | ')} …]`)
  const chosen = names.length === 0 ? MUTATIONS : MUTATIONS.filter((mutation) => mutation.tests.some((name) => names.includes(name)))
  const list = files()
  const needed = [...new Set(chosen.flatMap((mutation) => mutation.tests))]
  const failed = await baseline(list, needed)
  if (failed.length > 0) {
    for (const text of failed) console.log(text)
    console.log(`mutations: not run, since ${failed.length === 1 ? 'a self-test fails' : `${failed.length} self-tests fail`} on the unmutated copy`)
    return
  }
  const results = await pool(chosen.map((mutation) => () => mutate(list, mutation)))
  const bad = chosen.flatMap((mutation, i) => (results[i].outcome === 'caught' ? [] : [line(mutation, results[i])]))
  for (const text of bad) console.log(text)
  const caught = results.filter((result) => result.outcome === 'caught').length
  const minutes = ((performance.now() - started) / 60_000).toFixed(1)
  console.log(`mutations: ${caught}/${chosen.length} caught · ${needed.length} self-tests · ${JOBS} at a time · ${minutes} min`)
  if (bad.length === 0) process.exitCode = 0
}

async function selfTest() {
  const guard = 'plugins/epikloop/bin/guard.mjs'
  const cases = [
    ['an edit that changes nothing survives', { file: guard, tests: ['guard'], name: 'reword a comment', from: '// Where one command ends and the next begins, for the rules.', to: '// Where each command ends.' }, 'survived'],
    ["text that isn't there is stale", { file: guard, tests: ['guard'], name: 'a missing text', from: 'this text is nowhere in the guard', to: '' }, 'stale'],
    ['a broken rule is caught', { file: guard, tests: ['guard'], name: 'switch off the hard-reset rule', from: "test: ({ sub, args }) => sub === 'reset' && / --hard /.test(args),", to: 'test: () => false,' }, 'caught'],
  ]
  const list = files()
  const results = await pool(cases.map(([, mutation]) => () => mutate(list, mutation)))
  const failures = cases.flatMap(([name, , want], i) => (results[i].outcome === want ? [] : [`${name}: ${results[i].outcome}${results[i].why ? ` (${results[i].why})` : ''}`]))
  for (const text of failures) console.log(`FAIL ${text}`)
  console.log(`mutate self-test: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  process.exitCode = 1
  try {
    if (process.argv[2] === '--self-test' && process.argv.length === 3) await selfTest()
    else await main(process.argv.slice(2))
  } catch (error) {
    console.log(`mutations: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
