// The design gallery, design/index.html, written from a project's design/manifest.md and its
// directions: each direction framed at the lane's wide width, then each screen's states framed at
// both of its widths. The page holds no script, loads nothing from outside design/ and carries no
// date, so writing it again from the same design changes nothing.
//
//   node gallery.mjs              writes the gallery of the project here, and prints one line
//   node gallery.mjs --self-test  every case below, in throwaway projects
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { laneNames, openProject, readState, stateFile } from './state.mjs'

const GALLERY = 'design/index.html'
// The viewport height of each frame, for the narrow width and the wide one, and the height each
// frame is shown at.
const HEIGHTS = [844, 800]
const SHOWN = 400

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const STYLE = `:root { color-scheme: light dark; --bg: #f6f6f4; --fg: #1d1d1b; --muted: #6b6b66; --line: #d9d9d4; --mark: #0f766e; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ececea; --muted: #a3a39e; --line: #3a3a37; --mark: #2dd4bf; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1240px; margin: 0 auto; }
h1 { font-size: 28px; margin: 0 0 4px; }
h2 { font-size: 20px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 17px; margin: 28px 0 2px; }
h4 { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 14px 0 6px; }
p { margin: 0 0 8px; color: var(--muted); }
code { font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; }
a { color: inherit; }
.frames { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; overflow-x: auto; }
figure { margin: 0; }
.frame { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #ffffff; }
.frame iframe { display: block; border: 0; transform-origin: 0 0; background: #ffffff; }
.missing { display: flex; align-items: center; justify-content: center; padding: 12px; text-align: center; border: 1px dashed var(--muted); border-radius: 8px; color: var(--muted); }
figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
.picked { font-size: 12px; font-weight: 600; color: var(--mark); border: 1px solid currentColor; border-radius: 999px; padding: 1px 8px; margin-left: 8px; vertical-align: middle; }`

// One frame: the page at `src`, relative to design/, at `width` by `height` pixels, shown scaled to
// SHOWN pixels high; or a placeholder of the same size when its file is missing.
function frame(src, width, height, label, present) {
  const scale = SHOWN / height
  const box = `width:${Math.round(width * scale)}px;height:${SHOWN}px`
  const caption = `<figcaption>${width} px · <a href="${escape(src)}">open</a></figcaption>`
  if (!present) return `<figure><div class="missing" style="${box}">${escape(src)} is missing</div><figcaption>${width} px</figcaption></figure>`
  const view = `width:${width}px;height:${height}px;transform:scale(${scale.toFixed(4)})`
  return `<figure><div class="frame" style="${box}"><iframe src="${escape(src)}" title="${escape(`${label}, ${width} pixels wide`)}" loading="lazy" style="${view}"></iframe></div>${caption}</figure>`
}

