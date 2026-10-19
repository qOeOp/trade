"""The research ledger: connections and the single write protocol (db), candidates (strategies),
evidence bundles (evidence), research lines (lines), trials, their start receipts, execution
captures and sealed runs (trials, execution, coverage), native run metrics (metrics), judgments
(judgments) and time witnesses (witness), on a typed Dolt database.

The design pages (design-code-ledger, design-ledger, chapter 13) are the specification; a design
id `ledger.<name>` is the function `<name>` of the module the design names. Functions are not
re-exported here: `ledger.witness` is both a module and a function of the design.
"""
