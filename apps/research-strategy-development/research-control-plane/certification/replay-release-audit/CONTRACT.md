# Replay Release Audit

## Type

Research Control Plane 持有的 Replay 独立发布审计 owner。

## Owns

- 在 Replay certification / fixture-pack owner 之外，对冻结 release candidate 做独立复核。
- 用本 owner 的实现重算 fixture pack 自哈希、十二项组件内容 hash 与既有 authority hash。
- 对 component content、component authority 与 release-verdict overclaim 执行固定 negative challenge。
- 从外部执行 Replay 唯一 `certify` 命令和 repository static consistency checker，输出自哈希 audit receipt。

## Inputs

- `replay-independent-release-audit.json` 冻结 subject、命令、negative challenge、source binding、限制、root static checker 实际读取的 repo-relative input identities/digest 与 audit manifest hash。
- Replay owner 的 `replay-release-candidate-fixture-pack.json` 只读输入；本 owner 不修改或重新签发该 pack。
- Capability inventory、epoch 与 certification registries 提供静态 supported-surface 输入，但不证明执行成功或发布状态。

## Outputs

- `bun run audit` 输出 audit receipt；只有十二项闭包、三项 negative challenge、完整 `certify` 与 static consistency checker 全部通过才返回零。receipt 通过 manifest hash 绑定 static input digest、audit package/launcher、subject、命令输出与自哈希；旧 schema receipt 必须拒绝。
- Receipt 只允许在提供当前 repo root 并重新验证 manifest、static input digest 与全部 source bindings 后接受；stale manifest 与 stale receipt 不能脱离当前 filesystem 自洽通过。
- Receipt 记录 subject pack hash、命令 PID/输出 hash、challenge outcome、runtime、limitations 并自哈希；不落长期 Result 或 release Artifact。

## Boundaries

- 不 import Replay certification owner 实现，不共享其 hash helper，不拥有 Replay suite、fixture pack、Result、Artifact、Checkpoint 或模拟语义。
- `passed` 只表示已声明四 profile 与冻结 evidence envelope 通过本独立发布审计；不证明 production history corpus、cross-host/runtime、remote/distributed store、shadow/live、real account 或未声明能力。
- 审计不得把 fixture pack 的 candidate evidence 改写成无限范围的生产发布保证。
