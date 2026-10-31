---
description: Run epic N as an unattended batch, one isolated worker per story, through hard gates, with questions parked instead of asked.
argument-hint: "<N>"
effort: medium
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'Bash(git pull --ff-only *)'
  - 'PowerShell(git pull --ff-only *)'
---

Outcome: every ready story in epic N has landed, each built by its own `story-worker`, without
interrupting the human, and the batch ends with the fuel gauge and what needs the human. Scope:
running the batch. This conversation keeps only each worker's one-line report, and builds, fixes
and tidies nothing itself; a change of scope goes to the queue.

Which stories are ready comes from a script, never from reading the project files. Run `git fetch`
on its own, then `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" --ready $ARGUMENTS`, also on its own.
It prints one line per ready story in plan order, such as `3.2 T2 Login form`, or one line saying
why nothing can start. When that line names a git command, run it on its own and read the list
again; any other reason ends the batch before it starts.

Spawn `epikloop:story-worker` for the first line, in the foreground, with that line exactly as the
description, which sets the worker's effort, and `Story N.M.` as the whole prompt; the worker reads
its own brief. When it reports, read the list again and go on with its first line. The batch ends
when nothing is ready, or when the story just run is still listed, because then it didn't land.

Close with `node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs"`: the fuel gauge, then the stories that
landed, the one that stopped and why, the questions parked, and what needs the human.
