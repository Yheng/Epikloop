// Epikloop's gate runner. A product repo carries it as .githooks/check.mjs, beside the pre-commit
// and pre-push hooks that load it, and scripts/check.sh runs it by hand and in CI. It needs only
// Node 22 and git, so teammates without the plugin, and team mode's required check, run the same
// gates.
//
//   --fast                 pre-commit: shims, workflows, secrets in what is staged, tokens, lint, typecheck
//   (no flag)              per story: the same plus test and build, with secrets in the working state
//   --push <remote> <url>  pre-push: the full run, with secrets in every outgoing commit
//   --deep                 retro: the full run plus e2e
//   --self-test            known-bad and known-good samples for every gate, and mutations of this file
//   --arm                  the install step: points core.hooksPath at .githooks when nothing else owns it
//
// It prints failures and one summary line, and never a secret's value. It fails unless it ends
// green: the hooks set exit code 1 before they load it, and so does its first statement.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.exitCode = 1

const SHIMS = ['.githooks/pre-commit', '.githooks/pre-push', 'scripts/check.sh']
const COMMAND_GATES = ['lint', 'typecheck', 'test', 'build', 'e2e']
const GIT_CAP = 60_000
// A command gets 10 minutes, the team-mode check's own job timeout. The self-test lowers the cap
// to test it; nothing raises it.
const CAP = Math.min(600_000, Number(process.env.CHECK_TIMEOUT_MS) || 600_000)
const ZERO = /^0+$/
const POSIX = process.platform !== 'win32'

// Runs a program to its end or its cap, keeping all of its output. It settles once the program has
// exited and its pipes have closed; a shell command gets two seconds after its exit, in case a
// grandchild still holds the pipes.
function run(file, args, { cwd, env, input, timeout, shell = false } = {}) {
  return new Promise((resolve) => {
    const out = []
    const err = []
    const all = []
    let child
    let exit = {}
    let timedOut = false
    let settled = false
    let grace
    const timer = setTimeout(() => {
      timedOut = true
      stop(child)
    }, timeout)
    const settle = (extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      child?.stdout?.destroy()
      child?.stderr?.destroy()
      const stdout = Buffer.concat(out)
      resolve({ ...exit, ...extra, timedOut, stdout, stderr: Buffer.concat(err), all: Buffer.concat(all) })
    }
    try {
      child = spawn(file, args, {
        cwd,
        env,
        shell,
        windowsHide: true,
        detached: shell && POSIX,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      settle({ error })
      return
    }
    child.stdout.on('data', (chunk) => {
      out.push(chunk)
      all.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      err.push(chunk)
      all.push(chunk)
    })
    child.on('error', (error) => settle({ error }))
    child.on('exit', (code, signal) => {
      exit = { code, signal }
      if (shell) grace = setTimeout(settle, 2000)
    })
    child.on('close', () => settle())
    if (input !== undefined) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}

// Ends a program and everything it started.
function stop(child) {
  if (!child?.pid) return
  if (!POSIX) {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () =>
      child.kill(),
    )
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

// Runs git with the repository's own config. Every read the gates make is plumbing, so no porcelain
// setting (colour, an external diff, textconv, prefixes, quoting) shapes what they see.
async function git(args, { input, env, allow = false } = {}) {
  const r = await run('git', args, { input, env, timeout: GIT_CAP })
  if (r.error || r.timedOut || r.signal || (r.code !== 0 && !allow)) {
    const said = r.stderr.toString('utf8').trim().split('\n')[0]
    const why = r.error?.message ?? (r.timedOut ? 'timed out' : said || `exit ${r.code ?? r.signal}`)
    throw new Error(`git ${args[0]} failed: ${why}`)
  }
  return r
}
const text = (r) => r.stdout.toString('utf8').trim()
const splitZ = (r) => r.stdout.toString('utf8').split('\0').filter(Boolean)
async function gitPath(name) {
  return path.resolve(text(await git(['rev-parse', '--git-path', name])))
}

// The project's gate settings, from .epikloop/project.json. Anything this file doesn't read fails
// the run rather than being ignored.
function readConfig() {
  let project
  try {
    project = JSON.parse(fs.readFileSync('.epikloop/project.json', 'utf8'))
  } catch (error) {
    throw new Error(`.epikloop/project.json: ${error.code === 'ENOENT' ? 'missing' : error.message}`)
  }
  const problems = []
  if (!/^[0-9a-f]{12}$/.test(project?.id ?? '')) problems.push('id must be 12 hex digits')
  if (project?.mode !== 'solo' && project?.mode !== 'team') problems.push('mode must be solo or team')
  const gates = project?.gates ?? {}
  for (const key of Object.keys(gates)) {
    if (!['commands', 'token_ignore', 'allow_workflows'].includes(key)) problems.push(`gates.${key} is not a gate setting`)
  }
  for (const [name, command] of Object.entries(gates.commands ?? {})) {
    if (!COMMAND_GATES.includes(name)) problems.push(`gates.commands.${name} is not a command gate`)
    else if (typeof command !== 'string' || command.trim() === '') problems.push(`gates.commands.${name} must be a command`)
  }
  for (const [i, entry] of [gates.token_ignore ?? []].flat().entries()) {
    const ok = typeof entry?.path === 'string' && entry.path !== '' && typeof entry?.reason === 'string'
    if (!ok || entry.reason.trim() === '') problems.push(`gates.token_ignore[${i}] needs a path and its reason`)
  }
  for (const name of [gates.allow_workflows ?? []].flat()) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(name)) {
      problems.push(`gates.allow_workflows: ${JSON.stringify(name)} is not a workflow file name`)
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return { ...project, gates }
}

// ---- The secret scan

// Key formats, each with a sample built at run time so this file never holds one. Before every scan
// the canary runs each sample through its pattern, so a pattern that stops matching fails the gate
// instead of passing everything.
const KEYS = [
  {
    kind: 'private key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    sample: () => `${'-'.repeat(5)}BEGIN EC PRIVATE KEY${'-'.repeat(5)}`,
  },
  { kind: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/, sample: () => `AK${'IA'}${'Q7'.repeat(8)}` },
  { kind: 'OpenAI key', re: /\bsk-(?:proj|svcacct|admin)-[\w-]{40,}/, sample: () => `sk-${'proj'}-${'Ab9'.repeat(14)}` },
  { kind: 'Anthropic key', re: /\bsk-ant-[\w-]{40,}/, sample: () => `sk-${'ant'}-api03-${'Zx8_'.repeat(12)}` },
  { kind: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{20,}\b/, sample: () => `sk-${'T3st'.repeat(6)}` },
  { kind: 'Stripe live key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}/, sample: () => `sk${'_live_'}${'Qw3'.repeat(9)}` },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/, sample: () => `gh${'p_'}${'Ab1'.repeat(12)}` },
  { kind: 'GitHub token', re: /\bgithub_pat_\w{50,}/, sample: () => `github${'_pat_'}${'A1_'.repeat(20)}` },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/, sample: () => `np${'m_'}${'Xy9'.repeat(12)}` },
  { kind: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, sample: () => `xo${'xb'}-${'1234567890'}-${'abcdefgh'}` },
  { kind: 'Google API key', re: /\bAIza[\w-]{35}/, sample: () => `AI${'za'}Sy${'D4'.repeat(16)}x` },
  { kind: 'JWT', re: /\beyJhbGciOi[\w.-]{40,}/, sample: () => `eyJh${'bGciOi'}JIUzI1NiJ9.${'eyJzdWIiOiIx'}.${'Sf1KxwRJ'.repeat(4)}` },
]

// Database URLs that carry a password. A dotless host is local by construction (localhost, a
// compose service), as are the loopback addresses and Docker's host alias; a password that is
// wholly a placeholder is a documentation example.
const DB_URL =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb|rediss?|amqps?)(?:\+[a-z0-9]+)?:\/\/[^\s:@\/]*:([^\s@\/]+)@(\[[^\]\s\/]*\]|[^\s:\/?#@]+)/gi
const DB_SAMPLE = () => `${'postgres'}://app:Tr0ub4dor@db.example.com/app`
const PLACEHOLDER = /^(?:\$\{[^}]*\}|\$[A-Za-z_]\w*|<[^>]*>|\{+[^{}]*\}+|\*+)$/
function harmlessUrl(password, host) {
  if (PLACEHOLDER.test(password)) return true
  const name = host.toLowerCase()
  if (name.startsWith('[')) return name === '[::1]'
  return !name.includes('.') || name.startsWith('127.') || name === '0.0.0.0' || name === 'host.docker.internal'
}

function canary() {
  for (const key of KEYS) {
    if (!key.re.test(key.sample())) throw new Error(`the scan's canary failed: the ${key.kind} pattern matches nothing`)
  }
  if (![...DB_SAMPLE().matchAll(DB_URL)].some((m) => !harmlessUrl(m[1], m[2]))) {
    throw new Error("the scan's canary failed: the database URL pattern matches nothing")
  }
}

function scanLine(line) {
  const hits = []
  for (const key of KEYS) {
    const match = key.re.exec(line)
    if (match) hits.push({ kind: key.kind, value: match[0] })
  }
  for (const m of line.matchAll(DB_URL)) {
    if (!harmlessUrl(m[1], m[2])) hits.push({ kind: 'database URL with a password', value: m[0] })
  }
  return hits
}

// Secret files at any depth: .env and .dev.vars, bare or with a suffix, and anything under a
// secrets/ directory. Their documented stand-ins pass.
function secretFile(file) {
  const parts = file.split('/')
  const name = parts[parts.length - 1]
  if (name === '.env.example' || name === '.dev.vars.example') return false
  if (/^\.env(?:\..+)?$/.test(name) || /^\.dev\.vars(?:\..+)?$/.test(name)) return true
  return parts.slice(0, -1).includes('secrets') && name !== 'README.md'
}

// A blob's lines: UTF-16 by its byte-order mark, latin1 when it holds a NUL, UTF-8 otherwise.
// Nothing is skipped as binary, so a NUL can't hide a key.
function textLines(buffer) {
  let text
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le')
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    text = Buffer.from(buffer.subarray(2, buffer.length - (buffer.length % 2))).swap16().toString('utf16le')
  } else if (buffer.includes(0)) text = buffer.toString('latin1')
  else text = buffer.toString('utf8')
  return text.split(/\r?\n/)
}

// The new lines minus the old, as a multiset, so a moved line isn't added and a removed one never
// counts. Each keeps its number in the new text.
function addedLines(oldLines, newLines) {
  const left = new Map()
  for (const line of oldLines) left.set(line, (left.get(line) ?? 0) + 1)
  const added = []
  newLines.forEach((line, index) => {
    const count = left.get(line) ?? 0
    if (count > 0) left.set(line, count - 1)
    else added.push({ line, number: index + 1 })
  })
  return added
}

function unreadable(what) {
  throw new Error(`couldn't read ${what}`)
}

// The entries of `--raw -z` output: ":<mode> <mode> <id> <id> <status>", then the path, or the
// source and destination paths for a rename or a copy.
function parseRaw(result) {
  const tokens = result.stdout.toString('utf8').split('\0')
  const entries = []
  let i = 0
  const take = () => tokens[i++]
  while (i < tokens.length) {
    const meta = tokens[i++]
    if (meta === '') continue
    const [srcMode, dstMode, srcId, dstId, status] = meta.slice(1).split(' ')
    const letter = status?.[0]
    const srcPath = take()
    const dstPath = letter === 'R' || letter === 'C' ? take() : srcPath
    if (!meta.startsWith(':') || !letter || srcPath === undefined || dstPath === undefined) unreadable('the diff')
    entries.push({ letter, srcMode, dstMode, srcId, dstId, srcPath, dstPath })
  }
  return entries
}

// Reads blobs by id in one `git cat-file --batch`. An object that doesn't come back fails the gate.
async function readBlobs(ids) {
  const wanted = [...new Set(ids)]
  const blobs = new Map()
  if (wanted.length === 0) return blobs
  const out = (await git(['cat-file', '--batch'], { input: `${wanted.join('\n')}\n` })).stdout
  let at = 0
  for (const id of wanted) {
    const end = out.indexOf(10, at)
    const [got, type, size] = (end < 0 ? '' : out.subarray(at, end).toString('latin1')).split(' ')
    if (got !== id || type === undefined || type === 'missing') unreadable(`object ${id.slice(0, 7)}`)
    const length = Number(size)
    blobs.set(id, out.subarray(end + 1, end + 1 + length))
    at = end + 2 + length
  }
  return blobs
}

const fromDisk = (file, mode) => (mode === '120000' ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file))

// Scans one diff: each destination path against the secret-file names, and each added line
// against the formats. An entry whose new side isn't in the object store is read from disk.
async function scanEntries(entries, commit, findings) {
  const live = entries.filter((e) => e.letter !== 'D')
  const ids = []
  for (const e of live) {
    if (e.letter !== 'A' && e.srcMode !== '160000' && !ZERO.test(e.srcId)) ids.push(e.srcId)
    if (e.dstMode !== '160000' && !ZERO.test(e.dstId)) ids.push(e.dstId)
  }
  const blobs = await readBlobs(ids)
  for (const e of live) {
    if (secretFile(e.dstPath)) findings.push({ commit, file: e.dstPath, kind: 'secret file' })
    if (e.dstMode === '160000') continue
    const before = e.letter === 'A' || e.srcMode === '160000' || ZERO.test(e.srcId) ? [] : textLines(blobs.get(e.srcId))
    const after = textLines(ZERO.test(e.dstId) ? fromDisk(e.dstPath, e.dstMode) : blobs.get(e.dstId))
    for (const { line, number } of addedLines(before, after)) {
      for (const hit of scanLine(line)) findings.push({ commit, file: e.dstPath, line: number, ...hit })
    }
  }
}

async function headOrEmptyTree() {
  const head = await git(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { allow: true })
  if (head.code === 0) return text(head)
  return text(await git(['hash-object', '-t', 'tree', '--stdin'], { input: '' }))
}

// The ref lines git hands pre-push on stdin: <local ref> <local id> <remote ref> <remote id>.
async function readPush(remote, url) {
  let input = ''
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk
  const refs = input
    .split('\n')
    .map((line) => line.trim().split(' '))
    .filter((fields) => fields.length === 4)
  return { remote, url, refs }
}
const pushedTips = (ctx) => (ctx.push?.refs ?? []).map((ref) => ref[1]).filter((id) => !ZERO.test(id))

async function remoteName(name, url) {
  const names = text(await git(['remote'])).split('\n').filter(Boolean)
  if (names.includes(name)) return name
  const urls = await git(['config', '--get-regexp', '^remote\\..*\\.(push)?url$'], { allow: true })
  for (const line of text(urls).split('\n').filter(Boolean)) {
    const space = line.indexOf(' ')
    const key = line.slice(0, space)
    if (line.slice(space + 1) === url) return key.slice('remote.'.length, key.lastIndexOf('.'))
  }
  return null
}

// Every commit a push sends: for each ref line, what the remote lacks. A new ref, or a remote tip
// this clone hasn't fetched, is measured against the remote-tracking refs. Nothing is fetched.
async function outgoingCommits(push) {
  const remote = await remoteName(push.remote, push.url)
  const tracked = remote === null ? ['--remotes'] : [`--remotes=${remote}`]
  const commits = new Map()
  for (const [, local, , theirs] of push.refs) {
    if (ZERO.test(local)) continue
    const known = !ZERO.test(theirs) && (await git(['cat-file', '-e', `${theirs}^{commit}`], { allow: true })).code === 0
    const range = known ? [local, `^${theirs}`] : [local, '--not', ...tracked]
    for (const line of text(await git(['rev-list', '--parents', ...range])).split('\n').filter(Boolean)) {
      const [commit, ...parents] = line.split(' ')
      commits.set(commit, parents)
    }
  }
  return [...commits].map(([commit, parents]) => ({ commit, parents }))
}

// A finding's place: the commit when there is one, the path (JSON-quoted when it holds a control
// character) and the line.
function where(f) {
  const file = /[\u0000-\u001f\u007f]/.test(f.file) ? JSON.stringify(f.file) : f.file
  return `${f.commit ? `${f.commit} ` : ''}${file}${f.line ? `:${f.line}` : ''}`
}

async function secretsGate(ctx) {
  canary()
  const findings = []
  if (ctx.mode === 'push') {
    const commits = await outgoingCommits(ctx.push)
    for (const { commit, parents } of commits) {
      const pair = parents.length === 0 ? ['--root', commit] : [parents[0], commit]
      await scanEntries(parseRaw(await git(['diff-tree', '--no-commit-id', '-r', '-M', '--raw', '-z', ...pair])), commit.slice(0, 7), findings)
    }
  } else {
    const cached = ctx.mode === 'fast' ? ['--cached'] : []
    const base = await headOrEmptyTree()
    await scanEntries(parseRaw(await git(['diff-index', ...cached, '-r', '-M', '--raw', '-z', base])), '', findings)
    if (ctx.mode !== 'fast') {
      for (const file of splitZ(await git(['ls-files', '-z', '--others', '--exclude-standard']))) {
        if (file.endsWith('/')) continue
        if (secretFile(file)) findings.push({ commit: '', file, kind: 'secret file' })
        const lines = textLines(fromDisk(file, fs.lstatSync(file).isSymbolicLink() ? '120000' : '100644'))
        for (const { line, number } of addedLines([], lines)) {
          for (const hit of scanLine(line)) findings.push({ commit: '', file, line: number, ...hit })
        }
      }
    }
  }
  if (findings.length === 0) return { status: 'ok' }
  const lines = findings.map((f) =>
    f.kind === 'secret file' ? `secrets: ${where(f)} is a secret file` : `secrets: ${where(f)} ${f.kind}`,
  )
  return { status: 'fail', count: findings.length, first: findings[0], lines }
}

// ---- The token gate

const SOURCE_FILE = /\.(?:css|scss|sass|less|html|vue|svelte|astro|mdx|js|jsx|mjs|cjs|ts|tsx)$/i
const FOOTPRINT = /^(?:\.epikloop|spec|design|docs|\.githooks)\/|^scripts\/check\.sh$/
const NAMED = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue ' +
    'darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
    'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise ' +
    'darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia ' +
    'gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ' +
    'ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue ' +
    'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red ' +
    'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
    'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' '),
)
const WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])
const HEX = /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()/gi
const WHOLE_COLOR =
  /^\s*(?:#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()[^)]*\))\s*$/i
// Where a named colour is a colour: colour properties, the shorthands that carry one, and variables.
const COLOR_PROP =
  /^(?:--|\$|@)|color$|^(?:background|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|box-shadow|text-shadow|text-decoration|text-emphasis|column-rule|fill|stroke|scrollbar-color|-webkit-text-stroke)$/i
const SVG_COLOR = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color', 'bgcolor'])
const TW_COLOR =
  /(?<![\w-])!?(?:[\w-]+:)*!?-?(?:bg|text|border(?:-[xytrblse])?|outline|ring(?:-offset)?|divide|fill|stroke|from|via|to|decoration|accent|caret|shadow|placeholder|inset-shadow|drop-shadow)-\[([^\]\s]+)\]/g
