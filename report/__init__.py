"""Read-only report readers: the single-run report and its read-time measures (runs, measures, profit), the
comparison report with its paired test, attribution and trade pairing (comparison, attribution),
the candidate list (candidates), research facts and state (status), a line's research graph (graph), its
closing history test (history) and the whole-ledger review with its backup checks (review). Every reader goes
through the one qualification view (registration.availability); none carries a score or ranking, none writes
the ledger, and only history gives a verdict: whether a candidate meets the user's targets.

The research-chain chapters state the rules; `report.<name>` in them is the function or module
`<name>` in this package. Market reads, reproduction and the engine's report comparison are
reached through `report.seams`.
"""
