// Epikloop's staging smoke. `node smoke.mjs [url]` sends one GET to the URL, or to the staging_url
// in the project's .epikloop/project.json, follows redirects, and prints one line: what answered and
// how fast. It exits 0 on a 2xx answer and 1 otherwise. It reaches only the URL it is given, and it
// never prints the credentials a URL may carry. retro and release run it; no hook does.
//
// `node smoke.mjs --self-test` runs every case below against a server on 127.0.0.1.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { openProject, shownUrl } from './state.mjs'

// The cap on one smoke, in milliseconds. The self-test lowers it; nothing raises it.
const CAP = Math.min(15_000, Number(process.env.SMOKE_TIMEOUT_MS) || 15_000)

// The URL to smoke and the line to print when there is none.
function target(arg) {
  if (arg !== undefined) return { url: arg }
  const opened = openProject(process.cwd())
  const url = opened?.project?.staging_url
  if (typeof url === 'string' && url !== '') return { url }
  return { none: opened === null ? 'smoke: no URL given, and this is not an Epikloop project' : 'smoke: no URL given, and .epikloop/project.json has no staging_url' }
}

async function smoke(argv) {
  if (argv.length > 1) return console.log('usage: node smoke.mjs [url]')
  const { url, none } = target(argv[0])
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
  console.log(`smoke: ${shown} answered ${status} in ${ms} ms`)
  if (status >= 200 && status < 300) process.exitCode = 0
}

// ---- The self-test

async function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-smoke-'))
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') return res.end('ok')
    if (req.url === '/down') return res.writeHead(503).end('down')
    if (req.url === '/moved') return res.writeHead(302, { location: '/ok' }).end()
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
      const env = { ...process.env, ...(cap ? { SMOKE_TIMEOUT_MS: String(cap) } : {}) }
      const child = spawn(process.execPath, [import.meta.filename, ...args], { cwd, env, windowsHide: true })
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.on('close', (status) => resolve(`${status} ${out.replace(/ in \d+ ms/, ' in N ms')}`))
    })
  const project = (fields) => {
    const dir = fs.mkdtempSync(path.join(temp, 'project-'))
    fs.mkdirSync(path.join(dir, '.epikloop'))
    fs.writeFileSync(path.join(dir, '.epikloop', 'project.json'), JSON.stringify({ format: 1, id: '000000000000', lane: 'web', mode: 'solo', ...fields }))
    fs.mkdirSync(path.join(dir, 'src'))
    return path.join(dir, 'src')
  }
  const cases = [
    ['a 2xx answer passes', () => run([`${base}/ok`]), `0 smoke: ${base}/ok answered 200 in N ms\n`],
    ['a 503 fails', () => run([`${base}/down`]), `1 smoke: ${base}/down answered 503 in N ms\n`],
    ['a redirect is followed', () => run([`${base}/moved`]), `0 smoke: ${base}/moved answered 200 in N ms\n`],
    ['a server that never answers fails at the cap', () => run([`${base}/slow`], { cap: 300 }), `1 smoke: ${base}/slow didn't answer within 0.3 s\n`],
    ['a closed port fails', () => run([closed]), `1 smoke: ${closed} couldn't be reached (ECONNREFUSED)\n`],
    ["the marker's staging_url, from below the project root", () => run([], { cwd: project({ staging_url: `${base}/ok` }) }), `0 smoke: ${base}/ok answered 200 in N ms\n`],
    ['no staging_url', () => run([], { cwd: project({}) }), '1 smoke: no URL given, and .epikloop/project.json has no staging_url\n'],
    ['outside a project', () => run([]), '1 smoke: no URL given, and this is not an Epikloop project\n'],
    ['credentials travel as Basic auth', () => run([`http://someone:hunter%202@127.0.0.1:${new URL(base).port}/private`]), `0 smoke: ${base}/private answered 200 in N ms\n`],
    ['credentials are never printed', () => run([`http://someone:wrong@127.0.0.1:${new URL(base).port}/private`]), `1 smoke: ${base}/private answered 401 in N ms\n`],
    ['only http and https', () => run(['file:///etc/passwd']), '1 smoke: file:///etc/passwd is not an http or https URL\n'],
    ['one URL at most', () => run(['a', 'b']), '1 usage: node smoke.mjs [url]\n'],
  ]
  const failures = []
  try {
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

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  process.exitCode = 1
  try {
    if (process.argv[2] === '--self-test') await selfTest()
    else await smoke(process.argv.slice(2))
  } catch (error) {
    console.log(`smoke: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
