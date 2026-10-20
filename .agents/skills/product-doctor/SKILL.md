---
name: product-doctor
description: Diagnose how this repository's product behaved in one or more agent sessions (Codex or Claude Code transcripts, the checkout and the ledger, all read-only) and produce a verified, ranked list of defects, optimisations and removals, recorded so that later diagnoses show whether the product is converging. Use after a research session, when the user asks why a session failed, stalled or was slow, and before proposing to add, keep or remove a check, field, command, skill rule or test.
---

# Product doctor

Each diagnosis should leave the product more reliable or smaller, never only heavier. A finding is
about the product: code, CLI, skills, stored data and tests. Research conclusions belong to
`research-round`.

## Boundaries

- **K.1** Read only: transcripts, the checkout, `ledger sql`, `ledger review`, `research status`,
  `research state` and `--help`. Regenerate replay outputs only into /tmp. Never write the ledger
  or the market database, and never read credentials.
- **K.2** Take mechanism names from the product at diagnosis time: the refusal codes it raises,
  the skills' rule ids and the CLI commands. This skill keeps no list of them. A finding cites
  what the current checkout shows, so it stays valid whatever the implementation becomes.
- **K.3** Changes follow AGENTS.md. Defect fixes and skill text can proceed. Relaxing or tightening
  a refusal or audit check, changing a research target or a stored field, and destructive writes
  each need the user's authority, item by item.

## Steps

1. **Scope.** Name each session (transcript path, host, start and end time), the checkout commit
   and the ledger commits it spans. Read the open items in `docs/plans/doctor/index.zh.md`.
2. **Timeline.** Condense each transcript, its sub-agent sessions included, into calls, outputs,
   timestamps and token counts in /tmp ([hosts.md](references/hosts.md)).
3. **Lenses.** Run the five lenses in [lenses.md](references/lenses.md) as fresh, read-only
   sub-agents in parallel. Give each one only the timeline path, the checkout and its questions,
   not your own conclusions.
4. **Verify.** A finding needs two pieces of evidence: where it happened in the session (call or
   time), and a product proof on the current checkout (file and line, a ledger query or a native
   rerun). Re-check every finding you rank high yourself. List a finding you cannot prove as
   unverified, or drop it. Mark findings that main already fixes.
5. **Classify and rank.** Give each finding one action:
   - `fix`: a defect;
   - `skill`: guidance text;
   - `authority`: needs the user, per K.3;
   - `measure`: probe before deciding;
   - `none`.

   Rank by the cost the session shows (time, tokens, invalid trials, wrong or missing information
   given to the user) multiplied by how often it would recur. Prefer one change that clears
   several findings.
6. **Prune.** Apply the removal test in [lenses.md](references/lenses.md#removal-test) to every
   mechanism, rule, command, field and test the session touched. Propose something new only when
   a session shows a real failure it would have caught.
7. **Record and report.** Write the record ([record.md](references/record.md)). Update the open
   items: close those the sessions show fixed, and reopen any that recurred. Give the user the
   ranked list, the `authority` items with a recommendation for each, and the convergence line.

## Convergence

Each record's header tracks, per session:
- the share of wall-clock time spent on research versus discovery, repair and waiting;
- invalid trials the product caused;
- findings by action;
- items that recurred.

The product is converging when these fall across records and the removal list shrinks. A
diagnosis that only adds things is a signal to look for something to remove.
