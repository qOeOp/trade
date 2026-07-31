# Legacy Portfolio Cycle Certification

## Type

canonical compatibility certification surface

## Owns

- P10 reallocation → P11 two-cycle 与 P12 → P13 consolidated accounting 的最小完整 Result/Artifact 回归链。
- P10/P11/P13 exact-v1 Artifact 的版本化只读迁移：独立 synthetic manifest pack 冻结 schema/role/commit identity；真实历史 writer fixture 验证完整 payload bytes、主 Result/Fingerprint/Accounting 自哈希与关键现金不变量。

## Inputs

- 测试内冻结的 Trial、Control Plane reservation、两周期 lifecycle 与三周期 full-flat sequence。
- `fixtures/historical-artifact-read-migration-v1.json` 的 synthetic frozen manifests；每个 manifest 保留旧 role 顺序、commit marker、自哈希与 Result/Evidence identity。
- `compatibility/legacy-portfolio-cycle` 的只读 payload reader；从 manifest-last namespace 读取全部文件，不恢复 writer。
- canonical replay contracts、runner，以及 `compatibility/legacy-portfolio-cycle` consumer。

## Outputs

- P10/P11 completed、幂等、fail-closed 与 Artifact role 断言。
- P13 cash roll-forward、唯一 opening equity、consolidated Trial Balance/hash 与 Artifact failure 断言。
- 历史 fixture 的 exact schema dispatch、确定性 read projection、pack self-hash 与 schema/role/hash tamper fail-closed 断言。
- P10/P11/P13 完整存量 payload 的原始 SHA、确定性 migration receipt、重复读一致性和落盘字节篡改拒绝。

## Boundaries

- 不拥有 Replay、Control Plane、allocation/risk engine 或 portfolio-cycle 生产语义。
- 不提供 CLI、生产 runtime import surface、数据库或新 writer authority；reader 只属于 compatibility certification。
- Synthetic pack 本身不含 payload bytes；完整 payload 证据由冻结的 generated writer fixture 单独覆盖。两者都不代表生产历史全集或跨版本经济升级，也不写 canonical Result v53 / Artifact v55；不得将 projection/receipt 当作新 Result、Review 或 runtime authority。
- Canonical runner 测试不得反向导入 compatibility；本 certification 是唯一跨边界回归 owner。
