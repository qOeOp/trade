---
name: research-round
description: Runs strategy research inside the research line the user selected in this repository (sources, hypothesis, candidate, precheck and source review, registration, replay, reports, comparison and attribution, feedback, review, out-of-sample validation). Use before running a research replay, reading a run or a comparison, choosing the next experiment, writing a recommendation, doing out-of-sample validation, and before claiming that a strategy improved, failed or generalized.
---

# Research round

Research runs on a research line: a starting candidate, a development window and a pinned market
commit the user selected (`research-start`). Inside the line you choose hypotheses, parents,
controls and priorities yourself and keep iterating; nothing ends the loop but the user.

## Commands

Every command is `uv run --frozen python -m cli.main <noun> <verb> ...` from the repository root (`--help`
lists the options). Output is JSON; a refusal is JSON on stderr with `code`, `message`,
`next_actions` and `write_status`. Supply what `next_actions` names and rerun; never work around a
refusal. These commands are the only way to write the ledger.

| Step | Command | Read first |
|---|---|---|
| 1 Sources | `evidence export`, `evidence add` (and `research-sources`) | [hypothesis.md](references/hypothesis.md) |
| 2 Hypothesis | (registration body, written in /tmp) | [hypothesis.md](references/hypothesis.md) |
| 3 Candidate | `candidate export`, `candidate new`, `candidate publish`, `candidate show`, `candidate list` | [strategy-header.md](templates/strategy-header.md), [strategy-authoring.md](references/strategy-authoring.md) |
| 4 Precheck and review | `replay precheck`, then `source review` by an independent reviewer | |
| 5 Registration | `registration add` | [hypothesis.md](references/hypothesis.md) |
| 6 Replay | `replay run --hypothesis BUNDLE`, once per grid point | |
| 7 Audit and eligibility | `replay report RUN` | [diagnosis.md](references/diagnosis.md) |
| 8 Comparison | `hypothesis compare BUNDLE RUN` | [attribution.md](references/attribution.md), [feedback.md](references/feedback.md) |
| 9 Feedback and priority | `judgment add`, `research state`, `research status` | [feedback.md](references/feedback.md) |

Precheck runs the published candidate natively on the shortest window and fewest contracts the
change needs. The review is done by a sub-agent that did not write the source: it reads the sealed
precheck output and records its verdict on the four items (api, causal, activity, readiness) with
`source review`. `replay explore` runs an unpublished file for engineering only (purpose
explore); it writes a trial but is never evidence. Any statistic beyond the reports follows
`nautilus-report-analysis`.

Read also: [review.md](references/review.md) when the review cadence is due;
[template.md](references/template.md) to transcribe a template or a user source into a root;
[templates/report.md](templates/report.md) to write a run or comparison report;
[validation.md](references/validation.md) after the user asks for out-of-sample validation;
[changes.md](references/changes.md) after the runtime, engine, data or contract identity
changes; [restore.md](references/restore.md) for a backup restore drill;
[duty-directory.md](references/duty-directory.md) when unsure of a duty's stance.

## Rules

- **A.1.1.2** Inside the line, run the steps in order: sources, hypothesis, publish, precheck and
  review, registration, replay, audit and eligibility, comparison, feedback and priority. Never
  ask the user to approve or confirm the next step; stop only for the authority list below or
  when the line should change (back to `research-start`).
- **A.1.1.3** Run the loop inside one turn. A report, an interpretation, a recommendation, a
  review or a priority judgment never ends your turn: once the priority is recorded, publish,
  precheck, review, register and replay the next experiment in the same turn. End the turn only
  for the authority list (A.2.3.3), a line change (back to `research-start`) or the user. You
  cannot set the host's goal mode yourself; the user sets it (`research-start`).
- **A.2.2.1** Position size, per-plan risk and notional limits are your design variables: write
  them in the strategy source and change them as a new candidate without asking; never describe
  them as user constraints. The user's research targets are only the maximum drawdown and the
  minimum annual return: the direction of the iteration and the reference for reading reports,
  never a filter on candidates. Win rate is a report dimension, not a target.
- **A.2.3.3** Stop, explain and wait for the user before live trading, venue connections or
  trading credentials; a destructive write (clearing the ledger, rewriting or deleting published
  records); relaxing or tightening any refusal or audit check, in code, tests, configuration or a
  skill; or changing a research target. Do not do it and do not work around it.
- **V.1.2.1** Replay every point of a registered grid once before reading any performance measure
  or registering the next batch. Do not add points, change parameters or edit source midway: a new
  grid, source or intent is a new registration, and a consumed point is retried only by a new
  registration naming it in `retry_of`.
- **V.1.2.2** Fills, fees, PnL and plan outcomes come only from the product's reports and
  `tables()`. Never derive them from price touches, signal counts or counterfactual counts, not
  even as an estimate, bound or scenario, and never fill a masked measure; put the economic
  question to a registered replay.
- **F.3.1.2** The review cadence only triggers a review; after the review, research continues. No
  count of trials, runs or budget stops research or makes a direction invalid.
- **X.1.1.1** Out-of-sample validation is registered only after the user names it; never start it
  yourself, and no step of the loop waits for it. When the user accepts a candidate from a report,
  ask once whether to validate it, say what it tests and what it does not, and wait.
- **X.2.2.2** Only a replay of a window after the validation registration's timestamp is
  out-of-sample. Everything else, a later part of the development data or a window a tuning step
  skipped included, is an improvement or a development observation, at most "not refuted"; never
  generalized, independent, quasi out-of-sample or "not overfitted".
- **C.1.4.4** When the instances share one account, the source states the capital budget and its
  allocation: how one batch of signals shares capital, what happens to an opportunity that gets
  none (smaller, later or skipped), and that exit orders only reduce. Callback order and engine
  denials are not an allocation rule. A rule merged from another version is still allocated in the
  same account and registered as one change.
- **J.1.1.1** The ledger and its backup are the only research record; session memory, handoff
  files and working copies do not count. Cite every conclusion and judgment by bundle name, run or
  registration id and ledger commit, without copying measures, counts or eligibility into the
  text; enter material in the ledger before citing it.
- **J.1.2.2** Strategy source, registrations and receipts never go into Git. Change a candidate by
  exporting it to /tmp (`candidate export`), editing the copy and publishing it
  (`candidate publish`).
- **J.3.1.2** Correct a mistake with a new evidence bundle (`evidence add`) naming the corrected
  object (run id, registration or bundle name), the ledger commit it sits in, the correction and
  the reason; never change the original. A summary shows the old statement with its correction
  bundle.
- **C.1.4.2** Before editing source, read the parent's file header. Change only the duty lines the
  change touches, keep every other line byte for byte, and list those duty ids in the
  registration's `changed_duties`.
