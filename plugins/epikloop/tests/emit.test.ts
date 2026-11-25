// The emitter's suite: `claude plugin test plugins/epikloop`, with no login. Hooks beneath the
// module answer every `$` call it makes, from memory: a disk keyed by forward-slash paths without
// a drive letter (on Windows the engine resolves the session's cwd onto the current drive), the
// clock, the session's cost and both home variables. `$.plugin.root` is real, so the module takes
// this OS's home rule, and each path is checked against the rule it took.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const SESSION = '8d1e5c2a-4b7f-4e0a-9c3d-2f6b8a1e7c90'
// The id a /clear goes on under.
const CLEARED = '5b2e9d41-7c3a-4f18-a6e0-9d4c1b7f2e63'
const ID = '3f9c2a7b1e04'
const NOW = Date.UTC(2026, 9, 21, 10) // 2026-10-21T10:00:00.000Z
const HOMES: Record<string, string> = { HOME: '/home/dev', USERPROFILE: 'C:\\Users\\dev' }
const CWD = '/work/shop'
const MARKER = '/work/.epikloop/project.json'

type Write = { path: string; text: string }

function project(effort: Record<string, string> = {}) {
  return JSON.stringify({ format: 1, id: ID, lane: 'web', mode: 'solo', effort })
}

// What lies beneath the module, answered from memory and recorded.
function world(on: On, files: Record<string, string>) {
  const w = { now: NOW, usd: 0.25 as number | undefined, cwd: '', id: SESSION, writes: [] as Write[], asked: [] as string[] }
  const disk = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('env.get', (_, e) => ({ value: HOMES[e.name] }))
  on('clock.now', () => ({ value: w.now }))
  on('session.id', () => ({ value: w.id }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: {}, rateLimits: [], cost: { usd: w.usd } } }))
  on('fs.exists', (_, e) => {
    w.asked.push(disk(e.path))
    return { value: disk(e.path) in files }
  })
  on('fs.read', (_, e) => ({ value: files[disk(e.path)] }))
  on('fs.write', (_, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.start', (_, e) => {
    w.cwd = e.cwd
    return { cwd: e.cwd }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return w
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: null, isInteractive: false })
const end = ($: Engine) => $.session.end({ reason: 'other', sessionId: SESSION, resume: { id: SESSION } })

// Where the module put its files: the home rule it took, read off its first write.
function layout(writes: Write[]) {
  const windows = writes[0].path.startsWith(HOMES.USERPROFILE)
  const sep = windows ? '\\' : '/'
  const base = [windows ? HOMES.USERPROFILE : HOMES.HOME, '.epikloop'].join(sep)
  return { sep, base, day: [base, 'events', '2026-10-21'].join(sep) }
}

// The records in the order the session wrote them, by the count in each file's name.
function records(writes: Write[]) {
  const seq = (write: Write) => Number(/-(\d+)\.json$/.exec(write.path)?.[1])
  return [...writes].sort((a, b) => seq(a) - seq(b)).map((write) => JSON.parse(write.text))
}

