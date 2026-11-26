// What Epikloop keeps for one project on this machine, beside its cost rows, and what it reads
// from the event log there:
//
// - ~/.epikloop/projects/<id>/notes.md: the lines the project's records carry about Epikloop
//   itself, collected for the human to send on. Nothing sends them.
// - What the event log counted for the project since its last retro, as one line of the retro's
//   brief.
// - ~/.epikloop/projects/<id>/compare/<code>.json: the pictures a retro's visual compare read, by
//   fingerprint and size, which the next compare sorts today's pictures against.
//
// The state reader calls these with what it read from the project. Of the project's own files,
// only the pictures are read here.
//
// `node home.mjs --self-test` runs every case below in throwaway folders.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const ISSUES = 'https://github.com/Yheng/Epikloop/issues'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const prose = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)
const folder = (home, id) => path.join(home, '.epikloop', 'projects', id)
const firstLine = (error) => String(error?.code ?? error?.message ?? error).split('\n')[0]

// Writes a file whole or not at all: beside itself first, then renamed over.
function writeWhole(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const part = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(part, text)
    fs.renameSync(part, file)
  } finally {
    fs.rmSync(part, { force: true })
  }
}

// ---- The notes for Epikloop

const NOTES_HEAD = [
  '# Notes for Epikloop',
  '',
  "What this project's records say about Epikloop itself, collected by a script. Nothing here is",
  `sent anywhere. To pass a note on, open an issue at ${ISSUES}.`,
  '',
]

// The notes file's text for `notes`, each { date, id, title, text }, in the records' order.
const notesText = (notes) => [...NOTES_HEAD, ...notes.map((note) => `- ${note.date} · ${note.id} ${note.title} · ${note.text}`), ''].join('\n')

// Collects a project's notes into its file, and gives the retro's brief its line about them. The
// file is written only when it would change. One that can't be written fails nothing: the line
// says so.
export function collectNotes(home, id, notes) {
  if (notes.length === 0) return "Notes for Epikloop in this project's records: none."
  const file = path.join(folder(home, id), 'notes.md')
  const said = `Notes for Epikloop in this project's records: ${notes.length}`
  const send = `Sending them as an issue is the human's: ${ISSUES}.`
  try {
    const text = notesText(notes)
    let held = null
    try {
      held = fs.readFileSync(file, 'utf8')
    } catch {}
    if (held !== text) writeWhole(file, text)
  } catch (error) {
    return `${said}. They couldn't be collected in ${file} (${firstLine(error)}). ${send}`
  }
  return `${said}, collected in ${file}. ${send}`
}

// ---- What the event log counted

const DAY = 86_400_000
// The log is read this far back at most, however long ago the last retro was.
const DAYS = 30
// A gate run with no result line counts as ended once it is older than a run may hold the
// machine's gates: three commands at the largest cap, and slack, as the gate runner's lock has it.
const RUN_MAX = (3 * 60 + 3) * 60_000
// A day of the log: its folder while the emitter's files wait to be folded, and its file after.
const LOG_DAY = /^(\d{4}-\d{2}-\d{2})(\.jsonl)?$/
// A gate's name as the gate runner writes it. A log line is anyone's to write, and the name goes
// into a brief, so one of another shape names no gate.
const GATE = /^[a-z][a-z0-9-]*$/

// What the machine's event log holds for project `id` since `since`, 30 days back at most, or
// null where there is no log. Each day in reach is read by its name, its folder of files not
// folded yet and then its folded file, whichever of the two the listing held, and a line met
// twice counts once. So another session's fold, at work between the listing and the reading,
// neither hides a line nor doubles it. The log's days are UTC days. `listing` lists the log's
// folder, and the self-test passes one taken before a fold.
export function eventCounts(home, id, { since = 0, now = Date.now(), listing = (dir) => fs.readdirSync(dir) } = {}) {
  const dir = path.join(home, '.epikloop', 'events')
  let listed
  try {
    listed = listing(dir)
  } catch {
    return null
  }
  const from = Math.max(since, now - DAYS * DAY)
  const first = new Date(from).toISOString().slice(0, 10)
  const days = [...new Set(listed.map((name) => LOG_DAY.exec(name)?.[1]).filter((day) => day !== undefined && day >= first))].sort()
  const seen = new Set()
  const runs = new Map()
  const counts = { whole: from === since, runs: 0, lost: 0, longest: null, waited: 0, agents: 0, errors: 0, prompts: 0, notices: 0 }
  const take = (text) => {
    const line = text.trim()
    if (line === '' || !line.includes(id) || seen.has(line)) return
    seen.add(line)
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    const at = Date.parse(event?.ts)
    if (event?.project_id !== id || !(at >= from)) return
    const detail = event.detail ?? {}
    if (event.kind === 'gate.started') runs.set(detail.run, { ...runs.get(detail.run), started: at })
    else if (event.kind === 'gate.passed' || event.kind === 'gate.failed') {
      runs.set(detail.run, { ...runs.get(detail.run), ended: true })
      const named = typeof event.state === 'string' && GATE.test(event.state)
      if (named && Number.isFinite(detail.ms) && detail.ms > (counts.longest?.ms ?? -1)) counts.longest = { gate: event.state, ms: detail.ms }
      if (Number.isFinite(detail.waited)) counts.waited += detail.waited
    } else if (event.kind === 'tool.post' && event.tool === 'Agent') {
      counts.agents += 1
      if (detail.is_error === true) counts.errors += 1
    } else if (event.kind === 'notification') {
      counts.notices += 1
      if (detail.notification_type === 'permission_prompt') counts.prompts += 1
    }
  }
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  }
  for (const day of days) {
    let names = []
    try {
      names = fs.readdirSync(path.join(dir, day))
    } catch {}
    for (const name of names) if (name.endsWith('.json')) take(read(path.join(dir, day, name)))
  }
  for (const day of days) for (const line of read(path.join(dir, `${day}.jsonl`)).split('\n')) take(line)
  counts.runs = runs.size
  counts.lost = [...runs.values()].filter((run) => run.ended !== true && run.started !== undefined && now - run.started > RUN_MAX).length
  return counts
}

