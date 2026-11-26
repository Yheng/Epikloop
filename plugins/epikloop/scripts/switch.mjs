// Harbor's switch, behind /epikloop:harbor. `on` and `off` set the harbor flag in
// ~/.epikloop/config.json, keeping every other key, and `on` then starts Harbor. `open` starts it if
// it isn't running and opens it in the browser. Off, Harbor stops by itself within 2 seconds.
//
// Harbor lives in the optional epikloop-harbor plugin, and a plugin can't reach another plugin's
// files, so Harbor's start-of-session hook records where it is installed, in
// ~/.epikloop/harbor.json. Without that record, the answer is how to get the plugin to run:
// installed from the marketplace, or loaded from its folder as the core may be.
//
//   node switch.mjs on|off|open
//   node switch.mjs --self-test
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(import.meta.url)

// How Harbor's plugin comes to run in a session: installed from the marketplace, or, where the
// core is loaded from a folder with --plugin-dir, loaded the same way beside it. `here` is the
// folder of the core's scripts, and Harbor's folder is named when it lies beside the core's, as
// in a checkout. doctor gives the same advice.
export function installAdvice(here = path.dirname(FILE)) {
  const beside = path.join(here, '..', '..', 'epikloop-harbor')
  const folder = fs.existsSync(path.join(beside, 'harbor.mjs')) ? `"${beside}"` : "<the epikloop-harbor plugin's folder>"
  return `install it with \`claude plugin install epikloop-harbor@epikloop\`, or, where the core is loaded with \`--plugin-dir\`, add a second \`--plugin-dir ${folder}\`, and then start a new session`
}
const missing = (here) => `its plugin, epikloop-harbor, hasn't run in a session here: ${installAdvice(here)}`

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

// What the switch does for `command` in `home`: { code, text }, the exit code and what to print.
// `here` is the folder of the core's scripts, for the advice.
export function flip(command, home, here = path.dirname(FILE)) {
  if (!['on', 'off', 'open'].includes(command)) return { code: 1, text: 'usage: node switch.mjs on|off|open' }
  const dir = path.join(home, '.epikloop')
  if (command !== 'open') {
    const file = path.join(dir, 'config.json')
    let config = { format: 1 }
    if (fs.existsSync(file)) {
      config = readJson(file)
      if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return { code: 1, text: `harbor: ${file} doesn't parse, so the flag is unchanged; correct the file, then run this again` }
      }
    }
    config.harbor = command === 'on'
    fs.mkdirSync(dir, { recursive: true })
    const part = `${file}.${process.pid}.tmp`
    fs.writeFileSync(part, `${JSON.stringify(config, null, 2)}\n`)
    fs.renameSync(part, file)
    if (command === 'off') return { code: 0, text: 'harbor: Harbor is off; it stops within 2 seconds, and no session starts it again until /epikloop:harbor on' }
  }
  const root = readJson(path.join(dir, 'harbor.json'))?.root
  const harbor = typeof root === 'string' ? path.join(root, 'harbor.mjs') : null
  if (harbor === null || !fs.existsSync(harbor)) {
    return {
      code: 0,
      text:
        command === 'on'
          ? `harbor: Harbor is on, but ${missing(here)}, which starts it. \`/epikloop:harbor off\` turns it off again.`
          : `harbor: Harbor can't open, because ${missing(here)}. \`/epikloop:harbor off\` turns Harbor off.`,
    }
  }
  const run = spawnSync(process.execPath, [harbor, command === 'on' ? 'start' : 'open'], { cwd: home, encoding: 'utf8', timeout: 15000, windowsHide: true })
  const said = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim()
  return { code: run.status ?? 1, text: said || `harbor: harbor.mjs ${command === 'on' ? 'start' : 'open'} ended with ${run.signal ?? run.status}, saying nothing` }
}

// ---- The self-test

