// Epikloop's reader of a project's state. It parses the four project files in their formats
// (docs/formats.md) and reads git, then derives what the stage machine and the fuel gauge need:
// which stories are done, the current phase, the stage and its next step, and the gauge. Nothing
// is stored; every read derives it again. The briefing imports it, and skills run it:
//
//   node state.mjs                                          the state of the project here
//   node state.mjs --ready [N | N.M]                        the stories a batch may start, or why none
//   node state.mjs --story N.M                              a story-worker's brief
//   node state.mjs --ids                                    the next question and decision numbers
//   node state.mjs --retro                                  the retro's brief, or the tags it leaves
//   node state.mjs --release                                the release's brief, or the tag it leaves
//   node state.mjs --lane plan|story|retro                  that section of the project's lane
//   node state.mjs --lanes                                  the lanes, with what each is for
//   node state.mjs --example spec|stories|queue|decisions   a project file's example, its format
//   node state.mjs --self-test                              every case below, in throwaway repos
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DAY = 86_400_000
const REQ_ID = 'REQ-[A-Z0-9]{2,12}-\\d{3,}'
const REQ = new RegExp(`^${REQ_ID}$`)
const STORY = /^\d+\.\d+$/
const DATE = '\\d{4}-\\d{2}-\\d{2}'
// The velocity window, in days.
const WINDOW = 14
// This many waiting questions send the batch to decide first.
const MANY_QUESTIONS = 5

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const list = (text) => text.split(',').map((item) => item.trim()).filter(Boolean)

function markdownFiles(root, dir) {
  try {
    return fs
      .readdirSync(path.join(root, ...dir.split('/')), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

const linesOf = (text) => text.replace(/^﻿/, '').split(/\r?\n/)

// The entry whose heading is at line `i`, up to the next heading of level one or two.
function sectionAt(lines, i) {
  let end = i + 1
  while (end < lines.length && !/^##? /.test(lines[end])) end += 1
  return lines.slice(i, end).join('\n').trimEnd()
}

function readLines(root, rel) {
  try {
    return linesOf(fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8'))
  } catch {
    return null
  }
}

// Reads the `- Key: value` lines that open an entry, from line `i`, into `fields`. Returns the
// index of the first line after them.
function readFields(lines, i, names, fields, problem) {
  let at = i
  while (at < lines.length && lines[at].trim() === '' && Object.keys(fields).length === 0) at += 1
  for (; at < lines.length; at += 1) {
    const field = /^- ([A-Z][A-Za-z -]*): (.*)$/.exec(lines[at])
    if (field === null || !names.includes(field[1])) break
    if (field[1] in fields) problem(at + 1, `has a second ${field[1]}`)
    fields[field[1]] = field[2].trim()
  }
  return at
}

// spec/<capability>.md: `## REQ-CODE-NNN Title`, then an optional `Status: observed|retired`.
function readSpec(root, problems) {
  const requirements = new Map()
  for (const name of markdownFiles(root, 'spec')) {
    if (name === 'architecture.md') continue
    const rel = `spec/${name}`
    const lines = readLines(root, rel) ?? []
    lines.forEach((line, i) => {
      if (!line.startsWith('## REQ-')) return
      const heading = new RegExp(`^## (${REQ_ID}) \\S`).exec(line)
      if (heading === null) return problems.push(`${rel}:${i + 1}: "${line}" is not "## REQ-CODE-NNN Title"`)
      const id = heading[1]
      if (requirements.has(id)) return problems.push(`${rel}:${i + 1}: ${id} is already in ${requirements.get(id).file}`)
      let next = i + 1
      while (next < lines.length && lines[next].trim() === '') next += 1
      let status = 'current'
      if (lines[next]?.startsWith('Status:')) {
        const given = /^Status: (observed|retired)$/.exec(lines[next].trim())
        if (given === null) problems.push(`${rel}:${next + 1}: ${id}'s status is not observed or retired`)
        else status = given[1]
      }
      requirements.set(id, { id, file: rel, status, text: sectionAt(lines, i) })
    })
  }
  return requirements
}

// docs/stories/<N>-<slug>.md: `# Epic N: Title`, then `## N.M Title` stories, each with its fields
// and a `### Spec delta`.
function readStories(root, problems) {
  const stories = new Map()
  for (const name of markdownFiles(root, 'docs/stories')) {
    const rel = `docs/stories/${name}`
    const named = /^(\d+)-[a-z0-9][a-z0-9-]*\.md$/.exec(name)
    if (named === null) {
      problems.push(`${rel}:1: the file name is not N-slug.md`)
      continue
    }
    const epic = Number(named[1])
    const lines = readLines(root, rel) ?? []
    const title = lines.findIndex((line) => line.startsWith('# '))
    const opening = title === -1 ? null : new RegExp(`^# Epic ${epic}: (\\S.*)$`).exec(lines[title].trim())
    if (opening === null) problems.push(`${rel}:${title + 1 || 1}: it doesn't open with "# Epic ${epic}: Title"`)
    const epicTitle = opening?.[1] ?? `Epic ${epic}`
    let story = null
    let delta = false
    const finish = () => {
      if (story === null) return
      for (const field of ['Tier', 'MVP', 'Requirements']) {
        if (story.fields[field] === undefined) problems.push(`${rel}:${story.line}: ${story.id} has no ${field}`)
      }
      if (!story.delta) problems.push(`${rel}:${story.line}: ${story.id} has no "### Spec delta"`)
      const { Tier: tier, MVP: mvp, Requirements: cited, After: after } = story.fields
      if (tier !== undefined && !/^T[123]$/.test(tier)) problems.push(`${rel}:${story.line}: ${story.id}'s Tier is not T1, T2 or T3`)
      if (mvp !== undefined && mvp !== 'yes' && mvp !== 'no') problems.push(`${rel}:${story.line}: ${story.id}'s MVP is not yes or no`)
      const requirements = cited === undefined || cited === 'none' ? [] : list(cited)
      if (requirements.some((id) => !REQ.test(id))) problems.push(`${rel}:${story.line}: ${story.id}'s Requirements are not REQ IDs or none`)
      story.after = after === undefined ? [] : list(after)
      if (story.after.some((id) => !STORY.test(id))) problems.push(`${rel}:${story.line}: ${story.id}'s After is not story IDs`)
      Object.assign(story, { tier: /^T[123]$/.test(tier) ? tier : null, mvp: mvp === 'yes', requirements })
      delete story.fields
      stories.set(story.id, story)
    }
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.startsWith('## ')) {
        finish()
        story = null
        const heading = /^## (\d+\.\d+) \S/.exec(line)
        const id = heading?.[1]
        if (heading === null || Number(id.split('.')[0]) !== epic) {
          problems.push(`${rel}:${i + 1}: "${line}" is not "## ${epic}.M Title"`)
        } else if (stories.has(id)) {
          problems.push(`${rel}:${i + 1}: ${id} is already in ${stories.get(id).file}`)
        } else {
          story = { id, epic, epicTitle, title: line.slice(`## ${id} `.length).trim(), file: rel, line: i + 1, text: sectionAt(lines, i), fields: {}, delta: false }
          i = readFields(lines, i + 1, ['Tier', 'MVP', 'Requirements', 'After'], story.fields, (at, what) =>
            problems.push(`${rel}:${at}: ${id} ${what}`),
          ) - 1
          delta = false
        }
        continue
      }
      if (story === null) continue
      if (line.startsWith('### ')) {
        delta = line.trim() === '### Spec delta'
        if (delta) story.delta = true
        continue
      }
      if (delta && line.trim() !== '' && !new RegExp(`^- (?:none|(?:add|change|retire) ${REQ_ID}(?:: \\S.*)?)$`).test(line)) {
        problems.push(`${rel}:${i + 1}: ${story.id}'s spec delta line is not "- add|change|retire REQ-… [: text]" or "- none"`)
      }
    }
    finish()
  }
  for (const story of stories.values()) {
    for (const id of story.after) {
      if (STORY.test(id) && !stories.has(id)) problems.push(`${story.file}:${story.line}: ${story.id} comes after ${id}, which is not a story`)
    }
  }
  return stories
}

// docs/queue.md: `## Questions`, each `### Q-NNN Title (date)` with Blocks and Default taken, and
// `## Backlog`, one dated line each. With `problems` null it only counts, for an earlier version.
function readQueue(text, problems, stories) {
  const rel = 'docs/queue.md'
  const report = (line, what) => problems?.push(`${rel}:${line}: ${what}`)
  const questions = []
  const asked = new Set()
  let backlog = 0
  let section = null
  const lines = text === null ? [] : linesOf(text)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      section = { '## Questions': 'questions', '## Backlog': 'backlog' }[line.trim()] ?? null
      if (section === null) report(i + 1, `"${line}" is not "## Questions" or "## Backlog"`)
      continue
    }
    if (section === 'questions' && line.startsWith('### ')) {
      const heading = new RegExp(`^### (Q-\\d{3,}) (\\S.*) \\((${DATE})\\)$`).exec(line.trim())
      if (heading === null) {
        report(i + 1, `"${line}" is not "### Q-NNN Title (YYYY-MM-DD)"`)
        continue
      }
      const at = i + 1
      if (asked.has(heading[1])) report(at, `${heading[1]} is already a question`)
      asked.add(heading[1])
      const fields = {}
      i = readFields(lines, i + 1, ['Blocks', 'Default taken'], fields, (at, what) => report(at, `${heading[1]} ${what}`)) - 1
      for (const field of ['Blocks', 'Default taken']) {
        if (fields[field] === undefined) report(i + 1, `${heading[1]} has no ${field}`)
      }
      const blocks = fields.Blocks === undefined || fields.Blocks === 'nothing' ? [] : list(fields.Blocks)
      for (const id of blocks) {
        if (!STORY.test(id) || (stories !== null && !stories.has(id))) report(i + 1, `${heading[1]} blocks ${id}, which is not a story`)
      }
      questions.push({ id: heading[1], title: heading[2], date: heading[3], blocks, line: at })
    } else if (section === 'backlog' && line.startsWith('- ')) {
      if (new RegExp(`^- ${DATE} \\S`).test(line)) backlog += 1
      else report(i + 1, 'a backlog line does not start with its date, "- YYYY-MM-DD"')
    }
  }
  return { questions, backlog }
}

// docs/decisions.md: `## DECISION-NNN Title (date)`, each with its fields.
function readDecisions(root, problems) {
  const rel = 'docs/decisions.md'
  const lines = readLines(root, rel) ?? []
  const decisions = []
  const required = ['Context', 'Decision', 'Rejected', 'Trade-offs', 'Implementation note']
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('## ')) continue
    const heading = new RegExp(`^## (DECISION-\\d{3,}) (\\S.*) \\(${DATE}\\)$`).exec(lines[i].trim())
    if (heading === null) {
      problems.push(`${rel}:${i + 1}: "${lines[i]}" is not "## DECISION-NNN Title (YYYY-MM-DD)"`)
      continue
    }
    const [, id, title] = heading
    if (decisions.some((d) => d.id === id)) problems.push(`${rel}:${i + 1}: ${id} appears twice`)
    const fields = {}
    readFields(lines, i + 1, ['Answers', ...required], fields, (at, what) => problems.push(`${rel}:${at}: ${id} ${what}`))
    for (const field of required) if (fields[field] === undefined) problems.push(`${rel}:${i + 1}: ${id} has no ${field}`)
    const answers = fields.Answers !== undefined && /^Q-\d{3,}$/.test(fields.Answers) ? fields.Answers : null
    if (fields.Answers !== undefined && answers === null) problems.push(`${rel}:${i + 1}: ${id}'s Answers is not a Q-NNN`)
    decisions.push({ id, title, answers, text: sectionAt(lines, i) })
  }
  return decisions
}

