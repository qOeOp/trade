# vibe-execution-owner

Execution Owner contracts and custody for the trading side:

- `adapter_binding`: the untrusted PAPER adapter-binding vocabulary, the single commit and
  resolution rule, and the sealed `AdmittedPaperAdapterBinding` that only that rule can mint.
- `adapter_binding_postgres`: the production PostgreSQL custody (`execution_private`) that applies
  the rule under one per-node stream lock, records every fact with its outbox row, and exposes
  read-only `execution_api` functions to other Owners.
- `paper_account_opening`: the Execution-committed opening collateral fact of a simulated PAPER
  account, the source Portfolio derives a PAPER Capacity View from.
- `recovery_frontier`: the query-only PAPER recovery-frontier read seam consumed by the Runtime
  foundation; its production custody is not yet admitted.

The inherited execution engine in `vibe-execution` stays a migration source and holds no Owner
fact. This crate has no adapter invocation surface, no order lifecycle, no Effect Journal, and no
credential material. See `docs/owners/execution.md` for the contract and its admission ledger.