function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-switch-'))
  let made = 0
  // A stand-in for Harbor's harbor.mjs: it says which command it was given, records it, and fails
  // when its folder holds a file named fail.
  const standIn = path.join(temp, 'stand-in')
  fs.mkdirSync(standIn)
  const calls = path.join(standIn, 'calls.txt')
  fs.writeFileSync(
    path.join(standIn, 'harbor.mjs'),
    [
      "import fs from 'node:fs'",
      "import path from 'node:path'",
      'const [command] = process.argv.slice(2)',
      "fs.appendFileSync(path.join(import.meta.dirname, 'calls.txt'), `${command}\\n`)",
      "if (fs.existsSync(path.join(import.meta.dirname, 'fail'))) { console.error(`harbor: can't listen on 127.0.0.1:4747 (EACCES)`); process.exitCode = 1 }",
      'else console.log(`harbor: stand-in ${command}`)',
      '',
    ].join('\n'),
  )
  const k = {
    // A home whose config.json holds `config` (a string as written) and whose pointer names `root`.
    home({ config, root = standIn } = {}) {
      made += 1
      const home = path.join(temp, `home-${made}`)
      fs.mkdirSync(path.join(home, '.epikloop'), { recursive: true })
      if (config !== undefined) fs.writeFileSync(path.join(home, '.epikloop', 'config.json'), typeof config === 'string' ? config : `${JSON.stringify(config, null, 2)}\n`)
      if (root !== null) fs.writeFileSync(path.join(home, '.epikloop', 'harbor.json'), JSON.stringify({ format: 1, root }))
      return home
    },
    // Runs the switch as the skill does, with `home` as the home Node finds.
    run(home, ...args) {
      fs.rmSync(calls, { force: true })
      const run = spawnSync(process.execPath, [FILE, ...args], { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', windowsHide: true })
      let called = []
      try {
        called = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean)
      } catch {}
      return { code: run.status, out: run.stdout, called }
    },
    config: (home) => fs.readFileSync(path.join(home, '.epikloop', 'config.json'), 'utf8'),
    expect: (pairs) => pairs.filter(([actual, wanted]) => JSON.stringify(actual) !== JSON.stringify(wanted)).map(([actual, wanted]) => `got ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`),
  }
  // The advice names Harbor's folder where it lies beside the core's, as it does in this checkout
  // when the switch runs from here, and says what to name where it doesn't.
  const beside = path.join(path.dirname(FILE), '..', '..', 'epikloop-harbor')
  const install = `install it with \`claude plugin install epikloop-harbor@epikloop\`, or, where the core is loaded with \`--plugin-dir\`, add a second \`--plugin-dir "${beside}"\`, and then start a new session`
  const cases = [
    [
      'on, with no config yet, writes the flag and starts Harbor',
      () => {
        const home = k.home()
        const on = k.run(home, 'on')
        return k.expect([
          [on, { code: 0, out: 'harbor: stand-in start\n', called: ['start'] }],
          [k.config(home), '{\n  "format": 1,\n  "harbor": true\n}\n'],
        ])
      },
    ],
    [
      'on and off keep every other key, and off starts nothing',
      () => {
        const home = k.home({ config: { $schema: 'https://example.com/config.schema.json', format: 1, effort: { T1: 'low' }, harbor: false } })
        const on = k.run(home, 'on')
        const afterOn = JSON.parse(k.config(home))
        const off = k.run(home, 'off')
        return k.expect([
          [on.called, ['start']],
          [afterOn, { $schema: 'https://example.com/config.schema.json', format: 1, effort: { T1: 'low' }, harbor: true }],
          [off, { code: 0, out: 'harbor: Harbor is off; it stops within 2 seconds, and no session starts it again until /epikloop:harbor on\n', called: [] }],
          [JSON.parse(k.config(home)), { $schema: 'https://example.com/config.schema.json', format: 1, effort: { T1: 'low' }, harbor: false }],
        ])
      },
    ],
    [
      'open opens Harbor and leaves the flag as it is',
      () => {
        const written = '{"format":1,"harbor":false}'
        const home = k.home({ config: written })
        return k.expect([
          [k.run(home, 'open'), { code: 0, out: 'harbor: stand-in open\n', called: ['open'] }],
          [k.config(home), written],
        ])
      },
    ],
    [
      "without a record of Harbor's plugin, or with one whose folder is gone, it says both ways to load it, and how to turn Harbor off",
      () => {
        const none = k.home({ root: null })
        const gone = k.home({ root: path.join(temp, 'gone') })
        return k.expect([
          [k.run(none, 'on'), { code: 0, out: `harbor: Harbor is on, but its plugin, epikloop-harbor, hasn't run in a session here: ${install}, which starts it. \`/epikloop:harbor off\` turns it off again.\n`, called: [] }],
          [JSON.parse(k.config(none)).harbor, true],
          [k.run(gone, 'open'), { code: 0, out: `harbor: Harbor can't open, because its plugin, epikloop-harbor, hasn't run in a session here: ${install}. \`/epikloop:harbor off\` turns Harbor off.\n`, called: [] }],
        ])
      },
    ],
    [
      "the advice names Harbor's folder only where it lies beside the core's",
      () => {
        // A core plugin's scripts folder with Harbor's plugin beside it, and one without.
        const scripts = (name, harbor) => {
          const here = path.join(temp, name, 'epikloop', 'scripts')
          fs.mkdirSync(here, { recursive: true })
          if (harbor) {
            fs.mkdirSync(path.join(temp, name, 'epikloop-harbor'))
            fs.writeFileSync(path.join(temp, name, 'epikloop-harbor', 'harbor.mjs'), '')
          }
          return here
        }
        const [checkout, installed] = [scripts('checkout', true), scripts('installed', false)]
        const said = flip('open', k.home({ root: null }), installed).text
        return k.expect([
          [installAdvice(checkout).includes(`add a second \`--plugin-dir "${path.join(temp, 'checkout', 'epikloop-harbor')}"\``), true],
          [installAdvice(installed).includes("add a second `--plugin-dir <the epikloop-harbor plugin's folder>`"), true],
          [said.includes("`--plugin-dir <the epikloop-harbor plugin's folder>`") && said.includes('claude plugin install epikloop-harbor@epikloop'), true],
        ])
      },
    ],
    [
      "a config that doesn't parse is left as it is",
      () => {
        const home = k.home({ config: '{ "format": 1, "harbor": tr' })
        const file = path.join(home, '.epikloop', 'config.json')
        return k.expect([
          [k.run(home, 'on'), { code: 1, out: `harbor: ${file} doesn't parse, so the flag is unchanged; correct the file, then run this again\n`, called: [] }],
          [k.config(home), '{ "format": 1, "harbor": tr'],
        ])
      },
    ],
    [
      "Harbor's own failure comes through with its exit code",
      () => {
        fs.writeFileSync(path.join(standIn, 'fail'), '')
        try {
          return k.expect([[k.run(k.home(), 'on'), { code: 1, out: "harbor: can't listen on 127.0.0.1:4747 (EACCES)\n", called: ['start'] }]])
        } finally {
          fs.rmSync(path.join(standIn, 'fail'))
        }
      },
    ],
    [
      'anything else is the usage line',
      () => {
        const home = k.home()
        const usage = { code: 1, out: 'usage: node switch.mjs on|off|open\n', called: [] }
        return k.expect([
          [k.run(home, 'start'), usage],
          [k.run(home), usage],
          [k.run(home, 'on', 'now'), usage],
          [fs.existsSync(path.join(home, '.epikloop', 'config.json')), false],
        ])
      },
    ],
  ]
  const failures = []
  try {
    for (const [name, check] of cases) {
      let problems
      try {
        problems = check()
      } catch (error) {
        problems = [`threw ${error.message}`]
      }
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`switch self-test: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(FILE)) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--self-test') selfTest()
  else {
    const { code, text } = args.length === 1 ? flip(args[0], os.homedir()) : flip('', os.homedir())
    console.log(text)
    process.exitCode = code
  }
}