// ---- Lanes: lanes/<name>.json, the profile, and lanes/<name>.md, its fragment (docs/lanes.md)

const LANES = path.join(import.meta.dirname, '..', 'lanes')
const LANE_NAME = /^[a-z][a-z0-9-]*$/
// The fragment's sections, each printed where its name says: into the plan, a story's brief and the
// retro's brief.
const LANE_SECTIONS = ['Plan', 'Story', 'Retro']

// The lanes this plugin has, by name.
export function laneNames() {
  try {
    return fs
      .readdirSync(LANES)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
  } catch {
    return []
  }
}

// The lane `name`: its profile, with its fragment's sections as `sections`, or null when the plugin
// has no such lane.
export function readLane(name) {
  if (typeof name !== 'string' || !LANE_NAME.test(name)) return null
  let profile
  try {
    profile = JSON.parse(fs.readFileSync(path.join(LANES, `${name}.json`), 'utf8'))
  } catch {
    return null
  }
  const sections = {}
  const lines = readLines(LANES, `${name}.md`) ?? []
  lines.forEach((line, i) => {
    const heading = /^## (\S.*)$/.exec(line)
    if (heading !== null) sections[heading[1].trim()] = sectionAt(lines, i).split('\n').slice(1).join('\n').trim()
  })
  return { ...profile, sections }
}

// What is wrong with a lane, by its schema, or null. The self-test holds every lane to it.
function laneProblem(lane, file) {
  if (lane === null || typeof lane !== 'object' || Array.isArray(lane)) return "doesn't read as a JSON object"
  const fields = ['$schema', 'format', 'name', 'description', 'requires', 'ui_test', 'sections']
  const unknown = Object.keys(lane).filter((key) => !fields.includes(key))
  if (unknown.length > 0) return `has ${unknown.join(', ')}, which no lane field is`
  if (lane.format !== 1) return 'has an unknown format'
  if (lane.name !== file) return `is named ${JSON.stringify(lane.name)}, not ${file}`
  if (typeof lane.description !== 'string' || lane.description === '') return 'has no description'
  if (!Array.isArray(lane.requires) || lane.requires.some((p) => typeof p !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(p))) return "has requires that aren't program names"
  const ui = lane.ui_test
  const plain = (entry) => typeof entry === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._/:=+,-]*$/.test(entry)
  if (ui !== null && (typeof ui?.tool !== 'string' || typeof ui.package !== 'string' || !Array.isArray(ui.allow) || !ui.allow.every(plain))) {
    return 'has a ui_test without its tool, its package and plain allow entries'
  }
  const extra = Object.keys(lane.sections).filter((name) => !LANE_SECTIONS.includes(name))
  if (extra.length > 0) return `has ${extra.map((name) => `## ${name}`).join(', ')} in its fragment, which no brief prints`
  return null
}

function gitReader(root) {
  return (args) => {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true })
    return run.status === 0 ? run.stdout : null
  }
}

// The default branch and the tags, from one git call. The branch is origin/HEAD, else main, else
// master, else HEAD; null outside a repository.
function refsOf(git) {
  const candidates = ['refs/remotes/origin/HEAD', 'refs/heads/main', 'refs/heads/master']
  const listed = git(['for-each-ref', '--format=%(refname)', ...candidates, 'refs/tags'])
  if (listed === null) return { branch: null, tags: new Set() }
  const names = listed.split('\n').filter(Boolean)
  const tags = new Set(names.filter((name) => name.startsWith('refs/tags/')).map((name) => name.slice('refs/tags/'.length)))
  return { branch: candidates.find((name) => names.includes(name)) ?? 'HEAD', tags }
}

// When each story was done: the first commit on the default branch whose subject starts feat(N.M):.
function doneTimes(git, branch) {
  const done = new Map()
  const log = branch === null ? null : git(['log', '--format=%ct%x09%s', branch])
  for (const line of (log ?? '').split('\n')) {
    const [time, subject = ''] = line.split('\t')
    const feat = /^feat\((\d+\.\d+)\):/.exec(subject)
    if (feat !== null) done.set(feat[1], Number(time) * 1000)
  }
  return done
}

// The cost rows the emitter wrote for this project on this machine, folded or not.
function costRows(home, id) {
  const dir = path.join(home, '.epikloop', 'projects', id)
  const rows = []
  const add = (text) => {
    for (const line of text.split('\n')) {
      try {
        const row = JSON.parse(line)
        if (/^T[123]$/.test(row.tier) && Number.isFinite(row.wall) && row.wall > 0) rows.push(row)
      } catch {}
    }
  }
  try {
    add(fs.readFileSync(path.join(dir, 'cost.jsonl'), 'utf8'))
  } catch {}
  try {
    for (const name of fs.readdirSync(path.join(dir, 'cost'))) if (name.endsWith('.json')) add(fs.readFileSync(path.join(dir, 'cost', name), 'utf8'))
  } catch {}
  return rows
}

const ymd = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// `MVP done/total · velocity · ETA · queue Δ`. The ETA is the remaining stories' average worker wall
// time for their tier, over the hours per day; it is fiction while the queue grows.
function fuelGauge(project, mvp, done, delta, { now, home }) {
  const closed = mvp.filter((story) => done.has(story.id))
  const frozen = Date.parse(`${project.mvp_frozen}T00:00:00`)
  const days = Number.isNaN(frozen) ? WINDOW : Math.min(WINDOW, Math.max(1, Math.floor((now - frozen) / DAY)))
  const recent = closed.filter((story) => done.get(story.id) <= now && now - done.get(story.id) <= days * DAY).length
  const parts = [`MVP ${closed.length}/${mvp.length}`, `${(recent / days).toFixed(1)} stories/day`]
  const rows = costRows(home, project.id)
  const hours = typeof project.hours_per_day === 'number' && project.hours_per_day > 0 ? project.hours_per_day : null
  if (rows.length === 0 || hours === null) parts.push('ETA unknown')
  else {
    const average = (some) => some.reduce((sum, row) => sum + row.wall, 0) / some.length
    const overall = average(rows)
    const byTier = (tier) => {
      const some = rows.filter((row) => row.tier === tier)
      return some.length > 0 ? average(some) : overall
    }
    const left = mvp.filter((story) => !done.has(story.id)).reduce((sum, story) => sum + byTier(story.tier) / 3600, 0)
    const eta = ymd(now + Math.ceil(left / hours) * DAY)
    parts.push(delta !== null && delta > 0 ? `ETA ${eta} (fiction while the queue grows)` : `ETA ${eta}`)
  }
  parts.push(delta === null ? 'queue Δ unknown' : `queue Δ ${delta > 0 ? '+' : ''}${delta}`)
  return parts.join(' · ')
}

// The decision a closing ceremony recorded, found by its title, or undefined.
const recorded = (s, title) => s.decisions.find((d) => d.title === title)
const signed = (delta) => (delta > 0 ? `+${delta}` : String(delta))
// Why sign-off can't happen yet by the queue, or null when queue Δ allows it.
const queueWait = (delta) => (delta === null ? 'queue Δ is unknown' : delta > 0 ? `queue Δ is ${signed(delta)}` : null)

// The first stage whose test fails: { n, epic, why, next }. `delta` is queue Δ, or null.
function stageOf(root, project, s, delta) {
  const has = (...parts) => fs.existsSync(path.join(root, ...parts))
  const current = [...s.requirements.values()].filter((r) => r.status !== 'retired')
  if (current.length === 0) {
    return { n: 2, why: 'spec/ holds no requirements yet', next: '/epikloop:discover for a new product, or /epikloop:adopt for existing code' }
  }
  const observed = current.filter((r) => r.status === 'observed').length
  if (observed > 0) return { n: 2, why: `${plural(observed, 'requirement')} in spec/ ${observed === 1 ? 'is' : 'are'} still observed`, next: '/epikloop:adopt' }
  // Stage 3, design for a lane with a UI, returns with design's body in M2. Until then a UI lane
  // goes on to architect.
  if (!has('spec', 'architecture.md')) return { n: 4, why: 'spec/architecture.md is missing', next: '/epikloop:architect' }
  if (s.stories.size === 0) return { n: 5, why: 'docs/stories/ holds no stories yet', next: '/epikloop:plan' }
  if (!project.mvp_frozen) return { n: 5, why: "the MVP set isn't frozen", next: '/epikloop:plan' }
  const mvp = [...s.stories.values()].filter((story) => story.mvp)
  if (mvp.length === 0) return { n: 5, why: 'no story is in the MVP set', next: '/epikloop:plan' }
  const epics = [...new Set(mvp.map((story) => story.epic))].sort((a, b) => a - b)
  const epic = epics.find((n) => !s.tags.has(`phase-${n}`))
  if (epic === undefined && !s.tags.has('mvp')) {
    const wait = queueWait(delta)
    if (recorded(s, 'MVP sign-off')) {
      const why = wait === null ? "the MVP sign-off is recorded, and mvp isn't tagged yet" : `the MVP sign-off is recorded, but ${wait}, so mvp isn't tagged`
      return { n: 8, why, next: '/epikloop:retro' }
    }
    return { n: 8, why: `every MVP epic is tagged, and the MVP isn't signed off${wait === null ? '' : `; sign-off waits while ${wait}`}`, next: '/epikloop:retro' }
  }
  if (epic === undefined && !s.tags.has('live')) {
    const why = recorded(s, 'Go live') ? "the go-live is recorded, and live isn't tagged yet" : 'the MVP is signed off, and nothing is live yet'
    return { n: 9, why, next: '/epikloop:release' }
  }
  if (epic === undefined) {
    // Post-MVP: the backlog is visible, and planned work runs epic by epic.
    const work = planOrder(s.stories).find((story) => !s.done.has(story.id))
    const why = `the product is live${s.backlog > 0 ? `, and docs/queue.md holds ${plural(s.backlog, 'backlog line')}` : ''}`
    return { n: 10, epic: work?.epic, why, next: work === undefined ? '/epikloop:plan --extend' : `/epikloop:epic ${work.epic}` }
  }
  const left = mvp.filter((story) => story.epic === epic && !s.done.has(story.id))
  if (left.length === 0) {
    const why = recorded(s, `Phase ${epic} retro`) ? `epic ${epic}'s retro is recorded, and phase-${epic} isn't tagged yet` : `epic ${epic}'s MVP stories are done, and it has no phase-${epic} tag`
    return { n: 7, epic, why, next: '/epikloop:retro' }
  }
  const why = `epic ${epic} has ${plural(left.length, 'MVP story', 'MVP stories')} left`
  const blocking = s.questions.filter((q) => q.blocks.some((id) => left.some((story) => story.id === id)))
  if (blocking.length > 0) {
    const first = blocking[0]
    const blocked = first.blocks.filter((id) => left.some((story) => story.id === id))
    const more = blocking.length > 1 ? ` and ${plural(blocking.length - 1, 'more question')}` : ''
    return { n: 6, epic, why: `${why}, and ${first.id}${more} ${blocking.length > 1 ? 'block' : 'blocks'} ${blocked.join(', ')}`, next: `/epikloop:decide, then /epikloop:epic ${epic}` }
  }
  if (s.questions.length >= MANY_QUESTIONS) return { n: 6, epic, why: `${why}, and ${s.questions.length} questions wait`, next: `/epikloop:decide, then /epikloop:epic ${epic}` }
  return { n: 6, epic, why, next: `/epikloop:epic ${epic}` }
}

