# Legacy Portfolio Cycle Certification

## Type

canonical compatibility certification surface

## Owns

- P10 reallocation → P11 two-cycle 与 P12 → P13 consolidated accounting 的最小完整 Result/Artifact 回归链。
- certification-only frozen fixture；只证明历史 consumer 仍可读取 canonical contracts/runner 产物。

## Inputs

- 测试内冻结的 Trial、Control Plane reservation、两周期 lifecycle 与三周期 full-flat sequence。
- canonical replay contracts、runner，以及 `compatibility/legacy-portfolio-cycle` consumer。

## Outputs

- P10/P11 completed、幂等、fail-closed 与 Artifact role 断言。
- P13 cash roll-forward、唯一 opening equity、consolidated Trial Balance/hash 与 Artifact failure 断言。

## Boundaries

- 不拥有 Replay、Control Plane、allocation/risk engine 或 portfolio-cycle 生产语义。
- 不提供 CLI、runtime import surface、数据库或长期 fixture authority。
- Canonical runner 测试不得反向导入 compatibility；本 certification 是唯一跨边界回归 owner。
