# Diagnosing one run

Read when a replay has finished and you read one run's eligibility and report
(`replay report --run-id RUN`).

Diagnose in this order: eligibility; failure or zero activity; clocks and readiness; capital use
next to drawdown (`nautilus-report-analysis` capital.md); profit sources and quality; the signal
table (attribution.md).

## Eligibility, failure and zero activity

- Read the run's economic-evidence eligibility first: available or not, with every reason and the
  checker identity. The code decides it; a masked measure is never recomputed from native files or
  anywhere else. A run with no fills, or whose orders, fills, positions and account do not
  reconcile, is diagnostic only: from the native order events, readiness times and anomaly
  records, put its cause in one of six classes (no signal, indicator not ready, no opportunity
  matching the rules, order placed but not filled, order rejected, anomaly). Never compare it with
  a losing run or change a priority because of it.
- An invalid run, a run whose execution record shows a failed or unfinished stage, and source
  whose precheck failed get only a repair record: the cause, the reference to the original and
  the repair. Do not read their measures, record a loss against the direction, change a priority
  or use them in a review; their trials still count. After the fix, publish the new source (a root
  before its first report again without a parent, template.md), precheck, review and register
  again with `retry_of` naming the consumed registration, if any. A product defect is fixed and
  merged to main before the retry runs.

## Clocks

- A fill must be strictly later than the close of the bar the decision was made on. Check each
  plan's decision, submit and fill timestamps after the precheck and after the replay. A fill at
  the decision time is an implementation defect even when the audit passed: withdraw the economic
  interpretation of that run, fix the source, publish, precheck, review and register again; never
  use it as economic evidence.
- A hypothesis that changes a signal timeframe or an indicator length registers its
  initialization conditions, and the interpretation states when each side could first decide. A
  result caused by different readiness is not the mechanism.

## Size and quality

- Size is part of the strategy: the account difference it brings counts in full, read against the
  drawdown and annual-return targets. Read exposure beside drawdown, and quality beside uncertainty:
  return per unit of exposure, Sharpe and annual return over maximum drawdown are descriptive and
  do not isolate sizing skill. The level and timing terms are account-currency PnL decompositions,
  not scale-free quality measures; read their report definition notes. Funding income counts;
  name where the profit came from with the profit bridge. When both sides lose, a smaller loss
  that comes from smaller exposure is not better quality.