// The counts as the retro's brief gives them. `tag` is the tag they start from, when the log was
// read back to it, and `cap` the project's limit on a gate command, in seconds. A log with no
// notification at all says so, since some machines log none, and that is not no prompt.
export function countsLine(counts, { tag = null, cap = 600 } = {}) {
  if (counts === null) return 'This machine has no event log, so nothing is counted for this project.'
  const since = counts.whole && tag !== null ? `since the ${tag} tag` : `over the last ${DAYS} days`
  const seconds = (ms) => Math.round(ms / 1000)
  const parts = [
    `${plural(counts.runs, 'gate run')}, ${counts.lost} with no result`,
    ...(counts.longest === null ? [] : [`the longest gate command was ${counts.longest.gate}, ${seconds(counts.longest.ms)} s of its ${cap}`]),
    `${seconds(counts.waited)} s waited for other gate runs`,
    `${plural(counts.agents, 'Agent call')}, ${counts.errors} answered with an error`,
    counts.notices === 0 ? "no notification was logged, so permission prompts aren't known" : plural(counts.prompts, 'permission prompt'),
  ]
  return `This machine's event log for this project, ${since}: ${parts.join('; ')}.`
}

// ---- The pictures a visual compare reads

// A picture the lane's screens spec writes: <screen>.<state>.<width>.design.png or .app.png. The
// state is one the manifest lists, or one of the project's own, such as error.too-long.
const PICTURE = /^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9.-]*?)\.(\d+)\.(design|app)\.png$/
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// A picture as the compare knows it: its fingerprint, its size in pixels and when it was written.
// Null for a file that is no PNG, and for one that can't be read: a folder of that name, or a
// file gone since the folder was listed.
function picture(file) {
  try {
    const bytes = fs.readFileSync(file)
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG) || bytes.toString('latin1', 12, 16) !== 'IHDR') return null
    return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), at: fs.statSync(file).mtimeMs }
  } catch {
    return null
  }
}

const listFile = (home, id, code) => path.join(folder(home, id), 'compare', `${code}.json`)
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

// The code a list goes by, which a retro's record names: eight hex digits of its entries'
// fingerprint, so the same pictures read give the same code.
export const listCode = (entries) => crypto.createHash('sha256').update(JSON.stringify([...entries].sort(byName))).digest('hex').slice(0, 8)

// The list a record names by `code`, as a map from a picture's name to its entry, or null when
// this machine doesn't have it or it doesn't read.
export function readList(home, id, code) {
  try {
    const list = JSON.parse(fs.readFileSync(listFile(home, id, code), 'utf8'))
    if (list?.format !== 1 || !Array.isArray(list.pictures)) return null
    return new Map(list.pictures.map((entry) => [entry.name, { sha256: entry.sha256, width: entry.width, height: entry.height }]))
  } catch {
    return null
  }
}

// Saves a compare's list under its code, and returns the code.
export function saveList(home, id, entries, { now = Date.now(), commit = null } = {}) {
  const code = listCode(entries)
  writeWhole(listFile(home, id, code), `${JSON.stringify({ format: 1, at: new Date(now).toISOString(), commit, pictures: [...entries].sort(byName) })}\n`)
  return code
}

// Sorts the pictures in `dir` against `trusted`, what a retro last read: each state of each screen
// in `screens`, at each of `widths`, is not rendered, to read with why, changed and not read, or
// unchanged. `named` maps a screen to the stories of this phase that name it.
//
// `entries` is the next list: today's entry for a pair read or unchanged, and the old one for a
// pair that changed and isn't read, so that pair stays listed until a retro reads it. With `all`,
// every changed pair is to read, which is how a retro reads those and takes them off that list.
// A pair that isn't rendered keeps what it had.
//
// A pair the spec renders in a state the manifest doesn't list, or of a screen it doesn't list, is
// sorted as the others are and marked. `odd` holds the files it can't place: one that is no
// picture, and one without its other half.
export function sortPictures({ dir, screens, widths, named = new Map(), trusted = null, all = false }) {
  const found = new Map()
  const odd = []
  let names = []
  try {
    names = fs.readdirSync(dir).sort()
  } catch {}
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.png')) continue
    const read = PICTURE.test(name) ? picture(path.join(dir, name)) : null
    if (read === null) odd.push(name)
    else found.set(name, read)
  }
  const sorted = { read: [], unread: [], same: [], missing: [], odd, entries: [], times: [...found.values()].map((each) => each.at) }
  const keep = (name, entry) => {
    if (entry !== undefined) sorted.entries.push({ name, sha256: entry.sha256, width: entry.width, height: entry.height })
  }
  const placed = new Set()
  // Sorts one pair, `screen`'s `key`, whose two pictures are there. `beyond` marks one the manifest
  // doesn't list.
  const sortPair = (screen, key, beyond) => {
    const [appName, designName] = [`${screen}.${key}.app.png`, `${screen}.${key}.design.png`]
    const [app, design] = [found.get(appName), found.get(designName)]
    const [was, wasDesign] = [trusted?.get(appName), trusted?.get(designName)]
    let why = null
    if (was === undefined || wasDesign === undefined) why = 'new'
    else if (app.width !== was.width || app.height !== was.height) why = 'resized'
    else if (design.sha256 !== wasDesign.sha256) why = 'design changed'
    else if (app.sha256 !== was.sha256 && named.has(screen)) why = `changed, and ${prose(named.get(screen))} ${named.get(screen).length === 1 ? 'names' : 'name'} it`
    else if (app.sha256 !== was.sha256 && all) why = 'changed'
    const unread = why === null && app.sha256 !== was.sha256
    const sizes = why === 'resized' ? { sizes: `from ${was.width}x${was.height} to ${app.width}x${app.height}` } : {}
    if (why !== null) sorted.read.push({ screen, key, why: beyond ? `${why}, not in design/manifest.md` : why, ...sizes })
    else (unread ? sorted.unread : sorted.same).push({ screen, key })
    keep(appName, unread ? was : app)
    keep(designName, unread ? wasDesign : design)
  }
  for (const screen of screens) {
    for (const state of screen.states) {
      for (const width of widths) {
        const key = `${state}.${width}`
        const [appName, designName] = [`${screen.id}.${key}.app.png`, `${screen.id}.${key}.design.png`]
        placed.add(appName).add(designName)
        if (found.has(appName) && found.has(designName)) sortPair(screen.id, key, false)
        else {
          sorted.missing.push({ screen: screen.id, key })
          keep(appName, trusted?.get(appName))
          keep(designName, trusted?.get(designName))
        }
      }
    }
  }
  // What the spec renders beyond the manifest: a pair is sorted, by its screen, its state and then
  // its width, the narrow one first as the manifest's are, and a picture alone isn't placed. The
  // width stays as the name writes it, so 0390 is a pair of its own and never the 390 one.
  const beyond = []
  for (const name of found.keys()) {
    if (placed.has(name)) continue
    const [, screen, state, width, kind] = PICTURE.exec(name)
    const other = `${screen}.${state}.${width}.${kind === 'app' ? 'design' : 'app'}.png`
    if (!found.has(other)) odd.push(name)
    else if (kind === 'app') beyond.push({ screen, state, width })
  }
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  beyond.sort((a, b) => order(a.screen, b.screen) || order(a.state, b.state) || Number(a.width) - Number(b.width) || order(a.width, b.width))
  for (const { screen, state, width } of beyond) sortPair(screen, `${state}.${width}`, true)
  odd.sort()
  return sorted
}

