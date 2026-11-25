// Epikloop's emitter, a hooks module: it runs inside Claude Code and reaches everything through
// `$`. It injects no text and never holds a call back. Inside an Epikloop project it writes one
// JSON file per event under ~/.epikloop/events/YYYY-MM-DD/ and one cost row per turn of a
// story-worker or a story-reviewer under ~/.epikloop/projects/<id>/cost/, which scripts/fold.mjs
// folds into .jsonl files. It also sets each story-worker's effort from its story's tier, and a
// reviewer's from the review effort, and asks for both in the foreground.
//
// The batch spawns epikloop:story-worker, and then epikloop:story-reviewer, with a description
// that starts with the story and its tier, `3.2 T2 login form`: that is how the story and the tier
// are known at spawn time.
//
// Limits:
// - No module loads under --bare or --safe-mode, under a managed policy that turns mods off, or
//   while Claude Code's rollout switch for mods is off; there, nothing is written.
// - Where an organization manages Claude Code, classic.* hooks in a plugin a person installs
//   don't run, so task.created, task.completed and notification are not written.

const WORKER = 'epikloop:story-worker'
const REVIEWER = 'epikloop:story-reviewer'
const SPAWN = /^(\d+\.\d+) (T[123])\b/
// Story-worker effort per tier, and the story-reviewer's, beneath ~/.epikloop/config.json and
// .epikloop/project.json.
const EFFORT = { T1: 'medium', T2: 'high', T3: 'xhigh', review: 'high' }
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

// Set inside an Epikloop project: at session.start, and at a prompt when none is open yet or the
// session has gone on under another id. While it is null every hook passes its event on and
// nothing is written.
let session = null
// The directory the session started in, where a project set up later is found.
let startedIn = null

export function register(on) {
  on('session.start', async ($, e, next) => {
    startedIn = e.cwd
    session = await open($, startedIn)
    if (session !== null) emit($, 'session.start', {})
    return next(e)
  })

  // The call goes on before anything is written, and nothing waits for a write.
  on('tool.call', ($, e, next) => {
    const s = session
    if (s === null) return next(e)
    const spawn = workerSpawn(s, e)
    if (spawn !== null) s.spawning = spawn
    const ran = next(spawn === null ? e : { ...e, effort: spawn.effort })
    const fields = { story: storyOf(spawn ?? s.workers.get(e.agentId)), tool: e.tool, agent: e.agentId }
    emit($, 'tool.pre', { ...fields, detail: { tool_use_id: e.tool_use_id } })
    ran.then(
      (result) => {
        if (s.spawning === spawn) s.spawning = null
        emit($, 'tool.post', { ...fields, detail: { tool_use_id: e.tool_use_id, is_error: result.isError === true } })
      },
      () => {},
    )
    return ran
  })

  // A story-worker is asked for in the foreground, and so is a story-reviewer: the batch reads its
  // list again only once the one it started has reported.
  on('agent.spawn', ($, e, next) =>
    session !== null && (e.subagentType === WORKER || e.subagentType === REVIEWER) && e.background ? next({ ...e, background: false }) : next(e),
  )

  // A worker may take several turns: it ends one while a command of its own runs in the
  // background, and goes on when the command ends. Each turn's end writes a cost row with that
  // turn's share: the rise in the session's cost over the turn, and the time since the turn before
  // it ended, so the wait counts unless that turn died. The rows assume sequential workers, as in
  // M1: the first agent turn to start after a spawn is its worker's, and a worker already known
  // never takes the next one's. With parallel workers a turn's rise is shared, and `cost` is an
  // upper bound. A reviewer's turns write rows the same way, marked `review`.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      // The session that sets a project up began outside it, and a /clear goes on under a new
      // session id with no session.start; either opens here, at the next prompt.
      if (startedIn !== null && (session === null || session.id !== (await $.session.id()))) {
        session = await open($, startedIn)
        if (session !== null) emit($, 'session.start', {})
      }
      return next(e)
    }
    const s = session
    if (s === null) return next(e)
    let worker = s.workers.get(e.agentId)
    if (worker === undefined && s.spawning !== null) {
      worker = { ...s.spawning }
      s.workers.set(e.agentId, worker)
      s.spawning = null
    }
    if (worker !== undefined) {
      worker.active = true
      const now = await reading($)
      worker.usd = now.usd
      worker.at ??= now.at
    }
    emit($, 'subagent.start', { story: storyOf(worker), agent: e.agentId })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const s = session
    if (s === null) return next(e)
    if (e.agentId === undefined) {
      emit($, 'stop', { detail: { reason: e.reason } })
      return next(e)
    }
    const worker = s.workers.get(e.agentId)
    emit($, 'subagent.stop', { story: storyOf(worker), agent: e.agentId, detail: { reason: e.reason } })
    if (worker !== undefined) {
      worker.active = false
      const end = await reading($)
      const row = {
        story: worker.story,
        tier: worker.tier,
        agent: e.agentId,
        // A turn whose start went unheard after one that died counts its own length alone.
        wall: (end.at - (worker.at ?? end.at - e.durationMs)) / 1000,
        cost: rise(worker.usd, end.usd),
        model: e.usage?.model ?? null,
        effort: worker.effort,
        ...(worker.review ? { review: true } : {}),
      }
      worker.usd = end.usd
      worker.at = e.reason === 'answer' ? end.at : undefined
      save($, s, () => s.costs, row, end.at)
    }
    return next(e)
  })

  on('classic.TaskCreated', ($, e, next) => {
    if (session !== null) emit($, 'task.created', { detail: { task_id: e.task_id } })
    return next(e)
  })

  on('classic.TaskCompleted', ($, e, next) => {
    if (session !== null) emit($, 'task.completed', { detail: { task_id: e.task_id } })
    return next(e)
  })

  // A notification's documented input names no agent. While one story-worker is inside a turn, as
  // in M1, whatever asks is its story's; between turns, or with several at work, it names no story.
  on('classic.Notification', ($, e, next) => {
    const s = session
    if (s !== null) {
      const busy = [...s.workers.values()].filter((worker) => worker.active)
      const story = busy.length === 1 ? storyOf(busy[0]) : undefined
      emit($, 'notification', { story, detail: { notification_type: e.notification_type } })
    }
    return next(e)
  })

  // The writes still under way finish inside the session's end bound.
  on('session.end', async ($, e, next) => {
    const s = session
    if (s !== null) {
      emit($, 'session.end', { detail: { reason: e.reason, write_failures: s.failures } })
      await Promise.all(s.writes)
    }
    return next(e)
  })
}

