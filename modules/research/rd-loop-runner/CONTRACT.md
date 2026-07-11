# research/rd-loop-runner

## Type

atomic module

## Owns

- One auditable R&D loop iteration.
- Research artifact write, catalog registration, ledger append, and optional RD state writeback.

## Inputs

- Candidate batch payload fields.
- Optional artifact root, ledger path, catalog DB path, run id, and RD program state path.

## Outputs

- `strategy-rnd-loop-result`.
- Research artifact JSON.
- Catalog artifact registration and R&D ledger record.
- Optional RD memory writeback.

## Boundaries

- May write only research artifacts, catalog metadata, R&D ledger, and explicit RD state writeback.
- Does not run campaigns, supervise loops, review evidence, promote strategies, write `trade.db`, or call exchange APIs.
- Uses `research/candidate-batch-engine` for candidate evaluation.
- Remaining direct dependency on `strategy-rd` ledger helpers is transitional until ledger ownership is split or moved to a shared research contract.
