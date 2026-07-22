# research/rd-loop-runner

## Type

atomic module

## Owns

- One auditable R&D loop iteration.
- Research artifact write, catalog registration, ledger append, and optional RD state writeback.

## Inputs

- Candidate batch payload fields.
- Optional artifact root, ledger path, catalog DB path, and run id.
- Optional RD program writeback binding；`rd_program_ref` 出现时必须同时显式提供 `rd_state_db`，library 不回退到当前工作目录下的默认库。

## Outputs

- `strategy-rnd-loop-result`.
- Research artifact JSON.
- Catalog artifact registration and R&D ledger record.
- Optional RD memory writeback.

## Boundaries

- May write only research artifacts, catalog metadata, R&D ledger, and explicit RD state writeback.
- Does not run campaigns, supervise loops, review evidence, promote strategies, write `trade.db`, or call exchange APIs.
- Uses `research-strategy-development/candidate-batch-engine` for candidate evaluation.
- Uses `research-strategy-development/rd-ledger` for ledger and holdout idempotence helpers.
