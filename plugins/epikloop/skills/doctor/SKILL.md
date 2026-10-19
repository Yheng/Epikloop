---
description: Check that this machine can run Epikloop and say how to fix what is missing; --check also runs the gates.
argument-hint: "[--check]"
effort: low
---

Outcome: a short report of whether this machine can run Epikloop, with the fix for anything
missing. It covers Node and git against their minimum versions, whether `.githooks/` is armed,
which lanes this machine can build, the account type with matching prompt-cache advice (API-key
users are pointed to the one-hour cache setting), and whether Harbor is reachable when it is on.
With `--check` it also runs the gates. Scope: it reports and recommends; nothing on the machine
changes.
