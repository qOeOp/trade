# On-demand market scan scenario

A user or external agent asks which instruments currently satisfy a strategy's conditions. This is R&D read-only
discovery, with no new department, scan schedule, deployment proposal or trading authority. Running strategies already
consume market data continuously and need no scan wake-up.

## Entry

Bind Artifact version, market/universe rule, windows, evaluation cut/clock and resource limit. Undeployed or unqualified
Artifacts may observe, but their signals are not qualified opportunities. Same-meaning request retries join one job.

## Value path and handoffs

1. R&D admits the query, access scope and resources, then persists job identity.
2. Market Data supplies verified references, members and availability cuts through typed interfaces, retaining per-instrument gaps.
3. The R&D observation Host reuses the sealed Artifact and native strategy evaluator on the exact input prefix, with no execution authority.
4. R&D commits results for agents or Dashboard. Broad queries may finish asynchronously and outlive MCP/chat.

## Result and proof

Bind Artifact, data version, evaluation time and universe. Return signals, reconstructed rule state, trigger/distance,
total/completed counts, exclusions and incomplete reasons. In-trend is reconstructed history, not an account position;
authorized account reads are separate. Empty results can prove completion without signals. Stale/missing/unknown
inputs cannot prove no opportunities. Per-instrument failures do not hide successful members or turn partial coverage
into a completed whole-market scan.

## Failure, recovery and boundaries

- Resume the original job/result after restart; resolve unknown identity before duplicate jobs or commitment release.
- Consume only admitted scope and available inputs; queries cannot bypass protected data or research exposure records.
- Pure judgments agree with running strategies for the same Artifact/input prefix/clock. Observation state cannot mutate real orders or positions.
- Results grant no qualification, governance authority, trading intent or order. Subsequent trading uses Qualification, Governance and the native node.

## Implementation and acceptance

The full path remains target. Cover queries, empty results, partial gaps, retries, restart, resource stops and native
judgment comparison while proving no orders, activations or account writes. See [R&D discovery](../owners/rd/#target---on-demand-read-only-opportunity-discovery).
Old scheduled deployment Scanner receipts remain in the [legacy migration contract](../owners/scanner/#target-role-and-legacy-contract-migration),
not a prerequisite, result or new development route for this scenario.