const TW_FONT = /(?<![\w-])!?(?:[\w-]+:)*font-\[([^\]\s]+)\]/g
const TW_PROP =
  /\[((?:background-)?color|border(?:-[a-z]+)*-color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color|box-shadow|text-shadow|font-family):([^\]\s]+)\]/g
const WEIGHT = /^(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\d+)$/i

function glob(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      const slash = pattern[i + 2] === '/'
      re += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

async function tokensGate(ctx) {
  if (!fs.existsSync('design/tokens.css')) return { status: 'off' }
  const ignored = [ctx.config.gates.token_ignore ?? []].flat().map((entry) => glob(entry.path))
  const findings = []
  for (const file of new Set(splitZ(await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])))) {
    if (!SOURCE_FILE.test(file) || FOOTPRINT.test(file) || ignored.some((re) => re.test(file))) continue
    let source
    try {
      if (!fs.lstatSync(file).isFile()) continue
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const found of scanTokens(file, source)) findings.push({ file, ...found })
  }
  if (findings.length === 0) return { status: 'ok' }
  const lines = findings.map((f) => `tokens: ${where(f)} ${f.what}`)
  return { status: 'fail', count: findings.length, first: findings[0], lines }
}

function scanTokens(file, source) {
  const found = []
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  const add = (offset, what) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid] <= offset) low = mid
      else high = mid - 1
    }
    found.push({ line: low + 1, what })
  }
  const ext = path.extname(file).toLowerCase()
  if (ext === '.sass') sass(source, 0, add)
  else if (ext === '.css' || ext === '.scss' || ext === '.less') css(source, 0, add, ext !== '.css')
  else if (['.html', '.vue', '.svelte', '.astro', '.mdx'].includes(ext)) markup(source, ext, add)
  else js(source, 0, add)
  return found
}

// CSS: a declaration ends at `;` or `}`, and a run that ends at `{` is a selector, which is skipped.
function css(source, base, add, lineComments) {
  let clean = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  if (lineComments) clean = clean.replace(/(^|[\s;{}])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
  let start = 0
  for (let i = 0; i <= clean.length; i++) {
    const c = clean[i]
    if (i < clean.length && c !== ';' && c !== '{' && c !== '}') continue
    if (c !== '{') declaration(clean.slice(start, i), base + start, add)
    start = i + 1
  }
}

function declaration(chunk, offset, add) {
  const body = chunk.trimStart()
  const at = offset + chunk.length - body.length
  if (body.trim() === '') return
  if (/^@apply\b/.test(body)) return tailwind(body, at, add)
  const prop = /^([$@]?-{0,2}[\w-]+)\s*:/.exec(body)
  if (prop) values(prop[1].toLowerCase(), body.slice(prop[0].length), at + prop[0].length, add)
  else values('', body, at, add)
}

// Indented Sass: a declaration is `name: value`, with a space after the colon, which a selector
// such as a:hover lacks.
function sass(source, base, add) {
  let offset = 0
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)\/\/.*$/, '$1')
    const decl = /^\s*([$@]?-{0,2}[\w-]+)\s*:\s+(.*)$/.exec(line)
    if (decl) values(decl[1].toLowerCase(), decl[2], base + offset + line.length - decl[2].length, add)
    else if (/^\s*(?:\+|@include\b)/.test(line)) values('', line, base + offset, add)
    else if (/^\s*@apply\b/.test(line)) tailwind(line, base + offset, add)
    offset += raw.length + 1
  }
}

// A value: hex and functional colours anywhere; named colours where a colour belongs; font
// families under the font properties.
function values(prop, value, at, add) {
  for (const m of value.matchAll(HEX)) add(at + m.index, `colour ${m[0]}`)
  for (const m of value.matchAll(COLOR_FN)) add(at + m.index, `colour ${m[0].trimEnd()}`)
  if (COLOR_PROP.test(prop) || /gradient\(/i.test(value)) {
    const words = value
      .replace(/url\([^)]*\)/gi, (s) => ' '.repeat(s.length))
      .replace(/var\(\s*--[\w-]*/gi, (s) => ' '.repeat(s.length))
    for (const m of words.matchAll(/(?<![\w-])[a-z]+(?![\w-])/gi)) {
      if (NAMED.has(m[0].toLowerCase())) add(at + m.index, `colour ${m[0]}`)
    }
  }
  if (prop === 'font-family' || prop === 'font') font(value, at, add)
}

function font(value, at, add) {
  const plain = value.replace(/var\([^)]*\)/gi, '').replace(/!important/i, '').trim()
  if (plain.replace(/[\s,]/g, '') !== '' && !WIDE.has(plain.toLowerCase())) add(at, `font family ${plain.slice(0, 60)}`)
}

