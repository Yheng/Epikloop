// This repository's laws: the constitution's rules that a script can check, run over the
// repository this file is in. `node tools/laws.mjs` prints each failure, then one summary line, and
// exits 1 on any failure.
//
//   ceiling     the core plugin's model-facing text stays within 700 lines (article 2)
//   shell       a shell appears only as a thin shim: check.sh and the eval scaffolds (article 7)
//   network     hook and Harbor code makes no network call (article 6)
//   frontmatter skills and agents: a one-sentence description, a name only on the front door, an
//               effort on every skill a person can invoke, a model only on the worker, and brackets
//               and quotes quoted (CLAUDE.md)
//   hooks       exec form on Node, no worktree hooks, no blocking hook on a tool but a shell, the
//               guard failing closed, and forward slashes in hooks.json and the manifests
//               (CLAUDE.md)
//   schemas     JSON that Epikloop writes has snake_case keys and a format version: its schemas,
//               their examples and the lane profiles (CLAUDE.md)
//   layout      no plugin has a top-level bin/, which claude.ai and Cowork refuse to install
//   sign-off    every commit but a merge is signed off by its author, for the DCO
//   AI credits  no commit credits an AI tool: not as its author or committer, a trailer or a footer
//
// `node tools/laws.mjs --self-test` runs each law over samples in throwaway folders and repos.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const CEILING = 700
const WIDTH = 100

const read = (file) => fs.readFileSync(file, 'utf8')
const slash = (file) => file.split(path.sep).join('/')

function git(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  if (run.error) throw new Error(`git ${args[0]} failed: ${run.error.message}`)
  return run
}

function gitOk(cwd, args) {
  const run = git(cwd, args)
  if (run.status !== 0) throw new Error(`git ${args[0]} failed: ${run.stderr.trim().split('\n')[0]}`)
  return run.stdout
}

// ---- The prompt ceiling

// A text's model-facing lines: each non-blank line counts once for every 100 columns it spans.
export const lineCount = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / WIDTH)), 0)

// What one `!` injection in a skill body prints, in place of the injection. A lane section prints
// a fragment's own text, which is counted once, with the lanes, so it counts nothing here. Any
// other injection is one the ceiling can't count, and fails the law.
function injected(plugin, script, args) {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (script === 'state.mjs' && words[0] === '--lane' && words.length === 2) return { text: '' }
  const known = script === 'state.mjs' && ((words[0] === '--example' && words.length === 2) || (words[0] === '--lanes' && words.length === 1))
  if (!known) return { problem: `injects ${script} ${words.join(' ')}, which the ceiling can't count` }
  const run = spawnSync(process.execPath, [path.join(plugin, 'scripts', script), ...words], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true })
  if (run.status !== 0 || run.stdout.trim() === '') return { problem: `injects ${script} ${words.join(' ')}, which printed nothing to count` }
  return { text: run.stdout }
}

// The core plugin's model-facing text: skill and agent bodies with their descriptions and with
// their injections printed in place; the skills' other files; the lane fragments; the product
// CLAUDE.md template; and the briefing's fixed text. Rows are [lines, file], largest first.
export function ceilingLaw(plugin) {
  const rows = []
  const problems = []
  const outputs = new Map()
  const name = (file) => slash(path.relative(plugin, file))
  const markdown = (file) => {
    const text = read(file).replace(/\r\n/g, '\n')
    const front = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
    if (front === null) {
      problems.push(`ceiling: ${name(file)} has no frontmatter`)
      return lineCount(text)
    }
    const description = (/^description:[ \t]*(.*)$/m.exec(front[1])?.[1] ?? '').replace(/^(['"])(.*)\1$/, '$2')
    const body = front[2].replace(/!`([^`\n]*)`/g, (_, command) => {
      const call = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([\w.-]+)"(.*)$/.exec(command)
      const key = call === null ? null : `${call[1]}${call[2]}`
      if (key !== null && !outputs.has(key)) outputs.set(key, injected(plugin, call[1], call[2]))
      const out = key === null ? { problem: `injects \`${command}\`, which the ceiling can't count` } : outputs.get(key)
      if (out.problem) problems.push(`ceiling: ${name(file)} ${out.problem}`)
      return out.text ?? ''
    })
    return lineCount(description) + lineCount(body)
  }
  const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  const walk = (dir) => list(dir).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
  for (const skill of list(path.join(plugin, 'skills')).filter((entry) => entry.isDirectory())) {
    for (const file of walk(path.join(plugin, 'skills', skill.name))) {
      rows.push([path.basename(file) === 'SKILL.md' ? markdown(file) : lineCount(read(file)), name(file)])
    }
  }
  for (const agent of list(path.join(plugin, 'agents')).filter((entry) => entry.name.endsWith('.md'))) {
    const file = path.join(plugin, 'agents', agent.name)
    rows.push([markdown(file), name(file)])
  }
  for (const lane of list(path.join(plugin, 'lanes')).filter((entry) => entry.name.endsWith('.md'))) {
    const file = path.join(plugin, 'lanes', lane.name)
    rows.push([lineCount(read(file)), name(file)])
  }
  const template = path.join(plugin, 'templates', 'CLAUDE.template.md')
  if (fs.existsSync(template)) rows.push([lineCount(read(template)), name(template)])
  const brief = read(path.join(plugin, 'scripts', 'brief.mjs'))
  const pieces = [/const PROTOCOL = `((?:\\.|[^`\\])*)`/, /const OUTSIDE = '((?:\\.|[^'\\])*)'/, /const failure = \(reason\) =>\s*`((?:\\.|[^`\\])*)`/].map((re) => re.exec(brief)?.[1])
  if (pieces.some((piece) => piece === undefined)) problems.push("ceiling: scripts/brief.mjs's protocol, outside line or failure line isn't where the ceiling reads it")
  else rows.push([pieces.reduce((sum, piece) => sum + lineCount(piece), 0), 'scripts/brief.mjs (the protocol, the outside line and the failure line)'])
  rows.sort((a, b) => b[0] - a[0])
  const count = rows.reduce((sum, [lines]) => sum + lines, 0)
  if (count > CEILING) {
    const largest = rows.slice(0, 5).map(([lines, file]) => `${file} ${lines}`).join(', ')
    problems.push(`ceiling: ${count} lines of model-facing text, over ${CEILING}; delete before adding. The largest: ${largest}`)
  }
  return { count, rows, problems }
}

// ---- Shell files

const SHIMS = ['plugins/epikloop/templates/scripts/check.sh']
const SHELL_NAME = /\.(?:sh|bash|zsh|ksh|ps1|psm1|cmd|bat)$/i
const SHELL_LINE = /^#!.*\b(?:sh|bash|zsh|dash|ksh|pwsh|powershell)\b/

function firstLine(file) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const head = Buffer.alloc(256)
      const n = fs.readSync(fd, head, 0, head.length, 0)
      return head.subarray(0, n).toString('latin1').split(/\r?\n/)[0]
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

// An eval case's scaffold. `claude plugin eval` sets a case up only by running a Bash script in the
// case's own folder, so each scaffold is allowed as exactly this shim, which hands the fixture's name
// to evals/fixture.mjs.
const SCAFFOLD_PATH = /^plugins\/[^/]+\/evals\/[^/]+\/scaffold\.sh$/
const SCAFFOLD = /^#!\/bin\/sh\nexec node "\$\(dirname "\$0"\)\/\.\.\/fixture\.mjs" [a-z][a-z0-9-]*\n$/

// Every tracked file that is a shell script, by its name or its #! line, other than the thin shims:
// scripts/check.sh's template, and each eval case's scaffold.
export function shellLaw(root) {
  const files = gitOk(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const shells = files.filter((file) => !SHIMS.includes(file) && (SHELL_NAME.test(file) || SHELL_LINE.test(firstLine(path.join(root, file)))))
  const problems = []
  let scaffolds = 0
  for (const file of shells) {
    if (!SCAFFOLD_PATH.test(file)) problems.push(`shell: ${file} is a shell script; Epikloop's scripts are Node, and a shell appears only as a thin shim`)
    else if (!SCAFFOLD.test(fs.readFileSync(path.join(root, file), 'utf8'))) problems.push(`shell: ${file} is more than the scaffold shim, which only hands its fixture's name to evals/fixture.mjs`)
    else scaffolds += 1
  }
  return { problems, scaffolds }
}

// ---- Network calls

const NETWORK = [
  [/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici)(?:\/[^'"]*)?['"]/, 'a network module'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bsendBeacon\b/, 'sendBeacon'],
]
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.\.?\/[^'"]+)['"]/gm
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/
// Harbor's two calls, each allowed in one file of its build, exactly as the build writes it: its
// server listens on 127.0.0.1 through node:http, and its page opens its own event stream. Anything
// else on those lines, and either call anywhere else, is still a network call.
const HARBOR_CALLS = new Map([
  ['plugins/epikloop-harbor/harbor.mjs', 'import http from "node:http";'],
  ['plugins/epikloop-harbor/client/harbor.js', 'new EventSource("/events")'],
])

// The code that hooks run, which must not reach the network: what hooks/hooks.json names and
// everything it imports by relative path, the git hooks a product carries, and all of Harbor.
export function networkLaw(root) {
  const plugin = path.join(root, 'plugins', 'epikloop')
  const hooksFile = path.join(plugin, 'hooks', 'hooks.json')
  const hooks = JSON.parse(read(hooksFile))
  const queue = (hooks.modules ?? []).map((module) => path.resolve(path.dirname(hooksFile), module))
  const ROOT_VAR = '${CLAUDE_PLUGIN_ROOT}/'
  for (const groups of Object.values(hooks.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        for (const part of [hook.command, ...(hook.args ?? [])]) {
          const at = typeof part === 'string' ? part.indexOf(ROOT_VAR) : -1
          if (at >= 0) queue.push(path.join(plugin, part.slice(at + ROOT_VAR.length)))
        }
      }
    }
  }
  const githooks = path.join(plugin, 'templates', 'githooks')
  if (fs.existsSync(githooks)) queue.push(...fs.readdirSync(githooks).map((name) => path.join(githooks, name)))
  const walk = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(path.join(dir, entry.name))) : [path.join(dir, entry.name)]))
      : []
  queue.push(...walk(path.join(root, 'plugins', 'epikloop-harbor')).filter((file) => CODE.test(file)))
  const seen = new Set()
  const problems = []
  while (queue.length > 0) {
    const file = path.resolve(queue.shift())
    if (seen.has(file)) continue
    seen.add(file)
    const shown = slash(path.relative(root, file))
    let text
    try {
      text = read(file)
    } catch {
      problems.push(`network: ${shown} is run or imported by hook code, and can't be read`)
      continue
    }
    const allowed = HARBOR_CALLS.get(shown)
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      const rest = allowed === undefined ? line : line.split(allowed).join('')
      for (const [re, what] of NETWORK) if (re.test(rest)) problems.push(`network: ${shown}:${i + 1} uses ${what}; hook and Harbor code makes no network call`)
    }
    for (const match of text.matchAll(RELATIVE_IMPORT)) queue.push(path.resolve(path.dirname(file), match[1]))
  }
  return { files: seen.size, problems }
}

