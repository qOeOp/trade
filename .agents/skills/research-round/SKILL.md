---
name: research-round
description: Advances strategy research on a user-selected research line through preregistration, native replay, evidence interpretation and experiment selection. Use when running or interpreting research, choosing the next hypothesis, recommending a candidate or planning user-requested validation.
---

# Research round

Work within the line selected through `research-start`: its starting candidate, development window
and market commit. Choose hypotheses, parents, controls and priorities within that scope. Follow
AGENTS.md's authority boundaries and design-variable ownership; stop and explain before a listed
action. Host process termination or configuration changes also require the user's authority.

## Research loop

Commands run as `uv run --frozen python -m cli.main <noun> <verb> ...`. Each command's `--help`
states its arguments, what it writes and what it returns; this skill says when and why to use it.
Resolve refusals through their `next_actions`, never bypass them.

| Stage | Commands | Read for this stage |
|---|---|---|
| Sources and hypothesis | `evidence export`, `evidence add` | [hypothesis.md](references/hypothesis.md), `research-sources` |
| Candidate | `candidate new`, `candidate export`, `candidate publish` | [strategy-authoring.md](references/strategy-authoring.md) |
| Technical evidence | `replay precheck`, independent `source review` | Review requirements below |
| Preregistration | `registration add` | [root body](templates/registration-root.json), [derived body](templates/registration-derived.json) |
| Execution | `replay run --hypothesis BUNDLE` | Registered grid and execution identity |
| Interpretation | `replay report`, `hypothesis compare` | [diagnosis.md](references/diagnosis.md), [attribution.md](references/attribution.md) |
| Next decision | `judgment add`, `research state`, `research status` | [feedback.md](references/feedback.md) |

Precheck the published source on the shortest window and fewest contracts the change needs. A
fresh reviewer with no authoring context receives only the candidate id, sealed precheck bundle,
verified report cache (`replay report`) and api/causal/activity/readiness items, keeps the review
bound to the precheck trial, checks only those four and records `source review`; use a new reviewer
after a repair (Codex: `fork_turns: "none"`). `replay explore` is engineering, never economic
evidence.

Complete every registered grid point once before reading performance or registering another
batch. Do not add points or tune source within a batch.

Keep iterating within the turn after interpreting results and recording priority. Reports and
judgments do not end the loop. Stop only for the user, an authority boundary or a line change
through `research-start`, which is due when no remaining change within the line could exceed the
comparison's detectable difference ([feedback.md](references/feedback.md)). Trial counts and
budgets do not reject a research direction; `REVIEW_DUE` calls for [review.md](references/review.md).

## Evidence and records

- Fills, costs, PnL and plan outcomes come only from product reports or `tables()`. Do not infer
  economic outcomes from signals or price touches, substitute counterfactual estimates, or fill
  masked measures. Additional statistics follow `nautilus-report-analysis`.
- Cite objects by bundle, trial or registration and ledger commit. Judgment bodies reference facts
  instead of copying measures, counts or eligibility; working reports may display cited product
  values.
- Correct evidence append-only with `evidence add`: identify the original object and commit,
  correction and reason. Present the original with its correction; working copies and session
  memory do not replace either.
- Export candidate source into /tmp before editing and publish the change as a new candidate.
  Read its duty header, edit only affected duty lines, preserve the others byte for byte and
  register those ids in `changed_duties`.

## Conditional workflows

- Transcribing a template or user source: [template.md](references/template.md).
- Resolving duty scope or stance: [duty-directory.md](references/duty-directory.md). The header
  template is supplied by `candidate new` and `candidate export`.
- Authoring a complete report: [report.md](templates/report.md).
- Runtime, data or contract identity changes: [changes.md](references/changes.md).
- Out-of-sample validation: [validation.md](references/validation.md), only after the user requests
  it. When the user accepts a candidate, ask once whether to validate it and wait. Only a window
  after the validation registration's timestamp is out-of-sample. Development data, including
  previously unused subsets, support conditional observations, never independent validation or
  claims of generalization or absence of overfitting.

The user's return and drawdown targets guide interpretation, not candidate eligibility.
