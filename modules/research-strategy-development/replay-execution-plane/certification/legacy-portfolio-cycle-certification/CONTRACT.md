# Legacy Portfolio Cycle Certification

## Type

canonical compatibility certification surface

## Owns

- P10 reallocation → P11 two-cycle 与 P12 → P13 consolidated accounting 的最小完整 Result/Artifact 回归链。
- P10/P11/P13 exact-v1 Artifact Manifest 的版本化只读迁移 fixture 与 reader；只投影 identity、integrity、commit state，不重解释经济含义。

## Inputs

- 测试内冻结的 Trial、Control Plane reservation、两周期 lifecycle 与三周期 full-flat sequence。
- `fixtures/historical-artifact-read-migration-v1.json` 的 synthetic frozen manifests；每个 manifest 保留旧 role 顺序、commit marker、自哈希与 Result/Evidence identity。
- canonical replay contracts、runner，以及 `compatibility/legacy-portfolio-cycle` consumer。

## Outputs

- P10/P11 completed、幂等、fail-closed 与 Artifact role 断言。
- P13 cash roll-forward、唯一 opening equity、consolidated Trial Balance/hash 与 Artifact failure 断言。
- 历史 fixture 的 exact schema dispatch、确定性 read projection、pack self-hash 与 schema/role/hash tamper fail-closed 断言。

## Boundaries

- 不拥有 Replay、Control Plane、allocation/risk engine 或 portfolio-cycle 生产语义。
- 不提供 CLI、生产 runtime import surface、数据库或新 writer authority；reader 只属于 compatibility certification。
- fixture 不含历史 payload bytes，不认证 payload rehydration，也不写 canonical Result v53 / Artifact v55；不得将 projection 当作新 Result、Review 或经济迁移。
- Canonical runner 测试不得反向导入 compatibility；本 certification 是唯一跨边界回归 owner。
