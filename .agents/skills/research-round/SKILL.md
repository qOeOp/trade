---
name: research-round
description: Advances strategy research on a user-selected research line through preregistration, native replay, evidence interpretation and experiment selection. Use when running or interpreting research, choosing the next hypothesis or parameter grid, recommending a candidate or planning user-requested validation.
---

# Research round

Work within the line selected through `research-start`: its starting candidate, development window
and market commit. Choose hypotheses, parents, controls and priorities within that scope. Follow
AGENTS.md's authority boundaries and design-variable ownership; stop and explain before a listed
action. A sizing value you proposed stays your design variable when the user picks or repeats it.

## Research loop

Commands run as `uv run --frozen python -m cli.main <noun> <verb> ...`. Each command's `--help`
states its arguments, what it writes and what it returns.
Resolve refusals through their `next_actions`, never bypass them. A `CONCURRENT_WRITE` wrote
nothing: keep no evidence bundle for it. Name the line with `--line LINE`
on every command that takes it, even while it is the only open line: another session may open one
at any time.

A `references/` link resolves against this skill's base directory: Read that path directly, never
search for it.

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
| Sources, parent, control and hypothesis | `evidence export`, `evidence add` | [hypothesis.md](references/hypothesis.md), `research-sources` |
| Candidate | `candidate new`, `candidate export`, `candidate publish` | [strategy-authoring.md](references/strategy-authoring.md) |
| Technical evidence | `replay precheck`, independent `source review` | Review requirements below |
| Preregistration | `registration add` | [hypothesis.md](references/hypothesis.md), [root body](templates/registration-root.json), [derived body](templates/registration-derived.json) |
| Execution | `replay run --registration ID` | Registered grid and execution identity |
| Interpretation | `replay report`, `hypothesis compare` | [diagnosis.md](references/diagnosis.md), [attribution.md](references/attribution.md), [feedback.md](references/feedback.md) |
| Next decision | `judgment add`, `research state`, `research status` | [feedback.md](references/feedback.md); [review.md](references/review.md) before writing a recommendation |

Precheck the published source on the shortest window and fewest contracts the change needs. A
fresh reviewer with no authoring context receives only the candidate id, sealed precheck bundle,
verified report cache (`replay report`) and api/causal/activity/readiness items. Its brief says it
reads no host or session memory, which carries earlier sessions' conclusions. It keeps the review
bound to the precheck trial, checks only those four and records `source review`; use a new reviewer
after a repair (Codex: `fork_turns: "none"`). Api, causal and readiness are source properties,
activity this precheck's; each guards one risk. The api item covers every native call in the source
against the pinned image, whether or not the precheck ran it. Nautilus is compiled: `__doc__` and
`inspect.getsource` give nothing; its signatures are in the `.pyi` stubs of the installed
`nautilus_trader` package, which `rg` searches only with `-uu`. Causal: inputs precede submission
(below). Activity: the precheck filled orders, so its order path ran. Readiness: no decision before
each indicator has converged on its warm-up history, not research-start's input-coverage check.
Native `initialized` is not convergence for a recursive indicator (strategy-authoring.md). `replay
explore` is never economic evidence.

Choose the execution environment, the runner argument `--execution` (never the source), before a
line's first precheck. Pass the same runner arguments to every precheck, registration and replay,
and the runtime the precheck returned (`image_ref`) to every registration and replay. The
environment is part of the effective configuration: a control and its candidate share it. `bars` models no
liquidation, so decide from the source's designed distance to liquidation: the adverse move at
which its largest allowed position reaches maintenance margin (a short of entry notional N on
equity E at maintenance rate m needs (E/N - m)/(1 + m), about +99% at N = E). When the window's
prices can travel that distance while a position is held, margin decides survival: use `quotes`
with `--initial-margin`/`--maintenance-margin` from Binance's bracket for the largest position.
When the distance lies far beyond such moves and beyond the inferred quotes' measured error,
`bars` suffices: report liquidation as unmodelled together with that smallest distance. At lower
exposure `quotes` may still be chosen when the pinned market commit holds them for every month of the trading window and research-start's
readiness check supports the use.

Trade-level inputs (`--trade-ticks`, only with `--execution quotes`) and open interest or long/short
ratios (`--metrics`) are runner arguments, decided and passed like `--execution`:
[strategy-authoring.md](references/strategy-authoring.md), Trades and metrics.

