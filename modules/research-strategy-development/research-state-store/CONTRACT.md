# Research State Store Contract

Owns `research_state_store`, the durable R&D program, hypothesis, trial, holdout-use, and lesson ledger.

## Responsibilities

- Create and migrate `data/rd_state.db`.
- Upsert current RD program state.
- Upsert hypothesis queue/status rows.
- Append trial and locked holdout-use ledger rows.
- Append lessons learned by kind.

## Boundaries

- Does not run experiments or replay.
- Does not promote strategies.
- Does not write `trade.db`.
- Does not call exchange APIs.