function colourish(raw) {
  const literal = raw.replace(/_/g, ' ').replace(/^color:/i, '')
  if (/^var\(/i.test(literal)) return false
  return (
    /(?<![&\w])#[0-9a-f]{3,8}(?![\w-])/i.test(literal) ||
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(literal) ||
    NAMED.has(literal.toLowerCase())
  )
}

// Tailwind arbitrary values: colour and font-family utilities, and arbitrary properties, with a
// bracketed literal. A var() inside, or v4's (--x), is a token.
function tailwind(value, at, add) {
  for (const m of value.matchAll(TW_COLOR)) if (colourish(m[1])) add(at + m.index, `Tailwind ${m[0]}`)
  for (const m of value.matchAll(TW_FONT)) {
    if (/[a-z]/i.test(m[1]) && !/^var\(/i.test(m[1]) && !WEIGHT.test(m[1])) add(at + m.index, `Tailwind ${m[0]}`)
  }
  for (const m of value.matchAll(TW_PROP)) {
    const literal = m[1] === 'font-family' ? !/^var\(/i.test(m[2]) : colourish(m[2])
    if (literal) add(at + m.index, `Tailwind ${m[0]}`)
  }
}

// Markup: <style> blocks as CSS, <script> blocks and Astro frontmatter as JS, then the attributes
// that carry colours: style, class lists, SVG colour attributes and JSX expressions.
function markup(source, ext, add) {
  let rest = source
  const blank = (from, to) => {
    rest = rest.slice(0, from) + rest.slice(from, to).replace(/[^\n]/g, ' ') + rest.slice(to)
  }
  for (const m of source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)) {
    const start = m.index + m[0].indexOf('>') + 1
    const lang = /\blang\s*=\s*["']?(scss|sass|less)/i.exec(m[1])?.[1].toLowerCase()
    if (lang === 'sass') sass(m[2], start, add)
    else css(m[2], start, add, lang !== undefined)
    blank(m.index, m.index + m[0].length)
  }
  for (const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    js(m[1], m.index + m[0].indexOf('>') + 1, add)
    blank(m.index, m.index + m[0].length)
  }
  const front = /^---\r?\n[\s\S]*?\r?\n---/.exec(source)
  if (front) {
    if (ext === '.astro') js(front[0].slice(3, -3), 3, add)
    blank(0, front[0].length)
  }
  const attribute = /([:@\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{)/g
  for (let m = attribute.exec(rest); m !== null; m = attribute.exec(rest)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3]
    if (value === undefined) {
      const open = m.index + m[0].length - 1
      const close = closing(rest, open)
      js(rest.slice(open + 1, close), open + 1, add)
      attribute.lastIndex = close + 1
      continue
    }
    const at = m.index + m[0].length - 1 - value.length
    if (name === 'style') css(value, at, add, false)
    else if (/^(?:class|classname|class:list)$/.test(name)) tailwind(value, at, add)
    else if (/^(?::|v-bind:)(?:style|class)$/.test(name)) js(value, at, add)
    else if (name.startsWith('style:')) values(name.slice(6), value, at, add)
    else if (SVG_COLOR.has(name)) values('color', value, at, add)
  }
}

function closing(source, open) {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && --depth === 0) return i
  }
  return source.length
}

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

// JS and TS: each string and template literal is read for Tailwind classes, for a literal that is a
// colour, for a colour or font under a style key or attribute, and for CSS declarations.
function js(source, base, add) {
  for (const s of literals(source)) {
    const at = base + s.start
    tailwind(s.value, at, add)
    if (WHOLE_COLOR.test(s.value)) {
      add(at, `colour ${s.value.trim()}`)
      continue
    }
    const before = source.slice(Math.max(0, s.quote - 80), s.quote)
    const key = /(?:([A-Za-z_$][\w$-]*)|'([^'\n]*)'|"([^"\n]*)")\s*(?::|=\{?)\s*\{?\s*$/.exec(before)
    const name = key ? kebab(key[1] ?? key[2] ?? key[3]) : ''
    if (name !== '' && (COLOR_PROP.test(name) || SVG_COLOR.has(name))) values('color', s.value, at, add)
    else if (name === 'font-family' || name === 'font') font(s.value, at, add)
    else if (/[\w-]\s*:\s*\S/.test(s.value) && /[;\n]/.test(s.value)) css(s.value, at, add, false)
  }
}

// The string and template literals of a script, with their offsets. Comments are skipped, a quoted
// string ends at its line, and the `${…}` holes of a template are lexed as code.
function literals(source) {
  const found = []
  const holes = []
  let depth = 0
  let last = ''
  let i = 0
  const template = (from) => {
    let j = from
    while (j < source.length && source[j] !== '`' && !(source[j] === '$' && source[j + 1] === '{')) {
      j += source[j] === '\\' ? 2 : 1
    }
    found.push({ quote: from - 1, start: from, value: source.slice(from, j) })
    if (source[j] !== '$') return j + 1
    holes.push(depth)
    return j + 2
  }
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end < 0 ? source.length : end
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 2
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      if (source[j] === c) found.push({ quote: i, start: i + 1, value: source.slice(i + 1, j) })
      i = j + 1
      last = c
    } else if (c === '`') {
      i = template(i + 1)
      last = '`'
    } else if (c === '}' && holes.length > 0 && holes[holes.length - 1] === depth) {
      holes.pop()
      i = template(i + 1)
      last = '`'
    } else if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(last || '(')) {
      let j = i + 1
      let inClass = false
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j += 1
        else if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        j += 1
      }
      i = j + 1
      last = '/'
    } else {
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      if (!/\s/.test(c)) last = c
      i += 1
    }
  }
  return found
}

// ---- Shims, workflows and stack commands

async function shimsGate() {
  const modes = new Map()
  for (const entry of splitZ(await git(['ls-files', '-s', '-z', '--', ...SHIMS]))) {
    modes.set(entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[0])
  }
  const lines = []
  for (const file of SHIMS) {
    const mode = modes.get(file)
    if (mode === undefined) lines.push(`shims: ${file} is not tracked`)
    else if (mode !== '100755') lines.push(`shims: ${file} is ${mode}, not 100755: git add --chmod=+x ${file}`)
  }
  return lines.length > 0 ? { status: 'fail', count: lines.length, lines } : { status: 'ok' }
}

// Solo mode runs no workflow it hasn't listed. GitHub runs a workflow file as soon as a push carries
// it, so the work tree and every pushed tip are both read.
async function workflowsGate(ctx) {
  if (ctx.config.mode !== 'solo') return { status: 'off' }
  const allowed = new Set(ctx.config.gates.allow_workflows ?? [])
  const dir = '.github/workflows'
  const unlisted = new Set()
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (/\.ya?ml$/.test(name) && fs.statSync(path.join(dir, name)).isFile() && !allowed.has(name)) unlisted.add(name)
    }
  }
  for (const tip of pushedTips(ctx)) {
    const listed = await git(['ls-tree', '-z', `${tip}:${dir}`], { allow: true })
    if (listed.code !== 0) continue
    for (const entry of splitZ(listed)) {
      const name = entry.slice(entry.indexOf('\t') + 1)
      if (entry.split(' ')[1] === 'blob' && /\.ya?ml$/.test(name) && !allowed.has(name)) unlisted.add(name)
    }
  }
  if (unlisted.size === 0) return { status: 'ok' }
  const lines = [...unlisted].map((name) => `workflows: ${dir}/${name} is not in gates.allow_workflows (solo mode)`)
  return { status: 'fail', count: lines.length, lines, first: { file: `${dir}/${[...unlisted][0]}` } }
}

// Commands for blank gates, from the first stack found. One command per gate, never a fallback
// chain, and none that installs anything.
function detect() {
  const exists = (file) => fs.existsSync(file)
  if (exists('package.json')) {
    let pkg = {}
    try {
      pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    } catch {}
    const scripts = pkg.scripts ?? {}
    const pm = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : exists('bun.lock') || exists('bun.lockb') ? 'bun' : 'npm'
    const script = (name) => (scripts[name] ? `${pm} run ${name}` : undefined)
    const typescript = exists('tsconfig.json') && (pkg.dependencies?.typescript || pkg.devDependencies?.typescript)
    return {
      lint: script('lint'),
      typecheck: script('typecheck') ?? script('type-check') ?? (typescript ? 'node node_modules/typescript/bin/tsc --noEmit' : undefined),
      test: scripts.test && !/no test specified/.test(scripts.test) ? `${pm} run test` : undefined,
      build: script('build'),
      e2e: script('test:e2e') ?? script('e2e'),
    }
  }
  if (exists('pyproject.toml') || exists('setup.py') || exists('requirements.txt')) {
    const pyproject = exists('pyproject.toml') ? fs.readFileSync('pyproject.toml', 'utf8') : ''
    const has = (table) => new RegExp(`^\\[${table.replace(/\./g, '\\.')}(?:\\.|\\])`, 'm').test(pyproject)
    const via = exists('uv.lock') ? 'uv run --no-sync ' : exists('poetry.lock') ? 'poetry run ' : exists('pdm.lock') ? 'pdm run ' : ''
    const mypy = has('tool.mypy') || exists('mypy.ini') || exists('.mypy.ini')
    const pyright = has('tool.pyright') || exists('pyrightconfig.json')
    return {
      lint: has('tool.ruff') || exists('ruff.toml') || exists('.ruff.toml') ? `${via}ruff check .` : undefined,
      typecheck: mypy ? `${via}mypy .` : pyright ? `${via}pyright` : undefined,
      test: has('tool.pytest.ini_options') || exists('pytest.ini') ? `${via}pytest` : undefined,
    }
  }
  if (exists('go.mod')) {
    const golangci = ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'].some(exists)
    return { lint: golangci ? 'golangci-lint run' : 'go vet ./...', test: 'go test ./...', build: 'go build ./...' }
  }
  if (exists('Cargo.toml')) {
    return {
      lint: 'cargo clippy --all-targets --offline',
      typecheck: 'cargo check --all-targets --offline',
      test: 'cargo test --offline',
      build: 'cargo build --offline',
    }
  }
  return {}
}

function resolveCommands(config) {
  const set = config.gates.commands ?? {}
  const found = detect()
  const pick = (name) => (set[name] ? { command: set[name], auto: false } : found[name] ? { command: found[name], auto: true } : null)
  return Object.fromEntries(COMMAND_GATES.map((name) => [name, pick(name)]))
}

// One stack command, capped, run the way npm runs scripts. It gets the environment a person would
// have, without the repository variables git sets for a hook, and an auto-detected command can't
// fetch. A failure shows the last 40 lines, redacted, and the full log stays in git's own directory.
async function commandGate(name, spec) {
  if (spec === null) return { status: 'none' }
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^GIT_(?:DIR|INDEX_FILE|WORK_TREE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/i.test(key)) delete env[key]
  }
  if (spec.auto) Object.assign(env, { COREPACK_ENABLE_NETWORK: '0', UV_OFFLINE: '1', GOPROXY: 'off', RUSTUP_AUTO_INSTALL: '0' })
  const r = await run(spec.command, [], { env, timeout: CAP, shell: true })
  if (!r.error && !r.timedOut && r.code === 0) return { status: 'ok' }
  const output = redact(r.all.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))
  const log = await saveLog(name, output)
  const cap = CAP >= 60_000 ? `${CAP / 60_000} min` : `${CAP / 1000} s`
  const why = r.timedOut
    ? `timed out after ${cap}`
    : r.error
      ? `couldn't start: ${r.error.message}`
      : r.code !== null
        ? `exited ${r.code}`
        : `was stopped by ${r.signal}`
  const tail = output.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-40)
  return { status: 'fail', lines: [`${name}: ${spec.command} ${why}`, ...tail.map((line) => `  ${line}`), ...(log ? [`  full log: ${log}`] : [])] }
}

async function saveLog(name, output) {
  try {
    const dir = await gitPath('check-logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${name}.log`)
    fs.writeFileSync(file, output)
    return path.relative(process.cwd(), file).split(path.sep).join('/')
  } catch {
    return null
  }
}

// ---- The stamp and redaction

// The ignored .env and .dev.vars files. Tests can read them, so the stamp covers them, and their
// values are redacted from everything printed.
async function ignoredEnvFiles() {
  const listed = splitZ(await git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']))
  return listed.filter((file) => !file.endsWith('/') && /^\.(?:env|dev\.vars)(?:\..+)?$/.test(file.slice(file.lastIndexOf('/') + 1)))
}

function envValues(files) {
  const found = new Set()
  for (const file of files) {
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split(/\r?\n/)) {
      const value = /^\s*(?:export\s+)?[\w.-]+\s*=\s*(.*)$/.exec(line)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2')
      if (value && value.length >= 8) found.add(value)
    }
  }
  return [...found]
}

// The key a green run stamps: the tree of the working state, tracked plus untracked files that
// aren't ignored, built in a throwaway index, and a hash of the ignored env files, this runner and
// the Node version. Null when it can't be built; the stamp is only a shortcut.
async function stampKey(envFiles) {
  try {
    const scratch = await gitPath('check-index')
    const index = await gitPath('index')
    if (fs.existsSync(index)) {
      fs.copyFileSync(index, scratch)
      // git tells a racily clean entry by the index file's own mtime, so the copy keeps it; a newer
      // one would let a same-size rewrite in that second pass as unchanged.
      const { atime, mtime } = fs.statSync(index)
      fs.utimesSync(scratch, atime, mtime)
    }
    const env = { ...process.env, GIT_INDEX_FILE: scratch }
    try {
      await git(['add', '-A'], { env })
      const tree = text(await git(['write-tree'], { env }))
      const hash = crypto.createHash('sha256')
      for (const file of envFiles) hash.update(`${file}\0`).update(fs.readFileSync(file)).update('\0')
      hash.update(fs.readFileSync(import.meta.filename)).update(`\0${process.version}`)
      return { tree, rest: hash.digest('hex') }
    } finally {
      fs.rmSync(scratch, { force: true })
    }
  } catch {
    return null
  }
}

async function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(await gitPath('check-stamp.json'), 'utf8'))
  } catch {
    return null
  }
}

async function writeStamp(key) {
  try {
    fs.writeFileSync(await gitPath('check-stamp.json'), `${JSON.stringify({ format: 1, ...key })}\n`)
  } catch {}
}

