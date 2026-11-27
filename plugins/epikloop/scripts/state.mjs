// Epikloop's reader of a project's state. It parses the four project files in their formats
// (docs/formats.md) and reads git, then derives what the stage machine and the fuel gauge need:
// which stories are done, the current phase, the stage and its next step, and the gauge. Nothing
// of that is stored; every read derives it again. What is kept on the machine is home.mjs's: a
// retro's call collects the notes for Epikloop, and `--compare` saves the list of pictures it
// sorted. A batch's and a retro's calls also fold the emitter's files first. The briefing imports
// it, and skills run it:
//
//   node state.mjs                                          the state of the project here
//   node state.mjs --ready [N | N.M]                        the stories a batch may start and their workers' effort, or why none
//   node state.mjs --story N.M                              a story-worker's brief
//   node state.mjs --reviews                                the landed stories no reviewer has read and the reviewer's effort, or why none
//   node state.mjs --review N.M                             a story-reviewer's brief
//   node state.mjs --ids                                    the next question, decision and epic numbers
//   node state.mjs --retro                                  the retro's brief, or the tags it leaves
//   node state.mjs --compare                                the pictures a retro's visual compare reads, and its line for the record
//   node state.mjs --release                                the release's brief, or the tag it leaves
//   node state.mjs --design                                 where the design stands, which model draws, and what an audit reads
//   node state.mjs --lane plan|story|retro                  that section of the project's lane
//   node state.mjs --lanes                                  the lanes, with what each is for
//   node state.mjs --example spec|stories|queue|decisions|manifest   a project file's example, its format
//   node state.mjs --self-test                              every case below, in throwaway repos
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { foldAll } from './fold.mjs'
import { collectNotes, compareLines, countsLine, eventCounts, listCode, readList, saveList, sortPictures } from './home.mjs'

const DAY = 86_400_000
const REQ_ID = 'REQ-[A-Z0-9]{2,12}-\\d{3,}'
const REQ = new RegExp(`^${REQ_ID}$`)
const STORY = /^\d+\.\d+$/
const DATE = '\\d{4}-\\d{2}-\\d{2}'
// The velocity window, in days.
const WINDOW = 14
// This many waiting questions send the batch to decide first.
const MANY_QUESTIONS = 5
// The file at the root of a repository on an earlier template layout, in every version of it.
export const EARLIER = 'PIPELINE_VERSION'

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
// and a `### Spec delta`. A rework story names the story it reworks in a last field, Reworks.
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
      const { Tier: tier, MVP: mvp, Requirements: cited, After: after, Reworks: reworks } = story.fields
      // Reworks goes last: Harbor's build stops reading a story's fields at the first it doesn't know.
      if (reworks !== undefined && Object.keys(story.fields).at(-1) !== 'Reworks') problems.push(`${rel}:${story.line}: ${story.id}'s Reworks is not its last field`)
      if (reworks !== undefined && (!STORY.test(reworks) || reworks === story.id)) problems.push(`${rel}:${story.line}: ${story.id}'s Reworks is not another story's ID`)
      story.reworks = reworks !== undefined && STORY.test(reworks) && reworks !== story.id ? reworks : null
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
          i = readFields(lines, i + 1, ['Tier', 'MVP', 'Requirements', 'After', 'Reworks'], story.fields, (at, what) =>
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
    if (story.reworks !== null && !stories.has(story.reworks)) problems.push(`${story.file}:${story.line}: ${story.id} reworks ${story.reworks}, which is not a story`)
  }
  return stories
}

// docs/queue.md: `## Questions`, each `### Q-NNN Title (date)` with Blocks and Default taken, and
// `## Backlog`, one dated line each. A question that can't wait carries a last field,
// `Severity: high`, and one titled `Review N.M` holds that story's review. With `problems` null it
// only counts, for an earlier version.
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
      i = readFields(lines, i + 1, ['Blocks', 'Default taken', 'Severity'], fields, (at, what) => report(at, `${heading[1]} ${what}`)) - 1
      for (const field of ['Blocks', 'Default taken']) {
        if (fields[field] === undefined) report(i + 1, `${heading[1]} has no ${field}`)
      }
      // Severity goes last: Harbor's build stops reading a question's fields at the first it doesn't know.
      if (fields.Severity !== undefined && fields.Severity !== 'high') report(i + 1, `${heading[1]}'s Severity is not high`)
      if (fields.Severity !== undefined && Object.keys(fields).at(-1) !== 'Severity') report(i + 1, `${heading[1]}'s Severity is not its last field`)
      const blocks = fields.Blocks === undefined || fields.Blocks === 'nothing' ? [] : list(fields.Blocks)
      for (const id of blocks) {
        if (!STORY.test(id) || (stories !== null && !stories.has(id))) report(i + 1, `${heading[1]} blocks ${id}, which is not a story`)
      }
      const review = /^Review (\d+\.\d+)$/.exec(heading[2])?.[1] ?? null
      questions.push({ id: heading[1], title: heading[2], date: heading[3], blocks, line: at, severity: fields.Severity === 'high' ? 'high' : null, review })
    } else if (section === 'backlog' && line.startsWith('- ')) {
      if (new RegExp(`^- ${DATE} \\S`).test(line)) backlog += 1
      else report(i + 1, 'a backlog line does not start with its date, "- YYYY-MM-DD"')
    }
  }
  return { questions, backlog }
}

// A record's notes about Epikloop itself: its lines `- Epikloop: <text>`, any number of them and
// wherever they stand in its entry, so a note that follows a line the reader doesn't know, or sits
// under another line, is still read.
const notesIn = (entry) => [...entry.matchAll(/^[ \t]*- Epikloop:[ \t]*(\S.*)$/gm)].map(([, note]) => note.trim())

// docs/decisions.md: `## DECISION-NNN Title (date)`, each with its fields, and the notes for
// Epikloop its entry carries.
function readDecisions(root, problems) {
  const rel = 'docs/decisions.md'
  const lines = readLines(root, rel) ?? []
  const decisions = []
  const required = ['Context', 'Decision', 'Rejected', 'Trade-offs', 'Implementation note']
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('## ')) continue
    const heading = new RegExp(`^## (DECISION-\\d{3,}) (\\S.*) \\((${DATE})\\)$`).exec(lines[i].trim())
    if (heading === null) {
      problems.push(`${rel}:${i + 1}: "${lines[i]}" is not "## DECISION-NNN Title (YYYY-MM-DD)"`)
      continue
    }
    const [, id, title, date] = heading
    if (decisions.some((d) => d.id === id)) problems.push(`${rel}:${i + 1}: ${id} appears twice`)
    // A record's fields are read wherever they stand in its entry, so a line the format doesn't
    // name, or lines set under a field, hide none of the fields after them.
    const fields = {}
    for (let n = i + 1; n < lines.length && !/^##? /.test(lines[n]); n += 1) {
      const field = /^- ([A-Z][A-Za-z -]*): (.*)$/.exec(lines[n])
      if (field === null || !['Answers', ...required].includes(field[1])) continue
      if (field[1] in fields) problems.push(`${rel}:${n + 1}: ${id} has a second ${field[1]}`)
      fields[field[1]] = field[2].trim()
    }
    for (const field of required) if (fields[field] === undefined) problems.push(`${rel}:${i + 1}: ${id} has no ${field}`)
    const answers = fields.Answers !== undefined && /^Q-\d{3,}$/.test(fields.Answers) ? fields.Answers : null
    if (fields.Answers !== undefined && answers === null) problems.push(`${rel}:${i + 1}: ${id}'s Answers is not a Q-NNN`)
    const text = sectionAt(lines, i)
    decisions.push({ id, title, date, answers, notes: notesIn(text), text })
  }
  return decisions
}

// The notes for Epikloop that the records carry, oldest first, as home.mjs collects them.
const notesOf = (state) => state.decisions.flatMap((d) => d.notes.map((text) => ({ date: d.date, id: d.id, title: d.title, text })))

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
  const fields = ['$schema', 'format', 'name', 'description', 'requires', 'ui_test', 'design', 'sections']
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
  // A lane with screens gives the two widths they are drawn at; one that skips design gives null.
  const { design } = lane
  const widths = design?.widths
  const drawn =
    typeof design === 'object' && design !== null && Object.keys(design).every((key) => key === 'widths' || key === 'renders') && Array.isArray(widths) && widths.length === 2 && widths.every((w) => Number.isInteger(w) && w > 0) && widths[0] < widths[1]
  if (design !== null && !drawn) return 'has a design without its two widths, narrow first'
  // Where its screens spec writes its pictures: a folder inside the project, which the lane's own
  // text names too, since a worker writes there and the compare reads there.
  const renders = design?.renders
  if (renders !== undefined && !(typeof renders === 'string' && /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(renders))) return 'has a design whose renders is not a folder inside the project'
  if (renders !== undefined && !Object.values(lane.sections).some((text) => text.includes(`\`${renders}/`))) return `has a design whose renders, ${renders}, its fragment doesn't name`
  const extra = Object.keys(lane.sections).filter((name) => !LANE_SECTIONS.includes(name))
  if (extra.length > 0) return `has ${extra.map((name) => `## ${name}`).join(', ')} in its fragment, which no brief prints`
  return null
}

// ---- The design: design/ in a lane with screens (docs/formats.md)

// A screen's states: its default, and any of the other three.
const STATES = ['default', 'empty', 'loading', 'error']
// The file a screen's state is drawn in.
export const stateFile = (screen, state) => `design/screens/${screen}${state === 'default' ? '' : `.${state}`}.html`
const reqTitle = (r) => r.text.split('\n')[0].slice(`## ${r.id} `.length).trim()

// design/manifest.md: each screen a `## <screen> Title`, followed at once by its States and
// Requirements. Only the screens that read cleanly are listed; null without a manifest.
function readManifest(root, problems) {
  const rel = 'design/manifest.md'
  const lines = readLines(root, rel)
  if (lines === null) return null
  const screens = []
  const seen = new Map()
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('## ')) continue
    const heading = /^## ([a-z0-9][a-z0-9-]*) (\S.*)$/.exec(lines[i].trim())
    if (heading === null) {
      problems.push(`${rel}:${i + 1}: "${lines[i]}" is not "## screen Title"`)
      continue
    }
    const [, id, title] = heading
    const line = i + 1
    const before = problems.length
    if (seen.has(id)) problems.push(`${rel}:${line}: ${id} is already at line ${seen.get(id)}`)
    else seen.set(id, line)
    const fields = {}
    readFields(lines, i + 1, ['States', 'Requirements'], fields, (at, what) => problems.push(`${rel}:${at}: ${id} ${what}`))
    for (const field of ['States', 'Requirements']) if (fields[field] === undefined) problems.push(`${rel}:${line}: ${id} has no ${field}`)
    const states = fields.States === undefined ? [] : list(fields.States)
    if (fields.States !== undefined && (!states.includes('default') || states.some((state) => !STATES.includes(state)) || new Set(states).size !== states.length)) {
      problems.push(`${rel}:${line}: ${id}'s States are not default and any of empty, loading and error`)
    }
    const requirements = fields.Requirements === undefined || fields.Requirements === 'none' ? [] : list(fields.Requirements)
    if (requirements.some((req) => !REQ.test(req))) problems.push(`${rel}:${line}: ${id}'s Requirements are not REQ IDs or none`)
    if (problems.length === before) screens.push({ id, title, line, states: STATES.filter((state) => states.includes(state)), requirements, text: sectionAt(lines, i) })
  }
  return screens
}

