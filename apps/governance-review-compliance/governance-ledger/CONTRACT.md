# Governance Ledger Contract

Owns `governance_ledger`, the append-only evidence, promotion decision, closed-flow review, and review batch store.

## Responsibilities

- Create and migrate `data/governance.db`.
- Append governance evidence records.
- Append promotion decisions with evidence refs.
- Append closed-flow review records.
- Record review sweep batches and candidate refs.

## Boundaries

- Does not run strategy R&D.
- Does not write `trade.db`.
- Does not call exchange APIs.
- Does not decide live execution permissions by itself; policy snapshots and preflight remain separate gates.
