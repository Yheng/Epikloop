// Epikloop's emitter, a hooks module: it runs inside Claude Code and reaches everything through
// `$`. It injects no text and never holds a call back. Inside an Epikloop project it writes one
// JSON file per event under ~/.epikloop/events/YYYY-MM-DD/ and one cost row per story-worker under
// ~/.epikloop/projects/<id>/cost/, which bin/fold.mjs folds into .jsonl files. It also sets each
// story-worker's effort from its story's tier and keeps the worker in the foreground.
//
// The batch spawns epikloop:story-worker with a description that starts with the story and its
// tier, `3.2 T2 login form`: that is how the tier is known at spawn time.
//
// Limits:
// - No module loads under --bare or --safe-mode, under a managed policy that turns mods off, or
//   while Claude Code's rollout switch for mods is off; there, nothing is written.
// - Where an organization manages Claude Code, classic.* hooks in a plugin a person installs
//   don't run, so task.created, task.completed and notification are not written.

const WORKER = 'epikloop:story-worker'
const SPAWN = /^(\d+\.\d+) (T[123])\b/
// Story-worker effort per tier, beneath ~/.epikloop/config.json and .epikloop/project.json.
const EFFORT = { T1: 'medium', T2: 'high', T3: 'xhigh' }

// Set at session.start inside an Epikloop project. While it is null every hook passes its event
// on and nothing is written.
let session = null

export function register(on) {
  on('session.start', async ($, e, next) => {
    session = await open($, e.cwd)
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
    const fields = { story: spawn?.story ?? s.workers.get(e.agentId)?.story, tool: e.tool, agent: e.agentId }
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

  // A story-worker runs in the foreground, so the cost its row records is its own.
  on('agent.spawn', ($, e, next) =>
    session !== null && e.subagentType === WORKER && e.background ? next({ ...e, background: false }) : next(e),
  )

  // A cost row assumes a foreground, sequential worker, as in M1: between the worker's start and
  // its stop the session's cost rises for the worker alone, and the first agent turn to start after
  // its spawn is the worker's. With parallel workers the rise is shared, and `cost` is an upper
  // bound.
  on('turn.start', async ($, e, next) => {
    const s = session
    if (s === null || e.agentId === undefined) return next(e)
    const spawn = s.spawning
    s.spawning = null
    if (spawn !== null) s.workers.set(e.agentId, { ...spawn, ...(await reading($)) })
    emit($, 'subagent.start', { story: spawn?.story, agent: e.agentId })
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
    s.workers.delete(e.agentId)
    emit($, 'subagent.stop', { story: worker?.story, agent: e.agentId, detail: { reason: e.reason } })
    if (worker !== undefined) {
      const end = await reading($)
      const row = {
        story: worker.story,
        tier: worker.tier,
        wall: (end.at - worker.at) / 1000,
        cost: end.usd === undefined || worker.usd === undefined ? null : end.usd - worker.usd,
        model: e.usage?.model ?? null,
        effort: worker.effort,
      }
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

  on('classic.Notification', ($, e, next) => {
    if (session !== null) emit($, 'notification', { detail: { notification_type: e.notification_type } })
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
    effort: { ...EFFORT, ...user.effort, ...project.effort },
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

// A story-worker spawn's story, tier and effort, or null for any other call.
function workerSpawn(s, e) {
  const match = e.tool === 'Agent' && e.subagent_type === WORKER ? SPAWN.exec(e.description) : null
  return match === null ? null : { story: match[1], tier: match[2], effort: s.effort[match[2]] }
}

// The session's cost so far in US dollars, absent where the host keeps no ledger, and the time.
async function reading($) {
  const [usage, at] = await Promise.all([$.session.usage(), $.clock.now()])
  return { usd: usage.cost?.usd, at }
}

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
