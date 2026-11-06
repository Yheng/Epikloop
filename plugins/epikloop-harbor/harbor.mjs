// server/main.mjs
import { fork, spawn } from "node:child_process";
import fs8 from "node:fs";
import os6 from "node:os";
import path8 from "node:path";

// server/flag.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var EVERY = 1e3;
var GRACE = 5e3;
function configFile(home = os.homedir()) {
  return path.join(home, ".epikloop", "config.json");
}
function flagIn(text3) {
  let config;
  try {
    config = JSON.parse(text3.charCodeAt(0) === 65279 ? text3.slice(1) : text3);
  } catch {
    return null;
  }
  return typeof config === "object" && config !== null && "harbor" in config && config.harbor === true;
}
function flagReader({ file = configFile(), now = () => performance.now() } = {}) {
  let seen = "";
  let reading = null;
  let since = null;
  let trouble = null;
  const settle = (flag) => {
    since = null;
    trouble = null;
    reading = flag;
    return flag;
  };
  const fail = (why) => {
    seen = "";
    trouble = why;
    if (since === null) since = now();
    return now() - since >= GRACE ? false : reading;
  };
  const failed = (error) => {
    const code = (
      /** @type {NodeJS.ErrnoException} */
      error.code
    );
    if (code === "ENOENT" || code === "ENOTDIR") {
      seen = "";
      return settle(false);
    }
    return fail(`can't be read (${code ?? String(error)})`);
  };
  return {
    file,
    trouble: () => trouble,
    read() {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch (error) {
        return failed(error);
      }
      const key = `${stat.size} ${stat.mtimeMs}`;
      if (key === seen) return reading;
      let text3;
      try {
        text3 = fs.readFileSync(file, "utf8");
      } catch (error) {
        return failed(error);
      }
      const flag = flagIn(text3);
      if (flag === null) return fail("doesn't parse");
      seen = key;
      return settle(flag);
    }
  };
}
async function flagAtLaunch(reader, retry = 100) {
  for (; ; ) {
    const flag = reader.read();
    if (flag !== null) return flag;
    await new Promise((resolve) => setTimeout(resolve, retry));
  }
}
function watchFlag(reader, off, every = EVERY) {
  const timer = setInterval(() => {
    if (reader.read() !== false) return;
    clearInterval(timer);
    off();
  }, every);
  return () => clearInterval(timer);
}

