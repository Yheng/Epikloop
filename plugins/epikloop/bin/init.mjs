// Epikloop's project setup. `node init.mjs --lane <lane> --mode solo|team` makes the git repository
// it runs in an Epikloop project: it writes .epikloop/project.json with the project id, copies the
// gate runner and its shims from the plugin's templates, stages what it wrote, and arms the hooks.
// It never overwrites a file and never commits. It prints one summary line, and exits 1 only when
// it couldn't do its job.
//
// `node init.mjs --self-test` runs every case below against throwaway repositories.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const USAGE = 'usage: node init.mjs --lane <lane> --mode solo|team'
const TEMPLATES = path.join(import.meta.dirname, '..', 'templates')
const RUNNER = path.join(TEMPLATES, 'githooks', 'check.mjs')
// Each gate file, the template it is copied from, and whether it is a shim git must run as a
// program.
const GATE_FILES = [
  ['.githooks/check.mjs', 'githooks/check.mjs', false],
  ['.githooks/pre-commit', 'githooks/pre-commit', true],
  ['.githooks/pre-push', 'githooks/pre-push', true],
  ['scripts/check.sh', 'scripts/check.sh', true],
]
const POSIX = process.platform !== 'win32'

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
      const project = JSON.parse(fs.readFileSync(marker, 'utf8'))
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
      if (!fs.readFileSync(target).equals(content)) differ.push(file)
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
  if (differ.length > 0) parts.push(`kept ${differ.join(', ')}, which ${differ.length === 1 ? 'differs' : 'differ'} from the plugin's template`)

  // Git on Windows adds a file Node wrote as 100644, and the shims gate wants 100755.
  const plain = wrote.filter((file) => !shims.includes(file))
  if (plain.length > 0) gitOk(top, ['add', '--', ...plain])
  if (shims.length > 0) gitOk(top, ['add', '--chmod=+x', '--', ...shims])
  if (plain.length + shims.length > 0) parts.push('staged')

  const armed = arm(top)
  if (armed) parts.push(armed)
  if (mode === 'team') parts.push("the team-mode workflow isn't laid down yet")
  console.log(`init: ${parts.join(' · ')}`)
  process.exitCode = 0
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)

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
      if (run.stdout.includes('team-mode')) problems.push("speaks of team mode, which the kept marker doesn't use")
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
      const problems = k.says(run, "kept .githooks/check.mjs, which differs from the plugin's template")
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
      const problems = k.says(run, '.githooks/ and scripts/check.sh written · staged · git hooks: armed (.githooks)')
      for (const [file, template, shim] of GATE_FILES) {
        if (!fs.readFileSync(path.join(dir, file)).equals(fs.readFileSync(path.join(TEMPLATES, template)))) {
          problems.push(`${file} is not its template`)
        }
        if (POSIX && shim && (fs.statSync(path.join(dir, file)).mode & 0o111) === 0) problems.push(`${file} is not executable`)
      }
      const staged = k.git(dir, 'ls-files', '-s').stdout
      for (const [file, , shim] of GATE_FILES) {
        const mode = shim ? '100755' : '100644'
        if (!new RegExp(`^${mode} \\S+ 0\\t${file.replace(/\./g, '\\.')}$`, 'm').test(staged)) problems.push(`${file} is not staged as ${mode}`)
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
  ['team mode', (k) => k.says(k.init(k.repo(), ['--lane', 'web', '--mode', 'team']), "the team-mode workflow isn't laid down yet")],
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

process.exitCode = 1
try {
  if (process.argv[2] === '--self-test') await selfTest()
  else init(process.argv.slice(2))
} catch (error) {
  console.log(`init: ${String(error?.message ?? error).split('\n')[0]}`)
  process.exitCode = 1
}
