// Folds a folder of the emitter's files into one .jsonl file: a day's events/YYYY-MM-DD/ into
// events/YYYY-MM-DD.jsonl, and a project's cost/ into cost.jsonl. Each file holds one JSON line. A
// file that parses is appended to the target and then deleted; one that doesn't is left for the
// next pass, because a hooks module's writes are not atomic. doctor calls fold().
//
// `node fold.mjs --self-test` folds sample files in a temporary folder.
import fs from 'node:fs'
import path from 'node:path'

// The emitter names each file <epoch-ms>-<session8>-<seq>.json.
const NAME = /^(\d+)-[^-]+-(\d+)\.json$/

// The order a session wrote its files in: by time, then by count, both as numbers. A folded line
// no longer carries the count, so the line order has to.
function writeOrder(a, b) {
  const [, msA, seqA] = NAME.exec(a)
  const [, msB, seqB] = NAME.exec(b)
  return Number(msA) - Number(msB) || Number(seqA) - Number(seqB)
}

export function fold(folder, target) {
  const names = fs.readdirSync(folder).filter((name) => NAME.test(name)).sort(writeOrder)
  const lines = []
  const folded = []
  for (const name of names) {
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
  return { folded: folded.length, left: names.length - folded.length }
}

async function selfTest() {
  const os = await import('node:os')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-fold-'))
  const folder = path.join(temp, '2026-10-21')
  const target = path.join(temp, '2026-10-21.jsonl')
  const ms = 1792576800000
  const file = (at, seq) => path.join(folder, `${at}-8d1e5c2a-${seq}.json`)
  const line = (seq) => `${JSON.stringify({ format: 1, seq })}\n`
  const folded = () => fs.readFileSync(target, 'utf8')
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
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  const failures = checks.filter(([, ok]) => !ok)
  for (const [name] of failures) console.log(`FAIL ${name}`)
  console.log(`fold self-test: ${checks.length - failures.length}/${checks.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename && process.argv[2] === '--self-test') await selfTest()