// What is wrong with the project marker, by the fields its schema requires, or null.
function markerProblem(project) {
  if (project === null || typeof project !== 'object' || Array.isArray(project)) return 'is not a JSON object'
  if (project.format !== 1) return 'has an unknown format'
  if (typeof project.id !== 'string' || !/^[0-9a-f]{12}$/.test(project.id)) return 'has no valid id'
  if (typeof project.lane !== 'string' || !/^[a-z][a-z0-9-]*$/.test(project.lane)) return 'has no valid lane'
  if (project.mode !== 'solo' && project.mode !== 'team') return 'has no valid mode'
  return null
}

// The Epikloop project at or above `dir`, the one whose folder holds .epikloop/project.json:
// { root, project, problem }, where `problem` says what is wrong with the marker. Null outside one.
export function openProject(dir) {
  let root = path.resolve(dir)
  while (!fs.existsSync(path.join(root, '.epikloop', 'project.json'))) {
    if (path.dirname(root) === root) return null
    root = path.dirname(root)
  }
  try {
    const project = JSON.parse(fs.readFileSync(path.join(root, '.epikloop', 'project.json'), 'utf8').replace(/^﻿/, ''))
    const problem = markerProblem(project)
    return { root, project: problem === null ? project : null, problem }
  } catch (error) {
    return { root, project: null, problem: `doesn't parse (${String(error?.message ?? error).split('\n')[0]})` }
  }
}

const SKILLS = path.join(import.meta.dirname, '..', 'skills')

// Whether only the human starts the command `next` begins with: its skill's frontmatter keeps the
// model from invoking it.
function humanStarts(next) {
  const name = /^\/epikloop:([a-z-]+)/.exec(next)?.[1]
  if (name === undefined) return false
  try {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8'))?.[1] ?? ''
    return /^disable-model-invocation: true\s*$/m.test(front)
  } catch {
    return false
  }
}

// What the briefing and the CLI both say: the gauge, the project and its stage as `parts`, and
// `needs`, what needs the human. `state` is null when the marker has a problem.
export function summary(opened, state) {
  if (opened.problem !== null) return { parts: ['Epikloop project.'], needs: [`.epikloop/project.json ${opened.problem}`] }
  const { project } = opened
  const { n, why, next } = state.stage
  const parts = [
    ...(state.gauge === null ? [] : [`${state.gauge}.`]),
    `Epikloop project ${project.id} (${project.lane}, ${project.mode}).`,
    `Stage ${n} of 10: ${why}. Next: ${next}${humanStarts(next) ? ', which only the human starts' : ''}.`,
  ]
  const waiting = state.questions.length
  const needs = waiting > 0 ? [`${waiting} ${waiting === 1 ? 'question waits' : 'questions wait'} in docs/queue.md`] : []
  return { parts, needs }
}

// The project's state, derived from its files and git. `project` is its parsed marker.
export function readState(root, project, { now = Date.now(), home = os.homedir() } = {}) {
  const problems = []
  const requirements = readSpec(root, problems)
  const stories = readStories(root, problems)
  const queueText = readLines(root, 'docs/queue.md')?.join('\n') ?? null
  const { questions, backlog } = readQueue(queueText, problems, stories)
  const decisions = readDecisions(root, problems)
  const lane = readLane(project.lane)
  if (lane === null) {
    const at = (readLines(root, '.epikloop/project.json') ?? []).findIndex((line) => /"lane"\s*:/.test(line)) + 1 || 1
    problems.push(`.epikloop/project.json:${at}: lane "${project.lane}" is not one of ${laneNames().join(', ')}`)
  }
  for (const q of questions) {
    const answer = decisions.find((d) => d.answers === q.id)
    if (answer !== undefined) problems.push(`docs/queue.md:${q.line}: ${q.id} is already answered by ${answer.id}`)
  }
  const git = gitReader(root)
  const { branch, tags } = refsOf(git)
  const done = doneTimes(git, branch)
  const s = { requirements, stories, questions, backlog, decisions, problems, done, tags }

  // Queue Δ: the open entries now minus those at the start of the current phase. Until the `mvp`
  // tag, the current phase is the lowest untagged MVP epic, else the last one, so sign-off weighs
  // the whole final phase. The base is the highest phase tag below it, else the commit that froze
  // the MVP set.
  let [gauge, delta, base] = [null, null, null]
  const mvp = [...stories.values()].filter((story) => story.mvp)
  if (project.mvp_frozen && mvp.length > 0) {
    const epics = [...new Set(mvp.map((story) => story.epic))].sort((a, b) => a - b)
    const current = tags.has('mvp') ? Infinity : (epics.find((n) => !tags.has(`phase-${n}`)) ?? epics.at(-1))
    const phases = [...tags].map((tag) => /^phase-(\d+)$/.exec(tag)?.[1]).filter(Boolean).map(Number).filter((n) => n < current)
    const freeze = branch === null ? null : git(['log', '--reverse', '--format=%H', '-S"mvp_frozen"', branch, '--', '.epikloop/project.json'])?.split('\n')[0] || null
    base = phases.length > 0 ? `phase-${Math.max(...phases)}` : freeze === null ? null : 'the freeze'
    if (base !== null) {
      const before = readQueue(git(['show', `${base === 'the freeze' ? freeze : base}:docs/queue.md`]), null, null)
      delta = questions.length + backlog - (before.questions.length + before.backlog)
    }
    gauge = fuelGauge(project, mvp, done, delta, { now, home })
  }
  return { ...s, lane, stage: stageOf(root, project, s, delta), gauge, delta, base }
}

// ---- What a batch reads

const minor = (story) => Number(story.id.split('.')[1])
const planOrder = (stories) => [...stories.values()].sort((a, b) => a.epic - b.epic || minor(a) - minor(b))

// What a batch needs from git beyond the state, or null without a commit to start from: the
// default branch's name, the remote it lands on and how far apart the two are, whether the
// checkout is clean and on that branch, and the stories in review, whose feat commit is on another
// branch and not yet on the default one.
export function batchFacts(root) {
  const git = gitReader(root)
  const { branch } = refsOf(git)
  if (branch === null || git(['rev-parse', '--verify', '-q', 'HEAD']) === null) return null
  const current = git(['symbolic-ref', '-q', 'HEAD'])?.trim().replace(/^refs\/heads\//, '') ?? null
  let name = current
  if (branch === 'refs/remotes/origin/HEAD') name = git(['symbolic-ref', '-q', branch])?.trim().replace(/^refs\/remotes\/origin\//, '') ?? null
  else if (branch.startsWith('refs/heads/')) name = branch.slice('refs/heads/'.length)
  const remotes = (git(['remote']) ?? '').split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
  const exists = (ref) => git(['rev-parse', '--verify', '-q', ref]) !== null
  const upstream = remote !== null && name !== null && exists(`refs/remotes/${remote}/${name}`) ? `${remote}/${name}` : null
  let [ahead, behind] = [0, 0]
  if (upstream !== null && exists(`refs/heads/${name}`)) {
    const counts = git(['rev-list', '--left-right', '--count', `refs/heads/${name}...refs/remotes/${upstream}`])
    ;[ahead, behind] = (counts ?? '0 0').trim().split(/\s+/).map(Number)
  }
  const status = git(['status', '--porcelain'])
  const review = new Set()
  for (const subject of (git(['log', '--format=%s', '--branches', '--remotes', '--not', branch]) ?? '').split('\n')) {
    const feat = /^feat\((\d+\.\d+)\):/.exec(subject)
    if (feat !== null) review.add(feat[1])
  }
  return { name, current, remote, upstream, ahead, behind, clean: status !== null && status.trim() === '', review }
}

// Why a story that isn't done can't start now, or null when it can.
function hold(story, state, facts) {
  const blockers = state.questions.filter((q) => q.blocks.includes(story.id)).map((q) => q.id)
  if (blockers.length > 0) return `is blocked by ${blockers.join(', ')}`
  if (facts.review.has(story.id)) return 'is in review, committed on another branch'
  const waits = story.after.filter((id) => !state.done.has(id))
  if (waits.length > 0) return `waits for ${waits.join(', ')}`
  if (story.tier === null) return 'has no tier the reader can read'
  return null
}

// Why a batch or a ceremony can't start from this checkout, naming the git command that fixes it
// when there is one, or null. `what` says what starts: "a batch", "a retro" or "a release".
function startProblem(project, facts, what) {
  if (!facts.clean) return `The working tree has changes that aren't committed, and ${what} starts from a clean tree.`
  if (facts.current === null || facts.current !== facts.name) {
    return `${what[0].toUpperCase()}${what.slice(1)} starts on ${facts.name}, and ${facts.current === null ? 'HEAD is detached' : `this checkout is on ${facts.current}`}.`
  }
  if (facts.ahead > 0 && facts.behind > 0) return `${facts.name} and ${facts.upstream} have diverged, and the human reconciles them before ${what} starts.`
  if (facts.ahead > 0) {
    const one = facts.ahead === 1
    const how = project.mode === 'team' ? `in team mode ${one ? 'it lands' : 'they land'} through a pull request` : `\`git push ${facts.remote} ${facts.name}\` lands ${one ? 'it' : 'them'}`
    return `${facts.name} has ${plural(facts.ahead, 'commit')} that ${facts.upstream} lacks; ${how} before ${what} starts.`
  }
  if (facts.behind > 0) return `${facts.name} is ${plural(facts.behind, 'commit')} behind ${facts.upstream}; \`git pull --ff-only ${facts.remote} ${facts.name}\` brings it up to date.`
  return null
}

// The stories a batch may start, as `N.M Tn Title` lines in plan order, the line a worker's spawn
// description starts with. `select` is an epic's number, or one story's ID, which may be outside
// the MVP set; without it, the current phase's epic, or every epic once all are tagged. Before the
// `mvp` tag only MVP stories run. When none can start, `text` says why, and `fails` is set when the
// checkout has to change first.
export function readyList(state, project, facts, select) {
  const say = (text, fails = false) => ({ lines: [], text, fails })
  const { stage } = state
  if (stage.n < 6) return say(`Nothing is ready: ${stage.why}. Next: ${stage.next}.`)
  if (facts === null) return say('Nothing is ready: there is no commit to start from.', true)
  const problem = startProblem(project, facts, 'a batch')
  if (problem !== null) return say(problem, true)
  const line = (story) => `${story.id} ${story.tier} ${story.title}`
  if (select !== undefined && STORY.test(select)) {
    const story = state.stories.get(select)
    if (story === undefined) return say(`${select} is not a story.`, true)
    if (state.done.has(select)) return say(`${select} is done.`)
    const why = hold(story, state, facts)
    return why === null ? { lines: [line(story)] } : say(`${select} ${why}, so it is not ready.`)
  }
  if (select === undefined && stage.n === 7) return say(`Nothing is ready: ${stage.why}. Next: ${stage.next}.`)
  const epic = select !== undefined ? Number(select) : stage.n === 6 ? stage.epic : null
  const signedOff = state.tags.has('mvp')
  const lines = []
  const reasons = []
  for (const story of planOrder(state.stories)) {
    if ((epic !== null && story.epic !== epic) || state.done.has(story.id) || (!signedOff && !story.mvp)) continue
    const why = hold(story, state, facts)
    if (why === null) lines.push(line(story))
    else reasons.push(`${story.id} ${why}`)
  }
  if (lines.length > 0) return { lines }
  const where = epic === null ? '' : ` in epic ${epic}`
  if (reasons.length > 0) return say(`Nothing is ready${where}: ${reasons.join('; ')}.`)
  return say(`Nothing is left to run${where}.${epic === null ? ` Next: ${stage.next}.` : ''}`)
}

// How a commit lands: pushed to the default branch in solo mode, through `branch` and a pull
// request the human merges in team mode. `commit` says what the commit is.
function landing(project, facts, commit, branch) {
  const name = facts?.name ?? 'the default branch'
  if (facts?.remote == null) {
    const none = project.mode === 'team' ? 'Team mode lands through a pull request, and there is no remote yet' : 'There is no remote, so nothing is pushed'
    return `Landing: ${commit}, on ${name}. ${none}.`
  }
  if (project.mode === 'team') {
    return `Landing: \`git switch -c ${branch} ${facts.upstream ?? name}\`; ${commit}; \`git push -u ${facts.remote} ${branch}\`; a pull request with that subject as its title, through \`gh pr create\`; then \`git switch ${name}\`. The human merges it.`
  }
  return `Landing: ${commit}, on ${name}, then \`git push ${facts.remote} ${name}\`.`
}

// The next question and decision numbers, never reusing one a decision answered, and the forms
// that use them.
const following = (ids) => String(Math.max(0, ...ids.map((id) => Number(id.split('-')[1]))) + 1).padStart(3, '0')
const nextDecision = (state) => `DECISION-${following(state.decisions.map((d) => d.id))}`

export function nextIds(state, now) {
  const question = following([...state.questions.map((q) => q.id), ...state.decisions.map((d) => d.answers).filter(Boolean)])
  const today = ymd(now)
  return [
    `A parked question goes under "## Questions" in docs/queue.md as "### Q-${question} Title (${today})", numbered on from there, then "- Blocks:" with the stories it blocks or "nothing", "- Default taken:" with the default the work goes on with, and the question itself.`,
    `A backlog line goes under "## Backlog" as "- ${today} what was found".`,
    `The next decision in docs/decisions.md is ${nextDecision(state)}.`,
  ]
}

// A story-worker's brief: the story, the requirements it cites and the decisions that name it,
// each verbatim, then how its commit lands and the numbers for anything it parks. Null for an
// unknown story.
export function storyBrief(state, project, facts, id, now) {
  const story = state.stories.get(id)
  if (story === undefined) return null
  const out = [`Story ${id}, from ${story.file}:`, '', story.text, '']
  if (story.requirements.length > 0) out.push('The requirements it cites:', '')
  for (const req of story.requirements) {
    const r = state.requirements.get(req)
    out.push(...(r === undefined ? [`${req} is not in spec/ yet.`] : [`From ${r.file}:`, '', r.text]), '')
  }
  const own = new RegExp(`(?<![\\d.])${id.replace('.', '\\.')}(?!\\d|\\.\\d)`)
  const named = new Set(story.text.match(/DECISION-\d{3,}/g) ?? [])
  const decisions = state.decisions.filter((d) => named.has(d.id) || own.test(d.text))
  if (decisions.length > 0) out.push('The decisions that name it, from docs/decisions.md:', '')
  for (const d of decisions) out.push(d.text, '')
  out.push(...laneSection(state, 'Story'))
  const commit = `one commit whose subject starts "feat(${id}): ", holding the code, its tests and the spec delta`
  return [...out, landing(project, facts, commit, `story/${id}`), '', ...nextIds(state, now)]
}

// The project's lane's section `name`, as brief lines, or none when the lane has no such section.
function laneSection(state, name) {
  const text = state.lane?.sections[name]
  return text ? [`The ${state.lane.name} lane:`, '', text, ''] : []
}

// ---- What the closing ceremonies read

// A URL as it may be shown: without the credentials it may carry.
export function shownUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    return parsed.href
  } catch {
    return '(not a URL)'
  }
}