// At push, test and build are skipped only when every pushed tip's tree is the tree a green run
// stamped, with the same ignored env files, runner and Node.
async function stampMatches(ctx) {
  const tips = pushedTips(ctx)
  if (tips.length === 0) return 'nothing pushed'
  const stamp = await readStamp()
  if (stamp === null || ctx.before === null || stamp.rest !== ctx.before.rest) return null
  for (const tip of tips) if (text(await git(['rev-parse', `${tip}^{tree}`])) !== stamp.tree) return null
  return 'stamp'
}

const REDACTIONS = [...KEYS.map((key) => new RegExp(key.re.source, 'g')), new RegExp(DB_URL.source, 'gi')]
let secretValues = []

// Everything printed or logged: the key formats, every URL's userinfo and the values of the ignored
// env files become [redacted].
function redact(text) {
  let out = text
  for (const re of REDACTIONS) out = out.replace(re, '[redacted]')
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/@]+@/gi, '$1[redacted]@')
  for (const value of secretValues) out = out.split(value).join('[redacted]')
  return out
}

// ---- Hooks and events

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function owner(script) {
  if (/pre-commit\.com|generated by pre-commit/i.test(script)) return 'pre-commit'
  if (/git[ -]lfs/i.test(script)) return 'git-lfs'
  for (const tool of ['husky', 'lefthook', 'overcommit']) if (script.toLowerCase().includes(tool)) return tool
  return 'another tool'
}

// Whether the hooks run: core.hooksPath set to .githooks, or why not. On Linux and macOS it also
// lists the shims without the executable bit, since git skips such a hook.
async function hooksState(top) {
  const unrunnable = POSIX ? SHIMS.filter((file) => fs.existsSync(file) && !executable(file)) : []
  const set = await git(['config', '--show-scope', '--get-all', 'core.hooksPath'], { allow: true })
  const values = set.code === 0 ? text(set).split('\n').filter(Boolean) : []
  if (values.length > 0) {
    const [scope, value] = values[values.length - 1].split('\t')
    const ours = ['.githooks', './.githooks', '.githooks/', './.githooks/'].includes(value) || path.resolve(top, value) === path.resolve(top, '.githooks')
    if (ours) return { armed: true, unrunnable }
    return { armed: false, unrunnable, note: `core.hooksPath is ${value} (${/husky/i.test(value) ? 'husky, ' : ''}${scope})` }
  }
  const dir = await gitPath('hooks')
  const foreign = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => !name.endsWith('.sample') && fs.statSync(path.join(dir, name)).isFile())
    : []
  if (foreign.length > 0) {
    const owners = [...new Set(foreign.map((name) => owner(fs.readFileSync(path.join(dir, name), 'latin1'))))]
    const shown = path.relative(top, dir).split(path.sep).join('/')
    return { armed: false, unrunnable, note: `${shown} has ${foreign.join(', ')} (${owners.join(', ')}); arming would switch them off` }
  }
  return { armed: false, unrunnable, unset: true, note: 'run node .githooks/check.mjs --arm' }
}

// The install step's entry. It never fails an install, prints at most one line, and changes
// nothing that another tool owns.
async function arm() {
  process.exitCode = 0
  try {
    if (process.env.CI) return
    const inside = await git(['rev-parse', '--show-toplevel'], { allow: true })
    if (inside.code !== 0) return
    const top = text(inside)
    process.chdir(top)
    const state = await hooksState(top)
    if (state.unset) await git(['config', '--local', 'core.hooksPath', '.githooks'])
    const fixed = state.unset || state.armed ? state.unrunnable : []
    for (const file of fixed) fs.chmodSync(file, 0o755)
    if (state.unset) console.log('git hooks: armed (.githooks)')
    else if (!state.armed) console.log(`git hooks: not armed — ${state.note}`)
    else if (fixed.length > 0) console.log(`git hooks: made ${fixed.join(', ')} executable`)
  } catch (error) {
    console.log(`git hooks: not armed — ${error.message}`)
  }
}

async function hooksNote(top) {
  if (process.env.CI) return null
  try {
    const state = await hooksState(top)
    if (!state.armed) return `git hooks: not armed — ${state.note}`
    if (state.unrunnable.length > 0) return `git hooks: ${state.unrunnable.join(', ')} not executable — run node .githooks/check.mjs --arm`
  } catch {}
  return null
}

// One gate.passed or gate.failed line per gate that ran, written the way the emitter writes its
// own, so fold() and Harbor read both. Only where ~/.epikloop exists; a failed write fails nothing.
function writeEvents(ctx, results) {
  try {
    const root = path.join(os.homedir(), '.epikloop')
    if (!fs.existsSync(root) || !/^[0-9a-f]{12}$/.test(ctx.config?.id ?? '')) return
    const run8 = crypto.randomBytes(4).toString('hex')
    let seq = 0
    for (const r of results) {
      if (r.status === 'none' || r.status === 'off') continue
      const ms = Date.now()
      const ts = new Date(ms).toISOString()
      const detail = { mode: ctx.mode, ms: Math.round(r.ms ?? 0) }
      if (r.skipped) detail.skipped = r.skipped
      if (r.first?.file) detail.file = r.first.file.slice(0, 512)
      if (r.first?.line) detail.line = r.first.line
      const event = {
        format: 1,
        ts,
        project_id: ctx.config.id,
        cwd: ctx.top,
        session_id: process.env.CLAUDE_CODE_SESSION_ID || 'none',
        kind: r.status === 'fail' ? 'gate.failed' : 'gate.passed',
        state: r.name,
        detail,
      }
      const day = path.join(root, 'events', ts.slice(0, 10))
      fs.mkdirSync(day, { recursive: true })
      seq += 1
      fs.writeFileSync(path.join(day, `${ms}-${run8}-${seq}.json`), `${JSON.stringify(event)}\n`, { flag: 'wx' })
    }
  } catch {}
}

// ---- A run

async function gate(name, body) {
  const started = performance.now()
  try {
    return { name, ...(await body()), ms: performance.now() - started }
  } catch (error) {
    return { name, status: 'fail', lines: [`${name}: ${error.message}`], ms: performance.now() - started }
  }
}

function shown(r) {
  if (r.status === 'fail') return r.count ? `FAIL ${r.count}` : 'FAIL'
  if (r.status === 'skipped') return `skipped (${r.skipped})`
  return r.status
}

const USAGE = 'usage: scripts/check.sh [--fast | --push <remote> <url> | --deep | --self-test | --arm]'

async function main(argv) {
  if (Number(process.versions.node.split('.')[0]) < 22) return console.log(`check: needs Node 22 or later, not ${process.version}`)
  const [flag, ...rest] = argv
  if (flag === '--self-test' && rest.length === 0) return selfTest()
  if (flag === '--arm' && rest.length === 0) return arm()
  const mode = flag === undefined ? 'full' : { '--fast': 'fast', '--push': 'push', '--deep': 'deep' }[flag]
  if (mode === undefined || rest.length > (mode === 'push' ? 2 : 0)) return console.log(USAGE)
  const started = performance.now()
  const top = text(await git(['rev-parse', '--show-toplevel']))
  process.chdir(top)
  const ctx = { mode, top, config: null, push: null, before: null, stamped: null }
  let results = null
  try {
    ctx.config = readConfig()
  } catch (error) {
    results = [{ name: 'config', status: 'fail', lines: error.message.split('\n').map((line) => `config: ${line}`) }]
  }
  const envFiles = await ignoredEnvFiles().catch(() => [])
  secretValues = envValues(envFiles)
  if (results === null) {
    if (mode === 'push') ctx.push = await readPush(rest[0], rest[1])
    if (mode !== 'fast') ctx.before = await stampKey(envFiles)
    if (mode === 'push') ctx.stamped = await stampMatches(ctx)
    results = []
    results.push(await gate('shims', () => shimsGate()))
    results.push(await gate('workflows', () => workflowsGate(ctx)))
    results.push(await gate('secrets', () => secretsGate(ctx)))
    results.push(await gate('tokens', () => tokensGate(ctx)))
    const commands = resolveCommands(ctx.config)
    const names = ['lint', 'typecheck', ...(mode === 'fast' ? [] : ['test', 'build']), ...(mode === 'deep' ? ['e2e'] : [])]
    for (const name of names) {
      if (ctx.stamped !== null && (name === 'test' || name === 'build')) results.push({ name, status: 'skipped', skipped: ctx.stamped })
      else results.push(await gate(name, () => commandGate(name, commands[name])))
    }
  }
  const green = results.every((r) => r.status !== 'fail')
  if (green && ctx.before !== null) {
    const after = await stampKey(envFiles)
    if (after !== null && after.tree === ctx.before.tree && after.rest === ctx.before.rest) await writeStamp(after)
  }
  for (const r of results) for (const line of r.lines ?? []) console.log(redact(line))
  const label = mode === 'full' ? 'check' : `check --${mode}`
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(redact(`${label}: ${green ? 'PASS' : 'FAIL'} · ${results.map((r) => `${r.name} ${shown(r)}`).join(' · ')} · ${seconds} s`))
  const note = await hooksNote(top)
  if (note !== null) console.log(note)
  writeEvents(ctx, results)
  if (green) process.exitCode = 0
}

// The self-test. Everything below runs only for --self-test, and its mutations rewrite only the text
// above this line.

const ZEROS = '0'.repeat(40)
const REPORTED = /^check(?: --\w+)?: (?:PASS|FAIL) · /m

async function selfTest() {
  const started = performance.now()
  const source = fs.readFileSync(import.meta.filename, 'utf8')
  const cut = source.indexOf('\n// The self-test.')
  const here = import.meta.dirname
  const shims = {
    '.githooks/pre-commit': fs.readFileSync(path.join(here, 'pre-commit'), 'utf8'),
    '.githooks/pre-push': fs.readFileSync(path.join(here, 'pre-push'), 'utf8'),
    'scripts/check.sh': fs.readFileSync(path.join(here, '..', 'scripts', 'check.sh'), 'utf8'),
  }
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'check-')))
  const outcomes = []
  let caught = 0
  try {
    const k = kit(temp, source, shims)
    const cases = [
      ...[...secretCases(k), ...localeCases(k)].map(([name, test]) => [name, () => test(source)]),
      ...[...hookCases(k), ...tokenCases(k), ...gateCases(k), ...armCases(k), ...eventCases(k)],
    ]
    outcomes.push(...(await pool(cases.map(([name, test]) => async () => [name, await attempt(test)]))))
    const names = new Set(secretCases(k).map(([name]) => name))
    const checks = mutations().map(([name, edits, own]) => async () => {
      const [mutated, problem] = mutate(source, cut, edits)
      if (problem || !names.has(own)) return [`mutation: ${name}`, problem ?? `its case doesn't exist: ${own}`]
      const outcome = await catches(k, mutated, own)
      if (outcome === true) caught += 1
      return [`mutation: ${name}`, outcome]
    })
    outcomes.push(...(await pool(checks)))
  } finally {
    try {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 })
    } catch {}
  }
  const failures = outcomes.filter(([, outcome]) => outcome !== true)
  for (const [name, outcome] of failures) console.log(`FAIL ${name}: ${outcome}`)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`check self-test: ${outcomes.length - failures.length}/${outcomes.length} as expected; ${caught} mutations caught; ${seconds} s`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

async function attempt(test) {
  try {
    return await test()
  } catch (error) {
    return `threw: ${error.message}`
  }
}

// Runs tasks a few at a time, keeping their order. Every case has its own folders.
async function pool(tasks) {
  const results = new Array(tasks.length)
  let next = 0
  const lanes = Math.max(2, Math.min(8, os.availableParallelism()))
  const lane = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(lanes, tasks.length) }, lane))
  return results
}

// Applies a mutation's edits to the text above the self-test. Each must match exactly once.
function mutate(source, cut, edits) {
  let head = source.slice(0, cut)
  for (const [find, replace] of edits) {
    const count = head.split(find).length - 1
    if (count !== 1) return [null, `the text to mutate appears ${count} times: ${find}`]
    head = head.replace(find, () => replace)
  }
  return [head + source.slice(cut), null]
}

// A mutation is caught only when its own case fails on what the mutated runner reported: the case
// returns a failure, and every run in it printed the runner's summary line. A case that throws is a
// harness error, which fails the self-test like a mutation that survives.
async function catches(k, mutated, own) {
  const reports = []
  const watch = (run) => async (...args) => {
    const res = await run(...args)
    reports.push(res)
    return res
  }
  const [, test] = secretCases({ ...k, check: watch(k.check), push: watch(k.push) }).find(([name]) => name === own)
  let outcome
  try {
    outcome = await test(mutated)
  } catch (error) {
    return `harness error: ${error.message}`
  }
  if (outcome === true) return 'its case still passes'
  const silent = reports.find((res) => !REPORTED.test(res.out))
  if (reports.length === 0 || silent !== undefined) return `the mutated runner didn't report: ${k.brief(silent?.out ?? '')}`
  return true
}