// The design of a project whose lane has screens, or null for a lane that skips design: what
// design/ holds and what an audit reads. It has started once it has a brief, a direction or a
// manifest, and it is complete once it has its tokens, a screen, and a file for every state the
// manifest lists.
function readDesign(root, lane, requirements, decisions, problems) {
  if (!Array.isArray(lane?.design?.widths)) return null
  const at = (rel) => path.join(root, ...rel.split('/'))
  const names = (rel, keep) => {
    try {
      return fs
        .readdirSync(at(rel), { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && keep(entry.name))
        .map((entry) => entry.name)
        .sort()
    } catch {
      return []
    }
  }
  const html = (name) => name.toLowerCase().endsWith('.html')
  const screens = readManifest(root, problems)
  const listed = (screens ?? []).flatMap((screen) => screen.states.map((state) => stateFile(screen.id, state)))
  const cited = [...new Set((screens ?? []).flatMap((screen) => screen.requirements))]
  const design = {
    widths: lane.design.widths,
    brief: fs.existsSync(at('design/brief.md')),
    refs: names('design/refs', () => true),
    directions: names('design/directions', html),
    // A later pick replaces an earlier one.
    pick: decisions.filter((d) => d.title === 'Design direction').at(-1),
    tokens: fs.existsSync(at('design/tokens.css')),
    screens,
    missing: listed.filter((file) => !fs.existsSync(at(file))),
    unlisted: names('design/screens', html).filter((name) => !listed.includes(`design/screens/${name}`)),
    uncited: [...requirements.values()].filter((r) => r.status !== 'retired' && !cited.includes(r.id)),
    strays: cited.filter((id) => (requirements.get(id)?.status ?? 'retired') === 'retired'),
  }
  design.started = design.brief || design.directions.length > 0 || screens !== null
  design.complete = design.tokens && screens !== null && screens.length > 0 && design.missing.length === 0
  const outside = outsideLoads(root)
  if (outside.length > 0) {
    const [first] = outside
    const more = outside.length - 1
    const also = more === 0 ? '' : `, and so ${more === 1 ? 'does 1 more design file' : `do ${more} more design files`}`
    problems.push(`${first.file}:${first.line}: loads ${urlShown(first.url)} from outside design/${also}; the screens spec renders design files offline, so what they load belongs in design/`)
  }
  return design
}

// The loads a design file can make from outside design/: a script, image or frame source, a link,
// a CSS url() or @import, a JS import, and a quoted URL to a script, style or font. A namespace or a
// hyperlink loads nothing.
const LOADS = [
  /<(?:script|img|source|iframe|video|audio|embed)\b[^>]*?\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi,
  /<link\b[^>]*?\bhref\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi,
  /url\(\s*["']?(https?:\/\/[^"')\s]+)/gi,
  /@import\s+["'](https?:\/\/[^"']+)/gi,
  /\b(?:import|from)\s*\(?\s*["'](https?:\/\/[^"']+)/g,
  /["'](https?:\/\/[^"'\s]+?\.(?:m?js|css|woff2?|ttf|otf)(?:\?[^"'\s]*)?)["']/gi,
]

// What the files the screens spec renders load from outside design/: the tokens and everything
// under design/screens/, each file's first such load as { file, line, url }.
function outsideLoads(root) {
  const found = []
  const scan = (rel) => {
    let text
    try {
      text = fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8')
    } catch {
      return
    }
    let first = null
    for (const pattern of LOADS) for (const match of text.matchAll(pattern)) if (first === null || match.index < first.index) first = match
    if (first !== null) found.push({ file: rel, line: text.slice(0, first.index).split('\n').length, url: first[1] })
  }
  const walk = (rel) => {
    let entries
    try {
      entries = fs.readdirSync(path.join(root, ...rel.split('/')), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`)
      else if (/\.(?:html?|css|m?js)$/i.test(entry.name)) scan(`${rel}/${entry.name}`)
    }
  }
  scan('design/tokens.css')
  walk('design/screens')
  return found
}

// A URL as a problem names it: its origin and path.
function urlShown(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

// A design adopt brought in with the product: its tokens, and no directions or pick.
export const cameWith = (d) => d.tokens && d.directions.length === 0 && d.pick === undefined

// What a design that isn't complete waits for; before it has started, the manifest it lacks.
function designWhy(d) {
  if (!d.started) return 'design/manifest.md is missing'
  if (d.screens === null) {
    if (d.pick !== undefined) return `the direction is picked, and design/${d.tokens ? 'manifest.md' : 'tokens.css'} is missing`
    const drawn = d.directions.length
    if (drawn > 0) return `${plural(drawn, 'direction')} in design/directions/ ${drawn === 1 ? 'waits' : 'wait'} for the human's pick`
    if (d.tokens) return 'design/tokens.css came with the product, and design/manifest.md is missing'
    return 'design/brief.md is written, and no direction is drawn yet'
  }
  if (d.screens.length === 0) return 'design/manifest.md lists no screens'
  if (d.missing.length > 0) return `${plural(d.missing.length, 'state')} in design/manifest.md ${d.missing.length === 1 ? 'has' : 'have'} no file yet`
  return 'design/tokens.css is missing'
}

// Runs one git command at the root without a shell: its output, or null when git fails. The staging
// smoke reads HEAD through it too.
export function gitReader(root) {
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

// The feat commits stories land as, asked of git, so a log stays small however long the history:
// Node keeps 1 MB of a child's output, about 15,000 subjects. The patterns are basic regexps
// whatever the repository's grep.patternType says, and each subject's own match still decides,
// since --grep matches any line of a message.
const FEAT_LOG = ['--basic-regexp', '--grep=^feat([0-9][0-9]*\\.[0-9][0-9]*):']

// When each story was done: the first commit on the default branch whose subject starts feat(N.M):.
function doneTimes(git, branch) {
  const done = new Map()
  const log = branch === null ? null : git(['log', ...FEAT_LOG, '--format=%ct%x09%s', branch])
  for (const line of (log ?? '').split('\n')) {
    const [time, subject = ''] = line.split('\t')
    const feat = /^feat\((\d+\.\d+)\):/.exec(subject)
    if (feat !== null) done.set(feat[1], Number(time) * 1000)
  }
  return done
}

// The stories landed after the live tag: those whose feat commit on the default branch the tag
// doesn't reach. Empty without the tag.
function landedAfterLive(git, branch, tags) {
  const after = new Set()
  if (branch === null || !tags.has('live')) return after
  for (const subject of (git(['log', ...FEAT_LOG, '--format=%s', `refs/tags/live..${branch}`]) ?? '').split('\n')) {
    const feat = /^feat\((\d+\.\d+)\):/.exec(subject)
    if (feat !== null) after.add(feat[1])
  }
  return after
}

// The feat, review and fix commits that name a story, asked of git as the feat commits are.
const STORY_LOG = ['--basic-regexp', ...['feat', 'review', 'fix'].map((kind) => `--grep=^${kind}([0-9][0-9]*\\.[0-9][0-9]*):`)]

// What landed since the last retro: for each story, its feat and fix commits, oldest first, and
// what its review commit says, among the commits the default branch reaches and no phase-N or live
// tag does. `unread` is set when git couldn't say.
function readScope(git, branch, tags, done) {
  const scope = { commits: new Map(), reviews: new Map(), fixes: 0, unread: false }
  // With no story landed there is nothing to ask git, as in a repository with no commit yet.
  if (branch === null || done.size === 0) return scope
  const closed = [...tags].filter((tag) => tag === 'live' || /^phase-\d+$/.test(tag)).map((tag) => `refs/tags/${tag}`)
  const log = git(['log', ...STORY_LOG, '--format=%h%x09%s', branch, ...(closed.length > 0 ? ['--not', ...closed] : [])])
  if (log === null) return { ...scope, unread: true }
  for (const line of log.split('\n').reverse()) {
    const [sha, subject = ''] = line.split('\t')
    const named = /^(feat|review|fix)\((\d+\.\d+)\):(.*)$/.exec(subject)
    if (named === null) continue
    const [, kind, id, said] = named
    if (kind === 'review') scope.reviews.set(id, said.trim())
    else scope.commits.set(id, [...(scope.commits.get(id) ?? []), { sha, subject, feat: kind === 'feat' }])
    if (kind === 'fix') scope.fixes += 1
  }
  return scope
}

// Whether a story's feat commit landed since the last retro.
const inScope = (scope, id) => scope.commits.get(id)?.some((commit) => commit.feat) === true

// The cost rows the emitter wrote for this project on this machine, folded or not, as one row per
// run. A story-worker writes a row at each of its turns' ends, naming itself as `agent`, and those
// add up to its run; a row that names no agent is a run of its own. A story-reviewer's rows carry
// `review`, and add up the same way.
function costRows(home, id) {
  const dir = path.join(home, '.epikloop', 'projects', id)
  const rows = []
  const runs = new Map()
  // A fold that died between its append and its delete leaves a row twice, in the file and in
  // the folder. A row carries its time to the millisecond, so the same line is the same row.
  const seen = new Set()
  const add = (text) => {
    for (const line of text.split('\n')) {
      try {
        const row = JSON.parse(line)
        if (!(/^T[123]$/.test(row.tier) && Number.isFinite(row.wall) && row.wall > 0)) continue
        if (typeof row.ts === 'string') {
          if (seen.has(line.trim())) continue
          seen.add(line.trim())
        }
        const run = runs.get(row.agent)
        if (run === undefined) {
          rows.push(row)
          if (row.agent !== undefined) runs.set(row.agent, row)
        } else {
          run.wall += row.wall
          run.cost = Number.isFinite(run.cost) && Number.isFinite(row.cost) ? run.cost + row.cost : null
        }
      } catch {}
    }
  }
  // The folder is read before the file, so another session's fold at work in between hides no
  // row, and each of its files on its own, so one that a fold has just taken costs only itself.
  // The file's rows are still taken first, being the older ones.
  const unfolded = []
  let names = []
  try {
    names = fs.readdirSync(path.join(dir, 'cost')).sort()
  } catch {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      unfolded.push(fs.readFileSync(path.join(dir, 'cost', name), 'utf8'))
    } catch {}
  }
  try {
    add(fs.readFileSync(path.join(dir, 'cost.jsonl'), 'utf8'))
  } catch {}
  for (const text of unfolded) add(text)
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
  // A review isn't a story's build, so its rows are no part of what a story left to build takes.
  const rows = costRows(home, project.id).filter((row) => row.review !== true)
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

// The landed stories no reviewer has read, in plan order: the stories in docs/stories/ whose feat
// commit landed since the last retro, with no review(N.M) commit there. None in team mode, where a
// story's pull request is its review. With `facts`, as a batch's list reads it, a review committed
// here and not pushed yet counts too.
function reviewsWaiting(s, project, facts = null) {
  if (project.mode !== 'solo') return []
  return planOrder(s.stories).filter((story) => story.tier !== null && inScope(s.scope, story.id) && !s.scope.reviews.has(story.id) && !facts?.reviewed.has(story.id))
}

// A few IDs as prose, and the rest counted.
const some = (ids, shown = 3) => (ids.length <= shown ? prose(ids) : `${ids.slice(0, shown).join(', ')} and ${ids.length - shown} more`)
// Stories that wait for a review, as a clause: "1.2 waits for its review".
const awaitReview = (ids) => `${some(ids)} ${ids.length === 1 ? 'waits for its review' : 'wait for their reviews'}`

// What a closing ceremony waits for in solo mode: the landed stories no reviewer has read, and then
// the reviews whose questions are still open. Null when nothing holds it.
function reviewHold(s, project) {
  const waiting = reviewsWaiting(s, project).map((story) => story.id)
  if (waiting.length > 0) {
    return { why: awaitReview(waiting), next: `/epikloop:epic ${waiting[0].split('.')[0]}` }
  }
  const open = project.mode === 'solo' ? s.questions.filter((q) => q.review !== null && inScope(s.scope, q.review)).map((q) => q.id) : []
  if (open.length === 0) return null
  return { why: `${some(open)} ${open.length === 1 ? 'holds a review that is' : 'hold reviews that are'} open`, next: '/epikloop:decide' }
}

// A closing ceremony's stage, held while a review waits or is open: a phase closes only once its
// reviews are settled.
function ceremony(stage, s, project) {
  const hold = reviewHold(s, project)
  return hold === null ? stage : { ...stage, held: true, why: `${stage.why}, and ${hold.why}`, next: hold.next }
}

// A question marked high comes before whatever is next, from the batch on.
function highFirst(stage, questions) {
  const high = questions.filter((q) => q.severity === 'high')
  if (stage.n < 6 || high.length === 0 || stage.next.startsWith('/epikloop:decide')) return stage
  const more = high.length > 1 ? ` and ${plural(high.length - 1, 'more question')}` : ''
  return { ...stage, why: `${stage.why}, and ${high[0].id}${more} ${high.length > 1 ? 'are' : 'is'} marked high`, next: `/epikloop:decide, then ${stage.next}` }
}

// Post-MVP mode: the backlog is visible, and planned work runs epic by epic. Each epic that lands
// after the live tag is a phase too, closed by its retro before the next.
function liveStage(s, project) {
  const epics = [...new Set(planOrder(s.stories).map((story) => story.epic))]
  const closing = epics.find((epic) => {
    const stories = [...s.stories.values()].filter((story) => story.epic === epic)
    return !s.tags.has(`phase-${epic}`) && stories.every((story) => s.done.has(story.id)) && stories.some((story) => s.afterLive.has(story.id))
  })
  if (closing !== undefined) {
    const why = recorded(s, `Phase ${closing} retro`)
      ? `the product is live; epic ${closing}'s retro is recorded, and phase-${closing} isn't tagged yet`
      : `the product is live, and epic ${closing}'s stories are done with no phase-${closing} tag`
    return ceremony({ n: 10, epic: closing, retro: true, why, next: '/epikloop:retro' }, s, project)
  }
  const work = planOrder(s.stories).find((story) => !s.done.has(story.id))
  const why = `the product is live${s.backlog > 0 ? `, and docs/queue.md holds ${plural(s.backlog, 'backlog line')}` : ''}`
  return { n: 10, epic: work?.epic, why, next: work === undefined ? '/epikloop:plan --extend' : `/epikloop:epic ${work.epic}` }
}

// The first stage whose test fails: { n, epic, why, next }. `delta` is queue Δ, or null.
function stageOf(root, project, s, delta) {
  const has = (...parts) => fs.existsSync(path.join(root, ...parts))
  const current = [...s.requirements.values()].filter((r) => r.status !== 'retired')
  if (current.length === 0) {
    return { n: 2, why: 'spec/ holds no requirements yet', next: '/epikloop:discover for a new product, or /epikloop:adopt for existing code' }
  }
  const observed = current.filter((r) => r.status === 'observed').length
  if (observed > 0) return { n: 2, why: `${plural(observed, 'requirement')} in spec/ ${observed === 1 ? 'is' : 'are'} still observed`, next: '/epikloop:adopt' }
  // Stage 3: in a lane with screens, the design comes before the plan, and a design once started is
  // finished before anything else. A project planned without one stays where it is.
  const { design } = s
  if (design !== null && (design.started ? !design.complete : s.stories.size === 0)) return { n: 3, why: designWhy(design), next: '/epikloop:design' }
  if (!has('spec', 'architecture.md')) return { n: 4, why: 'spec/architecture.md is missing', next: '/epikloop:architect' }
  const mvp = [...s.stories.values()].filter((story) => story.mvp)
  // A product adopted while already in production is tagged live, and goes on without an MVP set.
  if (s.tags.has('live') && mvp.length === 0) return liveStage(s, project)
  if (s.stories.size === 0) return { n: 5, why: 'docs/stories/ holds no stories yet', next: '/epikloop:plan' }
  if (!project.mvp_frozen) return { n: 5, why: "the MVP set isn't frozen", next: '/epikloop:plan' }
  if (mvp.length === 0) return { n: 5, why: 'no story is in the MVP set', next: '/epikloop:plan' }
  // Stage 6 for `epic`, whose stories `left` are still to build: decide comes first while a question
  // blocks one of them, or five or more wait.
  const building = (epic, left, why) => {
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
  // An MVP story a decision added to a phase already closed is built before anything else closes:
  // no later test here would name it. Once the product is live, the planned work names it.
  const reopened = s.tags.has('live') ? undefined : planOrder(s.stories).find((story) => story.mvp && s.tags.has(`phase-${story.epic}`) && !s.done.has(story.id))
  if (reopened !== undefined) {
    const left = mvp.filter((story) => story.epic === reopened.epic && !s.done.has(story.id))
    const added = planOrder(new Map(left.map((story) => [story.id, story]))).map((story) => story.id)
    return building(reopened.epic, left, `epic ${reopened.epic} is closed, and ${some(added)} ${added.length === 1 ? 'was' : 'were'} added to it since`)
  }
  const epics = [...new Set(mvp.map((story) => story.epic))].sort((a, b) => a - b)
  const epic = epics.find((n) => !s.tags.has(`phase-${n}`))
  if (epic === undefined && !s.tags.has('mvp')) {
    const wait = queueWait(delta)
    if (recorded(s, 'MVP sign-off')) {
      const why = wait === null ? "the MVP sign-off is recorded, and mvp isn't tagged yet" : `the MVP sign-off is recorded, but ${wait}, so mvp isn't tagged`
      return ceremony({ n: 8, why, next: '/epikloop:retro' }, s, project)
    }
    return ceremony({ n: 8, why: `every MVP epic is tagged, and the MVP isn't signed off${wait === null ? '' : `; sign-off waits while ${wait}`}`, next: '/epikloop:retro' }, s, project)
  }
  if (epic === undefined && !s.tags.has('live')) {
    if (recorded(s, 'Go live')) return ceremony({ n: 9, why: "the go-live is recorded, and live isn't tagged yet", next: '/epikloop:release' }, s, project)
    // While a recorded decision puts going live off, the planned work runs first, epic by epic.
    const later = recorded(s, 'Go live later')
    if (later === undefined) return ceremony({ n: 9, why: 'the MVP is signed off, and nothing is live yet', next: '/epikloop:release' }, s, project)
    const work = planOrder(s.stories).find((story) => !s.done.has(story.id))
    if (work === undefined) return ceremony({ n: 9, why: `the MVP is signed off, going live waits, as ${later.id} records, and nothing planned is left`, next: '/epikloop:release' }, s, project)
    return { n: 9, epic: work.epic, why: `the MVP is signed off, and going live waits, as ${later.id} records`, next: `/epikloop:epic ${work.epic}` }
  }
  if (epic === undefined) return liveStage(s, project)
  const left = mvp.filter((story) => story.epic === epic && !s.done.has(story.id))
  if (left.length === 0) {
    const why = recorded(s, `Phase ${epic} retro`) ? `epic ${epic}'s retro is recorded, and phase-${epic} isn't tagged yet` : `epic ${epic}'s MVP stories are done, and it has no phase-${epic} tag`
    return ceremony({ n: 7, epic, why, next: '/epikloop:retro' }, s, project)
  }
  return building(epic, left, `epic ${epic} has ${plural(left.length, 'MVP story', 'MVP stories')} left`)
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

// Whether only the human starts the command `next` ends with, as in "decide, then retro": its
// skill's frontmatter keeps the model from invoking it.
function humanStarts(next) {
  const name = [...next.matchAll(/\/epikloop:([a-z-]+)/g)].at(-1)?.[1]
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
  const high = state.questions.filter((q) => q.severity === 'high').length
  const needs = waiting > 0 ? [`${waiting} ${waiting === 1 ? 'question waits' : 'questions wait'} in docs/queue.md${high > 0 ? `, ${high} marked high` : ''}`] : []
  // The landed stories no reviewer has read, which no question stands for any more. A closing
  // ceremony's stage names them itself.
  const unread = state.stage.held ? [] : reviewsWaiting(state, project).map((story) => story.id)
  if (unread.length > 0) needs.push(`${awaitReview(unread)}, which the next /epikloop:epic batch runs`)
  return { parts, needs }
}

// The project's state, derived from its files and git. `project` is its parsed marker.
export function readState(root, project, { now = Date.now(), home = os.homedir() } = {}) {
  const problems = []
  // Every version of an earlier template layout carries this file; adopt's conversion removes it.
  if (fs.existsSync(path.join(root, EARLIER))) problems.push(`${EARLIER}:1: an earlier template's version file; /epikloop:adopt's conversion removes it with that template's other files`)
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
  const design = readDesign(root, lane, requirements, decisions, problems)
  for (const q of questions) {
    const answer = decisions.find((d) => d.answers === q.id)
    if (answer !== undefined) problems.push(`docs/queue.md:${q.line}: ${q.id} is already answered by ${answer.id}`)
  }
  const git = gitReader(root)
  const { branch, tags } = refsOf(git)
  const done = doneTimes(git, branch)
  const afterLive = landedAfterLive(git, branch, tags)
  const scope = readScope(git, branch, tags, done)
  // A scope git couldn't give is said, and holds nothing: no project waits on a failed read.
  if (scope.unread) problems.push("git log: the commits since the last retro can't be read, so no review is listed")
  const s = { requirements, stories, questions, backlog, decisions, problems, done, afterLive, tags, design, scope }

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
  return { ...s, lane, stage: highFirst(stageOf(root, project, s, delta), questions), gauge, delta, base }
}

// ---- What a batch reads

const minor = (story) => Number(story.id.split('.')[1])
const planOrder = (stories) => [...stories.values()].sort((a, b) => a.epic - b.epic || minor(a) - minor(b))

// What a batch needs from git beyond the state, or null without a commit to start from: the
// default branch's name, the remote it lands on and how far apart the two are, whether the
// checkout is clean and on that branch, the stories in review, whose feat commit is on another
// branch and not yet on the default one, and the stories reviewed here whose review commit isn't
// pushed yet.
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
  for (const subject of (git(['log', ...FEAT_LOG, '--format=%s', '--branches', '--remotes', '--not', branch]) ?? '').split('\n')) {
    const feat = /^feat\((\d+\.\d+)\):/.exec(subject)
    if (feat !== null) review.add(feat[1])
  }
  // A batch pushes its reviews together, so until then their commits are only here. On a clone,
  // where the default branch is the remote's, the state doesn't read them yet.
  const reviewed = new Set()
  if (upstream !== null && ahead > 0) {
    for (const subject of (git(['log', ...STORY_LOG, '--format=%s', `refs/remotes/${upstream}..refs/heads/${name}`]) ?? '').split('\n')) {
      const named = /^review\((\d+\.\d+)\):/.exec(subject)
      if (named !== null) reviewed.add(named[1])
    }
  }
  return { name, current, remote, upstream, ahead, behind, clean: status !== null && status.trim() === '', review, reviewed }
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

// Why this checkout isn't the default branch level with its remote, naming the git command that
// fixes it when there is one, or null: on a side branch, diverged or behind. Commits the remote
// lacks are left to the caller. `what` says what starts. Setup checks this too.
export function branchProblem(facts, what) {
  if (facts.current === null || facts.current !== facts.name) {
    return `${what[0].toUpperCase()}${what.slice(1)} starts on ${facts.name}, and ${facts.current === null ? 'HEAD is detached' : `this checkout is on ${facts.current}`}.`
  }
  if (facts.ahead > 0 && facts.behind > 0) return `${facts.name} and ${facts.upstream} have diverged, and the human reconciles them before ${what} starts.`
  if (facts.behind > 0) return `${facts.name} is ${plural(facts.behind, 'commit')} behind ${facts.upstream}; \`git pull --ff-only ${facts.remote} ${facts.name}\` brings it up to date.`
  return null
}

// Why a batch or a ceremony can't start from this checkout, naming the git command that fixes it
// when there is one, or null. `what` says what starts: "a batch", "a retro" or "a release".
function startProblem(project, facts, what) {
  if (!facts.clean) return `The working tree has changes that aren't committed, and ${what} starts from a clean tree.`
  const branch = branchProblem(facts, what)
  if (branch !== null) return branch
  if (facts.ahead > 0) {
    const one = facts.ahead === 1
    const how = project.mode === 'team' ? `in team mode ${one ? 'it lands' : 'they land'} through a pull request` : `\`git push ${facts.remote} ${facts.name}\` lands ${one ? 'it' : 'them'}`
    return `${facts.name} has ${plural(facts.ahead, 'commit')} that ${facts.upstream} lacks; ${how} before ${what} starts.`
  }
  return null
}

// The stories a batch may start, as `N.M Tn Title` lines in plan order, the line a worker's spawn
// description starts with; the CLI adds the workers' effort as a last line (`workerLine`).
// `select` is an epic's number, or one story's ID, which may be outside
// the MVP set; without it, the current phase's epic, or every epic once all are tagged. Before the
// `mvp` or `live` tag only MVP stories run. When none can start, `text` says why, and `fails` is set
// when the checkout has to change first.
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
  // While a closing ceremony waits for a landed story's review, a batch builds nothing, whatever
  // epic it names: the stage sent it here for the reviews. One named story may still start.
  if (stage.held && reviewsWaiting(state, project).length > 0) return say(`Nothing is ready: ${stage.why}. Next: ${stage.next}.`)
  if (select === undefined && (stage.n === 7 || stage.retro)) return say(`Nothing is ready: ${stage.why}. Next: ${stage.next}.`)
  const epic = select !== undefined ? Number(select) : stage.n === 6 ? stage.epic : null
  // A product adopted live has no mvp tag, and its planned work runs as after a sign-off.
  const signedOff = state.tags.has('mvp') || state.tags.has('live')
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

// The next epic follows every epic a story file or a feat(N.M) commit on the default branch names,
// so a repository whose history already used those numbers never has a story done before it starts.
const nextEpic = (state) => Math.max(0, ...[...state.stories.values()].map((story) => story.epic), ...[...state.done.keys()].map((id) => Number(id.split('.')[0]))) + 1

// The next question's number, never one a decision answered.
const nextQuestion = (state) => `Q-${following([...state.questions.map((q) => q.id), ...state.decisions.map((d) => d.answers).filter(Boolean)])}`

export function nextIds(state, now) {
  const today = ymd(now)
  return [
    `A parked question goes under "## Questions" in docs/queue.md as "### ${nextQuestion(state)} Title (${today})", numbered on from there, then "- Blocks:" with the stories it blocks or "nothing", "- Default taken:" with the default the work goes on with, "- Severity: high" as a last field when money or data can be lost or someone can see or do what they shouldn't, and the question itself.`,
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
  const out = storyLines(state, story, `Story ${id}, from ${story.file}:`)
  out.push(...screensSection(state, story))
  out.push(...laneSection(state, 'Story'))
  const commit = `one commit whose subject starts "feat(${id}): ", holding the code, its tests and the spec delta`
  return [...out, landing(project, facts, commit, `story/${id}`), '', ...nextIds(state, now)]
}

// A story with what it stands on, as brief lines under `opening`: the story, the requirements it
// cites and the decisions that name it, each verbatim.
function storyLines(state, story, opening) {
  const { id } = story
  const out = [opening, '', story.text, '']
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
  return out
}

// ---- What a review reads

// The landed stories a batch's reviewers read next, as the ready list prints stories, the line a
// reviewer's spawn description starts with; the CLI adds the reviewer's effort as a last line.
// When none can start, `text` says why, and `fails` is set when the checkout has to change first.
export function reviewList(state, project, facts) {
  const say = (text, fails = false) => ({ lines: [], text, fails })
  if (project.mode !== 'solo') return say("No review waits: in team mode a story's pull request is its review.")
  if (state.scope.unread) return say("No review is listed: git couldn't read the commits since the last retro.", true)
  const waiting = reviewsWaiting(state, project, facts)
  if (facts !== null && waiting.length > 0) {
    // A review starts from a clean tree on the default branch, as a batch does. The reviews' own
    // commits wait there meanwhile: the batch pushes them together, so a host that deploys at each
    // push deploys once.
    if (!facts.clean) return say("The working tree has changes that aren't committed, and a review starts from a clean tree.", true)
    const branch = branchProblem(facts, 'a review')
    if (branch !== null) return say(branch, true)
  }
  if (facts !== null && waiting.length === 0 && facts.ahead > 0) {
    // A push lands nothing while the remote holds commits this branch lacks, so none is named.
    if (facts.behind > 0) return say(`No review waits, but ${facts.name} and ${facts.upstream} have diverged, and the human reconciles them before anything is pushed.`, true)
    return say(`No review waits, and ${facts.name} has ${plural(facts.ahead, 'commit')} that ${facts.upstream} lacks; \`git push ${facts.remote} ${facts.name}\` lands ${facts.ahead === 1 ? 'it' : 'them'}.`, true)
  }
  return waiting.length > 0 ? { lines: waiting.map((story) => `${story.id} ${story.tier} ${story.title}`) } : say('No review waits.')
}

// What each tier asks of a story's commit, as the worker is told it.
const TIER_ASKS = {
  T1: 'the gates, and evidence for each acceptance criterion',
  T2: 'the gates, evidence for each acceptance criterion, and a test for each business rule its requirements quote',
  T3: 'the gates, evidence for each acceptance criterion, a test for each business rule its requirements quote, and negative-case tests from an adversarial reading of the change',
}

// A story-reviewer's brief: the story with what it stands on, what its tier asks of its commit, its
// commits since the last retro and how to read one, then the record and how it lands. A T3 story
// always gets its question, as does one whose review a question already asks for; a T1 or T2
// story gets one only with findings. `fails` is set for a story that doesn't wait for a review.
export function reviewBrief(state, project, facts, id, now) {
  const story = state.stories.get(id)
  if (story === undefined) return { text: `${id} is not a story.`, fails: true }
  if (!reviewsWaiting(state, project, facts).includes(story)) return { text: `${id} doesn't wait for a review.`, fails: true }
  const commits = state.scope.commits.get(id)
  const out = storyLines(state, story, `Review of story ${id}, from ${story.file}:`)
  out.push(`What ${story.tier} asks of its commit: ${TIER_ASKS[story.tier]}.`, '')
  out.push(commits.length === 1 ? 'Its commit:' : 'Its commits, oldest first:', ...commits.map((commit) => `- ${commit.sha} ${commit.subject}`))
  out.push(`\`git diff ${commits[0].sha}~1 ${commits[0].sha}\` shows what a commit changed, and the files stand as they are now.`, '')
  const open = state.questions.find((q) => q.review === id)
  const fields = '"- Blocks: nothing", "- Default taken: landed as built", and "- Severity: high" as a last field when a finding is high'
  const findings = 'the findings as a numbered list, each opening with its place as `path:line`, then what happens and what it goes against'
  const question =
    open === undefined
      ? `a question under "## Questions" in docs/queue.md, "### ${nextQuestion(state)} Review ${id} (${ymd(now)})", then ${fields}`
      : `docs/queue.md already holds ${open.id}, which asks for this review, and its fields and its text are replaced: ${fields}`
  // A T3 story's review always leaves its question, and so does one a question already asks for.
  const always = story.tier === 'T3' || open !== undefined
  out.push(
    always ? `The record: ${question}; then ${findings}, or "The review found nothing."` : `The record: with findings, ${question}; then ${findings}. With none, nothing is written.`,
    `A change that can't be read gets the question all the same, saying why, under the subject "review(${id}): not reviewed".`,
  )
  // The landing is given as its commands, to run as they stand: one chained after a cd, or given a
  // folder with git -C, is a command no session has approved beforehand, and it is refused.
  const found = `\`git add docs/queue.md\`, then \`git commit -m "review(${id}): 2 findings"\` with the findings' own count`
  const commit = always
    ? `${found}, or with "review(${id}): no findings"`
    : `with findings, ${found}; with none, \`git commit --allow-empty -m "review(${id}): no findings"\``
  const where = `The commit holds docs/queue.md and nothing else${always ? '' : ', or nothing at all'}, on ${facts?.name ?? 'the default branch'}. Each command runs as it stands: the shell is already in the project's folder, so no \`cd\` and no \`git -C\`.`
  const pushed = facts?.remote == null ? 'There is no remote, so nothing is pushed.' : "It isn't pushed here: the batch pushes its reviews together, once none waits."
  return { text: [...out, `Landing: ${commit}. ${where} ${pushed}`].join('\n') }
}

// The screens in the manifest that show a story's requirements, with their states and files, as
// brief lines; none without a design, or when no screen shows them.
function screensSection(state, story) {
  const screens = (state.design?.screens ?? []).filter((screen) => screen.requirements.some((req) => story.requirements.includes(req)))
  if (screens.length === 0) return []
  const [narrow, wide] = state.design.widths
  const line = (screen) => `- ${screen.id} (${screen.title}): ${prose(screen.states)}, in ${prose(screen.states.map((each) => stateFile(screen.id, each)))}`
  return [`The screens that show its requirements, from design/manifest.md, each drawn at ${narrow} and ${wide} pixels:`, '', ...screens.map(line), '']
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
// A story-worker's effort per tier, and a story-reviewer's, beneath ~/.epikloop/config.json and
// .epikloop/project.json.
const WORKER_EFFORT = { T1: 'medium', T2: 'high', T3: 'xhigh', review: 'high' }

// Each tier's worker effort, as the emitter sets it: the project's over the user's over the
// default. A value that is no level is passed over, and so is a config that doesn't parse.
function workerEffort(project, home) {
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(path.join(home, '.epikloop', 'config.json'), 'utf8').replace(/^﻿/, '')) ?? {}
  } catch {}
  const effort = {}
  for (const layer of [WORKER_EFFORT, user.effort, project.effort]) {
    for (const tier of Object.keys(WORKER_EFFORT)) if (EFFORTS.includes(layer?.[tier])) effort[tier] = layer[tier]
  }
  return effort
}

// The ready list's last line: the worker effort of each tier the list holds. The batch passes it
// with the worker's spawn, so the emitter's own setting of it changes nothing.
function workerLine(lines, project, home) {
  const effort = workerEffort(project, home)
  const tiers = Object.keys(WORKER_EFFORT).filter((tier) => lines.some((line) => line.split(' ')[1] === tier))
  return `Worker effort: ${tiers.map((tier) => `${tier} ${effort[tier]}`).join(', ')}.`
}

// The reviews' list's last line: the reviewer's effort, which the batch passes with its spawn.
const reviewLine = (project, home) => `Review effort: ${workerEffort(project, home).review}.`

// A model's name as the Agent tool takes one: a lowercase word, such as fable or opus.
const MODEL_NAME = /^[a-z][a-z0-9.-]*$/

// The model that draws a design: the user's choice in ~/.epikloop/config.json, else the project's
// in its marker. An account decides which models it has, so the user's comes first, where an
// effort's comes last. A value that is no model name is passed over, and `passed` says which. An
// eval's session reads none from the user's file, so a contributor's own choice changes no run.
function designModel(project, home, env) {
  let user = {}
  if (!env.EPIKLOOP_EVAL) {
    try {
      user = JSON.parse(fs.readFileSync(path.join(home, '.epikloop', 'config.json'), 'utf8').replace(/^﻿/, '')) ?? {}
    } catch {}
  }
  const passed = []
  for (const [where, value] of [
    ['~/.epikloop/config.json', user.model?.design],
    ['.epikloop/project.json', project.model?.design],
  ]) {
    if (value === undefined) continue
    if (typeof value === 'string' && MODEL_NAME.test(value)) return { model: value, where, passed }
    passed.push(`${JSON.stringify(value)} in ${where}`)
  }
  return { model: null, where: null, passed }
}

// The design brief's lines on which model draws: always one, so a session that draws on its own
// model does so knowingly, and one more for each value passed over.
function drawingLines(project, home, env) {
  const { model, where, passed } = designModel(project, home, env)
  const whose = where === '~/.epikloop/config.json' ? `which the human set in ${where}` : `which ${where} sets`
  return [
    ...passed.map((what) => `The drawing model ${what} is no model name, a lowercase word such as fable, so it is passed over.`),
    model === null
      ? 'The drawing model: none is set, so this session\'s own model draws. "model": { "design": "<name>" } in ~/.epikloop/config.json sets one.'
      : `The drawing model: ${model}, ${whose}.`,
  ]
}

// The cost rows on this machine, per tier and effort, and the reviews after them, per effort, with
// the models that reviewed: how many runs, and their mean wall time and cost.
function costLines(project, home) {
  const groups = new Map()
  for (const row of costRows(home, project.id)) {
    const key = `${row.review === true ? 'reviews' : row.tier} at ${EFFORTS.includes(row.effort) ? row.effort : 'an unknown effort'}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  if (groups.size === 0) return ['There are no cost rows on this machine yet.']
  const order = (key) => (key.startsWith('reviews') ? 40 : Number(key[1]) * 10) + (EFFORTS.indexOf(key.split(' at ')[1]) + 1)
  const lines = [...groups].sort(([a], [b]) => order(a) - order(b)).map(([key, rows]) => {
    const wall = (rows.reduce((sum, row) => sum + row.wall, 0) / rows.length / 60).toFixed(1)
    const costs = rows.map((row) => row.cost).filter(Number.isFinite)
    const cost = costs.length === 0 ? '' : ` and $${(costs.reduce((sum, c) => sum + c, 0) / costs.length).toFixed(2)}`
    const models = key.startsWith('reviews') ? [...new Set(rows.map((row) => row.model).filter((model) => typeof model === 'string'))].sort() : []
    return `- ${key}: ${plural(rows.length, 'run')}, ${wall} min${cost} each on average${models.length > 0 ? `, on ${prose(models)}` : ''}`
  })
  return ['The cost rows on this machine:', ...lines]
}

// The reviews since the last retro, for its brief: how many there were at each tier, how many had
// findings, and the findings in all. Nothing in team mode, which has no review stage.
function reviewLines(state, project) {
  if (project.mode !== 'solo') return []
  const reviews = [...state.scope.reviews]
    .map(([id, said]) => ({ tier: state.stories.get(id)?.tier ?? null, findings: Number(/^(\d+) findings?$/.exec(said)?.[1] ?? 0), unread: said === 'not reviewed' }))
    .filter((review) => review.tier !== null)
  if (reviews.length === 0) return ['Reviews since the last retro: none.']
  const byTier = (some) => Object.keys(TIER_ASKS).map((tier) => [tier, some.filter((review) => review.tier === tier).length]).filter(([, n]) => n > 0).map(([tier, n]) => `${tier} ${n}`).join(', ')
  const found = reviews.filter((review) => review.findings > 0)
  const total = found.reduce((sum, review) => sum + review.findings, 0)
  const unread = reviews.filter((review) => review.unread).length
  const findings = found.length === 0 ? 'none had findings' : `${found.length} had findings (${byTier(found)}), ${plural(total, 'finding')} in all`
  return [`Reviews since the last retro: ${reviews.length} (${byTier(reviews)}); ${findings}${unread > 0 ? `; ${unread} could not be read` : ''}.`]
}

// The rework since the last retro, for its brief: the rework stories that landed, whatever their
// epic, as the reviews are counted, and the commits that fix a landed story.
function reworkLine(state) {
  const stories = planOrder(state.stories).filter((story) => story.reworks !== null && inScope(state.scope, story.id)).map((story) => `${story.id} for ${story.reworks}`)
  const { fixes } = state.scope
  const parts = [
    ...(stories.length > 0 ? [`${plural(stories.length, 'rework story', 'rework stories')} landed (${stories.join(', ')})`] : []),
    ...(fixes > 0 ? [`${plural(fixes, 'commit')} that ${fixes === 1 ? 'fixes' : 'fix'} a landed story`] : []),
  ]
  return `Rework since the last retro: ${parts.length === 0 ? 'none' : parts.join(', and ')}.`
}

// The queue as a ceremony weighs it: its open entries, and queue Δ with its base, which only the
// MVP's sign-off weighs.
function queueLine(state) {
  const open = `The queue: ${plural(state.questions.length, 'question')} and ${plural(state.backlog, 'backlog line')}`
  if (state.stage.retro) return `${open}.`
  const delta = state.delta === null ? 'queue Δ unknown' : `queue Δ ${signed(state.delta)} since ${state.base === 'the freeze' ? 'the MVP set was frozen' : state.base}`
  return `${open}; ${delta}.`
}

function stagingLine(project, what) {
  const url = typeof project.staging_url === 'string' && project.staging_url !== '' ? project.staging_url : null
  return url === null ? `${what}, though .epikloop/project.json has no staging_url: the human sets it, or the record says why there is no staging` : `${what} against ${shownUrl(url)}`
}

// A ceremony that can't run now, and why.
const refuse = (text) => ({ text, fails: true })

// How far a retro's visual compare reaches, once the design is complete: every screen in the
// manifest, in each of its states, at both widths. Where the lane says where its pictures are
// written, `--compare` then says which of them a retro reads.
function compareLine(state) {
  const d = state.design
  if (!d?.complete) return []
  const states = d.screens.reduce((sum, screen) => sum + screen.states.length, 0)
  const listed = typeof state.lane?.design?.renders === 'string' ? ' After the deep gates, `state.mjs --compare` lists the pairs to read, and gives the line for the record.' : ''
  return [`The visual compare covers ${plural(d.screens.length, 'screen')} in design/manifest.md, ${plural(states, 'state')} in all, each at ${d.widths[0]} and ${d.widths[1]} pixels.${listed}`]
}

// The line a record carries for its compare, as `--compare` gives it, for git's grep. The whole
// line is asked for, so a code that a record only mentions, in a note or in passing, names no list.
const COMPARE_LINE = 'Visual compare: [0-9]+ read, [0-9]+ unchanged, [0-9]+ changed and not read, [0-9]+ not rendered \\(snapshot [0-9a-f]{8}\\)'

// The code of the list that the last such line names in the default branch's docs/decisions.md,
// or null. Read from the branch, so a record that hasn't landed isn't trusted, and asked of git as
// matches alone, so the file's size never matters, and as text, whatever bytes the file holds.
function trustedCode(git, branch) {
  const found = branch === null ? null : git(['grep', '-a', '-h', '-o', '-E', COMPARE_LINE, branch, '--', 'docs/decisions.md'])
  return [...(found ?? '').matchAll(/\(snapshot ([0-9a-f]{8})\)/g)].at(-1)?.[1] ?? null
}

// What `--compare` prints after a retro's deep gates: the lane's pictures sorted against the list
// the last landed record names, the pairs to read, and the line for the record, which names the
// list this compare saved. A screen is named by each story with a feat or fix commit since the
// last retro that cites a requirement it shows. With `all`, every changed pair is to read, named
// or not, which is how a retro reads the pairs it had left and takes them into its list.
export function compareBrief(root, state, project, { home = os.homedir(), now = Date.now(), all = false } = {}) {
  const d = state.design
  const rel = state.lane?.design?.renders
  if (d === null || typeof rel !== 'string') return refuse(state.lane === null ? `Lane "${project.lane}" is not one of ${laneNames().join(', ')}.` : `The ${state.lane.name} lane has no pictures to compare.`)
  if (!d.complete) return refuse(`The visual compare waits for the design: ${designWhy(d)}.`)
  const git = gitReader(root)
  const against = trustedCode(git, refsOf(git).branch)
  const trusted = against === null ? null : readList(home, project.id, against)
  const named = new Map()
  for (const story of planOrder(state.stories)) {
    if (!state.scope.commits.has(story.id)) continue
    for (const screen of d.screens) if (screen.requirements.some((req) => story.requirements.includes(req))) named.set(screen.id, [...(named.get(screen.id) ?? []), story.id])
  }
  const sorted = sortPictures({ dir: path.join(root, ...rel.split('/')), screens: d.screens, widths: d.widths, named, trusted, all })
  if (sorted.times.length === 0) return refuse(`No picture is in ${rel}/, where the deep gates' e2e run writes them.`)
  const head = Number(git(['log', '-1', '--format=%ct', 'HEAD'])) * 1000 || null
  let code
  const unsaved = []
  try {
    code = saveList(home, project.id, sorted.entries, { now, commit: git(['rev-parse', '--short', 'HEAD'])?.trim() || null })
  } catch (error) {
    code = listCode(sorted.entries)
    unsaved.push(`This list couldn't be saved on this machine (${String(error?.code ?? error?.message ?? error).split('\n')[0]}), so the next compare reads every pair.`)
  }
  return { text: [...compareLines(sorted, { rel, code, against, held: trusted !== null, head }), ...unsaved].join('\n') }
}

// The retro's brief at stage 7, where a phase closes, at stage 8, the MVP sign-off, or once the
// product is live, where each epic that lands closes: what it covers, the evidence it gathers, the
// queue, the cost rows, the record and how it lands. Once a record is on the default branch, only
// the tags it leaves.
export function retroBrief(state, project, facts, { home = os.homedir(), machine = () => [], collected = () => null } = {}) {
  const { stage } = state
  const closing = stage.n === 7 || stage.retro === true
  if ((!closing && stage.n !== 8) || stage.held) return refuse(`A retro waits: ${stage.why}. Next: ${stage.next}.`)
  if (facts === null) return refuse('A retro needs a commit to start from.')
  const problem = startProblem(project, facts, 'a retro')
  if (problem !== null) return refuse(problem)

  const epics = [...new Set([...state.stories.values()].filter((story) => story.mvp).map((story) => story.epic))].sort((a, b) => a - b)
  const last = stage.n === 8 || stage.epic === epics.at(-1)
  const retro = closing ? recorded(state, `Phase ${stage.epic} retro`) : undefined
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
    const forEpikloop = collected()
    return { text: [`Recorded: ${records.join(' and ')}. ${tagging(facts, tags)}`, ...notes, ...(forEpikloop === null ? [] : [forEpikloop])].join('\n') }
  }

  const next = nextDecision(state)
  const out = []
  if (closing) {
    const stories = planOrder(state.stories).filter((story) => story.epic === stage.epic && (stage.retro || story.mvp))
    out.push(
      `Retro for phase ${stage.epic}: epic ${stage.epic}, ${stories[0].epicTitle}.`,
      'Its stories, for the click-through:',
      ...stories.map((story) => `- ${story.id} ${story.title}`),
      `The evidence: the deep gates, \`scripts/check.sh --deep\` from Bash or \`node .githooks/check.mjs --deep\` from PowerShell; the gates' self-test, the same with \`--self-test\`; ${stagingLine(project, 'the staging smoke')}; and the human's click-through of these stories on staging.`,
      ...(state.lane?.sections.Retro ? [`The ${state.lane.name} lane: ${state.lane.sections.Retro.replace(/\s*\n\s*/g, ' ')}`] : []),
      ...compareLine(state),
      queueLine(state),
      ...reviewLines(state, project),
      reworkLine(state),
      ...costLines(project, home),
      ...machine(),
    )
  } else {
    out.push(
      'MVP sign-off: every MVP epic is tagged.',
      `The evidence: ${stagingLine(project, 'the staging smoke')}; and the human's click-through of the MVP on staging.`,
      queueLine(state),
    )
  }
  out.push(...notes)
  if (stage.retro) out.push(`The product is live, so this retro closes epic ${stage.epic} and signs nothing off.`)
  if (last) {
    const current = state.delta === null ? 'it is unknown now' : `it is ${signed(state.delta)} now`
    const opening = stage.n === 7 ? `Epic ${stage.epic} is the last MVP epic, so this retro is also the MVP sign-off. ` : ''
    out.push(`${opening}Sign-off needs queue Δ at 0 or below, counted after the pruning, and a green staging smoke; ${current}.`)
  }
  const titles = []
  if (closing) titles.push(`a decision titled "Phase ${stage.epic} retro"`)
  if (last && signOff === undefined) titles.push(`${titles.length > 0 ? 'one' : 'a decision'} titled "MVP sign-off" if the human signs off`)
  out.push(
    titles.length === 0
      ? `The record: MVP sign-off is already recorded in ${signOff.id}, so the commit holds the pruning.`
      : `The record, in docs/decisions.md: ${titles.join(', and ')}, ${titles.length > 1 ? `from ${next} on` : next}.`,
  )
  const subject = closing ? `chore(phase-${stage.epic}): retro` : 'chore(mvp): sign-off'
  const branch = closing ? `retro/phase-${stage.epic}` : 'retro/mvp'
  out.push(landing(project, facts, `one commit whose subject is "${subject}", holding the record, the queue and whatever else the retro changes`, branch))
  out.push('Once it has landed, `--retro` again prints the tags.')
  return { text: out.join('\n') }
}

// The newest phase-N or live tag and its time, or null: where the last retro ended. A tag that
// `git tag phase-N` makes carries its commit's time, which is the record's.
function lastClosing(git) {
  // The name without refs/tags/, which the short form keeps as tags/ where a branch has the name.
  const listed = git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:lstrip=2)%09%(creatordate:unix)', 'refs/tags']) ?? ''
  for (const line of listed.split('\n')) {
    const [name, at] = line.split('\t')
    if (/^(?:phase-\d+|live)$/.test(name)) return { name, at: Number(at) * 1000 }
  }
  return null
}

// What a retro's brief takes from the machine, each read only when the brief prints it: the event
// log's counts since the last retro with the line on the notes for Epikloop, and that line alone
// once the record has landed and carries a note. Either way the notes are collected into their
// file on the way.
export function retroExtras(root, project, state, { now = Date.now(), home = os.homedir() } = {}) {
  const notes = notesOf(state)
  return {
    home,
    machine: () => {
      const tag = lastClosing(gitReader(root))
      const cap = (Number.isInteger(project.gates?.cap_minutes) ? project.gates.cap_minutes : 10) * 60
      return [countsLine(eventCounts(home, project.id, { since: tag?.at ?? 0, now }), { tag: tag?.name ?? null, cap }), collectNotes(home, project.id, notes)]
    },
    collected: () => (notes.length === 0 ? null : collectNotes(home, project.id, notes)),
  }
}

// The release's brief at stage 9: staging, where the hosting is described, the production smoke,
// the record and how it lands, and, until going live has been put off, how to record that instead;
// once it has been, that a release which still waits records nothing. Once the go-live record is on
// the default branch, only the tag.
export function releaseBrief(state, project, facts) {
  const { stage } = state
  if (stage.n !== 9 || stage.held) return refuse(`A release waits: ${stage.why}. Next: ${stage.next}.`)
  if (facts === null) return refuse('A release needs a commit to start from.')
  const problem = startProblem(project, facts, 'a release')
  if (problem !== null) return refuse(problem)
  const live = recorded(state, 'Go live')
  if (live !== undefined) return { text: `Recorded: ${live.title} in ${live.id}. ${tagging(facts, ['live'])}` }
  const later = recorded(state, 'Go live later')
  const deferral = [
    `When the human says production comes later, nothing is set up or promoted: the record is instead a decision titled "Go live later", ${nextDecision(state)}, saying what going live waits for, and until the release the planned work runs first.`,
    landing(project, facts, 'one commit whose subject is "chore(release): go live later", holding that record', 'release/later'),
  ]
  const url = typeof project.staging_url === 'string' && project.staging_url !== '' ? project.staging_url : null
  return {
    text: [
      later === undefined ? 'Release: the MVP is signed off, and nothing is live yet.' : `Release: the MVP is signed off, and going live waits, as ${later.id} records.`,
      url === null ? 'Staging: .epikloop/project.json has no staging_url, so the human names where the signed-off build runs.' : `Staging: ${shownUrl(url)}.`,
      'The hosting: spec/architecture.md says how staging is hosted, and production follows it.',
      "The evidence: the production smoke, the same script given production's URL, once the build the mvp tag marks is promoted.",
      `The record: spec/architecture.md gains how production runs, how a build is promoted to it and how it is rolled back; and a decision in docs/decisions.md titled "Go live", ${nextDecision(state)}, whose implementation note holds the post-launch checklist.`,
      landing(project, facts, 'one commit whose subject is "chore(release): go live", holding the record and any production configuration', 'release/live'),
      'Once it has landed, `--release` again prints the `live` tag.',
      ...(later === undefined ? deferral : [`If going live still waits, nothing is set up or recorded: ${later.id} stands, and the release ends there.`]),
    ].join('\n'),
  }
}

// ---- What the design reads

// `items` as prose: "a", "a and b", or "a, b and c".
const prose = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)
// The missing files the design's brief names before it counts the rest.
const SHOWN_FILES = 10
const decided = (d) => (/^- Decision: (.*)$/m.exec(d.text)?.[1] ?? '').trim().replace(/\.$/, '')

// The design skill's brief, at any stage: the lane's widths, where the design stands, and what an
// audit reads, which is the current requirements no screen cites, the manifest's citations that
// aren't current, the screen files it doesn't list and its unreadable lines. A lane that skips
// design is refused.
export function designBrief(state, project, { home = os.homedir(), env = process.env } = {}) {
  const d = state.design
  if (d === null) return refuse(state.lane === null ? `Lane "${project.lane}" is not one of ${laneNames().join(', ')}.` : `The ${state.lane.name} lane skips design.`)
  const [narrow, wide] = d.widths
  const out = [
    `Design for this ${state.lane.name} project: each screen is drawn at ${narrow} and ${wide} pixels wide, in its default state and any of empty, loading and error.`,
    `Where it stands: ${d.complete ? 'the design is complete' : designWhy(d)}.`,
    ...drawingLines(project, home, env),
    `The brief: design/brief.md is ${d.brief ? 'written' : 'missing'}; design/refs/ ${d.refs.length === 0 ? 'is empty' : `holds ${prose(d.refs)}`}.`,
    ...(cameWith(d)
      ? ['No directions: design/tokens.css came with the product, and amend and add follow it.']
      : [
          `The directions: ${d.directions.length === 0 ? 'none in design/directions/ yet' : `${prose(d.directions)} in design/directions/`}.`,
          d.pick === undefined ? `The pick: not recorded; it will be ${nextDecision(state)}, titled "Design direction".` : `The pick, in ${d.pick.id}: ${decided(d.pick)}.`,
        ]),
    `The tokens: design/tokens.css is ${d.tokens ? 'written' : 'missing'}.`,
  ]
  if (d.screens === null) out.push('The screens: design/manifest.md is missing.')
  else {
    const states = d.screens.reduce((sum, screen) => sum + screen.states.length, 0)
    const shown = d.missing.slice(0, SHOWN_FILES)
    const named = d.missing.length > shown.length ? `${shown.join(', ')} and ${d.missing.length - shown.length} more` : prose(shown)
    const files = d.missing.length === 0 ? 'every state has its file' : `${plural(d.missing.length, 'state')} ${d.missing.length === 1 ? 'has' : 'have'} no file yet: ${named}`
    out.push(`The screens: design/manifest.md lists ${plural(d.screens.length, 'screen')} in ${plural(states, 'state')}; ${files}.`)
    out.push(
      d.uncited.length === 0 ? 'Every current requirement is cited by a screen.' : `Current requirements no screen cites: ${d.uncited.map((r) => `${r.id} ${reqTitle(r)}`).join('; ')}.`,
    )
    if (d.strays.length > 0) out.push(`The manifest cites ${prose(d.strays)}, which ${d.strays.length === 1 ? "isn't a current requirement" : "aren't current requirements"}.`)
  }
  if (d.unlisted.length > 0) out.push(`design/screens/ holds ${prose(d.unlisted)}, which the manifest doesn't list.`)
  const unread = state.problems.filter((problem) => problem.startsWith('design/manifest.md:'))
  if (unread.length > 0) out.push('Unreadable lines:', ...unread.map((problem) => `- ${problem}`))
  return { text: out.join('\n') }
}

const TEMPLATES = path.join(import.meta.dirname, '..', 'templates')
const EXAMPLES = {
  spec: 'spec/capability.md',
  stories: 'docs/stories/epic.md',
  queue: 'docs/queue.md',
  decisions: 'docs/decisions.md',
  manifest: 'design/manifest.md',
}
const USAGE =
  'usage: node state.mjs [--ready [N | N.M] | --story N.M | --reviews | --review N.M | --ids | --retro | --compare [all] | --release | --design | --lane plan|story|retro | --lanes | --example spec|stories|queue|decisions|manifest]'
// A batch's and a retro's calls fold the emitter's files, and start no pass of the fold once this
// long has gone, so the files don't pile up where neither Harbor nor doctor runs, and no call
// waits long for it.
const FOLD_MS = 3_000
// The flags that read a project for a batch, a ceremony, the design or a lane, each with a test of
// its argument.
const FLAGS = {
  '--ready': (arg) => arg === undefined || /^\d+(?:\.\d+)?$/.test(arg),
  '--story': (arg) => STORY.test(arg ?? ''),
  '--reviews': (arg) => arg === undefined,
  '--review': (arg) => STORY.test(arg ?? ''),
  '--ids': (arg) => arg === undefined,
  '--retro': (arg) => arg === undefined,
  '--compare': (arg) => arg === undefined || arg === 'all',
  '--release': (arg) => arg === undefined,
  '--design': (arg) => arg === undefined,
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
    const now = Date.now()
    // Before anything reads the cost rows. An eval's session leaves the machine's files alone,
    // and a fold that can't run fails nothing.
    if ((flag === '--ready' || flag === '--retro') && !process.env.EPIKLOOP_EVAL) {
      try {
        foldAll(os.homedir(), now, { budget: FOLD_MS })
      } catch {}
    }
    const state = readState(opened.root, opened.project)
    if (flag === '--ids') {
      const epic = `The next epic is ${nextEpic(state)}: it follows the epics in docs/stories/ and every feat(N.M) commit on the default branch.`
      return console.log([...nextIds(state, now), epic].join('\n'))
    }
    if (flag === '--lane') {
      if (state.lane === null) {
        process.exitCode = 1
        return console.log(`Lane "${opened.project.lane}" is not one of ${laneNames().join(', ')}.`)
      }
      const section = LANE_SECTIONS.find((each) => each.toLowerCase() === name)
      return console.log(state.lane.sections[section] ?? `The ${state.lane.name} lane adds nothing here.`)
    }
    if (flag === '--design') {
      const brief = designBrief(state, opened.project)
      if (brief.fails) process.exitCode = 1
      return console.log(brief.text)
    }
    if (flag === '--compare') {
      const brief = compareBrief(opened.root, state, opened.project, { now, all: name === 'all' })
      if (brief.fails) process.exitCode = 1
      return console.log(brief.text)
    }
    const facts = batchFacts(opened.root)
    if (flag === '--retro' || flag === '--release') {
      const brief = flag === '--retro' ? retroBrief(state, opened.project, facts, retroExtras(opened.root, opened.project, state, { now })) : releaseBrief(state, opened.project, facts)
      if (brief.fails) process.exitCode = 1
      return console.log(brief.text)
    }
    if (flag === '--story') {
      const brief = storyBrief(state, opened.project, facts, name, now)
      if (brief === null) process.exitCode = 1
      return console.log(brief === null ? `${name} is not a story.` : brief.join('\n'))
    }
    if (flag === '--reviews') {
      const reviews = reviewList(state, opened.project, facts)
      if (reviews.fails) process.exitCode = 1
      return console.log(reviews.lines.length === 0 ? reviews.text : [...reviews.lines, reviewLine(opened.project, os.homedir())].join('\n'))
    }
    if (flag === '--review') {
      const brief = reviewBrief(state, opened.project, facts, name, now)
      if (brief.fails) process.exitCode = 1
      return console.log(brief.text)
    }
    const ready = readyList(state, opened.project, facts, name)
    if (ready.fails) process.exitCode = 1
    if (ready.lines.length === 0) return console.log(ready.text)
    return console.log([...ready.lines, workerLine(ready.lines, opened.project, os.homedir())].join('\n'))
  }
  const state = opened.problem === null ? readState(opened.root, opened.project) : null
  const { parts, needs } = summary(opened, state)
  const lines = [...parts]
  if (needs.length > 0) lines.push(`Needs the human: ${needs.join('; ')}.`)
  if (state?.questions.length > 0) {
    lines.push('Waiting questions:')
    for (const q of state.questions) lines.push(`- ${q.id} ${q.title} (${q.date}), ${q.severity === 'high' ? 'marked high, ' : ''}blocks ${q.blocks.length > 0 ? q.blocks.join(', ') : 'nothing'}`)
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

// A stories file for epic `n`: each story is [m, tier, mvp, after?, reworks?].
function epicFile(n, stories) {
  const body = stories.map(([m, tier, mvp, after, reworks]) =>
    [
      `## ${n}.${m} Story ${n}.${m}`,
      `- Tier: ${tier}`,
      `- MVP: ${mvp ? 'yes' : 'no'}`,
      '- Requirements: REQ-APP-001',
      ...(after ? [`- After: ${after}`] : []),
      ...(reworks ? [`- Reworks: ${reworks}`] : []),
      '',
      'Body.',
      '',
      '### Spec delta',
      '- none',
      '',
    ].join('\n'),
  )
  return `# Epic ${n}: Epic ${n}\n\n${body.join('\n')}`
}

// A queue file: each question is [id, blocks, title?, severity?].
function queueFile({ questions = [], backlog = 0 } = {}) {
  const asked = questions.map(
    ([id, blocks, title = 'Question', severity]) => `### ${id} ${title} (2026-11-01)\n- Blocks: ${blocks}\n- Default taken: the safe one\n${severity ? `- Severity: ${severity}\n` : ''}\nWhy.\n`,
  )
  const lines = Array.from({ length: backlog }, (_, i) => `- 2026-11-0${(i % 9) + 1} Backlog item ${i + 1}`)
  return `# Queue\n\n## Questions\n\n${asked.join('\n')}\n## Backlog\n\n${lines.join('\n')}\n`
}

// A decisions file whose entries carry `titles`, numbered from DECISION-001.
function decisionsFile(titles) {
  const entry = (title, i) => `## DECISION-${String(i + 1).padStart(3, '0')} ${title} (2026-11-10)\n- Context: c\n- Decision: d\n- Rejected: r\n- Trade-offs: t\n- Implementation note: n\n`
  return `# Decisions\n\n${titles.map(entry).join('\n')}`
}

const APP_SPEC = '# App\n\nWhat it is.\n\n## REQ-APP-001 It works\n\nIt works.\n'
// A complete design for the app: its tokens, and one screen in its one state.
const DESIGNED = {
  'design/tokens.css': ':root { --ink: #222; }\n',
  'design/manifest.md': '# Screens\n\n## home Home\n- States: default\n- Requirements: REQ-APP-001\n\nThe first screen.\n',
  'design/screens/home.html': '<!doctype html>\n<link rel="stylesheet" href="../tokens.css">\n',
}
const DIRECTIONS = { 'design/directions/a.html': '<!doctype html>\n', 'design/directions/b.html': '<!doctype html>\n', 'design/directions/c.html': '<!doctype html>\n' }

// A project past stage 5, with `epics` as { n: stories } for epicFile.
function planned(epics, queue) {
  const files = {
    'spec/app.md': APP_SPEC,
    'spec/architecture.md': '# Architecture\n',
    ...DESIGNED,
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
        'design/manifest.md': k.template('design/manifest.md'),
      })
      const s = k.read(dir)
      const story = (id) => s.stories.get(id)
      const screens = s.design?.screens?.map((screen) => `${screen.id}:${screen.states.join('/')}:${screen.requirements.join('/')}`).join(' ')
      return k.expect([
        [s.problems.join(' | '), ''],
        [screens, 'cart:default/empty/loading/error:REQ-CHECKOUT-002 sign-in:default/error:REQ-CHECKOUT-001'],
        [[...s.requirements.values()].map((r) => `${r.id} ${r.status}`).join(', '), 'REQ-CHECKOUT-001 current, REQ-CHECKOUT-002 observed, REQ-CHECKOUT-003 retired'],
        [[...s.stories.keys()].join(' '), '3.1 3.2 3.3'],
        [`${story('3.1').tier} ${story('3.2').tier} ${story('3.3').tier}`, 'T1 T3 T2'],
        [`${story('3.1').mvp} ${story('3.3').mvp} ${story('3.2').after}`, 'true false 3.1'],
        [s.questions.map((q) => `${q.id}>${q.blocks}`).join(' '), 'Q-007>3.2 Q-008>3.3 Q-009>'],
        [s.questions.map((q) => `${q.severity} ${q.review}`).join(', '), 'null null, null null, high 3.2'],
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
    'a history whose log runs past 1 MB still counts its landed stories and those in review',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true], [3, 'T1', true]] }), { freeze: true })
      // A repository's own grep setting can't change what counts.
      k.git(dir, 'config', 'grep.patternType', 'extended')
      k.commit(dir, 'feat(1.1): one', 2)
      k.noise(dir, 'main', 600)
      k.git(dir, 'switch', '-q', '-c', 'side')
      k.noise(dir, 'side', 600)
      k.commit(dir, 'feat(1.2): on a side branch', 1)
      k.git(dir, 'switch', '-q', 'main')
      return k.expect([
        [[...k.read(dir).done.keys()].join(' '), '1.1'],
        [k.ready(dir, '1.2'), '0 1.2 is in review, committed on another branch, so it is not ready.\n'],
      ])
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
    'stage 3: a UI lane designs before its plan, and finishes a design once it has started',
    (k) => {
      const spec = { 'spec/app.md': APP_SPEC }
      const brief = { ...spec, 'design/brief.md': '# App\n' }
      const drawn = { ...brief, ...DIRECTIONS }
      const picked = { ...drawn, 'docs/decisions.md': decisionsFile(['Design direction']) }
      const tokens = { ...picked, 'design/tokens.css': DESIGNED['design/tokens.css'] }
      const listed = { ...tokens, 'design/manifest.md': '# Screens\n' }
      const half = { ...tokens, 'design/manifest.md': '# Screens\n\n## home Home\n- States: default, error\n- Requirements: REQ-APP-001\n', 'design/screens/home.html': '' }
      const whole = { ...half, 'design/screens/home.error.html': '' }
      const untokened = { ...whole }
      delete untokened['design/tokens.css']
      const at = (files, wanted) => k.stage(k.repo(files), wanted)
      return [
        ...at(spec, '3 design/manifest.md is missing → /epikloop:design'),
        ...at(brief, '3 design/brief.md is written, and no direction is drawn yet → /epikloop:design'),
        ...at(drawn, "3 3 directions in design/directions/ wait for the human's pick → /epikloop:design"),
        ...at({ ...brief, 'design/directions/a.html': '' }, "3 1 direction in design/directions/ waits for the human's pick → /epikloop:design"),
        ...at(picked, '3 the direction is picked, and design/tokens.css is missing → /epikloop:design'),
        ...at(tokens, '3 the direction is picked, and design/manifest.md is missing → /epikloop:design'),
        ...at(listed, '3 design/manifest.md lists no screens → /epikloop:design'),
        ...at(half, '3 1 state in design/manifest.md has no file yet → /epikloop:design'),
        ...at(untokened, '3 design/tokens.css is missing → /epikloop:design'),
        ...at(whole, '4 spec/architecture.md is missing → /epikloop:architect'),
      ]
    },
  ],
  [
    'stage 3 leaves a project planned without a design where it is, and the service lane skips design',
    (k) => {
      const bare = planned({ 1: [[1, 'T1', true]] })
      for (const file of Object.keys(DESIGNED)) delete bare[file]
      const spec = { 'spec/app.md': APP_SPEC }
      return [
        ...k.stage(k.repo(bare), '6 epic 1 has 1 MVP story left → /epikloop:epic 1'),
        ...k.stage(k.repo({ ...bare, 'design/brief.md': '# App\n' }), '3 design/brief.md is written, and no direction is drawn yet → /epikloop:design'),
        ...k.stage(k.repo({ ...bare, 'design/manifest.md': DESIGNED['design/manifest.md'] }), '3 1 state in design/manifest.md has no file yet → /epikloop:design'),
        ...k.stage(k.repo(spec, { marker: { lane: 'service' } }), '4 spec/architecture.md is missing → /epikloop:architect'),
        ...k.stage(k.repo({ ...spec, 'design/brief.md': '# App\n' }, { marker: { lane: 'service' } }), '4 spec/architecture.md is missing → /epikloop:architect'),
      ]
    },
  ],
  [
    "the manifest's malformed lines are problems, with file and line",
    (k) => {
      const dir = k.folder({
        'spec/app.md': APP_SPEC,
        'design/manifest.md': [
          '# Screens',
          '',
          '## Home page',
          '## cart',
          '## list List',
          '- Requirements: none',
          '## form Form',
          '- States: empty, error',
          '- Requirements: auth',
          '## grid Grid',
          '- States: default, hover',
          '- Requirements: REQ-APP-001',
          '## menu Menu',
          '- States: default',
          '- States: default, error',
          '- Requirements: none',
          '## list Again',
          '- States: default',
          '- Requirements: none',
          '',
        ].join('\n'),
      })
      return k.contains(k.read(dir).problems, [
        'design/manifest.md:3: "## Home page" is not "## screen Title"',
        'design/manifest.md:4: "## cart" is not "## screen Title"',
        'design/manifest.md:5: list has no States',
        "design/manifest.md:7: form's States are not default and any of empty, loading and error",
        "design/manifest.md:7: form's Requirements are not REQ IDs or none",
        "design/manifest.md:10: grid's States are not default and any of empty, loading and error",
        'design/manifest.md:15: menu has a second States',
        'design/manifest.md:17: list is already at line 5',
      ])
    },
  ],
  [
    '--design prints where the design stands and what an audit reads, and a lane that skips design says so',
    (k) => {
      const spec = { 'spec/app.md': `${APP_SPEC}\n## REQ-APP-002 It helps\n\nIt helps.\n\n## REQ-APP-003 It went\nStatus: retired\n\nGone.\n` }
      const fresh = k.repo({ ...spec, 'design/refs/mood.png': 'png' })
      const waiting = k.repo({ ...spec, 'design/brief.md': '# App\n', ...DIRECTIONS, 'docs/decisions.md': decisionsFile(['No dependencies']) })
      const audited = k.repo({
        ...spec,
        'design/brief.md': '# App\n',
        ...DIRECTIONS,
        // A later pick replaces an earlier one.
        'docs/decisions.md': decisionsFile(['Design direction', 'Design direction']),
        'design/tokens.css': ':root {}\n',
        'design/manifest.md': '# Screens\n\n## home Home\n- States: default, error\n- Requirements: REQ-APP-001, REQ-APP-003, REQ-APP-009\n\n## list List\n- Requirements: none\n',
        'design/screens/home.html': '',
        'design/screens/home.error.html': '',
        'design/screens/old.html': '',
      })
      const screens = ['a', 'b', 'c'].map((id) => `## ${id} ${id.toUpperCase()}\n- States: default, empty, loading, error\n- Requirements: none\n`)
      const unbuilt = k.repo({ ...spec, 'design/tokens.css': DESIGNED['design/tokens.css'], 'design/manifest.md': `# Screens\n\n${screens.join('\n')}` })
      const missing = ['a', 'b', 'c'].flatMap((id) => ['', '.empty', '.loading', '.error'].map((state) => `design/screens/${id}${state}.html`))
      const service = k.repo(spec, { marker: { lane: 'service' } })
      const unknown = k.repo(spec, { marker: { lane: 'desktop' } })
      const head = 'Design for this web project: each screen is drawn at 390 and 1280 pixels wide, in its default state and any of empty, loading and error.'
      const draws = 'The drawing model: none is set, so this session\'s own model draws. "model": { "design": "<name>" } in ~/.epikloop/config.json sets one.'
      const lines = (stands, ...all) => `0 ${[head, stands, draws, ...all].join('\n')}\n`
      return k.expect([
        [
          k.run(fresh, '--design'),
          lines(
            'Where it stands: design/manifest.md is missing.',
            'The brief: design/brief.md is missing; design/refs/ holds mood.png.',
            'The directions: none in design/directions/ yet.',
            'The pick: not recorded; it will be DECISION-001, titled "Design direction".',
            'The tokens: design/tokens.css is missing.',
            'The screens: design/manifest.md is missing.',
          ),
        ],
        [
          k.run(waiting, '--design'),
          lines(
            "Where it stands: 3 directions in design/directions/ wait for the human's pick.",
            'The brief: design/brief.md is written; design/refs/ is empty.',
            'The directions: a.html, b.html and c.html in design/directions/.',
            'The pick: not recorded; it will be DECISION-002, titled "Design direction".',
            'The tokens: design/tokens.css is missing.',
            'The screens: design/manifest.md is missing.',
          ),
        ],
        [
          k.run(audited, '--design'),
          lines(
            'Where it stands: the design is complete.',
            'The brief: design/brief.md is written; design/refs/ is empty.',
            'The directions: a.html, b.html and c.html in design/directions/.',
            'The pick, in DECISION-002: d.',
            'The tokens: design/tokens.css is written.',
            'The screens: design/manifest.md lists 1 screen in 2 states; every state has its file.',
            'Current requirements no screen cites: REQ-APP-002 It helps.',
            "The manifest cites REQ-APP-003 and REQ-APP-009, which aren't current requirements.",
            "design/screens/ holds old.html, which the manifest doesn't list.",
            'Unreadable lines:',
            '- design/manifest.md:7: list has no States',
          ),
        ],
        [
          k.run(unbuilt, '--design'),
          lines(
            'Where it stands: 12 states in design/manifest.md have no file yet.',
            'The brief: design/brief.md is missing; design/refs/ is empty.',
            'No directions: design/tokens.css came with the product, and amend and add follow it.',
            'The tokens: design/tokens.css is written.',
            `The screens: design/manifest.md lists 3 screens in 12 states; 12 states have no file yet: ${missing.slice(0, 10).join(', ')} and 2 more.`,
            'Current requirements no screen cites: REQ-APP-001 It works; REQ-APP-002 It helps.',
          ),
        ],
        [k.run(service, '--design'), '1 The service lane skips design.\n'],
        [k.run(unknown, '--design'), '1 Lane "desktop" is not one of service, web.\n'],
        [k.run(fresh, '--design', 'audit'), `1 ${USAGE}\n`],
      ])
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
      k.reviewed(dir, '1.1')
      return k.stage(dir, "7 epic 1's MVP stories are done, and it has no phase-1 tag → /epikloop:retro")
    },
  ],
  [
    'stage 7 when the retro is recorded but the phase is untagged',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }))
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro']))
      k.commit(dir, 'feat(1.1): one', 1)
      k.reviewed(dir, '1.1')
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
    'stage 9 names the planned work while going live waits',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', false], [2, 'T1', false]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'tag', 'phase-1')
      k.git(dir, 'tag', 'mvp')
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'MVP sign-off', 'Go live later']))
      k.commit(dir, 'chore(release): go live later', 0)
      const waits = 'the MVP is signed off, and going live waits, as DECISION-003 records'
      const got = [
        k.stage(dir, `9 ${waits} → /epikloop:epic 2`),
        k.expect([
          [k.run(dir, '--retro'), `1 A retro waits: ${waits}. Next: /epikloop:epic 2.\n`],
          [k.ready(dir), '0 2.1 T1 Story 2.1\n2.2 T1 Story 2.2\nWorker effort: T1 medium.\n'],
        ]),
      ]
      k.commit(dir, 'feat(2.1): two', 0)
      k.commit(dir, 'feat(2.2): three', 0)
      // The release waits for the reviews of what landed since the last retro.
      const left = 'the MVP is signed off, going live waits, as DECISION-003 records, and nothing planned is left'
      got.push(
        k.stage(dir, `9 ${left}, and 2.1 and 2.2 wait for their reviews → /epikloop:epic 2`),
        k.expect([[k.run(dir, '--release'), `1 A release waits: ${left}, and 2.1 and 2.2 wait for their reviews. Next: /epikloop:epic 2.\n`]]),
      )
      k.reviewed(dir, '2.1', '2.2')
      got.push(k.stage(dir, `9 ${left} → /epikloop:release`))
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'MVP sign-off', 'Go live later', 'Go live']))
      k.commit(dir, 'chore(release): go live', 0)
      got.push(k.stage(dir, "9 the go-live is recorded, and live isn't tagged yet → /epikloop:release"))
      return got.flat()
    },
  ],
  [
    'a product adopted while live goes on in post-MVP mode, and its planned work runs',
    (k) => {
      // Adopted: a confirmed spec, the architecture, the design it came with, no stories, and live.
      const dir = k.repo({ 'spec/app.md': APP_SPEC, 'spec/architecture.md': '# Architecture\n', ...DESIGNED })
      k.git(dir, 'tag', 'live')
      const got = [k.stage(dir, '10 the product is live → /epikloop:plan --extend')]
      k.write(dir, 'docs/stories/12-next.md', epicFile(12, [[1, 'T1', false], [2, 'T1', false, '12.1']]))
      k.commit(dir, 'plan: epic 12', 0)
      got.push(k.stage(dir, '10 the product is live → /epikloop:epic 12'), k.expect([[k.ready(dir), '0 12.1 T1 Story 12.1\nWorker effort: T1 medium.\n']]))
      return got.flat()
    },
  ],
  [
    'after going live, each epic that lands closes with a retro before the next',
    (k) => {
      const files = { 'spec/app.md': APP_SPEC, 'spec/architecture.md': '# Architecture\n', ...DESIGNED, 'docs/queue.md': queueFile({ backlog: 1 }) }
      files['docs/stories/12-next.md'] = epicFile(12, [[1, 'T1', false], [2, 'T2', false]])
      files['docs/stories/13-then.md'] = epicFile(13, [[1, 'T1', false]])
      const dir = k.repo(files)
      k.git(dir, 'tag', 'live')
      k.commit(dir, 'feat(12.1): one', 0)
      const got = [k.stage(dir, '10 the product is live, and docs/queue.md holds 1 backlog line → /epikloop:epic 12')]
      k.commit(dir, 'feat(12.2): two', 0)
      const closing = "the product is live, and epic 12's stories are done with no phase-12 tag"
      // Once live, an epic's retro waits for its reviews too, and then for a review that is open.
      got.push(k.stage(dir, `10 ${closing}, and 12.1 and 12.2 wait for their reviews → /epikloop:epic 12`))
      k.reviewed(dir, '12.1')
      k.write(dir, 'docs/queue.md', queueFile({ questions: [['Q-001', 'nothing', 'Review 12.2']], backlog: 1 }))
      k.commit(dir, 'review(12.2): 1 finding', 0)
      got.push(k.stage(dir, `10 ${closing}, and Q-001 holds a review that is open → /epikloop:decide`))
      k.write(dir, 'docs/queue.md', queueFile({ backlog: 1 }))
      k.commit(dir, 'docs(decide): the review of 12.2', 0)
      k.remote(dir)
      got.push(k.stage(dir, `10 ${closing} → /epikloop:retro`))
      const brief = [
        '0 Retro for phase 12: epic 12, Epic 12.',
        'Its stories, for the click-through:',
        '- 12.1 Story 12.1',
        '- 12.2 Story 12.2',
        "The evidence: the deep gates, `scripts/check.sh --deep` from Bash or `node .githooks/check.mjs --deep` from PowerShell; the gates' self-test, the same with `--self-test`; the staging smoke, though .epikloop/project.json has no staging_url: the human sets it, or the record says why there is no staging; and the human's click-through of these stories on staging.",
        `The web lane: ${readLane('web').sections.Retro.replace(/\s*\n\s*/g, ' ')}`,
        'The visual compare covers 1 screen in design/manifest.md, 1 state in all, each at 390 and 1280 pixels. After the deep gates, `state.mjs --compare` lists the pairs to read, and gives the line for the record.',
        'The queue: 0 questions and 1 backlog line.',
        'Reviews since the last retro: 2 (T1 1, T2 1); 1 had findings (T2 1), 1 finding in all.',
        'Rework since the last retro: none.',
        'There are no cost rows on this machine yet.',
        'This machine has no event log, so nothing is counted for this project.',
        "Notes for Epikloop in this project's records: none.",
        'The product is live, so this retro closes epic 12 and signs nothing off.',
        'The record, in docs/decisions.md: a decision titled "Phase 12 retro", DECISION-001.',
        'Landing: one commit whose subject is "chore(phase-12): retro", holding the record, the queue and whatever else the retro changes, on main, then `git push origin main`.',
        'Once it has landed, `--retro` again prints the tags.',
        '',
      ]
      got.push(
        k.expect([
          [k.ready(dir), `0 Nothing is ready: ${closing}. Next: /epikloop:retro.\n`],
          [k.ready(dir, '13'), '0 13.1 T1 Story 13.1\nWorker effort: T1 medium.\n'],
          [k.run(dir, '--retro'), brief.join('\n')],
        ]),
      )
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 12 retro']))
      k.commit(dir, 'chore(phase-12): retro', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      got.push(
        k.stage(dir, "10 the product is live; epic 12's retro is recorded, and phase-12 isn't tagged yet → /epikloop:retro"),
        k.expect([[k.run(dir, '--retro'), "0 Recorded: Phase 12 retro in DECISION-001. What's left is the tag: `git tag phase-12`, then `git push origin phase-12`.\n"]]),
      )
      k.git(dir, 'tag', 'phase-12')
      got.push(k.stage(dir, '10 the product is live, and docs/queue.md holds 1 backlog line → /epikloop:epic 13'))
      return got.flat()
    },
  ],
  [
    'an epic that landed before going live closes with no retro',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 5: [[1, 'T1', false]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'tag', 'phase-1')
      k.git(dir, 'tag', 'mvp')
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'MVP sign-off', 'Go live later', 'Go live']))
      k.commit(dir, 'feat(5.1): planned while going live waited', 0)
      k.git(dir, 'tag', 'live')
      return k.stage(dir, '10 the product is live → /epikloop:plan --extend')
    },
  ],
  [
    'a closing ceremony waits for the reviews, then for their questions',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T3', true], [2, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 1)
      k.commit(dir, 'feat(1.2): two', 1)
      const done = "epic 1's MVP stories are done, and it has no phase-1 tag"
      const got = [k.stage(dir, `7 ${done}, and 1.1 and 1.2 wait for their reviews → /epikloop:epic 1`)]
      k.write(dir, 'docs/queue.md', queueFile({ questions: [['Q-001', 'nothing', 'Review 1.1']] }))
      k.commit(dir, 'review(1.1): 2 findings', 0)
      // Meanwhile a batch builds nothing, whatever epic it names: the stage sent it here for the
      // reviews, which it names once. A story named on its own may still start.
      const held = `0 Nothing is ready: ${done}, and 1.2 waits for its review. Next: /epikloop:epic 1.\n`
      got.push(
        k.stage(dir, `7 ${done}, and 1.2 waits for its review → /epikloop:epic 1`),
        k.expect([
          [k.ready(dir, '1'), held],
          [k.ready(dir, '2'), held],
          [k.ready(dir, '2.1'), '0 2.1 T1 Story 2.1\nWorker effort: T1 medium.\n'],
          [k.cli(dir).stdout.includes('batch runs'), false],
        ]),
      )
      k.commit(dir, 'review(1.2): no findings', 0)
      const open = `${done}, and Q-001 holds a review that is open`
      got.push(
        k.stage(dir, `7 ${open} → /epikloop:decide`),
        k.expect([
          [k.run(dir, '--retro'), `1 A retro waits: ${open}. Next: /epikloop:decide.\n`],
          [k.ready(dir), `0 Nothing is ready: ${open}. Next: /epikloop:decide.\n`],
          // A question that is open holds the ceremony, and not a batch the human names.
          [k.ready(dir, '2'), '0 2.1 T1 Story 2.1\nWorker effort: T1 medium.\n'],
        ]),
      )
      // The decision closes the review, and the retro is next.
      k.write(dir, 'docs/queue.md', queueFile())
      k.commit(dir, 'docs(decide): the review of 1.1', 0)
      got.push(k.stage(dir, `7 ${done} → /epikloop:retro`))
      return got.flat()
    },
  ],
  [
    'a story added to a closed phase is built before the sign-off',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 2)
      k.git(dir, 'tag', 'phase-1')
      k.commit(dir, 'feat(2.1): two', 1)
      k.git(dir, 'tag', 'phase-2')
      // A decision adds 1.2, a rework of 1.1, to phase 1, which is closed.
      k.write(dir, 'docs/stories/1-epic.md', epicFile(1, [[1, 'T1', true], [2, 'T1', true, '1.1', '1.1']]))
      k.commit(dir, 'docs(decide): rework 1.1', 0)
      const added = 'epic 1 is closed, and 1.2 was added to it since'
      const got = [
        k.stage(dir, `6 ${added} → /epikloop:epic 1`),
        k.expect([
          [k.ready(dir), '0 1.2 T1 Story 1.2\nWorker effort: T1 medium.\n'],
          [k.run(dir, '--retro'), `1 A retro waits: ${added}. Next: /epikloop:epic 1.\n`],
        ]),
      ]
      k.commit(dir, 'feat(1.2): the rework', 0)
      const signing = "8 every MVP epic is tagged, and the MVP isn't signed off"
      got.push(k.stage(dir, `${signing}, and 1.2 waits for its review → /epikloop:epic 1`))
      k.reviewed(dir, '1.2')
      got.push(k.stage(dir, `${signing} → /epikloop:retro`))
      // Once the product is live its planned work names such a story, as it names any other.
      const live = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }), { freeze: true })
      k.commit(live, 'feat(1.1): one', 0)
      for (const tag of ['phase-1', 'mvp', 'live']) k.git(live, 'tag', tag)
      got.push(k.stage(live, '10 the product is live → /epikloop:epic 1'))
      return got.flat()
    },
  ],
  [
    'a sign-off that is recorded, and a release, wait for a review too',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', false], [3, 'T1', false]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.git(dir, 'tag', 'phase-1')
      // 1.2 is outside the MVP set, and `story 1.2` landed it after the phase closed.
      k.commit(dir, 'feat(1.2): outside the MVP', 0)
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'MVP sign-off']))
      k.commit(dir, 'chore(mvp): sign-off', 0)
      const waits = 'and 1.2 waits for its review → /epikloop:epic 1'
      const got = [k.stage(dir, `8 the MVP sign-off is recorded, and mvp isn't tagged yet, ${waits}`)]
      k.git(dir, 'tag', 'mvp')
      // The batch the stage names runs that review, and doesn't build 1.3, which nobody asked for.
      const next = '0 1.3 T1 Story 1.3\nWorker effort: T1 medium.\n'
      got.push(
        k.stage(dir, `9 the MVP is signed off, and nothing is live yet, ${waits}`),
        k.expect([
          [k.ready(dir, '1'), '0 Nothing is ready: the MVP is signed off, and nothing is live yet, and 1.2 waits for its review. Next: /epikloop:epic 1.\n'],
          [k.ready(dir, '1.3'), next],
        ]),
      )
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro', 'MVP sign-off', 'Go live']))
      k.commit(dir, 'chore(release): go live', 0)
      got.push(k.stage(dir, `9 the go-live is recorded, and live isn't tagged yet, ${waits}`))
      k.reviewed(dir, '1.2')
      got.push(k.stage(dir, "9 the go-live is recorded, and live isn't tagged yet → /epikloop:release"), k.expect([[k.ready(dir, '1'), next]]))
      return got.flat()
    },
  ],
  [
    'a landed story waits for its review, at any tier, until a review commit names it',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T2', true], [3, 'T3', true], [4, 'T1', true]] }), { freeze: true })
      const none = k.run(dir, '--reviews')
      for (const m of [1, 2, 3]) k.commit(dir, `feat(1.${m}): story`, 0)
      const all = k.run(dir, '--reviews')
      k.commit(dir, 'review(1.2): 3 findings', 0)
      k.reviewed(dir, '1.1')
      return k.expect([
        [none, '0 No review waits.\n'],
        [all, '0 1.1 T1 Story 1.1\n1.2 T2 Story 1.2\n1.3 T3 Story 1.3\nReview effort: high.\n'],
        [k.run(dir, '--reviews'), '0 1.3 T3 Story 1.3\nReview effort: high.\n'],
        // No question stands for a landed story any more, so the report says which wait.
        [k.cli(dir).stdout.split('\n').find((line) => line.startsWith('Needs the human')), 'Needs the human: 1.3 waits for its review, which the next /epikloop:epic batch runs.'],
        [k.run(dir, '--reviews', '1'), `1 ${USAGE}\n`],
      ])
    },
  ],
  [
    "the reviews end with the reviewer's effort: the project over the user over the default",
    (k) => {
      const epics = { 1: [[1, 'T1', true], [2, 'T1', true]] }
      const project = k.repo(planned(epics), { freeze: true, marker: { effort: { review: 'max' } } })
      k.commit(project, 'feat(1.1): one', 0)
      k.config(JSON.stringify({ format: 1, effort: { review: 'low' } }))
      const over = k.run(project, '--reviews')
      // A marker's value that is no level is passed over, so the user's shows.
      const user = k.repo(planned(epics), { freeze: true, marker: { effort: { review: 'ultra' } } })
      k.commit(user, 'feat(1.1): one', 0)
      k.config(JSON.stringify({ format: 1, effort: { review: 'low' } }))
      return k.expect([
        [over, '0 1.1 T1 Story 1.1\nReview effort: max.\n'],
        [k.run(user, '--reviews'), '0 1.1 T1 Story 1.1\nReview effort: low.\n'],
      ])
    },
  ],
  [
    'reviews wait only since the last retro, and only for stories in docs/stories',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T3', true]], 2: [[1, 'T3', true], [2, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 3)
      k.git(dir, 'tag', 'phase-1')
      k.commit(dir, 'feat(2.1): two', 1)
      k.commit(dir, 'feat(9.9): a story no file holds', 1)
      const tagged = [k.run(dir, '--reviews'), k.run(dir, '--review', '1.1'), k.run(dir, '--review', '2.2'), k.run(dir, '--review', '9.9')]
      // An open review of 1.1, whose phase is closed, holds nothing once phase 2's own are settled.
      k.write(dir, 'docs/queue.md', queueFile({ questions: [['Q-001', 'nothing', 'Review 1.1']] }))
      k.commit(dir, 'feat(2.2): three', 0)
      k.reviewed(dir, '2.1', '2.2')
      const closed = k.stage(dir, "7 epic 2's MVP stories are done, and it has no phase-2 tag → /epikloop:retro")
      // A product adopted while live: what landed before the live tag is closed too.
      const live = k.repo({ 'spec/app.md': APP_SPEC, 'spec/architecture.md': '# Architecture\n', ...DESIGNED, 'docs/stories/12-next.md': epicFile(12, [[1, 'T3', false], [2, 'T1', false]]) })
      k.commit(live, 'feat(12.1): before going live', 2)
      k.git(live, 'tag', 'live')
      k.commit(live, 'feat(12.2): after', 0)
      return [
        ...closed,
        ...k.expect([
          [tagged[0], '0 2.1 T3 Story 2.1\nReview effort: high.\n'],
          [tagged[1], "1 1.1 doesn't wait for a review.\n"],
          [tagged[2], "1 2.2 doesn't wait for a review.\n"],
          [tagged[3], '1 9.9 is not a story.\n'],
          [k.run(live, '--reviews'), '0 12.2 T1 Story 12.2\nReview effort: high.\n'],
        ]),
      ]
    },
  ],
  [
    'a batch pushes its reviews together: its list reads one committed here, and the stage counts it once pushed',
    (k) => {
      const batch = (clone) => {
        const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
        k.commit(dir, 'feat(1.1): one', 0)
        k.commit(dir, 'feat(1.2): two', 0)
        k.remote(dir)
        // On a clone the default branch is the remote's, which a commit reaches only once pushed.
        if (clone) k.git(dir, 'remote', 'set-head', 'origin', 'main')
        k.reviewed(dir, '1.1')
        const got = [k.run(dir, '--reviews'), k.run(dir, '--review', '1.1')]
        k.reviewed(dir, '1.2')
        got.push(k.run(dir, '--reviews'), k.read(dir).stage.next)
        k.git(dir, 'push', '-q', 'origin', 'main')
        return [...got, k.run(dir, '--reviews'), k.read(dir).stage.next]
      }
      const wanted = (clone) => [
        '0 1.2 T1 Story 1.2\nReview effort: high.\n',
        "1 1.1 doesn't wait for a review.\n",
        '1 No review waits, and main has 2 commits that origin/main lacks; `git push origin main` lands them.\n',
        // Until the push, a clone's default branch holds neither review, so its retro still waits.
        clone ? '/epikloop:epic 1' : '/epikloop:retro',
        '0 No review waits.\n',
        '/epikloop:retro',
      ]
      return [true, false].flatMap((clone) => k.expect(batch(clone).map((got, i) => [got, wanted(clone)[i]])))
    },
  ],
  [
    'reviews start where a batch starts, and never in team mode',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.remote(dir)
      k.write(dir, 'notes.txt', 'untracked')
      const dirty = k.run(dir, '--reviews')
      fs.rmSync(path.join(dir, 'notes.txt'))
      k.git(dir, 'switch', '-q', '-c', 'side')
      const side = k.run(dir, '--reviews')
      // A review waits here to be pushed, and the remote has a commit from elsewhere: no push is
      // named, since git would refuse it.
      const apart = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }), { freeze: true })
      k.commit(apart, 'feat(1.1): one', 0)
      k.remote(apart)
      k.commit(apart, 'docs: from another machine', 0)
      k.git(apart, 'push', '-q', 'origin', 'main')
      k.git(apart, 'reset', '-q', '--hard', 'HEAD~1')
      k.reviewed(apart, '1.1')
      const diverged = k.run(apart, '--reviews')
      const team = k.repo(planned({ 1: [[1, 'T3', true]], 2: [[1, 'T1', true]] }), { freeze: true, marker: { mode: 'team' } })
      k.commit(team, 'feat(1.1): one', 0)
      return [
        ...k.expect([
          [dirty, "1 The working tree has changes that aren't committed, and a review starts from a clean tree.\n"],
          [side, '1 A review starts on main, and this checkout is on side.\n'],
          [diverged, '1 No review waits, but main and origin/main have diverged, and the human reconciles them before anything is pushed.\n'],
          [k.run(team, '--reviews'), "0 No review waits: in team mode a story's pull request is its review.\n"],
          [k.run(team, '--review', '1.1'), "1 1.1 doesn't wait for a review.\n"],
        ]),
        // And in team mode no ceremony waits for one.
        ...k.stage(team, "7 epic 1's MVP stories are done, and it has no phase-1 tag → /epikloop:retro"),
      ]
    },
  ],
  [
    "the reviewer's brief: the story, what its tier asks, its commits and the record",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T3', true], [2, 'T1', true]] }, { questions: [['Q-004', 'nothing']] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.commit(dir, 'fix(1.1): a slip', 0)
      k.commit(dir, 'feat(1.2): two', 0)
      k.remote(dir)
      const sha = (subject) => k.git(dir, 'log', '--format=%h', '-F', `--grep=${subject}`).trim()
      const [feat, fix, other] = [sha('feat(1.1)'), sha('fix(1.1)'), sha('feat(1.2)')]
      const today = ymd(Date.now())
      const fields = '"- Blocks: nothing", "- Default taken: landed as built", and "- Severity: high" as a last field when a finding is high'
      const findings = 'the findings as a numbered list, each opening with its place as `path:line`, then what happens and what it goes against'
      const t3 = k.run(dir, '--review', '1.1')
      const t1 = k.run(dir, '--review', '1.2')
      // A question that already asks for 1.2's review is the one its record goes into.
      k.write(dir, 'docs/queue.md', queueFile({ questions: [['Q-004', 'nothing'], ['Q-005', 'nothing', 'Review 1.2']] }))
      k.commit(dir, 'docs: an earlier review question', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      return [
        ...k.has(
          t3,
          '0 Review of story 1.1, from docs/stories/1-epic.md:\n\n## 1.1 Story 1.1\n- Tier: T3\n',
          'The requirements it cites:\n\nFrom spec/app.md:\n\n## REQ-APP-001 It works\n',
          'What T3 asks of its commit: the gates, evidence for each acceptance criterion, a test for each business rule its requirements quote, and negative-case tests from an adversarial reading of the change.\n',
          `Its commits, oldest first:\n- ${feat} feat(1.1): one\n- ${fix} fix(1.1): a slip\n\`git diff ${feat}~1 ${feat}\` shows what a commit changed, and the files stand as they are now.\n`,
          `The record: a question under "## Questions" in docs/queue.md, "### Q-005 Review 1.1 (${today})", then ${fields}; then ${findings}, or "The review found nothing."\n`,
          'A change that can\'t be read gets the question all the same, saying why, under the subject "review(1.1): not reviewed".\n',
          'Landing: `git add docs/queue.md`, then `git commit -m "review(1.1): 2 findings"` with the findings\' own count, or with "review(1.1): no findings". The commit holds docs/queue.md and nothing else, on main. Each command runs as it stands: the shell is already in the project\'s folder, so no `cd` and no `git -C`. It isn\'t pushed here: the batch pushes its reviews together, once none waits.\n',
        ),
        ...k.has(
          t1,
          'What T1 asks of its commit: the gates, and evidence for each acceptance criterion.\n',
          `Its commit:\n- ${other} feat(1.2): two\n`,
          `The record: with findings, a question under "## Questions" in docs/queue.md, "### Q-005 Review 1.2 (${today})", then ${fields}; then ${findings}. With none, nothing is written.\n`,
          'Landing: with findings, `git add docs/queue.md`, then `git commit -m "review(1.2): 2 findings"` with the findings\' own count; with none, `git commit --allow-empty -m "review(1.2): no findings"`. The commit holds docs/queue.md and nothing else, or nothing at all, on main. Each',
        ),
        ...k.has(k.run(dir, '--review', '1.2'), `The record: docs/queue.md already holds Q-005, which asks for this review, and its fields and its text are replaced: ${fields}; then ${findings}, or "The review found nothing."\n`),
      ]
    },
  ],
  [
    'a question marked high comes first, from the batch on',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true]] }, { questions: [['Q-001', 'nothing', 'A leak', 'high'], ['Q-002', 'nothing']] }), { freeze: true })
      const batch = k.stage(dir, '6 epic 1 has 2 MVP stories left, and Q-001 is marked high → /epikloop:decide, then /epikloop:epic 1')
      k.commit(dir, 'feat(1.1): one', 0)
      k.commit(dir, 'feat(1.2): two', 0)
      k.reviewed(dir, '1.1', '1.2')
      // Where decide is next already, nothing is added.
      const blocked = k.repo(planned({ 1: [[1, 'T1', true]] }, { questions: [['Q-001', '1.1', 'A leak', 'high']] }), { freeze: true })
      // Before the batch there is nothing to put it before.
      const early = k.repo(planned({ 1: [[1, 'T1', false]] }, { questions: [['Q-001', 'nothing', 'A leak', 'high']] }))
      return [
        ...batch,
        ...k.stage(blocked, '6 epic 1 has 1 MVP story left, and Q-001 blocks 1.1 → /epikloop:decide, then /epikloop:epic 1'),
        ...k.expect([[k.read(early).stage.next, '/epikloop:plan']]),
        ...k.has(k.cli(dir).stdout,
          // The mark is for the step the line ends with, which is still the human's to start.
          "Stage 7 of 10: epic 1's MVP stories are done, and it has no phase-1 tag, and Q-001 is marked high. Next: /epikloop:decide, then /epikloop:retro, which only the human starts.\n",
          'Needs the human: 2 questions wait in docs/queue.md, 1 marked high.\n',
          '- Q-001 A leak (2026-11-01), marked high, blocks nothing\n',
          '- Q-002 Question (2026-11-01), blocks nothing\n',
        ),
        // It puts decide first and holds nothing: the retro's brief still prints.
        ...k.has(k.run(dir, '--retro'), '0 Retro for phase 1'),
      ]
    },
  ],
  [
    'Severity and Reworks are read, and refused when malformed or not last',
    (k) => {
      const story = (m, title, ...fields) => [`## 1.${m} ${title}`, ...fields, '### Spec delta', '- none']
      const dir = k.folder({
        'docs/stories/1-one.md': [
          '# Epic 1: One',
          ...story(1, 'First', '- Tier: T1', '- MVP: yes', '- Requirements: none'),
          ...story(2, 'A rework', '- Tier: T1', '- MVP: yes', '- Requirements: none', '- After: 1.1', '- Reworks: 1.1'),
          ...story(3, 'Misplaced', '- Tier: T1', '- Reworks: 1.1', '- MVP: yes', '- Requirements: none'),
          ...story(4, 'Itself', '- Tier: T1', '- MVP: yes', '- Requirements: none', '- Reworks: 1.4'),
          ...story(5, 'No such story', '- Tier: T1', '- MVP: yes', '- Requirements: none', '- Reworks: 9.9'),
          ...story(6, 'No ID', '- Tier: T1', '- MVP: yes', '- Requirements: none', '- Reworks: the first one'),
          '',
        ].join('\n'),
        'docs/queue.md': [
          '# Queue',
          '## Questions',
          '### Q-001 High (2026-11-01)',
          '- Blocks: nothing',
          '- Default taken: a',
          '- Severity: high',
          '### Q-002 Loud (2026-11-01)',
          '- Blocks: nothing',
          '- Default taken: a',
          '- Severity: urgent',
          '### Q-003 Early (2026-11-01)',
          '- Severity: high',
          '- Blocks: nothing',
          '- Default taken: a',
          '### Q-004 Review 1.2 (2026-11-01)',
          '- Blocks: nothing',
          '- Default taken: landed as built',
          '## Backlog',
          '',
        ].join('\n'),
      })
      const s = k.read(dir)
      return [
        ...k.expect([
          [[...s.stories.values()].map((each) => `${each.id}>${each.reworks}`).join(' '), '1.1>null 1.2>1.1 1.3>1.1 1.4>null 1.5>9.9 1.6>null'],
          // A field out of place is said, and the story's other fields are still read.
          [`${s.stories.get('1.3').tier} ${s.stories.get('1.3').mvp}`, 'T1 true'],
          [s.questions.map((q) => `${q.id}>${q.severity}>${q.review}`).join(' '), 'Q-001>high>null Q-002>null>null Q-003>high>null Q-004>null>1.2'],
          [s.problems.length, 6],
        ]),
        ...k.contains(s.problems, [
          "docs/stories/1-one.md:16: 1.3's Reworks is not its last field",
          "docs/stories/1-one.md:23: 1.4's Reworks is not another story's ID",
          'docs/stories/1-one.md:30: 1.5 reworks 9.9, which is not a story',
          "docs/stories/1-one.md:37: 1.6's Reworks is not another story's ID",
          "docs/queue.md:10: Q-002's Severity is not high",
          "docs/queue.md:14: Q-003's Severity is not its last field",
        ]),
      ]
    },
  ],
  [
    "the retro's brief counts the reviews and the rework since the last retro",
    (k) => {
      const epics = { 1: [[1, 'T1', true], [2, 'T2', true], [3, 'T3', true], [4, 'T3', true], [5, 'T1', true, '1.3', '1.3']], 2: [[1, 'T1', true], [2, 'T1', true, '1.1', '1.1']] }
      const dir = k.repo(planned(epics), { freeze: true })
      for (const m of [1, 2, 3, 4, 5]) k.commit(dir, `feat(1.${m}): story`, 0)
      k.commit(dir, 'fix(1.2): a slip', 0)
      k.commit(dir, 'fix(1.2): another', 0)
      k.commit(dir, 'fix(tests): no story', 0)
      k.reviewed(dir, '1.1', '1.5')
      k.commit(dir, 'review(1.2): 1 finding', 0)
      k.commit(dir, 'review(1.3): 3 findings', 0)
      k.commit(dir, 'review(1.4): not reviewed', 0)
      // A rework story counts once, at the retro after it lands, whatever its epic: 1.2 landed
      // before phase 1 closed, and 1.3 was added to that closed phase and landed after.
      const later = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true, '1.1', '1.1'], [3, 'T1', true, '1.1', '1.1']], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(later, 'feat(1.1): one', 3)
      k.commit(later, 'feat(1.2): a rework', 2)
      k.git(later, 'tag', 'phase-1')
      k.commit(later, 'feat(1.3): a rework of the closed phase', 1)
      k.commit(later, 'feat(2.1): two', 1)
      k.reviewed(later, '1.3', '2.1')
      const laterBrief = k.run(later, '--retro')
      // Team mode has no review stage, and still counts its rework.
      const team = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true, '1.1', '1.1']], 2: [[1, 'T1', true]] }), { freeze: true, marker: { mode: 'team' } })
      k.commit(team, 'feat(1.1): one', 0)
      k.commit(team, 'feat(1.2): two', 0)
      k.commit(team, 'fix(1.1): a slip', 0)
      const teamBrief = k.run(team, '--retro')
      return [
        ...k.has(
          k.run(dir, '--retro'),
          'Reviews since the last retro: 5 (T1 2, T2 1, T3 2); 2 had findings (T2 1, T3 1), 4 findings in all; 1 could not be read.\n',
          // 2.2 reworks 1.1 too, and hasn't landed.
          'Rework since the last retro: 1 rework story landed (1.5 for 1.3), and 2 commits that fix a landed story.\n',
        ),
        ...k.has(laterBrief, '0 Retro for phase 2:', 'Rework since the last retro: 1 rework story landed (1.3 for 1.1).\n'),
        ...k.has(teamBrief, 'Rework since the last retro: 1 rework story landed (1.2 for 1.1), and 1 commit that fixes a landed story.\n'),
        ...(teamBrief.includes('Reviews since') ? [`team mode counted reviews: ${JSON.stringify(teamBrief)}`] : []),
      ]
    },
  ],
  [
    "a reviewer's rows stay out of the ETA, and show apart with the models that reviewed",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true], [3, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true, frozenAgo: 3 })
      // One worker's run of an hour, and two reviews of ten minutes each, one of them in two turns.
      k.costs({
        'cost.jsonl': [
          ['T1', 3600, 'medium', 0.4, 'w1'],
          ['T1', 300, 'high', 0.1, 'r1', true, 'claude-opus-5-5'],
          ['T1', 300, 'high', 0.1, 'r1', true, 'claude-opus-5-5'],
          ['T3', 600, 'high', 0.3, 'r2', true, 'claude-fable-5-2'],
        ],
      })
      // Four stories at an hour each, at an hour a day: four days. Were the reviews runs of T1, a
      // story would take 35 minutes, and the four of them three days.
      const gauge = k.gauge(dir, `MVP 0/4 · 0.0 stories/day · ETA ${ymd(NOW + 4 * DAY)} · queue Δ 0`, { hours_per_day: 1 })
      for (const m of [1, 2, 3]) k.commit(dir, `feat(1.${m}): story`, 0)
      k.reviewed(dir, '1.1', '1.2', '1.3')
      return [
        ...gauge,
        ...k.has(
          k.run(dir, '--retro'),
          'The cost rows on this machine:\n- T1 at medium: 1 run, 60.0 min and $0.40 each on average\n- reviews at high: 2 runs, 10.0 min and $0.25 each on average, on claude-fable-5-2 and claude-opus-5-5\n',
        ),
      ]
    },
  ],
  [
    "a scope git can't list is a problem, and holds nothing",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      // 600 fixes of 1.1 with 2,000-character subjects: their log runs past the 1 MB Node keeps of a
      // child's output, so git's answer is lost.
      k.noise(dir, 'main', 600, 'fix(1.1):')
      const s = k.read(dir)
      return [
        ...k.contains(s.problems, ["git log: the commits since the last retro can't be read, so no review is listed"]),
        ...k.expect([
          [s.problems.length, 1],
          [`${s.stage.n} ${s.stage.next}`, '7 /epikloop:retro'],
          [k.run(dir, '--reviews'), "1 No review is listed: git couldn't read the commits since the last retro.\n"],
        ]),
      ]
    },
  ],
  [
    'a product adopted while live still finishes its confirmation and its design first',
    (k) => {
      const observed = APP_SPEC.replace('## REQ-APP-001 It works\n', '## REQ-APP-001 It works\nStatus: observed\n')
      const dir = k.repo({ 'spec/app.md': observed, 'spec/architecture.md': '# Architecture\n', 'design/brief.md': '# App\n', 'design/tokens.css': ':root { --ink: #222; }\n' })
      k.git(dir, 'tag', 'live')
      const got = [k.stage(dir, '2 1 requirement in spec/ is still observed → /epikloop:adopt')]
      k.write(dir, 'spec/app.md', APP_SPEC)
      k.commit(dir, 'docs(spec): confirmed', 0)
      got.push(k.stage(dir, '3 design/tokens.css came with the product, and design/manifest.md is missing → /epikloop:design'))
      return got.flat()
    },
  ],
  [
    'a design file that loads from outside design/ is a problem, since the screens spec renders it offline',
    (k) => {
      const outside = k.read(
        k.folder({
          'spec/app.md': APP_SPEC,
          ...DESIGNED,
          'design/screens/home.html': '<!doctype html>\n<link rel="stylesheet" href="../tokens.css">\n<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">\n',
          'design/screens/lib/support.js': 'var READY = true;\nvar REACT_URL = "https://unpkg.com/react@18.3.1/umd/react.production.min.js";\n',
          'design/screens/notes.md': 'Drawn with <script src="https://example.com/brief.js"></script> once.\n',
        }),
      )
      const inside = k.read(
        k.folder({
          'spec/app.md': APP_SPEC,
          ...DESIGNED,
          'design/screens/home.html':
            '<!doctype html>\n<link rel="stylesheet" href="../tokens.css">\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n<a href="https://example.com/help">Help</a>\n<style>.a { background: url(../refs/a.png) }</style>\n',
        }),
      )
      return [
        ...k.contains(outside.problems, [
          'design/screens/home.html:3: loads https://fonts.googleapis.com/css2 from outside design/, and so does 1 more design file; the screens spec renders design files offline, so what they load belongs in design/',
        ]),
        ...k.expect([
          [outside.problems.length, 1],
          [inside.problems.join(' | '), ''],
        ]),
      ]
    },
  ],
  [
    'a repository on an earlier template layout says so first',
    (k) => {
      const earlier = k.read(k.folder({ PIPELINE_VERSION: 'v1.0.1\n', 'docs/stories/epic-1-old.md': '# Epic 1 — Old\n' }))
      const clean = k.read(k.folder({}))
      return k.expect([
        [earlier.problems[0], "PIPELINE_VERSION:1: an earlier template's version file; /epikloop:adopt's conversion removes it with that template's other files"],
        [clean.problems.join(' | '), ''],
      ])
    },
  ],
  [
    'the next epic follows the story files and every feat commit on the default branch',
    (k) => {
      const next = (n) => `The next epic is ${n}: it follows the epics in docs/stories/ and every feat(N.M) commit on the default branch.\n`
      const got = [k.has(k.run(k.repo({ 'spec/app.md': APP_SPEC }), '--ids'), next(1))]
      const dir = k.repo({ 'spec/app.md': APP_SPEC })
      k.commit(dir, "feat(11.3): an earlier layout's story", 2)
      k.commit(dir, 'feat(2.1): an earlier one', 1)
      got.push(k.has(k.run(dir, '--ids'), next(12)))
      k.write(dir, 'docs/stories/14-later.md', epicFile(14, [[1, 'T1', false]]))
      k.commit(dir, 'plan: epic 14', 0)
      got.push(k.has(k.run(dir, '--ids'), next(15)))
      return got.flat()
    },
  ],
  [
    'the design brief of a design that came with the product, and of one with directions',
    (k) => {
      const adopted = k.run(k.repo({ 'spec/app.md': APP_SPEC, 'design/brief.md': '# App\n', ...DESIGNED }), '--design')
      const drawn = k.run(k.repo({ 'spec/app.md': APP_SPEC, 'design/brief.md': '# App\n', 'design/tokens.css': ':root { --ink: #222; }\n', ...DIRECTIONS }), '--design')
      return [
        ...k.has(adopted, '\nNo directions: design/tokens.css came with the product, and amend and add follow it.\nThe tokens: design/tokens.css is written.\n'),
        ...(adopted.includes('The pick') ? [`a pick line in ${JSON.stringify(adopted)}`] : []),
        ...k.has(drawn, '\nThe directions: a.html, b.html and c.html in design/directions/.\nThe pick: not recorded; it will be DECISION-001, titled "Design direction".\n'),
        ...(drawn.includes('No directions') ? [`no directions in ${JSON.stringify(drawn)}`] : []),
      ]
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
    "a worker's rows add up to one run, folded or not",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true], [3, 'T1', true]] }), { freeze: true, frozenAgo: 3 })
      // Worker a1 took two turns, one of them folded; b1 took two, and one has no cost.
      k.costs({
        'cost.jsonl': [['T1', 1200, 'medium', 0.2, 'a1'], ['T1', 3600, 'medium', 0.4], ['T2', 3600, 'high', null, 'b1']],
        'cost/1-x-1.json': [['T1', 600, 'medium', 0.1, 'a1']],
        'cost/1-x-2.json': [['T2', 1800, 'high', 0.5, 'b1']],
      })
      // T1 runs take 0.5 h and 1 h, so the three left take 2.25 h, at 2 h a day: 2 days.
      const problems = k.gauge(dir, `MVP 0/3 · 0.0 stories/day · ETA ${ymd(NOW + 2 * DAY)} · queue Δ 0`, { hours_per_day: 2 })
      for (const m of [1, 2, 3]) k.commit(dir, `feat(1.${m}): story`, 0)
      k.reviewed(dir, '1.1', '1.2', '1.3')
      const retro = k.run(dir, '--retro')
      return [...problems, ...k.has(retro, '- T1 at medium: 2 runs, 45.0 min and $0.35 each on average\n', '- T2 at high: 1 run, 90.0 min each on average\n')]
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
        [before[0], '0 1.1 T1 Story 1.1\nWorker effort: T1 medium.\n'],
        [before[1], '0 1.1 T1 Story 1.1\nWorker effort: T1 medium.\n'],
        [before[2], '0 2.1 T1 Story 2.1\nWorker effort: T1 medium.\n'],
        [before[3], '0 1.3 T1 Story 1.3\nWorker effort: T1 medium.\n'],
        [before[4], '0 1.4 is blocked by Q-001, so it is not ready.\n'],
        [before[5], '1 9.9 is not a story.\n'],
        [k.ready(dir), '0 1.2 T2 Story 1.2\nWorker effort: T2 high.\n'],
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
        [k.ready(dir), '0 2.2 T3 Story 2.2\n10.1 T2 Story 10.1\nWorker effort: T2 high, T3 xhigh.\n'],
      ])
    },
  ],
  [
    'the ready list ends with the worker effort of each tier it lists: the project over the user over the default',
    (k) => {
      // The marker's T3 is no level, so it is passed over.
      const dir = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T2', true], [3, 'T3', true]] }), { freeze: true, marker: { effort: { T2: 'max', T3: 'ultra' } } })
      const list = '1.1 T1 Story 1.1\n1.2 T2 Story 1.2\n1.3 T3 Story 1.3\n'
      const alone = k.ready(dir)
      k.config(JSON.stringify({ format: 1, effort: { T1: 'low', T2: 'low' } }))
      const layered = [k.ready(dir), k.ready(dir, '1.2')]
      k.config('{ "effort": ')
      return k.expect([
        [alone, `0 ${list}Worker effort: T1 medium, T2 max, T3 xhigh.\n`],
        [layered[0], `0 ${list}Worker effort: T1 low, T2 max, T3 xhigh.\n`],
        [layered[1], '0 1.2 T2 Story 1.2\nWorker effort: T2 max.\n'],
        [k.ready(dir), `0 ${list}Worker effort: T1 medium, T2 max, T3 xhigh.\n`],
      ])
    },
  ],
  [
    "the worker effort's defaults are the emitter's",
    () => {
      // The two must agree, or auto mode refuses each spawn whose effort the emitter then changes.
      const emitter = fs.readFileSync(path.join(import.meta.dirname, '..', 'hooks', 'emit.js'), 'utf8')
      const theirs = /^const EFFORT = (\{.+\})$/m.exec(emitter)?.[1]
      const ours = `{ ${Object.entries(WORKER_EFFORT).map(([tier, level]) => `${tier}: '${level}'`).join(', ')} }`
      return theirs === ours ? [] : [`hooks/emit.js sets ${theirs}, and the ready list prints ${ours}`]
    },
  ],
  [
    'nothing is ready, and why',
    (k) => {
      const blocked = k.repo(planned({ 1: [[1, 'T1', true], [2, 'T1', true, '1.1']] }, { questions: [['Q-001', '1.1']] }), { freeze: true })
      const retro = k.repo(planned({ 1: [[1, 'T1', true]] }), { freeze: true })
      k.commit(retro, 'feat(1.1): one', 0)
      k.reviewed(retro, '1.1')
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
        [local[0], '0 1.3 T1 Story 1.3\nWorker effort: T1 medium.\n'],
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
        `A parked question goes under "## Questions" in docs/queue.md as "### Q-012 Title (${today})", numbered on from there, then "- Blocks:" with the stories it blocks or "nothing", "- Default taken:" with the default the work goes on with, "- Severity: high" as a last field when money or data can be lost or someone can see or do what they shouldn't, and the question itself.`,
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
        [k.run(dir, '--ids'), `0 ${[...ids, 'The next epic is 4: it follows the epics in docs/stories/ and every feat(N.M) commit on the default branch.'].join('\n')}\n`],
        [k.run(dir, '--story', '9.9'), '1 9.9 is not a story.\n'],
        [k.run(dir, '--story', '3'), `1 ${USAGE}\n`],
      ])
    },
  ],
  [
    "the brief names the screens that show the story's requirements, and only those",
    (k) => {
      const dir = k.repo({
        'spec/checkout.md': k.template('spec/capability.md'),
        'docs/stories/3-checkout.md': k.template('docs/stories/epic.md'),
        'design/manifest.md': k.template('design/manifest.md'),
      })
      const head = 'The screens that show its requirements, from design/manifest.md, each drawn at 390 and 1280 pixels:'
      const block = (line) => `\n${head}\n\n${line}\n\nThe web lane:\n`
      const cart = k.run(dir, '--story', '3.1')
      const signIn = k.run(dir, '--story', '3.2')
      const none = k.run(dir, '--story', '3.3')
      return [
        ...k.has(cart, block('- cart (Cart): default, empty, loading and error, in design/screens/cart.html, design/screens/cart.empty.html, design/screens/cart.loading.html and design/screens/cart.error.html')),
        ...k.has(signIn, block('- sign-in (Sign in): default and error, in design/screens/sign-in.html and design/screens/sign-in.error.html')),
        ...(none.includes(head) ? ['3.3, which cites no requirement, was given screens'] : []),
        ...(cart.includes('sign-in') ? ["3.1's brief names sign-in, which shows none of its requirements"] : []),
      ]
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
      k.reviewed(dir, '1.1', '1.2')
      k.remote(dir)
      k.costs({ 'cost.jsonl': [['T1', 1800, 'medium', 0.2], ['T1', 3600, 'medium', 0.4], ['T2', 3600, 'high']], 'cost/1-x-1.json': [['T1', 600, 'low', 0.1]] })
      const brief = [
        '0 Retro for phase 1: epic 1, Epic 1.',
        'Its stories, for the click-through:',
        '- 1.1 Story 1.1',
        '- 1.2 Story 1.2',
        "The evidence: the deep gates, `scripts/check.sh --deep` from Bash or `node .githooks/check.mjs --deep` from PowerShell; the gates' self-test, the same with `--self-test`; the staging smoke against https://staging.example.com/; and the human's click-through of these stories on staging.",
        `The web lane: ${readLane('web').sections.Retro.replace(/\s*\n\s*/g, ' ')}`,
        'The visual compare covers 1 screen in design/manifest.md, 1 state in all, each at 390 and 1280 pixels. After the deep gates, `state.mjs --compare` lists the pairs to read, and gives the line for the record.',
        'The queue: 1 question and 2 backlog lines; queue Δ 0 since the MVP set was frozen.',
        'Reviews since the last retro: 2 (T1 1, T2 1); none had findings.',
        'Rework since the last retro: none.',
        'The cost rows on this machine:',
        '- T1 at low: 1 run, 10.0 min and $0.10 each on average',
        '- T1 at medium: 2 runs, 45.0 min and $0.30 each on average',
        '- T2 at high: 1 run, 60.0 min each on average',
        'This machine has no event log, so nothing is counted for this project.',
        "Notes for Epikloop in this project's records: none.",
        'The record, in docs/decisions.md: a decision titled "Phase 1 retro", DECISION-002.',
        'Landing: one commit whose subject is "chore(phase-1): retro", holding the record, the queue and whatever else the retro changes, on main, then `git push origin main`.',
        'Once it has landed, `--retro` again prints the tags.',
        '',
      ]
      return k.expect([[k.run(dir, '--retro'), brief.join('\n')]])
    },
  ],
  [
    'the retro brief has no visual compare for a project planned without a design',
    (k) => {
      const files = planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] })
      for (const file of Object.keys(DESIGNED)) delete files[file]
      const dir = k.repo(files, { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.reviewed(dir, '1.1')
      const brief = k.run(dir, '--retro')
      return [...k.has(brief, '0 Retro for phase 1'), ...(brief.includes('The visual compare covers') ? [`gave ${JSON.stringify(brief)}`] : [])]
    },
  ],
  [
    "the final phase's retro is also the sign-off, and tags only once its record lands",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]] }, { backlog: 1 }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.reviewed(dir, '1.1')
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
      k.write(dir, 'docs/decisions.md', decisionsFile(['MVP sign-off', 'Go live later']))
      k.commit(dir, 'chore(release): go live later', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      const waiting = k.run(dir, '--release')
      k.write(dir, 'docs/decisions.md', decisionsFile(['MVP sign-off', 'Go live later', 'Go live']))
      k.commit(dir, 'chore(release): go live', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      const going = (next) => [
        'Staging: https://staging.example.com/.',
        'The hosting: spec/architecture.md says how staging is hosted, and production follows it.',
        "The evidence: the production smoke, the same script given production's URL, once the build the mvp tag marks is promoted.",
        `The record: spec/architecture.md gains how production runs, how a build is promoted to it and how it is rolled back; and a decision in docs/decisions.md titled "Go live", ${next}, whose implementation note holds the post-launch checklist.`,
        'Landing: one commit whose subject is "chore(release): go live", holding the record and any production configuration, on main, then `git push origin main`.',
        'Once it has landed, `--release` again prints the `live` tag.',
      ]
      const wanted = [
        '0 Release: the MVP is signed off, and nothing is live yet.',
        ...going('DECISION-001'),
        'When the human says production comes later, nothing is set up or promoted: the record is instead a decision titled "Go live later", DECISION-001, saying what going live waits for, and until the release the planned work runs first.',
        'Landing: one commit whose subject is "chore(release): go live later", holding that record, on main, then `git push origin main`.',
        '',
      ]
      const waits = [
        '0 Release: the MVP is signed off, and going live waits, as DECISION-002 records.',
        ...going('DECISION-003'),
        'If going live still waits, nothing is set up or recorded: DECISION-002 stands, and the release ends there.',
        '',
      ]
      return k.expect([
        [brief, wanted.join('\n')],
        [waiting, waits.join('\n')],
        [k.run(dir, '--release'), "0 Recorded: Go live in DECISION-003. What's left is the tag: `git tag live`, then `git push origin live`.\n"],
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
      const good = { format: 1, name: 'x', description: 'a kind of product', requires: ['npx'], ui_test: { tool: 'T', package: 'p', allow: ['npx t run'] }, design: { widths: [390, 1280] }, sections: { Plan: 'p' } }
      const widths = 'has a design without its two widths, narrow first'
      // A lane that says where its screens spec writes its pictures, in its profile and its text.
      const rendered = { ...good, design: { widths: [390, 1280], renders: 'out/screens' }, sections: { Story: 'The spec writes `out/screens/<screen>.png`.' } }
      const folder = 'has a design whose renders is not a folder inside the project'
      const bad = [
        [{ ...rendered, design: { ...rendered.design, renders: '../screens' } }, folder],
        [{ ...rendered, design: { ...rendered.design, renders: '/tmp/screens' } }, folder],
        [{ ...rendered, design: { ...rendered.design, renders: 'out/screens/' } }, folder],
        [{ ...rendered, design: { ...rendered.design, renders: 7 } }, folder],
        [{ ...rendered, sections: { Story: 'The spec writes `shots/<screen>.png`.' } }, "has a design whose renders, out/screens, its fragment doesn't name"],
        [{ ...good, name: 'y' }, 'is named "y", not x'],
        [{ ...good, design: undefined }, widths],
        [{ ...good, design: { widths: [1280, 390] } }, widths],
        [{ ...good, design: { widths: [390] } }, widths],
        [{ ...good, design: { widths: [390.5, 1280] } }, widths],
        [{ ...good, design: { widths: [390, 1280], heights: [844] } }, widths],
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
          [JSON.stringify(readLane('web').design), '{"widths":[390,1280],"renders":"test-results/screens"}'],
          [readLane('service').design, null],
          [laneProblem(good, 'x'), null],
          [laneProblem(rendered, 'x'), null],
          [laneProblem({ ...good, design: null }, 'x'), null],
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
      k.reviewed(ceremony, '1.1')
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
  [
    'the CLI runs from a path through a link, as a plugin behind a symlink does',
    (k) => {
      // The link points at a copy of the plugin, so nothing that removes the link can reach the
      // plugin itself. A junction is Windows' link that needs no privilege; elsewhere it is a symlink.
      const dir = k.folder()
      const copy = path.join(dir, 'plugin')
      fs.cpSync(path.join(import.meta.dirname, '..'), copy, { recursive: true })
      const link = path.join(dir, 'linked')
      fs.symlinkSync(copy, link, 'junction')
      const linked = k.cli(dir, ['--lanes'], path.join(link, 'scripts', 'state.mjs'))
      return k.expect([[`${linked.status} ${linked.stdout}`, `0 ${k.cli(dir, ['--lanes']).stdout}`]])
    },
  ],
  [
    'a record may carry notes for Epikloop, any number of them, wherever they stand in its entry',
    (k) => {
      const fields = ['- Context: c', '- Decision: d', '- Rejected: r', '- Trade-offs: t', '- Implementation note: n']
      const dir = k.folder({
        'docs/decisions.md': [
          '# Decisions',
          '',
          '## DECISION-001 Stack (2026-11-11)',
          ...fields,
          '',
          '## DECISION-002 Phase 1 retro (2026-11-12)',
          ...fields,
          '- Epikloop: the push gate ran every test for a commit that changed only docs.',
          '- Epikloop: the cap cut the build off twice.',
          '- Epikloop: ',
          '',
          // A retro writes its notes last, and one written first reads too.
          '## DECISION-003 Phase 2 retro (2026-11-13)',
          '- Epikloop: nothing waited.',
          ...fields,
          '',
          '## DECISION-004 Twice (2026-11-14)',
          ...fields,
          '- Context: again',
          '',
          // A line the reader doesn't know ends the fields, and the notes after it still read, as
          // does one that sits under another line.
          '## DECISION-005 Phase 3 retro (2026-11-15)',
          ...fields,
          '- MVP sign-off: left unsigned.',
          '- Epikloop: the brief asks for staging where there is none.',
          '',
          'More, in prose.',
          '  - Epikloop: a note under another line.',
          '',
        ].join('\n'),
      })
      const s = k.read(dir)
      return k.expect([
        [s.problems.filter((problem) => problem.startsWith('docs/decisions.md')).join(' | '), 'docs/decisions.md:34: DECISION-004 has a second Context'],
        [s.decisions.map((d) => `${d.id} ${d.date} ${d.notes.length}`).join(', '), 'DECISION-001 2026-11-11 0, DECISION-002 2026-11-12 2, DECISION-003 2026-11-13 1, DECISION-004 2026-11-14 0, DECISION-005 2026-11-15 2'],
        [s.decisions[1].notes.join(' / '), 'the push gate ran every test for a commit that changed only docs. / the cap cut the build off twice.'],
        [s.decisions[4].notes.join(' / '), 'the brief asks for staging where there is none. / a note under another line.'],
      ])
    },
  ],
  [
    "a record's fields are read wherever they stand in its entry",
    (k) => {
      const dir = k.folder({
        'docs/decisions.md': [
          '# Decisions',
          '',
          // A labelled line the format doesn't name, lines set under a field and a blank line stand
          // between the fields.
          '## DECISION-001 Phase 1 retro (2026-11-11)',
          '- Answers: Q-007',
          '- Context: c',
          '- Decision: d',
          '- Evidence: the smoke passed.',
          '  - one line of it',
          '  - Rejected: a line set under another is no field',
          '',
          '- Rejected: r',
          'Prose between the fields.',
          '- Trade-offs: t',
          '- Implementation note: n',
          '',
          // A field that isn't there is still missing, whatever else the entry holds.
          '## DECISION-002 Short (2026-11-12)',
          '- Context: c',
          '- Reviews: none waited.',
          '- Decision: d',
          '- Trade-offs: t',
          '- Implementation note: n',
          '',
          // A field given twice is still a problem, with other lines between the two.
          '## DECISION-003 Twice (2026-11-13)',
          '- Context: c',
          '- Decision: d',
          '- Rejected: r',
          '- Trade-offs: t',
          '- Implementation note: n',
          '',
          'More, in prose.',
          '- Decision: again',
          '',
          // The fields of one entry are not read into the entry before it.
          '## DECISION-004 Empty (2026-11-14)',
          '',
          '## DECISION-005 Whole (2026-11-15)',
          '- Context: c',
          '- Decision: d',
          '- Rejected: r',
          '- Trade-offs: t',
          '- Implementation note: n',
          '',
        ].join('\n'),
      })
      const s = k.read(dir)
      const missing = ['Context', 'Decision', 'Rejected', 'Trade-offs', 'Implementation note'].map((field) => `docs/decisions.md:33: DECISION-004 has no ${field}`)
      return k.expect([
        [
          s.problems.filter((problem) => problem.startsWith('docs/decisions.md')).join(' | '),
          ['docs/decisions.md:16: DECISION-002 has no Rejected', 'docs/decisions.md:31: DECISION-003 has a second Decision', ...missing].join(' | '),
        ],
        [s.decisions.map((d) => `${d.id} ${d.answers}`).join(', '), 'DECISION-001 Q-007, DECISION-002 null, DECISION-003 null, DECISION-004 null, DECISION-005 null'],
      ])
    },
  ],
  [
    "the retro's brief gives what the machine's log counted since the last retro, and collects the notes for Epikloop",
    (k) => {
      const files = planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] })
      files['docs/decisions.md'] = `${decisionsFile(['Stack', 'Phase 1 retro'])}- Epikloop: the cap cut the build off twice.\n`
      const dir = k.repo(files, { freeze: true, frozenAgo: 9, marker: { gates: { cap_minutes: 20 } } })
      k.commit(dir, 'feat(1.1): one', 8)
      k.commit(dir, 'review(1.1): no findings', 6)
      k.commit(dir, 'chore(phase-1): retro', 5)
      k.git(dir, 'tag', 'phase-1')
      // A branch of the tag's name, beside which git's short form calls the tag tags/phase-1.
      k.git(dir, 'branch', 'phase-1')
      k.commit(dir, 'feat(2.1): two', 2)
      k.commit(dir, 'review(2.1): no findings', 1)
      // A newer tag that closes no phase, which the counts don't start from.
      k.git(dir, 'tag', 'checkpoint')
      k.remote(dir)
      const home = k.homeDir()
      const at = (days, hours = 0) => new Date(NOW - days * DAY + hours * 3_600_000).toISOString()
      const event = (ts, kind, fields) => `${JSON.stringify({ format: 1, ts, project_id: MARKER.id, cwd: dir, session_id: 's', kind, ...fields })}\n`
      // The day before the last retro, which doesn't count, and a day since.
      k.write(home, `.epikloop/events/${at(6).slice(0, 10)}.jsonl`, event(at(6), 'tool.post', { tool: 'Agent', detail: { is_error: true } }))
      k.write(
        home,
        `.epikloop/events/${at(2).slice(0, 10)}.jsonl`,
        [
          event(at(2), 'gate.started', { detail: { mode: 'full', run: 'r1' } }),
          event(at(2, 1), 'gate.failed', { state: 'test', detail: { mode: 'full', run: 'r1', ms: 1_150_000 } }),
          event(at(2, 2), 'tool.post', { tool: 'Agent', detail: { is_error: false } }),
          event(at(2, 3), 'tool.post', { tool: 'Agent', detail: { is_error: true } }),
          event(at(2, 4), 'notification', { detail: { notification_type: 'permission_prompt' } }),
        ].join(''),
      )
      const state = k.read(dir)
      const brief = retroBrief(state, k.project, batchFacts(dir), retroExtras(dir, k.project, state, { now: NOW, home })).text
      const notes = path.join(home, '.epikloop', 'projects', MARKER.id, 'notes.md')
      const collected = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8').trimEnd().split('\n').at(-1) : 'no file'
      return [
        ...k.has(
          `${brief}\n`,
          "\nThis machine's event log for this project, since the phase-1 tag: 1 gate run, 0 with no result; the longest gate command was test, 1150 s of its 1200; 0 s waited for other gate runs; 2 Agent calls, 1 answered with an error; 1 permission prompt.\n",
          `\nNotes for Epikloop in this project's records: 1, collected in ${notes}. Sending them as an issue is the human's: https://github.com/Yheng/Epikloop/issues.\n`,
        ),
        ...k.expect([[collected, '- 2026-11-10 · DECISION-002 Phase 1 retro · the cap cut the build off twice.']]),
      ]
    },
  ],
  [
    'once its record has landed, the retro names the notes it carries, beside the tags',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.reviewed(dir, '1.1')
      k.remote(dir)
      k.write(dir, 'docs/decisions.md', `${decisionsFile(['Phase 1 retro'])}- Epikloop: the briefing took four seconds.\n`)
      k.commit(dir, 'chore(phase-1): retro', 0)
      k.git(dir, 'push', '-q', 'origin', 'main')
      const notes = path.join(k.homeDir(), '.epikloop', 'projects', MARKER.id, 'notes.md')
      return k.expect([
        [
          k.run(dir, '--retro'),
          `0 Recorded: Phase 1 retro in DECISION-001. What's left is the tag: \`git tag phase-1\`, then \`git push origin phase-1\`.\nNotes for Epikloop in this project's records: 1, collected in ${notes}. Sending them as an issue is the human's: https://github.com/Yheng/Epikloop/issues.\n`,
        ],
        [fs.existsSync(notes), true],
      ])
    },
  ],
  [
    '--compare lists the pictures a retro reads, against the list the last landed record names',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true, frozenAgo: 5 })
      k.write(dir, '.gitignore', 'test-results/\n')
      k.commit(dir, 'feat(1.1): one', 4)
      const none = k.run(dir, '--compare')
      for (const width of [390, 1280]) for (const kind of ['app', 'design']) k.png(dir, `home.default.${width}.${kind}.png`, [width, 800])
      const first = k.run(dir, '--compare')
      const code = /\(snapshot ([0-9a-f]{8})\)/.exec(first)?.[1]
      const saved = path.join(k.homeDir(), '.epikloop', 'projects', MARKER.id, 'compare', `${code}.json`)
      // The retro's record lands with the compare's line, and the phase is tagged.
      k.write(dir, 'docs/decisions.md', decisionsFile(['Phase 1 retro']).replace('- Decision: d', `- Decision: d. Visual compare: 2 read, 0 unchanged, 0 changed and not read, 0 not rendered (snapshot ${code}).`))
      k.commit(dir, 'chore(phase-1): retro', 3)
      k.git(dir, 'tag', 'phase-1')
      const same = k.run(dir, '--compare')
      // A picture changes at its size while no story of the phase names its screen.
      k.png(dir, 'home.default.1280.app.png', [1280, 800], 3)
      const drifted = k.run(dir, '--compare')
      // Asked for all, the compare lists that pair to read too. No record takes its line here, so
      // nothing below trusts its list.
      const all = k.run(dir, '--compare', 'all')
      const allCode = /\(snapshot ([0-9a-f]{8})\)/.exec(all)?.[1]
      // Then a fix for 1.1 lands, whose requirement the screen shows, and the other picture changes
      // in size.
      k.commit(dir, 'fix(1.1): the greeting', 2)
      k.png(dir, 'home.default.390.app.png', [390, 640])
      const changed = k.run(dir, '--compare')
      const next = /\(snapshot ([0-9a-f]{8})\)/.exec(changed)?.[1]
      // A later record lands with that compare's line, and is the one trusted from then on.
      const records = () => fs.readFileSync(path.join(dir, 'docs', 'decisions.md'), 'utf8')
      const line = /Visual compare: [^"\n]*\(snapshot [0-9a-f]{8}\)/.exec(changed)?.[0]
      k.write(dir, 'docs/decisions.md', `${records()}\nThe compare after the fix. ${line}.\n`)
      k.commit(dir, 'docs: a later record', 1)
      const later = k.run(dir, '--compare')
      // A code that a landed record only mentions, as a note might, names no list. The note also
      // holds a byte that makes git take the file for no text, which hides no line from the compare.
      k.write(dir, 'docs/decisions.md', `${records()}- Epikloop: the compare before it, (snapshot ${code}), was the first.\u0000\n`)
      k.commit(dir, 'docs: a mention', 0)
      const mentioned = k.run(dir, '--compare')
      // A record that hasn't landed carries another compare's line, which nothing trusts yet.
      k.write(dir, 'docs/decisions.md', `${records()}Visual compare: 2 read, 0 unchanged, 0 changed and not read, 0 not rendered (snapshot ${code}).\n`)
      const unlanded = k.run(dir, '--compare')
      const against = `0 The visual compare, against what the retro whose record names snapshot ${code} read on this machine.\n`
      const againstNext = `0 The visual compare, against what the retro whose record names snapshot ${next} read on this machine.\n`
      const nothing = 'Nothing to read: no picture is new or changed where a retro reads it.\n'
      const service = k.repo(planned({ 1: [[1, 'T1', true]] }), { marker: { lane: 'service' } })
      const undrawn = k.repo({ 'spec/app.md': APP_SPEC })
      return [
        ...k.expect([
          [none, "1 No picture is in test-results/screens/, where the deep gates' e2e run writes them.\n"],
          [fs.existsSync(saved), true],
          [k.run(service, '--compare'), '1 The service lane has no pictures to compare.\n'],
          [k.run(undrawn, '--compare'), '1 The visual compare waits for the design: design/manifest.md is missing.\n'],
          [k.run(dir, '--compare', 'every'), `1 ${USAGE}\n`],
        ]),
        ...k.has(
          first,
          '0 The visual compare: no landed record names a snapshot yet, so every pair is read.\nRead these 2, each app picture beside its design picture, in test-results/screens/:\n- home, new: default.390, default.1280\nThe pictures were written from ',
          `\nFor the record: "Visual compare: 2 read, 0 unchanged, 0 changed and not read, 0 not rendered (snapshot ${code})."\n`,
        ),
        ...(first.includes('older than the last commit') ? ['pictures written today were called older than a commit of days ago'] : []),
        ...k.has(same, `${against}${nothing}Not read: 2 unchanged since a retro last read them.\n`),
        ...k.has(
          drifted,
          `${against}${nothing}Not read: 1 unchanged since a retro last read them; 1 changed at the same size on screens no story or fix of this phase names, which stay listed until a retro reads them (home).\n\`state.mjs --compare all\` lists every changed pair to read, for a retro that reads those too.\n`,
        ),
        ...k.has(
          all,
          `${against}Read these 1, each app picture beside its design picture, in test-results/screens/:\n- home, changed: default.1280\nNot read: 1 unchanged since a retro last read them.\nThe pictures were written from `,
          `\nFor the record: "Visual compare: 1 read, 1 unchanged, 0 changed and not read, 0 not rendered (snapshot ${allCode})."\n`,
        ),
        ...(allCode !== undefined && allCode !== code ? [] : [`the compare of all names ${allCode}`]),
        ...k.has(changed, `${against}Read these 2, each app picture beside its design picture, in test-results/screens/:\n- home, resized: default.390 from 390x800 to 390x640\n- home, changed, and 1.1 names it: default.1280\n`),
        ...(next !== undefined && next !== code ? [] : [`the compare after the fix names ${next}`]),
        ...k.has(later, `${againstNext}${nothing}Not read: 2 unchanged since a retro last read them.\n`),
        ...k.has(mentioned, againstNext),
        ...k.has(unlanded, againstNext),
      ]
    },
  ],
  [
    "a batch's and a retro's calls fold the emitter's files from the days before today, and a row a fold left twice counts once",
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', true]] }), { freeze: true })
      k.commit(dir, 'feat(1.1): one', 0)
      k.reviewed(dir, '1.1')
      k.remote(dir)
      const home = k.homeDir()
      const row = JSON.stringify({ format: 1, ts: '2026-11-01T10:00:00.000Z', story: '1.1', tier: 'T1', agent: 'a1', wall: 600, cost: 0.1, model: 'm', effort: 'medium' })
      const costs = path.join(home, '.epikloop', 'projects', MARKER.id)
      // A fold that died between its append and its delete left this row in both places.
      k.write(costs, 'cost.jsonl', `${row}\n`)
      k.write(costs, 'cost/1792576800000-8d1e5c2a-1.json', `${row}\n`)
      const day = (name) => path.join(home, '.epikloop', 'events', name)
      const stop = `${JSON.stringify({ format: 1, kind: 'stop' })}\n`
      k.write(day('2026-10-20'), '1792576800000-8d1e5c2a-1.json', stop)
      const line = '- T1 at medium: 1 run, 10.0 min and $0.10 each on average\n'
      // An eval's session leaves the machine's files as they are.
      const asEval = k.cli(dir, ['--retro'], undefined, { EPIKLOOP_EVAL: '1' }).stdout
      const kept = fs.existsSync(day('2026-10-20')) && fs.readdirSync(path.join(costs, 'cost')).length === 1
      const brief = k.run(dir, '--retro')
      // The retro's own call folded the day, before a batch's call could.
      const atRetro = !fs.existsSync(day('2026-10-20')) && fs.existsSync(`${day('2026-10-20')}.jsonl`)
      k.write(day('2026-10-21'), '1792576800000-8d1e5c2a-1.json', stop)
      k.ready(dir, '2.1')
      return [
        ...k.has(asEval, line),
        ...k.has(brief, line),
        ...k.expect([
          [kept, true],
          [atRetro, true],
          [fs.existsSync(day('2026-10-20')), false],
          [fs.readFileSync(`${day('2026-10-20')}.jsonl`, 'utf8'), stop],
          [fs.readFileSync(path.join(costs, 'cost.jsonl'), 'utf8'), `${row}\n${row}\n`],
          [fs.existsSync(day('2026-10-21')), false],
          [fs.existsSync(`${day('2026-10-21')}.jsonl`), true],
        ]),
      ]
    },
  ],
  [
    "a cost file that can't be read costs only itself, and the rows after it still count",
    (k) => {
      // A folder makes this case a home of its own.
      k.folder()
      const [home, id] = [k.homeDir(), MARKER.id]
      const costs = path.join(home, '.epikloop', 'projects', id)
      const row = (agent, wall) => `${JSON.stringify({ format: 1, ts: `2026-11-01T10:0${wall / 600}:00.000Z`, story: '1.1', tier: 'T1', agent, wall, cost: 0.1, model: 'm', effort: 'medium' })}\n`
      k.write(costs, 'cost/1792576800000-8d1e5c2a-1.json', row('a1', 600))
      // Another session's fold took this one between the listing and the read: here, a folder of
      // its name stands in for it.
      fs.mkdirSync(path.join(costs, 'cost', '1792576800001-8d1e5c2a-2.json'))
      k.write(costs, 'cost/1792576800002-8d1e5c2a-3.json', row('a2', 1200))
      return k.expect([[costRows(home, id).map((each) => `${each.agent} ${each.wall}`).join(', '), 'a1 600, a2 1200']])
    },
  ],
  [
    "--design says which model draws: the user's choice over the project's, and a value that is no name is passed over",
    (k) => {
      const dir = k.repo({ 'spec/app.md': APP_SPEC }, { marker: { model: { design: 'opus' } } })
      const drawing = (env = {}) =>
        designBrief(k.read(dir), k.project, { home: k.homeDir(), env })
          .text.split('\n')
          .filter((line) => line.startsWith('The drawing model'))
          .join(' | ')
      const project = drawing()
      k.config('{"format":1,"model":{"design":"fable"}}')
      const user = drawing()
      const asEval = drawing({ EPIKLOOP_EVAL: '1' })
      const cli = k.run(dir, '--design')
      k.config('{"format":1,"model":{"design":"Fable 5.2"}}')
      const passed = drawing()
      k.config('{"format":1,"model":')
      const broken = drawing()
      const byProject = 'The drawing model: opus, which .epikloop/project.json sets.'
      return k.expect([
        [project, byProject],
        [user, 'The drawing model: fable, which the human set in ~/.epikloop/config.json.'],
        [asEval, byProject],
        [cli.includes('\nThe drawing model: fable, which the human set in ~/.epikloop/config.json.\n'), true],
        [passed, `The drawing model "Fable 5.2" in ~/.epikloop/config.json is no model name, a lowercase word such as fable, so it is passed over. | ${byProject}`],
        [broken, byProject],
      ])
    },
  ],
]

