---
name: research-round
description: Advances strategy research on a user-selected research line through preregistration, native replay, evidence interpretation and experiment selection. Use when running or interpreting research, choosing the next hypothesis, recommending a candidate or planning user-requested validation.
---

# Research round

Work within the line selected through `research-start`: its starting candidate, development window
and market commit. Choose hypotheses, parents, controls and priorities within that scope. Follow
AGENTS.md's authority boundaries and design-variable ownership; stop and explain before a listed
action.

## Research loop

Commands run as `uv run --frozen python -m cli.main <noun> <verb> ...`. Each command's `--help`
states its arguments, what it writes and what it returns; this skill says when and why to use it.
Resolve refusals through their `next_actions`, never bypass them. Name the line with `--line BUNDLE`
on every command that takes it (`registration add`, `research state`, `research status`,
`research graph`, `line targets`), even while it is the only open line: another session may open
one at any time.

Own initial failure diagnosis from source, native evidence and pinned inputs/runtime. Handle
ordinary strategy errors through [diagnosis.md](references/diagnosis.md). For a suspected product
defect, pass the observed behavior and conflicting product contract to `product-doctor` for focused
diagnosis; attribution may remain unresolved.

For a coverage gap, zero-volume minutes, missing funding or an inferred-quote contract, period or
liquidation use not yet validated, load `research-start` through the host's skill invocation tool
(without one, read its entry and readiness reference) and return its readiness disposition (its
input checks inside an existing line); this is not a new session.

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
verified report cache (`replay report`) and api/causal/activity/readiness items. Its brief says it
reads no host or session memory, which carries earlier sessions' conclusions. It keeps the review
bound to the precheck trial, checks only those four and records `source review`; use a new reviewer
after a repair (Codex: `fork_turns: "none"`). `replay explore` is never economic evidence.

Choose the execution environment, the runner argument `--execution` (never the source), before a
line's first precheck. Pass the same runner arguments to every precheck, registration and replay,
the runtime the precheck returned (`image_ref`) to every registration and replay, and name the
environment in the registration's `conditions`. It is part of the effective
configuration: a control and its candidate share it (`COMPARABILITY_MISMATCH` otherwise), and a
switch later is an identity change ([changes.md](references/changes.md)). `bars` models no
liquidation, so decide from the source's designed distance to liquidation: the adverse move at
which its largest allowed position reaches maintenance margin (a short of entry notional N on
equity E at maintenance rate m needs (E/N - m)/(1 + m), about +99% at N = E). When the window's
prices can travel that distance while a position is held, margin decides survival: use `quotes`
with `--initial-margin`/`--maintenance-margin` from Binance's bracket for the largest position.
When the distance lies far beyond such moves and beyond the inferred quotes' measured error,
`bars` suffices: report liquidation as unmodelled together with that smallest distance. A
notional cap in the source may keep it on `bars`. At lower exposure `quotes` may still be chosen
when the pinned market commit holds them for every month of the trading window and the readiness
check above supports the use.

For causal, trace every market-data price or indicator input reaching order submission, including
quantity inputs and minimum-notional prices, to its observation timestamp. Confirm all precede
submission; a daily signal guard or a passed run audit does not cover other inputs. Read the
prices with `market bars` at the precheck's market commit: the stored bars and funding the
Catalog holds, each with the time it reaches the strategy (`ts_event_ms`, a bar's close); read
tick, size step and minimum notional from `market coverage`'s `terms`. Compare
those times with submission; never script against the market package. Report
unobserved branches as such. Native execution-state and lifecycle reactions retain their own
event-ordering contracts.
An input-clock failure follows [diagnosis.md](references/diagnosis.md): publish a repaired source,
precheck it on the shortest sufficient window, obtain a fresh independent review, then register
anew before the formal replay.

Complete every registered grid point once before reading performance or registering another
batch. Do not add points or tune source within a batch.

Keep iterating within the turn after interpreting results and recording priority. Reports and
judgments do not end the loop. Stop only for the user, an authority boundary, a line that cannot
continue ([changes.md](references/changes.md)) or a due line change.
A line change is due when the recommended version has stayed the same across as many consecutive
research runs as `REVIEW_DUE` counts and each of those runs' `mean_daily_log_difference` lies
within its `detectable_mean_log_difference_80pct_normal_approx`
([feedback.md](references/feedback.md)): stop registering, read `research-start` and follow its
Offer lines and wait, ledger reads included, before asking the user. Options you draft within
this line do not replace its offer. Trial counts and budgets do not reject a research direction;
`REVIEW_DUE` calls for [review.md](references/review.md).

## Evidence and records

- Fills, costs, PnL and plan outcomes come only from product reports or `tables()`. Do not infer
  economic outcomes from signals or price touches, substitute counterfactual estimates, or fill
  masked measures. Additional statistics follow `nautilus-report-analysis`.
- A recommendation or report on a window that overlaps another line's (open or closed) names those
  lines and gives the ledger-wide `trials` and `distinct_sources` from `research status` as the
  conservative upper bound of the trials behind it, since `by_development_window` counts only an
  equal window.
- Cite objects by bundle, trial or registration and ledger commit. Judgment bodies reference facts
  instead of copying measures, counts or eligibility; working reports may display cited product
  values. To the user, name each object by its kind and product id (`trial 67`, `recommendation
  judgment 253`, `ema-fixed-dailyspec@1`), never a bare `#N`.
- Write every free text the ledger keeps (candidate descriptions and differences, conjectures,
  predictions, judgment, evidence and review bodies, line notes and summaries) in English, whatever
  language the conversation uses. Structure anything longer than two sentences for a reader who
  has not seen the conversation: a lead sentence, then short paragraphs or a `- ` list, one point
  each, separated by blank lines. Text kept byte for byte from a parent stays as it is.
- Correct evidence append-only with `evidence add`: identify the original object and commit,
  correction and reason. Present the original with its correction; working copies and session
  memory do not replace either. When a run whose measures the user has seen loses economic
  evidence (`research status` lists it under `without_economic_evidence`), the next message to the
  user names that run, the measures shown and the reason they no longer count.
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