// The cost rows among the writes, in the order written, and the events beside them.
function split(writes: Write[]) {
  const { sep } = layout(writes)
  const cost = (write: Write) => write.path.includes(`${sep}cost${sep}`)
  return { rows: records(writes.filter(cost)), events: records(writes.filter((write) => !cost(write))) }
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
// The end of an agent's turn, as the engine reports one that answered.
const answered = (turnId: string, agentId: string) =>
  ({ answer: 'done', durationMs: 1, isAborted: false, turnId, agentId, reason: 'answer', usage: USAGE }) as const

const WORKER = { tool: 'Agent', subagent_type: 'epikloop:story-worker', prompt: 'p' }
const REVIEWER = { tool: 'Agent', subagent_type: 'epikloop:story-reviewer', prompt: 'p' }
// A worker's first turn starts inside its Agent call, which answers at once, as a spawn's does; its
// turns end after the call has answered. A reviewer's spawn goes the same way.
function spawning($: Engine, on: On, first: Record<string, () => Promise<unknown>>) {
  on('tool.call', async (_, e) => {
    await first[e.description]?.()
    return { result: {} }
  })
  return (description: string, agent = WORKER) => $.tool.call({ ...agent, description })
}

test('outside a project the project is looked for at the start and at each prompt, and nothing is written', async ($, on) => {
  const w = world(on, {})
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'echo canary-7f3a' })
  await $.turn.start({ text: '', turnId: 't0' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
  await end($)
  const walk = ['/work/shop/.epikloop/project.json', MARKER, '/.epikloop/project.json']
  expect(w.asked).toEqual([...walk, ...walk])
  expect(w.writes).toEqual([])
})

test('a project set up during the session opens at the next prompt, and nothing before it is written', async ($, on) => {
  const files: Record<string, string> = {}
  const w = world(on, files)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.turn.start({ text: 'set it up', turnId: 't0' })
  await $.tool.call({ tool: 'Bash', command: 'node init.mjs --lane web --mode solo' })
  files[MARKER] = project()
  await $.tool.call({ tool: 'Bash', command: 'git commit' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
  expect(w.writes).toEqual([])
  await $.turn.start({ text: 'go on', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await end($)
  expect(records(w.writes)).toMatchObject([
    { format: 1, project_id: ID, cwd: w.cwd, session_id: SESSION, kind: 'session.start' },
    { kind: 'tool.pre', tool: 'Bash' },
    { kind: 'tool.post', tool: 'Bash' },
    { kind: 'stop' },
    { kind: 'session.end' },
  ])
})

test('after a /clear the next prompt opens the project again, under the new session id', async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  w.id = CLEARED
  await $.turn.start({ text: '', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.session.end({ reason: 'other', sessionId: CLEARED, resume: { id: CLEARED } })
  const of = (id: string) => records(w.writes.filter((write) => write.path.includes(`-${id.slice(0, 8)}-`)))
  expect(of(SESSION)).toMatchObject([
    { kind: 'session.start', session_id: SESSION },
    { kind: 'session.end', session_id: SESSION, detail: { reason: 'clear' } },
  ])
  expect(of(CLEARED)).toMatchObject([
    { kind: 'session.start', session_id: CLEARED },
    { kind: 'tool.pre', session_id: CLEARED },
    { kind: 'tool.post', session_id: CLEARED },
    { kind: 'session.end', session_id: CLEARED },
  ])
  expect(of(SESSION).length + of(CLEARED).length).toBe(w.writes.length)
})

test('a marker that does not parse opens nothing, at the start or at a prompt', async ($, on) => {
  const w = world(on, { [MARKER]: '{ "format": 1, "id": ' })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.turn.start({ text: '', turnId: 't0' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await end($)
  expect(w.writes).toEqual([])
})

test('inside a project each event is one line in a file of its own, under the home Node uses', async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  on('tool.call', () => ({ result: {} }))
  await start($)
  const asked = w.asked.length
  await $.tool.call({ tool: 'Bash', command: 'echo canary-7f3a' })
  await $.turn.start({ text: '', turnId: 't0' })
  await $.turn.complete({ answer: 'canary answer', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
  await end($)
  expect(w.asked).toHaveLength(asked)
  const { sep, day } = layout(w.writes)
  const names = [1, 2, 3, 4, 5].map((n) => `${day}${sep}${NOW}-8d1e5c2a-${n}.json`)
  expect(w.writes.map((write) => write.path).sort()).toEqual(names.sort())
  for (const { text } of w.writes) {
    expect(text.indexOf('\n')).toBe(text.length - 1)
    expect(text.includes('canary')).toBe(false)
  }
  expect(records(w.writes)).toMatchObject([
    { format: 1, ts: '2026-10-21T10:00:00.000Z', project_id: ID, cwd: w.cwd, session_id: SESSION, kind: 'session.start' },
    { kind: 'tool.pre', tool: 'Bash' },
    { kind: 'tool.post', tool: 'Bash', detail: { is_error: false } },
    { kind: 'stop', detail: { reason: 'answer' } },
    { kind: 'session.end', detail: { reason: 'other', write_failures: 0 } },
  ])
})

test("a story-worker gets its tier's effort: the project over the user over the default", async ($, on) => {
  const user = JSON.stringify({ format: 1, effort: { T1: 'low', T2: 'low' } })
  // An override that is no level is passed over, so T3 keeps its default.
  world(on, {
    [MARKER]: project({ T2: 'max', T3: 'ultra' }),
    '/home/dev/.epikloop/config.json': user,
    '/Users/dev/.epikloop/config.json': user,
  })
  const efforts: unknown[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'Agent') efforts.push(e.effort)
    return { result: {} }
  })
  await start($)
  const spawn = (subagent_type: string, description: string) =>
    $.tool.call({ tool: 'Agent', subagent_type, description, prompt: 'p', effort: 'high' })
  await spawn('epikloop:story-worker', '3.1 T1 sign-up form')
  await spawn('epikloop:story-worker', '3.2 T2 password reset')
  await spawn('epikloop:story-worker', '3.3 T3 card payments')
  await spawn('Explore', '3.2 T2 look around')
  await spawn('epikloop:story-worker', 'Story 3.4, tier T1')
  expect(efforts).toEqual(['low', 'max', 'xhigh', 'high', 'high'])
})

test("a story-reviewer gets the review effort, whatever its story's tier: the project over the user", async ($, on) => {
  const user = JSON.stringify({ format: 1, effort: { review: 'low', T1: 'low' } })
  world(on, {
    [MARKER]: project({ review: 'max' }),
    '/home/dev/.epikloop/config.json': user,
    '/Users/dev/.epikloop/config.json': user,
  })
  const efforts: unknown[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'Agent') efforts.push(e.effort)
    return { result: {} }
  })
  await start($)
  const spawn = (subagent_type: string, description: string) =>
    $.tool.call({ tool: 'Agent', subagent_type, description, prompt: 'p', effort: 'medium' })
  await spawn('epikloop:story-reviewer', '3.1 T1 sign-up form')
  await spawn('epikloop:story-reviewer', '3.3 T3 card payments')
  await spawn('epikloop:story-worker', '3.1 T1 sign-up form')
  // A description that names no story and tier is no reviewer's spawn the module knows.
  await spawn('epikloop:story-reviewer', 'Review 3.4')
  expect(efforts).toEqual(['max', 'max', 'low', 'medium'])
})

test('a story-worker or a story-reviewer spawned in the background goes on in the foreground; others are unchanged', async ($, on) => {
  world(on, { [MARKER]: project() })
  const spawned: unknown[] = []
  on('agent.spawn', (_, e) => {
    spawned.push([e.subagentType, e.background])
    return { model: 'claude-opus-5-5', agentId: `a${spawned.length}` }
  })
  await start($)
  const spawn = (subagentType: string, plugin: string) =>
    $.agent.spawn({
      tool_use_id: 'toolu_1',
      prompt: 'p',
      description: '1.1 T1 sign-up form',
      subagentType,
      provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
      parentModel: 'claude-haiku-5-5',
      background: true,
      fork: false,
    })
  await spawn('epikloop:story-worker', 'epikloop')
  await spawn('epikloop:story-reviewer', 'epikloop')
  await spawn('Explore', 'engine')
  expect(spawned).toEqual([
    ['epikloop:story-worker', false],
    ['epikloop:story-reviewer', false],
    ['Explore', true],
  ])
})

test("a worker's turn writes its cost row at its end: the cost's rise, the wall time, the worker, the model and the effort", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  const spawn = spawning($, on, { '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' }) })
  await start($)
  await spawn('2.3 T2 cart total')
  w.now += 4000
  w.usd = 0.75
  await $.turn.complete(answered('t1', 'a1'))
  await end($)
  const { sep, base } = layout(w.writes)
  const rows = w.writes.filter((write) => write.path.includes(`${sep}cost${sep}`))
  expect(rows).toHaveLength(1)
  expect(rows[0].path).toStartWith([base, 'projects', ID, 'cost', `${NOW + 4000}-8d1e5c2a-`].join(sep))
  expect(JSON.parse(rows[0].text)).toEqual({
    format: 1,
    ts: new Date(NOW + 4000).toISOString(),
    story: '2.3',
    tier: 'T2',
    agent: 'a1',
    wall: 4,
    cost: 0.5,
    model: 'claude-opus-5-5',
    effort: 'high',
  })
  const { events } = split(w.writes)
  expect(events.find((event) => event.kind === 'tool.pre')).toMatchObject({ tool: 'Agent', story: '2.3' })
  expect(events.filter((event) => event.kind.startsWith('subagent.'))).toMatchObject([
    { kind: 'subagent.start', story: '2.3', agent: 'a1' },
    { kind: 'subagent.stop', story: '2.3', agent: 'a1', detail: { reason: 'answer' } },
  ])
})

test('a worker that takes several turns keeps its story, and its rows add up to its time and its cost', async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  const spawn = spawning($, on, { '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' }) })
  await start($)
  await spawn('2.3 T2 cart total')
  w.now += 4000
  w.usd = 0.75
  await $.turn.complete(answered('t1', 'a1'))
  // Its own command runs for a minute, and the session spends on the main loop meanwhile.
  w.now += 60000
  w.usd = 1
  await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
  w.now += 2000
  w.usd = 1.5
  await $.turn.complete(answered('t2', 'a1'))
  await end($)
  const { rows, events } = split(w.writes)
  expect(rows).toMatchObject([
    { story: '2.3', tier: 'T2', agent: 'a1', wall: 4, cost: 0.5, effort: 'high' },
    { story: '2.3', tier: 'T2', agent: 'a1', wall: 62, cost: 0.5, effort: 'high' },
  ])
  const turns = events.filter((event) => event.kind.startsWith('subagent.'))
  expect(turns.map((event) => [event.kind, event.story, event.agent])).toEqual([
    ['subagent.start', '2.3', 'a1'],
    ['subagent.stop', '2.3', 'a1'],
    ['subagent.start', '2.3', 'a1'],
    ['subagent.stop', '2.3', 'a1'],
  ])
})