// What every case needs: repos built once per setup and copied, git and the runner run with a
// scrubbed environment, and the checks a case returns.
function kit(temp, source, shims) {
  const home = path.join(temp, 'home')
  fs.mkdirSync(home)
  // No background maintenance, so nothing changes a template repo while it is being copied.
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[maintenance]\n\tauto = false\n')
  const base = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:GIT_.*|CI|CLAUDE_CODE_SESSION_ID|CHECK_TIMEOUT_MS|HOME|USERPROFILE)$/i.test(key)) base[key] = value
  }
  Object.assign(base, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CEILING_DIRECTORIES: temp,
    HOME: home,
    USERPROFILE: home,
  })
  const exec = async (file, args, { cwd, env = {}, input } = {}) => {
    const r = await run(file, args, { cwd, env: { ...base, ...env }, input, timeout: 120_000 })
    return { code: r.error || r.timedOut ? -1 : r.code, out: r.all.toString('utf8'), stdout: r.stdout.toString('utf8') }
  }
  const g = async (cwd, ...args) => {
    const r = await exec('git', args, { cwd })
    if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.out.trim()}`)
    return r.stdout.trim()
  }
  const write = (dir, file, content) => {
    const target = path.join(dir, ...file.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  const COMMANDS = Object.fromEntries(COMMAND_GATES.map((name) => [name, `node gates/cmd.mjs ${name}`]))
  const CMD = [
    "import { spawn } from 'node:child_process'",
    "import fs from 'node:fs'",
    'const name = process.argv[2]',
    'const file = (suffix) => `${process.env.SELFTEST_STATE}/${name}.${suffix}`',
    "const read = (suffix) => (fs.existsSync(file(suffix)) ? fs.readFileSync(file(suffix), 'utf8') : '')",
    "fs.appendFileSync(file('count'), 'x')",
    "process.stdout.write(read('print') || `${name} ran\\n`)",
    "if (read('hang')) {",
    "  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit', detached: true })",
    '  setTimeout(() => {}, 60000)',
    "} else process.exitCode = Number(read('exit') || 0)",
    '',
  ].join('\n')
  const templates = new Map()
  let count = 0
  async function build(options, id) {
    const root = path.join(temp, `t${id}`)
    const work = path.join(root, 'work')
    fs.mkdirSync(work, { recursive: true })
    await g(root, 'init', '-q', '--bare', 'remote.git')
    await g(path.join(root, 'remote.git'), 'symbolic-ref', 'HEAD', 'refs/heads/main')
    await g(work, 'init', '-q')
    await g(work, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    const settings = [
      ['user.name', 'Self Test'],
      ['user.email', 'self-test@example.invalid'],
      ['core.autocrlf', 'false'],
      ['remote.origin.url', '../remote.git'],
      ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
    ]
    for (const [key, value] of settings) await g(work, 'config', key, value)
    write(work, '.githooks/check.mjs', options.src)
    for (const [file, content] of Object.entries(shims)) {
      write(work, file, content)
      if (POSIX) fs.chmodSync(path.join(work, file), 0o755)
    }
    const gates = { ...(options.commands ? { commands: COMMANDS } : {}), ...options.gates }
    write(work, '.epikloop/project.json', `${JSON.stringify({ format: 1, id: 'abcdef012345', lane: 'web', mode: options.mode, gates }, null, 2)}\n`)
    write(work, 'gates/cmd.mjs', CMD)
    write(work, '.gitignore', '.env\n.env.test\n')
    if (options.tokens) write(work, 'design/tokens.css', ':root { --brand: #0055ff; }\n')
    if (options.commit) {
      await g(work, 'add', '-A')
      await g(work, 'update-index', '--chmod=+x', ...SHIMS)
      await g(work, 'commit', '-q', '-m', 'initial')
    }
    return root
  }
  async function makeRepo({ src = source, mode = 'solo', gates = {}, commands = false, tokens = false, commit = true } = {}) {
    const options = { src, mode, gates, commands, tokens, commit }
    const key = crypto.createHash('sha256').update(JSON.stringify({ ...options, src: '' })).update(src).digest('hex')
    if (!templates.has(key)) templates.set(key, build(options, templates.size + 1))
    const template = await templates.get(key)
    const root = path.join(temp, `c${++count}`)
    fs.cpSync(template, root, { recursive: true })
    fs.mkdirSync(path.join(root, 'state'))
    return { root, dir: path.join(root, 'work'), remote: path.join(root, 'remote.git'), state: path.join(root, 'state') }
  }
  const check = async (r, args, { input, env = {}, cwd = r.dir } = {}) => {
    const started = performance.now()
    const res = await exec(process.execPath, [path.join(r.dir, '.githooks', 'check.mjs'), ...args], {
      cwd,
      input,
      env: { SELFTEST_STATE: r.state, ...env },
    })
    return { ...res, ms: performance.now() - started }
  }
  const brief = (out) => out.trim().split('\n').slice(-3).join(' / ').slice(0, 400)
  return {
    temp,
    exec,
    g,
    write,
    makeRepo,
    check,
    brief,
    gitIn: (r, ...args) => exec('git', args, { cwd: r.dir, env: { SELFTEST_STATE: r.state } }),
    push: (r, input, args = ['--push', 'origin', '../remote.git']) => check(r, args, { input }),
    blob: async (dir, content) => (await exec('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: content })).stdout.trim(),
    stage: (dir, mode, id, file) => g(dir, 'update-index', '--add', '--cacheinfo', `${mode},${id},${file}`),
    commitIndex: async (dir, message) => {
      const head = await exec('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: dir })
      const parents = head.code === 0 ? ['-p', head.stdout.trim()] : []
      const commit = await g(dir, 'commit-tree', await g(dir, 'write-tree'), ...parents, '-m', message)
      await g(dir, 'update-ref', 'HEAD', commit)
      return commit
    },
    refLine: (localRef, local, remoteRef = localRef, remote = ZEROS) => `${localRef} ${local} ${remoteRef} ${remote}\n`,
    setState: (r, name, suffix, value) => fs.writeFileSync(path.join(r.state, `${name}.${suffix}`), value),
    runs: (r, name) => {
      try {
        return fs.readFileSync(path.join(r.state, `${name}.count`), 'utf8').length
      } catch {
        return 0
      }
    },
    sample: (kind) => KEYS.find((key) => key.kind === kind).sample(),
    blocked: (res, ...texts) =>
      (res.code > 0 && texts.every((t) => res.out.includes(t))) ||
      `expected a block showing ${texts.map((t) => JSON.stringify(t)).join(', ')}; got exit ${res.code}: ${brief(res.out)}`,
    passes: (res) => res.code === 0 || `expected a pass; got exit ${res.code}: ${brief(res.out)}`,
    hides: (res, ...secrets) => secrets.every((s) => !res.out.includes(s)) || 'a value was printed',
    every: (...outcomes) => outcomes.find((o) => o !== true) ?? true,
  }
}

const sourceLine = (value) => `export const value = '${value}'\n`

function secretFileCase(k, name, target, { viaIndex = false, env } = {}) {
  return [
    name,
    async (src) => {
      const r = await k.makeRepo({ src })
      if (viaIndex) {
        // Git for Windows refuses such a path unless told otherwise; a clone can still receive one.
        await k.g(r.dir, 'config', 'core.protectNTFS', 'false')
        await k.stage(r.dir, '100644', await k.blob(r.dir, 'A=1\n'), target)
      } else {
        k.write(r.dir, target, 'A=1\n')
        await k.g(r.dir, 'add', '-f', '--', target)
      }
      const listed = /[\u0000-\u001f]/.test(target) ? JSON.stringify(target) : target
      return k.blocked(await k.check(r, ['--fast'], { env }), `${listed} is a secret file`)
    },
  ]
}

// The secret scan's cases. The mutation check runs them against each mutated copy of this file, so
// each takes the runner's text.
function secretCases(k) {
  const { makeRepo, check, push, write, g, blob, stage, commitIndex, refLine, sample, blocked, passes, hides, every } = k
  const keyCase = (key, i) => [
    `${key.kind} (format ${i + 1}) is blocked`,
    async (src) => {
      const r = await makeRepo({ src })
      const value = key.sample()
      write(r.dir, `src/k${i}.ts`, sourceLine(value))
      await g(r.dir, 'add', '-A')
      const res = await check(r, ['--fast'])
      return every(blocked(res, `src/k${i}.ts:1 ${key.kind}`), hides(res, value))
    },
  ]
  const urlCase = (name, url) => [
    name,
    async (src) => {
      const r = await makeRepo({ src })
      write(r.dir, 'db.ts', sourceLine(url))
      await g(r.dir, 'add', '-A')
      const res = await check(r, ['--fast'])
      return every(blocked(res, 'db.ts:1 database URL with a password'), hides(res, url))
    },
  ]
  const staged = async (src, files) => {
    const r = await makeRepo({ src })
    for (const [file, content] of Object.entries(files)) write(r.dir, file, content)
    await g(r.dir, 'add', '-A')
    return r
  }
  const keyCommit = async (r, kind, file = 'k.ts') => {
    write(r.dir, file, sourceLine(sample(kind)))
    await g(r.dir, 'add', file)
    return commitIndex(r.dir, 'add a key')
  }
  return [
    secretFileCase(k, 'a nested .env is a secret file', 'apps/web/.env'),
    secretFileCase(k, 'a root .env.local is a secret file', '.env.local'),
    secretFileCase(k, 'a nested .dev.vars is a secret file', 'workers/api/.dev.vars'),
    secretFileCase(k, 'anything under a nested secrets/ is a secret file', 'packages/db/secrets/key.json'),
    secretFileCase(k, 'a secret file under a path with é', 'clé/.env'),
    secretFileCase(k, 'a secret file under a path with a space', 'my app/.env'),
    secretFileCase(k, 'a secret file under a path holding a quote', 'a"b/.env', { viaIndex: true }),
    secretFileCase(k, 'a secret file under a path holding a newline', 'a\nb/.env', { viaIndex: true }),
    [
      'git mv into secrets/ is blocked',
      async (src) => {
        const r = await staged(src, { 'notes.txt': 'hello\n' })
        await commitIndex(r.dir, 'notes')
        fs.mkdirSync(path.join(r.dir, 'secrets'))
        await g(r.dir, 'mv', 'notes.txt', 'secrets/notes.txt')
        return blocked(await check(r, ['--fast']), 'secrets/notes.txt is a secret file')
      },
    ],
    [
      'a rename-only commit still runs every gate',
      async (src) => {
        const r = await makeRepo({ src, commands: true })
        write(r.dir, 'a.txt', 'x\n')
        await g(r.dir, 'add', 'a.txt')
        await commitIndex(r.dir, 'a')
        await g(r.dir, 'mv', 'a.txt', 'b.txt')
        k.setState(r, 'lint', 'exit', '1')
        return blocked(await check(r, ['--fast']), 'lint FAIL')
      },
    ],
    [
      'a type change that brings a key is blocked',
      async (src) => {
        const r = await makeRepo({ src })
        await stage(r.dir, '120000', await blob(r.dir, 'target'), 'link')
        await commitIndex(r.dir, 'link')
        const value = sample('GitHub token')
        await stage(r.dir, '100644', await blob(r.dir, sourceLine(value)), 'link')
        const res = await check(r, ['--fast'])
        return every(blocked(res, 'link:1 GitHub token'), hides(res, value))
      },
    ],
    [
      'a harmless type change passes',
      async (src) => {
        const r = await makeRepo({ src })
        await stage(r.dir, '120000', await blob(r.dir, 'target'), 'link')
        await commitIndex(r.dir, 'link')
        await stage(r.dir, '100644', await blob(r.dir, 'just text\n'), 'link')
        return passes(await check(r, ['--fast']))
      },
    ],
    ...KEYS.map(keyCase),
    urlCase(
      'a Neon-shaped database URL is blocked',
      `${'postgresql'}://neondb_owner:npg_Ab12Cd34Ef56@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require`,
    ),
    urlCase('a database URL with a driver is blocked', `${'postgresql'}+asyncpg://app:Ab12Cd34@db.internal.example.com/app`),
    urlCase('a database URL with an IPv6 host is blocked', `${'postgres'}://app:Ab12Cd34@[2001:db8::5]:5432/app`),
    urlCase('a database URL whose password holds $ is blocked', `${'mysql'}://root:S3cr$tPass@10.0.0.5/app`),
    [
      'git config and attributes cannot blind the scan',
      async (src) => {
        const r = await makeRepo({ src })
        const config = [
          ['color.ui', 'always'],
          ['diff.external', 'cat'],
          ['diff.noprefix', 'true'],
          ['diff.mnemonicPrefix', 'true'],
          ['diff.hide.textconv', 'node -e 0'],
          ['core.quotePath', 'false'],
        ]
        for (const [key, value] of config) await g(r.dir, 'config', key, value)
        const [a, b] = [sample('AWS access key id'), sample('GitHub token')]
        write(r.dir, '.gitattributes', '*.txt diff=hide\n*.cfg -diff\n')
        write(r.dir, 'a.txt', sourceLine(a))
        write(r.dir, 'b.cfg', sourceLine(b))
        await g(r.dir, 'add', '-A')
        const res = await check(r, ['--fast'])
        return every(blocked(res, 'a.txt:1 AWS access key id', 'b.cfg:1 GitHub token'), hides(res, a, b))
      },
    ],
    [
      'a key after a NUL byte is blocked',
      async (src) => {
        const value = sample('private key')
        const r = await staged(src, { 'data.bin': Buffer.concat([Buffer.from('a'.repeat(9000)), Buffer.from([0]), Buffer.from(value)]) })
        const res = await check(r, ['--fast'])
        return every(blocked(res, 'data.bin:1 private key'), hides(res, value))
      },
    ],
    [
      'a key in a UTF-16 file is blocked',
      async (src) => {
        const value = sample('Slack token')
        const r = await staged(src, { 'notes.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`token = ${value}\r\n`, 'utf16le')]) })
        const res = await check(r, ['--fast'])
        return every(blocked(res, 'notes.txt:1 Slack token'), hides(res, value))
      },
    ],
    [
      'a staged blob missing from the object store fails as unreadable',
      async (src) => {
        const r = await staged(src, { 'gone.txt': 'soon gone\n' })
        const id = await g(r.dir, 'rev-parse', ':gone.txt')
        const object = path.join(r.dir, '.git', 'objects', id.slice(0, 2), id.slice(2))
        fs.chmodSync(object, 0o666)
        fs.rmSync(object)
        return blocked(await check(r, ['--fast']), "couldn't read")
      },
    ],
    [
      'an untracked secret file is found from a subdirectory',
      async (src) => {
        const r = await staged(src, { 'sub/keep.txt': 'x\n' })
        await commitIndex(r.dir, 'sub')
        write(r.dir, '.env.production', 'A=1\n')
        return blocked(await check(r, [], { cwd: path.join(r.dir, 'sub') }), '.env.production is a secret file')
      },
    ],
    [
      'a key only in the work tree is blocked by the full run',
      async (src) => {
        const r = await staged(src, { 'a.ts': 'x\n' })
        await commitIndex(r.dir, 'a')
        const value = sample('npm token')
        write(r.dir, 'a.ts', `x\n${sourceLine(value)}`)
        const res = await check(r, [])
        return every(blocked(res, 'a.ts:2 npm token'), hides(res, value))
      },
    ],
    [
      'a key staged in a linked worktree is blocked',
      async (src) => {
        const r = await makeRepo({ src })
        const wt = path.join(r.root, 'wt')
        await g(r.dir, 'worktree', 'add', '-q', '-b', 'side', wt)
        const value = sample('Google API key')
        write(wt, 'w.ts', sourceLine(value))
        await g(wt, 'add', 'w.ts')
        const res = await check({ ...r, dir: wt }, ['--fast'])
        return every(blocked(res, 'w.ts:1 Google API key'), hides(res, value))
      },
    ],
    [
      'a key added then removed is blocked at push, even after a stamp',
      async (src) => {
        const r = await makeRepo({ src })
        await keyCommit(r, 'AWS access key id')
        fs.rmSync(path.join(r.dir, 'k.ts'))
        await g(r.dir, 'add', '-A')
        const tip = await commitIndex(r.dir, 'remove it')
        const full = await check(r, [])
        if (full.code !== 0) return `the full run failed: ${k.brief(full.out)}`
        const res = await push(r, refLine('refs/heads/main', tip))
        return every(blocked(res, 'k.ts:1 AWS access key id'), hides(res, sample('AWS access key id')))
      },
    ],
    [
      'a new branch carrying a force-added .env is blocked at push',
      async (src) => {
        const r = await makeRepo({ src })
        write(r.dir, '.env', 'A=1\n')
        await g(r.dir, 'add', '-f', '.env')
        const tip = await commitIndex(r.dir, 'env')
        return blocked(await push(r, refLine('refs/heads/feat', tip)), '.env is a secret file')
      },
    ],
    [
      'a root commit holding a key is blocked at push, with log.showRoot=false',
      async (src) => {
        const r = await makeRepo({ src, commit: false })
        await g(r.dir, 'config', 'log.showRoot', 'false')
        write(r.dir, 'k.ts', sourceLine(sample('Stripe live key')))
        await g(r.dir, 'add', '-A')
        await g(r.dir, 'update-index', '--chmod=+x', ...SHIMS)
        const tip = await commitIndex(r.dir, 'root')
        const res = await push(r, refLine('refs/heads/main', tip))
        return every(blocked(res, 'k.ts:1 Stripe live key'), hides(res, sample('Stripe live key')))
      },
    ],
    [
      'a merge whose resolution adds a key is blocked at push',
      async (src) => {
        const r = await makeRepo({ src })
        const base = await g(r.dir, 'rev-parse', 'HEAD')
        write(r.dir, 'a.txt', 'a\n')
        await g(r.dir, 'add', 'a.txt')
        const x = await g(r.dir, 'commit-tree', await g(r.dir, 'write-tree'), '-p', base, '-m', 'x')
        await g(r.dir, 'rm', '-q', '--cached', 'a.txt')
        write(r.dir, 'b.txt', 'b\n')
        await g(r.dir, 'add', 'b.txt')
        const y = await g(r.dir, 'commit-tree', await g(r.dir, 'write-tree'), '-p', base, '-m', 'y')
        const value = sample('Anthropic key')
        write(r.dir, 'evil.txt', sourceLine(value))
        await g(r.dir, 'add', 'a.txt', 'evil.txt')
        const merge = await g(r.dir, 'commit-tree', await g(r.dir, 'write-tree'), '-p', y, '-p', x, '-m', 'merge')
        await g(r.dir, 'update-ref', 'refs/remotes/origin/main', y)
        const res = await push(r, refLine('refs/heads/main', merge, 'refs/heads/main', y))
        return every(blocked(res, 'evil.txt:1 Anthropic key'), hides(res, value))
      },
    ],
    [
      'a push to a URL that no remote names is blocked',
      async (src) => {
        const r = await makeRepo({ src })
        const tip = await keyCommit(r, 'npm token')
        await g(r.root, 'init', '-q', '--bare', 'other.git')
        const other = path.join(r.root, 'other.git')
        const res = await check(r, ['--push', other, other], { input: refLine('refs/heads/main', tip) })
        return every(blocked(res, 'k.ts:1 npm token'), hides(res, sample('npm token')))
      },
    ],
    [
      'a tag push is scanned',
      async (src) => {
        const r = await makeRepo({ src })
        const commit = await keyCommit(r, 'Slack token')
        await g(r.dir, 'tag', '-a', 'v1', '-m', 'v1', commit)
        const tag = await g(r.dir, 'rev-parse', 'refs/tags/v1')
        const res = await push(r, refLine('refs/tags/v1', tag))
        return every(blocked(res, 'k.ts:1 Slack token'), hides(res, sample('Slack token')))
      },
    ],
    [
      '.env.example holding a localhost URL passes',
      async (src) => passes(await check(await staged(src, { '.env.example': `DATABASE_URL=${'postgres'}://postgres:postgres@localhost:5432/dev\n` }), ['--fast'])),
    ],
    [
      'the documented stand-ins pass',
      async (src) => {
        const files = ['apps/api/.env.example', '.dev.vars.example', 'packages/db/secrets/README.md']
        return passes(await check(await staged(src, Object.fromEntries(files.map((file) => [file, 'A=placeholder\n']))), ['--fast']))
      },
    ],
    [
      'local and placeholder database URLs pass',
      async (src) => {
        const urls = [
          `${'postgres'}://app:\${POSTGRES_PASSWORD}@db:5432/app`,
          `${'redis'}://:Ab12Cd34Ef@host.docker.internal:6379`,
          `${'postgres'}://user:<password>@ep-x-123.us-east-2.aws.neon.tech/db`,
          `${'mongodb'}://root:Ab12Cd34@mongo:27017`,
        ]
        return passes(await check(await staged(src, { 'docker.ts': `${urls.join('\n')}\n` }), ['--fast']))
      },
    ],
    [
      'kebab-case class names and npm config pass',
      async (src) => {
        const files = { 'a.css': '.risk-admin-settings-panel-wrapper { display: block; }\n', '.npmrc': 'npm_config_registry=https://registry.npmjs.org/\n' }
        return passes(await check(await staged(src, files), ['--fast']))
      },
    ],
    ['an empty commit passes', async (src) => passes(await check(await makeRepo({ src }), ['--fast']))],
    [
      'the first commit on an unborn branch passes',
      async (src) => {
        const r = await makeRepo({ src, commit: false })
        await g(r.dir, 'add', '-A')
        await g(r.dir, 'update-index', '--chmod=+x', ...SHIMS)
        return passes(await check(r, ['--fast']))
      },
    ],
    [
      'an up-to-date push passes',
      async (src) => {
        const r = await makeRepo({ src })
        const head = await g(r.dir, 'rev-parse', 'HEAD')
        await g(r.dir, 'update-ref', 'refs/remotes/origin/main', head)
        return passes(await push(r, refLine('refs/heads/main', head, 'refs/heads/main', head)))
      },
    ],
    ['a push with no ref lines passes', async (src) => passes(await push(await makeRepo({ src }), ''))],
    [
      'deleting a branch passes',
      async (src) => {
        const r = await makeRepo({ src })
        const head = await g(r.dir, 'rev-parse', 'HEAD')
        return passes(await push(r, refLine('(delete)', ZEROS, 'refs/heads/old', head)))
      },
    ],
    [
      'removing a key that was already pushed passes',
      async (src) => {
        const r = await makeRepo({ src })
        write(r.dir, 'k.ts', `${sourceLine(sample('GitHub token'))}export const other = 1\n`)
        await g(r.dir, 'add', 'k.ts')
        const pushed = await commitIndex(r.dir, 'add a key')
        await g(r.dir, 'update-ref', 'refs/remotes/origin/main', pushed)
        write(r.dir, 'k.ts', 'export const other = 1\n')
        await g(r.dir, 'add', 'k.ts')
        const tip = await commitIndex(r.dir, 'remove the key')
        return passes(await push(r, refLine('refs/heads/main', tip, 'refs/heads/main', pushed)))
      },
    ],
    [
      'command output is redacted',
      async (src) => {
        const r = await makeRepo({ src, commands: true })
        const key = sample('GitHub token')
        const password = 'Hunter2222'
        const fromEnv = 'Pa55-from-the-env-file'
        write(r.dir, '.env', `API_TOKEN=${fromEnv}\n`)
        k.setState(r, 'lint', 'print', `${key}\nhttps://deploy:${password}@example.com/x\n${fromEnv}\n`)
        k.setState(r, 'lint', 'exit', '1')
        const res = await check(r, ['--fast'])
        const log = fs.readFileSync(path.join(r.dir, '.git', 'check-logs', 'lint.log'), 'utf8')
        const logClean = [key, password, fromEnv].every((s) => !log.includes(s)) || 'the log holds a value'
        return every(blocked(res, 'lint FAIL', '[redacted]'), hides(res, key, password, fromEnv), logClean)
      },
    ],
  ]
}

