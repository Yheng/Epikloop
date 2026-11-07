---
description: Design every screen of the product, from three direction variants the human chooses between to tokens, a manifest and a gallery.
argument-hint: '[amend <screen> "<change>" | add <screen> | audit | ingest]'
effort: high
allowed-tools:
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" *)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/gallery.mjs")'
  - 'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/gallery.mjs")'
---

Outcome: the product's visual truth lives in `design/`, drawn before anything is built. A brief
leads to three direction variants of the system sheet; the human picks one; every screen follows
in that direction, at both of the lane's widths, in each state it has, with real copy, alongside
`tokens.css`, `manifest.md` and the gallery. A sub-mode changes one thing at a time. Scope:
`design/` and the decision that records the pick; the product's code belongs to its stories.

Where the design stands comes from a script: run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --design` on its own. It prints the lane's widths,
how far the design has come, the files it still lacks, the number for the pick's record and what
an audit reads, and the work picks up from there.

The brief, `design/brief.md`, is titled with the product's name, which the gallery shows, and draws
on `spec/` and on any images the human puts in `design/refs/`: who the product is for, the feel it
aims at, its constraints and the screens it needs. Each
direction is one self-contained HTML file in `design/directions/` with its own custom properties:
its palette, type, spacing and main components, shown on one of the product's key screens. The
three differ in character rather than in detail. Nothing past the directions is written before the
human picks, and they may ask for changes or new directions first. The pick is a decision titled
`Design direction`, whose Decision names the picked file and whose Rejected names the others, in
this format, which a script reads:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example decisions`

After the pick, `design/tokens.css` holds the picked direction's custom properties on `:root`, and
every colour and font family on a screen comes from it. `design/manifest.md` lists every screen in
this format, which a script reads, so its headings and fields stay exactly as shown:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --example manifest`

Each state is its own HTML file in `design/screens/`, linking `../tokens.css` and loading nothing
from outside `design/`: `<screen>.html` for the default, and `<screen>.<state>.html` for `empty`,
`loading` and `error`. A screen carries the
product's real copy, drawn from the spec and its quoted business rules, and works at both widths.
`node "${CLAUDE_PLUGIN_ROOT}/scripts/gallery.mjs"` writes `design/index.html`, which frames the
directions and every state at both widths; run it on its own whenever they change, and point the
human to it.

`amend <screen> "<change>"` changes that screen's states as asked; the tokens change only for a
change to the system itself, and then every screen follows. `add <screen>` draws one new screen in
the picked direction, in its states, and lists it in the manifest. `audit` starts from what the
script reports and reads each screen against the spec, for a state it lacks, copy that isn't the
product's, or a requirement a person sees that no screen shows; it reports the gaps and fixes those
the human agrees to. `ingest` brings in a screen designed elsewhere, from the file or image the
human gives, rebuilt on `tokens.css`, in its states, and listed in the manifest.

Commit as each part is done: the brief with the directions, then the pick, then the tokens and the
screens with the manifest and the gallery, so a later session picks up where this one stopped. In
solo mode push each commit when the repository has a remote; in team mode they land through a pull
request.
