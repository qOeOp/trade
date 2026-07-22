---
title: Design Architecture
role: architecture-contract
status: active
owner: architecture
last_verified: 2026-07-22 CST
---

# Design Architecture

## 1. Authority

本文定义当前责任域、主链、跨域边界和架构不变量。具体优先级：

```text
product contract
  -> architecture contract
  -> architecture-manifest.json
  -> domain/module CONTRACT.md
  -> schema + executable checks
```

- 顶层域、job、store、rail 的机器真相是 [architecture-manifest.json](./architecture-manifest.json)。
- 当前代码投影是 [architecture-drift-report.md](./generated/architecture-drift-report.md)。
- 历史设计过程只在 `docs/history/`，不得覆盖本文。

## 2. 架构不变量

- 外部只有一个 automation 入口；orchestration 只规划、调度、收口和审计。
- 在线交易、research、governance、artifact 和 ops 各自拥有事实，不共享一个万能数据库。
- 跨域传 contract / envelope / ref，不直接读取对方实现或物理表。
- 交易所事实优先于本地投影；投影必须可从权威事件重建。
- research 不写 `trade.db`，不调用 Binance write；market data 不输出交易动作。
- 新增风险必须经过 policy、fresh facts、preflight、execution contract 和显式授权。
- 生成图和目录只是投影，不能反向创造产品边界。

## 3. 顶层责任域

| Domain | Owns | Must not own |
| --- | --- | --- |
| `orchestration-ops` | cycle、job graph、runtime health、notify、incident、ops audit | 交易或研究判断 |
| `policy-risk` | trading config、approved policy、mode、risk limits | live account / market facts |
| `portfolio-execution-state` | trade event、flow / position / order projection、risk lock | research artifact、exchange API |
| `market-data-products` | raw/canonical market data、feature、dataset manifest | account state、action intent |
| `exchange-gateway` | account/order/fill facts、authorized exchange side effect | thesis、promotion、dataset construction |
| `live-decision-planning` | slow observe、watchlist、thesis、trade plan、action intent | exchange write、promotion |
| `live-execution-control` | fast guard、preflight、route、execute、record、recovery | thesis、新策略研发 |
| `research-strategy-development` | hypothesis、Trial、Replay/Forward Result、RD state | live authorization、trade event |
| `governance-review-compliance` | evidence intake、closed-flow review、promotion、policy feedback | 原始 R&D 搜索、实时执行 |
| `artifact-knowledge` | artifact catalog、lineage、retention、GC | 交易事实、策略资格 |

不因新增 tool 数量继续增加顶层域；新能力先归入现有 owner，归不进去才进入设计评审。

## 4. Automation 与 Job

单入口先运行 lifecycle processors，再按并发组分发 7 个 domain job：

```text
cycle start / health / lock
  -> serial trade-state guard: J01, J02
  -> isolated work: J03, J04, J05, J06
  -> serial closeout: J07
  -> summary / notify / incident / control review
```

每个 job 绑定：ticket、target domain、handler、input refs、write scope、concurrency group、stop conditions。Job graph 不携带大业务 payload，不把 handler 结果解释成更高权限。

## 5. 在线链

```text
exchange + market facts
  -> OBSERVE
  -> PLAN / action intent
  -> execution gate + PREFLIGHT
  -> execution contract
  -> exchange write
  -> confirmation / reconcile
  -> trade event / projection
  -> closed-flow REVIEW
```

| Stage | Owner | Durable result |
| --- | --- | --- |
| facts | market-data-products / exchange-gateway | market/exchange refs |
| observe / plan | live-decision-planning | observe / intent draft |
| guard / execute / recover | live-execution-control | verdict、exchange result、event draft |
| event / projection | portfolio-execution-state | `plan_event`、flow read model |
| review | governance-review-compliance | governance evidence / feedback |

慢轨可生成 setup 和 thesis；快轨只继承并守护 active flow。未知订单、无法归属的仓位或 reconcile failure 形成 risk lock，新增风险停止，防御动作仍需审计。

## 6. Research 链

```text
Universe / Knowledge / Proposal
  -> immutable Experiment Contract
  -> reserved Trial
  -> Replay Execution Result
  -> Research Review
  -> accept_for_draft
  -> Draft Strategy binding
  -> Forward Result
  -> Governance evidence intake / promotion
```

- Research Control Plane 是 Contract、Trial、Result、Review、lifecycle 和 Draft authorization 的单写者。
- Replay / Forward 是证据执行面，不生成 hypothesis，不决定 promotion。
- Agent Roles 只提交 Proposal / Candidate request / Decision，不直接写权威事实。
- compatibility 实现只为 parity 和迁移服务，不自动获得长期 authority。

## 7. Store 与 Rail

当前有 10 个 logical store：trade event、flow read model、market data、OHLCV、exchange runtime、artifact catalog、research state、governance ledger、policy registry、ops runtime。owner 与 DDL 见 [storage-architecture.md](./storage-architecture.md)。

当前 10 条 logical rail：command、ops、fact、policy、market data、exchange、store、data lineage、artifact、governance。Rail 只携带 envelope、summary 和 refs；大 payload 留在 owner store。

## 8. Source 边界

| 信息 | Canonical owner |
| --- | --- |
| 产品边界 | `docs/product/*` |
| domain/job/store/rail | architecture manifest |
| tool discovery | `toolset.json` |
| 单模块行为 | module `CONTRACT.md` |
| online trade fact | `trade_event_store` |
| exchange side effect audit | `exchange_runtime_store` |
| research lifecycle | `research_state_store` |
| promotion / review | `governance_ledger` |
| artifact lineage | `artifact_catalog` |
| ops health / incident | `ops_runtime_store` |

## 9. 当前限制

- 代码投影仍有 2 条已登记 Market Data → Replay contracts 跨域 import；不得扩张，目标是共享 contract/ref rail。
- trading config 已有 compiler / policy registry，但部分旧调用方仍需完成统一消费；以 [trading-config.md](../runtime/trading-config.md) 的 known gaps 为准。
- Replay 已有受限 certified vertical slice；未认证的 queue/depth partial、通用 multi-order、remote transport 等不得表述为已支持。
- compatibility 子树仍存在时，只能缩减，不能新增 authority 语义。

## 10. 变更合同

修改顶层架构必须同步：

1. 本文与 [architecture-overview-v2.mmd](./architecture-overview-v2.mmd)。
2. [architecture-manifest.json](./architecture-manifest.json)。
3. owner module `CONTRACT.md` 与 schema。
4. `toolset.json` / rail registry / logical store schema（若受影响）。
5. 生成投影和 architecture checks。

目录移动、业务行为改变和 authority 迁移不得混成不可审计的一步。