// server/fold.mjs
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
var FOLD_EVERY = 6e4;
var STALE = 10 * 60 * 1e3;
var NAME = /^(\d+)-[^-]+-(\d+)\.json$/;
var DAY = /^\d{4}-\d{2}-\d{2}$/;
function placeOf(name) {
  const [, ms, seq] = (
    /** @type {RegExpExecArray} */
    NAME.exec(name)
  );
  return [Number(ms), Number(seq)];
}
function writeOrder(a, b) {
  const [msA, seqA] = placeOf(a);
  const [msB, seqB] = placeOf(b);
  return msA - msB || seqA - seqB;
}
function fold(folder, target) {
  const lock = `${target}.lock`;
  if (!take(lock)) return { folded: 0, left: names(folder).length, busy: true };
  try {
    return append(folder, target);
  } finally {
    try {
      fs2.rmSync(lock, { force: true });
    } catch {
    }
  }
}
function take(lock) {
  try {
    fs2.closeSync(fs2.openSync(lock, "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - fs2.statSync(lock).mtimeMs > STALE) fs2.rmSync(lock, { force: true });
    } catch {
    }
    return false;
  }
}
function names(folder) {
  try {
    return fs2.readdirSync(folder).filter((name) => NAME.test(name)).sort(writeOrder);
  } catch (error) {
    if (
      /** @type {NodeJS.ErrnoException} */
      error.code === "ENOENT"
    ) return [];
    throw error;
  }
}
function append(folder, target) {
  const all = names(folder);
  const lines = [];
  const folded = [];
  for (const name of all) {
    const file = path2.join(folder, name);
    try {
      lines.push(`${JSON.stringify(JSON.parse(fs2.readFileSync(file, "utf8")))}
`);
      folded.push(file);
    } catch {
    }
  }
  if (lines.length > 0) fs2.appendFileSync(target, lines.join(""));
  for (const file of folded) fs2.rmSync(file);
  return { folded: folded.length, left: all.length - folded.length };
}
function entries(dir) {
  try {
    return fs2.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function foldersUnder(home, now) {
  const root = path2.join(home, ".epikloop");
  const today = new Date(now).toISOString().slice(0, 10);
  const found = [];
  for (const entry of entries(path2.join(root, "events"))) {
    if (!entry.isDirectory() || !DAY.test(entry.name) || entry.name >= today) continue;
    const folder = path2.join(root, "events", entry.name);
    found.push({ kind: "events", folder, target: `${folder}.jsonl` });
  }
  for (const entry of entries(path2.join(root, "projects"))) {
    if (!entry.isDirectory()) continue;
    const project = path2.join(root, "projects", entry.name);
    found.push({ kind: "cost", folder: path2.join(project, "cost"), target: path2.join(project, "cost.jsonl") });
  }
  return found;
}
function foldPass(home = os2.homedir(), now = Date.now()) {
  const pass = { events: 0, rows: 0, busy: 0, failed: [] };
  for (const { kind, folder, target } of foldersUnder(home, now)) {
    try {
      if (names(folder).length === 0) continue;
      const done = fold(folder, target);
      if (done.busy) pass.busy++;
      if (kind === "events") pass.events += done.folded;
      else pass.rows += done.folded;
    } catch (error) {
      const why = (
        /** @type {NodeJS.ErrnoException} */
        error.code ?? (error instanceof Error ? error.message : String(error))
      );
      pass.failed.push({ folder, why });
    }
  }
  return pass;
}
function folding({
  home = os2.homedir(),
  every = FOLD_EVERY,
  now = () => Date.now(),
  say = (line) => console.log(line)
} = {}) {
  const pass = () => {
    const { failed } = foldPass(home, now());
    if (failed.length === 0) return;
    const [first] = failed;
    const what = failed.length === 1 ? "a folder" : `${failed.length} folders`;
    say(`Couldn't fold ${what} of Epikloop's files, such as ${first.folder} (${first.why}); the next pass tries again.`);
  };
  pass();
  const timer = setInterval(pass, every);
  timer.unref();
  return { close: () => clearInterval(timer) };
}

// server/http.mjs
import fs3 from "node:fs";
import http from "node:http";
import path3 from "node:path";

// package.json
var package_default = {
  name: "epikloop-harbor",
  version: "0.1.0",
  private: true,
  description: "A local page that draws Epikloop's pipeline as an office.",
  type: "module",
  engines: {
    node: ">=22"
  },
  scripts: {
    lint: "node tools/laws.mjs",
    typecheck: "tsc --noEmit",
    test: 'node --test "test/**/*.test.mjs"',
    build: "node tools/build.mjs",
    "test:e2e": "playwright test",
    staging: "node tools/staging.mjs",
    prepare: "node .githooks/check.mjs --arm"
  },
  devDependencies: {
    "@playwright/test": "1.64.1",
    "@types/node": "22.20.5",
    esbuild: "0.28.2",
    typescript: "7.0.2"
  }
};

// server/http.mjs
var HOST = "127.0.0.1";
var HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
var TEXT = "text/plain; charset=utf-8";
var KEEP_ALIVE = 15e3;
var HEALTH = JSON.stringify({ app: "epikloop-harbor", version: package_default.version, format: 1 });
function commitHeader(commit) {
  return typeof commit === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit) ? { "X-Commit": commit } : {};
}
var FILES = /* @__PURE__ */ new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/harbor.js", { file: "harbor.js", type: "text/javascript; charset=utf-8" }],
  ["/harbor.js.map", { file: "harbor.js.map", type: "application/json; charset=utf-8" }],
  ["/harbor.css", { file: "harbor.css", type: "text/css; charset=utf-8" }],
  ["/harbor.css.map", { file: "harbor.css.map", type: "application/json; charset=utf-8" }]
]);
var ART_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;
function artFiles(client) {
  let entries2;
  try {
    entries2 = fs3.readdirSync(path3.join(client, "art"), { withFileTypes: true });
  } catch {
    return /* @__PURE__ */ new Map();
  }
  const names2 = entries2.filter((entry) => entry.isFile() && ART_NAME.test(entry.name)).map((entry) => entry.name);
  return new Map(names2.sort().map((name) => [`/art/${name}`, { file: path3.join("art", name), type: "image/png" }]));
}
var GET_ONLY = { status: 405, headers: { Allow: "GET" }, body: "Harbor answers GET only\n" };
function admits(headers, port) {
  const names2 = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (port === 80) names2.push("127.0.0.1", "localhost");
  const { host = [], origin = [] } = headers;
  if (host.length !== 1 || !names2.includes(host[0])) return false;
  return origin.length === 0 || origin.length === 1 && names2.some((name) => origin[0] === `http://${name}`);
}
function refusal(req, port) {
  if (!admits(req.headersDistinct, port)) {
    return { status: 403, headers: {}, body: `Harbor answers only its own page, at http://127.0.0.1:${port}/ or http://localhost:${port}/
` };
  }
  return req.method === "GET" ? null : GET_ONLY;
}
function listen({ port, client, feed, commit }) {
  const stamp = commitHeader(commit);
  const files = new Map([...FILES, ...artFiles(client)]);
  let own = port;
  const server = http.createServer({ requireHostHeader: false }, (req, res) => {
    answer(req, res, client, files, feed, own, stamp).catch(() => res.destroy());
  });
  server.on("connect", (req, socket) => {
    socket.on("error", () => socket.destroy());
    const { status, headers, body } = refusal(req, own) ?? GET_ONLY;
    socket.end(raw(status, headers, body), () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address === "object" && address !== null) own = address.port;
      resolve(server);
    });
  });
}
async function answer(req, res, client, files, feed, port, stamp) {
  const refused = refusal(req, port);
  if (refused !== null) return send(res, refused.status, TEXT, refused.body, refused.headers);
  const route = (req.url ?? "/").split("?")[0];
  if (route === "/health") return send(res, 200, "application/json; charset=utf-8", HEALTH, stamp);
  if (route === "/events") return stream(res, feed);
  const served = files.get(route);
  if (served === void 0) return send(res, 404, TEXT, "Not found\n");
  let body;
  try {
    body = await fs3.promises.readFile(path3.join(client, served.file));
  } catch (error) {
    const missing = (
      /** @type {NodeJS.ErrnoException} */
      error.code === "ENOENT"
    );
    return send(res, missing ? 404 : 500, TEXT, missing ? "Not found\n" : "Could not read the file\n");
  }
  send(res, 200, served.type, body);
}
function stream(res, feed) {
  res.writeHead(200, { ...HEADERS, "Content-Type": "text/event-stream" });
  res.write("retry: 2000\n\n");
  const send2 = (state) => res.write(`event: state
id: ${state.seq}
data: ${JSON.stringify(state)}

`);
  const now = feed.current();
  if (now !== null) send2(now);
  const off = feed.subscribe(send2);
  const alive = setInterval(() => res.write(": keep-alive\n\n"), KEEP_ALIVE);
  alive.unref();
  res.on("close", () => {
    off();
    clearInterval(alive);
  });
}
function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { ...HEADERS, ...headers, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function raw(status, headers, body) {
  const all = { ...HEADERS, ...headers, "Content-Type": TEXT, "Content-Length": String(Buffer.byteLength(body)), Connection: "close" };
  const lines = Object.entries(all).map(([name, value]) => `${name}: ${value}\r
`);
  return `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r
${lines.join("")}\r
${body}`;
}

// server/watch.mjs
import os5 from "node:os";

// server/costs.mjs
import fs4 from "node:fs";
import os3 from "node:os";
import path4 from "node:path";
var PROJECT_ID = /^[0-9a-f]{12}$/;
var STORY = /^\d+\.\d+$/;
var TIER = /^T[123]$/;
var WAITING = /^\d+-[^-]+-\d+\.json$/;
function costFolder(id, home = os3.homedir()) {
  if (!PROJECT_ID.test(id)) return null;
  return path4.join(home, ".epikloop", "projects", id);
}
function rowIn(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = (
    /** @type {Record<string, unknown>} */
    value
  );
  if (v.format !== 1) return null;
  if (typeof v.story !== "string" || !STORY.test(v.story)) return null;
  if (typeof v.tier !== "string" || !TIER.test(v.tier)) return null;
  if (typeof v.wall !== "number" || !Number.isFinite(v.wall) || v.wall <= 0) return null;
  if (v.cost !== void 0 && v.cost !== null && (typeof v.cost !== "number" || !Number.isFinite(v.cost) || v.cost < 0)) return null;
  return (
    /** @type {CostRow} */
    value
  );
}
function text(file) {
  try {
    return fs4.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
function readCosts(id, home = os3.homedir()) {
  const found = { stories: /* @__PURE__ */ new Map(), skipped: 0 };
  const dir = costFolder(id, home);
  if (dir === null) return found;
  const rows = /* @__PURE__ */ new Map();
  const take2 = (line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      found.skipped++;
      return;
    }
    const row = rowIn(value);
    if (row === null) {
      found.skipped++;
      return;
    }
    rows.set(JSON.stringify(value), row);
  };
  const folded = text(path4.join(dir, "cost.jsonl"));
  if (folded !== null) {
    const end = folded.lastIndexOf("\n");
    for (const line of folded.slice(0, end + 1).split("\n")) if (line.trim() !== "") take2(line);
  }
  let waiting = [];
  try {
    waiting = fs4.readdirSync(path4.join(dir, "cost")).filter((name) => WAITING.test(name));
  } catch {
  }
  for (const name of waiting.sort()) {
    const body = text(path4.join(dir, "cost", name));
    if (body !== null) take2(body);
  }
  for (const row of rows.values()) {
    const story = found.stories.get(row.story) ?? { wall: 0, cost: null };
    story.wall += row.wall;
    if (typeof row.cost === "number") story.cost = (story.cost ?? 0) + row.cost;
    found.stories.set(row.story, story);
  }
  return found;
}

// server/derive.mjs
var ACTIVE_FOR = 7 * 864e5;
var PROMPT_FOR = 24 * 36e5;
var RUN_FOR = 30 * 6e4;
var RESULT_FOR = 2 * 6e4;
var WORKER_FOR = 30 * 6e4;
var REVIEW = /^Review (\d+\.\d+)$/;
var STORY2 = /^\d+\.\d+$/;
function asksPermission(event) {
  return event.kind === "permission.requested" || event.kind === "notification" && event.detail?.notification_type === "permission_prompt";
}
function promptsOf(sessions, now) {
  return sessions.filter((event) => asksPermission(event) && now - Date.parse(event.ts) < PROMPT_FOR).map((event) => ({
    session: event.session_id.slice(0, 8),
    since: event.ts,
    story: typeof event.story === "string" && STORY2.test(event.story) ? event.story : null
  })).sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || order(a.session, b.session));
}
function gateRunsOf(runs, now) {
  return runs.flatMap(({ run, mode, since, session, ended }) => {
    if (ended || since === null || mode === null || session === null || !(now - Date.parse(since) < RUN_FOR)) return [];
    return [{ run, mode, since, session: session.slice(0, 8) }];
  }).sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || order(a.run, b.run));
}
function gateResultsOf(runs, now) {
  return runs.flatMap(({ run, mode, session, results }) => {
    if (results === null || !(now - Date.parse(results.at) < RESULT_FOR)) return [];
    const named = mode ?? results.mode;
    const by = session ?? results.session;
    if (named === null || by === null) return [];
    const failed = [...results.failed].sort((a, b) => a[1] - b[1] || order(a[0], b[0])).map(([gate]) => gate);
    return [{ run, mode: named, session: by.slice(0, 8), at: results.at, passed: !results.failing, failed }];
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || order(a.run, b.run));
}
function workersOf(agents, ends, now) {
  return agents.flatMap(({ session_id, story, since, stopped, at }) => {
    if (story === null || since === null) return [];
    const started = Date.parse(since);
    if (stopped >= started || (ends.get(session_id) ?? -Infinity) >= started || !(now - at < WORKER_FOR)) return [];
    return [{ story, session: session_id.slice(0, 8), since }];
  }).sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || order(a.session, b.session) || order(a.story, b.story));
}
function deriveProject({ id, name, lastEventAt, repo, git, costs, sessions = [], runs = [], agents = [], ends = /* @__PURE__ */ new Map() }, now) {
  if (repo.id !== id) return null;
  const tags = git?.tags ?? /* @__PURE__ */ new Set();
  const landed = git?.landed ?? /* @__PURE__ */ new Map();
  const onBranches = git?.review ?? /* @__PURE__ */ new Set();
  const plan = /* @__PURE__ */ new Map();
  for (const phase of repo.phases) for (const story of phase.stories) plan.set(story.id, { tier: story.tier, at: plan.size });
  const isT3 = (story) => plan.get(story)?.tier === "T3";
  const phases = repo.phases.map((phase) => {
    const tagged = tags.has(`phase-${phase.n}`);
    const mvps = phase.stories.filter((story) => story.mvp);
    return {
      n: phase.n,
      tagged,
      inRetro: mvps.length > 0 && mvps.every((story) => landed.has(story.id)) && !tagged,
      stories: phase.stories.map((story) => {
        const at = landed.get(story.id);
        const spent = costs.get(story.id);
        return {
          id: story.id,
          title: story.title,
          tier: story.tier,
          mvp: story.mvp,
          landedAt: at === void 0 ? null : new Date(at).toISOString(),
          wall: spent?.wall ?? null,
          cost: spent?.cost ?? null
        };
      })
    };
  });
  const questions = [];
  const reviews = /* @__PURE__ */ new Map();
  for (const question of repo.questions) {
    const story = REVIEW.exec(question.title)?.[1];
    if (story !== void 0 && isT3(story)) {
      if (!reviews.has(story)) reviews.set(story, { story, source: "queue" });
    } else {
      questions.push({ id: question.id, date: question.date, blocks: [...question.blocks] });
    }
  }
  for (const story of onBranches) {
    if (isT3(story) && !landed.has(story) && !reviews.has(story)) reviews.set(story, { story, source: "branch" });
  }
  const age = now - Date.parse(lastEventAt);
  const recent = Number.isFinite(age) && age <= ACTIVE_FOR;
  if (!recent && questions.length === 0 && reviews.size === 0) return null;
  return {
    id,
    name,
    lastEventAt,
    mvp: tags.has("mvp"),
    phases,
    questions,
    reviews: [...reviews.values()].sort((a, b) => (plan.get(a.story)?.at ?? 0) - (plan.get(b.story)?.at ?? 0)),
    prompts: promptsOf(sessions, now),
    gateRuns: gateRunsOf(runs, now),
    gateResults: gateResultsOf(runs, now),
    workers: workersOf(agents, ends, now)
  };
}
var order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function derive(sources, { now, seq }) {
  const projects = sources.flatMap((project) => deriveProject(project, now) ?? []);
  projects.sort((a, b) => order(a.name.toLowerCase(), b.name.toLowerCase()) || order(a.name, b.name) || order(a.id, b.id));
  return { format: 1, seq, at: new Date(now).toISOString(), projects };
}

