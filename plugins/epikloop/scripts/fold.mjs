// Folds a folder of the emitter's files into one .jsonl file: a day's events/YYYY-MM-DD/ into
// events/YYYY-MM-DD.jsonl, and a project's cost/ into cost.jsonl. Each file holds one JSON line. A
// file that parses is appended to the target and then deleted; one that doesn't is left for the
// next pass, because a hooks module's writes are not atomic. doctor calls fold(), and Harbor folds
// the same folders, so a fold holds <target>.lock while it runs, and folds nothing while another
// fold holds it.
//
// `node fold.mjs --self-test` folds sample files in a temporary folder.
import fs from 'node:fs'
import path from 'node:path'

// The emitter names each file <epoch-ms>-<session8>-<seq>.json.
const NAME = /^(\d+)-[^-]+-(\d+)\.json$/

// A fold takes milliseconds, so a lock this old was left by a fold that died.
const STALE = 10 * 60 * 1000

// The order a session wrote its files in: by time, then by count, both as numbers. A folded line
// no longer carries the count, so the line order has to.
function writeOrder(a, b) {
  const [, msA, seqA] = NAME.exec(a)
  const [, msB, seqB] = NAME.exec(b)
  return Number(msA) - Number(msB) || Number(seqA) - Number(seqB)
}

export function fold(folder, target) {
  const lock = `${target}.lock`
  if (!take(lock)) return { folded: 0, left: names(folder).length, busy: true }
  try {
    return append(folder, target)
  } finally {
    try {
      fs.rmSync(lock, { force: true })
    } catch {}
  }
}

// Takes the lock for this fold, or finds another fold holding it. A stale lock is removed for the
// next pass rather than taken, so two folds that both find it stale can't both end up holding it.
function take(lock) {
  try {
    fs.closeSync(fs.openSync(lock, 'wx'))
    return true
  } catch {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > STALE) fs.rmSync(lock, { force: true })
    } catch {}
    return false
  }
}

