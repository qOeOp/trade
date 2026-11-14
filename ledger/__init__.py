"""The research ledger on a typed Dolt database: connections and the single write protocol (db), and
one module per kind of record or administration task, the compose service, its first-run page and the
read-only mirror among them (service, first_run, replica).

The research-chain chapters and database pages state the rules; `ledger.<name>` in them is the
function `<name>` in this package. Functions are not re-exported here: `ledger.witness` is both a
module and a function.
"""
