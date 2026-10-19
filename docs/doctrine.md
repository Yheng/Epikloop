# Doctrine

The principles every part of Epikloop serves. The pipeline enforces them in product work; the rules
for changing Epikloop itself are in the [constitution](../CONSTITUTION.md).

1. **Laws, not rules.** Anything mechanically checkable (secrets, hardcoded visual values, lint,
   types, tests, build) is enforced by a script at commit and push, never by a prompt rule. Prompt
   space is reserved for judgment.
2. **Batch the human.** The build loop never stops to ask a question. Questions are parked in a file
   with a conservative default taken; the human answers them in one sitting.
3. **Route findings by threshold.** Mechanical and small → fixed now in a separate commit. Needs a
   product call → parked question. Real but not MVP-breaking → one backlog line. Breaks an MVP
   acceptance criterion → fix now or an explicit scope question. Nothing is filed by default; a
   policy without a threshold is bottomless.
4. **Risk-tiered verification.** T1 (most stories): gates + acceptance evidence. T2: plus a test per
   quoted business rule. T3 (auth, money, migrations on live data, untrusted input): plus an
   adversarial pass with negative-case tests frozen into the suite, and human review of the diff.
5. **A frozen finish line and a fuel gauge.** The MVP set is frozen at plan time. Every status opens
   with `MVP done/total · velocity · ETA · queue Δ`. If the queue delta is positive the ETA is
   declared fiction, out loud. The denominator moves only by a recorded decision.
6. **All state lives in the repo (or in files), never in a conversation.** A power outage, a new
   teammate, or a six-week pause recover the same way.
7. **The immune system.** Every rule, gate or command cites the failure it fixes and the date. No
   preemptive rules. Every retro must delete something from the pipeline or say why nothing
   qualified. Prompt text has a hard line ceiling.

Citations live in the [changelog](../CHANGELOG.md), never in the rule text itself.