function localeCases(k) {
  const cases = []
  for (const locale of ['C', 'en_US.UTF-8']) {
    for (const [label, target, viaIndex] of [
      ['é', 'clé/.env', false],
      ['a space', 'my app/.env', false],
      ['a quote', 'a"b/.env', true],
      ['a newline', 'a\nb/.env', true],
    ]) {
      cases.push(secretFileCase(k, `under LC_ALL=${locale}, a secret file under a path with ${label}`, target, { viaIndex, env: { LC_ALL: locale } }))
    }
  }
  return cases
}

// Real commits and pushes through the shims, which is what confirms the hook form on each OS.
function hookCases(k) {
  const { makeRepo, check, write, g, gitIn, commitIndex, sample, blocked, passes, hides, every } = k
  const armed = async (options) => {
    const r = await makeRepo(options)
    const res = await check(r, ['--arm'])
    if (res.code !== 0 || !res.out.includes('armed')) throw new Error(`--arm said: ${k.brief(res.out)}`)
    return r
  }
  const head = (r) => g(r.dir, 'rev-parse', 'HEAD')
  const cases = [
    [
      'the runner commits itself through its own hooks',
      async () => {
        const r = await makeRepo({ commit: false })
        const res = await check(r, ['--arm'])
        await g(r.dir, 'add', '-A')
        await g(r.dir, 'update-index', '--chmod=+x', ...SHIMS)
        return every(res.out.includes('git hooks: armed') || `--arm said: ${k.brief(res.out)}`, passes(await gitIn(r, 'commit', '-q', '-m', 'scaffold')))
      },
    ],
    [
      'pre-commit blocks a commit that carries a key',
      async () => {
        const r = await armed()
        const before = await head(r)
        const value = sample('GitHub token')
        write(r.dir, 'k.ts', sourceLine(value))
        await g(r.dir, 'add', 'k.ts')
        const res = await gitIn(r, 'commit', '-q', '-m', 'key')
        return every(blocked(res, 'k.ts:1 GitHub token'), hides(res, value), (await head(r)) === before || 'the commit was made')
      },
    ],
    [
      'pre-commit blocks commit -a that carries a key',
      async () => {
        const r = await armed()
        write(r.dir, 'a.ts', 'x\n')
        await g(r.dir, 'add', 'a.ts')
        await commitIndex(r.dir, 'a')
        const value = sample('npm token')
        write(r.dir, 'a.ts', `x\n${sourceLine(value)}`)
        const res = await gitIn(r, 'commit', '-q', '-a', '-m', 'key')
        return every(blocked(res, 'a.ts:2 npm token'), hides(res, value))
      },
    ],
    [
      'pre-commit blocks commit -- <path> that carries a key',
      async () => {
        const r = await armed()
        write(r.dir, 'a.ts', 'x\n')
        await g(r.dir, 'add', 'a.ts')
        await commitIndex(r.dir, 'a')
        const value = sample('Google API key')
        write(r.dir, 'a.ts', `x\n${sourceLine(value)}`)
        const res = await gitIn(r, 'commit', '-q', '-m', 'key', '--', 'a.ts')
        return every(blocked(res, 'a.ts:2 Google API key'), hides(res, value))
      },
    ],
    [
      'pre-commit passes a clean commit',
      async () => {
        const r = await armed()
        write(r.dir, 'readme.txt', 'hello\n')
        await g(r.dir, 'add', 'readme.txt')
        return passes(await gitIn(r, 'commit', '-q', '-m', 'readme'))
      },
    ],
    [
      'pre-push blocks a push that carries a key',
      async () => {
        const r = await armed()
        write(r.dir, 'k.ts', sourceLine(sample('AWS access key id')))
        await g(r.dir, 'add', 'k.ts')
        await commitIndex(r.dir, 'key')
        const res = await gitIn(r, 'push', '-q', 'origin', 'main')
        const remote = await k.exec('git', ['rev-parse', '--verify', '-q', 'refs/heads/main'], { cwd: r.remote })
        return every(blocked(res, 'k.ts:1 AWS access key id'), hides(res, sample('AWS access key id')), remote.code !== 0 || 'the remote took the push')
      },
    ],
    [
      'pre-push passes a clean push',
      async () => {
        const r = await armed()
        const res = await gitIn(r, 'push', '-q', 'origin', 'main')
        const remote = await k.exec('git', ['rev-parse', '--verify', '-q', 'refs/heads/main'], { cwd: r.remote })
        return every(passes(res), remote.code === 0 || 'the remote has no main')
      },
    ],
    [
      'a stamp skips test and build at push',
      async () => {
        const r = await armed({ commands: true })
        const full = await check(r, [])
        const res = await gitIn(r, 'push', '-q', 'origin', 'main')
        const skipped = res.out.includes('test skipped (stamp)') || `no skip: ${k.brief(res.out)}`
        return every(passes(full), passes(res), skipped, k.runs(r, 'test') === 1 || `test ran ${k.runs(r, 'test')} times`)
      },
    ],
    [
      'a runner that never settles still blocks the commit',
      async () => {
        const r = await armed()
        const before = await head(r)
        write(r.dir, '.githooks/check.mjs', 'await new Promise(() => {})\n')
        const res = await gitIn(r, 'commit', '-q', '--allow-empty', '-m', 'empty')
        return every(res.code > 0 || `the commit went through: ${k.brief(res.out)}`, (await head(r)) === before || 'the commit was made')
      },
    ],
  ]
  if (POSIX) {
    cases.push([
      'git skips a hook without the executable bit, the note says so, and --arm restores it',
      async () => {
        const r = await armed()
        fs.chmodSync(path.join(r.dir, '.githooks', 'pre-commit'), 0o644)
        write(r.dir, 'k.ts', sourceLine(sample('GitHub token')))
        await g(r.dir, 'add', 'k.ts')
        const skipped = await gitIn(r, 'commit', '-q', '-m', 'key')
        const noted = (await check(r, [])).out.includes('.githooks/pre-commit not executable') || 'no note'
        await check(r, ['--arm'])
        write(r.dir, 'k2.ts', sourceLine(sample('npm token')))
        await g(r.dir, 'add', 'k2.ts')
        return every(passes(skipped), noted, blocked(await gitIn(r, 'commit', '-q', '-m', 'key2'), 'k2.ts:1 npm token'))
      },
    ])
    cases.push([
      'scripts/check.sh runs the runner',
      async () => {
        const r = await armed()
        return blocked(await k.exec('sh', ['scripts/check.sh', '--fats'], { cwd: r.dir }), 'usage')
      },
    ])
  } else {
    cases.push([
      'CRLF hooks still run',
      async () => {
        const r = await armed()
        for (const file of ['.githooks/pre-commit', '.githooks/pre-push']) {
          write(r.dir, file, fs.readFileSync(path.join(r.dir, file), 'utf8').replace(/\n/g, '\r\n'))
        }
        const value = sample('JWT')
        write(r.dir, 'k.ts', sourceLine(value))
        await g(r.dir, 'add', 'k.ts')
        const res = await gitIn(r, 'commit', '-q', '-m', 'key')
        return every(blocked(res, 'k.ts:1 JWT'), hides(res, value))
      },
    ])
  }
  return cases
}