// Pairs as lines, one for each screen and reason: `- screen, why: state.width, state.width`.
function grouped(pairs) {
  const lines = new Map()
  for (const pair of pairs) {
    const head = `- ${pair.screen}${pair.why === undefined ? '' : `, ${pair.why}`}`
    lines.set(head, [...(lines.get(head) ?? []), pair.sizes === undefined ? pair.key : `${pair.key} ${pair.sizes}`])
  }
  return [...lines].map(([head, keys]) => `${head}: ${keys.join(', ')}`)
}

const minute = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
// A file's name as the brief prints it: as it is when it is plain, and quoted otherwise, since a
// name may hold anything its system allows, a line break included.
const shown = (name) => (/^[A-Za-z0-9._-]+$/.test(name) ? name : JSON.stringify(name))

// What `--compare` prints for `sorted`: what it was sorted against, the pairs to read, what isn't
// read and why, what the design lists and nothing rendered, the files it can't place, when the
// pictures were written, and the line the retro's record carries, which names the new list by
// `code`. `rel` is the pictures' folder as the project names it, `against` the code the last
// record names, or null, with `held` saying whether this machine has that list, and `head` the
// time of the last commit.
export function compareLines(sorted, { rel, code, against = null, held = false, head = null }) {
  const out = []
  if (against === null) out.push('The visual compare: no landed record names a snapshot yet, so every pair is read.')
  else if (!held) out.push(`The visual compare: the last record names snapshot ${against}, which this machine doesn't have, so every pair is read.`)
  else out.push(`The visual compare, against what the retro whose record names snapshot ${against} read on this machine.`)
  if (sorted.read.length === 0) out.push('Nothing to read: no picture is new or changed where a retro reads it.')
  else out.push(`Read these ${sorted.read.length}, each app picture beside its design picture, in ${rel}/:`, ...grouped(sorted.read))
  const unread = [...new Set(sorted.unread.map((pair) => pair.screen))]
  const notRead = [
    ...(sorted.same.length > 0 ? [`${sorted.same.length} unchanged since a retro last read them`] : []),
    ...(sorted.unread.length > 0 ? [`${sorted.unread.length} changed at the same size on screens no story or fix of this phase names, which stay listed until a retro reads them (${unread.join(', ')})`] : []),
  ]
  if (notRead.length > 0) out.push(`Not read: ${notRead.join('; ')}.`)
  if (sorted.unread.length > 0) out.push('`state.mjs --compare all` lists every changed pair to read, for a retro that reads those too.')
  if (sorted.missing.length > 0) out.push(`Not rendered, though design/manifest.md lists them, ${sorted.missing.length} in all:`, ...grouped(sorted.missing))
  if (sorted.odd.length > 0) out.push(`Not placed, being no picture or lacking its other half: ${sorted.odd.slice(0, 5).map(shown).join(', ')}${sorted.odd.length > 5 ? ` and ${sorted.odd.length - 5} more` : ''}.`)
  const [from, to] = [Math.min(...sorted.times), Math.max(...sorted.times)]
  const stale = head === null ? 0 : sorted.times.filter((at) => at < head).length
  out.push(`The pictures were written from ${minute(from)} to ${minute(to)}${stale > 0 ? `; ${stale} of them are older than the last commit, so the deep gates' run didn't write those` : ''}.`)
  out.push(`For the record: "Visual compare: ${sorted.read.length} read, ${sorted.same.length} unchanged, ${sorted.unread.length} changed and not read, ${sorted.missing.length} not rendered (snapshot ${code})."`)
  return out
}

// ---- The self-test