// The emitter's files in the folder, in write order; none once another fold has removed it.
function names(folder) {
  try {
    return fs.readdirSync(folder).filter((name) => NAME.test(name)).sort(writeOrder)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

// With the lock held: appends the folder's whole files to the target, then deletes them.
function append(folder, target) {
  const all = names(folder)
  const lines = []
  const folded = []
  for (const name of all) {
    const file = path.join(folder, name)
    try {
      lines.push(`${JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')))}\n`)
      folded.push(file)
    } catch {
      // Still being written: the next pass takes it.
    }
  }
  if (lines.length > 0) fs.appendFileSync(target, lines.join(''))
  for (const file of folded) fs.rmSync(file)
  return { folded: folded.length, left: all.length - folded.length }
}

async function selfTest() {
  const os = await import('node:os')
  const { spawn } = await import('node:child_process')
  const { pathToFileURL } = await import('node:url')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-fold-'))
  const folder = path.join(temp, '2026-10-21')
  const target = path.join(temp, '2026-10-21.jsonl')
  const lock = `${target}.lock`
  const ms = 1792576800000
  const file = (at, seq) => path.join(folder, `${at}-8d1e5c2a-${seq}.json`)
  const line = (seq) => `${JSON.stringify({ format: 1, seq })}\n`
  const read = (into) => (fs.existsSync(into) ? fs.readFileSync(into, 'utf8') : '')
  const folded = () => read(target)
  // A fold's result, or null when it threw.
  const attempt = (from, into) => {
    try {
      return fold(from, into)
    } catch {
      return null
    }
  }
  fs.mkdirSync(folder)
  // In one millisecond only the count orders them, and as text 10 sorts before 9.
  fs.writeFileSync(file(ms, 10), line(10))
  fs.writeFileSync(file(ms, 9), line(9))
  // Writes still under way: one cut short, one not yet started.
  fs.writeFileSync(file(ms + 1, 11), line(11).slice(0, 10))
  fs.writeFileSync(file(ms + 2, 12), '')
  const checks = []
  try {
    const first = fold(folder, target)
    checks.push(['the first pass folds the two whole files and leaves two', first.folded === 2 && first.left === 2])
    checks.push(['folded lines keep the order they were written in', folded() === line(9) + line(10)])
    checks.push(['folded files are deleted', !fs.existsSync(file(ms, 9)) && !fs.existsSync(file(ms, 10))])
    checks.push(['files that do not parse are left', fs.existsSync(file(ms + 1, 11)) && fs.existsSync(file(ms + 2, 12))])
    fs.writeFileSync(file(ms + 1, 11), line(11))
    const second = fold(folder, target)
    checks.push(['the next pass appends a file once it is whole', second.folded === 1 && second.left === 1])
    checks.push(['appending keeps what was folded before', folded() === line(9) + line(10) + line(11)])
    checks.push(['a fold leaves no lock behind', !fs.existsSync(lock)])

    // Another fold holds the lock: this one folds nothing, and leaves that fold's lock.
    const before = folded()
    fs.writeFileSync(file(ms + 3, 13), line(13))
    fs.writeFileSync(lock, '')
    const held = attempt(folder, target)
    checks.push(['a fold that finds the lock taken folds nothing', held?.folded === 0 && held.busy === true && fs.existsSync(file(ms + 3, 13)) && folded() === before])
    checks.push(["it leaves the other fold's lock", fs.existsSync(lock)])

    // A lock a fold that died left behind: the pass that finds it clears it, and the next folds.
    const old = new Date(Date.now() - 11 * 60 * 1000)
    fs.writeFileSync(lock, '')
    fs.utimesSync(lock, old, old)
    const stale = attempt(folder, target)
    checks.push(['a stale lock is cleared, and that pass folds nothing', stale?.folded === 0 && !fs.existsSync(lock) && fs.existsSync(file(ms + 3, 13))])
    const next = attempt(folder, target)
    checks.push(['the pass after a stale lock folds', next?.folded === 1 && folded() === before + line(13)])

    // A fold that throws, because its target is a folder, still frees the lock.
    const own = path.join(temp, '2026-10-23')
    const blocked = `${own}.jsonl`
    const kept = path.join(own, `${ms}-8d1e5c2a-1.json`)
    fs.mkdirSync(own)
    fs.mkdirSync(blocked)
    fs.writeFileSync(kept, line(1))
    const failed = attempt(own, blocked)
    checks.push(['a fold that throws leaves no lock and keeps its files', failed === null && !fs.existsSync(`${blocked}.lock`) && fs.existsSync(kept)])
    fs.rmdirSync(blocked)
    const retried = attempt(own, blocked)
    checks.push(['the fold after one that threw folds', retried?.folded === 1 && read(blocked) === line(1)])

    // A folder another fold removed.
    const gone = attempt(path.join(temp, 'gone'), path.join(temp, 'gone.jsonl'))
    checks.push(['a folder that is gone folds nothing, and leaves no lock', gone?.folded === 0 && gone.left === 0 && !fs.existsSync(path.join(temp, 'gone.jsonl.lock'))])

    // Four folds of one folder at once, each in a process of its own.
    const crowd = path.join(temp, '2026-10-22')
    fs.mkdirSync(crowd)
    for (let seq = 1; seq <= 200; seq += 1) fs.writeFileSync(path.join(crowd, `${ms + seq}-c0ffee00-${seq}.json`), line(seq))
    const script = `const { fold } = await import(${JSON.stringify(pathToFileURL(import.meta.filename).href)}); fold(${JSON.stringify(crowd)}, ${JSON.stringify(`${crowd}.jsonl`)})`
    const codes = await Promise.all(
      [1, 2, 3, 4].map(
        () =>
          new Promise((resolve) => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore', windowsHide: true })
            child.on('error', () => resolve(null))
            child.on('exit', resolve)
          }),
      ),
    )
    const all = Array.from({ length: 200 }, (_, n) => line(n + 1)).join('')
    checks.push(['four folds at once each exit cleanly', codes.every((code) => code === 0)])
    checks.push(['four folds at once fold each file once, in write order', read(`${crowd}.jsonl`) === all && fs.readdirSync(crowd).length === 0])
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  const failures = checks.filter(([, ok]) => !ok)
  for (const [name] of failures) console.log(`FAIL ${name}`)
  console.log(`fold self-test: ${checks.length - failures.length}/${checks.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename) && process.argv[2] === '--self-test') await selfTest()
