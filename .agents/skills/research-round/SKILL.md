---
name: research-round
description: Preregister and advance continuous strategy research within the user's selected route, read candidate comparisons, append diagnosis and recommendations, or plan independent confirmation. Use before research replay, choosing the next experiment, or claiming improvement or generalization.
---

# Continuous candidate research

The user chooses the research route and decides recognition, independent validation and deployment.
Within that route, advance autonomously through complete candidates. A candidate is one exact source
revision with a development parent, actual rule change and replay evidence. Significance, target
attainment and recommendation never create its identity or grant permission to derive from it.

Read the goal, candidate forest, fixed market commit and latest append-only knowledge/notes first.
Use [records.md](references/records.md) for CLI and [hypotheses.md](references/hypotheses.md) for locked
registration. Complete source stays in Dolt, working copies in `/tmp`. Keep one complete source file
per independent strategy; use [strategy-authoring.md](references/strategy-authoring.md) and the image's
actual constructor contract. Every replay follows [runs.md](references/runs.md).

## Before a research replay

Publish the proposed exact source with its parent and difference, complete the native engineering
precheck and exact-source review in [strategy-authoring.md](references/strategy-authoring.md), then
preregister before the research replay. Precheck is not research or independent validation.
Each hypothesis makes one actual rule change; a coupled entry/exit rule is one coupled action,
without claiming independent component attribution. Separate the development parent from the fixed
comparison control, with reasons for each. All registered grid cells derive from that parent.

Lock five things: economic reason (including prediction and proxies), retained source evidence,
one comparison dimension, complete grid (up to five points), and applicable conditions. Conditions
name source, actual change, parameters, inputs, window and runtime; they are never an excluded class.
Explain how different possible results would change the next research action. Sources discovered
later are appended as later evidence, not backfilled into the registration. For external sources use
`research-sources` or `video-evidence`; conjectures are labeled and may have low priority.

Use `hypothesis register` and `artifacts run --hypothesis`; generic exploration is not registered
candidate evidence. The product checks locked source, lineage, input/runtime/configuration and
comparison conditions, and consumes each grid point atomically before replay. Failed or interrupted
attempts remain attempts. A repair/retry requires a new registration and cannot become independent
evidence merely by repeating identical conditions.

## Feedback and continuation

1. Read `availability` first: it is the current checker view, separate from retained `run.status`.
   Real native fills with matching orders, position cycles and account records are required for
   economic feedback. Zero fills are diagnostic only: distinguish no signal, not ready, no rule
   opportunity, unfilled order, rejection and exception using original evidence. Never rank zero
   fills above a losing control or compute p/CI for it. Zero fees/funding, low frequency, small
   samples, losses and non-significance impose no economic exclusion. Read integrity next. Invalid or incomplete attempts provide reasons and repair evidence only,
   no economic feedback, comparison, rejection of a mechanism or positive reward.
2. Read audited native account return, MARK drawdown, plan win rate, fees, funding and open exposure.
   Closed price P&L is a diagnostic, not account net profit. Derive additional statistics with
   `nautilus-report-analysis`.
3. Read `hypothesis compare`: observed account effect, interval, p and conditions separately. The
   implemented annual-return test pairs daily log returns in weekly circular blocks; it tests zero
   mean log difference, not a minimum improvement or probability of strategy validity. Other metric
   inference is currently undefined and must not reuse this p value. Review sample size, dependence,
   detectable effect and block sensitivity. Grid Bonferroni is not full adaptive-search control.
4. Append facts, unproven explanation and next falsifiable hypothesis with report/registration IDs
   and ledger commits. Prior history is conditional evidence, never rewritten.
5. Update the priority of specific next research actions using expected effect, uncertainty,
   mechanism support, explored coverage, new information and execution cost. Bad gross edge can
   favor a new signal, but execution/exits remain researchable. Non-significance, a losing parameter
   or target failure does not close a mechanism, forbid the original grid or prevent valid descendants.
   Retain low-priority actions and explain when to reassess them. Unmeasured directions are unknown,
   never economically superior by default.

## Recommendation and review

At a review or recommendation request, consider **all currently comparable candidates**, explain
return/drawdown/Sharpe/win-rate/cost/mechanism/uncertainty tradeoffs, and append reasons to existing
notes. Choose one or a set without waiting for future research to finish. Recommendation is distinct
from the next experiment's parent and its research priority; neither implies independent validation
or deployment authority. No Bayesian optimizer or Thompson scheduler is prescribed.

Research continues by default. Declare an attempt/progress-based review cadence and its reason in
notes; counts trigger review, never a scientific exhaustion proof or fixed ten-attempt termination.
Use `round status` factual counts to distinguish valid, invalid and unfinished attempts. Optional
user execution limits pause execution with recovery information, not economic invalidity. Continue
within the route when useful; to change the user's route, present diagnosis and options and await
selection. There is no requirement to prove the old route has zero value; it remains reassessable.

## Targets and independent validation

The user's three targets are unchanged; see [feasibility.md](references/feasibility.md). Sizing and
risk are Agent design variables. Existing freeze/confirm commands are target snapshots with their
own main-image, freshness and future-data protections; they do not gate continuous candidate work.
Before an optional freeze snapshot, retain the stability check across sub-periods/instruments when the result rests on one period or a few instruments; it does not gate ongoing research. Only user-initiated confirmation follows [confirmation.md](references/confirmation.md).
Development or knowledge-exposed data, including withheld historical slices the model could know,
can refute or leave a mechanism unrefuted, never prove generalization. Preserve full search history.

Never infer trades, P&L or winning plans from price touches or proxy counts. Native Nautilus owns
orders, fills, fees, funding, account state and ambiguous intrabar matching. Do not manufacture
ordering from same-bar levels. A clean exit or unit tests is not native parity or research evidence.