test("a worker's later turn leaves the next worker's spawn alone", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  // 2.3's worker goes on while 2.4's spawn still waits for its own first turn.
  const spawn = spawning($, on, {
    '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' }),
    '2.4 T1 cart badge': async () => {
      await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
      await $.turn.start({ text: 'p', turnId: 't3', agentId: 'a2' })
    },
  })
  await start($)
  await spawn('2.3 T2 cart total')
  await $.turn.complete(answered('t1', 'a1'))
  await spawn('2.4 T1 cart badge')
  await $.turn.complete(answered('t2', 'a1'))
  await $.turn.complete(answered('t3', 'a2'))
  await end($)
  const { rows, events } = split(w.writes)
  const starts = events.filter((event) => event.kind === 'subagent.start')
  expect(starts.map((event) => [event.agent, event.story])).toEqual([
    ['a1', '2.3'],
    ['a1', '2.3'],
    ['a2', '2.4'],
  ])
  expect(rows.map((row) => [row.agent, row.story, row.tier, row.effort])).toEqual([
    ['a1', '2.3', 'T2', 'high'],
    ['a1', '2.3', 'T2', 'high'],
    ['a2', '2.4', 'T1', 'medium'],
  ])
})

test("a reviewer's turn writes a cost row marked as a review, at the review effort, and its events name no story", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  on('classic.Notification', () => ({}))
  const spawn = spawning($, on, { '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'r1' }) })
  await start($)
  await spawn('2.3 T2 cart total', REVIEWER)
  // Whatever asks while the reviewer is inside its turn is no story's either.
  await $.classic.Notification({ message: 'canary message', notification_type: 'permission_prompt' })
  w.now += 3000
  w.usd = 0.5
  await $.turn.complete(answered('t1', 'r1'))
  await end($)
  const { rows, events } = split(w.writes)
  expect(rows).toEqual([
    {
      format: 1,
      ts: new Date(NOW + 3000).toISOString(),
      story: '2.3',
      tier: 'T2',
      agent: 'r1',
      wall: 3,
      cost: 0.25,
      model: 'claude-opus-5-5',
      effort: 'high',
      review: true,
    },
  ])
  const named = events.filter((event) => ['tool.pre', 'tool.post', 'subagent.start', 'subagent.stop', 'notification'].includes(event.kind))
  expect(named.map((event) => [event.kind, event.story ?? null])).toEqual([
    ['tool.pre', null],
    ['subagent.start', null],
    ['tool.post', null],
    ['notification', null],
    ['subagent.stop', null],
  ])
})

test("a worker's later turn leaves a reviewer's spawn alone, and only the reviewer's row is a review's", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  // 2.3's worker goes on while the reviewer of 2.2 still waits for its own first turn.
  const spawn = spawning($, on, {
    '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' }),
    '2.2 T3 card payments': async () => {
      await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
      await $.turn.start({ text: 'p', turnId: 't3', agentId: 'r1' })
    },
  })
  await start($)
  await spawn('2.3 T2 cart total')
  await $.turn.complete(answered('t1', 'a1'))
  await spawn('2.2 T3 card payments', REVIEWER)
  await $.turn.complete(answered('t2', 'a1'))
  await $.turn.complete(answered('t3', 'r1'))
  await end($)
  const { rows, events } = split(w.writes)
  expect(rows.map((row) => [row.agent, row.story, row.tier, row.effort, row.review ?? null])).toEqual([
    ['a1', '2.3', 'T2', 'high', null],
    ['a1', '2.3', 'T2', 'high', null],
    ['r1', '2.2', 'T3', 'high', true],
  ])
  const starts = events.filter((event) => event.kind === 'subagent.start')
  expect(starts.map((event) => [event.agent, event.story ?? null])).toEqual([
    ['a1', '2.3'],
    ['a1', '2.3'],
    ['r1', null],
  ])
})

