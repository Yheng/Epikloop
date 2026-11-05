// Epikloop's staging smoke. `node smoke.mjs [url]` sends one GET to the URL, or to the staging_url
// in the project's .epikloop/project.json, follows redirects, and prints one line: what answered and
// how fast. It exits 0 when the answer passes and 1 otherwise. It reaches only the URL it is given,
// and it never prints the credentials a URL may carry. retro and release run it; no hook does.
//
// Staging must also be the build at HEAD. Smoking the marker's staging_url reads the x-commit
// header staging sends, naming the commit it was built from, and passes only when that is the
// project's HEAD. A URL given as an argument, such as release's production smoke, is checked for
// its answer alone.
//
// `node smoke.mjs --self-test` runs every case below against a server on 127.0.0.1, in throwaway
// git repositories.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { gitReader, openProject, shownUrl } from './state.mjs'

// The cap on one smoke, in milliseconds. The self-test lowers it; nothing raises it.
const CAP = Math.min(15_000, Number(process.env.SMOKE_TIMEOUT_MS) || 15_000)

// The URL to smoke and the line to print when there is none. A staging_url comes with the project's
// root, where its HEAD is read.
function target(arg) {
  if (arg !== undefined) return { url: arg }
  const opened = openProject(process.cwd())
  const url = opened?.project?.staging_url
  if (typeof url === 'string' && url !== '') return { url, root: opened.root }
  return { none: opened === null ? 'smoke: no URL given, and this is not an Epikloop project' : 'smoke: no URL given, and .epikloop/project.json has no staging_url' }
}

// Which build answered at staging_url, against the project's HEAD: whether it passes, and the
// clause that ends the smoke's line. Git is only read here.
function servedCommit(root, value) {
  const git = gitReader(root)
  const head = git(['rev-parse', '--verify', '-q', 'HEAD'])?.trim()
  if (!head) return { pass: false, line: ', but this project has no commit to compare it with' }
  if (value === null) return { pass: false, line: ", but doesn't say which commit it serves: staging sends it as an x-commit header" }
  const id = value.trim().toLowerCase()
  if (!/^[0-9a-f]{7,40}$/.test(id)) return { pass: false, line: `, but its x-commit ${JSON.stringify(value)} isn't a commit id` }
  if (head.startsWith(id)) return { pass: true, line: `, from ${head.slice(0, 7)}, which is HEAD` }
  const commit = git(['rev-parse', '--verify', '-q', `${id}^{commit}`])?.trim()
  if (!commit) return { pass: false, line: `, but from ${id.slice(0, 7)}, which this repository doesn't have: fetch, then smoke again` }
  if (git(['merge-base', '--is-ancestor', commit, head]) === null) return { pass: false, line: `, but from ${commit.slice(0, 7)}, which HEAD doesn't contain` }
  const behind = Number(git(['rev-list', '--count', `${commit}..${head}`]))
  return { pass: false, line: `, but from ${commit.slice(0, 7)}, ${behind} commit${behind === 1 ? '' : 's'} behind HEAD (${head.slice(0, 7)}): restart or redeploy staging, then smoke again` }
}

async function smoke(argv) {
  if (argv.length > 1) return console.log('usage: node smoke.mjs [url]')
  const { url, root, none } = target(argv[0])
  if (none !== undefined) return console.log(none)
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return console.log(`smoke: ${shownUrl(url)} is not a URL`)
  }
  const shown = shownUrl(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return console.log(`smoke: ${shown} is not an http or https URL`)
  // fetch refuses a URL with credentials, so they travel as Basic auth, as a browser sends them.
  const headers = {}
  if (parsed.username !== '' || parsed.password !== '') {
    const pair = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
    headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`
    parsed.username = ''
    parsed.password = ''
  }
  const start = Date.now()
  let response
  try {
    response = await fetch(parsed, { headers, redirect: 'follow', signal: AbortSignal.timeout(CAP) })
    await response.arrayBuffer()
  } catch (error) {
    if (error?.name === 'TimeoutError') return console.log(`smoke: ${shown} didn't answer within ${CAP / 1000} s`)
    return console.log(`smoke: ${shown} couldn't be reached (${error?.cause?.code ?? error?.cause?.message ?? error?.message ?? error})`)
  }
  const ms = Date.now() - start
  const status = response.status
  const answered = `smoke: ${shown} answered ${status} in ${ms} ms`
  if (status < 200 || status >= 300) return console.log(answered)
  const served = root === undefined ? { pass: true, line: '' } : servedCommit(root, response.headers.get('x-commit'))
  console.log(`${answered}${served.line}`)
  if (served.pass) process.exitCode = 0
}

