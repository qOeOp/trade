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

1. **Pin.** Your first message gives a time and token budget, this session's own tokens included. It limits how
   many objects are taken beyond the listed lines, past 70% none, and cuts no line of the list, second pass,
   refutation, challenge or rerun of old proofs the audit can make. What a host limit cuts is not examined. Fetch;
   judge `origin/main`, not the session's checkout. Beside the passes rerun the proofs of open `agent-finding`
   issues on the same objects, and `doctor.py recheck` those closed longest without a held comment; name the ones
   left.
2. **Map and pass.** List the objects from the tree (packages, processes, stores, external parties, timers,
   published artifacts) and pair them with the perspectives in [lenses.md](references/lenses.md). Take what changed
   since the last audit, then the longest unexamined. One pass finds only part of what is there, and repeating its
   question finds little more: give each pass to a fresh sub-agent with one perspective and one object, evidence
   paths, the audit's one evidence directory, the ITEM and SUBJECTs to `doctor.py run` there, and no suspects of
   yours, and no cap on findings. Each pass names what it did not reach with `doctor.py unexamined`. Run at most
   four passes at once and one heavy load (replay, build) among them; measure costs with nothing else of the audit
   running. A script gathers; a sub-agent still judges. Depth before breadth: finish fewer objects and leave the
   rest to the next audit. A pass ends when its object's paths are exercised, not at its first findings; an object
   with a `shown` finding gets a second fresh pass, from another perspective, before a new object is taken.
3. **Probe, then claim.** Record exercises with `doctor.py run` and claims with `doctor.py probe`, whose control
   must give the other reading, on current `origin/main`; a cost takes `doctor.py cost`, a rate, not one time
   (`--help` says the forms; run as `uv run --frozen python .agents/skills/product-doctor/assets/doctor.py`). Only
   `shown` proves code's behaviour; otherwise say unverified. What **value**, **size**, **delivery**, **agents**,
   **burden** and **governance** find of use, words or growth is claimed from located counts, quotes or a removal
   run and refuted from its sources; those passes return judgements too, not only defects of code. A help call or a
   script alone is not a defect. Evidence names no credential and is never edited: a wrong row is named in the
   report.
4. **Examined means exercised.** Where the real dependency (network, container, browser, host, account) or another
   path of its object was out of reach, the subject is *not examined*, with what stopped it, once a temporary
   container of the product's own image and a read-only public source could not reach it either; a stand-in, a
   passing unit test or reading the code does not examine it, unless the lens asks for a fake. Any such subject
   takes a `doctor.py unexamined` row, its pass's closing words included, and makes the audit partial: never
   `pass`, `clean` or `full`. Only trading on the real account and changing the release host, which AGENTS.md keeps
   from Agents, do not: list them as outside every audit, never as examined.
5. **Challenge quiet choices.** Each full audit takes several choices that raised no alarm, beside the
   first passes. A fresh sub-agent designs from the need before reading the code; a run on a scratch copy
   measures the difference. Verdict: keep (with the premise whose failure reopens it), change, remove, or cannot
   tell. The `docs/plans/doctor/index.zh.md` list is challenged only when its stated reason fails.
6. **Refute.** After the passes, a fresh sub-agent gets at most eight recorded claims, step 5's included (a
   suspect of yours is none), without their proof, and tries to break each: first who calls it and whether normal
   use reaches the trigger, then a run of its own (code's behaviour through `doctor.py probe --refutes`).
   Confirmed, by design, false, duplicate or undecided; reading alone leaves code's behaviour undecided. Confirmed
   reaches an issue; keep its count, and the overturned ones, in the report. A trigger only a damaged file or a
   call nothing in the product makes reaches is minor.
7. **Remedy.** In order, saying why each earlier one does not fit: none; restate the mechanism so special cases
   merge; remove; add, only for a wrong output, a trust boundary or recurrence. Net mechanisms, rules and words
   must be stated. Any remedy that adds, tightens or relaxes a refusal, test bar or CI gate is an `authority` item:
   ask the user.
8. **Report.** Issues per [record.md](references/record.md), updating existing ones. Report `doctor.py report`
   verbatim but for `SECURITY.md`'s rows: examined, not examined, what each perspective found, spent against budget
   (time no shorter than its evidence span; tokens the host does not show are unknown, not within budget), tokens
   per confirmed finding; and the listed objects no pass took, since one subject of an `any` line examines that
   object alone. For an audit of one session, tell the user only of perspectives its objects touch; the record
   keeps the report whole. Absence of findings says only what was tried. Trend claims need repairs that held. Read
   the `doctor.py report` and rerun what it calls not exercised or not examined while the temporary ledgers,
   markets and containers still exist; then, with each probe in its issue, stop the audit's own processes and
   remove its copies.
