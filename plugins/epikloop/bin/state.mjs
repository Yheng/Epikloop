// Epikloop's reader of a project's state. It parses the four project files in their formats
// (docs/formats.md) and reads git, then derives what the stage machine and the fuel gauge need:
// which stories are done, the current phase, the stage and its next step, and the gauge. Nothing
// is stored; every read derives it again. The briefing imports it.
//
// `node state.mjs --self-test` runs every case below against throwaway repositories.
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
      requirements.set(id, { id, file: rel, status })
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
    if (title === -1 || !new RegExp(`^# Epic ${epic}: \\S`).test(lines[title])) {
      problems.push(`${rel}:${title + 1 || 1}: it doesn't open with "# Epic ${epic}: Title"`)
    }
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
          story = { id, epic, file: rel, line: i + 1, fields: {}, delta: false }
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
      const fields = {}
      i = readFields(lines, i + 1, ['Blocks', 'Default taken'], fields, (at, what) => report(at, `${heading[1]} ${what}`)) - 1
      for (const field of ['Blocks', 'Default taken']) {
        if (fields[field] === undefined) report(i + 1, `${heading[1]} has no ${field}`)
      }
      const blocks = fields.Blocks === undefined || fields.Blocks === 'nothing' ? [] : list(fields.Blocks)
      for (const id of blocks) {
        if (!STORY.test(id) || (stories !== null && !stories.has(id))) report(i + 1, `${heading[1]} blocks ${id}, which is not a story`)
      }
      questions.push({ id: heading[1], title: heading[2], date: heading[3], blocks })
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
    const heading = new RegExp(`^## (DECISION-\\d{3,}) \\S.* \\(${DATE}\\)$`).exec(lines[i].trim())
    if (heading === null) {
      problems.push(`${rel}:${i + 1}: "${lines[i]}" is not "## DECISION-NNN Title (YYYY-MM-DD)"`)
      continue
    }
    const id = heading[1]
    if (decisions.includes(id)) problems.push(`${rel}:${i + 1}: ${id} appears twice`)
    const fields = {}
    readFields(lines, i + 1, ['Answers', ...required], fields, (at, what) => problems.push(`${rel}:${at}: ${id} ${what}`))
    for (const field of required) if (fields[field] === undefined) problems.push(`${rel}:${i + 1}: ${id} has no ${field}`)
    if (fields.Answers !== undefined && !/^Q-\d{3,}$/.test(fields.Answers)) problems.push(`${rel}:${i + 1}: ${id}'s Answers is not a Q-NNN`)
    decisions.push(id)
  }
  return decisions
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

// The first stage whose test fails: { n, why, next }, where n 8 means stage 8 or later.
function stageOf(root, project, s) {
  const has = (...parts) => fs.existsSync(path.join(root, ...parts))
  const current = [...s.requirements.values()].filter((r) => r.status !== 'retired')
  if (current.length === 0) {
    return { n: 2, why: 'spec/ holds no requirements yet', next: '/epikloop:discover for a new product, or /epikloop:adopt for existing code' }
  }
  const observed = current.filter((r) => r.status === 'observed').length
  if (observed > 0) return { n: 2, why: `${plural(observed, 'requirement')} in spec/ ${observed === 1 ? 'is' : 'are'} still observed`, next: '/epikloop:adopt' }
  if (project.lane !== 'service' && !has('design', 'manifest.md')) {
    return { n: 3, why: `the ${project.lane} lane has a UI, and design/manifest.md is missing`, next: '/epikloop:design' }
  }
  if (!has('spec', 'architecture.md')) return { n: 4, why: 'spec/architecture.md is missing', next: '/epikloop:architect' }
  if (s.stories.size === 0) return { n: 5, why: 'docs/stories/ holds no stories yet', next: '/epikloop:plan' }
  if (!project.mvp_frozen) return { n: 5, why: "the MVP set isn't frozen", next: '/epikloop:plan' }
  const mvp = [...s.stories.values()].filter((story) => story.mvp)
  if (mvp.length === 0) return { n: 5, why: 'no story is in the MVP set', next: '/epikloop:plan' }
  const epics = [...new Set(mvp.map((story) => story.epic))].sort((a, b) => a - b)
  const epic = epics.find((n) => !s.tags.has(`phase-${n}`))
  if (epic === undefined) return { n: 8, why: 'every MVP epic is tagged', next: '/epikloop' }
  const left = mvp.filter((story) => story.epic === epic && !s.done.has(story.id))
  if (left.length === 0) return { n: 7, why: `epic ${epic}'s MVP stories are done, and it has no phase-${epic} tag`, next: '/epikloop:retro' }
  const why = `epic ${epic} has ${plural(left.length, 'MVP story', 'MVP stories')} left`
  const blocking = s.questions.filter((q) => q.blocks.some((id) => left.some((story) => story.id === id)))
  if (blocking.length > 0) {
    const first = blocking[0]
    const blocked = first.blocks.filter((id) => left.some((story) => story.id === id))
    const more = blocking.length > 1 ? ` and ${plural(blocking.length - 1, 'more question')}` : ''
    return { n: 6, why: `${why}, and ${first.id}${more} ${blocking.length > 1 ? 'block' : 'blocks'} ${blocked.join(', ')}`, next: `/epikloop:decide, then /epikloop:epic ${epic}` }
  }
  if (s.questions.length >= MANY_QUESTIONS) return { n: 6, why: `${why}, and ${s.questions.length} questions wait`, next: `/epikloop:decide, then /epikloop:epic ${epic}` }
  return { n: 6, why, next: `/epikloop:epic ${epic}` }
}