// ---- Skill and agent frontmatter

const FRONT_DOOR = 'plugins/epikloop/skills/epikloop/SKILL.md'
const WORKER = 'plugins/epikloop/agents/story-worker.md'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
// What YAML may read as syntax rather than text: a bracket or a double quote anywhere, or a single
// quote that opens the value. An apostrophe inside a word is text.
const NEEDS_QUOTES = /[[\]{}<>"]|^'/
const QUOTED = /^(?:'(?:[^']|'')*'|"(?:[^"\\]|\\.)*")$/

function unquote(raw) {
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'")
  if (/^".*"$/.test(raw)) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

// A frontmatter block's fields, in the forms skills and agents use: `key: value`, a `- item` list
// under a key, and one level of `key: value` under a key. `values` holds each value's raw text with
// its line, and `unread` each line in none of those forms.
function readFront(block) {
  const fields = {}
  const values = []
  const unread = []
  let open = null
  for (const [i, raw] of block.split('\n').entries()) {
    const line = i + 2
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    const top = /^([A-Za-z][\w-]*):(?:[ \t]+(\S.*?))?[ \t]*$/.exec(raw)
    const item = /^[ \t]+-[ \t]+(\S.*?)[ \t]*$/.exec(raw)
    const pair = /^[ \t]+([A-Za-z][\w-]*):[ \t]+(\S.*?)[ \t]*$/.exec(raw)
    if (top !== null) {
      open = top[2] === undefined ? top[1] : null
      fields[top[1]] = top[2] === undefined ? null : unquote(top[2])
      if (top[2] !== undefined) values.push([line, top[1], top[2]])
    } else if (open !== null && item !== null && (fields[open] === null || Array.isArray(fields[open]))) {
      fields[open] = [...(fields[open] ?? []), unquote(item[1])]
      values.push([line, open, item[1]])
    } else if (open !== null && pair !== null && !Array.isArray(fields[open])) {
      fields[open] = { ...fields[open], [pair[1]]: unquote(pair[2]) }
      values.push([line, `${open}.${pair[1]}`, pair[2]])
    } else unread.push([line, raw.trim()])
  }
  return { fields, values, unread }
}

const oneSentence = (text) => /[.!?]$/.test(text) && !/[.!?]\s/.test(text)

// Every plugin's skills and agents, by their frontmatter: a description of one sentence, since a
// model-invocable description loads on every turn; a name only on the front door, since a name also
// registers a bare command; an effort on every skill a person can invoke (spec-delta, which the
// worker preloads, keeps the worker's); a model only on the worker; and a value that YAML may read
// as syntax quoted whole.
export function frontmatterLaw(root) {
  const plugins = path.join(root, 'plugins')
  const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  const files = list(plugins)
    .filter((entry) => entry.isDirectory())
    .flatMap((plugin) => {
      const base = path.join(plugins, plugin.name)
      const skills = list(path.join(base, 'skills'))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(base, 'skills', entry.name, 'SKILL.md'))
        .filter((file) => fs.existsSync(file))
      const agents = list(path.join(base, 'agents'))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => path.join(base, 'agents', entry.name))
      return [...skills.map((file) => [file, 'skill']), ...agents.map((file) => [file, 'agent'])]
    })
  const problems = []
  for (const [file, kind] of files) {
    const shown = slash(path.relative(root, file))
    const say = (text) => problems.push(`frontmatter: ${shown} ${text}`)
    const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(read(file).replace(/\r\n/g, '\n'))
    if (front === null) {
      say('has no frontmatter')
      continue
    }
    const { fields, values, unread } = readFront(front[1])
    for (const [line, text] of unread) say(`line ${line} isn't read by the laws: "${text}". Write key: value, a list of "- " items, or one level of key: value under a key`)
    for (const [line, key, raw] of values) {
      if (NEEDS_QUOTES.test(raw) && !QUOTED.test(raw)) say(`line ${line}: ${key} holds a bracket or a quote, so quote the whole value`)
    }
    const description = typeof fields.description === 'string' ? fields.description.trim() : ''
    if (description === '') say('has no description')
    else if (!oneSentence(description)) say("has a description that isn't one sentence; a description loads on every turn")
    if (kind === 'agent') {
      if (shown === WORKER && (typeof fields.model !== 'string' || fields.model === 'inherit')) say('is the worker, which pins a model')
      if (shown !== WORKER && 'model' in fields) say('pins a model; only the worker does')
      continue
    }
    if (shown === FRONT_DOOR && fields.name !== 'epikloop') say('is the front door, which sets name: epikloop to register /epikloop')
    if (shown !== FRONT_DOOR && 'name' in fields) say(`sets name, which registers a bare /${fields.name}; only the front door sets one`)
    if (fields['user-invocable'] !== 'false' && !EFFORTS.includes(fields.effort)) {
      say(`${'effort' in fields ? `pins effort ${fields.effort}, which isn't one of ${EFFORTS.join(', ')}` : 'pins no effort'}; every skill a person can invoke pins one`)
    }
    if ('model' in fields) say('pins a model; only the worker does')
  }
  return { files: files.length, problems }
}

