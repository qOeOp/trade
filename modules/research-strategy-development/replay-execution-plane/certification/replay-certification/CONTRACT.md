# Replay Certification

## Type

Replay Plane certification command owner。

## Owns

- Plane 内唯一 `certify` 命令与完整 package suite registry。
- Canonical 与 compatibility suite 的显式分组、确定顺序、fail-fast 执行和机器可读清单。
- 四个 public profile 的 golden、resume、idempotency、tamper 证据索引；resume 必须区分直接支持、子 Trial 委托与显式不支持。

## Inputs

- `replay-certification-suites.json` 冻结的 repo-relative package roots。
- `replay-profile-evidence.json` 只引用现有 owner 测试，不复制测试语义。
- 每个 package 自己的 `bun run check`；本模块不复制其测试语义。

## Outputs

- `--list --json` 输出经校验的 suite 清单。
- `--suite canonical|compatibility|all` 顺序执行 owner checks；任一失败返回非零。

## Boundaries

- 不拥有 Replay Result、Artifact、Checkpoint、模拟语义或 release verdict。
- 不把 compatibility 测试并回 canonical package，不吞掉子进程失败，不产生长期认证 Artifact。
- 不为完成 gate 虚构 Portfolio checkpoint；`explicit-not-supported` 必须与冻结 profile epoch 一致。
- M5 release bundle、独立审计和历史 Artifact migration certification 另行验收。