// server/events.mjs
import fs5 from "node:fs";
import os4 from "node:os";
import path5 from "node:path";
var RECENT_DAYS = 8;
var REPORT_EVERY = 6e4;
var DAY_MS = 864e5;
var DAY2 = /^\d{4}-\d{2}-\d{2}$/;
var FOLDED = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
var WAITING2 = /^\d+-[^-]+-\d+\.json$/;
var PROJECT_ID2 = /^[0-9a-f]{12}$/;
var RUN = /^[0-9A-Za-z-]{1,64}$/;
var MODE = /^[a-z][a-z-]{0,15}$/;
var GATE_RESULT = /* @__PURE__ */ new Set(["gate.passed", "gate.failed"]);
var GATE = /^[a-z][a-z0-9-]{0,63}$/;
var STORY3 = /^\d+\.\d+$/;
var TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function gateLine(event) {
  const run = event.detail?.run;
  if (typeof run !== "string" || !RUN.test(run)) return null;
  if (event.kind === "gate.started") {
    const mode = event.detail?.mode;
    return typeof mode === "string" && MODE.test(mode) ? { run, start: { mode } } : null;
  }
  return GATE_RESULT.has(event.kind) ? { run, start: null } : null;
}
function eventsFolder(home = os4.homedir()) {
  return path5.join(home, ".epikloop", "events");
}
function eventIn(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = (
    /** @type {Record<string, unknown>} */
    value
  );
  if (v.format !== 1) return null;
  if (typeof v.ts !== "string" || !TS.test(v.ts) || !Number.isFinite(Date.parse(v.ts))) return null;
  if (typeof v.project_id !== "string" || !PROJECT_ID2.test(v.project_id)) return null;
  for (const key of ["cwd", "session_id", "kind"]) {
    if (typeof v[key] !== "string" || v[key] === "") return null;
  }
  return (
    /** @type {Event} */
    value
  );
}
function eventOf(line) {
  try {
    return eventIn(JSON.parse(line));
  } catch {
    return null;
  }
}
var raises = (event) => asksPermission(event);
var dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
var gone = (error) => {
  const code = (
    /** @type {NodeJS.ErrnoException} */
    error.code
  );
  return code === "ENOENT" || code === "ENOTDIR";
};
function eventLog({
  folder = eventsFolder(),
  now = () => Date.now(),
  say = (line) => console.log(line),
  pause = () => new Promise((resolve) => setImmediate(resolve))
} = {}) {
  const projects = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const runs = /* @__PURE__ */ new Map();
  const agents = /* @__PURE__ */ new Map();
  const ends = /* @__PURE__ */ new Map();
  const days = /* @__PURE__ */ new Map();
  const queued = /* @__PURE__ */ new Set();
  let scan = Promise.resolve();
  let started = false;
  let closed = false;
  let changed = false;
  let skipped = 0;
  let reported = -Infinity;
  const take2 = (event, full) => {
    const at = Date.parse(event.ts);
    const project = projects.get(event.project_id);
    if (!project) {
      projects.set(event.project_id, { at, ts: event.ts, cwd: event.cwd, cwds: /* @__PURE__ */ new Map([[event.cwd, at]]) });
      changed = true;
    } else {
      if (at > project.at || at === project.at && event.cwd > project.cwd) {
        project.at = at;
        project.ts = event.ts;
        project.cwd = event.cwd;
        changed = true;
      }
      const there = project.cwds.get(event.cwd);
      if (there === void 0 || at > there) {
        project.cwds.set(event.cwd, at);
        changed = true;
      }
    }
    if (!full) return;
    const session = sessions.get(event.session_id);
    if (!session || newer(at, event, session)) {
      sessions.set(event.session_id, { at, event });
      changed = true;
    }
    const gate = gateLine(event);
    if (gate !== null && now() - at < RUN_FOR) {
      const key = `${event.project_id} ${gate.run}`;
      let facts = runs.get(key);
      if (facts === void 0) {
        facts = { project_id: event.project_id, run: gate.run, mode: null, since: null, session: null, ended: false, results: null, at };
        runs.set(key, facts);
        changed = true;
      }
      if (at > facts.at) facts.at = at;
      if (gate.start !== null && (facts.since === null || at < Date.parse(facts.since))) {
        facts.since = event.ts;
        facts.mode = gate.start.mode;
        facts.session = event.session_id;
        changed = true;
      }
      if (gate.start === null) result(facts, event, at);
    }
    if (event.kind === "session.end" && at > (ends.get(event.session_id) ?? -Infinity)) {
      ends.set(event.session_id, at);
      changed = true;
    }
    const agent = event.agent;
    if (typeof agent === "string" && agent !== "") {
      const key = `${event.project_id} ${event.session_id} ${agent}`;
      let facts = agents.get(key);
      if (facts === void 0) {
        facts = { project_id: event.project_id, session_id: event.session_id, agent, story: null, since: null, stopped: -Infinity, at };
        agents.set(key, facts);
        changed = true;
      }
      if (at > facts.at) {
        facts.at = at;
        changed = true;
      }
      const story = event.story;
      if (event.kind === "subagent.start" && typeof story === "string" && STORY3.test(story)) {
        const was = facts.since === null ? Infinity : Date.parse(facts.since);
        if (at < was || at === was && facts.story !== null && story < facts.story) {
          facts.since = event.ts;
          facts.story = story;
          changed = true;
        }
      }
      if (event.kind === "subagent.stop" && at > facts.stopped) {
        facts.stopped = at;
        changed = true;
      }
    }
  };
  const result = (facts, event, at) => {
    const mode = typeof event.detail?.mode === "string" && MODE.test(event.detail.mode) ? event.detail.mode : null;
    const failing = event.kind === "gate.failed";
    if (facts.results === null) {
      facts.ended = true;
      facts.results = { at: event.ts, mode, session: event.session_id, failing, failed: /* @__PURE__ */ new Map() };
      changed = true;
    }
    const results = facts.results;
    if (at > Date.parse(results.at)) {
      results.at = event.ts;
      changed = true;
    }
    if (mode !== null && (results.mode === null || mode < results.mode)) {
      results.mode = mode;
      changed = true;
    }
    if (event.session_id < results.session) {
      results.session = event.session_id;
      changed = true;
    }
    if (!failing) return;
    if (!results.failing) {
      results.failing = true;
      changed = true;
    }
    const gate = event.state;
    if (typeof gate !== "string" || !GATE.test(gate)) return;
    const was = results.failed.get(gate);
    if (was === void 0 || at < was) {
      results.failed.set(gate, at);
      changed = true;
    }
  };
  const newer = (at, event, session) => {
    if (at !== session.at) return at > session.at;
    const a = raises(event);
    const b = raises(session.event);
    if (a !== b) return b;
    return JSON.stringify(event) > JSON.stringify(session.event);
  };
  const lines = (text3, full) => {
    for (const line of text3.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const event = eventOf(trimmed);
      if (event) take2(event, full);
      else skipped++;
    }
  };
  const readDay = (name, day) => {
    const dir = path5.join(folder, name);
    let listed = [];
    try {
      listed = fs5.readdirSync(dir).filter((file2) => WAITING2.test(file2));
    } catch {
    }
    const present = new Set(listed);
    for (const file2 of day.names) if (!present.has(file2)) day.names.delete(file2);
    for (const file2 of listed) {
      if (day.names.has(file2)) continue;
      let value;
      try {
        value = JSON.parse(fs5.readFileSync(path5.join(dir, file2), "utf8"));
      } catch {
        continue;
      }
      day.names.add(file2);
      const event = eventIn(value);
      if (event) take2(event, day.full);
      else skipped++;
    }
    const file = path5.join(folder, `${name}.jsonl`);
    let size = -1;
    try {
      const stat = fs5.statSync(file);
      if (stat.isFile()) size = stat.size;
    } catch (error) {
      if (!gone(error)) return;
    }
    if (size === -1) {
      day.offset = 0;
      return;
    }
    if (size < day.offset) day.offset = 0;
    if (size === day.offset) return;
    let bytes;
    try {
      const fd = fs5.openSync(file, "r");
      try {
        bytes = Buffer.alloc(size - day.offset);
        const got = fs5.readSync(fd, bytes, 0, bytes.length, day.offset);
        bytes = bytes.subarray(0, got);
      } finally {
        fs5.closeSync(fd);
      }
    } catch {
      return;
    }
    const end = bytes.lastIndexOf(10);
    if (end === -1) return;
    lines(bytes.toString("utf8", 0, end + 1), day.full);
    day.offset += end + 1;
  };
  const listing = () => {
    const names2 = /* @__PURE__ */ new Set();
    let entries2;
    try {
      entries2 = fs5.readdirSync(folder, { withFileTypes: true });
    } catch {
      return names2;
    }
    for (const entry of entries2) {
      if (entry.isDirectory() && DAY2.test(entry.name)) names2.add(entry.name);
      const folded = FOLDED.exec(entry.name);
      if (folded && entry.isFile()) names2.add(folded[1]);
    }
    return names2;
  };
  const report = () => {
    if (skipped === 0) return;
    const at = now();
    if (at - reported < REPORT_EVERY) return;
    say(`Skipped ${skipped} ${skipped === 1 ? "line" : "lines"} of the event log that ${skipped === 1 ? "isn't a" : "aren't"} format-1 ${skipped === 1 ? "event" : "events"} with the required fields.`);
    skipped = 0;
    reported = at;
  };
  const background = async () => {
    for (const name of [...queued].sort().reverse()) {
      await pause();
      if (closed) return;
      if (!queued.delete(name)) continue;
      const day = { full: false, names: /* @__PURE__ */ new Set(), offset: 0 };
      days.set(name, day);
      readDay(name, day);
    }
    report();
  };
  return {
    folder,
    projects,
    sessions,
    runs,
    agents,
    ends,
    read() {
      const names2 = listing();
      const recent = dayOf(now() - (RECENT_DAYS - 1) * DAY_MS);
      for (const name of [...names2].sort().reverse()) {
        if (queued.has(name)) continue;
        let day = days.get(name);
        if (!day) {
          if (!started && name < recent) {
            queued.add(name);
            continue;
          }
          day = { full: name >= recent, names: /* @__PURE__ */ new Set(), offset: 0 };
          days.set(name, day);
        }
        readDay(name, day);
      }
      for (const name of days.keys()) if (!names2.has(name)) days.delete(name);
      for (const [key, facts] of runs) {
        if (now() - facts.at < RUN_FOR) continue;
        runs.delete(key);
        changed = true;
      }
      for (const [key, facts] of agents) {
        if (now() - facts.at < WORKER_FOR) continue;
        agents.delete(key);
        changed = true;
      }
      if (!started) {
        started = true;
        if (queued.size > 0) scan = background();
      }
      report();
      const was = changed;
      changed = false;
      return was;
    },
    scanned: () => scan,
    close() {
      closed = true;
    }
  };
}

