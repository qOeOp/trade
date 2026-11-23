---
name: product-doctor
description: Diagnoses what is wrong or unreasonable in the product and its project - code, results, storage, releases, skills, agents, size - against evidence, challenges design choices nobody questions, and reviews proposed mechanisms or skill rules. Use for focused product diagnosis, for keeping the evidence of a running research session that its transcript cannot show (attach), or a task calling for an overall product or session audit; ordinary strategy repairs belong to research-round.
---

# Product doctor

Find what is wrong (it does not do what it should) and what is unreasonable (it does, but simpler,
faster, steadier or cheaper was possible). Diagnose only: the result is issues, never a repair.
Research conclusions and experiment choice belong to `research-round`.

## Boundaries

- Read the checkout, transcripts, CI logs and commands whose `--help` `writes` line names nothing in
  the active ledger or market (`research state` also moves the local `main` runtime tag). Probes that
  write use a temporary ledger (`ledger temp`), a temporary market and an IDE of the audit's own.
  AGENTS.md owns authority and credentials; a diagnosis grants none, picks no candidate and changes
  no target. Outside literature goes through `research-sources`, its keys included.
- A full audit, or focused questions that together cover a session, runs in a fresh session sharing
  no context with the work audited (not the research session, its sub-agents, or one that attached or
  discussed it). Otherwise stop and give the user the steps: end the research session; open a new
  one; hand it transcript paths, ledger commit range, checkout commit, and any attach evidence
  directory and diagnoses, nothing else; invoke this skill. Transcripts: [hosts.md](references/hosts.md).
- Attach keeps the evidence of a running session: [attach.md](references/attach.md).

## Focused diagnosis

One question: steps 3, 4, 6 and 7, then its issues (step 8). Examine what answers it and stop.

## Full audit

1. **Pin.** Fetch; judge `origin/main`, not the session's checkout, and recheck open `agent-finding`
   issues and those closed without a held comment (`doctor.py recheck`) before looking for new ones.
   State a time and token budget now. At the limit stop: the rest is not examined.
2. **Map and pass.** List the objects from the tree (packages, processes, stores, external parties,
   timers, published artifacts) and pair them with the perspectives in
   [lenses.md](references/lenses.md). Take what changed since the last audit, then the longest
   unexamined. One pass finds only part of what is there, and repeating its question finds little
   more: give each pass to a fresh sub-agent with one perspective and one object, evidence paths, and
   no suspects of yours. Anything a script can read takes no agent.
3. **Probe, then claim.** Record exercises with `doctor.py run` and claims with `doctor.py probe`,
   whose control must give the other reading, on current `origin/main`; a cost takes `doctor.py cost`,
   a rate, not one time (`--help` says the forms; run as
   `uv run --frozen python .agents/skills/product-doctor/assets/doctor.py`).
   Only `shown` proves; otherwise say unverified. A help call or a script alone is not a defect. Evidence names no credential.
4. **Examined means exercised.** Where the real dependency (network, container, browser, host, account)
   was out of reach, the subject is *not examined*, with what stopped it; a stand-in, a passing unit
   test or reading the code does not examine it, unless the lens asks for a fake. Any such subject
   makes the audit partial: never `pass`, `clean` or `full`.
5. **Challenge quiet choices.** Each full audit takes several choices that raised no alarm. A fresh
   sub-agent designs from the need before reading the code; a run on a scratch copy measures the
   difference. Verdict: keep (with the premise whose failure reopens it), change, remove, or cannot
   tell. The `docs/plans/doctor/index.zh.md` list is challenged only when its stated reason fails.
6. **Refute.** A fresh sub-agent gets each claim without your proof and tries to break it:
   confirmed, by design, false or undecided. Confirmed reaches an issue; keep its count, and the
   overturned ones, in the report. Say how a real case reaches the trigger; a hand-damaged file alone is minor.
7. **Remedy.** In order, saying why each earlier one does not fit: none; restate the mechanism so special cases merge; remove; add, only for a
   wrong output, a trust boundary or recurrence. Net mechanisms, rules and words must be stated.
   Changing a refusal or audit is an `authority` item:
   ask the user.
8. **Report.** Issues per [record.md](references/record.md), updating existing ones. Report
   `doctor.py report` verbatim: examined, not examined, what each perspective found, tokens per
   confirmed finding. Absence of findings says only what was tried. Trend claims need repairs that
   held. Stop the audit's own processes and remove its copies.