async function selfTest() {
  const os = await import('node:os')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-home-'))
  const ID = '0123456789ab'
  const OTHER = 'ba9876543210'
  const NOW = Date.UTC(2026, 10, 15, 12)
  let made = 0
  const fresh = (name) => {
    made += 1
    const dir = path.join(temp, `${name}-${made}`)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  const every = (...checks) => checks.filter((check) => check !== true)
  const is = (got, want, what) => JSON.stringify(got) === JSON.stringify(want) || `${what}: got ${JSON.stringify(got)}, not ${JSON.stringify(want)}`

  // An event as the emitter writes it, and a day's folder or file of them.
  const event = (ts, kind, fields = {}, id = ID) => JSON.stringify({ format: 1, ts, project_id: id, cwd: '/p', session_id: 's', kind, ...fields })
  const unfolded = (home, day, lines) => {
    const dir = path.join(home, '.epikloop', 'events', day)
    fs.mkdirSync(dir, { recursive: true })
    lines.forEach((line, i) => fs.writeFileSync(path.join(dir, `${1792576800000 + i}-8d1e5c2a-${i + 1}.json`), `${line}\n`))
  }
  const folded = (home, day, lines) => {
    fs.mkdirSync(path.join(home, '.epikloop', 'events'), { recursive: true })
    fs.writeFileSync(path.join(home, '.epikloop', 'events', `${day}.jsonl`), lines.map((line) => `${line}\n`).join(''))
  }
  const gate = (ts, kind, run, state, detail = {}) => event(ts, kind, { ...(state === undefined ? {} : { state }), detail: { mode: 'full', run, ...detail } })
  const agent = (ts, error) => event(ts, 'tool.post', { tool: 'Agent', detail: { tool_use_id: ts, is_error: error } })
  const notice = (ts, type) => event(ts, 'notification', { detail: { notification_type: type } })

  // A picture's bytes: a PNG's opening, with its size, and `seed` to tell two apart.
  const png = (width, height, seed = 0) => {
    const bytes = Buffer.alloc(37)
    PNG.copy(bytes, 0)
    bytes.writeUInt32BE(13, 8)
    bytes.write('IHDR', 12, 'latin1')
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    bytes.writeUInt32BE(seed, 33)
    return bytes
  }
  const SCREENS = [
    { id: 'home', states: ['default', 'empty'] },
    { id: 'sign-in', states: ['default'] },
  ]
  const WIDTHS = [390, 1280]
  // Every picture of SCREENS in a new folder, each [width, height, seed], with `over` replacing
  // some by name; null leaves one out.
  const pictures = (over = {}) => {
    const dir = fresh('screens')
    for (const screen of SCREENS) {
      for (const state of screen.states) {
        for (const width of WIDTHS) {
          for (const kind of ['app', 'design']) {
            const name = `${screen.id}.${state}.${width}.${kind}.png`
            const spec = name in over ? over[name] : [width, 800, 1]
            if (spec !== null) fs.writeFileSync(path.join(dir, name), Buffer.isBuffer(spec) ? spec : png(...spec))
          }
        }
      }
    }
    return dir
  }
  const sort = (dir, more = {}) => sortPictures({ dir, screens: SCREENS, widths: WIDTHS, ...more })
  const asList = (entries) => new Map(entries.map((entry) => [entry.name, entry]))
  const keys = (pairs) => pairs.map((pair) => `${pair.screen}.${pair.key}`)

  const NOTES = [
    { date: '2026-11-13', id: 'DECISION-057', title: 'Phase 3 retro', text: 'the push gate ran every test for a commit that changed only docs.' },
    { date: '2026-11-18', id: 'DECISION-160', title: 'Phase 9 retro', text: 'the deep gates ran beside another project and timed out.' },
  ]

  const cases = [
    [
      'no note writes no file, and the line says none',
      () => {
        const home = fresh('home')
        return every(is(collectNotes(home, ID, []), "Notes for Epikloop in this project's records: none.", 'the line'), !fs.existsSync(path.join(home, '.epikloop')) || 'a file was written')
      },
    ],
    [
      'the notes are collected in the records order, under a head that says nothing is sent',
      () => {
        const home = fresh('home')
        const file = path.join(home, '.epikloop', 'projects', ID, 'notes.md')
        const line = collectNotes(home, ID, NOTES)
        const text = fs.readFileSync(file, 'utf8')
        return every(
          is(line, `Notes for Epikloop in this project's records: 2, collected in ${file}. Sending them as an issue is the human's: ${ISSUES}.`, 'the line'),
          text.startsWith('# Notes for Epikloop\n\n') || 'no title',
          text.includes(`Nothing here is\nsent anywhere. To pass a note on, open an issue at ${ISSUES}.`) || 'the head lacks its two sentences',
          text.endsWith(
            '\n- 2026-11-13 · DECISION-057 Phase 3 retro · the push gate ran every test for a commit that changed only docs.\n- 2026-11-18 · DECISION-160 Phase 9 retro · the deep gates ran beside another project and timed out.\n',
          ) || `the notes read ${JSON.stringify(text.split('\n').slice(-3))}`,
          fs.readdirSync(path.dirname(file)).join() === 'notes.md' || 'a part file was left',
        )
      },
    ],
    [
      'a file that already holds the notes is left alone, and a new note rewrites it',
      () => {
        const home = fresh('home')
        const file = path.join(home, '.epikloop', 'projects', ID, 'notes.md')
        collectNotes(home, ID, NOTES.slice(0, 1))
        const old = new Date(NOW - DAY)
        fs.utimesSync(file, old, old)
        collectNotes(home, ID, NOTES.slice(0, 1))
        const kept = fs.statSync(file).mtimeMs === old.getTime()
        collectNotes(home, ID, NOTES)
        return every(kept || 'the same notes were written again', fs.readFileSync(file, 'utf8').includes('DECISION-160') || 'the new note is missing', fs.statSync(file).mtimeMs !== old.getTime() || 'the file was not rewritten')
      },
    ],
    [
      "a file that can't be written fails nothing, and the line says so",
      () => {
        const home = fresh('home')
        // The project's folder is a file, so nothing can be made inside it.
        fs.mkdirSync(path.join(home, '.epikloop', 'projects'), { recursive: true })
        fs.writeFileSync(path.join(home, '.epikloop', 'projects', ID), '')
        const line = collectNotes(home, ID, NOTES)
        return every(/^Notes for Epikloop in this project's records: 2\. They couldn't be collected in .*notes\.md \([A-Z]+\)\. Sending them as an issue is the human's: /.test(line) || `the line reads ${line}`)
      },
    ],
    [
      'a machine with no event log counts nothing, and says so',
      () => every(is(eventCounts(fresh('home'), ID, { now: NOW }), null, 'the counts'), is(countsLine(null), 'This machine has no event log, so nothing is counted for this project.', 'the line')),
    ],
    [
      'the counts come from the folders not folded yet and the folded days, for this project alone',
      () => {
        const home = fresh('home')
        unfolded(home, '2026-11-15', [
          gate('2026-11-15T09:00:00.000Z', 'gate.started', 'r3'),
          gate('2026-11-15T09:01:00.000Z', 'gate.passed', 'r3', 'lint', { ms: 4_000 }),
          gate('2026-11-15T09:09:00.000Z', 'gate.failed', 'r3', 'test', { ms: 491_400, waited: 640_500 }),
          agent('2026-11-15T09:10:00.000Z', true),
          notice('2026-11-15T09:11:00.000Z', 'permission_prompt'),
          event('2026-11-15T09:12:00.000Z', 'tool.post', { tool: 'Agent', detail: { is_error: true } }, OTHER),
          // Another project's event, in a folder named like this project's id.
          event('2026-11-15T09:13:00.000Z', 'tool.post', { cwd: `/work/${ID}`, tool: 'Agent', detail: { is_error: true } }, OTHER),
        ])
        folded(home, '2026-11-14', [
          gate('2026-11-14T08:00:00.000Z', 'gate.started', 'r1'),
          gate('2026-11-14T08:05:00.000Z', 'gate.passed', 'r1', 'build', { ms: 300_000 }),
          gate('2026-11-14T10:00:00.000Z', 'gate.started', 'r2'),
          gate('2026-11-14T10:01:00.000Z', 'gate.passed', 'r2', 'lint', { ms: 2_000 }),
          agent('2026-11-14T11:00:00.000Z', false),
          agent('2026-11-14T11:30:00.000Z', false),
          notice('2026-11-14T11:31:00.000Z', 'idle_prompt'),
          event('2026-11-14T11:32:00.000Z', 'tool.post', { tool: 'Bash', detail: { is_error: true } }),
          gate('2026-11-14T12:00:00.000Z', 'gate.started', 'x1').replace(ID, OTHER),
        ])
        const counts = eventCounts(home, ID, { since: Date.UTC(2026, 10, 14), now: NOW })
        return every(
          is(counts, { whole: true, runs: 3, lost: 0, longest: { gate: 'test', ms: 491_400 }, waited: 640_500, agents: 3, errors: 1, prompts: 1, notices: 2 }, 'the counts'),
          is(
            countsLine(counts, { tag: 'phase-2', cap: 1200 }),
            "This machine's event log for this project, since the phase-2 tag: 3 gate runs, 0 with no result; the longest gate command was test, 491 s of its 1200; 641 s waited for other gate runs; 3 Agent calls, 1 answered with an error; 1 permission prompt.",
            'the line',
          ),
        )
      },
    ],
    [
      'an event from before the last retro is left out, though its day is read',
      () => {
        const home = fresh('home')
        folded(home, '2026-11-14', [agent('2026-11-14T05:00:00.000Z', true), agent('2026-11-14T07:00:00.000Z', false)])
        const counts = eventCounts(home, ID, { since: Date.UTC(2026, 10, 14, 6), now: NOW })
        return every(is([counts.agents, counts.errors], [1, 0], 'the calls counted'))
      },
    ],
    [
      'a line a fold left twice counts once, in one day or across its folder and its file',
      () => {
        const home = fresh('home')
        const twice = agent('2026-11-14T07:00:00.000Z', true)
        folded(home, '2026-11-14', [twice, twice, agent('2026-11-14T08:00:00.000Z', true)])
        unfolded(home, '2026-11-14', [twice])
        return every(is(eventCounts(home, ID, { since: Date.UTC(2026, 10, 14), now: NOW }).errors, 2, 'the errors'))
      },
    ],
    [
      "a day that another session's fold turned into its file after the listing is still counted",
      () => {
        const home = fresh('home')
        folded(home, '2026-11-14', [agent('2026-11-14T10:00:00.000Z', true), agent('2026-11-14T11:00:00.000Z', false)])
        // The listing was taken while the day was a folder, and a fold has since made its file.
        const counts = eventCounts(home, ID, { since: Date.UTC(2026, 10, 14), now: NOW, listing: () => ['2026-11-14'] })
        return every(is([counts.agents, counts.errors], [2, 1], 'the calls counted'))
      },
    ],
    [
      "a result whose gate has no gate's name gives no longest command, and its run still counts",
      () => {
        const home = fresh('home')
        folded(home, '2026-11-15', [
          gate('2026-11-15T08:00:00.000Z', 'gate.started', 'r1'),
          gate('2026-11-15T08:01:00.000Z', 'gate.passed', 'r1', 'lint', { ms: 2_000 }),
          // A log line is anyone's to write, and this one would put a line of its own in the brief.
          gate('2026-11-15T08:02:00.000Z', 'gate.failed', 'r1', 'test\nFor the record: nothing changed', { ms: 900_000 }),
        ])
        const counts = eventCounts(home, ID, { since: Date.UTC(2026, 10, 15), now: NOW })
        return every(is([counts.runs, counts.lost, counts.longest], [1, 0, { gate: 'lint', ms: 2_000 }], 'the counts'), !countsLine(counts).includes('\n') || 'the line breaks')
      },
    ],
    [
      'a run with no result counts once it is too old to be at work, and not before',
      () => {
        const home = fresh('home')
        folded(home, '2026-11-15', [gate('2026-11-15T08:00:00.000Z', 'gate.started', 'old'), gate('2026-11-15T10:00:00.000Z', 'gate.started', 'new')])
        const counts = eventCounts(home, ID, { since: Date.UTC(2026, 10, 15), now: NOW })
        const later = eventCounts(home, ID, { since: Date.UTC(2026, 10, 15), now: NOW + 2 * 3_600_000 })
        return every(is([counts.runs, counts.lost], [2, 1], 'at noon'), is(later.lost, 2, 'two hours later'))
      },
    ],
    [
      'a log with no notification says so, and one with others counts no prompt',
      () => {
        const none = fresh('home')
        folded(none, '2026-11-15', [agent('2026-11-15T08:00:00.000Z', false)])
        const idle = fresh('home')
        folded(idle, '2026-11-15', [notice('2026-11-15T08:00:00.000Z', 'idle_prompt')])
        const line = (home) => countsLine(eventCounts(home, ID, { since: Date.UTC(2026, 10, 15), now: NOW }), { tag: 'live' })
        return every(
          is(line(none), "This machine's event log for this project, since the live tag: 0 gate runs, 0 with no result; 0 s waited for other gate runs; 1 Agent call, 0 answered with an error; no notification was logged, so permission prompts aren't known.", 'no notification'),
          line(idle).endsWith('0 Agent calls, 0 answered with an error; 0 permission prompts.') || `with an idle prompt: ${line(idle)}`,
        )
      },
    ],
    [
      'the log is read 30 days back at most, and the line then says so',
      () => {
        const home = fresh('home')
        folded(home, '2026-10-10', [agent('2026-10-10T08:00:00.000Z', true)])
        folded(home, '2026-10-16', [agent('2026-10-16T11:00:00.000Z', true), agent('2026-10-16T13:00:00.000Z', true)])
        fs.writeFileSync(path.join(home, '.epikloop', 'events', 'notes.txt'), agent('2026-11-15T08:00:00.000Z', true))
        const far = eventCounts(home, ID, { since: Date.UTC(2026, 8, 1), now: NOW })
        const none = eventCounts(home, ID, { now: NOW })
        return every(
          is([far.whole, far.agents], [false, 1], 'from a tag older than 30 days'),
          countsLine(far, { tag: 'phase-1' }).startsWith("This machine's event log for this project, over the last 30 days: ") || 'the line names the tag',
          countsLine(none, { tag: null }).startsWith("This machine's event log for this project, over the last 30 days: ") || 'with no tag',
        )
      },
    ],
    [
      'with nothing trusted every pair is to read as new, and the list holds every picture',
      () => {
        const sorted = sort(pictures())
        return every(
          is(keys(sorted.read), ['home.default.390', 'home.default.1280', 'home.empty.390', 'home.empty.1280', 'sign-in.default.390', 'sign-in.default.1280'], 'to read'),
          sorted.read.every((pair) => pair.why === 'new') || 'a pair has another reason',
          is([sorted.unread.length, sorted.same.length, sorted.missing.length, sorted.odd.length, sorted.entries.length], [0, 0, 0, 0, 12], 'the rest'),
          is(Object.keys(sorted.entries[0]), ['name', 'sha256', 'width', 'height'], 'an entry'),
        )
      },
    ],
    [
      'the same pictures give the same code, and one that differs another',
      () => {
        const [a, b, c] = [sort(pictures()), sort(pictures()), sort(pictures({ 'home.default.390.app.png': [390, 800, 2] }))]
        return every(/^[0-9a-f]{8}$/.test(listCode(a.entries)) || 'the code is not eight hex digits', listCode(a.entries) === listCode([...b.entries].reverse()) || 'the order changes the code', listCode(a.entries) !== listCode(c.entries) || 'a changed picture keeps the code')
      },
    ],
    [
      'against the list of the same pictures, nothing is to read',
      () => {
        const sorted = sort(pictures(), { trusted: asList(sort(pictures()).entries) })
        return every(is([sorted.read.length, sorted.unread.length, sorted.same.length], [0, 0, 6], 'the pairs'))
      },
    ],
    [
      'a picture whose size changed is to read, with both sizes',
      () => {
        const trusted = asList(sort(pictures()).entries)
        const sorted = sort(pictures({ 'home.default.390.app.png': [390, 549, 1] }), { trusted })
        return every(is(sorted.read, [{ screen: 'home', key: 'default.390', why: 'resized', sizes: 'from 390x800 to 390x549' }], 'to read'), is(sorted.same.length, 5, 'unchanged'))
      },
    ],
    [
      'a pair whose design picture changed is to read',
      () => {
        const trusted = asList(sort(pictures()).entries)
        const sorted = sort(pictures({ 'sign-in.default.1280.design.png': [1280, 800, 7] }), { trusted })
        return every(is(sorted.read, [{ screen: 'sign-in', key: 'default.1280', why: 'design changed' }], 'to read'))
      },
    ],
    [
      'a picture changed at the same size is to read when a story names its screen, and not otherwise',
      () => {
        const trusted = asList(sort(pictures()).entries)
        const changed = { 'home.empty.390.app.png': [390, 800, 5], 'sign-in.default.390.app.png': [390, 800, 5] }
        const one = sort(pictures(changed), { trusted, named: new Map([['home', ['2.1']]]) })
        const two = sort(pictures(changed), { trusted, named: new Map([['home', ['2.1', '2.4']]]) })
        return every(
          is(one.read, [{ screen: 'home', key: 'empty.390', why: 'changed, and 2.1 names it' }], 'to read'),
          is(keys(one.unread), ['sign-in.default.390'], 'changed and not read'),
          is(two.read[0].why, 'changed, and 2.1 and 2.4 name it', 'named by two'),
        )
      },
    ],
    [
      'a pair changed and not read keeps its old entry, so the next compare lists it again',
      () => {
        const first = sort(pictures())
        const changed = { 'sign-in.default.390.app.png': [390, 800, 5] }
        const second = sort(pictures(changed), { trusted: asList(first.entries) })
        const third = sort(pictures(changed), { trusted: asList(second.entries) })
        const read = sort(pictures(changed), { trusted: asList(second.entries), named: new Map([['sign-in', ['3.1']]]) })
        const after = sort(pictures(changed), { trusted: asList(read.entries) })
        return every(
          is(keys(second.unread), ['sign-in.default.390'], 'at the first retro after the change'),
          listCode(second.entries) === listCode(first.entries) || 'the list took the unread picture',
          is(keys(third.unread), ['sign-in.default.390'], 'at the next retro'),
          is([keys(read.read), after.unread.length, after.same.length], [['sign-in.default.390'], 0, 6], 'once a retro reads it'),
        )
      },
    ],
    [
      'asked for all, a pair that changed where no story names its screen is to read, and then leaves that list',
      () => {
        const first = sort(pictures())
        const changed = { 'sign-in.default.390.app.png': [390, 800, 5], 'home.empty.390.app.png': [390, 800, 5] }
        const named = new Map([['home', ['2.1']]])
        const plain = sort(pictures(changed), { trusted: asList(first.entries), named })
        const all = sort(pictures(changed), { trusted: asList(first.entries), named, all: true })
        const after = sort(pictures(changed), { trusted: asList(all.entries) })
        return every(
          is(keys(plain.unread), ['sign-in.default.390'], 'not asked'),
          is(
            all.read,
            [
              { screen: 'home', key: 'empty.390', why: 'changed, and 2.1 names it' },
              { screen: 'sign-in', key: 'default.390', why: 'changed' },
            ],
            'asked for all',
          ),
          is([all.unread.length, all.same.length], [0, 4], 'the rest'),
          is([after.read.length, after.unread.length, after.same.length], [0, 0, 6], 'at the next compare'),
        )
      },
    ],
    [
      'a state the manifest lists and nothing rendered is named, and keeps the entry it had',
      () => {
        const first = sort(pictures())
        const gone = { 'home.empty.1280.app.png': null, 'sign-in.default.390.app.png': null, 'sign-in.default.390.design.png': null }
        const sorted = sort(pictures(gone), { trusted: asList(first.entries) })
        const back = sort(pictures(), { trusted: asList(sorted.entries) })
        return every(is(keys(sorted.missing), ['home.empty.1280', 'sign-in.default.390'], 'not rendered'), is(sorted.entries.length, 12, 'the entries kept'), is([back.read.length, back.same.length], [0, 6], 'when they are rendered again unchanged'))
      },
    ],
    [
      'a file that is no PNG, a folder named as a picture, and a picture without its other half, are not placed',
      () => {
        const dir = pictures({ 'home.default.390.app.png': Buffer.from('not a picture, though it is as long as one') })
        fs.writeFileSync(path.join(dir, 'home.error.offline.390.app.png'), png(390, 800))
        fs.writeFileSync(path.join(dir, 'gone.default.390.app.png'), png(390, 800))
        fs.mkdirSync(path.join(dir, 'gone.default.1280.app.png'))
        fs.writeFileSync(path.join(dir, 'home.default.800.app.png'), png(800, 800))
        fs.writeFileSync(path.join(dir, 'trace.zip'), 'x')
        const sorted = sort(dir)
        return every(
          is(sorted.odd, ['gone.default.1280.app.png', 'gone.default.390.app.png', 'home.default.390.app.png', 'home.default.800.app.png', 'home.error.offline.390.app.png'], 'not placed'),
          is(keys(sorted.missing), ['home.default.390'], 'not rendered'),
        )
      },
    ],
    [
      "a pair in a state the manifest doesn't list, or of a screen it doesn't list, is sorted as the others are, and says so",
      () => {
        // Such pairs beside SCREENS' own: a state of the project's own at both widths, another
        // screen, and a width written as the lane doesn't write it.
        const beyond = (over = {}) => {
          const dir = pictures()
          const more = {
            'home.default.0390.app.png': [390, 800, 1],
            'home.default.0390.design.png': [390, 800, 1],
            'home.error.too-long.390.app.png': [390, 800, 1],
            'home.error.too-long.390.design.png': [390, 800, 1],
            'home.error.too-long.1280.app.png': [1280, 800, 1],
            'home.error.too-long.1280.design.png': [1280, 800, 1],
            'admin.default.1280.app.png': [1280, 800, 1],
            'admin.default.1280.design.png': [1280, 800, 1],
            ...over,
          }
          for (const [name, spec] of Object.entries(more)) fs.writeFileSync(path.join(dir, name), png(...spec))
          return dir
        }
        const marked = 'not in design/manifest.md'
        const first = sort(beyond())
        const again = sort(beyond(), { trusted: asList(first.entries) })
        const moved = sort(beyond({ 'home.error.too-long.390.app.png': [390, 800, 4], 'admin.default.1280.app.png': [1280, 500, 1] }), { trusted: asList(first.entries), named: new Map([['home', ['2.1']]]) })
        return every(
          is(
            first.read.filter((pair) => pair.why !== 'new'),
            [
              { screen: 'admin', key: 'default.1280', why: `new, ${marked}` },
              { screen: 'home', key: 'default.0390', why: `new, ${marked}` },
              { screen: 'home', key: 'error.too-long.390', why: `new, ${marked}` },
              { screen: 'home', key: 'error.too-long.1280', why: `new, ${marked}` },
            ],
            'at first, the narrow width before the wide',
          ),
          is([first.read.length, first.entries.length, new Set(first.entries.map((entry) => entry.name)).size, first.odd.length], [10, 20, 20, 0], 'the first sort, each picture once'),
          is([again.read.length, again.same.length], [0, 10], 'against its own list'),
          is(
            moved.read,
            [
              { screen: 'admin', key: 'default.1280', why: `resized, ${marked}`, sizes: 'from 1280x800 to 1280x500' },
              { screen: 'home', key: 'error.too-long.390', why: `changed, and 2.1 names it, ${marked}` },
            ],
            'once they change',
          ),
        )
      },
    ],
    [
      'a list is saved under its code and read back, and one that is missing or broken reads as none',
      () => {
        const home = fresh('home')
        const { entries } = sort(pictures())
        const code = saveList(home, ID, entries, { now: NOW, commit: 'abc1234' })
        const file = path.join(home, '.epikloop', 'projects', ID, 'compare', `${code}.json`)
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
        const read = readList(home, ID, code)
        fs.writeFileSync(path.join(path.dirname(file), 'ffffffff.json'), '{"format":2,"pictures":[]}')
        fs.writeFileSync(path.join(path.dirname(file), 'eeeeeeee.json'), '{')
        return every(
          code === listCode(entries) || 'the code is not the list’s',
          is([saved.format, saved.at, saved.commit, saved.pictures.length], [1, '2026-11-15T12:00:00.000Z', 'abc1234', 12], 'the file'),
          is(saved.pictures.map((entry) => entry.name), [...saved.pictures.map((entry) => entry.name)].sort(), 'the order'),
          is([read.size, read.get('home.default.390.app.png').width], [12, 390], 'read back'),
          is([readList(home, ID, '00000000'), readList(home, ID, 'ffffffff'), readList(home, ID, 'eeeeeeee')], [null, null, null], 'a list that is missing, of another format, or broken'),
          fs.readdirSync(path.dirname(file)).every((name) => name.endsWith('.json')) || 'a part file was left',
        )
      },
    ],
    [
      "a saved list holds to its schema, a pair in a state the manifest doesn't list included",
      () => {
        const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'schemas', 'compare.schema.json'), 'utf8'))
        const item = schema.properties.pictures.items
        const dir = pictures()
        for (const kind of ['app', 'design']) fs.writeFileSync(path.join(dir, `home.error.too-long.390.${kind}.png`), png(390, 800, 1))
        const home = fresh('home')
        const code = saveList(home, ID, sort(dir).entries, { now: NOW, commit: 'abc1234' })
        const saved = JSON.parse(fs.readFileSync(path.join(home, '.epikloop', 'projects', ID, 'compare', `${code}.json`), 'utf8'))
        const named = (object) => Object.keys(object).sort()
        const wrong = saved.pictures.filter(
          (entry) =>
            JSON.stringify(named(entry)) !== JSON.stringify(named(item.properties)) ||
            !new RegExp(item.properties.name.pattern).test(entry.name) ||
            !new RegExp(item.properties.sha256.pattern).test(entry.sha256) ||
            !(Number.isInteger(entry.width) && entry.width >= 1 && Number.isInteger(entry.height) && entry.height >= 1),
        )
        return every(
          is(named(saved), named(schema.properties), "the list's keys"),
          is([saved.format, saved.pictures.length], [schema.properties.format.const, 14], 'its format and its pictures'),
          is(wrong.map((entry) => entry.name), [], "the entries its schema doesn't take"),
        )
      },
    ],
    [
      'the compare prints what to read by screen and reason, what it leaves, and the line for the record',
      () => {
        const first = sort(pictures())
        const dir = pictures({
          'home.default.390.app.png': [390, 549, 1],
          'home.empty.390.app.png': [390, 800, 5],
          'home.empty.1280.app.png': [1280, 800, 5],
          'sign-in.default.390.app.png': [390, 800, 9],
          'sign-in.default.1280.app.png': null,
        })
        fs.writeFileSync(path.join(dir, 'home.error.offline.390.app.png'), png(390, 800))
        const at = new Date(Date.UTC(2026, 10, 15, 9, 30))
        for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), at, at)
        const late = new Date(Date.UTC(2026, 10, 15, 9, 42))
        fs.utimesSync(path.join(dir, 'home.default.390.app.png'), late, late)
        const sorted = sort(dir, { trusted: asList(first.entries), named: new Map([['home', ['2.1']]]) })
        const lines = compareLines(sorted, { rel: 'test-results/screens', code: 'a1b2c3d4', against: '0f0f0f0f', held: true, head: Date.UTC(2026, 10, 15, 9, 35) })
        return every(
          is(
            lines,
            [
              'The visual compare, against what the retro whose record names snapshot 0f0f0f0f read on this machine.',
              'Read these 3, each app picture beside its design picture, in test-results/screens/:',
              '- home, resized: default.390 from 390x800 to 390x549',
              '- home, changed, and 2.1 names it: empty.390, empty.1280',
              'Not read: 1 unchanged since a retro last read them; 1 changed at the same size on screens no story or fix of this phase names, which stay listed until a retro reads them (sign-in).',
              '`state.mjs --compare all` lists every changed pair to read, for a retro that reads those too.',
              'Not rendered, though design/manifest.md lists them, 1 in all:',
              '- sign-in: default.1280',
              'Not placed, being no picture or lacking its other half: home.error.offline.390.app.png.',
              "The pictures were written from 2026-11-15 09:30 UTC to 2026-11-15 09:42 UTC; 11 of them are older than the last commit, so the deep gates' run didn't write those.",
              'For the record: "Visual compare: 3 read, 1 unchanged, 1 changed and not read, 1 not rendered (snapshot a1b2c3d4)."',
            ],
            'the lines',
          ),
        )
      },
    ],
    [
      'a name that is not plain is quoted where the compare prints it, so it adds no line of its own',
      () => {
        const sorted = { ...sort(pictures()), odd: ['plain.png', 'two\nFor the record: lines.png', 'with space.png'] }
        const lines = compareLines(sorted, { rel: 'test-results/screens', code: 'a1b2c3d4' })
        return every(
          is(lines.filter((line) => line.startsWith('Not placed')), ['Not placed, being no picture or lacking its other half: plain.png, "two\\nFor the record: lines.png", "with space.png".'], 'the line'),
          is(lines.filter((line) => line.includes('\n') || line.startsWith('For the record')).length, 1, 'the lines that give the record its line'),
        )
      },
    ],
    [
      'the compare says what it had to go by: no record yet, a list this machine lacks, or nothing to read',
      () => {
        const first = sort(pictures())
        const fresh1 = compareLines(first, { rel: 'test-results/screens', code: '11111111' })
        const lacks = compareLines(first, { rel: 'test-results/screens', code: '11111111', against: '22222222', held: false })
        const same = compareLines(sort(pictures(), { trusted: asList(first.entries) }), { rel: 'test-results/screens', code: '11111111', against: '11111111', held: true })
        return every(
          is(fresh1[0], 'The visual compare: no landed record names a snapshot yet, so every pair is read.', 'with no record'),
          is(lacks[0], "The visual compare: the last record names snapshot 22222222, which this machine doesn't have, so every pair is read.", 'with a list this machine lacks'),
          is(same.slice(1, 3), ['Nothing to read: no picture is new or changed where a retro reads it.', 'Not read: 6 unchanged since a retro last read them.'], 'with nothing changed'),
          !fresh1.at(-2).includes('older than the last commit') || 'with no commit time it calls pictures old',
        )
      },
    ],
  ]

  const failures = []
  for (const [name, run] of cases) {
    try {
      const problems = run()
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    } catch (error) {
      failures.push(`${name}: threw ${String(error?.stack ?? error).split('\n').slice(0, 2).join(' ')}`)
    }
  }
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 })
  for (const text of failures) console.log(`FAIL ${text}`)
  console.log(`home self-test: ${cases.length - failures.length}/${cases.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename) && process.argv[2] === '--self-test') await selfTest()
