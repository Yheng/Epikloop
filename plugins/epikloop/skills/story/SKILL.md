---
description: Run one named story through a worker and its gates, then stop.
argument-hint: "<X.X>"
effort: medium
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(git pull --ff-only *)'
  - 'PowerShell(git pull --ff-only *)'
---

Outcome: story X.X lands, built in a `story-worker` exactly as a batch builds it, and the run ends
with a short report. Scope: that one story, which may be outside the MVP set but must be ready;
anything it uncovers beyond its scope is parked, not done.

Whether it can start comes from a script, never from reading the project files. Run `git fetch` on
its own, then `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --ready $ARGUMENTS`, also on its own. A
ready story prints as one line, such as `3.2 T2 Login form`; otherwise the line says why it can't
start, and when it names a git command, run that on its own and read the list again.

Spawn `epikloop:story-worker` in the foreground with that line exactly as the description, which
sets the worker's effort, and `Story X.X.` as the whole prompt; the worker reads its own brief.
Report its one-line result, then the fuel gauge from `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs"`.
