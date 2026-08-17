# Scheduled scan scenario

Scanner is the slow track that periodically asks which governed strategies are applicable now. Every tick
produces one terminal Scanner Receipt; only `PROPOSED` carries a deployment proposal, never a deployment or trade.

## Entry / 入口

The exact schedule-definition version, scan-scope identity and version, and canonical unambiguous due-slot boundary
derive one stable attempt identity before execution. Clock epoch and continuity are admission evidence, not part of
that identity. Duplicate delivery, concurrency, restart, or late execution joins the attempt and terminal receipt.
An unknown scope, clock continuity, or conflicting due slot creates no attempt or proposal. There is no interactive
approval inside the scan.

## Value path / 价值路径

Strategy Loader reads deployable ArtifactRefs, activation rules, data needs, versions, and lifecycle limits from Strategy
Governance. Market Snapshot binds each strategy's supplied universe-selection rule, required symbols, windows,
quality rules, PIT facts, calendars, sessions/time zones, corporate actions, historical membership, and Market
Semantics Compatibility identity, or a negative
input disposition. Strategy Matcher evaluates each strategy independently. If the published activation condition requires
Capacity View, it binds the candidate-neutral capacity scope, account-fact cut, valuation and liquidity
inputs, pool methodology and assumption versions, measurement time, and validity deadline. The strategy's
generation-specific economic condition remains a separate input.
Proposal Builder includes exactly the complete matches.
One strategy's missing or failed input never suppresses a valid proposal for another strategy.

## Owner handoffs / Owner 交接

Strategy Governance → Scanner supplies registry facts and activation conditions. Market Data → Scanner supplies
the timestamped market facts. Portfolio → Scanner may supply only a bounded Capacity View for proposal planning.
Scanner → Strategy Governance submits the terminal Scanner Receipt. There is no Scanner → Runtime handoff.
Governance may consider `PROPOSED` only inside a pre-existing authorized unattended lifecycle lineage and must
commit its own lifecycle and Capital Allocation Disposition.

## Proof / 证明

Each tick ends exactly once as `PROPOSED`, `NO_MATCH`, `INSUFFICIENT_DATA`, `COMPLETED_NO_PROPOSAL`, or
`FAILED`. A complete receipt binds equal expected
and observed strategy sets with one disposition per member. `PROPOSED` means at least one strategy has matching evidence and carries
exactly those proposal members while preserving all negative dispositions. `NO_MATCH` requires all strategies to be evaluable.
`INSUFFICIENT_DATA` means no match, no `CONDITION_FAILED`, and at least one data-blocked strategy. A complete set
with no `MATCHED` and at least one local `CONDITION_FAILED` is `COMPLETED_NO_PROPOSAL` and retains every member.
`FAILED` is batch-only and means either `INCOMPLETE_FAILED` or independently evidenced
`BATCH_OPERATIONAL_FAILED`. An incomplete receipt closes as follows: with known expected membership it binds exact expected, observed, and missing sets;
with unresolved membership it binds the authoritative unresolved-set disposition, observed facts, an
explicit missing-members-unavailable marker, and terminal reason without inventing members. An operationally
failed receipt binds one category from `SCHEDULER_ORCHESTRATION_FAILURE`, `SCANNER_SERVICE_FAILURE`, or
`SHARED_DEPENDENCY_OPERATIONAL_FAILURE` plus its failure identity, evidence source cuts, and Time Evidence.
Only an independently evidenced typed batch system failure or an incomplete disposition set closes first as batch
`FAILED`; no local disposition, including `CONDITION_FAILED`, can create that batch failure. Total precedence is independent
batch `FAILED`, complete `PROPOSED`, complete `COMPLETED_NO_PROPOSAL`, `INSUFFICIENT_DATA`, then `NO_MATCH`.

## Development outcome / 开发结果

- **Beneficiary** — strategy operators who need periodic opportunity discovery without allowing a scheduler to deploy or trade.
- **Observable outcome** — every scheduled tick accounts for the complete governed registry and returns exact matches, negative dispositions, missing members, and one terminal receipt.
- **Harm if unchanged** — stale or data-poor strategies could be silently promoted, valid matches could disappear behind another failure, or Scanner could become a hidden deployment authority.
- **Terminal negative** — `NO_MATCH`, `INSUFFICIENT_DATA`, `COMPLETED_NO_PROPOSAL`, or `FAILED` produces no deployment; only exact members of a complete `PROPOSED` receipt may be considered by Governance.

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- Missing history, stale market data, unknown instrument identity, or unmet lifecycle limits block only dependent strategies.
- A data-blocked strategy cannot enter a proposal, but it cannot hide complete matches for unrelated strategies.
- A match cannot produce `PROPOSED` while `INCOMPLETE_FAILED` leaves the disposition set incomplete or an
  independently evidenced `BATCH_OPERATIONAL_FAILED` is active.
- An incomplete `FAILED` view exposes exact missing members only when expected membership is known; otherwise it
  exposes the unresolved-set disposition and missing-members-unavailable marker. An operational `FAILED` view
  exposes its independent typed category and evidence identity. Neither pretends the set is complete, and a local
  `CONDITION_FAILED` instead closes a complete no-match set as `COMPLETED_NO_PROPOSAL`.
- Governance can activate only an exact matched proposal member from the same receipt, never a negative or nonmember strategy.
- Portfolio capacity is an advisory fact projection; Scanner cannot allocate capital from it.
- Capacity View is optional unless the published condition requires it; when required, any missing, stale, unavailable, partial, or identity-mismatched field commits `INPUT_UNAVAILABLE` and cannot produce `MATCHED`.
- A proposal is not activation, eligibility, a trade intent, or an order command.
- A proposal is evidence, not authorization. Missing authorized unattended lineage or a separate Governance
  decision creates no Runtime application even for an exact match.
- Scanner cannot start Runtime, bypass Governance, or retry an external trading effect.
- A changed cadence, calendar, time zone, fold/gap, misfire, or backfill rule requires a successor schedule
  definition; it cannot reinterpret a committed slot or rename an attempt with a clock epoch.