test("the wait after a turn that died is not the worker's", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  const spawn = spawning($, on, { '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' }) })
  await start($)
  await spawn('2.3 T2 cart total')
  w.now += 4000
  await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'error' })
  // Two and a half hours pass before someone wakes it.
  w.now += 9_000_000
  await $.turn.start({ text: 'go on', turnId: 't2', agentId: 'a1' })
  w.now += 3000
  await $.turn.complete(answered('t2', 'a1'))
  await end($)
  const { rows } = split(w.writes)
  expect(rows.map((row) => [row.wall, row.model])).toEqual([
    [4, null],
    [3, 'claude-opus-5-5'],
  ])
})

test("a cost the session's total can't give is null", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  const spawn = spawning($, on, { '2.3 T2 cart total': () => $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' }) })
  await start($)
  await spawn('2.3 T2 cart total')
  // The host keeps no total at this turn's end.
  w.now += 4000
  w.usd = undefined
  await $.turn.complete(answered('t1', 'a1'))
  // And the total starts over during the next, as it does at a /clear.
  w.usd = 0.5
  await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
  w.now += 2000
  w.usd = 0.1
  await $.turn.complete(answered('t2', 'a1'))
  await end($)
  const { rows } = split(w.writes)
  expect(rows.map((row) => [row.wall, row.cost])).toEqual([
    [4, null],
    [2, null],
  ])
})

test('task and notification events carry identifiers, never their text', async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  on('classic.TaskCreated', () => ({}))
  on('classic.TaskCompleted', () => ({}))
  on('classic.Notification', () => ({}))
  await start($)
  await $.classic.TaskCreated({ task_id: '7', task_subject: 'canary subject', task_description: 'canary details' })
  await $.classic.TaskCompleted({ task_id: '7', task_subject: 'canary subject' })
  await $.classic.Notification({ message: 'canary message', title: 'canary title', notification_type: 'permission_prompt' })
  await end($)
  expect(records(w.writes)).toMatchObject([
    { kind: 'session.start' },
    { kind: 'task.created', detail: { task_id: '7' } },
    { kind: 'task.completed', detail: { task_id: '7' } },
    { kind: 'notification', detail: { notification_type: 'permission_prompt' } },
    { kind: 'session.end' },
  ])
  expect(w.writes.some((write) => write.text.includes('canary'))).toBe(false)
})