// ---- The self-test

async function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-smoke-'))
  // Git reads only this config, and finds no repository above the temporary folder.
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Self Test\n\temail = self-test@example.com\n[init]\n\tdefaultBranch = main\n')
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:GIT_.*|HOME|USERPROFILE)$/i.test(key)) env[key] = value
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_CEILING_DIRECTORIES: temp })
  const git = (dir, args) => {
    const done = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', windowsHide: true })
    if (done.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${done.stderr.trim()}`)
    return done.stdout.trim()
  }
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') return res.end('ok')
    if (req.url === '/down') return res.writeHead(503).end('down')
    if (req.url === '/moved') return res.writeHead(302, { location: '/ok' }).end()
    // A staging that names the commit it was built from.
    if (req.url.startsWith('/commit/')) return res.writeHead(200, { 'x-commit': decodeURIComponent(req.url.slice('/commit/'.length)) }).end('ok')
    if (req.url === '/private') {
      const allowed = req.headers.authorization === `Basic ${Buffer.from('someone:hunter 2').toString('base64')}`
      return res.writeHead(allowed ? 200 : 401).end()
    }
    // /slow never answers.
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  // A port that was open a moment ago and is closed now.
  const closed = await new Promise((resolve) => {
    const other = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = other.address()
      other.close(() => resolve(`http://127.0.0.1:${port}/`))
    })
  })
  const run = (args, { cwd = temp, cap } = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [import.meta.filename, ...args], { cwd, env: { ...env, ...(cap ? { SMOKE_TIMEOUT_MS: String(cap) } : {}) }, windowsHide: true })
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.on('close', (status) => resolve(`${status} ${out.replace(/ in \d+ ms/, ' in N ms')}`))
    })
  // A project with `commits` empty commits on main, run from its src folder below the root. Its
  // staging_url is `staging`, or what `staging` returns given the commits and the repository.
  const project = (commits, staging) => {
    const dir = fs.mkdtempSync(path.join(temp, 'project-'))
    git(dir, ['init', '-q'])
    const ids = []
    for (let n = 1; n <= commits; n++) {
      git(dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', `commit ${n}`])
      ids.push(git(dir, ['rev-parse', 'HEAD']))
    }
    const url = typeof staging === 'function' ? staging(ids, dir) : staging
    fs.mkdirSync(path.join(dir, '.epikloop'))
    fs.writeFileSync(path.join(dir, '.epikloop', 'project.json'), JSON.stringify({ format: 1, id: '000000000000', lane: 'web', mode: 'solo', ...(url === undefined ? {} : { staging_url: url }) }))
    fs.mkdirSync(path.join(dir, 'src'))
    return { cwd: path.join(dir, 'src'), ids }
  }
  const short = (id) => id.slice(0, 7)
  const failures = []
  let cases = []
  try {
    const head = project(2, (ids) => `${base}/commit/${ids[1]}`)
    const headShort = project(2, (ids) => `${base}/commit/${short(ids[1])}`)
    const behind = project(3, (ids) => `${base}/commit/${ids[0]}`)
    let side = ''
    const diverged = project(2, (ids, dir) => {
      git(dir, ['switch', '-q', '-c', 'side', ids[0]])
      git(dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', 'side'])
      side = git(dir, ['rev-parse', 'HEAD'])
      git(dir, ['switch', '-q', 'main'])
      return `${base}/commit/${side}`
    })
    const unknown = project(1, `${base}/commit/deadbeefdeadbeef`)
    const junk = project(1, `${base}/commit/v1.2`)
    const silent = project(1, `${base}/ok`)
    const empty = project(0, `${base}/commit/abc1234`)
    const down = project(1, `${base}/down`)
    const none = project(1, undefined)
    cases = [
      ['a 2xx answer passes', () => run([`${base}/ok`]), `0 smoke: ${base}/ok answered 200 in N ms\n`],
      ['a 503 fails', () => run([`${base}/down`]), `1 smoke: ${base}/down answered 503 in N ms\n`],
      ['a redirect is followed', () => run([`${base}/moved`]), `0 smoke: ${base}/moved answered 200 in N ms\n`],
      ['a server that never answers fails at the cap', () => run([`${base}/slow`], { cap: 300 }), `1 smoke: ${base}/slow didn't answer within 0.3 s\n`],
      ['a closed port fails', () => run([closed]), `1 smoke: ${closed} couldn't be reached (ECONNREFUSED)\n`],
      ["staging at HEAD passes, from below the project root", () => run([], head), `0 smoke: ${base}/commit/${head.ids[1]} answered 200 in N ms, from ${short(head.ids[1])}, which is HEAD\n`],
      ["a short id of HEAD passes", () => run([], headShort), `0 smoke: ${base}/commit/${short(headShort.ids[1])} answered 200 in N ms, from ${short(headShort.ids[1])}, which is HEAD\n`],
      ['staging behind HEAD fails', () => run([], behind), `1 smoke: ${base}/commit/${behind.ids[0]} answered 200 in N ms, but from ${short(behind.ids[0])}, 2 commits behind HEAD (${short(behind.ids[2])}): restart or redeploy staging, then smoke again\n`],
      ["a commit HEAD doesn't contain fails", () => run([], diverged), `1 smoke: ${base}/commit/${side} answered 200 in N ms, but from ${short(side)}, which HEAD doesn't contain\n`],
      ['a commit the repository lacks fails', () => run([], unknown), `1 smoke: ${base}/commit/deadbeefdeadbeef answered 200 in N ms, but from deadbee, which this repository doesn't have: fetch, then smoke again\n`],
      ["an x-commit that isn't a commit id fails", () => run([], junk), `1 smoke: ${base}/commit/v1.2 answered 200 in N ms, but its x-commit "v1.2" isn't a commit id\n`],
      ["a staging that doesn't name its commit fails", () => run([], silent), `1 smoke: ${base}/ok answered 200 in N ms, but doesn't say which commit it serves: staging sends it as an x-commit header\n`],
      ['a project with no commit fails', () => run([], empty), `1 smoke: ${base}/commit/abc1234 answered 200 in N ms, but this project has no commit to compare it with\n`],
      ["a staging that doesn't answer 2xx isn't asked for its commit", () => run([], down), `1 smoke: ${base}/down answered 503 in N ms\n`],
      ['a URL given is checked for its answer alone', () => run([`${base}/ok`], silent), `0 smoke: ${base}/ok answered 200 in N ms\n`],
      ['no staging_url', () => run([], none), '1 smoke: no URL given, and .epikloop/project.json has no staging_url\n'],
      ['outside a project', () => run([]), '1 smoke: no URL given, and this is not an Epikloop project\n'],
      ['credentials travel as Basic auth', () => run([`http://someone:hunter%202@127.0.0.1:${new URL(base).port}/private`]), `0 smoke: ${base}/private answered 200 in N ms\n`],
      ['credentials are never printed', () => run([`http://someone:wrong@127.0.0.1:${new URL(base).port}/private`]), `1 smoke: ${base}/private answered 401 in N ms\n`],
      ['only http and https', () => run(['file:///etc/passwd']), '1 smoke: file:///etc/passwd is not an http or https URL\n'],
      ['one URL at most', () => run(['a', 'b']), '1 usage: node smoke.mjs [url]\n'],
    ]
    for (const [name, go, wanted] of cases) {
      const got = await go()
      if (got !== wanted) failures.push(`${name}: got ${JSON.stringify(got)}, not ${JSON.stringify(wanted)}`)
    }
  } finally {
    server.closeAllConnections()
    server.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`smoke self-test: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {
  process.exitCode = 1
  try {
    if (process.argv[2] === '--self-test') await selfTest()
    else await smoke(process.argv.slice(2))
  } catch (error) {
    console.log(`smoke: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