For causal, trace every market-data price or indicator input reaching order submission, including
quantity inputs and minimum-notional prices, to its observation timestamp. Confirm all precede
submission; a daily signal guard or a passed run audit does not cover other inputs. Read the
prices with `market bars` at the precheck's market commit: the stored bars and funding the
Catalog holds, each with the time it reaches the strategy (`ts_event_ms`, a bar's close); read
tick, size step and minimum notional from `market coverage`'s `terms`. Compare
those times with submission; never script against the market package. Report
unobserved branches as such. Native execution-state and lifecycle reactions retain their own
event-ordering contracts.
An input-clock failure follows [diagnosis.md](references/diagnosis.md).

Complete every registered grid point once before reading performance or registering another
batch. Do not add points or tune source within a batch.

Keep iterating within the turn after interpreting results and recording priority. Reports and
judgments do not end the loop. Stop only for the user, an authority boundary, a line that cannot
continue ([changes.md](references/changes.md)) or a due change of approach. Reaching both targets is no
stop: when a recommendation first does, tell the user once that validation is theirs to start and
only a window after its registration counts, then keep working, asking nothing.
A change of approach is due when the last `review_every` research runs in a row each
leave candidate and control undistinguished (none of `mean_log_basic_interval`,
`mean_log_studentized_interval` and `annual_return_difference_interval` excludes zero;
[feedback.md](references/feedback.md)), whether or not the recommendation moved among them.
`research state` lists these runs (`undistinguished_runs`) beside `review_every`. The ledger holds
neither the user's choices of line or approach nor which runs only scale, so apply both yourself:
count only runs after the user's last choice, which answers the runs before it, and leave
scale-only runs out of the count, judging them against the targets
([feedback.md](references/feedback.md)), even when one ended the list. When due, stop registering
and offer approaches inside this line ([feedback.md](references/feedback.md), Change approach).
Offer no other line, closing this one, new starts or template roots: other open lines may be
another session's, and the user changes lines through `research-start` when they ask. Trial
counts and budgets do not reject a research direction;
`REVIEW_DUE` calls for [review.md](references/review.md).

## Evidence and records

- Fills, costs, PnL and plan outcomes come only from product reports or `tables()`. Do not infer
  economic outcomes from signals or price touches, substitute counterfactual estimates, or fill
  masked measures, not even as a labelled rough figure the user asks for. Additional statistics follow `nautilus-report-analysis`.
- A recommendation or report gives the trials behind it from `research status` (`multiple_testing`:
  `effective_trials` to `all_purpose_trials`, every line's trials on the contract over an
  overlapping window), and names the other lines (open or closed) whose windows overlap. It gives
  the recommended run's deflated Sharpe range beside them (`deflated_sharpe`,
  [ratios](../nautilus-report-analysis/references/ratios.md)).
- Before recommending a candidate, replay a buy-and-hold reference with `replay explore`: a /tmp
  draft that buys the candidate's contracts at trade start in equal parts of the starting equity
  and holds them to the end, under the candidate's runner arguments, so the runner charges its fees
  and funding. A changed image alone does not repeat it: cite the earlier trial. Give its annual
  return and MARK maximum drawdown beside the candidate's under Market exposure, named as an unverified exploration. It is never a registration's control or economic
  evidence; return beyond market exposure is read from the candidate's market intercepts
  (`alpha_basket`, `alpha_btc`) and their standard errors, `alpha_btc` first for a candidate trading
  BTC alone. A recommendation written while lines wait on the user's choice (research-start) replays
  nothing: it cites existing results and says the reference has not run; it runs after the choice.
- Cite objects by bundle, trial or registration and ledger commit. Judgment bodies reference facts
  instead of copying measures, counts or eligibility, apart from a recommendation's trial counts
  above; working reports may display cited product values. To the user, name each object by its kind and product id (`trial 67`, `recommendation
  judgment 253`, `ema-fixed-dailyspec@1`), never a bare `#N`.
- Write every free text the ledger keeps (candidate descriptions and differences, conjectures,
  predictions, judgment, evidence and review bodies, line notes and summaries) in English, whatever
  language the conversation uses. Structure anything longer than two sentences for a reader who
  has not seen the conversation: a lead sentence, then short paragraphs or a `- ` list, one point
  each, separated by blank lines.
- Correct evidence append-only with `evidence add`: identify the original object and commit,
  correction and reason. Present the original with its correction; working copies and session
  memory do not replace either. When a run whose measures the user has seen loses economic
  evidence (`research status` lists it under `without_economic_evidence`), the next message to the
  user names that run, the measures shown and the reason they no longer count.
- Export candidate source into /tmp before editing and publish the change as a new candidate.
  Read its duty header, edit only affected duty lines, preserve the others byte for byte and
  register those ids in `changed_duties`.

## Conditional workflows

- Transcribing a template or user source, publishing the root and its first report: [template.md](references/template.md).
- Resolving duty scope or stance: [duty-directory.md](references/duty-directory.md).
- Authoring a complete report: [report.md](templates/report.md).
- Runtime, data, contract or execution environment identity changes: [changes.md](references/changes.md).
- Out-of-sample validation: [validation.md](references/validation.md), only after the user requests
  it. When the user accepts a candidate, ask once whether to validate it and wait. Only a window
  after the validation registration's timestamp is out-of-sample. Development data, including
  previously unused subsets, support conditional observations, never independent validation or
  claims of generalization or absence of overfitting.

The user's return and drawdown targets guide interpretation and priority, not candidate eligibility.
