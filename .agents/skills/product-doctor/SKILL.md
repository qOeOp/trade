---
name: product-doctor
description: Diagnoses what is wrong or unreasonable in the product and its project - code, results, storage, releases, skills, agents, size - against evidence, challenges design choices nobody questions, and reviews proposed mechanisms or skill rules. Use for focused product diagnosis, for checking a change before it merges, for keeping the evidence of a running research session that its transcript cannot show (attach), or a task calling for an overall product or session audit; ordinary strategy repairs belong to research-round.
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

One question: steps 3, 4, 6 and 7, then its issues (step 8), no `report`. Examine what answers it and stop.

## Change check

A change before it merges, in a fresh session given only its base, branch and description. Read what it changes and
every caller of that; list the states the changed code can meet, and exercise those its tests do not. A claim is a
`doctor.py probe --tree BRANCH --control-tree BASE`: `shown` means the base reads otherwise, so the change made it and
it is fixed before the merge; a reading the base shares predates the change and becomes an issue (step 8).
`doctor.py recheck COMMIT --tree BRANCH` says whether its own tests fail without it. State its net lines, product and
tests apart, and the mechanisms, branches and tests it adds and removes; growth a smaller change avoids is a finding,
shown by that change on a scratch copy passing the same probes; on a file in `scan --days 28`'s `fixed_files`, that
change is first a restatement of the file. Report nothing unproven; stop at the change's reach.

## Themed audit

An overall audit takes one theme; a full one runs when the user names it or before a new version line. Read the
signals: `doctor.py scan` (the tree's objects, two weeks of changes and fixes, when each object and perspective was
last exercised, what records left unexamined), the open findings and CI runs by `gh`, the last two records. Take the first theme that holds, unless
the last two audits took it (harm aside); say why and what is left out:

1. **Stop harm** (`harm`): an open finding that risks money, records or wrong results and is new, changed or not yet
   rechecked; one only waiting for authority or under a claim does not count. Merge by cause, order by reach and cost
   paid, probe on `origin/main`; search for nothing new (no step 2 or 5).
2. **Slim** (`slim`): an object fixed again and again, well ahead of the rest, or whose tests outgrow it (`git log --numstat`
   on both). Net growth only orders (a growing product always has some). Group Shape and **checks**, one or two objects: [slim.md](references/slim.md).
3. **Friction** (`friction`): a wait, repeat or decoding by the user or Agents that grew or that they named. Group Use.
4. **Find** (`find`): otherwise, unless open findings neither `authority` nor `claimed` outnumber twice those closed
   in the last seven days, or the last two `find` records confirmed nothing above minor and `fixed_files` is empty:
   then say which and stop; the user or a new version line restarts it. First `scan`'s `unexamined` rows, oldest first, each under its own item and subject
   (say which stay out of reach); then the object much changed or longest unexamined, `outside` too,
   under what it has longest gone without of the remaining groups of [lenses.md](references/lenses.md).

Declare one to three objects and those lines of the groups that apply to them (a listed one as ITEM/SCENARIO where
only some do) with `doctor.py scope` before any evidence, harm its objects alone; `report` judges against it. Then the steps below on those alone: step 1's "every line" and step 5 (slimming aside) belong to a full audit.

## Full audit

1. **Pin.** Your first message gives a time and token budget. Every line of [lenses.md](references/lenses.md) and every
   object of `scan` runs, with the second passes, refutations, challenges and reruns of old proofs, whatever it costs; the budget
   limits only what is beyond those, and past 70% none is added. Fetch; judge `origin/main`, not the session's
   checkout. Beside the passes rerun the proofs of open `agent-finding` issues on the same objects, and `doctor.py
   recheck` those closed longest without a held comment; name the ones left.
