// Checks the Harbor plugin as it ships, on whatever system runs it: its start-of-session hook and
// the build copied from Harbor. Each case runs the hook in a throwaway home, on a free port:
//
// - With the flag on, the hook starts Harbor and answers nothing. The server answers its health,
//   its page, its art and its event stream, and turning the flag off stops it.
// - With the flag off, or a config that doesn't parse, the hook starts nothing.
// - When Harbor can't start, the hook says so in its JSON answer, and still exits 0.
// - Each time, the hook records where the plugin is, for /epikloop:harbor.
//
// This is the repository's own check, which no plugin ships, so it reaches Harbor over 127.0.0.1.
//
//   node tools/harbor.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLUGIN = path.join(ROOT, 'plugins', 'epikloop-harbor')
const HOOK = path.join(PLUGIN, 'scripts', 'session.mjs')
// Harbor reads the flag every second and exits within 2 seconds of it turning off.
const STOPS = 4000

// The environment the hook gets: this one, without Harbor's or Claude Code's own variables.
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:HARBOR_.*|CLAUDE_.*|HOME|USERPROFILE)$/i.test(key)))

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function get(url, ms = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ms) })
    return { status: response.status, type: response.headers.get('content-type') ?? '', body: Buffer.from(await response.arrayBuffer()) }
  } catch {
    return null
  }
}