// What the ceremony's records leave to do: the tags, placed once the records are on the default
// branch, as `git tag` and `git push` commands.
function tagging(facts, tags) {
  const push = facts.remote === null ? '' : `, then \`git push ${facts.remote} ${tags.join(' ')}\``
  return `What's left is the ${tags.length === 1 ? 'tag' : 'tags'}: ${tags.map((tag) => `\`git tag ${tag}\``).join(' and ')}${push}.`
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// The cost rows on this machine, per tier and effort: how many runs, and their mean wall time and
// cost.
function costLines(project, home) {
  const groups = new Map()
  for (const row of costRows(home, project.id)) {
    const key = `${row.tier} at ${EFFORTS.includes(row.effort) ? row.effort : 'an unknown effort'}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  if (groups.size === 0) return ['There are no cost rows on this machine yet.']
  const order = (key) => Number(key[1]) * 10 + (EFFORTS.indexOf(key.split(' at ')[1]) + 1)
  const lines = [...groups].sort(([a], [b]) => order(a) - order(b)).map(([key, rows]) => {
    const wall = (rows.reduce((sum, row) => sum + row.wall, 0) / rows.length / 60).toFixed(1)
    const costs = rows.map((row) => row.cost).filter(Number.isFinite)
    const cost = costs.length === 0 ? '' : ` and $${(costs.reduce((sum, c) => sum + c, 0) / costs.length).toFixed(2)}`
    return `- ${key}: ${plural(rows.length, 'run')}, ${wall} min${cost} each on average`
  })
  return ['The cost rows on this machine:', ...lines]
}

// The queue as a ceremony weighs it: its open entries, and queue Δ with its base.
function queueLine(state) {
  const delta = state.delta === null ? 'queue Δ unknown' : `queue Δ ${signed(state.delta)} since ${state.base === 'the freeze' ? 'the MVP set was frozen' : state.base}`
  return `The queue: ${plural(state.questions.length, 'question')} and ${plural(state.backlog, 'backlog line')}; ${delta}.`
}

function stagingLine(project, what) {
  const url = typeof project.staging_url === 'string' && project.staging_url !== '' ? project.staging_url : null
  return url === null ? `${what}, though .epikloop/project.json has no staging_url: the human sets it, or the record says why there is no staging` : `${what} against ${shownUrl(url)}`
}

// A ceremony that can't run now, and why.
const refuse = (text) => ({ text, fails: true })

// The retro's brief at stage 7, where a phase closes, or at stage 8, the MVP sign-off: what it
// covers, the evidence it gathers, the queue, the cost rows, the record and how it lands. Once a
// record is on the default branch, only the tags it leaves.
export function retroBrief(state, project, facts, { home = os.homedir() } = {}) {
  const { stage } = state
  if (stage.n !== 7 && stage.n !== 8) return refuse(`A retro waits: ${stage.why}. Next: ${stage.next}.`)
  if (facts === null) return refuse('A retro needs a commit to start from.')
  const problem = startProblem(project, facts, 'a retro')
  if (problem !== null) return refuse(problem)

  const epics = [...new Set([...state.stories.values()].filter((story) => story.mvp).map((story) => story.epic))].sort((a, b) => a - b)
  const last = stage.n === 8 || stage.epic === epics.at(-1)
  const retro = stage.n === 7 ? recorded(state, `Phase ${stage.epic} retro`) : undefined
  const signOff = last ? recorded(state, 'MVP sign-off') : undefined
  const tags = []
  const notes = []
  if (retro !== undefined) tags.push(`phase-${stage.epic}`)
  if (signOff !== undefined && (stage.n === 8 || retro !== undefined)) {
    const wait = queueWait(state.delta)
    if (wait === null) tags.push('mvp')
    else notes.push(`MVP sign-off is recorded in ${signOff.id}, but ${wait}, so mvp isn't tagged.`)
  }
  if (tags.length > 0) {
    const records = [retro, tags.includes('mvp') ? signOff : undefined].filter(Boolean).map((d) => `${d.title} in ${d.id}`)
    return { text: [`Recorded: ${records.join(' and ')}. ${tagging(facts, tags)}`, ...notes].join('\n') }
  }

  const next = nextDecision(state)
  const out = []
  if (stage.n === 7) {
    const stories = planOrder(state.stories).filter((story) => story.epic === stage.epic && story.mvp)
    out.push(
      `Retro for phase ${stage.epic}: epic ${stage.epic}, ${stories[0].epicTitle}.`,
      'Its stories, for the click-through:',
      ...stories.map((story) => `- ${story.id} ${story.title}`),
      `The evidence: the deep gates, \`scripts/check.sh --deep\` from Bash or \`node .githooks/check.mjs --deep\` from PowerShell; the gates' self-test, the same with \`--self-test\`; ${stagingLine(project, 'the staging smoke')}; and the human's click-through of these stories on staging.`,
      ...(state.lane?.sections.Retro ? [`The ${state.lane.name} lane: ${state.lane.sections.Retro.replace(/\s*\n\s*/g, ' ')}`] : []),
      queueLine(state),
      ...costLines(project, home),
    )
  } else {
    out.push(
      'MVP sign-off: every MVP epic is tagged.',
      `The evidence: ${stagingLine(project, 'the staging smoke')}; and the human's click-through of the MVP on staging.`,
      queueLine(state),
    )
  }
  out.push(...notes)
  if (last) {
    const current = state.delta === null ? 'it is unknown now' : `it is ${signed(state.delta)} now`
    const opening = stage.n === 7 ? `Epic ${stage.epic} is the last MVP epic, so this retro is also the MVP sign-off. ` : ''
    out.push(`${opening}Sign-off needs queue Δ at 0 or below, counted after the pruning, and a green staging smoke; ${current}.`)
  }
  const titles = []
  if (stage.n === 7) titles.push(`a decision titled "Phase ${stage.epic} retro"`)
  if (last && signOff === undefined) titles.push(`${titles.length > 0 ? 'one' : 'a decision'} titled "MVP sign-off" if the human signs off`)
  out.push(
    titles.length === 0
      ? `The record: MVP sign-off is already recorded in ${signOff.id}, so the commit holds the pruning.`
      : `The record, in docs/decisions.md: ${titles.join(', and ')}, ${titles.length > 1 ? `from ${next} on` : next}.`,
  )
  const subject = stage.n === 7 ? `chore(phase-${stage.epic}): retro` : 'chore(mvp): sign-off'
  const branch = stage.n === 7 ? `retro/phase-${stage.epic}` : 'retro/mvp'
  out.push(landing(project, facts, `one commit whose subject is "${subject}", holding the record, the queue and whatever else the retro changes`, branch))
  out.push('Once it has landed, `--retro` again prints the tags.')
  return { text: out.join('\n') }
}

// The release's brief at stage 9: staging, where the hosting is described, the production smoke,
// the record and how it lands. Once the record is on the default branch, only the tag.
export function releaseBrief(state, project, facts) {
  const { stage } = state
  if (stage.n !== 9) return refuse(`A release waits: ${stage.why}. Next: ${stage.next}.`)
  if (facts === null) return refuse('A release needs a commit to start from.')
  const problem = startProblem(project, facts, 'a release')
  if (problem !== null) return refuse(problem)
  const live = recorded(state, 'Go live')
  if (live !== undefined) return { text: `Recorded: ${live.title} in ${live.id}. ${tagging(facts, ['live'])}` }
  const url = typeof project.staging_url === 'string' && project.staging_url !== '' ? project.staging_url : null
  return {
    text: [
      'Release: the MVP is signed off, and nothing is live yet.',
      url === null ? 'Staging: .epikloop/project.json has no staging_url, so the human names where the signed-off build runs.' : `Staging: ${shownUrl(url)}.`,
      'The hosting: spec/architecture.md says how staging is hosted, and production follows it.',
      "The evidence: the production smoke, the same script given production's URL, once the build the mvp tag marks is promoted.",
      `The record: spec/architecture.md gains how production runs, how a build is promoted to it and how it is rolled back; and a decision in docs/decisions.md titled "Go live", ${nextDecision(state)}, whose implementation note holds the post-launch checklist.`,
      landing(project, facts, 'one commit whose subject is "chore(release): go live", holding the record and any production configuration', 'release/live'),
      'Once it has landed, `--release` again prints the tag.',
    ].join('\n'),
  }
}