// ---- Hooks and plugin paths

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest'])
const SHELLS = ['Bash', 'PowerShell']
const WORKTREE = /^Worktree(?:Create|Remove)$/
const WORKTREE_NAME = /['"`](?:classic\.)?worktree[._-]?(?:create|remove)['"`]/i
const GUARD = '${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs'

// Each string in a JSON value, with its place in it.
const strings = (value, at) =>
  typeof value === 'string'
    ? [[at, value]]
    : value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, item]) => strings(item, Array.isArray(value) ? `${at}[${key}]` : at === '' ? key : `${at}.${key}`))
      : []

// The manifests, and every plugin's hooks: hooks/hooks.json and any hooks a manifest names or
// holds, with the hooks module and what it imports. A hook runs Node in exec form, which needs no
// shell on any system; none registers a worktree event, since a WorktreeCreate hook replaces git's
// own worktree creation; a command hook on a tool event waits on a shell tool only; the guard fails
// closed; and a path takes forward slashes, since a backslash path loads on Windows only.
export function hooksLaw(root) {
  const problems = []
  const shown = (file) => slash(path.relative(root, file))
  const json = (file) => JSON.parse(read(file))
  const slashes = (file, value) => {
    for (const [at, text] of strings(value, '')) {
      if (text.includes('\\')) problems.push(`hooks: ${shown(file)} ${at} holds a backslash; a path takes forward slashes, which load on every system`)
    }
  }
  let hooks = 0
  let manifests = 0
  const marketplace = path.join(root, '.claude-plugin', 'marketplace.json')
  if (fs.existsSync(marketplace)) {
    manifests += 1
    slashes(marketplace, json(marketplace))
  }
  const plugins = path.join(root, 'plugins')
  for (const plugin of fs.existsSync(plugins) ? fs.readdirSync(plugins, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : []) {
    const base = path.join(plugins, plugin.name)
    const standard = path.join(base, 'hooks', 'hooks.json')
    const configs = fs.existsSync(standard) ? [[standard, json(standard)]] : []
    const manifestFile = path.join(base, '.claude-plugin', 'plugin.json')
    if (fs.existsSync(manifestFile)) {
      manifests += 1
      const manifest = json(manifestFile)
      slashes(manifestFile, manifest)
      const named = manifest.hooks
      if (typeof named === 'string' || Array.isArray(named)) {
        for (const entry of [named].flat().map((file) => path.resolve(base, file))) if (entry !== path.resolve(standard)) configs.push([entry, json(entry)])
      } else if (named !== null && typeof named === 'object') configs.push([manifestFile, 'hooks' in named ? named : { hooks: named }])
    }
    let guarded = false
    for (const [file, config] of configs) {
      if (file !== manifestFile) slashes(file, config)
      for (const [event, groups] of Object.entries(config.hooks ?? {})) {
        if (WORKTREE.test(event)) problems.push(`hooks: ${shown(file)} registers ${event}; no hook replaces git's own worktree handling`)
        for (const group of groups ?? []) {
          const matcher = group.matcher ?? ''
          const tools = matcher.split('|')
          for (const hook of group.hooks ?? []) {
            hooks += 1
            const where = `hooks: ${shown(file)} has a ${event}${matcher === '' ? '' : ` ${matcher}`} hook`
            if (hook.type !== 'command' || hook.command !== 'node' || !Array.isArray(hook.args)) problems.push(`${where} that isn't in exec form: "type": "command", "command": "node" and "args": [...]`)
            if (TOOL_EVENTS.has(event) && !tools.every((tool) => SHELLS.includes(tool))) problems.push(`${where} on a tool that isn't a shell; no blocking hook goes on one`)
            if (event === 'PreToolUse' && [...tools].sort().join('|') === 'Bash|PowerShell' && (hook.args ?? []).includes(GUARD) && hook.onFailure === 'block') guarded = true
          }
        }
      }
      const queue = (config.modules ?? []).map((module) => path.resolve(path.dirname(file), module))
      const seen = new Set()
      while (queue.length > 0) {
        const code = queue.shift()
        if (seen.has(code)) continue
        seen.add(code)
        let text
        try {
          text = read(code)
        } catch {
          problems.push(`hooks: ${shown(code)} is a hooks module or imported by one, and can't be read`)
          continue
        }
        for (const [i, line] of text.split(/\r?\n/).entries()) {
          if (WORKTREE_NAME.test(line)) problems.push(`hooks: ${shown(code)}:${i + 1} names a worktree event; no hook registers one`)
        }
        for (const match of text.matchAll(RELATIVE_IMPORT)) queue.push(path.resolve(path.dirname(code), match[1]))
      }
    }
    if (plugin.name === 'epikloop' && !guarded) {
      problems.push('hooks: plugins/epikloop registers no guard on PreToolUse for Bash|PowerShell with "onFailure": "block", so a guard that crashed would let the command run')
    }
  }
  return { hooks, manifests, problems }
}

// ---- JSON formats

// A key in JSON that Epikloop writes: snake_case, JSON Schema's own `$schema`, or a story tier,
// which keys the effort overrides.
const KEY = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|\$schema|T[1-3])$/