test("a notification names the story of the one worker inside a turn, and no story otherwise", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  on('classic.Notification', () => ({}))
  // Each worker's Agent call stays open until its worker's turn completes, as a foreground spawn's
  // does, so a second worker can start while the first is at work.
  const reached: Record<string, () => void> = {}
  const answer: Record<string, () => void> = {}
  on('tool.call', (_, e) => {
    reached[e.description]()
    return new Promise((resolve) => {
      answer[e.description] = () => resolve({ result: {} })
    })
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const work = async (description: string, agentId: string) => {
    const at = new Promise<void>((resolve) => {
      reached[description] = resolve
    })
    const call = $.tool.call({ tool: 'Agent', subagent_type: 'epikloop:story-worker', description, prompt: 'p' })
    await at
    await $.turn.start({ text: 'p', turnId: agentId, agentId })
    return async () => {
      const done = { answer: 'done', durationMs: 1, isAborted: false, turnId: agentId, agentId, reason: 'answer' }
      await $.turn.complete({ ...done, usage: { ...usage, model: 'claude-opus-5-5' } })
      answer[description]()
      await call
    }
  }
  const ask = () => $.classic.Notification({ message: 'canary message', notification_type: 'permission_prompt' })
  await start($)
  await ask()
  const first = await work('2.3 T2 cart total', 'a1')
  await ask()
  const second = await work('2.4 T1 cart badge', 'a2')
  await ask()
  await second()
  await ask()
  await first()
  await ask()
  // The first worker goes on, in a later turn.
  await $.turn.start({ text: '', turnId: 'a1-2', agentId: 'a1' })
  await ask()
  await end($)
  const asked = records(w.writes).filter((event) => event.kind === 'notification')
  expect(asked.map((event) => event.story ?? null)).toEqual([null, '2.3', null, '2.3', null, '2.3'])
  expect(asked.every((event) => event.detail.notification_type === 'permission_prompt')).toBe(true)
})
