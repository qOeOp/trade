# Replay Release Audit

## Type

Research Control Plane 持有的 Replay 独立发布审计 owner。

## Public interfaces

- `bun run check`：只验证 auditor package 可编译，属于默认 repository quality。
- `bun run audit`：显式复核一个冻结 release candidate。
- repository `bun run check:replay-release`：调用 `audit` 的发布入口。

## Owns

- 在 Replay certification owner 外重算 fixture pack 与十项 release evidence component 的内容/authority hash。
- 执行 component content、authority 和 verdict overclaim 三项 negative challenge。
- 在 fresh process 调用 subject owner 的公开 `bun run certify`，输出自哈希 receipt。

## Inputs

- `replay-independent-release-audit.json` 的 subject、公开命令、challenge、限制与 manifest hash。
- Replay owner 的只读 `replay-release-candidate-fixture-pack.json`。

## Outputs

- 通过或非零退出的 `bun run audit`。
- 记录 subject pack hash、命令 PID/输出 hash、challenge outcome、runtime 与 limitations 的 receipt。

## Boundaries

- 不维护 repository 文件身份列表、source binding、static input digest、模块路径闭包或 subject 私有测试命令。
- fixture pack 的内容寻址属于显式 release evidence，不进入普通 merge gate。
- 不 import Replay certification 实现，不拥有 Replay Result、Artifact、Checkpoint 或模拟语义。
- verdict 只覆盖声明的四 profile evidence envelope；不证明 production history、cross-host/runtime、remote store、shadow/live 或真实账户行为。