// server/git.mjs
import { execFile } from "node:child_process";
import fs6 from "node:fs";
var LIMIT = 1e4;
var MAX_OUTPUT = 64 * 1024 * 1024;
var SUBCOMMANDS = ["for-each-ref", "log", "rev-parse", "symbolic-ref"];
var GUARDS = [
  "--no-pager",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "protocol.git.allow=never",
  "-c",
  "protocol.http.allow=never",
  "-c",
  "protocol.https.allow=never",
  "-c",
  "protocol.ssh.allow=never",
  "-c",
  "log.showSignature=false",
  "-c",
  "color.ui=never",
  "-c",
  "i18n.logOutputEncoding=UTF-8"
];
var CANDIDATES = ["refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master"];
var LIST_REFS = ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/remotes", "refs/tags"];
var REF_LINE = /^\S+ (\S+)$/;
var FEAT = /^feat\((\d+\.\d+)\):/;
function gitEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) if (!/^GIT_/i.test(key) && value !== void 0) out[key] = value;
  return { ...out, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" };
}
function said(stderr) {
  const lines = stderr.split(/\r?\n/).filter((line) => !/^hint:/.test(line)).map((line) => line.replace(/^(?:fatal|error|warning): /, "").trim()).filter(Boolean);
  return lines.join(" ") || "it gave no reason";
}
function isFolder(dir) {
  try {
    return fs6.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
function runGit(root, args, { git = "git", env = process.env, timeout = LIMIT } = {}) {
  if (!SUBCOMMANDS.includes(args[0])) {
    return Promise.reject(new Error(`Harbor runs only ${SUBCOMMANDS.join(", ")}; it never runs ${args[0]}`));
  }
  const options = { cwd: root, env: gitEnv(env), encoding: (
    /** @type {const} */
    "utf8"
  ), timeout, maxBuffer: MAX_OUTPUT, windowsHide: true };
  const late = `it ran for more than ${timeout / 1e3} seconds`;
  return new Promise((resolve) => {
    const child = execFile(git, [...GUARDS, ...args], options, (error, stdout, stderr) => {
      clearTimeout(backstop);
      if (error === null) return resolve({ how: "ok", out: stdout, why: "" });
      const { code } = error;
      if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return resolve({ how: "stopped", out: "", why: `it printed more than ${MAX_OUTPUT / 1024 / 1024} MB` });
      }
      if (error.killed === true || error.signal) return resolve({ how: "stopped", out: "", why: late });
      if (typeof code === "number") return resolve({ how: "refused", out: "", why: said(stderr) });
      if (!isFolder(root)) return resolve({ how: "refused", out: "", why: "the folder is gone" });
      const why = code === "ENOENT" ? "it isn't installed, or isn't on the PATH" : error.message;
      return resolve({ how: "missing", out: "", why });
    });
    const backstop = setTimeout(() => {
      child.kill();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ how: "stopped", out: "", why: late });
    }, timeout + 2e3);
    backstop.unref();
  });
}
function refsIn(listing) {
  const names2 = listing.split("\n").map((line) => REF_LINE.exec(line.trim())?.[1]).filter((name) => name !== void 0);
  const tags = new Set(names2.filter((name) => name.startsWith("refs/tags/")).map((name) => name.slice("refs/tags/".length)));
  return { branch: CANDIDATES.find((name) => names2.includes(name)) ?? "HEAD", tags };
}
function landedIn(log) {
  const landed = /* @__PURE__ */ new Map();
  for (const line of log.split("\n")) {
    const [time, subject = ""] = line.split("	");
    const feat = FEAT.exec(subject);
    if (feat !== null) landed.set(feat[1], Number(time) * 1e3);
  }
  return landed;
}
function reviewIn(log) {
  const review = /* @__PURE__ */ new Set();
  for (const subject of log.split("\n")) {
    const feat = FEAT.exec(subject);
    if (feat !== null) review.add(feat[1]);
  }
  return review;
}
function gitReader({
  git = "git",
  env = process.env,
  timeout = LIMIT,
  say = (line) => console.log(line),
  run = (root, args) => runGit(root, args, { git, env, timeout })
} = {}) {
  const known = /* @__PURE__ */ new Map();
  const told = /* @__PURE__ */ new Map();
  const reading = /* @__PURE__ */ new Map();
  const tell2 = (scope, line) => {
    if (told.get(scope) === line) return;
    told.set(scope, line);
    say(line);
  };
  const note = (root, part, ran) => {
    const scope = `${part} ${root}`;
    if (ran.how === "ok") {
      told.delete(scope);
      told.delete("");
      return null;
    }
    if (ran.how === "missing") {
      const line2 = `Harbor can't start git (${ran.why}); until it can, every project goes without its landed stories, tags and reviews.`;
      tell2("", line2);
      return line2;
    }
    const what = { refs: "landed stories, tags or reviews", landed: "landed stories", review: "stories in review" }[part];
    const line = `Git can't read the ${what} of ${root} (${ran.why}); until it can, that project goes without them.`;
    tell2(scope, line);
    return line;
  };
  const readOnce = async (root) => {
    const listing = await run(root, LIST_REFS);
    const refsTrouble = note(root, "refs", listing);
    if (refsTrouble !== null) {
      known.delete(root);
      return { branch: null, tags: /* @__PURE__ */ new Set(), landed: /* @__PURE__ */ new Map(), review: /* @__PURE__ */ new Set(), trouble: refsTrouble };
    }
    const { branch, tags } = refsIn(listing.out);
    let key = listing.out;
    let born = true;
    if (branch === "HEAD") {
      const head = await run(root, ["rev-parse", "--verify", "-q", "HEAD"]);
      if (head.how === "missing" || head.how === "stopped") {
        known.delete(root);
        return { branch, tags, landed: /* @__PURE__ */ new Map(), review: /* @__PURE__ */ new Set(), trouble: note(root, "refs", head) };
      }
      key += `
HEAD ${head.out.trim()}`;
      born = head.how === "ok";
    }
    const last = known.get(root);
    if (last !== void 0 && last.key === key) return last.facts;
    const facts = { branch, tags, landed: /* @__PURE__ */ new Map(), review: /* @__PURE__ */ new Set(), trouble: null };
    if (born) {
      const [landedLog, reviewLog] = await Promise.all([
        run(root, ["log", "--format=%ct%x09%s", branch]),
        run(root, ["log", "--format=%s", "--branches", "--remotes", "--not", branch])
      ]);
      const troubles = [note(root, "landed", landedLog), note(root, "review", reviewLog)];
      facts.trouble = troubles.find((line) => line !== null) ?? null;
      if (landedLog.how === "ok") facts.landed = landedIn(landedLog.out);
      if (reviewLog.how === "ok") facts.review = reviewIn(reviewLog.out);
      if (![landedLog, reviewLog].every((ran) => ran.how === "ok" || ran.how === "refused")) {
        known.delete(root);
        return facts;
      }
    }
    known.set(root, { key, facts });
    return facts;
  };
  return (root) => {
    const under = reading.get(root);
    if (under !== void 0) return under;
    const read = readOnce(root).finally(() => reading.delete(root));
    reading.set(root, read);
    return read;
  };
}

