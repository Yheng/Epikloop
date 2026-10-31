---
description: Run the next ready story through a worker and its gates, then stop.
effort: medium
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(git pull --ff-only *)'
  - 'PowerShell(git pull --ff-only *)'
---

Outcome: the next ready story lands, built in a `story-worker` exactly as a batch builds it, and
the run ends with a short report. Scope: one story; `epic` runs a batch, and nothing is built,
fixed or tidied here.

The next story comes from a script, never from reading the project files. Run `git fetch` on its
own, then `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --ready`, also on its own. Its first line,
such as `3.2 T2 Login form`, is the next story in plan order; otherwise the one line says why
nothing can start, and when it names a git command, run that on its own and read the list again.

Spawn `epikloop:story-worker` in the foreground with that line exactly as the description, which
sets the worker's effort, and `Story N.M.` as the whole prompt; the worker reads its own brief.
Report its one-line result, then the fuel gauge from `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs"`.