// The project's state, derived from its files and git. `project` is its parsed marker.
export function readState(root, project, { now = Date.now(), home = os.homedir() } = {}) {
  const problems = []
  const requirements = readSpec(root, problems)
  const stories = readStories(root, problems)
  const queueText = readLines(root, 'docs/queue.md')?.join('\n') ?? null
  const { questions, backlog } = readQueue(queueText, problems, stories)
  const decisions = readDecisions(root, problems)
  const git = gitReader(root)
  const { branch, tags } = refsOf(git)
  const done = doneTimes(git, branch)
  const s = { requirements, stories, questions, backlog, decisions, problems, done, tags }
  const stage = stageOf(root, project, s)

  let gauge = null
  const mvp = [...stories.values()].filter((story) => story.mvp)
  if (project.mvp_frozen && mvp.length > 0) {
    // The queue at the phase's start: the highest phase tag, else the commit that froze the MVP set.
    const phases = [...tags].map((tag) => /^phase-(\d+)$/.exec(tag)?.[1]).filter(Boolean).map(Number)
    const freeze = branch === null ? null : git(['log', '--reverse', '--format=%H', '-S"mvp_frozen"', branch, '--', '.epikloop/project.json'])
    const base = phases.length > 0 ? `phase-${Math.max(...phases)}` : freeze?.split('\n')[0] || null
    let delta = null
    if (base !== null) {
      const before = readQueue(git(['show', `${base}:docs/queue.md`]), null, null)
      delta = questions.length + backlog - (before.questions.length + before.backlog)
    }
    gauge = fuelGauge(project, mvp, done, delta, { now, home })
  }
  return { ...s, stage, gauge }
}

// ---- The self-test

const NOW = Date.UTC(2026, 10, 15, 12)
const TEMPLATES = path.join(import.meta.dirname, '..', 'templates')
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
        [s.decisions.join(' '), 'DECISION-001 DECISION-002'],
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
    'stage 8 or later when every MVP epic is tagged',
    (k) => {
      const dir = k.repo(planned({ 1: [[1, 'T1', true]], 2: [[1, 'T1', false]] }))
      k.commit(dir, 'feat(1.1): one', 1)
      k.git(dir, 'tag', 'phase-1')
      return k.stage(dir, '8 every MVP epic is tagged → /epikloop')
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
    repo(files, { freeze = false, frozenAgo = 0 } = {}) {
      const dir = k.folder(files)
      k.git(dir, 'init', '-q')
      k.project = { ...MARKER }
      if (freeze) k.project.mvp_frozen = ymd(NOW - frozenAgo * DAY)
      k.write(dir, '.epikloop/project.json', `${JSON.stringify(k.project)}\n`)
      k.commit(dir, 'plan', frozenAgo)
      return dir
    },
    costs(files) {
      const dir = path.join(home, '.epikloop', 'projects', MARKER.id)
      for (const [file, rows] of Object.entries(files)) {
        k.write(dir, file, rows.map(([tier, wall]) => JSON.stringify({ format: 1, story: '9.9', tier, wall, cost: null, model: null, effort: 'medium' })).join('\n') + '\n')
      }
    },
    read: (dir, fields = {}) => readState(dir, { ...(k.project ?? MARKER), ...fields }, { now: NOW, home }),
    expect: (pairs) => pairs.filter(([actual, wanted]) => actual !== wanted).map(([actual, wanted]) => `got ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`),
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

if (process.argv[2] === '--self-test' && path.resolve(process.argv[1] ?? '') === import.meta.filename) await selfTest()