function tokenCases(k) {
  const { makeRepo, check, write, blocked, passes } = k
  const flagged = [
    ['a.css', '.a { color: #ff0000; }\n', 'colour #ff0000'],
    ['a.scss', '.a { background: rgb(1, 2, 3); }\n', 'colour rgb('],
    ['a.less', '.a { border-color: hsl(10, 20%, 30%); }\n', 'colour hsl('],
    ['a.sass', '.a\n  color: red\n', 'colour red'],
    ['b.scss', '$brand: tomato;\n', 'colour tomato'],
    ['b.css', ':root { --brand: rebeccapurple; }\n', 'colour rebeccapurple'],
    ['c.css', '.a { background-image: linear-gradient(red, blue); }\n', 'colour red'],
    ['d.css', '.a { border: 1px solid red; }\n', 'colour red'],
    ['e.css', '.a { font-family: Inter, sans-serif; }\n', 'font family Inter'],
    ['f.css', '.a { font: 12px/1.5 Georgia; }\n', 'font family'],
    ['a.tsx', "export const s = { fontFamily: 'Inter' }\n", 'font family Inter'],
    ['a.jsx', "export const A = () => <div style={{ color: '#f00' }} />\n", 'colour #f00'],
    ['a.mjs', "export const brand = '#ff6600'\n", 'colour #ff6600'],
    ['a.cjs', "module.exports = { c: 'rgba(0, 0, 0, 0.5)' }\n", 'colour rgba(0, 0, 0, 0.5)'],
    ['a.ts', 'export const c = "hsl(200 50% 50%)"\n', 'colour hsl(200 50% 50%)'],
    ['a.astro', '---\nconst x = 1\n---\n<div class="p-2 bg-[#ff0000]"></div>\n', 'Tailwind bg-[#ff0000]'],
    ['a.vue', '<template><p class="text-[rgb(1,2,3)]">x</p></template>\n', 'Tailwind text-[rgb(1,2,3)]'],
    ['a.svelte', '<div class="[color:#fff]"></div>\n', 'Tailwind [color:#fff]'],
    ['a.mdx', `<div className="font-['Inter']">x</div>\n`, "Tailwind font-['Inter']"],
    ['a.html', '<svg><path fill="#000000" /></svg>\n', 'colour #000000'],
    ['b.vue', '<template><svg><path fill="red" /></svg></template>\n', 'colour red'],
    ['c.vue', '<template><p class="a">x</p></template>\n<style scoped>\n.a { color: navy; }\n</style>\n', 'colour navy'],
    ['b.html', '<p style="color: #123456">x</p>\n', 'colour #123456'],
    ['b.ts', 'export const B = styled.div`\n  color: #333;\n`\n', 'colour #333'],
    ['c.tsx', "export const A = () => <path fill=\"red\" className=\"hover:text-[#0f0]\" />\n", 'Tailwind hover:text-[#0f0]'],
  ]
  return [
    ...flagged.map(([file, content, what]) => [
      `the token gate flags ${file}: ${what}`,
      async () => {
        const r = await makeRepo({ tokens: true })
        write(r.dir, file, content)
        return blocked(await check(r, ['--fast']), `tokens: ${file}:`, what)
      },
    ]),
    [
      'the token gate passes tokens, held spacing, a private field, a comment, a fragment link, a variant and an ignored path',
      async () => {
        const r = await makeRepo({ tokens: true, gates: { token_ignore: [{ path: 'legacy/**', reason: 'replaced in epic 4' }] } })
        write(r.dir, 'ok.css', '.a { color: var(--x); background: hsl(var(--y)); padding: 13px; margin: 0 8px; }\n')
        write(r.dir, 'ok.ts', "class A { #abc = 1 }\n// see #123\nexport const v = { variant: 'red' }\n")
        write(r.dir, 'ok.html', '<a href="#top">top</a>\n')
        write(r.dir, 'ok.tsx', 'export const A = () => <div className="p-[13px] bg-(--brand) text-[14px]" />\n')
        write(r.dir, 'legacy/old.css', '.a { color: red; }\n')
        return passes(await check(r, ['--fast']))
      },
    ],
    [
      'a token_ignore entry without its reason fails as config',
      async () => {
        const r = await makeRepo({ tokens: true, gates: { token_ignore: [{ path: 'legacy/**', reason: ' ' }] } })
        return blocked(await check(r, ['--fast']), 'gates.token_ignore[0] needs a path and its reason')
      },
    ],
    [
      'the token gate is off without design/tokens.css',
      async () => {
        const r = await makeRepo()
        write(r.dir, 'a.css', '.a { color: red; }\n')
        const res = await check(r, ['--fast'])
        return k.every(passes(res), res.out.includes('tokens off') || 'no "tokens off"')
      },
    ],
  ]
}