// The core plugin's schemas, each requiring a format version and declaring snake_case keys at any
// depth, and the JSON they describe: each example and each lane profile carries its schema's format
// and snake_case keys.
export function schemasLaw(root) {
  const plugin = path.join(root, 'plugins', 'epikloop')
  const dir = path.join(plugin, 'schemas')
  const problems = []
  const shown = (file) => slash(path.relative(root, file))
  const jsonFiles = (folder, suffix) =>
    fs.existsSync(folder)
      ? fs
          .readdirSync(folder)
          .filter((name) => name.endsWith(suffix))
          .sort()
          .map((name) => path.join(folder, name))
      : []
  const schemas = jsonFiles(dir, '.schema.json')
  // Each schema's format version by its name, or null when it requires none.
  const formats = new Map()
  for (const file of schemas) {
    const schema = JSON.parse(read(file))
    const format = schema.properties?.format?.const
    const name = path.basename(file, '.schema.json')
    if ((schema.required ?? []).includes('format') && Number.isInteger(format) && format > 0) formats.set(name, format)
    else {
      formats.set(name, null)
      problems.push(`schemas: ${shown(file)} doesn't require a format with a const version; JSON that Epikloop writes carries one`)
    }
    const walk = (node, at) => {
      if (node === null || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
          for (const property of Object.keys(value)) if (!KEY.test(property)) problems.push(`schemas: ${shown(file)} declares ${at}/properties/${property}, which isn't snake_case`)
        }
        walk(value, `${at}/${key}`)
      }
    }
    walk(schema, '#')
  }
  const data = [
    ...jsonFiles(path.join(dir, 'examples'), '.json').map((file) => [file, path.basename(file, '.json')]),
    ...jsonFiles(path.join(plugin, 'lanes'), '.json').map((file) => [file, 'lane']),
  ]
  for (const [file, name] of data) {
    const value = JSON.parse(read(file))
    const format = formats.get(name)
    if (format === undefined) problems.push(`schemas: ${shown(file)} has no schema, ${name}.schema.json`)
    else if (format !== null && value?.format !== format) {
      problems.push(`schemas: ${shown(file)} carries ${value?.format === undefined ? 'no format' : `format ${JSON.stringify(value.format)}`}, not its schema's ${format}`)
    }
    const keys = (node, at) => {
      if (node === null || typeof node !== 'object') return
      for (const [key, item] of Object.entries(node)) {
        const place = Array.isArray(node) ? `${at}[${key}]` : at === '' ? key : `${at}.${key}`
        if (!Array.isArray(node) && !KEY.test(key)) problems.push(`schemas: ${shown(file)} has the key ${place}, which isn't snake_case`)
        keys(item, place)
      }
    }
    keys(value, '')
  }
  return { schemas: schemas.length, files: data.length, problems }
}

// ---- Plugin layout