2. **Map and pass.** To `scan`'s objects add what the tree does not hold (`@name`). Nobody has the list: first a fresh
   sub-agent, given the tree and `scan`'s `outside`, works out what today's product runs, keeps, calls, publishes and
   depends on, each with file and line, and what the bracketed scenarios of `lenses.md` miss or name in vain; a miss is
   run too, and is a finding of this skill. A folded part that is a thing of its own gets its own pass. Pair every line and every object, first
   what changed since the last audit, then the longest unexamined. Give each pass to a fresh sub-agent with one
   perspective and one object, or two whose contract it checks (from what one produces to what the other assumes),
   evidence paths, the audit's one evidence directory, the ITEM and SUBJECTs to `doctor.py run` there, no suspects of
   yours and no cap on findings. It lists the object's modes, tracks and states from the code before it runs any. It
   names what it did not reach with `doctor.py unexamined` and ends when the object's paths are exercised, not at its
   first findings. At most four passes at once, one of them heavy (replay, build); measure costs with nothing else
   running. A script gathers; a sub-agent still judges. Once every line and object has had its pass, each object with
   a `shown` finding not plainly minor (step 6) gets one more, from another perspective. Suspects of yours still open after the
   passes you probe yourself; no agent is briefed with them.
3. **Probe, then claim.** Record exercises with `doctor.py run` and claims with `doctor.py probe`, whose control
   must give the other reading, on current `origin/main`; a cost takes `doctor.py cost`, a rate, not one time
   (`--help` says the forms; run as `uv run --frozen python .agents/skills/product-doctor/assets/doctor.py`). Only
   `shown` proves code's behaviour; otherwise say unverified. Findings of use, words or growth (**value**,
   **size**, **delivery**, **agents**, **burden**, **governance**) are claimed from located counts, quotes or a
   removal run and refuted from their sources; those passes judge, not only count. A help call or a script alone is
   not a defect. Evidence names no credential and is never edited: a wrong row is named in the report.
4. **Examined means exercised.** A subject whose real dependency (network, container, browser, host, account) or
   other path was out of reach, also by a temporary container of the product's own image and a read-only public
   source, is *not examined*: a `doctor.py unexamined` row with what stopped it; a mention in the pass's summary is
   not enough. A stand-in, a passing unit test or reading the code does not examine it, unless the lens asks for a
   fake. Any such row makes the audit partial: never `pass`, `clean` or `full`. Trading on the real account and
   changing the release host are listed as outside every audit, never as examined.
5. **Challenge quiet choices.** Each full or slimming audit takes several choices that raised no alarm, beside the
   first passes. A fresh sub-agent designs from the need before reading the code; a run on a scratch copy measures
   the difference. Verdict: keep (with the premise whose failure reopens it), change, remove, or cannot tell. The
   `docs/plans/doctor/index.zh.md` list is challenged only when its stated reason fails.
6. **Refute.** After the passes, fresh sub-agents get the recorded claims, step 5's included, at most eight each and those
   of one object together, as object, trigger, expected and observed, without their proof (your own guesses are not
   recorded claims and never go to a refuter), and try to break each: first
   who calls it and whether normal use reaches the trigger; then whether a README, docstring, `docs/plans/` file or
   test states it on purpose (not enough alone against a step 5 claim); then a run of its own (code's behaviour
   through `doctor.py probe --refutes`). Confirmed, by design (cite where; not when its stated reason no longer
   holds), false, duplicate or undecided; reading alone leaves code's behaviour undecided. Confirmed reaches an
   issue; report its count and the overturned ones. A defect is minor when it takes a hand-damaged file, or a call
   that nothing in the product makes.
7. **Remedy.** In order, saying why each earlier one does not fit: none; restate the mechanism so special cases
   merge; remove; add, only for a wrong output, a trust boundary or recurrence. Net mechanisms, rules and words must
   be stated. An issue calls a code remedy unverified unless it ran on a scratch copy, where the callers, retries
   and documented repairs it touches still worked. Any remedy that adds, tightens or relaxes a refusal, test bar or
   CI gate is an `authority` item: ask the user.
8. **Report.** Issues per [record.md](references/record.md), updating existing ones. Report `doctor.py report`
   verbatim but for `SECURITY.md`'s rows, spent against budget (time at least its evidence span; tokens the host
   hides are unknown), and the `@` objects no pass took. For an audit of one session, tell the user only of perspectives its
   objects touch; the record keeps the report whole. Absence of findings says only what was tried. Trend claims
   need repairs that held. Rerun what the report calls not exercised or not examined before the temporary ledgers,
   markets and containers go; then, with each probe in its issue, stop the audit's own processes and remove its
   copies.
