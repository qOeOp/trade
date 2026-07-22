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

### 1.1 架构视图

顶层架构不再由一张巨图同时承担 authority、通信、调度和物理落点：

| View | Owns | Does not own |
| --- | --- | --- |
| [Authority Map](./architecture-overview-v2.mmd) | 十个业务域、事实所有权、禁止越界、主要 authority chain | 当前 job 数量、物理 transport、模块内部步骤 |
| [Communication Map](./architecture-communication-v2.mmd) | 合法 publisher / consumer、message class、跨域方向 | transport 技术、物理 store 访问 |
| [Runtime Topology](./architecture-runtime-v2.mmd) | 当前 cycle、J01–J07、并发与收口 | 长期业务域边界 |
| [Data & Trust Map](./architecture-data-trust-v2.mmd) | profile、账户、资金投影、凭证、时序与数据分级 | 策略判断和具体 schema 字段 |

`protocol-fabric`、`domain-runtime`、data plane 与 trust plane 都不是额外业务域。Runtime view 是当前投影；job 数量和 cadence 可以演进，不反向修改 authority map。

## 2. 架构不变量

- 外部只有一个 automation 入口；orchestration 只规划、调度、收口和审计。
- 在线交易、research、governance、artifact 和 ops 各自拥有事实，不共享一个万能数据库。
- 跨域传 contract / envelope / ref，不直接读取对方实现或物理表。
- 生产源码跨域 import 保持为 0；Market Data / Replay 的共享 wire 由 `modules/contracts/replay-contract` 承载。
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

### 3.1 Profile、账户与资金 authority

“账户”不是单一对象。配置、交易所事实、本地组合投影和执行授权必须拆开，否则同一模型会同时拥有真钱事实、风险判断和副作用权限。

| Model | Owner | Carries | Must not carry |
| --- | --- | --- | --- |
| Trading Profile | `policy-risk` | `profile_id`、`account_ref`、mode、permissions、risk / exposure caps、strategy scope | API secret、live equity、position、order、fill |
| Venue Account Ref | `exchange-gateway` | venue、environment、market、account alias | credential material、余额、策略资格 |
| Exchange Account Facts | `exchange-gateway` | equity、balance、margin、position、open order、fill、`as_of` | 本地 thesis、risk budget、promotion |
| Portfolio Account Projection | `portfolio-execution-state` | event-derived exposure、reserved risk、active flow、risk lock、reconcile status | venue truth、API credential、执行授权 |
| Capital Allocation Proposal | `live-decision-planning` | strategy / symbol scope、建议 risk budget、expiry、source refs | 余额扣减、资金预占事实、exchange write |
| Execution Capability | `live-execution-control` | target action、最大允许效果、idempotency、expiry、policy / fact refs | 长期账户状态、策略升格 |

资金约束不是一个可被多个域修改的“余额对象”：policy 给上限，exchange 给真钱事实，state 给可重建投影，decision 提议分配，execution 以最新事实执行硬校验并产生受限 command。凭证只对 exchange adapter 可见，不进入 profile、job ticket、artifact 或 domain outbox。

当前不新增 portfolio allocation 顶层域。若未来出现多策略、多标的同时竞争资本，且单笔 sizing 已无法表达组合级相关性、集中度和 reservation authority，再单独做设计评审；临时方案不得把该 authority 塞进 orchestration。

## 4. Automation 与 Job

单入口先运行 lifecycle processors，再按并发组分发当前 7 个 domain job：

```text
cycle start / health / lock
  -> serial trade-state guard: J01, J02
  -> isolated work: J03, J04, J05, J06
  -> serial closeout: J07
  -> summary / notify / incident / control review
```

每个 job 绑定：ticket、target domain、handler、input refs、write scope、concurrency group、stop conditions。Job graph 不携带大业务 payload，不把 handler 结果解释成更高权限。

J01–J07 是当前 runtime projection，不是永久产品分域。新增、合并或改 cadence 只要不迁移事实 owner，不构成顶层 domain 变更。

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

## 7. Store、Message Class 与 Rail

当前有 10 个 logical store：trade event、flow read model、market data、OHLCV、exchange runtime、artifact catalog、research state、governance ledger、policy registry、ops runtime。owner 与 DDL 见 [storage-architecture.md](./storage-architecture.md)。

