# Legacy Portfolio Cycle

## Type

P10 / P11 / P13 historical Replay compatibility consumer。

## Owns

- 固定 cycle-2 Reallocation 与 fixed two-cycle Result/Artifact 的历史执行和读回。
- P12 v1 Sequence 的旧 consolidated Accounting/Artifact 读回。
- 既有 schema、hash、manifest-last、幂等与 failure semantics；不修改历史 wire。

## Boundaries

- 不属于 canonical public entrypoint 或 opt-in activation registry。
- 禁止新增生产消费者；只允许历史 Artifact 读回、迁移和 compatibility certification。
- Canonical runner 不得生产依赖本模块；仅现存 `replay-independent-lane-batch-runner.test.ts` 可在共享 fixture 拆出前反向执行历史 certification。
- 不接管 P12 bounded-sequence 原语、P14–P29 successor、Control Plane authority 或新经济语义。
- 不新增 Result/Artifact/Checkpoint epoch，不扩大 cycle count、reentry、margin、liquidity 或 Fast 能力。

## Retirement Gate

- P10/P11/P13 历史 Artifact 已有版本化 reader/migration fixture。
- 仓库内直接生产消费者归零，compatibility certification 能覆盖存量 fixture。
- P10/P11/P13 fixture 脱离 canonical runner 大测试后，删除唯一 test-only boundary exception。
- 删除前由 maturity checker 与 architecture audit 同时证明 source/import closure。