// The event stream's opening, up to its first state event, or null.
async function opening(url) {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), 5000)
  try {
    const response = await fetch(url, { signal: stop.signal })
    if (!(response.headers.get('content-type') ?? '').startsWith('text/event-stream')) return null
    const reader = response.body.getReader()
    let text = ''
    while (!text.includes('event: state')) {
      const { value, done } = await reader.read()
      if (done) break
      text += Buffer.from(value).toString('utf8')
    }
    return text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    stop.abort()
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-harbor-'))
  const homes = []
  const k = {
    // A home with ~/.epikloop/config.json holding `config`, written as given when it's a string.
    home(config) {
      const home = path.join(temp, `home-${homes.length + 1}`)
      fs.mkdirSync(path.join(home, '.epikloop', 'events'), { recursive: true })
      if (config !== undefined) fs.writeFileSync(path.join(home, '.epikloop', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config))
      homes.push(home)
      return home
    },
    hook(home, env = {}) {
      const run = spawnSync(process.execPath, [HOOK], { cwd: home, env: { ...clean, HOME: home, USERPROFILE: home, ...env }, encoding: 'utf8', timeout: 15000, windowsHide: true })
      return { status: run.status, out: run.stdout ?? '', error: run.error?.message ?? (run.stderr ?? '').trim() }
    },
    // What the hook recorded as the plugin's place, as a problem list.
    pointer(home) {
      let pointer
      try {
        pointer = JSON.parse(fs.readFileSync(path.join(home, '.epikloop', 'harbor.json'), 'utf8'))
      } catch {
        return ["the hook didn't record where the plugin is"]
      }
      const same = typeof pointer.root === 'string' && fs.existsSync(pointer.root) && fs.realpathSync.native(pointer.root) === fs.realpathSync.native(PLUGIN)
      return pointer.format === 1 && same ? [] : [`the hook recorded ${JSON.stringify(pointer)}, not this plugin`]
    },
    quiet: (run) => (run.status === 0 && run.out === '' ? [] : [`the hook exited ${run.status} and printed ${JSON.stringify(run.out)}${run.error ? ` (${run.error})` : ''}`]),
    async down(port) {
      for (const end = Date.now() + STOPS; Date.now() < end; await pause(200)) if ((await get(`http://127.0.0.1:${port}/health`, 500)) === null) return []
      return [`Harbor still answers on ${port} ${STOPS / 1000} seconds after its flag turned off`]
    },
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'))
  const cases = [
    [
      'with the flag on, the hook starts Harbor, which answers until the flag turns off',
      async () => {
        const home = k.home({ format: 1, harbor: true })
        const port = await freePort()
        const base = `http://127.0.0.1:${port}`
        const first = k.hook(home, { HARBOR_PORT: String(port) })
        const problems = [...k.quiet(first), ...k.pointer(home)]
        const health = await get(`${base}/health`)
        let app = null
        try {
          app = JSON.parse(health?.body.toString('utf8') ?? 'null')
        } catch {}
        if (health?.status !== 200 || app?.app !== 'epikloop-harbor' || app?.version !== manifest.version) problems.push(`/health answered ${health === null ? 'nothing' : `${health.status} ${JSON.stringify(health.body.toString('utf8'))}`}, not epikloop-harbor ${manifest.version}`)
        const page = await get(`${base}/`)
        if (page?.status !== 200 || !page.type.startsWith('text/html')) problems.push(`/ answered ${page?.status ?? 'nothing'} ${page?.type ?? ''}`)
        const art = await get(`${base}/art/office.png`)
        const office = fs.readFileSync(path.join(PLUGIN, 'client', 'art', 'office.png'))
        if (art?.status !== 200 || art.type !== 'image/png' || !art.body.equals(office)) problems.push(`/art/office.png answered ${art?.status ?? 'nothing'} ${art?.type ?? ''}, not the plugin's office.png`)
        const stream = await opening(`${base}/events`)
        if (stream === null || !stream.startsWith('retry: 2000')) problems.push(`/events opened ${JSON.stringify(stream)}`)
        problems.push(...k.quiet(k.hook(home, { HARBOR_PORT: String(port) })).map((problem) => `again, with Harbor running: ${problem}`))
        fs.writeFileSync(path.join(home, '.epikloop', 'config.json'), JSON.stringify({ format: 1, harbor: false }))
        problems.push(...(await k.down(port)))
        return problems
      },
    ],
    [
      "with the flag off, or no config, or one that doesn't parse, the hook starts nothing, and doesn't wait",
      async () => {
        const problems = []
        for (const config of [{ format: 1, harbor: false }, undefined, '{ "format": 1, "harbor": tr']) {
          const home = k.home(config)
          const port = await freePort()
          const began = Date.now()
          problems.push(...k.quiet(k.hook(home, { HARBOR_PORT: String(port) })), ...k.pointer(home))
          // Harbor itself gives a config that doesn't parse 5 seconds before it counts it as off;
          // the hook doesn't hold the session for that.
          const took = Date.now() - began
          if (took > 2500) problems.push(`the hook took ${took} ms with config ${JSON.stringify(config)}`)
          if ((await get(`http://127.0.0.1:${port}/health`, 1000)) !== null) problems.push(`Harbor answers with config ${JSON.stringify(config)}`)
        }
        return problems
      },
    ],
    [
      "when Harbor can't start, the hook says why in its answer and still exits 0",
      async () => {
        const home = k.home({ format: 1, harbor: true })
        const run = k.hook(home, { HARBOR_PORT: 'not-a-port' })
        let answer = null
        try {
          answer = JSON.parse(run.out)
        } catch {}
        const said = typeof answer?.systemMessage === 'string' && answer.systemMessage.startsWith("Harbor didn't start: ") && answer.systemMessage.includes('HARBOR_PORT')
        return run.status === 0 && said && Object.keys(answer).length === 1 ? [] : [`the hook exited ${run.status} and printed ${JSON.stringify(run.out)}`]
      },
    ],
    [
      'the hook records the plugin it runs from, over an older record',
      async () => {
        const home = k.home({ format: 1, harbor: false })
        fs.writeFileSync(path.join(home, '.epikloop', 'harbor.json'), JSON.stringify({ format: 1, root: path.join(temp, 'gone') }))
        return [...k.quiet(k.hook(home)), ...k.pointer(home)]
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
    // A Harbor still running holds its home as its working folder, so each is turned off first.
    for (const home of homes) fs.writeFileSync(path.join(home, '.epikloop', 'config.json'), JSON.stringify({ format: 1, harbor: false }))
    await pause(homes.length > 0 ? 2500 : 0)
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`harbor check: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (process.argv.length > 2) {
  console.log('usage: node tools/harbor.mjs')
  process.exitCode = 1
} else {
  await main()
}