// The session's state when its directory is inside an Epikloop project whose id the schema
// accepts and the home folder is known; null otherwise. Home is found as Node's os.homedir() finds
// it, and Windows is told by the drive letter of the plugin's own path.
async function open($, cwd) {
  const windows = /^[A-Za-z]:/.test($.plugin.root)
  const sep = windows ? '\\' : '/'
  const root = await projectRoot($, cwd, sep)
  const home = windows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')
  if (root === null || !home) return null
  const project = JSON.parse(await $.fs.read(join(sep, root, '.epikloop', 'project.json')))
  if (!/^[0-9a-f]{12}$/.test(project.id)) return null
  const config = join(sep, home, '.epikloop', 'config.json')
  const user = (await $.fs.exists(config)) ? JSON.parse(await $.fs.read(config)) : {}
  const id = await $.session.id()
  return {
    id,
    short: id.slice(0, 8),
    cwd,
    projectId: project.id,
    sep,
    events: join(sep, home, '.epikloop', 'events'),
    costs: join(sep, home, '.epikloop', 'projects', project.id, 'cost'),
    effort: efforts(EFFORT, user.effort, project.effort),
    seq: 0,
    writes: new Set(),
    failures: 0,
    spawning: null,
    workers: new Map(),
  }
}

// The nearest directory at or above `cwd` that holds .epikloop/project.json, or null.
async function projectRoot($, cwd, sep) {
  const parts = cwd.split(/[\\/]+/)
  for (let n = parts.length; n > 0; n -= 1) {
    const dir = parts.slice(0, n).join(sep)
    if (await $.fs.exists(join(sep, dir, '.epikloop', 'project.json'))) return dir
  }
  return null
}

// A story-worker's or a story-reviewer's spawn: its story, its tier and its effort, or null for
// any other call. A reviewer runs at the review effort, whatever its story's tier.
function workerSpawn(s, e) {
  const review = e.subagent_type === REVIEWER
  const match = e.tool === 'Agent' && (review || e.subagent_type === WORKER) ? SPAWN.exec(e.description) : null
  if (match === null) return null
  return { story: match[1], tier: match[2], effort: s.effort[review ? 'review' : match[2]], ...(review ? { review: true } : {}) }
}

// The story an event names: a worker's. A reviewer's events name none, since its story has landed
// and Harbor draws a worker at the desk of each story an agent's events name.
const storyOf = (agent) => (agent?.review ? undefined : agent?.story)

// Each tier's effort from the layers given, the lowest first. A value that is no level is passed
// over, so the layer beneath shows.
function efforts(...layers) {
  const effort = {}
  for (const layer of layers) for (const tier of Object.keys(EFFORT)) if (LEVELS.includes(layer?.[tier])) effort[tier] = layer[tier]
  return effort
}

// The session's cost so far in US dollars, absent where the host keeps no ledger, and the time.
async function reading($) {
  const [usage, at] = await Promise.all([$.session.usage(), $.clock.now()])
  return { usd: usage.cost?.usd, at }
}

// What the session's cost rose by between two readings, or null where it keeps no total or the
// total started over, as it does at a /clear.
const rise = (from, to) => (from === undefined || to === undefined || to < from ? null : to - from)

function emit($, kind, fields) {
  const s = session
  const event = { project_id: s.projectId, cwd: s.cwd, session_id: s.id, kind, ...fields }
  save($, s, (day) => join(s.sep, s.events, day), event)
}

// Writes `record` as one JSON line in a file of its own, named by the time and the session's
// count, in the folder `place` gives for the day. No hook waits for the write but session.end, and
// a failed one is counted there.
function save($, s, place, record, at) {
  const seq = (s.seq += 1)
  const write = (at === undefined ? $.clock.now() : Promise.resolve(at))
    .then((ms) => {
      const ts = new Date(ms).toISOString()
      const file = join(s.sep, place(ts.slice(0, 10)), `${ms}-${s.short}-${seq}.json`)
      return $.fs.write(file, `${JSON.stringify({ format: 1, ts, ...record })}\n`)
    })
    .catch(() => {
      s.failures += 1
    })
  s.writes.add(write)
  write.then(() => s.writes.delete(write))
}

const join = (sep, ...parts) => parts.join(sep)
