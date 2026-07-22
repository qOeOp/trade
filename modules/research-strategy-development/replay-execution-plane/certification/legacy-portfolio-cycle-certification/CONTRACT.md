# Legacy Portfolio Cycle Certification

## Type

canonical compatibility certification surface

## Owns

- P10 reallocation → P11 two-cycle 的最小完整 Result/Artifact 回归链。
- certification-only frozen fixture；只证明历史 consumer 仍可读取 canonical contracts/runner 产物。

## Inputs

- 测试内冻结的 Trial、Control Plane reservation 与两周期 lifecycle。
- canonical replay contracts、runner，以及 `compatibility/legacy-portfolio-cycle` consumer。

## Outputs

- P10/P11 completed、幂等、fail-closed 与 Artifact role 断言。

## Boundaries

- 不拥有 Replay、Control Plane、allocation/risk engine 或 portfolio-cycle 生产语义。
- 不提供 CLI、runtime import surface、数据库或长期 fixture authority。
- P13 consolidated accounting 尚未迁入；迁入后删除 runner 巨型测试中的最后一条 compatibility 反向测试边。
