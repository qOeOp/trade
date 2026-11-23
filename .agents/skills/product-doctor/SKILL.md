---
name: product-doctor
description: Diagnoses suspected product defects against contracts and evidence, and reviews proposed product mechanisms or skill rules. Use for focused product diagnosis, for keeping the evidence of a running research session that its transcript cannot show (attach), or a task calling for an overall product or session audit; ordinary strategy repairs belong to research-round.
---

# Product doctor

Find product defects, useful simplifications and missing evidence across code, CLI, skills, data,
tests, CI and the design site. Assess whether the product supports sound research decisions;
research conclusions and experiment selection belong to `research-round`.

## Boundaries

- Read the checkout, transcripts, CI logs and the output of commands whose `--help` `writes` line
  names nothing in the active ledger or market (`research state` also pulls the main runtime image,
  moving the local `main` tag). Probes that write run only on a temporary ledger (`ledger temp`), a
  temporary market and an IDE of the audit's own; `ledger review` gives the backup head. AGENTS.md
  owns credentials, authority and implementation boundaries; a diagnosis grants none of the
  authority it reserves to the user.
- A full audit runs in a fresh session, on either host, that shares no context with the round: not
  the research session or its sub-agents, nor a session that attached to it or discussed it. When
  this session is one of those, stop before step 1 and give the user the steps: end the research
  session; open a new session; hand it the transcript paths (main and sub-agents), the ledger commit
  range and the checkout commit, any attach evidence directory and diagnoses, and no other account
  of the round; invoke this skill there. The audit reads the transcript files
  ([hosts.md](references/hosts.md)), never excerpts or the research session's own summary. Focused
  diagnosis inside a research session is unaffected; focused questions that together cover the
  session are a full audit.

## Scope

Focused diagnosis uses steps 3–5 for one question: read only related calls, code and consumers;
report evidence, attribution or remaining uncertainty, and the next action. Use all steps only when
the task calls for overall product or session quality. Failure, delay or unresolved attribution
alone does not expand the scope.

Attach mode keeps, read-only and from another session on either host, the evidence of a running
research session that its transcript cannot show ([attach.md](references/attach.md)).

## Steps

1. **Pin scope and evidence.** Identify session paths, hosts and times, checkout and ledger
   commits; read the open rows of `docs/plans/doctor/index.zh.md` (a full audit reruns the proofs
   its header names). Judge current product behavior on a checkout at the current `origin/main`
   (after `git fetch origin main`), use its current names in findings, and compare it with the
   session's checkout before calling anything a defect: a fix the session lacked is not a new
   finding. Recheck an attach session's diagnoses first (step 4). Build a shared /tmp timeline
   including sub-agent sessions ([hosts.md](references/hosts.md)).
2. **Assign coverage.** Use the three workstreams in [lenses.md](references/lenses.md), each with
   a fresh sub-agent that edits nothing, and give every item of its full-audit list to one of them, not
   only what changed since the last audit. Give each the evidence directory and paths, checkout and its
   questions, without authoring context or your conclusions, attach's diagnoses included. Split a
   workstream only for distinct unresolved risks. Record what exercises an item:
   `uv run --frozen python .agents/skills/product-doctor/assets/doctor.py run /tmp/doctor-<audit> ITEM
   SUBJECT [--artifact FILE] -- COMMAND` (`--help` gives the others). Evidence keeps commands and
   output: no command there names or prints a credential. A finished command shows the item ran, not
   that the result is right; read it, and name what it left out.
3. **Verify the chain.** Trace product output through its actual consumer, interpretation and
   subsequent decision. Check population, units, assumptions and evidence scope; successful
   execution or rule compliance alone does not establish a sound inference or useful next step.
   Verify a repair at every consumer of the fact it changes (grep the verdict or field), not
   only the path that failed; an eval with invented facts does not stand in for the real state.
4. **Probe, then claim.** A claim stands only on a probe of the current `origin/main`, run again
   right before writing. For a defect, write a probe file (`doctor.py` says its form) with a control
   whose input must give the other reading, and record it with `doctor.py probe`, `--before` the last full audit's
   checkout; only `shown` proves it, and `broken`, `indiscriminate` and `uncontrolled` are unverified.
   Where no probe can run, give an exact file:line chain from input to wrong output and say it was not
   run. A cost stands on `doctor.py cost`, read as a growth rate; `noisy` is no reading and an unmeasured
   cost is `unknown`. A duplication stands on the measured span both copies share; residue on its search
   and anchor ([lenses.md](references/lenses.md#product-contracts-and-delivery)). Calling a `fixed` row
   held takes `doctor.py recheck` `confirmed` or its own probe `absent`, never a merged PR. Each finding
   also names its session call and time, or the external norm with URL. Label the rest
   unverified or drop it. Rank by measured cost and recurrence; keep expected savings apart.
   In a full audit a fresh sub-agent, given the probe files and commands but no verdict, reruns the
   probes of each costly finding into its own directory; a difference is settled before reporting.
5. **Choose a converging remedy.** Assign `fix`, `remove`, `skill`, `authority`, `measure` or
   `none`. Read every branch, exception and rule of the refusal, check or skill section the remedy
   would touch, then prefer in order: `none` when the Agent handled or can handle the case with
   existing guidance; restating the mechanism around the risk it guards, so the case falls out and
   its special cases merge (the remedy whenever special cases exist; an authority item for a
   refusal, audit or authority boundary); removal
   ([removal test](references/lenses.md#removal-test)); a narrow addition only for a wrong product
   output, a trust boundary the Agent cannot hold or recurrence across sessions; for recurrence a
   test or CI check can find, the addition is that check (an `authority` item). State why each
   earlier option does not fit, the net change in mechanisms, branches, rules and skill words, and
   why any growth was unavoidable.
6. **Report decisions.** Coverage, test and probe results are what `doctor.py report` prints: say
   `full audit` only where it does, and name a failed command as failed even when a rerun passed, with
   why. Record per [record.md](references/record.md): an index row for each
   verified finding, authority recommendation or open evidence gap, and a record file only for an
   audit or a diagnosis of several rows. Update existing rows rather than recording each symptom
   anew. A row someone must fix, other than `authority`, also gets an `agent-finding` issue as
   the index header says. A finding the user pointed out first takes source `user` with the
   lenses.md workstream that should have caught it, by its name there; one verified from the user
   bot's issue takes `user-bot` the same way, with the issue number.

## Convergence

Claim improvement only when repairs hold and consumers make better-supported decisions; finding
counts, smaller text or fewer reviewers alone establish neither. Across audits read, with their
denominators, the claims an independent rerun overturned, the findings the last audit already had
(`--before`), recurrences and what the user found first; one audit shows no trend. Stop the audit's own
processes and remove its copies, then check that none is left.
