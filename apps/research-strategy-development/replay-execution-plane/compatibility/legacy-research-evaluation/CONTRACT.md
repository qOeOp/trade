# Legacy Research Evaluation

## Type

legacy research evaluation compatibility module

## Owns

- Legacy replay trade summary and diagnostic calculations。
- Legacy chronological anti-overfit and regime/cost robustness reports。
- Legacy replay candidate gate thresholds and blocker vocabulary。

## Inputs

- Structural legacy trade metric views。
- Optional legacy anti-overfit stage、split ratio and search-size fields。

## Outputs

- Legacy replay statistics、diagnostics、robustness and anti-overfit reports。
- Legacy shadow-candidate gate result；`live_small_candidate` remains false。

## Boundaries

- 只评估 caller 提供的 legacy trade facts，不执行或递归调用 Replay。
- 不生成 Signal、Fill、trade facts、provenance、Artifact 或 promotion decision。
- 不是 native Replay metrics 或 Reviewer authority，不得为新 Result contract 背书。
- 随 legacy evaluation consumers 一并退役。
