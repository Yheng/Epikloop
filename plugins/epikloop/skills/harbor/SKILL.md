---
description: Turn Harbor, the local view of your Epikloop projects as offices, on or off, or open it.
argument-hint: "on|off|open"
effort: low
disable-model-invocation: true
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/switch.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/switch.mjs" *)'
---

Outcome: Harbor's state matches what the human asked for. `on` and `off` set the single `harbor`
flag in `~/.epikloop/config.json`, and off means no Harbor process exists; `open` shows Harbor in
the browser. Harbor itself comes from the optional `epikloop-harbor` plugin, so when that plugin is
missing, the answer is how to install it. Scope: the flag and opening the view.

The switch does all of it: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/switch.mjs" <on, off or open>`
on its own, with the word the human gave, and pass on what it prints.