// No plugin tracks a top-level bin/. Claude Code puts such a folder on the Bash tool's PATH, but
// claude.ai and Cowork refuse to install a plugin that has one, which would keep it out of
// Anthropic's directory. Epikloop's scripts live in scripts/, reached through ${CLAUDE_PLUGIN_ROOT}.
// Only tracked files count, since an install is a clone.
export function layoutLaw(root) {
  const files = gitOk(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const plugins = [...new Set(files.map((file) => /^plugins\/([^/]+)\//.exec(file)?.[1]).filter(Boolean))]
  const problems = plugins
    .filter((plugin) => files.some((file) => file.startsWith(`plugins/${plugin}/bin/`)))
    .map((plugin) => `layout: plugins/${plugin} has a top-level bin/, which claude.ai and Cowork refuse to install; its scripts go in scripts/`)
  return { plugins: plugins.length, problems }
}

// ---- The commits

const hasHead = (root) => git(root, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0

// Each commit reachable from HEAD as its fields, split on NUL, from a log format ending in %B.
function commits(root, format, extra = []) {
  if (!hasHead(root)) return []
  return gitOk(root, ['log', ...extra, `--format=${format}%x1e`, 'HEAD'])
    .split('\x1e')
    .map((entry) => entry.replace(/^\r?\n/, ''))
    .filter((entry) => entry.trim() !== '')
    .map((entry) => entry.split('\0'))
}

// Every commit but a merge carries a Signed-off-by line with its author's email, as the DCO asks.
// GitHub's merge of a pull request carries none, so merges are skipped.
export function signoffLaw(root) {
  if (gitOk(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    return { commits: 0, problems: ['sign-off: this clone is shallow, so not every commit can be read; fetch the whole history'] }
  }
  const list = commits(root, '%h%x00%ae%x00%s%x00%B', ['--no-merges'])
  const problems = []
  for (const [sha, email, subject, body = ''] of list) {
    const signers = [...body.matchAll(/^Signed-off-by:[^<\n]*<([^>\n]+)>[ \t]*$/gim)].map((match) => match[1].toLowerCase())
    if (!signers.includes(email.toLowerCase())) problems.push(`sign-off: ${sha} "${subject}" has no Signed-off-by line from its author; commit with git commit -s`)
  }
  return { commits: list.length, problems }
}

// The AI tools whose credit no commit carries.
const AI = /\b(?:claude|anthropic|copilot|openai|codex|chatgpt|cursor(?:agent)?|devin|gemini|aider)\b/i

// No commit names an AI tool as its author or committer, in a *-by: trailer, or in a "Generated
// with" footer. Prose that mentions one is fine.
export function creditsLaw(root) {
  const problems = []
  for (const [sha, authorName, authorEmail, committerName, committerEmail, subject, body = ''] of commits(root, '%h%x00%an%x00%ae%x00%cn%x00%ce%x00%s%x00%B')) {
    const where = `${sha} "${subject}"`
    if (AI.test(authorName) || AI.test(authorEmail)) problems.push(`AI credits: ${where} is authored as an AI tool`)
    if (AI.test(committerName) || AI.test(committerEmail)) problems.push(`AI credits: ${where} is committed as an AI tool`)
    for (const [, trailer, value] of body.matchAll(/^([A-Za-z][\w-]*-by):[ \t]*(.+)$/gim)) {
      if (AI.test(value)) problems.push(`AI credits: ${where} has a ${trailer} trailer for an AI tool`)
    }
    for (const [line] of body.matchAll(/^.*\bgenerated (?:with|by)\b.*$/gim)) {
      if (AI.test(line)) problems.push(`AI credits: ${where} has a "Generated with" footer for an AI tool`)
    }
  }
  return { problems }
}

// ---- A run

function main() {
  const started = performance.now()
  const parts = []
  const failures = []
  const verdict = (problems) => (problems.length === 0 ? 'ok' : `FAIL ${problems.length}`)
  const law = (name, body) => {
    try {
      const { problems, shown } = body()
      failures.push(...problems)
      parts.push(shown ?? `${name} ${verdict(problems)}`)
    } catch (error) {
      failures.push(`${name}: ${String(error?.message ?? error).split('\n')[0]}`)
      parts.push(`${name} FAIL`)
    }
  }
  law('ceiling', () => {
    const { count, problems } = ceilingLaw(path.join(ROOT, 'plugins', 'epikloop'))
    return { problems, shown: `ceiling ${count}/${CEILING}${problems.length > 0 ? ' FAIL' : ''}` }
  })
  law('shell', () => {
    const { problems, scaffolds } = shellLaw(ROOT)
    return { problems, shown: `shell ${verdict(problems)} (${scaffolds} eval scaffolds)` }
  })
  law('network', () => {
    const { files, problems } = networkLaw(ROOT)
    return { problems, shown: `network ${verdict(problems)} (${files} files)` }
  })
  law('frontmatter', () => {
    const { files, problems } = frontmatterLaw(ROOT)
    return { problems, shown: `frontmatter ${verdict(problems)} (${files} files)` }
  })
  law('hooks', () => {
    const { hooks, manifests, problems } = hooksLaw(ROOT)
    return { problems, shown: `hooks ${verdict(problems)} (${hooks} hooks, ${manifests} manifests)` }
  })
  law('schemas', () => {
    const { schemas, files, problems } = schemasLaw(ROOT)
    return { problems, shown: `schemas ${verdict(problems)} (${schemas} schemas, ${files} files)` }
  })
  law('layout', () => {
    const { plugins, problems } = layoutLaw(ROOT)
    return { problems, shown: `layout ${verdict(problems)} (${plugins} plugins)` }
  })
  law('sign-off', () => {
    const { commits: count, problems } = signoffLaw(ROOT)
    return { problems, shown: `sign-off ${verdict(problems)} (${count} commits)` }
  })
  law('AI credits', () => creditsLaw(ROOT))
  for (const line of failures) console.log(line)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`laws: ${failures.length === 0 ? 'PASS' : 'FAIL'} · ${parts.join(' · ')} · ${seconds} s`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

// ---- The self-test

async function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-laws-'))
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n[maintenance]\n\tauto = false\n')
  // git runs in this process for the laws, so the scrubbed environment applies here.
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) if (/^(?:GIT_.*|EMAIL)$/i.test(key)) delete process.env[key]
  Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_CEILING_DIRECTORIES: temp, GIT_TERMINAL_PROMPT: '0' })
  let made = 0
  const k = {
    dir() {
      made += 1
      const dir = path.join(temp, `case-${made}`)
      fs.mkdirSync(dir)
      return dir
    },
    write(dir, file, content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), content)
    },
    repo() {
      const dir = k.dir()
      gitOk(dir, ['init', '-q'])
      return dir
    },
    // A commit of everything in the folder, by `author` unless `committer` says otherwise.
    commit(dir, message, { author = 'Ada Lovelace <ada@example.com>', committer = author } = {}) {
      const [, name, email] = /^(.*) <(.*)>$/.exec(committer)
      gitOk(dir, ['add', '-A'])
      gitOk(dir, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', `--author=${author}`, '-m', message])
    },
    has: (problems, ...texts) => texts.filter((text) => !problems.some((problem) => problem.includes(text))).map((text) => `no problem saying ${JSON.stringify(text)} in ${JSON.stringify(problems)}`),
    none: (problems) => (problems.length === 0 ? [] : [`unexpected problems: ${JSON.stringify(problems)}`]),
  }
  const SIGNED = '\n\nSigned-off-by: Ada Lovelace <ada@example.com>'
  // A plugin with one of each counted thing, each of a known size.
  const fixturePlugin = () => {
    const dir = k.dir()
    k.write(dir, 'skills/a/SKILL.md', `---\ndescription: One line.\neffort: low\n---\n\nBody line one.\n\n${'x'.repeat(250)}\n\n!\`node "\${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example spec\`\n\n!\`node "\${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --lane plan\`\n`)
    k.write(dir, 'skills/a/notes.md', 'Note one.\nNote two.\n')
    k.write(dir, 'agents/w.md', '---\nname: w\ndescription: "Two words."\n---\n\nAgent body.\n')
    k.write(dir, 'lanes/web.md', '## Plan\n\nPlan text.\n')
    k.write(dir, 'lanes/web.json', '{"not": "counted"}\n')
    k.write(dir, 'templates/CLAUDE.template.md', '# Rules\n\nKeep it short.\n')
    k.write(dir, 'scripts/brief.mjs', "const OUTSIDE = 'Outside, `/x`.'\nconst PROTOCOL = `P one\nP two`\nconst failure = (reason) => `It failed (${reason}); \\`/x\\` helps.`\n")
    k.write(dir, 'scripts/state.mjs', "const [flag, name] = process.argv.slice(2)\nif (flag === '--example' && name === 'spec') console.log('E one\\nE two')\nelse if (flag === '--lanes') console.log('- web: a lane')\nelse process.exitCode = 1\n")
    return dir
  }
  // A repository whose hook code is clean unless `files` says otherwise.
  const networkRepo = (files = {}) => {
    const root = k.dir()
    const defaults = {
      'plugins/epikloop/hooks/hooks.json': JSON.stringify({ modules: ['./emit.js'], hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/brief.mjs'] }] }] } }),
      'plugins/epikloop/hooks/emit.js': 'export default function setup() {}\n',
      'plugins/epikloop/scripts/brief.mjs': "import { a } from './helper.mjs'\nconst later = await import('./late.mjs')\n",
      'plugins/epikloop/scripts/helper.mjs': 'export const a = 1\n',
      'plugins/epikloop/scripts/late.mjs': 'export const b = 2\n',
      'plugins/epikloop/scripts/smoke.mjs': 'const answer = await fetch(process.argv[2])\n',
      'plugins/epikloop/templates/githooks/check.mjs': "// Nothing is fetched here.\nimport fs from 'node:fs'\n",
      'plugins/epikloop/templates/githooks/pre-commit': "#!/usr/bin/env node\nimport('./check.mjs')\n",
      'plugins/epikloop-harbor/.claude-plugin/plugin.json': '{}\n',
    }
    for (const [file, content] of Object.entries({ ...defaults, ...files })) k.write(root, file, content)
    return root
  }
  // A repository whose manifests and hooks are clean, unless `change` edits its JSON files or
  // `code` replaces the hooks module's files.
  const hooksRepo = (change = () => {}, code = {}) => {
    const root = k.dir()
    const guard = { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs'], onFailure: 'block' }
    const files = {
      '.claude-plugin/marketplace.json': { name: 'epikloop', plugins: [{ name: 'epikloop', source: './plugins/epikloop' }] },
      'plugins/epikloop/.claude-plugin/plugin.json': { name: 'epikloop' },
      'plugins/epikloop-harbor/.claude-plugin/plugin.json': { name: 'epikloop-harbor' },
      'plugins/epikloop/hooks/hooks.json': {
        modules: ['./emit.js'],
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/brief.mjs'] }] }],
          PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [guard] }],
        },
      },
    }
    change(files)
    for (const [file, value] of Object.entries(files)) k.write(root, file, JSON.stringify(value, null, 2))
    const modules = {
      'plugins/epikloop/hooks/emit.js': "import { x } from './helper.js'\nexport function register(on) {\n  on('session.start', ($, e, next) => next(e))\n}\n",
      'plugins/epikloop/hooks/helper.js': 'export const x = 1\n',
    }
    for (const [file, text] of Object.entries({ ...modules, ...code })) k.write(root, file, text)
    return root
  }
  const real = path.join(ROOT, 'plugins', 'epikloop')
  const cases = [
    [
      'the ceiling counts each piece, with injections printed in place',
      () => {
        const { count, rows, problems } = ceilingLaw(fixturePlugin())
        // skills/a/SKILL.md: 1 description + 1 body line + 3 for 250 columns + 2 printed = 7;
        // notes 2; the agent 1 + 1; the lane 2; the template 2; the briefing's text 1 + 2 + 1.
        const want = 7 + 2 + 2 + 2 + 2 + 4
        return [...k.none(problems), ...(count === want ? [] : [`counted ${count}, not ${want}: ${JSON.stringify(rows)}`])]
      },
    ],
    [
      'the ceiling refuses an injection it cannot count',
      () => {
        const dir = fixturePlugin()
        k.write(dir, 'skills/b/SKILL.md', '---\ndescription: B.\n---\n\n!`node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --help`\n!`git status`\n')
        return k.has(ceilingLaw(dir).problems, "skills/b/SKILL.md injects init.mjs --help, which the ceiling can't count", "skills/b/SKILL.md injects `git status`, which the ceiling can't count")
      },
    ],
    [
      'the real plugin is within the ceiling, and a copy pushed past it fails',
      () => {
        const within = ceilingLaw(real)
        const copy = path.join(k.dir(), 'epikloop')
        fs.cpSync(real, copy, { recursive: true })
        const skill = path.join(copy, 'skills', 'epikloop', 'SKILL.md')
        fs.appendFileSync(skill, Array.from({ length: 300 }, (_, i) => `Filler line ${i}.`).join('\n'))
        const over = ceilingLaw(copy)
        return [
          ...k.none(within.problems),
          ...(within.count > 0 && within.count <= CEILING ? [] : [`the real plugin counts ${within.count}`]),
          ...(over.count === within.count + 300 ? [] : [`the copy counts ${over.count}, not ${within.count + 300}`]),
          ...k.has(over.problems, `ceiling: ${within.count + 300} lines of model-facing text, over ${CEILING}`, 'skills/epikloop/SKILL.md'),
        ]
      },
    ],
    [
      'the briefing text moved out of reach fails the ceiling',
      () => {
        const dir = fixturePlugin()
        k.write(dir, 'scripts/brief.mjs', 'export const text = 1\n')
        return k.has(ceilingLaw(dir).problems, "isn't where the ceiling reads it")
      },
    ],
    [
      'the one shell file is the shim',
      () => {
        const dir = k.repo()
        k.write(dir, 'plugins/epikloop/templates/scripts/check.sh', '#!/bin/sh\nexec node x\n')
        k.write(dir, 'plugins/epikloop/templates/githooks/pre-commit', '#!/usr/bin/env node\nimport("./check.mjs")\n')
        k.write(dir, 'plugins/epikloop/scripts/tool.mjs', '#!/usr/bin/env node\n')
        gitOk(dir, ['add', '-A'])
        const clean = shellLaw(dir).problems
        k.write(dir, 'tools/run.sh', 'echo hi\n')
        k.write(dir, 'bin/tool', '#!/usr/bin/env bash\necho hi\n')
        k.write(dir, 'setup.ps1', 'Write-Host hi\n')
        gitOk(dir, ['add', '-A'])
        const dirty = shellLaw(dir).problems
        return [...k.none(clean), ...k.has(dirty, 'shell: tools/run.sh is a shell script', 'shell: bin/tool is a shell script', 'shell: setup.ps1 is a shell script'), ...(dirty.length === 3 ? [] : [`found ${dirty.length}, not 3`])]
      },
    ],
    [
      "an eval case's scaffold passes only as the exact shim, in a case folder",
      () => {
        const dir = k.repo()
        const shim = '#!/bin/sh\nexec node "$(dirname "$0")/../fixture.mjs" planned\n'
        k.write(dir, 'plugins/epikloop/evals/story/scaffold.sh', shim)
        gitOk(dir, ['add', '-A'])
        const { problems: clean, scaffolds } = shellLaw(dir)
        k.write(dir, 'plugins/epikloop/evals/plan/scaffold.sh', `${shim}echo more\n`)
        k.write(dir, 'plugins/epikloop/evals/decide/scaffold.sh', shim.replace('fixture.mjs', 'fixture.js'))
        k.write(dir, 'plugins/epikloop/evals/scaffold.sh', shim)
        k.write(dir, 'tools/evals/story/scaffold.sh', shim)
        gitOk(dir, ['add', '-A'])
        const dirty = shellLaw(dir).problems
        return [
          ...k.none(clean),
          ...(scaffolds === 1 ? [] : [`counted ${scaffolds} scaffolds, not 1`]),
          ...k.has(
            dirty,
            'shell: plugins/epikloop/evals/plan/scaffold.sh is more than the scaffold shim',
            'shell: plugins/epikloop/evals/decide/scaffold.sh is more than the scaffold shim',
            'shell: plugins/epikloop/evals/scaffold.sh is a shell script',
            'shell: tools/evals/story/scaffold.sh is a shell script',
          ),
          ...(dirty.length === 4 ? [] : [`found ${dirty.length}, not 4`]),
        ]
      },
    ],
    [
      "clean hook code passes, though a script no hook reaches fetches",
      () => {
        const { files, problems } = networkLaw(networkRepo())
        return [...k.none(problems), ...(files === 6 ? [] : [`read ${files} files, not 6`])]
      },
    ],
    ...[
      ['a helper a hook imports', { 'plugins/epikloop/scripts/helper.mjs': 'export const a = await fetch(url)\n' }, 'network: plugins/epikloop/scripts/helper.mjs:1 uses fetch()'],
      ['a module a hook imports late', { 'plugins/epikloop/scripts/late.mjs': 'export const b = new WebSocket(url)\n' }, 'network: plugins/epikloop/scripts/late.mjs:1 uses WebSocket'],
      ['the hooks module', { 'plugins/epikloop/hooks/emit.js': "import https from 'node:https'\n" }, 'network: plugins/epikloop/hooks/emit.js:1 uses a network module'],
      ['the gate runner', { 'plugins/epikloop/templates/githooks/check.mjs': "const http = require('http')\n" }, 'network: plugins/epikloop/templates/githooks/check.mjs:1 uses a network module'],
      ['Harbor', { 'plugins/epikloop-harbor/server/feed.mjs': 'const feed = new EventSource(url)\n' }, 'network: plugins/epikloop-harbor/server/feed.mjs:1 uses EventSource'],
      ["Harbor's server, beside the import it may make", { 'plugins/epikloop-harbor/harbor.mjs': 'import http from "node:http";\nimport https from "node:https";\n' }, 'network: plugins/epikloop-harbor/harbor.mjs:2 uses a network module'],
      ["Harbor's server, on the line it may import on", { 'plugins/epikloop-harbor/harbor.mjs': 'import http from "node:http"; await fetch(url)\n' }, 'network: plugins/epikloop-harbor/harbor.mjs:1 uses fetch()'],
      ["Harbor's page, beside the stream it may open", { 'plugins/epikloop-harbor/client/harbor.js': 'function f(){let t=new EventSource("/events");return fetch("/x")}\n' }, 'network: plugins/epikloop-harbor/client/harbor.js:1 uses fetch()'],
      ["Harbor's page, to another address", { 'plugins/epikloop-harbor/client/harbor.js': 'let t=new EventSource("/events"),u=new EventSource("https://example.com/feed")\n' }, 'network: plugins/epikloop-harbor/client/harbor.js:1 uses EventSource'],
      ["another of Harbor's files, with the server's import", { 'plugins/epikloop-harbor/scripts/session.mjs': 'import http from "node:http";\n' }, 'network: plugins/epikloop-harbor/scripts/session.mjs:1 uses a network module'],
      ["another of Harbor's files, with the page's stream", { 'plugins/epikloop-harbor/client/other.js': 'let t=new EventSource("/events")\n' }, 'network: plugins/epikloop-harbor/client/other.js:1 uses EventSource'],
    ].map(([where, files, text]) => [`a network call in ${where} fails`, () => k.has(networkLaw(networkRepo(files)).problems, text)]),
    [
      "Harbor's two calls pass: its server's node:http import and its page's stream to /events",
      () => {
        const files = { 'plugins/epikloop-harbor/harbor.mjs': 'import fs from "node:fs";\nimport http from "node:http";\n', 'plugins/epikloop-harbor/client/harbor.js': 'function Ct(e){let t=new EventSource("/events");return t}\n' }
        return k.none(networkLaw(networkRepo(files)).problems)
      },
    ],
    [
      "the real skills, agents, hooks, manifests and formats pass",
      () => {
        const front = frontmatterLaw(ROOT)
        const hooks = hooksLaw(ROOT)
        const formats = schemasLaw(ROOT)
        const read = front.files > 0 && hooks.hooks > 0 && hooks.manifests > 0 && formats.schemas > 0 && formats.files > 0
        return [
          ...k.none([...front.problems, ...hooks.problems, ...formats.problems]),
          ...(read ? [] : [`read ${front.files} frontmatters, ${hooks.hooks} hooks, ${hooks.manifests} manifests, ${formats.schemas} schemas and ${formats.files} files`]),
        ]
      },
    ],
    [
      'frontmatter that breaks each rule fails',
      () => {
        const root = k.dir()
        const skill = (name, front, plugin = 'epikloop') => k.write(root, `plugins/${plugin}/skills/${name}/SKILL.md`, `---\n${front}\n---\n\nBody.\n`)
        const agent = (name, front) => k.write(root, `plugins/epikloop/agents/${name}.md`, `---\n${front}\n---\n\nBody.\n`)
        skill('epikloop', `name: epikloop\ndescription: Show where the project stands.\neffort: low\nallowed-tools:\n  - 'Bash(node "\${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'`)
        skill('story', 'description: Run one story, then stop.\nargument-hint: "<X.X>"\neffort: medium')
        skill('spec-delta', "description: Apply a story's spec delta to the story's spec.\nuser-invocable: false")
        skill('view', `description: Open the view.\nargument-hint: '"on|off"'\neffort: low`, 'epikloop-harbor')
        agent('story-worker', 'name: story-worker\ndescription: Builds one story, to a landed feat(N.M) commit.\nmodel: opus\nskills:\n  - spec-delta\nexperimental:\n  cacheTtl: 1h')
        const clean = frontmatterLaw(root)
        skill('two', 'description: Run it. Then stop.\neffort: low')
        skill('bare', 'description: Run it\neffort: low')
        skill('named', 'name: named\ndescription: Named.\neffort: low')
        skill('open', 'name: open\ndescription: Open it.\neffort: low', 'epikloop-harbor')
        skill('lazy', 'description: No effort.')
        skill('wrong', 'description: Wrong effort.\neffort: extreme')
        skill('modeled', 'description: Modeled.\neffort: low\nmodel: opus')
        agent('helper', 'name: helper\ndescription: Helps.\nmodel: sonnet')
        skill('hint', 'description: Hint.\nargument-hint: [name]\neffort: low')
        skill('tools', 'description: Tools.\neffort: low\nallowed-tools:\n  - Bash(node "${CLAUDE_PLUGIN_ROOT}/x" *)')
        skill('opened', "description: 'Opens' and goes on.\neffort: low")
        skill('folded', 'description: >\n  Folded.\neffort: low')
        skill('hooked', 'description: Hooked.\neffort: low\nhooks:\n  PreToolUse:\n    - matcher: Edit')
        k.write(root, 'plugins/epikloop/skills/plain/SKILL.md', '# Plain\n')
        const dirty = frontmatterLaw(root).problems
        const other = k.dir()
        k.write(other, 'plugins/epikloop/skills/epikloop/SKILL.md', '---\ndescription: The door.\neffort: low\n---\n')
        k.write(other, 'plugins/epikloop/agents/story-worker.md', '---\nname: story-worker\ndescription: Builds.\nmodel: inherit\n---\n')
        const unnamed = frontmatterLaw(other).problems
        const at = (name, plugin = 'epikloop') => `frontmatter: plugins/${plugin}/skills/${name}/SKILL.md`
        return [
          ...k.none(clean.problems),
          ...(clean.files === 5 ? [] : [`read ${clean.files} files, not 5`]),
          ...k.has(
            dirty,
            `${at('two')} has a description that isn't one sentence`,
            `${at('bare')} has a description that isn't one sentence`,
            `${at('named')} sets name, which registers a bare /named`,
            `${at('open', 'epikloop-harbor')} sets name, which registers a bare /open`,
            `${at('lazy')} pins no effort`,
            `${at('wrong')} pins effort extreme`,
            `${at('modeled')} pins a model`,
            'frontmatter: plugins/epikloop/agents/helper.md pins a model',
            `${at('hint')} line 3: argument-hint holds a bracket or a quote`,
            `${at('tools')} line 5: allowed-tools holds a bracket or a quote`,
            `${at('opened')} line 2: description holds a bracket or a quote`,
            `${at('folded')} line 3 isn't read by the laws`,
            `${at('hooked')} line 5 isn't read by the laws`,
            `${at('plain')} has no frontmatter`,
          ),
          ...(dirty.length === 16 ? [] : [`found ${dirty.length}, not 16: ${JSON.stringify(dirty)}`]),
          ...k.has(unnamed, `${at('epikloop')} is the front door, which sets name: epikloop`, 'frontmatter: plugins/epikloop/agents/story-worker.md is the worker, which pins a model'),
          ...(unnamed.length === 2 ? [] : [`found ${unnamed.length}, not 2: ${JSON.stringify(unnamed)}`]),
        ]
      },
    ],
    [
      'clean hooks and manifests pass',
      () => {
        const { hooks, manifests, problems } = hooksLaw(hooksRepo())
        return [...k.none(problems), ...(hooks === 2 && manifests === 3 ? [] : [`read ${hooks} hooks and ${manifests} manifests, not 2 and 3`])]
      },
    ],
    [
      'hooks that break each rule fail',
      () => {
        const HOOKS = 'plugins/epikloop/hooks/hooks.json'
        const blocking = (matcher) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs'] }] })
        const breaks = [
          [(f) => (f[HOOKS].hooks.SessionStart[0].hooks[0] = { type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/brief.mjs' }), {}, `hooks: ${HOOKS} has a SessionStart hook that isn't in exec form`],
          [(f) => (f[HOOKS].hooks.SessionStart[0].hooks[0].command = 'bash'), {}, `hooks: ${HOOKS} has a SessionStart hook that isn't in exec form`],
          [(f) => (f[HOOKS].hooks.WorktreeCreate = [blocking()]), {}, `hooks: ${HOOKS} registers WorktreeCreate`],
          [() => {}, { 'plugins/epikloop/hooks/helper.js': "export const x = (on) => on('classic.WorktreeRemove', () => {})\n" }, 'hooks: plugins/epikloop/hooks/helper.js:1 names a worktree event'],
          [(f) => f[HOOKS].hooks.PreToolUse.push(blocking('Edit')), {}, `hooks: ${HOOKS} has a PreToolUse Edit hook on a tool that isn't a shell`],
          [(f) => (f[HOOKS].hooks.PostToolUse = [blocking()]), {}, `hooks: ${HOOKS} has a PostToolUse hook on a tool that isn't a shell`],
          [(f) => delete f[HOOKS].hooks.PreToolUse[0].hooks[0].onFailure, {}, 'hooks: plugins/epikloop registers no guard on PreToolUse'],
          [(f) => (f[HOOKS].hooks.SessionStart[0].hooks[0].args = ['${CLAUDE_PLUGIN_ROOT}\\scripts\\brief.mjs']), {}, `hooks: ${HOOKS} hooks.SessionStart[0].hooks[0].args[0] holds a backslash`],
          [(f) => (f['.claude-plugin/marketplace.json'].plugins[0].source = '.\\plugins\\epikloop'), {}, 'hooks: .claude-plugin/marketplace.json plugins[0].source holds a backslash'],
          [
            (f) => {
              f['plugins/epikloop-harbor/.claude-plugin/plugin.json'].hooks = './more.json'
              f['plugins/epikloop-harbor/more.json'] = { hooks: { PreToolUse: [blocking('*')] } }
            },
            {},
            "hooks: plugins/epikloop-harbor/more.json has a PreToolUse * hook on a tool that isn't a shell",
          ],
        ]
        return breaks.flatMap(([change, code, text]) => k.has(hooksLaw(hooksRepo(change, code)).problems, text))
      },
    ],
    [
      'formats that break each rule fail',
      () => {
        const root = k.dir()
        const json = (file, value) => k.write(root, `plugins/epikloop/${file}`, JSON.stringify(value, null, 2))
        const tiers = { type: 'object', properties: { T1: { type: 'string' }, T3: { type: 'string' } } }
        const project = { type: 'object', required: ['format', 'id'], properties: { $schema: {}, format: { const: 1 }, id: {}, effort: { $ref: '#/$defs/tiers' }, gates: { properties: { allow_workflows: { items: {} } } } }, $defs: { tiers } }
        const lane = (allow) => ({ required: ['format'], properties: { $schema: {}, format: { const: 1 }, name: {}, ui_test: { oneOf: [{ type: 'null' }, { type: 'object', properties: { [allow]: {} } }] } } })
        json('schemas/project.schema.json', project)
        json('schemas/lane.schema.json', lane('allow'))
        json('schemas/examples/project.json', { format: 1, id: '3f9c2a7b1e04', effort: { T3: 'max' }, gates: { allow_workflows: ['deploy.yml'] } })
        json('lanes/web.json', { $schema: '../schemas/lane.schema.json', format: 1, name: 'web', ui_test: { allow: ['npx playwright test'] } })
        const clean = schemasLaw(root)
        json('schemas/event.schema.json', { required: ['ts'], properties: { format: { const: 1 }, ts: {} } })
        json('schemas/cost.schema.json', { required: ['format'], properties: { format: { type: 'integer' } } })
        json('schemas/project.schema.json', { ...project, properties: { ...project.properties, projectId: {} } })
        json('schemas/lane.schema.json', lane('allowList'))
        json('schemas/examples/project.json', { format: 1, id: '3f9c2a7b1e04', gates: { allowWorkflows: [] } })
        json('schemas/examples/lane.json', { format: 2, name: 'x' })
        json('schemas/examples/config.json', { format: 1 })
        json('lanes/service.json', { $schema: '../schemas/lane.schema.json', name: 'service', uiTest: null })
        const dirty = schemasLaw(root).problems
        return [
          ...k.none(clean.problems),
          ...(clean.schemas === 2 && clean.files === 2 ? [] : [`read ${clean.schemas} schemas and ${clean.files} files, not 2 and 2`]),
          ...k.has(
            dirty,
            "schemas: plugins/epikloop/schemas/event.schema.json doesn't require a format",
            "schemas: plugins/epikloop/schemas/cost.schema.json doesn't require a format",
            "schemas: plugins/epikloop/schemas/project.schema.json declares #/properties/projectId, which isn't snake_case",
            "schemas: plugins/epikloop/schemas/lane.schema.json declares #/properties/ui_test/oneOf/1/properties/allowList, which isn't snake_case",
            "schemas: plugins/epikloop/schemas/examples/project.json has the key gates.allowWorkflows, which isn't snake_case",
            "schemas: plugins/epikloop/schemas/examples/lane.json carries format 2, not its schema's 1",
            'schemas: plugins/epikloop/schemas/examples/config.json has no schema, config.schema.json',
            "schemas: plugins/epikloop/lanes/service.json carries no format, not its schema's 1",
            "schemas: plugins/epikloop/lanes/service.json has the key uiTest, which isn't snake_case",
          ),
          ...(dirty.length === 9 ? [] : [`found ${dirty.length}, not 9: ${JSON.stringify(dirty)}`]),
        ]
      },
    ],
    [
      'a plugin that tracks a top-level bin/ fails the layout',
      () => {
        const dir = k.repo()
        k.write(dir, 'plugins/epikloop/scripts/state.mjs', 'export {}\n')
        k.write(dir, 'plugins/epikloop/templates/tool/bin/run.mjs', 'export {}\n')
        k.write(dir, 'plugins/epikloop-harbor/.claude-plugin/plugin.json', '{}\n')
        k.write(dir, 'bin/tool.mjs', 'export {}\n')
        gitOk(dir, ['add', '-A'])
        k.write(dir, 'plugins/epikloop/bin/stray.mjs', 'export {}\n')
        const clean = layoutLaw(dir)
        k.write(dir, 'plugins/epikloop-harbor/bin/harbor', '#!/usr/bin/env node\n')
        gitOk(dir, ['add', '--', 'plugins/epikloop-harbor/bin/harbor'])
        const dirty = layoutLaw(dir).problems
        return [
          ...k.none(clean.problems),
          ...(clean.plugins === 2 ? [] : [`counted ${clean.plugins} plugins, not 2`]),
          ...k.has(dirty, 'layout: plugins/epikloop-harbor has a top-level bin/'),
          ...(dirty.length === 1 ? [] : [`found ${dirty.length}, not 1: ${JSON.stringify(dirty)}`]),
        ]
      },
    ],
    [
      'every commit but a merge is signed off by its author',
      () => {
        const dir = k.repo()
        k.commit(dir, `Start${SIGNED}`)
        const signed = signoffLaw(dir)
        gitOk(dir, ['switch', '-q', '-c', 'side'])
        k.commit(dir, `On the side${SIGNED}`)
        gitOk(dir, ['switch', '-q', 'main'])
        k.commit(dir, `On main${SIGNED}`)
        gitOk(dir, ['-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@example.com', 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side'])
        const merged = signoffLaw(dir)
        k.commit(dir, 'Unsigned')
        k.commit(dir, 'Signed by another\n\nSigned-off-by: Grace Hopper <grace@example.com>')
        const bad = signoffLaw(dir)
        return [
          ...k.none(signed.problems),
          ...k.none(merged.problems),
          ...(merged.commits === 3 ? [] : [`read ${merged.commits} commits, not the 3 that aren't merges`]),
          ...k.has(bad.problems, '"Unsigned" has no Signed-off-by line from its author', '"Signed by another" has no Signed-off-by line from its author'),
        ]
      },
    ],
    [
      'a shallow clone fails the sign-off',
      () => {
        const dir = k.repo()
        k.commit(dir, `One${SIGNED}`)
        k.commit(dir, `Two${SIGNED}`)
        const shallow = path.join(k.dir(), 'shallow')
        gitOk(temp, ['clone', '-q', '--depth', '1', pathToFileURL(dir).href, shallow])
        return k.has(signoffLaw(shallow).problems, 'this clone is shallow')
      },
    ],
    [
      'no commit credits an AI tool',
      () => {
        const dir = k.repo()
        k.commit(dir, `Human help\n\nClaude Code refused each part no rule allowed.\n\nCo-authored-by: Jane Doe <jane@example.com>${SIGNED}`)
        const clean = creditsLaw(dir).problems
        k.commit(dir, `Claude's trailer\n\nCo-authored-by: Claude <noreply@anthropic.com>${SIGNED}`)
        k.commit(dir, `Copilot's commit${SIGNED}`, { author: 'Copilot <198982749+Copilot@users.noreply.github.com>' })
        k.commit(dir, `The footer\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)${SIGNED}`)
        k.commit(dir, `A bot committer${SIGNED}`, { committer: 'cursoragent <cursoragent@cursor.com>' })
        return [
          ...k.none(clean),
          ...k.has(
            creditsLaw(dir).problems,
            `"Claude's trailer" has a Co-authored-by trailer for an AI tool`,
            `"Copilot's commit" is authored as an AI tool`,
            '"The footer" has a "Generated with" footer for an AI tool',
            '"A bot committer" is committed as an AI tool',
          ),
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
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`laws self-test: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {
  process.exitCode = 1
  try {
    if (process.argv[2] === '--self-test' && process.argv.length === 3) await selfTest()
    else if (process.argv.length > 2) console.log('usage: node tools/laws.mjs [--self-test]')
    else main()
  } catch (error) {
    console.log(`laws: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
