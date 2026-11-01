// The self-tests' mutations, which tools/mutate.mjs runs. Each one breaks one rule in a copy of the
// repository and names the self-tests that must then fail. Its `from` text must appear exactly once
// in its file, so a mutation goes stale, and fails the run, when the code it breaks changes.
const SCRIPTS = 'plugins/epikloop/scripts/'
const GUARD = `${SCRIPTS}guard.mjs`
const BRIEF = `${SCRIPTS}brief.mjs`
const INIT = `${SCRIPTS}init.mjs`
const STATE = `${SCRIPTS}state.mjs`
const SMOKE = `${SCRIPTS}smoke.mjs`
const DOCTOR = `${SCRIPTS}doctor.mjs`
const FOLD = `${SCRIPTS}fold.mjs`
const RUNNER = 'plugins/epikloop/templates/githooks/check.mjs'
const WORKFLOW = 'plugins/epikloop/templates/github/workflows/check.yml'
const EMIT = 'plugins/epikloop/hooks/emit.js'
const LAWS = 'tools/laws.mjs'
const FIXTURE = 'plugins/epikloop/evals/fixture.mjs'
const EVALS = 'tools/evals.mjs'
// The byte-order mark, which the code holds as the character itself.
const BOM = String.fromCharCode(0xfeff)

const m = (file, tests, name, from, to) => ({ file, tests, name, from, to })

