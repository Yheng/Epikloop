---
description: Turn Harbor, the local 3D view of your Epikloop projects, on or off, or open it.
argument-hint: "on|off|open"
effort: low
disable-model-invocation: true
---

Outcome: Harbor's state matches what the human asked for. `on` and `off` set the single `harbor`
flag in `~/.epikloop/config.json`, and off means no Harbor process exists; `open` shows Harbor in
the browser. Harbor itself comes from the optional `epikloop-harbor` plugin, so when that plugin is
missing, the answer is how to install it. Scope: the flag and opening the view.
