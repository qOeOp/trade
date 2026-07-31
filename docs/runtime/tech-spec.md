---
title: Technical Contract
role: technical-contract-index
status: active
owner: architecture
last_verified: 2026-07-27 CST
---

# Technical Contract

## 1. 定位

本文是当前实现合同索引，不复制每个模块的参数和 schema。具体行为由 owner `CONTRACT.md`、`toolset.json`、JSON schema 和测试共同定义。

历史工具能力盘点已归档到 `docs/history/legacy-tech-spec.md`，不得作为当前调用入口。

## 2. 三层合同

| 层 | 载体 | 负责 |
| --- | --- | --- |
| L1 | `docs/` | 产品边界、术语、跨域语义、大功能合同 |
| L2 | `toolset.json` + module `CONTRACT.md` + CLI schema | tool discovery、输入输出、write scope、权限 |
| L3 | event / evidence / store / rail schema | 可持久事实、幂等、引用和生命周期 |

新增能力必须先找到 L1 owner，再建立 L2 调用合同；需要持久化或跨域通信时才增加 L3 schema。

## 3. Module 类型

| 类型 | 允许 | 禁止 |
| --- | --- | --- |
| `suite` | façade、迁移期路由、多个 atomic entry 的归类 | 业务大总线、跨 owner 状态写入 |
| `atomic` | 一个行为、一个主要写入面、独立 CLI/schema/check | 多生命周期 owner |
| `contract` | type、schema、pure helper、client contract | IO、流程、外部 API |
| `internal-engine` | 同域 pure calculation / parser | agent entry、持久写入、跨域编排 |

agent-facing registry 只登记 `suite` / `atomic`。跨模块源码 import 只允许 contract 或明确登记的同域/internal boundary；正常协作走 CLI JSON / rail ref。

## 4. Tool Job

稳定 tool job 至少包含：

- `tool_id`
- `owner_scope`
- `entry_contract`
- `payload` 或 `input_refs`
- `capability_class`
- `writes`
- `concurrency_group`
- `requires_preflight`
- `forbidden_callers`

orchestrator 不向 job graph 暴露裸模块路径；resolver 才把 `tool_id` 编译为 command spec。

## 5. Response 与错误

agent-facing CLI 返回稳定 JSON envelope：

```text
ok / status / result
error.code / error.message / retriable / details
refs / warnings
```

- stdout 只输出合同 JSON；日志进入 stderr。
- 失败必须 fail closed，不得返回半成功后继续升级权限。
- 写动作需要 idempotency key、明确 write scope 和可回读结果。
- artifact / DB / source path 对外使用 repo-relative ref，不输出本机绝对路径。

## 6. 在线执行合同

```text
action_intent
  -> execution gate
  -> owner-backed plan-preflight
  -> execution-contract compile
  -> execution-capability issue
  -> exchange request router
  -> write pre-adapter gate
  -> exchange command spec
  -> authorized write adapter
  -> post-write confirmation
  -> execution recorder event draft
  -> event-store append
```

| 行为 | Owner |
| --- | --- |
| intent / plan | `live-decision-planning/*` |
| deterministic guard | `live-execution-control/plan-preflight` |
| execution contract | `apps/contracts/execution-contract` |
| execution capability | `live-execution-control/execution-capability` + shared validator contract |
| route / execute / record | `live-execution-control/execution-*` |
| exchange route / write gate / confirmation | `exchange-gateway/exchange-request-router`、`write-pre-adapter-gate`、`post-write-confirmation` |
| Binance adapter | `exchange-gateway/binance-write/*` |
| event append / projection | `portfolio-execution-state/*` |

执行工具最低输出见 [execution-tool-contract.md](./execution-tool-contract.md)；风险门见 [risk-control-contract.md](./risk-control-contract.md)。

## 7. Event 与状态

在线交易只以 `trade_event_store.plan_event` 为权威 append stream；projection 可重建。事件、flow、lane、order lifecycle 和 reconcile 见 [event-flow-contract.md](./event-flow-contract.md)。

其他 durable facts 必须进入 manifest 声明的 logical store，不使用 JSONL / 文件 manifest 冒充数据库 owner。物理 schema 见 [storage-architecture.md](../architecture/storage-architecture.md)。

## 8. Config 与 Policy

`profile/trading-config.json` 是用户配置入口；runtime policy compiler 负责 normalize、clamp、hash 和 compact snapshot。凭证只走环境变量，不进入 config、artifact、event 或日志。

当前 config shape、merge 和未完成迁移见 [trading-config.md](./trading-config.md)。未被 compiler / owner consumer 接入的字段不得声称已生效。

## 9. Research 合同

- Research Control Plane 拥有权威 lifecycle 和 state store。
- Replay / Forward runner 只消费 frozen request / reservation，返回 Result / Artifact / Fingerprint。
- Strategy Registry 只在 `accept_for_draft` 后物化策略。
- Governance 独立决定 evidence intake、promotion 和 feedback。
- R&D、Replay、Forward 均禁止写 `trade.db` 或调用 exchange write。

具体 wire schema 由各 Plane `contracts/` owner，docs 只定义跨 Plane invariants。

## 10. Server Runtime

单机服务器的 production profile、process authority、启动依赖、readiness、secret、路径与 systemd 采用门见 [server-runtime-profile.md](./server-runtime-profile.md)。当前只闭合 no-live-write shadow profile，不代表 J01–J07 或 live execution 已切换 authority。

## 11. Model Task

模型只消费 provider-neutral、带 hash/identity/budget 的 bounded task，输出永远是 `execution_authority=none` 的 proposal。provider IO 由 `ops.model-gateway` 负责，领域 owner 负责 prompt/output schema 与 next action；模型失败不得推进 owner state。当前唯一纵切和未完成采用门见 [model-gateway.md](./model-gateway.md)。

## 12. Operator Interface

MCP/HTTP/OpenClaw 只能是同一 owner surface 的北向 allowlist，不能建立第二套 scheduler/state/approval 语义。当前 HTTP route、auth、rate、audit 和未完成部署门见 [operator-api.md](./operator-api.md)。

## 13. 检查

| 改动 | 最小验证 |
| --- | --- |
| docs authority / path | doc contract check + link check |
| domain/job/store/rail | architecture manifest + drift check |
| module CLI/schema | owner `bun run check` |
| logical store / DDL | storage schema check |
| research Plane | target layout + maturity gate + owner tests |
| 跨语言、脚本经 PR 交付 | 受影响 owner / consumer 检查；远端 required `quality` + 四语言 CodeQL |
| 不经 PR 的本地全仓终结 | `scripts/quality-check.sh` |

详细映射见 [check-contract.md](../engineering/check-contract.md)。