export const MUTATIONS = [
  // The guard: its deny rules, its allow list, and failing closed.
  m(GUARD, ['guard'], 'switch off the skip-hooks rule', "test: ({ sub, args, all }) => / --no-verify /.test(all) || (sub === 'commit' && / -\\w*n\\w* /.test(args)),", 'test: () => false,'),
  m(GUARD, ['guard'], 'switch off the force-push rule', "sub === 'push' && / (?:--force\\S*|--mirror|--delete|--prune|-\\w*[fd]\\w*|[+:]\\S+) /.test(args),", 'false,'),
  m(GUARD, ['guard'], 'switch off the hard-reset rule', "test: ({ sub, args }) => sub === 'reset' && / --hard /.test(args),", 'test: () => false,'),
  m(GUARD, ['guard'], 'switch off the clean-force rule', "test: ({ sub, args }) => sub === 'clean' && FORCE.test(args),", 'test: () => false,'),
  m(GUARD, ['guard'], 'let checkout discard the tree', "(sub === 'checkout' && (WHOLE_TREE.test(args) || FORCE.test(args))) ||", 'false ||'),
  m(GUARD, ['guard'], 'let -c set core.hooksPath', '/core\\.hookspath\\s*=/i.test(all) ||', 'false ||'),
  m(GUARD, ['guard'], 'allow any command', 'const allowed = (c) => isPipelineCommand(tool, c) || lane.some(', 'const allowed = (c) => true || lane.some('),
  m(GUARD, ['guard'], 'allow text that could still run code', 'if (!live && commands.length > 0 && commands.every((c) => plain.test(c) && allowed(c))) {', 'if (commands.length > 0 && commands.every((c) => plain.test(c) && allowed(c))) {'),
  m(GUARD, ['guard'], 'allow redirects and substitutions', 'if (!live && commands.length > 0 && commands.every((c) => plain.test(c) && allowed(c))) {', 'if (!live && commands.length > 0 && commands.every((c) => allowed(c))) {'),
  m(GUARD, ['guard'], 'allow gh pr merge', "if (sub === 'pr' && (verb === 'merge' || verb === 'close')) return false", 'if (false) return false'),
  m(GUARD, ['guard'], "allow git options that run a program or name a URL", 'if (!GIT_ALLOWED.has(sub) || GIT_UNSAFE.test(args)) return false', 'if (!GIT_ALLOWED.has(sub)) return false'),
  m(GUARD, ['guard'], 'allow deleting branches and tags', "return !((sub === 'branch' || sub === 'tag') && / (?:--delete|-\\w*[dD]\\w*) /.test(args))", 'return true'),
  m(GUARD, ['guard'], 'fail open on bad input', "result = answer('deny', failureReason(String(error?.message ?? error).split('\\n')[0]))", 'result = null'),
  m(GUARD, ['guard'], 'allow any command in a project with a lane', 'const allowed = (c) => isPipelineCommand(tool, c) || lane.some(', 'const allowed = (c) => lane.length > 0 || lane.some('),
  m(GUARD, ['guard'], 'allow a prefix without its word boundary', 'c.startsWith(`${prefix} `)', 'c.startsWith(prefix)'),
  m(GUARD, ['guard'], "allow the web lane's commands in every lane", "path.join(import.meta.dirname, '..', 'lanes', `${lane}.json`)", "path.join(import.meta.dirname, '..', 'lanes', 'web.json')"),

  // The briefing.
  m(BRIEF, ['brief'], 'leave the protocol out', "return `${parts.join(' ')}\\n\\n${PROTOCOL}`", "return parts.join(' ')"),
  m(BRIEF, ['brief'], 'say nothing outside a project', 'context = opened === null ? OUTSIDE : briefing(opened)', "context = opened === null ? '' : briefing(opened)"),
  m(BRIEF, ['brief'], 'arm a repository that lacks the runner', "if (!fs.existsSync(path.join(root, '.githooks', 'check.mjs'))) return {}", 'if (false) return {}'),
  m(BRIEF, ['brief'], 'drop what needs the human', "  if (needs.length > 0) parts.push(`Needs the human: ${needs.join('; ')}.`)\n", ''),

  // The fold.
  m(FOLD, ['fold'], "fold a file that doesn't parse yet", "lines.push(`${JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')))}\\n`)", "lines.push(fs.readFileSync(file, 'utf8'))"),
  m(FOLD, ['fold'], 'delete files without folding them', "  if (lines.length > 0) fs.appendFileSync(target, lines.join(''))\n", ''),

  // The emitter, by the plugin's test suite.
  m(EMIT, ['emit'], "put the user's effort over the project's", 'effort: { ...EFFORT, ...user.effort, ...project.effort },', 'effort: { ...EFFORT, ...project.effort, ...user.effort },'),
  m(EMIT, ['emit'], "drop a worker's cost row", '      save($, s, () => s.costs, row, end.at)\n', ''),

  // Project setup.
  m(INIT, ['init'], 'accept any lane', 'if (!lanes.includes(options.lane)) return console.log(', 'if (false) return console.log('),
  m(INIT, ['init', 'doctor'], 'compare gate files byte for byte', "const sameText = (a, b) => a.toString('utf8').replace(/\\r\\n/g, '\\n') === b.toString('utf8').replace(/\\r\\n/g, '\\n')", 'const sameText = (a, b) => a.equals(b)'),
  m(INIT, ['init'], 'refresh every gate file', 'const stale = staleGates(top)', 'const stale = GATE_FILES'),
  m(INIT, ['init'], "skip init's --chmod=+x", "  if (shims.length > 0) gitOk(top, ['add', '--chmod=+x', '--', ...shims])\n  if (plain.length + shims.length > 0)", "  if (shims.length > 0) gitOk(top, ['add', '--', ...shims])\n  if (plain.length + shims.length > 0)"),
  m(INIT, ['init'], "skip refresh's --chmod=+x", "  if (shims.length > 0) gitOk(top, ['add', '--chmod=+x', '--', ...shims])\n  const parts = []", "  if (shims.length > 0) gitOk(top, ['add', '--', ...shims])\n  const parts = []"),
  m(INIT, ['init'], 'lay the workflow down in solo mode too', "['.github/workflows/check.yml', 'github/workflows/check.yml', 'team'],", "['.github/workflows/check.yml', 'github/workflows/check.yml', null],"),
  m(INIT, ['init'], "overwrite a repository's own CLAUDE.md or workflow", 'if ((needs !== null && needs !== mode) || fs.existsSync(target)) continue', 'if (needs !== null && needs !== mode) continue'),
  m(INIT, ['init'], "take the mode asked for over a kept marker's", '      mode = project.mode\n', ''),
  m(INIT, ['init'], 'leave the laid-down files unstaged', '  wrote.push(...laid)\n', ''),
  m(INIT, ['init'], 'never ask for branch protection', '  if (laid.includes(WORKFLOW)) parts.push(PROTECTION)\n', ''),
  m(INIT, ['init'], 'ask for branch protection in every mode', '  if (laid.includes(WORKFLOW)) parts.push(PROTECTION)\n', '  parts.push(PROTECTION)\n'),
  m(INIT, ['init'], "refresh skips a team project's missing workflow", 'const laid = layDown(top, mode, PROJECT_FILES.filter(([file]) => file === WORKFLOW))', 'const laid = []'),
  m(INIT, ['init'], 'refresh lays down CLAUDE.md too', 'const laid = layDown(top, mode, PROJECT_FILES.filter(([file]) => file === WORKFLOW))', 'const laid = layDown(top, mode, PROJECT_FILES)'),
  m(INIT, ['init'], 'refresh replaces a workflow that differs', '  const stale = staleGates(top)\n  for', "  const stale = [...staleGates(top), [WORKFLOW, 'github/workflows/check.yml', false]]\n  for"),
  m(INIT, ['init'], 'refresh leaves the workflow unstaged', 'const plain = [...stale.filter(([, , shim]) => !shim).map(([file]) => file), ...laid]', 'const plain = stale.filter(([, , shim]) => !shim).map(([file]) => file)'),
  m(INIT, ['init'], 'refresh reads a marker with a byte-order mark as no mode', `mode = JSON.parse(fs.readFileSync(marker, 'utf8').replace(/^${BOM}/, '')).mode`, "mode = JSON.parse(fs.readFileSync(marker, 'utf8')).mode"),

  // The team-mode workflow, through init's checks of its settled parts and its gates step.
  m(WORKFLOW, ['init'], 'fetch only the tip', '          fetch-depth: 0\n', ''),
  m(WORKFLOW, ['init'], 'run the plain gates, which scan no commit', '        run: echo "pull-request $HEAD_SHA base $BASE_SHA" | scripts/check.sh --push origin origin', '        run: scripts/check.sh'),
  m(WORKFLOW, ['init'], 'a 30-minute timeout', 'timeout-minutes: 10', 'timeout-minutes: 30'),
  m(WORKFLOW, ['init'], 'let runs pile up', '  cancel-in-progress: true\n', ''),
  m(WORKFLOW, ['init'], "run on pull_request_target, with the base's secrets", '  pull_request:\n', '  pull_request_target:\n'),
  m(WORKFLOW, ['init'], 'write access', '  contents: read', '  contents: write'),
  m(WORKFLOW, ['init'], 'leave the token in the checkout', '          persist-credentials: false\n', ''),

  // The gate runner, beyond the secret scan's own mutations, which its self-test runs.
  m(RUNNER, ['init'], 'a runner that reads only ref-named push lines', '.filter((fields) => fields.length === 4)', ".filter((fields) => fields.length === 4 && fields[0].startsWith('refs/'))"),
  m(RUNNER, ['check'], "no line for the gates' own files", "...(log ? [`  full log: ${log}`] : []), ...own] }", "...(log ? [`  full log: ${log}`] : [])] }"),
  m(RUNNER, ['check'], "the gates' own files on every failure", "const own = OWN_FILES.test(output.replace(/\\\\/g, '/'))", 'const own = true'),
  m(RUNNER, ['check'], "the gates' own files missed in backslash paths", "const own = OWN_FILES.test(output.replace(/\\\\/g, '/'))", 'const own = OWN_FILES.test(output)'),
  m(RUNNER, ['check'], 'no line when a run starts', '  if (results === null) writeStart(ctx)\n', ''),
  m(RUNNER, ['check'], 'each line with a run id of its own', 'detail: { mode: ctx.mode, run: ctx.run, ...detail },', "detail: { mode: ctx.mode, run: crypto.randomBytes(4).toString('hex'), ...detail },"),
  m(RUNNER, ['check'], "the gates' own files matched anywhere in a path",'const OWN_FILES = /(?<![\\w.-])(?:\\.githooks\\/|scripts\\/check\\.sh(?![\\w.-]))/', 'const OWN_FILES = /(?:\\.githooks\\/|scripts\\/check\\.sh)/'),

  // The state reader: the batch.
  m(STATE, ['state'], 'drop the After check', 'const waits = story.after.filter((id) => !state.done.has(id))', 'const waits = []'),
  m(STATE, ['state'], 'drop the MVP filter', '(!signedOff && !story.mvp)', 'false'),
  m(STATE, ['state'], 'drop the blocking-question check', 'const blockers = state.questions.filter((q) => q.blocks.includes(story.id)).map((q) => q.id)', 'const blockers = []'),
  m(STATE, ['state'], 'drop the dirty-tree refusal', 'if (!facts.clean) return `The working tree', 'if (false) return `The working tree'),
  m(STATE, ['state'], 'drop the off-branch refusal', 'facts.current === null || facts.current !== facts.name', 'facts.current === null'),
  m(STATE, ['state'], 'drop the diverged refusal', 'if (facts.ahead > 0 && facts.behind > 0)', 'if (false)'),
  m(STATE, ['state'], 'drop the ahead refusal', 'if (facts.ahead > 0) {', 'if (false) {'),
  m(STATE, ['state'], 'drop the behind refusal', 'if (facts.behind > 0) return `${facts.name} is', 'if (false) return `${facts.name} is'),
  m(STATE, ['state'], 'drop the in-review check', 'if (facts.review.has(story.id)) return', 'if (false) return'),
  m(STATE, ['state'], 'drop plan order', '[...stories.values()].sort((a, b) => a.epic - b.epic || minor(a) - minor(b))', '[...stories.values()]'),
  m(STATE, ['state'], 'drop the done check from the list', 'state.done.has(story.id) || (!signedOff', '(!signedOff'),
  m(STATE, ['state'], 'drop the current-phase limit', 'stage.n === 6 ? stage.epic : null', 'null'),
  m(STATE, ['state'], "leave decisions' Answers out of --ids", ', ...state.decisions.map((d) => d.answers).filter(Boolean)', ''),
  m(STATE, ['state'], 'put every requirement in the brief', 'for (const req of story.requirements) {', 'for (const req of state.requirements.keys()) {'),
  m(STATE, ['state'], 'loosen the story-ID match in decisions', '(?<![\\\\d.])', ''),
  m(STATE, ['state'], 'drop the solo push from the landing', ', then \\`git push ${facts.remote} ${name}\\`', ''),
  m(STATE, ['state'], 'drop the repeated-question problem', 'if (asked.has(heading[1]))', 'if (false)'),
  m(STATE, ['state'], 'drop the answered-question problem', 'if (answer !== undefined) problems.push', 'if (false) problems.push'),

  // The state reader: the closing ceremonies and the stage line.
  m(STATE, ['state'], 'drop the Δ>0 refusal of the mvp tag', "if (wait === null) tags.push('mvp')", "tags.push('mvp')"),
  m(STATE, ['state'], 'take the highest tag as the Δ base at stage 8', '.filter((n) => n < current)', ''),
  m(STATE, ['state'], 'drop the tags-only path', 'if (tags.length > 0) {', 'if (false) {'),
  m(STATE, ['state'], "drop stage 9's live check", "if (epic === undefined && !s.tags.has('live')) {", 'if (false) {'),
  m(STATE, ['state'], "drop stage 10's work left", "next: work === undefined ? '/epikloop:plan --extend' : `/epikloop:epic ${work.epic}`", "next: '/epikloop:plan --extend'"),
  m(STATE, ['state'], "drop --retro's start check", "const problem = startProblem(project, facts, 'a retro')", 'const problem = null'),
  m(STATE, ['state'], 'drop the cost grouping by effort', "const key = `${row.tier} at ${EFFORTS.includes(row.effort) ? row.effort : 'an unknown effort'}`", 'const key = `${row.tier} at medium`'),
  m(STATE, ['state'], "drop stage 7's recorded retro", 'recorded(s, `Phase ${epic} retro`) ?', 'false ?'),
  m(STATE, ['state'], "drop stage 8's recorded sign-off", "if (recorded(s, 'MVP sign-off')) {", 'if (false) {'),
  m(STATE, ['state'], 'drop the mark on a step only the human starts', "${humanStarts(next) ? ', which only the human starts' : ''}", ''),
  m(STATE, ['state'], 'read any frontmatter flag as human-only', '/^disable-model-invocation: true\\s*$/m.test(front)', 'front !== ""'),
  m(STATE, ['state', 'smoke'], 'show the credentials in a URL', "    parsed.username = ''\n    parsed.password = ''\n    return parsed.href", '    return parsed.href'),

  // The state reader: the lanes.
  m(STATE, ['state'], 'drop the unknown-lane problem', '  if (lane === null) {\n    const at', '  if (false) {\n    const at'),
  m(STATE, ['state'], "drop the lane's section from the story brief", "  out.push(...laneSection(state, 'Story'))\n", ''),
  m(STATE, ['state'], "drop the lane's line from the retro brief", 'state.lane?.sections.Retro ? [', 'false ? ['),
  m(STATE, ['state'], 'accept any fragment section', 'const extra = Object.keys(lane.sections).filter((name) => !LANE_SECTIONS.includes(name))', 'const extra = []'),
  m(STATE, ['state'], 'accept any allow entry', "const plain = (entry) => typeof entry === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._/:=+,-]*$/.test(entry)", "const plain = (entry) => typeof entry === 'string'"),
  m(STATE, ['state'], 'read a lane by any name', "if (typeof name !== 'string' || !LANE_NAME.test(name)) return null", "if (typeof name !== 'string') return null"),
  m(STATE, ['state'], 'do nothing when run through a link', "if (fs.realpathSync.native(path.resolve(process.argv[1] ?? '.')) === fs.realpathSync.native(import.meta.filename)) {", "if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {"),

  // The staging smoke.
  m(SMOKE, ['smoke'], 'accept any answer', 'if (status >= 200 && status < 300) process.exitCode = 0', 'process.exitCode = 0'),
  m(SMOKE, ['smoke'], 'print the URL as given', 'const shown = shownUrl(url)', 'const shown = url'),
  m(SMOKE, ['smoke'], 'drop the timeout', ', signal: AbortSignal.timeout(CAP) }', ' }'),
  m(SMOKE, ['smoke'], 'drop Basic auth', "    headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`\n", ''),

  // doctor.
  m(DOCTOR, ['doctor'], 'drop the Node floor', 'if (below(nodeVersion, FLOORS.node)) {', 'if (false) {'),
  m(DOCTOR, ['doctor'], "drop the API key's hour check", 'else if (API.includes(method) && hourCache(env, home, opened?.root ?? cwd))', 'else if (API.includes(method))'),
  m(DOCTOR, ['doctor'], "drop the session's events check", 'else if (sessionWrites(home, session, now))', 'else if (true)'),
  m(DOCTOR, ['doctor'], "count the gate runner's folded lines", " && !line.includes('\"kind\":\"gate.')", ''),
  m(DOCTOR, ['doctor'], "fold today's events", ' || entry.name >= today', ''),
  m(DOCTOR, ['doctor'], "take another tool's hooks for unarmed", "else if (hooks === '') fix(", 'else if (true) fix('),
  m(DOCTOR, ['doctor'], 'count the UI test tool as installed without its package', "if (typeof version === 'string') ok(", 'if (true) ok('),
  m(DOCTOR, ['doctor'], "skip the lanes' requirements", 'missing: (readLane(name)?.requires ?? []).filter((program) => !onPath(program))', 'missing: []'),
  m(DOCTOR, ['doctor'], "take the project's lane's missing program for a note", 'if (own === undefined) note(', 'if (true) note('),
  m(DOCTOR, ['doctor'], 'skip the team check', "  if (opened.project?.mode === 'team') {", '  if (false) {'),
  m(DOCTOR, ['doctor'], 'report the team check in solo mode too', "  if (opened.project?.mode === 'team') {", '  if (true) {'),
  m(DOCTOR, ['doctor'], 'count a missing workflow as in place', "if (fs.existsSync(path.join(opened.root, '.github', 'workflows', 'check.yml')))", 'if (true)'),

  // This repository's laws.
  m(LAWS, ['laws'], 'raise the ceiling', 'const CEILING = 700', 'const CEILING = 7000'),
  m(LAWS, ['laws'], 'leave injections uncounted', "return out.text ?? ''", "return ''"),
  m(LAWS, ['laws'], 'read shell files by name only', 'SHELL_NAME.test(file) || SHELL_LINE.test(firstLine(path.join(root, file)))', 'SHELL_NAME.test(file)'),
  m(LAWS, ['laws'], "don't follow hook code's imports", '    for (const match of text.matchAll(RELATIVE_IMPORT)) queue.push(path.resolve(path.dirname(file), match[1]))\n', ''),
  m(LAWS, ['laws'], 'leave Harbor unread', "  queue.push(...walk(path.join(root, 'plugins', 'epikloop-harbor')).filter((file) => CODE.test(file)))\n", ''),
  m(LAWS, ['laws'], 'take any sign-off as the author', 'if (!signers.includes(email.toLowerCase()))', 'if (signers.length === 0)'),
  m(LAWS, ['laws'], 'ask merges for a sign-off', "commits(root, '%h%x00%ae%x00%s%x00%B', ['--no-merges'])", "commits(root, '%h%x00%ae%x00%s%x00%B', [])"),
  m(LAWS, ['laws'], 'pass a shallow clone', "if (gitOk(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {", 'if (false) {'),
  m(LAWS, ['laws'], 'forget Copilot', 'claude|anthropic|copilot|openai', 'claude|anthropic|openai'),
  m(LAWS, ['laws'], 'accept a scaffold with more in it', "else if (!SCAFFOLD.test(fs.readFileSync(path.join(root, file), 'utf8')))", 'else if (false)'),
  m(LAWS, ['laws'], 'accept a scaffold outside a case folder', 'const SCAFFOLD_PATH = /^plugins\\/[^/]+\\/evals\\/[^/]+\\/scaffold\\.sh$/', 'const SCAFFOLD_PATH = /scaffold\\.sh$/'),
  m(LAWS, ['laws'], 'count a two-sentence description as one', ' && !/[.!?]\\s/.test(text)', ''),
  m(LAWS, ['laws'], 'let any skill set a name', "if (shown !== FRONT_DOOR && 'name' in fields)", 'if (false)'),
  m(LAWS, ['laws'], 'let the front door go without its name', "if (shown === FRONT_DOOR && fields.name !== 'epikloop')", 'if (false)'),
  m(LAWS, ['laws'], 'ask no skill for an effort', "if (fields['user-invocable'] !== 'false' && !EFFORTS.includes(fields.effort)) {", 'if (false) {'),
  m(LAWS, ['laws'], 'let a skill pin a model', "    if ('model' in fields) say('pins a model; only the worker does')\n", ''),
  m(LAWS, ['laws'], 'let the worker go without a model', "if (shown === WORKER && (typeof fields.model !== 'string' || fields.model === 'inherit'))", 'if (false)'),
  m(LAWS, ['laws'], 'take an unquoted bracket', "const NEEDS_QUOTES = /[[\\]{}<>\"]|^'/", "const NEEDS_QUOTES = /[\"]|^'/"),
  m(LAWS, ['laws'], "read past a line the laws can't read", 'for (const [line, text] of unread) say(', 'for (const [line, text] of []) say('),
  m(LAWS, ['laws'], 'accept a hook in shell form', "if (hook.type !== 'command' || hook.command !== 'node' || !Array.isArray(hook.args))", 'if (false)'),
  m(LAWS, ['laws'], 'allow a WorktreeCreate hook', 'if (WORKTREE.test(event))', 'if (false)'),
  m(LAWS, ['laws'], 'leave the hooks module unread', 'const queue = (config.modules ?? []).map(', 'const queue = [].map('),
  m(LAWS, ['laws'], 'allow a blocking hook on any tool', 'if (TOOL_EVENTS.has(event) && !tools.every((tool) => SHELLS.includes(tool)))', 'if (false)'),
  m(LAWS, ['laws'], "forget the guard's onFailure", " && hook.onFailure === 'block') guarded = true", ') guarded = true'),
  m(LAWS, ['laws'], 'accept a backslash in a path', "if (text.includes('\\\\')) problems.push", 'if (false) problems.push'),
  m(LAWS, ['laws'], 'leave the hooks a manifest names unread', 'if (entry !== path.resolve(standard)) configs.push([entry, json(entry)])', 'if (false) configs.push([entry, json(entry)])'),
  m(LAWS, ['laws'], 'accept a schema without a format', "if ((schema.required ?? []).includes('format') && Number.isInteger(format) && format > 0) formats.set(name, format)", 'if (true) formats.set(name, format)'),
  m(LAWS, ['laws'], 'take any key for snake_case', 'const KEY = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|\\$schema|T[1-3])$/', 'const KEY = /^/'),
  m(LAWS, ['laws'], "check a schema's top-level properties only", '        walk(value, `${at}/${key}`)\n', ''),
  m(LAWS, ['laws'], "check a file's top-level keys only", '        keys(item, place)\n', ''),
  m(LAWS, ['laws'], 'leave the examples and lanes unread', 'for (const [file, name] of data) {', 'for (const [file, name] of []) {'),
  m(LAWS, ['laws'], 'allow a top-level bin/', 'files.some((file) => file.startsWith(`plugins/${plugin}/bin/`))', 'false'),

  // The eval suite's fixture project.
  m(FIXTURE, ['fixture'], 'plan without freezing the MVP', "marker: { mvp_frozen: '2026-10-31', hours_per_day: 2, deadline: null },", 'marker: { hours_per_day: 2, deadline: null },'),
  m(FIXTURE, ['fixture'], 'spec the greeter without its requirement', '## REQ-GREET-001 Greet by name', '## Greet by name'),
  m(FIXTURE, ['fixture'], 'drop a fixture a case builds', '  parked: [SPECIFY, ARCHITECT, PLAN, PARK],\n', ''),
  m(FIXTURE, ['fixture'], 'give the empty fixture a commit', '  empty: [],', '  empty: [SPECIFY],'),
  m(FIXTURE, ['fixture'], 'build over a folder that has files in it', '  if (fs.readdirSync(dir).length > 0) throw new Error(', '  if (false) throw new Error('),
  m(FIXTURE, ['fixture'], 'set gates that fail on the fixture', "marker: { gates: { commands: { test: 'node --test' } } },", "marker: { gates: { commands: { test: 'node --no-such-flag' } } },"),
  m(FIXTURE, ['fixture'], "give existing code a test that fails", 'return `Hello, ${name}!`', 'return `Hi, ${name}!`'),
  m(FIXTURE, ['fixture'], 'take any scaffold for the shim', 'const fixture = SHIM.exec(', 'const fixture = / ([a-z][a-z0-9-]*)\\n/.exec('),
  m(FIXTURE, ['fixture'], "count a scaffold case.yaml never runs", "const runs = fs.existsSync(yaml) && /^\\s+scaffold_script: scaffold\\.sh\\s*$/m.test(fs.readFileSync(yaml, 'utf8'))", 'const runs = true'),
  m(FIXTURE, ['fixture'], 'build the fixtures before a batch without a remote', '  if (REMOTE.has(name)) {', '  if (false) {'),
  m(FIXTURE, ['fixture'], 'give every fixture a remote', '  if (REMOTE.has(name)) {', '  if (true) {'),
  m(FIXTURE, ['fixture'], 'push to the network URL', "    git(dir, ['config', `url.${bare}.pushInsteadOf`, url])\n", ''),

  // The eval suite's runner.
  m(EVALS, ['evals'], 'take not_contains for contains', 'return { ok: found === 0,', 'return { ok: found > 0,'),
  m(EVALS, ['evals'], 'count no call as enough', 'const min = grader.min ?? 1', 'const min = grader.min ?? 0'),
  m(EVALS, ['evals'], 'count the files that were already there', 'created: listFiles(work).filter((file) => !before.has(file)),', 'created: listFiles(work),'),
  m(EVALS, ['evals'], "leave the run's events behind", "if (inside(JSON.parse(fs.readFileSync(file, 'utf8')).cwd)) {", 'if (false) {'),
  m(EVALS, ['evals'], "leave the run's cost rows behind", "    fs.rmSync(folder, { recursive: true, force: true })\n", ''),
  m(EVALS, ['evals'], 'delete events from elsewhere too', "const inside = (cwd) => typeof cwd === 'string' && roots.some(", 'const inside = (cwd) => true || roots.some('),
  m(EVALS, ['evals'], 'ignore the cost cap', 'if (!ctx.budget()) return', 'if (false) return'),
  m(EVALS, ['evals'], 'let a session run past its timeout', '      timedOut = true\n      stop(child)\n', '      timedOut = true\n'),
  m(EVALS, ['evals'], 'read a file outside the workspace', "if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(", 'if (false) throw new Error('),
  m(EVALS, ['evals'], 'read a glob as one file name', "if (spec.path.includes('*')) {", 'if (false) {'),
  m(EVALS, ['evals'], 'read only the first file a glob matches', '.filter((file) => glob.test(file)).sort()', '.filter((file) => glob.test(file)).sort().slice(0, 1)'),
  m(EVALS, ['evals'], "take a field the runner doesn't read", 'if (!known.includes(key)) say(', 'if (false) say('),
  m(EVALS, ['evals'], 'grant Agent to every case', '...READ_ONLY.filter((tool) => !listed.includes(tool))', "...READ_ONLY.filter((tool) => !listed.includes(tool) && tool !== 'Agent')"),
  m(EVALS, ['evals'], 'grant a case a tool beyond the read-only ones', 'if (!READ_ONLY.includes(tool)) say(', 'if (false) say('),
  m(EVALS, ['evals'], 'pass a session that ended in error', 'runs.every((run) => run.error === null && run.graded.every(', 'runs.every((run) => run.graded.every('),
  m(EVALS, ['evals'], 'start a case without its fixture', 'if (loaded.fixture !== null) {', 'if (false) {'),
  m(EVALS, ['evals'], "hand a session the Claude Code session that started the runner", 'Object.entries(process.env).filter(([key]) => !INHERITED.test(key))', 'Object.entries(process.env)'),
  m(EVALS, ['evals'], "leave a session the caller's PWD", '{ ...own, PWD: work, DISABLE_AUTOUPDATER', '{ ...own, DISABLE_AUTOUPDATER'),
]