async function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'epikloop-state-'))
  const globalConfig = path.join(temp, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Self Test\n\temail = self-test@example.com\n[init]\n\tdefaultBranch = main\n')
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:GIT_.*|HOME|USERPROFILE|EPIKLOOP_EVAL)$/i.test(key)) env[key] = value
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
    // A review commit for each story, as a reviewer that found nothing in a T1 or T2 story leaves.
    reviewed(dir, ...ids) {
      for (const id of ids) k.commit(dir, `review(${id}): no findings`, 0)
    },
    // `count` empty commits on `branch`, each with a 2,000-character subject that starts with
    // `prefix`, made at once by fast-import: enough to take a log of them past Node's 1 MB.
    noise(dir, branch, count, prefix = 'chore:') {
      const tip = k.git(dir, 'rev-parse', branch).trim()
      const when = Math.floor((NOW - DAY) / 1000)
      let stream = ''
      for (let n = 1; n <= count; n += 1) {
        const message = `${prefix} ${'n'.repeat(2000)} ${n}\n`
        stream += `commit refs/heads/${branch}\ncommitter Self Test <self-test@example.com> ${when} +0000\ndata ${message.length}\n${message}${n === 1 ? `from ${tip}\n` : ''}\n`
      }
      const run = spawnSync('git', ['fast-import', '--quiet'], { cwd: dir, env, input: stream, encoding: 'utf8', windowsHide: true })
      if (run.status !== 0) throw new Error(`fast-import: ${run.stderr.trim()}`)
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
        const line = ([tier, wall, effort = 'medium', cost = null, agent, review, model = null]) => JSON.stringify({ format: 1, story: '9.9', tier, agent, wall, cost, model, effort, ...(review ? { review: true } : {}) })
        k.write(dir, file, rows.map(line).join('\n') + '\n')
      }
    },
    // The user's settings in this case's home, as text.
    config: (text) => k.write(home, '.epikloop/config.json', text),
    // This case's home.
    homeDir: () => home,
    // A picture in the web lane's folder, as its screens spec names one: a PNG's opening with its
    // size, [width, height], and `seed` to tell two of a size apart.
    png(dir, name, [width, height], seed = 1) {
      const bytes = Buffer.alloc(37)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
      bytes.writeUInt32BE(13, 8)
      bytes.write('IHDR', 12, 'latin1')
      bytes.writeUInt32BE(width, 16)
      bytes.writeUInt32BE(height, 20)
      bytes.writeUInt32BE(seed, 33)
      k.write(dir, `test-results/screens/${name}`, bytes)
    },
    read: (dir, fields = {}) => readState(dir, { ...(k.project ?? MARKER), ...fields }, { now: NOW, home }),
    // The CLI, run as a skill runs it, from `cwd`, with this case's home, and `more` in its
    // environment.
    cli: (cwd, args = [], script = import.meta.filename, more = {}) =>
      spawnSync(process.execPath, [script, ...args], { cwd, env: { ...env, HOME: home, USERPROFILE: home, ...more }, encoding: 'utf8', windowsHide: true }),
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

if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {
  if (process.argv[2] === '--self-test') await selfTest()
  else cli(process.argv.slice(2))
}
