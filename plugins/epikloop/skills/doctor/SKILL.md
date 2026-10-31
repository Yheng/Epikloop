---
description: Check that this machine can run Epikloop and say how to fix what is missing; --check also runs the gates.
argument-hint: "[--check]"
effort: low
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/doctor.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/doctor.mjs" *)'
---

Outcome: a short report of whether this machine can run Epikloop, with the fix for anything that
needs one. Scope: it reports and recommends. The human applies the fixes, and nothing changes but
the folding of Epikloop's own event files.

The report comes from a script: run `node "${CLAUDE_PLUGIN_ROOT}/bin/doctor.mjs"` on its own. It
checks Node, git and Claude Code against their minimum versions, and the account's prompt cache.
Inside a project it also checks the project files, the git hooks, the gate files against the
plugin's current ones, and whether this session's events are being written. Relay what it found in
plain words, each fix with its command, without running the fixes. With `--check`, also run the
gates, `scripts/check.sh` from Bash or `node .githooks/check.mjs` from PowerShell, and report what
fails.