const TEMPLATES = path.join(import.meta.dirname, '..', 'templates')
const EXAMPLES = { spec: 'spec/capability.md', stories: 'docs/stories/epic.md', queue: 'docs/queue.md', decisions: 'docs/decisions.md' }
const USAGE =
  'usage: node state.mjs [--ready [N | N.M] | --story N.M | --ids | --retro | --release | --lane plan|story|retro | --lanes | --example spec|stories|queue|decisions]'
// The flags that read a project for a batch, a ceremony or a lane, each with a test of its argument.
const FLAGS = {
  '--ready': (arg) => arg === undefined || /^\d+(?:\.\d+)?$/.test(arg),
  '--story': (arg) => STORY.test(arg ?? ''),
  '--ids': (arg) => arg === undefined,
  '--retro': (arg) => arg === undefined,
  '--release': (arg) => arg === undefined,
  '--lane': (arg) => LANE_SECTIONS.some((section) => section.toLowerCase() === arg),
}

// The state of the project in the current folder, as lines a skill reads, or one example.
function cli(argv) {
  const [flag, name, ...rest] = argv
  if (flag === '--example' && EXAMPLES[name] !== undefined && rest.length === 0) {
    return process.stdout.write(fs.readFileSync(path.join(TEMPLATES, ...EXAMPLES[name].split('/')), 'utf8'))
  }
  // The lanes, for choosing one, before a project exists.
  if (flag === '--lanes' && name === undefined) {
    return console.log(laneNames().map((lane) => `- ${lane}: ${readLane(lane)?.description ?? "its profile doesn't read"}`).join('\n'))
  }
  if (flag !== undefined && !(Object.hasOwn(FLAGS, flag) && FLAGS[flag](name) && rest.length === 0)) {
    process.exitCode = 1
    return console.log(USAGE)
  }
  const opened = openProject(process.cwd())
  if (opened === null) {
    if (flag !== undefined) process.exitCode = 1
    return console.log('Not an Epikloop project.')
  }
  if (flag !== undefined) {
    if (opened.problem !== null) {
      process.exitCode = 1
      return console.log(`.epikloop/project.json ${opened.problem}.`)
    }
    const state = readState(opened.root, opened.project)
    const now = Date.now()
    if (flag === '--ids') return console.log(nextIds(state, now).join('\n'))
    if (flag === '--lane') {
      if (state.lane === null) {
        process.exitCode = 1
        return console.log(`Lane "${opened.project.lane}" is not one of ${laneNames().join(', ')}.`)
      }
      const section = LANE_SECTIONS.find((each) => each.toLowerCase() === name)
      return console.log(state.lane.sections[section] ?? `The ${state.lane.name} lane adds nothing here.`)
    }
    const facts = batchFacts(opened.root)
    if (flag === '--retro' || flag === '--release') {
      const brief = flag === '--retro' ? retroBrief(state, opened.project, facts) : releaseBrief(state, opened.project, facts)
      if (brief.fails) process.exitCode = 1
      return console.log(brief.text)
    }
    if (flag === '--story') {
      const brief = storyBrief(state, opened.project, facts, name, now)
      if (brief === null) process.exitCode = 1
      return console.log(brief === null ? `${name} is not a story.` : brief.join('\n'))
    }
    const ready = readyList(state, opened.project, facts, name)
    if (ready.fails) process.exitCode = 1
    return console.log(ready.lines.length > 0 ? ready.lines.join('\n') : ready.text)
  }
  const state = opened.problem === null ? readState(opened.root, opened.project) : null
  const { parts, needs } = summary(opened, state)
  const lines = [...parts]
  if (needs.length > 0) lines.push(`Needs the human: ${needs.join('; ')}.`)
  if (state?.questions.length > 0) {
    lines.push('Waiting questions:')
    for (const q of state.questions) lines.push(`- ${q.id} ${q.title} (${q.date}), blocks ${q.blocks.length > 0 ? q.blocks.join(', ') : 'nothing'}`)
  }
  if (state?.problems.length > 0) {
    lines.push('Unreadable lines:')
    for (const problem of state.problems) lines.push(`- ${problem}`)
  }
  console.log(lines.join('\n'))
}

// ---- The self-test

const NOW = Date.UTC(2026, 10, 15, 12)
const MARKER = { format: 1, id: '000000000000', lane: 'web', mode: 'solo' }

// A stories file for epic `n`: each story is [m, tier, mvp, after?].
function epicFile(n, stories) {
  const body = stories.map(([m, tier, mvp, after]) =>
    [`## ${n}.${m} Story ${n}.${m}`, `- Tier: ${tier}`, `- MVP: ${mvp ? 'yes' : 'no'}`, '- Requirements: REQ-APP-001', ...(after ? [`- After: ${after}`] : []), '', 'Body.', '', '### Spec delta', '- none', ''].join('\n'),
  )
  return `# Epic ${n}: Epic ${n}\n\n${body.join('\n')}`
}

function queueFile({ questions = [], backlog = 0 } = {}) {
  const asked = questions.map(([id, blocks]) => `### ${id} Question (2026-11-01)\n- Blocks: ${blocks}\n- Default taken: the safe one\n\nWhy.\n`)
  const lines = Array.from({ length: backlog }, (_, i) => `- 2026-11-0${(i % 9) + 1} Backlog item ${i + 1}`)
  return `# Queue\n\n## Questions\n\n${asked.join('\n')}\n## Backlog\n\n${lines.join('\n')}\n`
}

// A decisions file whose entries carry `titles`, numbered from DECISION-001.
function decisionsFile(titles) {
  const entry = (title, i) => `## DECISION-${String(i + 1).padStart(3, '0')} ${title} (2026-11-10)\n- Context: c\n- Decision: d\n- Rejected: r\n- Trade-offs: t\n- Implementation note: n\n`
  return `# Decisions\n\n${titles.map(entry).join('\n')}`
}

// A project past stage 5, with `epics` as { n: stories } for epicFile.
function planned(epics, queue) {
  const files = {
    'spec/app.md': '# App\n\nWhat it is.\n\n## REQ-APP-001 It works\n\nIt works.\n',
    'spec/architecture.md': '# Architecture\n',
    'design/manifest.md': '# Screens\n',
    'docs/queue.md': queueFile(queue),
  }
  for (const [n, stories] of Object.entries(epics)) files[`docs/stories/${n}-epic.md`] = epicFile(Number(n), stories)
  return files
}

