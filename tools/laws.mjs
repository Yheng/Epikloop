// This repository's laws: the constitution's rules that a script can check, run over the
// repository this file is in. `node tools/laws.mjs` prints each failure, then one summary line, and
// exits 1 on any failure.
//
//   ceiling     the core plugin's model-facing text stays within 700 lines (article 2)
//   shell       the one shell file is the check.sh shim (article 7)
//   network     hook and Harbor code makes no network call (article 6)
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
  const run = spawnSync(process.execPath, [path.join(plugin, 'bin', script), ...words], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true })
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
      const call = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/([\w.-]+)"(.*)$/.exec(command)
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
  const brief = read(path.join(plugin, 'bin', 'brief.mjs'))
  const pieces = [/const PROTOCOL = `((?:\\.|[^`\\])*)`/, /const OUTSIDE = '((?:\\.|[^'\\])*)'/, /const failure = \(reason\) =>\s*`((?:\\.|[^`\\])*)`/].map((re) => re.exec(brief)?.[1])
  if (pieces.some((piece) => piece === undefined)) problems.push("ceiling: bin/brief.mjs's protocol, outside line or failure line isn't where the ceiling reads it")
  else rows.push([pieces.reduce((sum, piece) => sum + lineCount(piece), 0), 'bin/brief.mjs (the protocol, the outside line and the failure line)'])
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

// Every tracked file that is a shell script, by its name or its #! line, other than the shim.
export function shellLaw(root) {
  const files = gitOk(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const problems = files
    .filter((file) => !SHIMS.includes(file) && (SHELL_NAME.test(file) || SHELL_LINE.test(firstLine(path.join(root, file)))))
    .map((file) => `shell: ${file} is a shell script; Epikloop's scripts are Node, and scripts/check.sh is the one shim`)
  return { problems }
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
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      for (const [re, what] of NETWORK) if (re.test(line)) problems.push(`network: ${shown}:${i + 1} uses ${what}; hook and Harbor code makes no network call`)
    }
    for (const match of text.matchAll(RELATIVE_IMPORT)) queue.push(path.resolve(path.dirname(file), match[1]))
  }
  return { files: seen.size, problems }
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
  const law = (name, body) => {
    try {
      const { problems, shown } = body()
      failures.push(...problems)
      parts.push(shown ?? `${name} ${problems.length === 0 ? 'ok' : `FAIL ${problems.length}`}`)
    } catch (error) {
      failures.push(`${name}: ${String(error?.message ?? error).split('\n')[0]}`)
      parts.push(`${name} FAIL`)
    }
  }
  law('ceiling', () => {
    const { count, problems } = ceilingLaw(path.join(ROOT, 'plugins', 'epikloop'))
    return { problems, shown: `ceiling ${count}/${CEILING}${problems.length > 0 ? ' FAIL' : ''}` }
  })
  law('shell', () => shellLaw(ROOT))
  law('network', () => {
    const { files, problems } = networkLaw(ROOT)
    return { problems, shown: `network ${problems.length === 0 ? 'ok' : `FAIL ${problems.length}`} (${files} files)` }
  })
  law('sign-off', () => {
    const { commits: count, problems } = signoffLaw(ROOT)
    return { problems, shown: `sign-off ${problems.length === 0 ? 'ok' : `FAIL ${problems.length}`} (${count} commits)` }
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
    k.write(dir, 'skills/a/SKILL.md', `---\ndescription: One line.\neffort: low\n---\n\nBody line one.\n\n${'x'.repeat(250)}\n\n!\`node "\${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --example spec\`\n\n!\`node "\${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --lane plan\`\n`)
    k.write(dir, 'skills/a/notes.md', 'Note one.\nNote two.\n')
    k.write(dir, 'agents/w.md', '---\nname: w\ndescription: "Two words."\n---\n\nAgent body.\n')
    k.write(dir, 'lanes/web.md', '## Plan\n\nPlan text.\n')
    k.write(dir, 'lanes/web.json', '{"not": "counted"}\n')
    k.write(dir, 'templates/CLAUDE.template.md', '# Rules\n\nKeep it short.\n')
    k.write(dir, 'bin/brief.mjs', "const OUTSIDE = 'Outside, `/x`.'\nconst PROTOCOL = `P one\nP two`\nconst failure = (reason) => `It failed (${reason}); \\`/x\\` helps.`\n")
    k.write(dir, 'bin/state.mjs', "const [flag, name] = process.argv.slice(2)\nif (flag === '--example' && name === 'spec') console.log('E one\\nE two')\nelse if (flag === '--lanes') console.log('- web: a lane')\nelse process.exitCode = 1\n")
    return dir
  }
  // A repository whose hook code is clean unless `files` says otherwise.
  const networkRepo = (files = {}) => {
    const root = k.dir()
    const defaults = {
      'plugins/epikloop/hooks/hooks.json': JSON.stringify({ modules: ['./emit.js'], hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/brief.mjs'] }] }] } }),
      'plugins/epikloop/hooks/emit.js': 'export default function setup() {}\n',
      'plugins/epikloop/bin/brief.mjs': "import { a } from './helper.mjs'\nconst later = await import('./late.mjs')\n",
      'plugins/epikloop/bin/helper.mjs': 'export const a = 1\n',
      'plugins/epikloop/bin/late.mjs': 'export const b = 2\n',
      'plugins/epikloop/bin/smoke.mjs': 'const answer = await fetch(process.argv[2])\n',
      'plugins/epikloop/templates/githooks/check.mjs': "// Nothing is fetched here.\nimport fs from 'node:fs'\n",
      'plugins/epikloop/templates/githooks/pre-commit': "#!/usr/bin/env node\nimport('./check.mjs')\n",
      'plugins/epikloop-harbor/.claude-plugin/plugin.json': '{}\n',
    }
    for (const [file, content] of Object.entries({ ...defaults, ...files })) k.write(root, file, content)
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
        k.write(dir, 'skills/b/SKILL.md', '---\ndescription: B.\n---\n\n!`node "${CLAUDE_PLUGIN_ROOT}/bin/init.mjs" --help`\n!`git status`\n')
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
        k.write(dir, 'bin/brief.mjs', 'export const text = 1\n')
        return k.has(ceilingLaw(dir).problems, "isn't where the ceiling reads it")
      },
    ],
    [
      'the one shell file is the shim',
      () => {
        const dir = k.repo()
        k.write(dir, 'plugins/epikloop/templates/scripts/check.sh', '#!/bin/sh\nexec node x\n')
        k.write(dir, 'plugins/epikloop/templates/githooks/pre-commit', '#!/usr/bin/env node\nimport("./check.mjs")\n')
        k.write(dir, 'plugins/epikloop/bin/tool.mjs', '#!/usr/bin/env node\n')
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
      "clean hook code passes, though a script no hook reaches fetches",
      () => {
        const { files, problems } = networkLaw(networkRepo())
        return [...k.none(problems), ...(files === 6 ? [] : [`read ${files} files, not 6`])]
      },
    ],
    ...[
      ['a helper a hook imports', { 'plugins/epikloop/bin/helper.mjs': 'export const a = await fetch(url)\n' }, 'network: plugins/epikloop/bin/helper.mjs:1 uses fetch()'],
      ['a module a hook imports late', { 'plugins/epikloop/bin/late.mjs': 'export const b = new WebSocket(url)\n' }, 'network: plugins/epikloop/bin/late.mjs:1 uses WebSocket'],
      ['the hooks module', { 'plugins/epikloop/hooks/emit.js': "import https from 'node:https'\n" }, 'network: plugins/epikloop/hooks/emit.js:1 uses a network module'],
      ['the gate runner', { 'plugins/epikloop/templates/githooks/check.mjs': "const http = require('http')\n" }, 'network: plugins/epikloop/templates/githooks/check.mjs:1 uses a network module'],
      ['Harbor', { 'plugins/epikloop-harbor/server/feed.mjs': 'const feed = new EventSource(url)\n' }, 'network: plugins/epikloop-harbor/server/feed.mjs:1 uses EventSource'],
    ].map(([where, files, text]) => [`a network call in ${where} fails`, () => k.has(networkLaw(networkRepo(files)).problems, text)]),
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
