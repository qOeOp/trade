"""The research ledger: connections and the single write protocol (db), candidates (strategies),
evidence bundles (evidence), research lines (lines), trials, their start receipts, execution
captures and sealed runs (trials, execution, coverage), native run metrics (metrics), judgments
(judgments) and time witnesses (witness), on a typed Dolt database.

The research-chain chapters and database pages state the rules; `ledger.<name>` in them is the
function `<name>` in this package. Functions are not re-exported here: `ledger.witness` is both a
module and a function.
"""