// The gallery's page for the project at `root`, and the counts its line reports.
export function galleryPage(root, state) {
  const d = state.design
  const [narrow, wide] = d.widths
  const brief = (() => {
    try {
      return fs.readFileSync(path.join(root, 'design', 'brief.md'), 'utf8')
    } catch {
      return ''
    }
  })()
  const title = /^# +(\S.*)$/m.exec(brief)?.[1].trim() || 'Design'
  // The picked direction is the one file the pick's Decision names, when it names exactly one.
  const decision = d.pick === undefined ? '' : (/^- Decision: (.*)$/m.exec(d.pick.text)?.[1] ?? '')
  const named = d.directions.filter((name) => new RegExp(`(?<![\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(decision))
  const picked = named.length === 1 ? named[0] : null
  const screens = d.screens ?? []
  const states = screens.reduce((sum, screen) => sum + screen.states.length, 0)
  const exists = (rel) => fs.existsSync(path.join(root, ...rel.split('/')))
  const out = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(title)} · design</title>`,
    `<style>\n${STYLE}\n</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escape(title)}</h1>`,
    `<p>${plural(d.directions.length, 'direction')}, and ${plural(screens.length, 'screen')} in ${plural(states, 'state')}, each at ${narrow} and ${wide} pixels wide. Epikloop writes this page from design/manifest.md.</p>`,
    '<h2>Directions</h2>',
  ]
  if (d.directions.length === 0) out.push('<p>No direction is drawn yet.</p>')
  for (const name of d.directions) {
    const src = `directions/${encodeURIComponent(name)}`
    const mark = name === picked ? `<span class="picked">picked in ${escape(d.pick.id)}</span>` : ''
    out.push(`<h3>${escape(name)}${mark}</h3>`, `<div class="frames">${frame(src, wide, HEIGHTS[1], name, true)}</div>`)
  }
  out.push('<h2>Screens</h2>')
  if (d.screens === null) out.push("<p>design/manifest.md isn't written yet.</p>")
  else if (screens.length === 0) out.push('<p>design/manifest.md lists no screens yet.</p>')
  for (const screen of screens) {
    const cites = screen.requirements.length === 0 ? 'No requirements' : screen.requirements.join(', ')
    out.push(`<h3 id="${escape(screen.id)}">${escape(screen.title)} <code>${escape(screen.id)}</code></h3>`, `<p>${escape(cites)}</p>`)
    for (const state of screen.states) {
      const file = stateFile(screen.id, state)
      const src = file.slice('design/'.length)
      const label = `${screen.title}, ${state}`
      const present = exists(file)
      out.push(`<h4>${escape(state)}</h4>`, `<div class="frames">${frame(src, narrow, HEIGHTS[0], label, present)}${frame(src, wide, HEIGHTS[1], label, present)}</div>`)
    }
  }
  out.push('</main>', '</body>', '</html>', '')
  return { html: out.join('\n'), directions: d.directions.length, screens: screens.length, states, missing: d.missing.length }
}

// Writes the gallery of the project at or above `dir`: { code, text }, the exit code and the line.
export function writeGallery(dir) {
  const opened = openProject(dir)
  if (opened === null) return { code: 1, text: 'Not an Epikloop project.' }
  if (opened.problem !== null) return { code: 1, text: `.epikloop/project.json ${opened.problem}.` }
  const state = readState(opened.root, opened.project)
  if (state.lane === null) return { code: 1, text: `Lane "${opened.project.lane}" is not one of ${laneNames().join(', ')}.` }
  if (state.design === null) return { code: 1, text: `The ${state.lane.name} lane skips design, so it has no gallery.` }
  const page = galleryPage(opened.root, state)
  const target = path.join(opened.root, ...GALLERY.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const part = `${target}.${process.pid}.tmp`
  fs.writeFileSync(part, page.html)
  fs.renameSync(part, target)
  const [narrow, wide] = state.design.widths
  const missing = page.missing > 0 ? `, ${plural(page.missing, 'state')} without a file yet` : ''
  const counts = `${plural(page.directions, 'direction')}, ${plural(page.screens, 'screen')} in ${plural(page.states, 'state')}${missing}, at ${narrow} and ${wide} pixels`
  return { code: 0, text: `gallery: wrote ${GALLERY}: ${counts}. Open it at ${pathToFileURL(target).href}` }
}

// ---- The self-test

const MARKER = (lane = 'web') => `${JSON.stringify({ format: 1, id: '000000000000', lane, mode: 'solo' })}\n`
const SPEC = '# Greet\n\nA page that greets a person.\n\n## REQ-GREET-001 Greet by name\n\nIt greets a person by name.\n'
const MANIFEST =
  '# Screens\n\n## greet Greet\n- States: default, empty\n- Requirements: REQ-GREET-001\n\nThe page.\n\n## sign-in Sign in <now>\n- States: default, error\n- Requirements: none\n'
// A web project with three directions, the pick of b, and every state of two screens.
const DESIGNED = {
  '.epikloop/project.json': MARKER(),
  'spec/greet.md': SPEC,
  'design/brief.md': '# Greeter & "co" <b>\n\nThe brief.\n',
  'design/directions/a.html': '<!doctype html>\n',
  'design/directions/b.html': '<!doctype html>\n',
  'design/directions/odd name.html': '<!doctype html>\n',
  'docs/decisions.md': '# Decisions\n\n## DECISION-001 Design direction (2026-11-07)\n- Context: three directions.\n- Decision: design/directions/b.html, the quiet one.\n- Rejected: a.html and odd name.html.\n- Trade-offs: none.\n- Implementation note: none.\n',
  'design/tokens.css': ':root { --ink: #222; }\n',
  'design/manifest.md': MANIFEST,
  'design/screens/greet.html': '<!doctype html>\n',
  'design/screens/greet.empty.html': '<!doctype html>\n',
  'design/screens/sign-in.html': '<!doctype html>\n',
  'design/screens/sign-in.error.html': '<!doctype html>\n',
}

// Every file under `dir` with its content, as one string, the gallery left out.
function snapshot(dir) {
  const all = []
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (path.relative(dir, full).split(path.sep).join('/') !== GALLERY) all.push(`${path.relative(dir, full)}\n${fs.readFileSync(full, 'utf8')}`)
    }
  }
  walk(dir)
  return all.join('\n--\n')
}