const CASES = [
  [
    'the templates read cleanly',
    (k) => {
      const dir = k.folder({
        'spec/checkout.md': k.template('spec/capability.md'),
        'docs/stories/3-checkout.md': k.template('docs/stories/epic.md'),
        'docs/queue.md': k.template('docs/queue.md'),
        'docs/decisions.md': k.template('docs/decisions.md'),
      })
      const s = k.read(dir)
      const story = (id) => s.stories.get(id)
      return k.expect([
        [s.problems.join(' | '), ''],
        [[...s.requirements.values()].map((r) => `${r.id} ${r.status}`).join(', '), 'REQ-CHECKOUT-001 current, REQ-CHECKOUT-002 observed, REQ-CHECKOUT-003 retired'],
        [[...s.stories.keys()].join(' '), '3.1 3.2 3.3'],
        [`${story('3.1').tier} ${story('3.2').tier} ${story('3.3').tier}`, 'T1 T3 T2'],
        [`${story('3.1').mvp} ${story('3.3').mvp} ${story('3.2').after}`, 'true false 3.1'],
        [s.questions.map((q) => `${q.id}>${q.blocks}`).join(' '), 'Q-007>3.2 Q-008>3.3'],
        [s.backlog, 2],
        [s.decisions.map((d) => `${d.id}>${d.answers}`).join(' '), 'DECISION-001>null DECISION-002>Q-006'],
        [`${s.stage.n} ${s.stage.next}`, '2 /epikloop:adopt'],
      ])
    },
  ],
  [
    'malformed entries are problems, with file and line',
    (k) => {
      const dir = k.folder({
        'spec/a.md': '# A\n\n## REQ-A-001 Too short a code\n\n## REQ-APP-001 One\nStatus: draft\n',
        'spec/b.md': '# B\n\n## REQ-APP-001 Again\n',
        'docs/stories/checkout.md': '# Epic 9: Misnamed\n',
        'docs/stories/1-one.md': [
          '# Epic 1: One',
          '## 1.1 No tier',
          '- MVP: yes',
          '- Requirements: REQ-APP-001',
          '### Spec delta',
          '- none',
          '## 1.2: Colon',
          '## 1.3 Bad fields',
          '- Tier: T4',
          '- MVP: maybe',
          '- Requirements: auth',
          '- After: 9.9',
          '### Spec delta',
          '- rename REQ-APP-001',
          '## 1.1 Twice',
          '## 1.4 No delta',
          '- Tier: T1',
          '- MVP: no',
          '- Requirements: none',
          '',
        ].join('\n'),
        'docs/queue.md': '# Queue\n\n## Questions\n\n### Q-001 No default (2026-11-01)\n- Blocks: 7.7\n\n## Later\n\n## Backlog\n\n- undated\n',
        'docs/decisions.md': '# Decisions\n\n## DECISION-001 Thin (2026-11-01)\n- Decision: yes\n',
      })
      const s = k.read(dir)
      return k.contains(s.problems, [
        'spec/a.md:3: "## REQ-A-001 Too short a code" is not "## REQ-CODE-NNN Title"',
        "spec/a.md:6: REQ-APP-001's status is not observed or retired",
        'spec/b.md:3: REQ-APP-001 is already in spec/a.md',
        'docs/stories/checkout.md:1: the file name is not N-slug.md',
        'docs/stories/1-one.md:2: 1.1 has no Tier',
        'docs/stories/1-one.md:7: "## 1.2: Colon" is not "## 1.M Title"',
        "docs/stories/1-one.md:8: 1.3's Tier is not T1, T2 or T3",
        "docs/stories/1-one.md:8: 1.3's MVP is not yes or no",
        "docs/stories/1-one.md:8: 1.3's Requirements are not REQ IDs or none",
        "docs/stories/1-one.md:14: 1.3's spec delta line is not",
        'docs/stories/1-one.md:15: 1.1 is already in docs/stories/1-one.md',
        'docs/stories/1-one.md:16: 1.4 has no "### Spec delta"',
        'docs/stories/1-one.md:8: 1.3 comes after 9.9, which is not a story',
        'docs/queue.md:6: Q-001 has no Default taken',
        'docs/queue.md:6: Q-001 blocks 7.7, which is not a story',
        'docs/queue.md:8: "## Later" is not "## Questions" or "## Backlog"',
        'docs/queue.md:12: a backlog line does not start with its date',
        'docs/decisions.md:3: DECISION-001 has no Context',
      ])
    },
  ],
  [
    'done comes from feat commits on the default branch',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true], [3, 'T1', true]] }))
      k.commit(dir, 'feat(1.1): one', 3)
      k.commit(dir, 'fix(1.3): not a feature', 2)
      k.git(dir, 'switch', '-q', '-c', 'side')
      k.commit(dir, 'feat(1.2): only on a side branch', 1)
      k.git(dir, 'switch', '-q', 'main')
      const s = k.read(dir)
      return k.expect([[[...s.done.keys()].join(' '), '1.1']])
    },
  ],
  [
    'origin/HEAD names the default branch',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }))
      k.git(dir, 'switch', '-q', '-c', 'trunk')
      k.commit(dir, 'feat(1.1): on trunk', 1)
      k.git(dir, 'update-ref', 'refs/remotes/origin/trunk', 'trunk')
      k.git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
      k.git(dir, 'switch', '-q', 'main')
      return k.expect([[[...k.read(dir).done.keys()].join(' '), '1.1']])
    },
  ],
  [
    'a UI lane goes on to architect until design arrives in M2',
    (k) => {
      const files = planned({ 1: [[1, 'T1', true]] })
      delete files['design/manifest.md']
      delete files['spec/architecture.md']
      return k.stage(k.repo(files), '4 spec/architecture.md is missing → /epikloop:architect')
    },
  ],
  [
    'stage 5 without an MVP story',
    (k) => k.stage(k.repo(planned({ 1: [[1, 'T1', false]] })), '5 no story is in the MVP set → /epikloop:plan'),
  ],
  [
    'stage 6 runs the lowest untagged epic',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true], [2, 'T2', true], [3, 'T1', false]] }))
      k.commit(dir, 'feat(1.1): one', 2)
      k.git(dir, 'tag', 'phase-1')
      return k.stage(dir, '6 epic 2 has 2 MVP stories left → /epikloop:epic 2')
    },
  ],
  [
    'stage 6 goes to decide when a question blocks',
    (k) =>
      k.stage(
        k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }, { questions: [['Q-001', '1.2']] })),
        '6 epic 1 has 2 MVP stories left, and Q-001 blocks 1.2 → /epikloop:decide, then /epikloop:epic 1',
      ),
  ],
  [
    'stage 6 goes to decide when five questions wait',
    (k) => {
      const questions = ['Q-001', 'Q-002', 'Q-003', 'Q-004', 'Q-005'].map((id) => [id, 'nothing'])
      return k.stage(k.repo(planned({ 1: [[1, 'T1', true]] }, { questions })), '6 epic 1 has 1 MVP story left, and 5 questions wait → /epikloop:decide, then /epikloop:epic 1')
    },
  ],
  [
    'stage 7 when the phase is done but untagged',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }))
      k.commit(dir, 'feat(1.1): one', 1)
      return k.stage(dir, "7 epic 1's MVP stories are done, and it has no phase-1 tag → /epikloop:retro")
    },
  ],
  [
    'stage 7 when the retro is recorded but the phase is untagged',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }))
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro']))
      k.commit(dir, 'feat(1.1): one', 1)
      return k.stage(dir, "7 epic 1's retro is recorded, and phase-1 isn't tagged yet → /epikloop:retro")
    },
  ],
  [
    'stage 8: sign-off weighs the whole final phase, and waits while the queue grew',
    (k) => {
      // One entry at phase-1, three at phase-2: +2 over the final phase, though 0 since its tag.
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true], [2, 'T1', false]] }, { backlog: 1 }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'tag', 'phase-1')
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 3 }))
      k.commit(dir, 'feat(2.1): two', 0)
      k.git(dir, 'tag', 'phase-2')
      const got = [k.stage(dir, "8 every MVP epic is tagged, and the MVP isn't signed off; sign-off waits while queue Δ is +2 → /epikloop:retro")]
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 1 }))
      k.commit(dir, 'chore(mvp): sign-off', 0)
      got.push(k.stage(dir, "8 every MVP epic is tagged, and the MVP isn't signed off → /epikloop:retro"))
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'Phase 2 retro', 'MVP sign-off']))
      k.commit(dir, 'chore(mvp): sign-off', 0)
      got.push(k.stage(dir, "8 the MVP sign-off is recorded, and mvp isn't tagged yet → /epikloop:retro"))
      return got.flat()
    },
  ],
  [
    'stages 9 and 10: the release, then the work after the MVP',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', false]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'tag', 'phase-1')
      k.git(dir, 'tag', 'mvp')
      const got = [k.stage(dir, '9 the MVP is signed off, and nothing is live yet → /epikloop:release')]
      k.write(dir, 'docs/decisions.md', decisionsFile(['Go live']))
      k.commit(dir, 'chore(release): go live', 0)
      got.push(k.stage(dir, "9 the go-live is recorded, and live isn't tagged yet → /epikloop:release"))
      k.git(dir, 'tag', 'live')
      got.push(k.stage(dir, '10 the product is live → /epikloop:epic 1'))
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 2 }))
      k.commit(dir, 'feat(1.2): two', 0)
      got.push(k.stage(dir, '10 the product is live, and docs/queue.md holds 2 backlog lines → /epikloop:plan --extend'))
      return got.flat()
    },
  ],
  [
    'the gauge: velocity, ETA by tier and queue Δ since the freeze',
    (k) => {
      // Ten MVP stories: 1.1–1.7 done (1.7 outside the window), 1.8–1.10 left as T1, T1, T2.
      const stories = Array.from({ length: 10 }, (_, i) => [i + 1, i === 9 ? 'T2' : 'T1', true])
      const dir = k.repo(planned({ 1: stories }, { backlog: 1 }), { freeze: true, frozenAgo: 20 })
      for (let m = 1; m <= 7; m += 1) k.commit(dir, `feat(1.${m}): story`, m === 7 ? 16 : m)
      k.costs({ 'cost.jsonl': [['T1', 1800], ['T1', 3600]], 'cost/1-x-1.json': [['T2', 7200]] })
      // Left: 0.75 h + 0.75 h + 2 h = 3.5 h, at 2 h a day: 2 days.
      return k.gauge(dir, `MVP 7/10 · 0.4 stories/day · ETA ${ymd(NOW + 2 * DAY)} · queue Δ 0`, { hours_per_day: 2 })
    },
  ],
  [
    'a tier without rows takes the overall average',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T3', true]] }), { freeze: true, frozenAgo: 3 })
      k.costs({ 'cost.jsonl': [['T1', 3600], ['T2', 10800]] })
      return k.gauge(dir, `MVP 0/1 · 0.0 stories/day · ETA ${ymd(NOW + DAY)} · queue Δ 0`, { hours_per_day: 2 })
    },
  ],
  [
    'no cost rows or no hours per day leave the ETA unknown',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }), { freeze: true, frozenAgo: 3 })
      const problems = k.gauge(dir, 'MVP 0/1 · 0.0 stories/day · ETA unknown · queue Δ 0', { hours_per_day: 2 })
      k.costs({ 'cost.jsonl': [['T1', 3600]] })
      problems.push(...k.gauge(dir, 'MVP 0/1 · 0.0 stories/day · ETA unknown · queue Δ 0'))
      return problems
    },
  ],
  [
    'queue Δ since the last phase tag, with the ETA called fiction',
    (k) => {
      // Three entries at the freeze, one at the tag, three now: +2 since the tag, 0 since the freeze.
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }, { backlog: 3 }), { freeze: true, frozenAgo: 10 })
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 1 }))
      k.commit(dir, 'feat(1.1): one', 5)
      k.git(dir, 'tag', 'phase-1')
      k.write(dir, 'docs/queue.md', queueFile({ questions: [['Q-001', 'nothing']], backlog: 2 }))
      k.costs({ 'cost.jsonl': [['T1', 3600]] })
      return k.gauge(dir, `MVP 1/2 · 0.1 stories/day · ETA ${ymd(NOW + DAY)} (fiction while the queue grows) · queue Δ +2`, { hours_per_day: 4 })
    },
  ],
  [
    'queue Δ since the freeze, before any tag',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }, { backlog: 3 }), { freeze: true, frozenAgo: 3 })
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 1 }))
      return k.gauge(dir, 'MVP 0/1 · 0.0 stories/day · ETA unknown · queue Δ -2')
    },
  ],
  [
    'no gauge until the MVP set is frozen',
    (k) => {
      const s = k.read(k.repo(planned({ 1: [[1, 'T1', true]] })), {})
      return k.expect([[s.gauge, null]])
    },
  ],
  [
    'a question number is used once',
    (k) => {
      const dir = k.folder({
        'docs/queue.md': '# Queue\n\n## Questions\n\n### Q-001 One (2026-11-01)\n- Blocks: nothing\n- Default taken: a\n\n### Q-001 Again (2026-11-02)\n- Blocks: nothing\n- Default taken: b\n',
        'docs/decisions.md': '# Decisions\n\n## DECISION-001 Answered (2026-11-03)\n- Answers: Q-001\n- Context: c\n- Decision: d\n- Rejected: r\n- Trade-offs: t\n- Implementation note: n\n',
      })
      return k.contains(k.read(dir).problems, ['docs/queue.md:9: Q-001 is already a question', 'docs/queue.md:5: Q-001 is already answered by DECISION-001'])
    },
  ],
  [
    'the ready list: the current phase, After, questions and the MVP set',
    (k) => {
      const epics = { 1: [[1, 'T1', true], [2, 'T2', true, '1.1'], [3, 'T1', false], [4, 'T1', true]], 2: [[1, 'T1', true]] }
      const dir = k.repo(planned(epics, { questions: [['Q-001', '1.4']] }), { freeze: true })
      const before = [k.ready(dir), k.ready(dir, '1'), k.ready(dir, '2'), k.ready(dir, '1.3'), k.ready(dir, '1.4'), k.ready(dir, '9.9')]
      k.commit(dir, 'feat(1.1): one', 0)
      return k.expect([
        [before[0], '0 1.1 T1 Story 1.1\n'],
        [before[1], '0 1.1 T1 Story 1.1\n'],
        [before[2], '0 2.1 T1 Story 2.1\n'],
        [before[3], '0 1.3 T1 Story 1.3\n'],
        [before[4], '0 1.4 is blocked by Q-001, so it is not ready.\n'],
        [before[5], '1 9.9 is not a story.\n'],
        [k.ready(dir), '0 1.2 T2 Story 1.2\n'],
        [k.ready(dir, '1.1'), '0 1.1 is done.\n'],
      ])
    },
  ],
  [
    'after the mvp tag every story is ready, across epics in plan order',
    (k) => {
      const dir = k.repo(planned({ 2: [[1, 'T1', true], [2, 'T3', false]], 10: [[1, 'T2', false]] }), { freeze: true })
      k.commit(dir, 'feat(2.1): one', 0)
      k.git(dir, 'tag', 'phase-2')
      const unsigned = k.ready(dir)
      k.git(dir, 'tag', 'mvp')
      return k.expect([
        [unsigned, '0 Nothing is left to run. Next: /epikloop:retro.\n'],
        [k.ready(dir), '0 2.2 T3 Story 2.2\n10.1 T2 Story 10.1\n'],
      ])
    },
  ],
  [
    'nothing is ready, and why',
    (k) => {
      const blocked = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true, '1.1']] }, { questions: [['Q-001', '1.1']] }), { freeze: true })
      const retro = k.repo(planned({ 1: [[1, 'T1', true]] }), { freeze: true })
      k.commit(retro, 'feat(1.1): one', 0)
      const unfrozen = k.repo(planned({ 1: [[1, 'T1', true]] }))
      return k.expect([
        [k.ready(blocked), '0 Nothing is ready in epic 1: 1.1 is blocked by Q-001; 1.2 waits for 1.1.\n'],
        [k.ready(retro), "0 Nothing is ready: epic 1's MVP stories are done, and it has no phase-1 tag. Next: /epikloop:retro.\n"],
        [k.ready(retro, '1'), '0 Nothing is left to run in epic 1.\n'],
        [k.ready(unfrozen), "0 Nothing is ready: the MVP set isn't frozen. Next: /epikloop:plan.\n"],
      ])
    },
  ],
  [
    'a batch starts from a clean, landed default branch',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }), { freeze: true })
      k.remote(dir)
      const got = []
      k.write(dir, 'notes.txt', 'untracked')
      got.push(k.ready(dir))
      fs.rmSync(path.join(dir, 'notes.txt'))
      k.write(dir, 'spec/architecture.md', '# Changed\n')
      got.push(k.ready(dir))
      k.git(dir, 'checkout', '-q', '--', 'spec/architecture.md')
      k.git(dir, 'switch', '-q', '-c', 'side')
      got.push(k.ready(dir))
      k.git(dir, 'switch', '-q', 'main')
      k.commit(dir, 'docs: not pushed yet', 0)
      got.push(k.ready(dir))
      k.git(dir, 'push', '-q', 'origin', 'main')
      k.git(dir, 'reset', '-q', '--hard', 'HEAD~1')
      got.push(k.ready(dir))
      k.commit(dir, 'docs: another', 0)
      got.push(k.ready(dir))
      const dirty = "1 The working tree has changes that aren't committed, and a batch starts from a clean tree.\n"
      return k.expect([
        [got[0], dirty],
        [got[1], dirty],
        [got[2], '1 A batch starts on main, and this checkout is on side.\n'],
        [got[3], '1 main has 1 commit that origin/main lacks; `git push origin main` lands it before a batch starts.\n'],
        [got[4], '1 main is 1 commit behind origin/main; `git pull --ff-only origin main` brings it up to date.\n'],
        [got[5], '1 main and origin/main have diverged, and the human reconciles them before a batch starts.\n'],
      ])
    },
  ],
  [
    'team mode: a story committed on another branch is in review',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true, '1.1'], [3, 'T1', true]] }), { freeze: true, marker: { mode: 'team' } })
      k.remote(dir)
      k.git(dir, 'remote', 'set-head', 'origin', 'main')
      k.git(dir, 'switch', '-q', '-c', 'story/1.1')
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'switch', '-q', 'main')
      const local = [k.ready(dir), k.ready(dir, '1.1')]
      k.git(dir, 'push', '-q', 'origin', 'story/1.1')
      k.git(dir, 'branch', '-q', '-D', 'story/1.1')
      const review = '0 1.1 is in review, committed on another branch, so it is not ready.\n'
      return k.expect([
        [local[0], '0 1.3 T1 Story 1.3\n'],
        [local[1], review],
        [k.ready(dir, '1.1'), review],
      ])
    },
  ],
  [
    'the brief: the story, what it cites and the decisions that name it, then how it lands',
    (k) => {
      const later = [
        '## DECISION-003 Tax on its own line (2026-10-29)',
        '- Context: 3.1 shows the total.',
        '- Decision: tax gets a line of its own.',
        '- Rejected: tax folded into the total.',
        '- Trade-offs: one more line on a small screen.',
        '- Implementation note: 3.1 builds it.',
        '',
        '## DECISION-004 Later stories (2026-10-30)',
        '- Answers: Q-011',
        '- Context: 13.1 and 3.10 come later, after v3.1.2.',
        '- Decision: wait.',
        '- Rejected: now.',
        '- Trade-offs: none.',
        '- Implementation note: none.',
      ]
      const dir = k.repo({
        'spec/checkout.md': k.template('spec/capability.md'),
        'docs/stories/3-checkout.md': k.template('docs/stories/epic.md'),
        'docs/queue.md': k.template('docs/queue.md'),
        'docs/decisions.md': `${k.template('docs/decisions.md').trimEnd()}\n\n${later.join('\n')}\n`,
      })
      const today = ymd(Date.now())
      const ids = [
        `A parked question goes under "## Questions" in docs/queue.md as "### Q-012 Title (${today})", numbered on from there, then "- Blocks:" with the stories it blocks or "nothing", "- Default taken:" with the default the work goes on with, and the question itself.`,
        `A backlog line goes under "## Backlog" as "- ${today} what was found".`,
        'The next decision in docs/decisions.md is DECISION-005.',
      ]
      const brief = (landing) =>
        [
          '0 Story 3.1, from docs/stories/3-checkout.md:',
          '',
          '## 3.1 Cart page',
          '- Tier: T1',
          '- MVP: yes',
          '- Requirements: REQ-CHECKOUT-002',
          '',
          'The cart lists each item with its price, and the total with tax as its own line. Done when the',
          'page matches design/screens/cart.html at both widths.',
          '',
          '### Spec delta',
          '- change REQ-CHECKOUT-002: the total shows tax as its own line',
          '',
          'The requirements it cites:',
          '',
          'From spec/checkout.md:',
          '',
          '## REQ-CHECKOUT-002 Show the total before payment',
          'Status: observed',
          '',
          'The cart shows its total, tax included, before payment starts.',
          '',
          '> "Prices always include tax." (the pricing page)',
          '',
          'The decisions that name it, from docs/decisions.md:',
          '',
          ...later.slice(0, 6),
          '',
          'The web lane:',
          '',
          readLane('web').sections.Story,
          '',
          landing,
          '',
          ...ids,
          '',
        ].join('\n')
      const commit = 'one commit whose subject starts "feat(3.1): ", holding the code, its tests and the spec delta'
      const alone = k.run(dir, '--story', '3.1')
      k.remote(dir)
      const solo = k.run(dir, '--story', '3.1')
      k.write(dir, '.epikloop/project.json', `${JSON.stringify({ ...k.project, mode: 'team' })}\n`)
      const team = k.run(dir, '--story', '3.1')
      return k.expect([
        [alone, brief(`Landing: ${commit}, on main. There is no remote, so nothing is pushed.`)],
        [solo, brief(`Landing: ${commit}, on main, then \`git push origin main\`.`)],
        [
          team,
          brief(
            `Landing: \`git switch -c story/3.1 origin/main\`; ${commit}; \`git push -u origin story/3.1\`; a pull request with that subject as its title, through \`gh pr create\`; then \`git switch main\`. The human merges it.`,
          ),
        ],
        [k.run(dir, '--ids'), `0 ${ids.join('\n')}\n`],
        [k.run(dir, '--story', '9.9'), '1 9.9 is not a story.\n'],
        [k.run(dir, '--story', '3'), `1 ${USAGE}\n`],
      ])
    },
  ],
  [
    'the retro brief: the phase, its evidence, the queue, the cost rows, the record and the landing',
    (k) => {
      const files = planned({ 1: [[1, 'T1', true], [2, 'T2', true], [3, 'T1', false]], 2: [[1, 'T1', true]] }, { questions: [['Q-001', 'nothing']], backlog: 2 })
      files['docs/decisions.md'] = decisionsFile(['Stack'])
      const dir = k.repo(files, { freeze: true, marker: { staging_url: 'https://user:secret@staging.example.com/' } })
      k.commit(dir, 'feat(1.1): one', 0)
      k.commit(dir, 'feat(1.2): two', 0)
      k.remote(dir)
      k.costs({ 'cost.jsonl': [['T1', 1800, 'medium', 0.2], ['T1', 3600, 'medium', 0.4], ['T2', 3600, 'high']], 'cost/1-x-1.json': [['T1', 600, 'low', 0.1]] })
      const brief = [
        '0 Retro for phase 1: epic 1, Epic 1.',
        'Its stories, for the click-through:',
        '- 1.1 Story 1.1',
        '- 1.2 Story 1.2',
        "The evidence: the deep gates, `scripts/check.sh --deep` from Bash or `node .githooks/check.mjs --deep` from PowerShell; the gates' self-test, the same with `--self-test`; the staging smoke against https://staging.example.com/; and the human's click-through of these stories on staging.",
        `The web lane: ${readLane('web').sections.Retro.replace(/\s*\n\s*/g, ' ')}`,
        'The queue: 1 question and 2 backlog lines; queue Δ 0 since the MVP set was frozen.',
        'The cost rows on this machine:',
        '- T1 at low: 1 run, 10.0 min and $0.10 each on average',
        '- T1 at medium: 2 runs, 45.0 min and $0.30 each on average',
        '- T2 at high: 1 run, 60.0 min each on average',
        'The record, in docs/decisions.md: a decision titled "Phase 1 retro", DECISION-002.',
        'Landing: one commit whose subject is "chore(phase-1): retro", holding the record, the queue and whatever else the retro changes, on main, then `git push origin main`.',
        'Once it has landed, `--retro` again prints the tags.',
        '',
      ]
      return k.expect([[k.run(dir, '--retro'), brief.join('\n')]])
    },
  ],
  [
    "the final phase's retro is also the sign-off, and tags only once its record lands",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }, { backlog: 1 }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.remote(dir)
      const brief = k.run(dir, '--retro')
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'MVP sign-off']))
      k.commit(dir, 'chore(phase-1): retro', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      const signed = k.run(dir, '--retro')
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 3 }))
      k.commit(dir, 'docs: the queue grew', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      const grew = k.run(dir, '--retro')
      k.git(dir, 'tag', 'phase-1')
      const waiting = k.run(dir, '--retro')
      const unsigned = "MVP sign-off is recorded in DECISION-002, but queue Δ is +2, so mvp isn't tagged.\n"
      return [
        ...k.has(
          brief,
          'Epic 1 is the last MVP epic, so this retro is also the MVP sign-off. Sign-off needs queue Δ at 0 or below, counted after the pruning, and a green staging smoke; it is 0 now.\n',
          'The record, in docs/decisions.md: a decision titled "Phase 1 retro", and one titled "MVP sign-off" if the human signs off, from DECISION-001 on.\n',
          'the staging smoke, though .epikloop/project.json has no staging_url: the human sets it, or the record says why there is no staging;',
        ),
        ...k.expect([
          [signed, "0 Recorded: Phase 1 retro in DECISION-001 and MVP sign-off in DECISION-002. What's left is the tags: `git tag phase-1` and `git tag mvp`, then `git push origin phase-1 mvp`.\n"],
          [grew, `0 Recorded: Phase 1 retro in DECISION-001. What's left is the tag: \`git tag phase-1\`, then \`git push origin phase-1\`.\n${unsigned}`],
        ]),
        ...k.has(
          waiting,
          '0 MVP sign-off: every MVP epic is tagged.\n',
          unsigned,
          'Sign-off needs queue Δ at 0 or below, counted after the pruning, and a green staging smoke; it is +2 now.\n',
          'The record: MVP sign-off is already recorded in DECISION-002, so the commit holds the pruning.\n',
          'one commit whose subject is "chore(mvp): sign-off"',
        ),
      ]
    },
  ],
  [
    'the retro and the release refuse outside their stage, and where a batch would',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }), { freeze: true, marker: { mode: 'team' } })
      k.commit(dir, 'feat(1.1): one', 0)
      const early = [k.run(dir, '--retro'), k.run(dir, '--release')]
      k.commit(dir, 'feat(1.2): two', 0)
      k.remote(dir)
      const team = k.run(dir, '--retro')
      k.write(dir, 'notes.txt', 'untracked')
      const dirty = k.run(dir, '--retro')
      fs.rmSync(path.join(dir, 'notes.txt'))
      return [
        ...k.expect([
          [early[0], '1 A retro waits: epic 1 has 1 MVP story left. Next: /epikloop:epic 1.\n'],
          [early[1], '1 A release waits: epic 1 has 1 MVP story left. Next: /epikloop:epic 1.\n'],
          [dirty, "1 The working tree has changes that aren't committed, and a retro starts from a clean tree.\n"],
          [k.run(dir, '--release'), "1 A release waits: epic 1's MVP stories are done, and it has no phase-1 tag. Next: /epikloop:retro.\n"],
        ]),
        ...k.has(
          team,
          'Landing: `git switch -c retro/phase-1 origin/main`; one commit whose subject is "chore(phase-1): retro", holding the record, the queue and whatever else the retro changes; `git push -u origin retro/phase-1`; a pull request with that subject as its title, through `gh pr create`; then `git switch main`. The human merges it.\n',
        ),
      ]
    },
  ],
  [
    'the release brief, then the tag once its record lands',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }), { freeze: true, marker: { staging_url: 'https://staging.example.com' } })
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'tag', 'phase-1')
      k.git(dir, 'tag', 'mvp')
      k.remote(dir)
      const brief = k.run(dir, '--release')
      k.write(dir, 'docs/decisions.md', decisionsFile(['MVP sign-off', 'Go live']))
      k.commit(dir, 'chore(release): go live', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      const wanted = [
        '0 Release: the MVP is signed off, and nothing is live yet.',
        'Staging: https://staging.example.com/.',
        'The hosting: spec/architecture.md says how staging is hosted, and production follows it.',
        "The evidence: the production smoke, the same script given production's URL, once the build the mvp tag marks is promoted.",
        'The record: spec/architecture.md gains how production runs, how a build is promoted to it and how it is rolled back; and a decision in docs/decisions.md titled "Go live", DECISION-001, whose implementation note holds the post-launch checklist.',
        'Landing: one commit whose subject is "chore(release): go live", holding the record and any production configuration, on main, then `git push origin main`.',
        'Once it has landed, `--release` again prints the tag.',
        '',
      ]
      return k.expect([
        [brief, wanted.join('\n')],
        [k.run(dir, '--release'), "0 Recorded: Go live in DECISION-002. What's left is the tag: `git tag live`, then `git push origin live`.\n"],
      ])
    },
  ],
  [
    'the CLI reports the state, its questions and its unreadable lines',
    (k) => {
      const files = planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }, { questions: [['Q-001', '1.2']] })
      files['docs/stories/2-more.md'] = '# Epic 2: More\n\n## 2.1 No fields\n\n### Spec delta\n- none\n'
      const dir = k.repo(files, { freeze: true, frozenAgo: 3 })
      const run = k.cli(path.join(dir, 'docs'))
      return k.expect([
        [run.status, 0],
        [
          run.stdout,
          [
            'MVP 0/2 · 0.0 stories/day · ETA unknown · queue Δ 0.',
            'Epikloop project 000000000000 (web, solo).',
            'Stage 6 of 10: epic 1 has 2 MVP stories left, and Q-001 blocks 1.2. Next: /epikloop:decide, then /epikloop:epic 1.',
            'Needs the human: 1 question waits in docs/queue.md.',
            'Waiting questions:',
            '- Q-001 Question (2026-11-01), blocks 1.2',
            'Unreadable lines:',
            '- docs/stories/2-more.md:3: 2.1 has no Tier',
            '- docs/stories/2-more.md:3: 2.1 has no MVP',
            '- docs/stories/2-more.md:3: 2.1 has no Requirements',
            '',
          ].join('\n'),
        ],
      ])
    },
  ],
  [
    'every lane reads cleanly, and a malformed one is refused',
    (k) => {
      const names = laneNames()
      const problems = names.map((name) => [name, laneProblem(readLane(name), name)]).filter(([, problem]) => problem !== null)
      const good = { format: 1, name: 'x', description: 'a kind of product', requires: ['npx'], ui_test: { tool: 'T', package: 'p', allow: ['npx t run'] }, sections: { Plan: 'p' } }
      const bad = [
        [{ ...good, name: 'y' }, 'is named "y", not x'],
        [{ ...good, ui_test: { ...good.ui_test, allow: ['npx t run; curl x'] } }, 'has a ui_test without its tool, its package and plain allow entries'],
        [{ ...good, requires: ['NPX'] }, "has requires that aren't program names"],
        [{ ...good, sections: { Deploy: 'd' } }, 'has ## Deploy in its fragment, which no brief prints'],
        [{ ...good, perf: {} }, 'has perf, which no lane field is'],
      ]
      return [
        ...problems.map(([name, problem]) => `lanes/${name}.json ${problem}`),
        ...k.expect([
          [names.join(' '), 'service web'],
          [Object.keys(readLane('web').sections).join(' '), 'Plan Story Retro'],
          [Object.keys(readLane('service').sections).join(' '), 'Plan Story'],
          [laneProblem(good, 'x'), null],
          ...bad.map(([lane, wanted]) => [laneProblem(lane, 'x'), wanted]),
          // A name that climbs out of lanes/ to a JSON file that exists is still no lane.
          [readLane('../schemas/examples/project'), null],
        ]),
      ]
    },
  ],
  [
    "--lanes lists the lanes, --lane prints the project's lane, and an unknown lane is a problem",
    (k) => {
      const outside = k.folder()
      const web = k.repo(planned({ 1: [[1, 'T1', true]] }))
      const service = k.repo(planned({ 1: [[1, 'T1', true]] }), { marker: { lane: 'service' } })
      const unknown = k.repo(planned({ 1: [[1, 'T1', true]] }), { marker: { lane: 'desktop' } })
      return [
        ...k.expect([
          [k.run(outside, '--lanes'), '0 - service: an API, a command-line tool or a job\n- web: a product people use in a browser\n'],
          [k.run(web, '--lane', 'plan'), `0 ${readLane('web').sections.Plan}\n`],
          [k.run(service, '--lane', 'retro'), '0 The service lane adds nothing here.\n'],
          [k.run(unknown, '--lane', 'story'), '1 Lane "desktop" is not one of service, web.\n'],
          [k.run(web, '--lane', 'deploy'), `1 ${USAGE}\n`],
        ]),
        ...k.contains(k.read(unknown).problems, ['.epikloop/project.json:1: lane "desktop" is not one of service, web']),
        ...k.read(web, { lane: 'web' }).problems.map((problem) => `problem ${problem}`),
      ]
    },
  ],
  [
    'a next step only the human starts says so, read from its skill',
    (k) => {
      const ceremony = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(ceremony, 'feat(1.1): one', 0)
      const batch = k.repo(planned({ 1: [[1, 'T1', true]] }), { freeze: true })
      const stageLine = (dir) => k.cli(dir).stdout.split('\n').find((line) => line.startsWith('Stage '))
      const userOnly = fs.readdirSync(SKILLS).filter((name) => humanStarts(`/epikloop:${name}`)).join(' ')
      return k.expect([
        [stageLine(ceremony), "Stage 7 of 10: epic 1's MVP stories are done, and it has no phase-1 tag. Next: /epikloop:retro, which only the human starts."],
        [stageLine(batch), 'Stage 6 of 10: epic 1 has 1 MVP story left. Next: /epikloop:epic 1.'],
        [userOnly, 'harbor release retro triage'],
      ])
    },
  ],
  [
    'the CLI prints each example, and says so outside a project',
    (k) => {
      const dir = k.folder()
      const pairs = Object.entries(EXAMPLES).map(([name, file]) => [k.cli(dir, ['--example', name]).stdout, k.template(file)])
      const usage = k.cli(dir, ['--example', 'nope'])
      return k.expect([...pairs, [k.cli(dir).stdout, 'Not an Epikloop project.\n'], [`${usage.status} ${usage.stdout}`, `1 ${USAGE}\n`]])
    },
  ],
]

