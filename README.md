# Trade Toolset

面向 agent 工作区的 Binance USDM 单账户 4H+ swing 交易与策略研发工具集。系统以可审计事实、确定性风险门、受控执行和证据治理推进少量 `live-small` 机会；不是 SaaS、UI 产品、通用回测平台或自动升格策略机器。

## 文档入口

[docs/README.md](./docs/README.md) 是 L1 文档合同与 authority 索引。最常用入口：

| 问题 | 文档 |
| --- | --- |
| 为什么做、做什么 | [Vision](./docs/product/vision.md) / [PRD](./docs/product/prd.md) |
| 用户如何使用 | [User Story](./docs/product/user-story.md) |
| 系统如何分域 | [Design Architecture](./docs/architecture/design-architecture.md) |
| domain / job / store / rail 机器事实 | [Architecture Manifest](./docs/architecture/architecture-manifest.json) |
| 在线技术合同 | [Technical Contract](./docs/runtime/tech-spec.md) |
| R&D 与 Replay 边界 | [RD Architecture](./docs/research/architecture/rd-architecture-migration-plan.md) / [Replay Capability Inventory](./docs/research/reliability/rd-replay-capability-inventory.json) |
| 改动后跑什么 | [Check Contract](./docs/engineering/check-contract.md) |

优先级：产品合同 → 架构合同 / manifest → module `CONTRACT.md` / `toolset.json` → schema / tests。`docs/history/` 只保留历史上下文，不能覆盖当前合同。

## 系统骨架

```text
single automation entry
  -> lifecycle / health / lock
  -> J01 reconcile
  -> J02 fast guard
  -> J03 slow watch
  -> J04 R&D supervisor
  -> J05 forward tracker
  -> J06 catalog hygiene
  -> J07 closed-flow review
  -> summary / notify / control review
```

顶层有 10 个责任域：orchestration、policy/risk、portfolio state、market data、exchange gateway、live planning、live execution、research、governance、artifact knowledge。当前架构分为 [Authority Map](./docs/architecture/architecture-overview-v2.mmd)、[Communication Map](./docs/architecture/architecture-communication-v2.mmd)、[Runtime Topology](./docs/architecture/architecture-runtime-v2.mmd) 与 [Data & Trust Map](./docs/architecture/architecture-data-trust-v2.mmd)；代码投影见 [architecture-drift-report.md](./docs/architecture/generated/architecture-drift-report.md)。

## 两条主链

在线交易：

```text
OBSERVE -> PLAN -> PREFLIGHT -> EXECUTE
  -> CONFIRM / RECONCILE -> REVIEW
```

策略研发：

```text
hypothesis -> frozen contract -> Trial -> Replay Result
  -> research review -> draft -> Forward evidence
  -> governance decision -> shadow / live-small / paused
```

Research 不写在线交易事件、不调用 Binance write；Replay / Forward 不拥有 promotion；submit 不等于 fill；交易所事实最终覆盖本地 projection。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `docs/` | L1 产品、架构、大功能、research、engineering 合同 |
| `apps/` | domain-owned atomic tools、suite façade、shared contracts |
| `strategies/` | versioned strategy contracts |
| `profile/` | 本地 trading config 与兼容输入；凭证不入库 |
| `scripts/` | manifest、drift、storage、docs 和项目质量检查 |
| `data/` | ignored durable runtime DB |
| `tmp/` | ignored 可删除运行产物 |

工具发现和命令参数从 `toolset.json` 开始；单模块行为从对应 `CONTRACT.md` 开始，不从历史 README 或目录名猜入口。

## 安全边界

- Binance 写动作必须显式授权、经过 preflight 和 execution contract，并可确认 / 对账。
- facts stale、unknown order、unmatched position、policy missing 或 risk lock 时，新增风险 fail closed。
- safe / suspended 不阻止明确的 reduce、close、cancel 或 protection 修复，但仍需审计。
- R&D 的 `no_promote`、budget exhausted 和 data/tool blocked 都是正常完成状态，不得表述成“找到策略”。
- API key、token 和本机绝对路径不得进入 docs、event、artifact 或日志合同。

## 验证

文档改动最低检查：

```text
bun scripts/check-doc-contracts.ts
git diff --check
```

涉及架构当前态再运行 manifest、storage、RD layout / static consistency 和 drift checks。经 PR 交付时，本地直接运行受影响 owner 检查、真实 consumer journey、diff inspection 与 workspace safety；远端 required `quality` 和四语言 CodeQL 完成全仓 merge closure。不经 PR 且需要本地全仓终结时再运行 `scripts/quality-check.sh`。
