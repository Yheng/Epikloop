---
name: epikloop
description: Show where this project stands, what needs the human and the one next step, and start that step when the human says go.
effort: low
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs" *)'
---

Outcome: in a few lines the human knows where the project stands and what to do next, and the next
step starts when they say "go". The report opens with the fuel gauge, `MVP done/total · velocity ·
ETA · queue Δ`, calling the ETA fiction out loud when the queue delta is positive, then names what
needs the human and one recommended command. Scope: nothing changes beyond syncing with the remote;
the work belongs to the skill it starts.

The stage, the gauge and what waits come from a script, never from reading the project files. Run
`git fetch` on its own, so work merged elsewhere counts; without a remote it does nothing. Then run
`node "${CLAUDE_PLUGIN_ROOT}/bin/state.mjs"`, also on its own. It prints the gauge, the stage with
its next step, what needs the human, the questions waiting in `docs/queue.md`, and every line in
the project files it couldn't read. An unreadable line is a fix to make before the next batch,
because the stage can't count it.

When the human says go, invoke the next step's skill with its argument, such as `epic 3`. Outside an
Epikloop project the script says so: ask whether this is a new product or existing code, and start
`discover` or `adopt`.