// server/projects.mjs
import path7 from "node:path";

// server/repo.mjs
import fs7 from "node:fs";
import path6 from "node:path";
var PROJECT_ID3 = /^[0-9a-f]{12}$/;
var STORY4 = /^\d+\.\d+$/;
var TIER2 = /^T[123]$/;
var STORY_FILE = /^(\d+)-[a-z0-9][a-z0-9-]*\.md$/;
var STORY_HEADING = /^## (\d+\.\d+) (\S.*)$/;
var QUESTION_HEADING = /^### (Q-\d{3,}) (\S.*) \((\d{4}-\d{2}-\d{2})\)$/;
var FIELD = /^- ([A-Z][A-Za-z -]*): (.*)$/;
function text2(file) {
  try {
    return fs7.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
var linesOf = (body) => body.replace(/^﻿/, "").split(/\r?\n/);
var list = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
function fieldsAt(lines, i, names2) {
  const fields = {};
  let at = i;
  while (at < lines.length && lines[at].trim() === "") at += 1;
  for (; at < lines.length; at += 1) {
    const field = FIELD.exec(lines[at]);
    if (field === null || !names2.includes(field[1])) break;
    if (!(field[1] in fields)) fields[field[1]] = field[2].trim();
  }
  return { fields, next: at };
}
function projectId(root) {
  const body = text2(path6.join(root, ".epikloop", "project.json"));
  if (body === null) return null;
  try {
    const value = JSON.parse(body.replace(/^﻿/, ""));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return typeof value.id === "string" && PROJECT_ID3.test(value.id) ? value.id : null;
  } catch {
    return null;
  }
}
function readPhase(n, body, seen) {
  const lines = linesOf(body);
  const first = lines.findIndex((line) => line.startsWith("# "));
  const opening = first === -1 ? null : new RegExp(`^# Epic ${n}: (\\S.*)$`).exec(lines[first].trim());
  const stories = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("## ")) continue;
    const heading = STORY_HEADING.exec(lines[i].trimEnd());
    if (heading === null) continue;
    const id = heading[1];
    if (Number(id.split(".")[0]) !== n || seen.has(id)) continue;
    seen.add(id);
    const { fields, next } = fieldsAt(lines, i + 1, ["Tier", "MVP", "Requirements", "After"]);
    const tier = fields.Tier !== void 0 && TIER2.test(fields.Tier) ? (
      /** @type {'T1' | 'T2' | 'T3'} */
      fields.Tier
    ) : null;
    stories.push({ id, title: heading[2].trim(), tier, mvp: fields.MVP === "yes" });
    i = next - 1;
  }
  return { n, title: opening?.[1] ?? null, stories };
}
function readPhases(root) {
  const dir = path6.join(root, "docs", "stories");
  let names2;
  try {
    names2 = fs7.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && STORY_FILE.test(entry.name)).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
  const phases = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const name of names2) {
    const n = Number(
      /** @type {RegExpExecArray} */
      STORY_FILE.exec(name)[1]
    );
    if (phases.has(n)) continue;
    const body = text2(path6.join(dir, name));
    if (body === null) continue;
    phases.set(n, readPhase(n, body, seen));
  }
  return [...phases.values()].sort((a, b) => a.n - b.n);
}
function readQuestions(body) {
  const lines = linesOf(body);
  const questions = [];
  const asked = /* @__PURE__ */ new Set();
  let inQuestions = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      inQuestions = line.trim() === "## Questions";
      continue;
    }
    if (!inQuestions || !line.startsWith("### ")) continue;
    const heading = QUESTION_HEADING.exec(line.trim());
    if (heading === null || asked.has(heading[1])) continue;
    asked.add(heading[1]);
    const { fields, next } = fieldsAt(lines, i + 1, ["Blocks", "Default taken"]);
    const blocks = fields.Blocks === void 0 || fields.Blocks === "nothing" ? [] : list(fields.Blocks).filter((id) => STORY4.test(id));
    questions.push({ id: heading[1], title: heading[2], date: heading[3], blocks });
    i = next - 1;
  }
  return questions;
}
function readRepo(root) {
  const queue = text2(path6.join(root, "docs", "queue.md"));
  return {
    id: projectId(root),
    phases: readPhases(root),
    questions: queue === null ? [] : readQuestions(queue)
  };
}

