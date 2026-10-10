# examples/

Filled handoffs you can imitate. They double as the "Claude A authors → Claude B resumes" test
fixtures and as the source for the landing page's example-output section. Both pass
`scripts/check-staleness.sh`'s placeholder/secret checks and the `ref/checklists/quality.md` gate.

- [handoff-example-coding.md](handoff-example-coding.md) — a feature build paused mid-flight
  (refresh-token rotation): quantified Done list, one exact next step, a preserved open question.
- [handoff-example-debugging.md](handoff-example-debugging.md) — an in-progress investigation
  (intermittent 500): hypotheses with status, an explicit RULED-OUT list, the next probe.

These use fictional paths/commits for illustration. A real handoff records your live git state and
real file:line references, and is written to `handoffs/handoff-<timestamp>.md` in your working
project — not here.
