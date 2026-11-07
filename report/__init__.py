"""Read-only report readers: the single-run report and its read-time measures (runs, measures), the
comparison report with its paired test, attribution and trade pairing (comparison, attribution),
the candidate list (candidates), research facts and state (status), the whole-ledger review
(review) and the cross-image consistency comparison (reproduce). Every reader goes through the one
qualification view; none carries a verdict, score or ranking, and none writes the ledger.

The research-chain chapters state the rules; `report.<name>` in them is the function or module
`<name>` in this package. Market reads, reproduction and the engine's report comparison are
reached through `report.seams`.
"""