async function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-state-'))
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Self Test\n\temail = self-test@example.com\n[init]\n\tdefaultBranch = main\n')
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:GIT_.*|HOME|USERPROFILE)$/i.test(key)) env[key] = value
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_CEILING_DIRECTORIES: temp })
  // readState runs git in this process, so the scrubbed environment applies here too.
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
  Object.assign(process.env, env)
  let made = 0
  let home = null
  const k = {
    template: (rel) => fs.readFileSync(path.join(TEMPLATES, ...rel.split('/')), 'utf8'),
    write(dir, file, content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), content)
    },
    folder(files = {}) {
      made += 1
      const dir = path.join(temp, `case-${made}`)
      fs.mkdirSync(dir)
      home = path.join(temp, `home-${made}`)
      fs.mkdirSync(home)
      for (const [file, content] of Object.entries(files)) k.write(dir, file, content)
      return dir
    },
    git(dir, ...args) {
      const run = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8', windowsHide: true })
      if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${(run.stderr || run.error?.message || '').trim()}`)
      return run.stdout
    },
    // Commits everything, dated `daysAgo` days before NOW.
    commit(dir, subject, daysAgo) {
      const date = new Date(NOW - daysAgo * DAY).toISOString()
      k.git(dir, 'add', '-A')
      const run = spawnSync('git', ['commit', '-q', '--allow-empty', '--no-verify', '-m', subject], {
        cwd: dir,
        env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        encoding: 'utf8',
        windowsHide: true,
      })
      if (run.status !== 0) throw new Error(`commit ${subject}: ${run.stderr.trim()}`)
    },
    // A repository holding `files`. With `freeze`, the first commit freezes the MVP set
    // `frozenAgo` days before NOW, so that commit is the queue's base.
    repo(files, { freeze = false, frozenAgo = 0, marker = {} } = {}) {
      const dir = k.folder(files)
      k.git(dir, 'init', '-q')
      k.project = { ...MARKER, ...marker }
      if (freeze) k.project.mvp_frozen = ymd(NOW - frozenAgo * DAY)
      k.write(dir, '.epikloop/project.json', `${JSON.stringify(k.project)}\n`)
      k.commit(dir, 'plan', frozenAgo)
      return dir
    },
    // A bare repository as `origin`, holding main.
    remote(dir) {
      made += 1
      const bare = path.join(temp, `remote-${made}`)
      k.git(temp, 'init', '-q', '--bare', bare)
      k.git(dir, 'remote', 'add', 'origin', bare)
      k.git(dir, 'push', '-q', 'origin', 'main')
    },
    costs(files) {
      const dir = path.join(home, '.epikloop', 'projects', MARKER.id)
      for (const [file, rows] of Object.entries(files)) {
        k.write(dir, file, rows.map(([tier, wall, effort = 'medium', cost = null]) => JSON.stringify({ format: 1, story: '9.9', tier, wall, cost, model: null, effort })).join('\n') + '\n')
      }
    },
    read: (dir, fields = {}) => readState(dir, { ...(k.project ?? MARKER), ...fields }, { now: NOW, home }),
    // The CLI, run as a skill runs it, from `cwd`, with this case's home.
    cli: (cwd, args = []) =>
      spawnSync(process.execPath, [import.meta.filename, ...args], { cwd, env: { ...env, HOME: home, USERPROFILE: home }, encoding: 'utf8', windowsHide: true }),
    // The CLI's exit code and output for --ready, or for another batch flag.
    run(dir, ...args) {
      const run = k.cli(dir, args)
      return `${run.status} ${run.stdout}`
    },
    ready: (dir, select) => k.run(dir, '--ready', ...(select === undefined ? [] : [select])),
    expect: (pairs) => pairs.filter(([actual, wanted]) => actual !== wanted).map(([actual, wanted]) => `got ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`),
    has: (actual, ...parts) => parts.filter((part) => !actual.includes(part)).map((part) => `no ${JSON.stringify(part)} in ${JSON.stringify(actual)}`),
    contains: (problems, wanted) => {
      const missing = wanted.filter((text) => !problems.some((problem) => problem.startsWith(text)))
      return missing.map((text) => `no problem "${text}" among: ${problems.join(' | ')}`)
    },
    stage(dir, wanted) {
      const s = k.read(dir, { mvp_frozen: k.project.mvp_frozen ?? '2026-11-01' })
      return [...k.expect([[`${s.stage.n} ${s.stage.why} → ${s.stage.next}`, wanted]]), ...s.problems.map((p) => `problem ${p}`)]
    },
    gauge(dir, wanted, fields = {}) {
      const s = k.read(dir, fields)
      return [...k.expect([[s.gauge, wanted]]), ...s.problems.map((p) => `problem ${p}`)]
    },
  }
  const failures = []
  try {
    for (const [name, check] of CASES) {
      k.project = null
      let problems
      try {
        problems = check(k)
      } catch (error) {
        problems = [`threw ${error.message}`]
      }
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
    }
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
    fs.rmSync(temp, { recursive: true, force: true })
  }
  for (const line of failures) console.log(`FAIL ${line}`)
  console.log(`state self-test: ${CASES.length - failures.length}/${CASES.length} as expected`)
  process.exitCode = failures.length > 0 ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  if (process.argv[2] === '--self-test') await selfTest()
  else cli(process.argv.slice(2))
}
