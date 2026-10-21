// The emitter's suite: `claude plugin test plugins/epikloop`, with no login. Hooks beneath the
// module answer every `$` call it makes, from memory: a disk keyed by forward-slash paths without
// a drive letter (on Windows the engine resolves the session's cwd onto the current drive), the
// clock, the session's cost and both home variables. `$.plugin.root` is real, so the module takes
// this OS's home rule, and each path is checked against the rule it took.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const SESSION = '8d1e5c2a-4b7f-4e0a-9c3d-2f6b8a1e7c90'
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
  const w = { now: NOW, usd: 0.25, cwd: '', writes: [] as Write[], asked: [] as string[] }
  const disk = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('env.get', (_, e) => ({ value: HOMES[e.name] }))
  on('clock.now', () => ({ value: w.now }))
  on('session.id', () => ({ value: SESSION }))
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

test('outside a project the project is looked for once, and nothing is written', async ($, on) => {
  const w = world(on, {})
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'echo canary-7f3a' })
  await $.turn.start({ text: '', turnId: 't0' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
  await end($)
  expect(w.asked).toEqual(['/work/shop/.epikloop/project.json', MARKER, '/.epikloop/project.json'])
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
  world(on, {
    [MARKER]: project({ T2: 'max' }),
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

test('a story-worker spawned in the background goes on in the foreground; others are unchanged', async ($, on) => {
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
  await spawn('Explore', 'engine')
  expect(spawned).toEqual([
    ['epikloop:story-worker', false],
    ['Explore', true],
  ])
})

test("a worker's stop writes its cost row: the cost's rise, the wall time, the model and the effort", async ($, on) => {
  const w = world(on, { [MARKER]: project() })
  on('tool.call', async (_, e) => {
    if (e.tool === 'Agent') {
      // The worker runs inside its Agent call, as a foreground spawn does.
      await $.turn.start({ text: 'p', turnId: 't1', agentId: 'a1' })
      w.now += 4000
      w.usd = 0.75
      const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      await $.turn.complete({
        answer: 'done',
        durationMs: 4000,
        isAborted: false,
        turnId: 't1',
        agentId: 'a1',
        reason: 'answer',
        usage: { ...usage, model: 'claude-opus-5-5' },
      })
    }
    return { result: {} }
  })
  await start($)
  await $.tool.call({ tool: 'Agent', subagent_type: 'epikloop:story-worker', description: '2.3 T2 cart total', prompt: 'p' })
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
    wall: 4,
    cost: 0.5,
    model: 'claude-opus-5-5',
    effort: 'high',
  })
  const events = records(w.writes.filter((write) => !rows.includes(write)))
  expect(events.find((event) => event.kind === 'tool.pre')).toMatchObject({ tool: 'Agent', story: '2.3' })
  expect(events.filter((event) => event.kind.startsWith('subagent.'))).toMatchObject([
    { kind: 'subagent.start', story: '2.3', agent: 'a1' },
    { kind: 'subagent.stop', story: '2.3', agent: 'a1', detail: { reason: 'answer' } },
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
