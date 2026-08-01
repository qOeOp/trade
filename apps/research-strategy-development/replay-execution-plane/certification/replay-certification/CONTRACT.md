# Replay Certification

## Type

Replay Plane 的显式发布认证 owner。

## Public interfaces

- `bun run check`：只验证本 package 可编译，属于默认 repository quality。
- `bun run certify`：显式执行完整 release evidence probes；不属于普通 merge gate。
- `bun run reproducibility`：单独输出跨进程可复现 receipt。

## Owns

- 四个 public profile 的 golden、resume、idempotency、tamper 证据。
- 跨进程复现、publication crash recovery、capacity、fault/corruption 与 operational readiness probes。
- release-candidate fixture pack 及其内容寻址证据。

## Inputs

- public profile 的稳定入口和结构化 Outcome/Artifact 合同。
- `replay-profile-evidence.json` 与各 release evidence bundle。
- package owner 已通过自己的 `scripts.check` 所证明的行为。

## Outputs

- `certify` 非零退出或通过的动态认证结果。
- 各 probe 的结构化、自哈希 receipt。
- 供独立 Control Plane auditor 复核的 fixture pack。

## Boundaries

- 不维护 package 路径分类表、模块数量、consumer import closure 或 runner 私有脚本字符串。
- package 移动、测试改名和内部命令调整不属于默认 quality 合同。
- release bundle 可以内容寻址冻结候选证据，但只在显式 `certify` / independent audit 中生效；它不是普通 merge gate。
- 不拥有 Replay Result、Artifact、Checkpoint、模拟语义或最终 release verdict。
- 不认证 production history 全集、cross-host/runtime parity、remote store、shadow/live 或真实账户行为。
- 最终 release audit 由 Research Control Plane 的独立 certification owner 持有；本 owner 不能自签 release verdict。