function gateCases(k) {
  const { makeRepo, check, push, write, g, commitIndex, refLine, setState, runs, blocked, passes, every } = k
  const repoWith = async (options, files = {}) => {
    const r = await makeRepo(options)
    for (const [file, content] of Object.entries(files)) write(r.dir, file, content)
    return r
  }
  return [
    [
      'a failing lint fails --fast and shows its output',
      async () => {
        const r = await makeRepo({ commands: true })
        setState(r, 'lint', 'exit', '1')
        return blocked(await check(r, ['--fast']), 'lint: node gates/cmd.mjs lint exited 1', 'lint ran', 'lint FAIL')
      },
    ],
    [
      'a failing test fails the full run',
      async () => {
        const r = await makeRepo({ commands: true })
        setState(r, 'test', 'exit', '1')
        return blocked(await check(r, []), 'test FAIL')
      },
    ],
    [
      '--fast runs neither test nor build',
      async () => {
        const r = await makeRepo({ commands: true })
        const res = await check(r, ['--fast'])
        return every(passes(res), runs(r, 'test') + runs(r, 'build') === 0 || 'test or build ran')
      },
    ],
    [
      'e2e runs only in --deep',
      async () => {
        const r = await makeRepo({ commands: true })
        const full = await check(r, [])
        const afterFull = runs(r, 'e2e')
        const deep = await check(r, ['--deep'])
        return every(passes(full), passes(deep), (afterFull === 0 && runs(r, 'e2e') === 1) || `e2e ran ${afterFull} then ${runs(r, 'e2e')} times`)
      },
    ],
    [
      'a command that hangs is stopped at the cap, grandchild and all',
      async () => {
        const r = await makeRepo({ commands: true })
        setState(r, 'test', 'hang', '1')
        const res = await check(r, [], { env: { CHECK_TIMEOUT_MS: '1500' } })
        return every(blocked(res, 'test: node gates/cmd.mjs test timed out after 1.5 s'), res.ms < 15_000 || `it took ${Math.round(res.ms)} ms`)
      },
    ],
    [
      'a stamp is not used for a pushed tip that lacks the stamped fix',
      async () => {
        const r = await repoWith({ commands: true }, { 'a.ts': 'v1\n' })
        await g(r.dir, 'add', 'a.ts')
        const tip = await commitIndex(r.dir, 'v1')
        write(r.dir, 'a.ts', 'v2\n')
        const full = await check(r, [])
        const res = await push(r, refLine('refs/heads/main', tip))
        return every(passes(full), passes(res), runs(r, 'test') === 2 || `test ran ${runs(r, 'test')} times`)
      },
    ],
    [
      'a stamp sees a same-size rewrite in the second the index was written',
      async () => {
        const r = await repoWith({ commands: true }, { 'a.ts': 'v1\n' })
        // git compares only whole-second mtimes and sizes, as on a filesystem without trusted
        // ctimes. One whole second, a minute back, then serves the file and the index alike: the
        // entry is racily clean, as when a file is rewritten in the second its index was written,
        // and a copy of the index that didn't keep its mtime would be newer. Linux and macOS
        // copies don't keep it; Windows copies do.
        await g(r.dir, 'config', 'core.trustCtime', 'false')
        await g(r.dir, 'config', 'core.checkStat', 'minimal')
        const second = Math.floor(Date.now() / 1000) - 60
        const file = path.join(r.dir, 'a.ts')
        fs.utimesSync(file, second, second)
        await g(r.dir, 'add', 'a.ts')
        const tip = await commitIndex(r.dir, 'v1')
        fs.utimesSync(path.join(r.dir, '.git', 'index'), second, second)
        write(r.dir, 'a.ts', 'v2\n')
        fs.utimesSync(file, second, second)
        const full = await check(r, [])
        const res = await push(r, refLine('refs/heads/main', tip))
        return every(passes(full), passes(res), runs(r, 'test') === 2 || `test ran ${runs(r, 'test')} times`)
      },
    ],
    [
      'a stamp is not used after an ignored env file changes',
      async () => {
        const r = await repoWith({ commands: true }, { '.env.test': 'A=one\n' })
        const tip = await g(r.dir, 'rev-parse', 'HEAD')
        const full = await check(r, [])
        write(r.dir, '.env.test', 'A=two\n')
        const res = await push(r, refLine('refs/heads/main', tip))
        return every(passes(full), passes(res), runs(r, 'test') === 2 || `test ran ${runs(r, 'test')} times`)
      },
    ],
    [
      'an unlisted workflow fails in solo mode',
      async () =>
        blocked(await check(await repoWith({}, { '.github/workflows/ci.yml': 'on: push\n' }), ['--fast']), 'workflows: .github/workflows/ci.yml is not in gates.allow_workflows'),
    ],
    [
      'a listed workflow passes in solo mode',
      async () => passes(await check(await repoWith({ gates: { allow_workflows: ['ci.yml'] } }, { '.github/workflows/ci.yml': 'on: push\n' }), ['--fast'])),
    ],
    ['team mode leaves workflows alone', async () => passes(await check(await repoWith({ mode: 'team' }, { '.github/workflows/ci.yml': 'on: push\n' }), ['--fast']))],
    [
      'a pushed tip that carries an unlisted workflow is blocked',
      async () => {
        const r = await repoWith({}, { '.github/workflows/deploy.yml': 'on: push\n' })
        await g(r.dir, 'add', '-A')
        const tip = await commitIndex(r.dir, 'workflow')
        fs.rmSync(path.join(r.dir, '.github'), { recursive: true })
        return blocked(await push(r, refLine('refs/heads/main', tip)), 'workflows: .github/workflows/deploy.yml')
      },
    ],
    [
      'a shim tracked without the executable bit fails the shims law',
      async () => {
        const r = await makeRepo()
        await g(r.dir, 'update-index', '--chmod=-x', '.githooks/pre-commit')
        return blocked(await check(r, []), 'shims: .githooks/pre-commit is 100644, not 100755: git add --chmod=+x .githooks/pre-commit')
      },
    ],
    ['a stray gates.ratchet fails as config', async () => blocked(await check(await makeRepo({ gates: { ratchet: { lint: 3 } } }), ['--fast']), 'gates.ratchet is not a gate setting')],
    ['an unknown argument fails', async () => blocked(await check(await makeRepo(), ['--fats']), 'usage')],
  ]
}

function armCases(k) {
  const { makeRepo, check, exec, write, every } = k
  const hooksPath = async (r) => (await exec('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: r.dir })).stdout.trim()
  const cases = [
    [
      '--arm sets core.hooksPath when nothing owns it',
      async () => {
        const r = await makeRepo()
        const res = await check(r, ['--arm'])
        return every(res.code === 0 || `exit ${res.code}`, (await hooksPath(r)) === '.githooks' || 'not set', res.out.includes('git hooks: armed') || k.brief(res.out))
      },
    ],
    [
      '--arm is silent once armed',
      async () => {
        const r = await makeRepo()
        await check(r, ['--arm'])
        const res = await check(r, ['--arm'])
        return every(res.code === 0 || `exit ${res.code}`, res.out.trim() === '' || `it said: ${k.brief(res.out)}`)
      },
    ],
    [
      "--arm leaves husky's core.hooksPath alone and names it",
      async () => {
        const r = await makeRepo()
        await k.g(r.dir, 'config', 'core.hooksPath', '.husky/_')
        const res = await check(r, ['--arm'])
        return every(res.code === 0 || `exit ${res.code}`, res.out.includes('core.hooksPath is .husky/_ (husky, local)') || k.brief(res.out), (await hooksPath(r)) === '.husky/_' || 'changed')
      },
    ],
    [
      '--arm leaves a global core.hooksPath alone and names it',
      async () => {
        const r = await makeRepo()
        const globalFile = path.join(r.root, 'global')
        fs.writeFileSync(globalFile, '[core]\n\thooksPath = ~/.githooks\n')
        const res = await check(r, ['--arm'], { env: { GIT_CONFIG_GLOBAL: globalFile } })
        return every(res.out.includes('core.hooksPath is ~/.githooks (global)') || k.brief(res.out), (await hooksPath(r)) === '' || 'set locally')
      },
    ],
    [
      '--arm leaves git-lfs hooks alone and names them',
      async () => {
        const r = await makeRepo()
        write(r.dir, '.git/hooks/pre-push', '#!/bin/sh\ngit lfs pre-push "$@"\n')
        const res = await check(r, ['--arm'])
        return every(res.out.includes('has pre-push (git-lfs)') || k.brief(res.out), (await hooksPath(r)) === '' || 'set')
      },
    ],
    [
      '--arm does nothing outside a git work tree',
      async () => {
        const plain = path.join(k.temp, 'plain')
        fs.mkdirSync(plain, { recursive: true })
        const res = await exec(process.execPath, [import.meta.filename, '--arm'], { cwd: plain })
        return every(res.code === 0 || `exit ${res.code}`, res.out.trim() === '' || `it said: ${k.brief(res.out)}`)
      },
    ],
    [
      '--arm does nothing in CI',
      async () => {
        const r = await makeRepo()
        const res = await check(r, ['--arm'], { env: { CI: 'true' } })
        return every(res.code === 0 || `exit ${res.code}`, (await hooksPath(r)) === '' || 'set')
      },
    ],
    ['an unarmed repo gets the note', async () => (await check(await makeRepo(), ['--fast'])).out.includes('git hooks: not armed') || 'no note'],
  ]
  if (POSIX) {
    cases.push([
      '--arm restores the executable bit',
      async () => {
        const r = await makeRepo()
        const hook = path.join(r.dir, '.githooks', 'pre-push')
        fs.chmodSync(hook, 0o644)
        await check(r, ['--arm'])
        return executable(hook) || 'still not executable'
      },
    ])
  }
  return cases
}

function eventCases(k) {
  const { makeRepo, check, passes, every } = k
  return [
    [
      "gate events are written in the emitter's format where ~/.epikloop exists",
      async () => {
        const r = await makeRepo()
        const home = path.join(r.root, 'home')
        fs.mkdirSync(path.join(home, '.epikloop'), { recursive: true })
        const res = await check(r, ['--fast'], { env: { HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: 'session-self-test' } })
        const events = path.join(home, '.epikloop', 'events')
        const files = fs.existsSync(events) ? fs.readdirSync(events).flatMap((day) => fs.readdirSync(path.join(events, day)).map((name) => [day, name])) : []
        const problems = []
        for (const [day, name] of files) {
          const e = JSON.parse(fs.readFileSync(path.join(events, day, name), 'utf8'))
          if (!/^\d+-[0-9a-f]{8}-\d+\.json$/.test(name)) problems.push(`name ${name}`)
          if (e.format !== 1 || e.ts.slice(0, 10) !== day || e.project_id !== 'abcdef012345') problems.push('format, ts or project_id')
          if (e.session_id !== 'session-self-test' || !['gate.passed', 'gate.failed'].includes(e.kind)) problems.push('session_id or kind')
          if (!/^[a-z][a-z0-9-]*$/.test(e.state) || typeof e.cwd !== 'string' || e.cwd === '') problems.push('state or cwd')
          const detail = Object.values(e.detail ?? {})
          if (detail.length > 16 || detail.some((v) => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'string' && v.length > 512))) problems.push('detail')
        }
        return every(passes(res), files.length === 3 || `${files.length} events`, problems.length === 0 || problems.join(', '))
      },
    ],
    [
      'no events are written where ~/.epikloop is missing',
      async () => {
        const r = await makeRepo()
        const home = path.join(r.root, 'home')
        fs.mkdirSync(home)
        await check(r, ['--fast'], { env: { HOME: home, USERPROFILE: home } })
        return !fs.existsSync(path.join(home, '.epikloop')) || 'events were written'
      },
    ],
  ]
}

function mutations() {
  return [
    ...KEYS.map((key, i) => [`the ${key.kind} pattern (format ${i + 1}) matches nothing`, [[`/${key.re.source}/`, '/(?!)/']], 'a nested .env is a secret file']),
    ['the database URL pattern matches nothing', [[`/${DB_URL.source}/${DB_URL.flags}`, '/(?!)/g']], 'a nested .env is a secret file'],
    ['secret-file names off', [['function secretFile(file) {', 'function secretFile(file) {\n  return false']], 'a nested .env is a secret file'],
    ['nested paths off', [["const parts = file.split('/')", "const parts = file.includes('/') ? [] : [file]"]], 'a nested .env is a secret file'],
    ['removed lines counted', [['function addedLines(oldLines, newLines) {', 'function addedLines(newLines, oldLines) {']], 'removing a key that was already pushed passes'],
    [
      'renames and type changes skipped',
      [["entries.filter((e) => e.letter !== 'D')", "entries.filter((e) => e.letter === 'A' || e.letter === 'M')"]],
      'git mv into secrets/ is blocked',
    ],
    [
      'outgoing commits unread',
      [['const commits = await outgoingCommits(ctx.push)', 'const commits = [] ?? (await outgoingCommits(ctx.push))']],
      'a new branch carrying a force-added .env is blocked at push',
    ],
    ['root commits skipped', [["['--root', commit]", '[commit]']], 'a root commit holding a key is blocked at push, with log.showRoot=false'],
    ['binaries skipped', [["text = buffer.toString('latin1')", "text = ''"]], 'a key after a NUL byte is blocked'],
    ['paths split on spaces', [['const take = () => tokens[i++]', "const take = () => tokens[i++]?.split(' ')[0]"]], 'a secret file under a path with a space'],
    [
      'the value printed',
      [
        ['`secrets: ${where(f)} ${f.kind}`', '`secrets: ${where(f)} ${f.kind} ${f.value}`'],
        ['function redact(text) {', 'function redact(text) {\n  return text'],
      ],
      'AWS access key id (format 2) is blocked',
    ],
    ['redaction off', [['function redact(text) {', 'function redact(text) {\n  return text']], 'command output is redacted'],
    [
      'the stamp skipping the scan',
      [["await gate('secrets', () => secretsGate(ctx))", "(ctx.stamped !== null ? { name: 'secrets', status: 'ok' } : await gate('secrets', () => secretsGate(ctx)))"]],
      'a key added then removed is blocked at push, even after a stamp',
    ],
    ['the read check removed', [['function unreadable(what) {', 'function unreadable(what) {\n  return']], 'a staged blob missing from the object store fails as unreadable'],
    [
      'the canary off, with a broken pattern',
      [
        ['function canary() {', 'function canary() {\n  return'],
        [`/${KEYS[1].re.source}/`, '/(?!)/'],
      ],
      'AWS access key id (format 2) is blocked',
    ],
  ]
}

try {
  await main(process.argv.slice(2).map((arg) => arg.replace(/\r$/, '')))
} catch (error) {
  console.log(`check: ${error.message}`)
  process.exitCode = 1
}
