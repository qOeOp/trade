---
name: product-doctor
description: Diagnoses suspected product defects against contracts and evidence, and reviews proposed product mechanisms or skill rules. Use for focused product diagnosis, for keeping the evidence of a running research session that its transcript cannot show (attach), or a task calling for an overall product or session audit; ordinary strategy repairs belong to research-round.
---

# Product doctor

Find product defects, useful simplifications and missing evidence across code, CLI, skills, data,
tests, CI and the design site. Assess whether the product supports sound research decisions;
research conclusions and experiment selection belong to `research-round`.

## Boundaries

- Read only: transcripts, the checkout, CI logs, `ledger sql`, `ledger review`, `research status`,
  `research state` and `--help`. Never write the ledger or the market database (`replay
  reproduce` records an explore trial).
- AGENTS.md owns common authority and implementation boundaries; reference it rather than copying
  its rules. This skill additionally retains item-by-item user authority for stored-field changes.
  Diagnosis grants no implementation authority.
- Use current product names and evidence in findings.
- A full audit runs in a fresh session on a different host from the research session (Codex or
  Claude Code; [hosts.md](references/hosts.md) tells them apart by transcript path), so that it
  shares no context with the round and uses another model family. When the transcript to audit is
  this session's or one of its sub-agents', or the research session ran on this host, stop before
  step 1 and give the user the steps: end the research session; open a new session on the other
  host; hand it the transcript paths (main and sub-agents), the ledger commit range and the checkout
  commit, any raw evidence directory an attach session kept, and no account of the round from this
  session; invoke this skill there. The audit reads the transcript files, never excerpts or the
  research session's own summary. Focused diagnosis inside a research session is unaffected;
  focused questions that together cover the session are a full audit.

## Scope

Focused diagnosis uses steps 3–5 for one question: read only related calls, code and consumers;
report evidence, attribution or remaining uncertainty, and the next action. Use all steps and
Convergence only when the task calls for overall product or session quality. Failure, delay or unresolved attribution alone does not expand the scope.

Attach mode keeps, read-only and from the other host, the evidence of a running research session
that its transcript cannot show ([attach.md](references/attach.md)). It is never a full audit:
when the session ends, the full audit still runs in a fresh session with every step; attach
writes no record, index row or finding.

## Steps

1. **Pin scope and evidence.** Identify session paths, hosts and times, checkout and ledger
   commits; read open items and misses in `docs/plans/doctor/index.zh.md`. Build a shared /tmp
   timeline including sub-agent sessions ([hosts.md](references/hosts.md)).
2. **Assign coverage.** Use the three workstreams in [lenses.md](references/lenses.md), each with
   a fresh read-only sub-agent. Give it the evidence paths, checkout and its questions, without
   authoring context or your conclusions. Split a workstream only for distinct unresolved risks;
   keep every coverage responsibility assigned, including whole-product review beyond the session.
   A ledger fidelity test, when the audit needs one, follows [fidelity.md](references/fidelity.md).
3. **Verify the chain.** Trace product output through its actual consumer, interpretation and
   subsequent decision. Check population, units, assumptions and evidence scope; successful
   execution or rule compliance alone does not establish a sound inference or useful next step.
   Verify repairs through the same consumer path before closing them.
4. **Prove and rank.** Each finding needs its session call/time (or violated external norm with
   URL) and proof on the current product: file/line, read-only query, CI log or native rerun.
   Recheck high-priority findings yourself. Mark main's fixes; label unproved claims unverified
   or drop them. Rank by observed cost and recurrence, separating measured impact from expected
   savings.
5. **Choose a converging remedy.** Assign `fix`, `remove`, `skill`, `authority`, `measure` or
   `none`. Read every branch, exception and rule of the refusal, check or skill section the remedy
   would touch, then prefer in order: `none` when the Agent handled or can handle the case with
   existing guidance; restating the mechanism around the risk it guards, so the case falls out and
   its special cases merge (the remedy whenever special cases exist; an authority item for a
   refusal, audit or authority boundary); removal
   ([removal test](references/lenses.md#removal-test)); a narrow addition only for a wrong product
   output, a trust boundary the Agent cannot hold or recurrence across sessions. State why each
   earlier option does not fit, the net change in mechanisms, branches, rules and skill words, and
   why any growth was unavoidable.
6. **Report decisions.** Use [record.md](references/record.md) for verified findings, authority
   recommendations and open evidence gaps. Update existing items rather than recording each
   symptom anew; record user-first misses and the coverage responsibility that missed them.

## Convergence

Track the record's costs, invalid trials, recurrence, user-first misses and net change. Use
comparable scope and measured values; unavailable measurements stay unknown. Verify that repairs
hold and consumers make better-supported decisions before claiming improvement. Finding counts,
smaller text or fewer reviewers alone establish neither convergence nor research value. Keep
historical evidence in records; skill changes express general principles that leave uncertain
cases to Agent judgment, not accumulating cases.