const frames = (html) => [...html.matchAll(/<iframe src="([^"]*)"[^>]*style="width:(\d+)px/g)].map((m) => `${m[1]}@${m[2]}`)

// Each case: [name, files, check(run, dir, html, rerun)], where run is the script's
// { status, stdout }, html is the gallery it left or null, rerun runs the script again from a
// folder, and check returns the problems found.
const CASES = [
  [
    'outside a project, nothing is written',
    { 'design/manifest.md': MANIFEST },
    (run, dir, html) => [...(run.status === 1 && run.stdout === 'Not an Epikloop project.\n' ? [] : [`gave ${run.status} ${JSON.stringify(run.stdout)}`]), ...(html === null ? [] : ['wrote a gallery'])],
  ],
  [
    'a lane that skips design writes nothing',
    { ...DESIGNED, '.epikloop/project.json': MARKER('service') },
    (run, dir, html) => [
      ...(run.status === 1 && run.stdout === 'The service lane skips design, so it has no gallery.\n' ? [] : [`gave ${run.status} ${JSON.stringify(run.stdout)}`]),
      ...(html === null ? [] : ['wrote a gallery']),
    ],
  ],
  [
    'directions alone, before the manifest, each framed at the wide width',
    { '.epikloop/project.json': MARKER(), 'spec/greet.md': SPEC, 'design/brief.md': '# Greeter\n', 'design/directions/a.html': '', 'design/directions/b.html': '' },
    (run, dir, html) => {
      const problems = []
      const got = frames(html ?? '').join(' ')
      if (got !== 'directions/a.html@1280 directions/b.html@1280') problems.push(`framed ${got}`)
      if (!html?.includes("<p>design/manifest.md isn't written yet.</p>")) problems.push('lacks the missing manifest')
      if (!html?.includes('<title>Greeter · design</title>')) problems.push("lacks the brief's title")
      if (!run.stdout.startsWith('gallery: wrote design/index.html: 2 directions, 0 screens in 0 states, at 390 and 1280 pixels. Open it at file:')) problems.push(`said ${JSON.stringify(run.stdout)}`)
      return problems
    },
  ],
  [
    'a full design frames every state at both widths, in the manifest order',
    DESIGNED,
    (run, dir, html) => {
      const problems = []
      const got = frames(html ?? '').filter((f) => f.startsWith('screens/')).join(' ')
      const wanted = ['greet.html', 'greet.empty.html', 'sign-in.html', 'sign-in.error.html'].flatMap((name) => [`screens/${name}@390`, `screens/${name}@1280`]).join(' ')
      if (got !== wanted) problems.push(`framed ${got}`)
      if (!/style="width:185px;height:400px"><iframe src="screens\/greet.html"[^>]*style="width:390px;height:844px;transform:scale\(0\.4739\)"/.test(html ?? '')) problems.push('lacks the narrow frame at its scale')
      if (!/style="width:640px;height:400px"><iframe src="screens\/greet.html"[^>]*style="width:1280px;height:800px;transform:scale\(0\.5000\)"/.test(html ?? '')) problems.push('lacks the wide frame at its scale')
      if (run.status !== 0 || !run.stdout.startsWith('gallery: wrote design/index.html: 3 directions, 2 screens in 4 states, at 390 and 1280 pixels. Open it at file:')) problems.push(`said ${run.status} ${JSON.stringify(run.stdout)}`)
      return problems
    },
  ],
  [
    'a missing state shows as a placeholder, and the line counts it',
    { ...DESIGNED, 'design/screens/sign-in.error.html': null },
    (run, dir, html) => {
      const problems = []
      const placeholders = (html ?? '').split('screens/sign-in.error.html is missing').length - 1
      if (placeholders !== 2) problems.push(`showed ${placeholders} placeholders`)
      if (frames(html ?? '').some((f) => f.startsWith('screens/sign-in.error.html'))) problems.push('framed the missing file')
      if (!run.stdout.includes('2 screens in 4 states, 1 state without a file yet, at 390 and 1280 pixels.')) problems.push(`said ${JSON.stringify(run.stdout)}`)
      return problems
    },
  ],
  [
    "the project's text is escaped, and odd file names are encoded",
    DESIGNED,
    (run, dir, html) => {
      const problems = []
      for (const text of ['<h1>Greeter &amp; &quot;co&quot; &lt;b&gt;</h1>', 'Sign in &lt;now&gt;', 'src="directions/odd%20name.html"', '<h3>odd name.html</h3>']) {
        if (!html?.includes(text)) problems.push(`lacks ${JSON.stringify(text)}`)
      }
      for (const text of ['<b>', '<now>']) if (html?.includes(text)) problems.push(`holds ${JSON.stringify(text)}`)
      return problems
    },
  ],
  [
    'the direction the pick names is marked, and only it',
    DESIGNED,
    (run, dir, html) => {
      const marks = [...(html ?? '').matchAll(/<h3>([^<]*)<span class="picked">picked in DECISION-001<\/span><\/h3>/g)].map((m) => m[1])
      return marks.join(' ') === 'b.html' ? [] : [`marked ${JSON.stringify(marks)}`]
    },
  ],
  [
    'the page holds no script and loads nothing from outside design/',
    DESIGNED,
    (run, dir, html) => {
      const problems = []
      for (const pattern of [/<script/i, /https?:/i, /@import/i, /(?:src|href)="(?:\/|\.\.)/i]) if (pattern.test(html ?? '')) problems.push(`matches ${pattern}`)
      return problems
    },
  ],
  [
    'writing it again changes nothing, and nothing else is touched',
    DESIGNED,
    (run, dir, html, rerun) => {
      const problems = []
      const before = snapshot(dir)
      const again = rerun(path.join(dir, 'design'))
      if (again.status !== 0) problems.push(`the second run gave ${again.status}`)
      if (fs.readFileSync(path.join(dir, ...GALLERY.split('/')), 'utf8') !== html) problems.push('the second run changed the page')
      if (snapshot(dir) !== before) problems.push('the second run touched another file')
      const own = Object.fromEntries(Object.entries(DESIGNED).filter(([, text]) => text !== null))
      for (const [file, text] of Object.entries(own)) if (fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8') !== text) problems.push(`${file} changed`)
      return problems
    },
  ],
]

async function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-gallery-'))
  const home = path.join(temp, 'home')
  fs.mkdirSync(home)
  const env = {}
  for (const [key, value] of Object.entries(process.env)) if (!/^(?:GIT_.*|HOME|USERPROFILE)$/i.test(key)) env[key] = value
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: temp, HOME: home, USERPROFILE: home })
  const failures = []
  try {
    for (const [n, [name, files, check]] of CASES.entries()) {
      const dir = path.join(temp, `case-${n}`)
      for (const [file, text] of Object.entries(files)) {
        if (text === null) continue
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        fs.writeFileSync(path.join(dir, file), text)
      }
      const rerun = (cwd) => spawnSync(process.execPath, [import.meta.filename], { cwd, env, encoding: 'utf8', windowsHide: true })
      const run = rerun(dir)
      let html = null
      try {
        html = fs.readFileSync(path.join(dir, ...GALLERY.split('/')), 'utf8')
      } catch {}
      let problems
      try {
        problems = check(run, dir, html, rerun)
      } catch (error) {
        problems = [`threw ${error.message}`]
      }
      const left = fs.existsSync(path.join(dir, 'design')) ? fs.readdirSync(path.join(dir, 'design')).filter((entry) => entry.endsWith('.tmp')) : []
      if (left.length > 0) problems.push(`left ${left.join(', ')}`)
      if (run.stderr) problems.push(`printed to stderr: ${run.stderr.trim().split('\n')[0]}`)
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`gallery self-test: ${CASES.length - failures.length}/${CASES.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {
  if (process.argv[2] === '--self-test') await selfTest()
  else if (process.argv.length > 2) {
    console.log('usage: node gallery.mjs [--self-test]')
    process.exitCode = 1
  } else {
    const { code, text } = writeGallery(process.cwd())
    console.log(text)
    process.exitCode = code
  }
}
