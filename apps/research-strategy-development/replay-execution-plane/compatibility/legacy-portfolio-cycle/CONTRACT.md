# Legacy Portfolio Cycle

## Type

P10 / P11 / P13 historical Replay compatibility consumer。

## Owns

- 固定 cycle-2 Reallocation 与 fixed two-cycle Result/Artifact 的历史执行和读回。
- P12 v1 Sequence 的旧 consolidated Accounting/Artifact 读回。
- P10/P11/P13 manifest-last namespace 的版本化只读迁移；逐文件验证 ref/raw SHA，只输出非权威 summary receipt。
- 既有 schema、hash、manifest-last、幂等与 failure semantics；不修改历史 wire。

## Boundaries

- 不属于 canonical public entrypoint 或 opt-in activation registry。
- 禁止新增生产消费者；只允许历史 Artifact 读回、迁移和 compatibility certification。
- Canonical runner 不得依赖本模块；P10/P11/P13 回归只从独立 certification 单向消费本模块。
- 不接管 P12 bounded-sequence 原语、P14–P29 successor、Control Plane authority 或新经济语义。
- 不新增 Result/Artifact/Checkpoint epoch，不扩大 cycle count、reentry、margin、liquidity 或 Fast 能力。
- Migration receipt 不是当前 Result、Artifact、Review 或 runtime authority；generated certification fixture 不代表生产历史全集。

## Retirement Gate

- P10/P11/P13 历史 Artifact 已有版本化 reader/migration fixture。
- 仓库内直接生产消费者归零，compatibility certification 能覆盖存量 fixture。
- P10/P11/P13 fixture 已脱离 canonical runner 大测试，test-only boundary exception 已删除。
- 删除前由 static consistency、owner certification 与 architecture audit 分别证明 registry、执行和 source/import closure。