// server/projects.mjs
var pathsOf = (platform) => platform === "win32" ? path7.win32 : path7.posix;
var keyOf = (platform, p) => platform === "win32" ? p.replace(/\//g, "\\").toLowerCase() : p;
function findRoot(id, cwds, { platform, idAt, seen = /* @__PURE__ */ new Map() }) {
  const p = pathsOf(platform);
  const ordered = [...cwds].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const tried = /* @__PURE__ */ new Set();
  for (const [cwd] of ordered) {
    if (!p.isAbsolute(cwd)) continue;
    let dir = p.resolve(cwd);
    if (tried.has(keyOf(platform, dir))) continue;
    tried.add(keyOf(platform, dir));
    for (; ; ) {
      const key = keyOf(platform, dir);
      let found = seen.get(key);
      if (found === void 0) {
        found = idAt(dir);
        seen.set(key, found);
      }
      if (found === id) return dir;
      const parent = p.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
var nameOf = (p, dir) => p.basename(dir) || dir.replace(/[\\/]+$/, "") || dir;
function projectRoots(projects, { platform = process.platform, idAt = projectId } = {}) {
  const p = pathsOf(platform);
  const seen = /* @__PURE__ */ new Map();
  const found = [];
  for (const [id, facts] of projects) {
    const root = findRoot(id, facts.cwds, { platform, idAt, seen });
    if (root !== null) found.push({ id, root, name: nameOf(p, root), lastEventAt: facts.ts });
  }
  const names2 = /* @__PURE__ */ new Map();
  for (const project of found) {
    const key = keyOf(platform, project.name);
    names2.set(key, (names2.get(key) ?? 0) + 1);
  }
  const roots = /* @__PURE__ */ new Map();
  for (const project of found) {
    if ((names2.get(keyOf(platform, project.name)) ?? 0) > 1) {
      project.name = `${project.name} (${nameOf(p, p.dirname(project.root))})`;
    }
    roots.set(project.id, project);
  }
  return roots;
}

// server/watch.mjs
var EVERY2 = 1e3;
var BUSY_EVERY = 2e3;
var QUIET_EVERY = 3e4;
var BUSY_FOR = 10 * 6e4;
function watch({
  home = os5.homedir(),
  now = () => Date.now(),
  every = EVERY2,
  say = (line) => console.log(line),
  git = gitReader({ say }),
  platform = process.platform
} = {}) {
  const log = eventLog({ folder: eventsFolder(home), now, say });
  let roots = /* @__PURE__ */ new Map();
  let rootsAt = -Infinity;
  const reads = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  let state = null;
  let sent = "";
  let running = Promise.resolve(false);
  let timer;
  let started = false;
  let closed = false;
  let told = "";
  const due = (project, at) => {
    const last = reads.get(project.id);
    if (last === void 0 || last.root !== project.root) return true;
    const busy = at - Date.parse(project.lastEventAt) < BUSY_FOR;
    return at - last.at >= (busy ? BUSY_EVERY : QUIET_EVERY) - every / 2;
  };
  const once = async () => {
    const at = now();
    if (log.read() || at - rootsAt >= QUIET_EVERY) {
      roots = projectRoots(log.projects, { platform });
      rootsAt = at;
    }
    for (const id of reads.keys()) if (!roots.has(id)) reads.delete(id);
    await Promise.all(
      [...roots.values()].filter((project) => due(project, at)).map(async (project) => {
        const repo = readRepo(project.root);
        const costs = readCosts(project.id, home).stories;
        const facts = await git(project.root);
        reads.set(project.id, { root: project.root, at, repo, git: facts, costs });
      })
    );
    const sessions = /* @__PURE__ */ new Map();
    for (const { event } of log.sessions.values()) {
      const list2 = sessions.get(event.project_id);
      if (list2 === void 0) sessions.set(event.project_id, [event]);
      else list2.push(event);
    }
    const runs = /* @__PURE__ */ new Map();
    for (const facts of log.runs.values()) {
      const list2 = runs.get(facts.project_id);
      if (list2 === void 0) runs.set(facts.project_id, [facts]);
      else list2.push(facts);
    }
    const agents = /* @__PURE__ */ new Map();
    for (const facts of log.agents.values()) {
      const list2 = agents.get(facts.project_id);
      if (list2 === void 0) agents.set(facts.project_id, [facts]);
      else list2.push(facts);
    }
    const sources = [...roots.values()].flatMap((project) => {
      const read = reads.get(project.id);
      if (read === void 0) return [];
      return [
        {
          id: project.id,
          name: project.name,
          lastEventAt: project.lastEventAt,
          repo: read.repo,
          git: read.git,
          costs: read.costs,
          sessions: sessions.get(project.id) ?? [],
          runs: runs.get(project.id) ?? [],
          agents: agents.get(project.id) ?? [],
          ends: log.ends
        }
      ];
    });
    const next = derive(sources, { now: now(), seq: (state?.seq ?? 0) + 1 });
    const key = JSON.stringify(next.projects);
    if (state !== null && key === sent) return false;
    state = next;
    sent = key;
    for (const listener of listeners) listener(next);
    return true;
  };
  const tick = () => {
    running = running.then(once, once);
    return running;
  };
  const loop = async () => {
    const began = performance.now();
    try {
      await tick();
      told = "";
    } catch (error) {
      const line = `Harbor couldn't read Epikloop's files this time (${error instanceof Error ? error.message : String(error)}); it tries again every second.`;
      if (line !== told) say(line);
      told = line;
    }
    if (!closed) {
      timer = setTimeout(loop, Math.max(0, every - (performance.now() - began)));
      timer.unref();
    }
  };
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tick,
    scanned: () => log.scanned(),
    start() {
      if (started || closed) return;
      started = true;
      loop();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      log.close();
      listeners.clear();
    }
  };
}

// server/main.mjs
var PORT = 4747;
var WAIT = 5e3;
var LINGER = 500;
function portFrom(value) {
  if (value === void 0 || value === "") return PORT;
  return /^\d{1,5}$/.test(value) && Number(value) <= 65535 ? Number(value) : null;
}
var badPort = () => `harbor: HARBOR_PORT is ${JSON.stringify(process.env.HARBOR_PORT)}, which is not a port number from 0 to 65535`;
function offLine(flag) {
  const trouble = flag.trouble();
  const why = trouble === null ? "" : `, because ${flag.file} still ${trouble} after ${GRACE / 1e3} seconds`;
  return `harbor: Harbor is off${why}; /epikloop:harbor on turns it on`;
}
function clientDir() {
  const beside = path8.join(import.meta.dirname, "client");
  return fs8.existsSync(path8.join(beside, "index.html")) ? beside : path8.join(import.meta.dirname, "..", "dist", "client");
}
function tell(report) {
  if (report.state === "held" || report.state === "failed") console.error(report.line);
  else console.log(report.line);
  if (process.send !== void 0 && process.connected) {
    process.send(report, () => {
      if (process.connected) process.disconnect();
    });
  }
}
async function serve() {
  const flag = flagReader();
  if (!await flagAtLaunch(flag)) {
    tell({ state: "off", line: offLine(flag), url: null });
    return;
  }
  const port = portFrom(process.env.HARBOR_PORT);
  if (port === null) {
    tell({ state: "failed", line: badPort(), url: null });
    process.exitCode = 1;
    return;
  }
  const state = watch();
  let server;
  try {
    server = await listen({ port, client: clientDir(), feed: state, commit: process.env.HARBOR_COMMIT });
  } catch (error) {
    const code = (
      /** @type {NodeJS.ErrnoException} */
      error.code
    );
    tell(
      code === "EADDRINUSE" ? { state: "held", line: `harbor: port ${port} on ${HOST} is already in use`, url: `http://${HOST}:${port}/` } : { state: "failed", line: `harbor: can't listen on ${HOST}:${port} (${code ?? String(error)})`, url: null }
    );
    process.exitCode = 1;
    return;
  }
  const address = server.address();
  const url = `http://${HOST}:${typeof address === "object" && address !== null ? address.port : port}/`;
  tell({ state: "listening", line: `harbor: listening on ${url}`, url });
  const folds = folding();
  state.start();
  watchFlag(flag, () => {
    folds.close();
    state.close();
    const trouble = flag.trouble();
    console.log(
      trouble === null ? "harbor: the harbor flag is off, so Harbor stopped" : `harbor: Harbor stopped, because ${flag.file} still ${trouble} after ${GRACE / 1e3} seconds, which counts as off`
    );
    process.exitCode = 0;
    server.closeAllConnections();
    server.close();
    setTimeout(() => process.exit(0), LINGER).unref();
  });
}
function launch() {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    let gone2;
    const done = (report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(gone2);
      if (child?.connected) child.disconnect();
      child?.unref();
      resolve(report);
    };
    const failed = (why) => done({ state: "failed", line: `harbor: ${why}`, url: null });
    const timer = setTimeout(() => failed(`the server didn't say within ${WAIT / 1e3} seconds whether it listens`), WAIT);
    try {
      child = fork(import.meta.filename, ["serve"], {
        cwd: os6.homedir(),
        detached: true,
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true
      });
    } catch (error) {
      failed(`couldn't start the server (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    child.on("message", (message) => {
      const report = asReport(message);
      if (report === null) failed("the server's report made no sense");
      else done(report);
    });
    child.on("error", (error) => failed(`couldn't start the server (${error.message})`));
    child.on("exit", (code, signal) => {
      if (settled) return;
      const why = `the server stopped before it said whether it listens (${signal ?? `exit code ${code}`})`;
      gone2 = setTimeout(() => failed(why), 250);
    });
  });
}
function asReport(message) {
  if (typeof message !== "object" || message === null) return null;
  const { state, line, url } = (
    /** @type {Record<string, unknown>} */
    message
  );
  if (state !== "listening" && state !== "held" && state !== "off" && state !== "failed") return null;
  if (typeof line !== "string" || url !== null && typeof url !== "string") return null;
  return { state, line, url };
}
async function start() {
  const flag = flagReader();
  if (!await flagAtLaunch(flag)) {
    console.log(offLine(flag));
    return null;
  }
  if (portFrom(process.env.HARBOR_PORT) === null) {
    console.error(badPort());
    process.exitCode = 1;
    return null;
  }
  const report = await launch();
  if (report.state === "failed") {
    console.error(report.line);
    process.exitCode = 1;
  } else {
    console.log(report.line);
  }
  return report;
}
function opener(url) {
  if (process.platform === "win32") {
    return { file: path8.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), args: ["/d", "/c", "start", "", url] };
  }
  if (process.platform === "darwin") return { file: "open", args: [url] };
  return { file: "xdg-open", args: [url] };
}
function browse(url) {
  const { file, args } = opener(url);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true });
    } catch (error) {
      resolve(error instanceof Error ? error.message : String(error));
      return;
    }
    child.on("error", (error) => resolve(error.message));
    child.on("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}
async function open() {
  const report = await start();
  if (report === null || report.url === null || report.state !== "listening" && report.state !== "held") return;
  const trouble = await browse(report.url);
  if (trouble === null) console.log(`harbor: opening ${report.url} in the browser`);
  else console.error(`harbor: couldn't open the browser (${trouble}); Harbor is at ${report.url}`);
}
var [command] = process.argv.slice(2);
if (command === "serve") {
  await serve();
} else if (command === "start") {
  await start();
} else if (command === "open") {
  await open();
} else {
  console.error(`harbor: ${command === void 0 ? "no command given" : `no command named ${command}`}; the commands are serve, start and open`);
  process.exitCode = 1;
}