当前 10 条 logical rail：command、ops、fact、policy、market data、exchange、store、data lineage、artifact、governance。Rail 只携带 envelope、summary 和 refs；大 payload 留在 owner store。

Rail 是协议 namespace，不等于 broker、队列或物理 transport。每个 envelope 还必须声明交互语义；不能只凭 rail 名称推断权限：

| Message class | Semantics | Core constraint |
| --- | --- | --- |
| `command` | 指定唯一 target 执行动作 | targeted、bounded capability、idempotent |
| `query` | 从 owner port 读取当前状态 | 不绕过 owner，不持有物理表访问权 |
| `fact` | 已发生或已观测的不可变事实 | 带 `as_of` / source / freshness，可 fan-out |
| `intent` | 尚未执行的动作建议 | 不是 authorization，不可直达 exchange |
| `authorization` | policy 编译出的权限与限制 | 单一 publisher、hash / expiry、deny wins |
| `result` | command 的接受、拒绝、未知或完成结果 | 关联 command / idempotency，不伪装成 fact |
| `ref` | owner 内容的稳定定位符 | 不是 payload，不授予 store 读写权限 |

### 7.1 Canonical Route Matrix

| Route | Publisher | Consumer | Contract payload |
| --- | --- | --- | --- |
| job command / result | `orchestration-ops` / target domain | target domain / `orchestration-ops` | ticket、scope、input/output refs、status、incidents |
| ops health | `orchestration-ops` | `policy-risk`、`live-execution-control`、exchange write gate | health、lock、safe-mode、write suspension refs |
| runtime policy | `policy-risk` only | decision、execution、exchange write gate | profile-mode、permissions、limits、hash、expiry |
| market fact | `market-data-products` | decision、execution | snapshot / feature refs、freshness、watermark |
| dataset lineage | `market-data-products` | research、artifact | immutable manifest、source hash、lineage refs |
| account fact | `exchange-gateway` | decision、execution / reconcile | equity、position、orders、fills、confirmation refs |
| action intent | `live-decision-planning` | `live-execution-control` | plan、proposed allocation、expiry、source refs |
| privileged exchange command / result | execution / exchange | exchange / execution | bounded action、idempotency、request/result/confirmation refs |
| event or reconcile proposal | `live-execution-control` | `portfolio-execution-state` | event envelope、reconcile evidence、source refs |
| state projection | `portfolio-execution-state` | decision、execution、governance | flow、portfolio exposure、risk-lock、closed-flow refs |
| research evidence / lifecycle decision | research / governance | governance / research | Trial / Result / Forward / candidate refs；reject / revise / promote |
| policy feedback | governance | `policy-risk` | scoped feedback / override proposal；不得直接发布 runtime policy |
| artifact registration / query | any artifact producer / authorized consumer | artifact / artifact | hash、owner、lineage、retention；catalog refs / metadata |

任何未列入 matrix 的新跨域路线都先做 authority review。`exchange write command` 与 `exchange/account fact` 必须保持方向、ACL 和失败语义分离；`action intent` 不进入普通 fact 流；`store rail` 只描述 owner/ref，不传物理路径写权限。

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

- trading config 已有 compiler / policy registry，但部分旧调用方仍需完成统一消费；以 [trading-config.md](../runtime/trading-config.md) 的 known gaps 为准。
- Replay 已有受限 certified vertical slice；未认证的 queue/depth partial、通用 multi-order、remote transport 等不得表述为已支持。
- compatibility 子树仍存在时，只能缩减，不能新增 authority 语义。
- 多策略组合级资本竞争、相关性约束和资金 reservation authority 尚未决定；当前只有 policy cap、decision proposal、state projection 与 execution preflight，不提前新增 portfolio allocator。

## 10. 变更合同

修改顶层架构必须同步：

1. 本文与受影响的 [Authority Map](./architecture-overview-v2.mmd)、[Communication Map](./architecture-communication-v2.mmd)、[Runtime Topology](./architecture-runtime-v2.mmd)、[Data & Trust Map](./architecture-data-trust-v2.mmd)。
2. [architecture-manifest.json](./architecture-manifest.json)。
3. owner module `CONTRACT.md` 与 schema。
4. `toolset.json` / rail registry / logical store schema（若受影响）。
5. 生成投影和 architecture checks。

目录移动、业务行为改变和 authority 迁移不得混成不可审计的一步。
