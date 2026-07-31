---
title: Design Architecture
role: architecture-contract
status: active
owner: architecture
last_verified: 2026-07-23 CST
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
- 生产源码跨域 import 保持为 0；Market Data / Replay 的共享 wire 由 `apps/contracts/replay-contract` 承载。
- 交易所事实优先于本地投影；投影必须可从权威事件重建。
- research 不写 `trade.db`，不调用 Binance write；market data 不输出交易动作。
- 新增风险必须经过 registered policy、短期 runtime authorization、fresh account facts、account-scoped portfolio projection、preflight、execution contract 和 bounded execution capability。
- Agent Host、MCP、HTTP 和单次模型任务都是北向 capability consumer；它们不拥有 cadence、domain state、长期授权或 exchange side effect。
- 生成图和目录只是投影，不能反向创造产品边界。

## 3. 顶层责任域

| Domain | Owns | Must not own |
| --- | --- | --- |
| `orchestration-ops` | cycle、job graph、runtime health、notify、incident、ops audit | 交易或研究判断 |
| `policy-risk` | trading config、registered policy、approved refs、短期 runtime authorization、mode、risk limits | live account / market facts |
| `portfolio-execution-state` | trade event、flow / position / order projection、risk lock | research artifact、exchange API |
| `market-data-products` | raw/canonical market data、feature、dataset / immutable candle-slice manifest | account state、action intent |
| `exchange-gateway` | account/order/fill facts、authorized exchange side effect | thesis、promotion、dataset construction |
| `live-decision-planning` | slow observe、watchlist、thesis、DecisionInput、TradePlan、CapitalAllocationProposal、ActionIntent | exchange write、approval、promotion |
| `live-execution-control` | fast guard、owner-fact preflight、execution capability、route、execute、record、recovery | thesis、新策略研发 |
| `research-strategy-development` | hypothesis、Trial、Replay/Forward Result、RD state | live authorization、trade event |
| `governance-review-compliance` | evidence intake、closed-flow review、promotion、policy feedback | 原始 R&D 搜索、实时执行 |
| `artifact-knowledge` | artifact catalog、lineage、retention、GC | 交易事实、策略资格 |

不因新增 tool 数量继续增加顶层域；新能力先归入现有 owner，归不进去才进入设计评审。

### 3.1 Profile、账户与资金 authority

“账户”不是单一对象。配置、交易所事实、本地组合投影和执行授权必须拆开，否则同一模型会同时拥有真钱事实、风险判断和副作用权限。

| Model | Owner | Carries | Must not carry |
| --- | --- | --- | --- |
| Trading Profile | `policy-risk` | `profile_id`、`account_ref`、`account_scope`、mode、permissions、risk / exposure caps、strategy scope | API secret、live equity、position、order、fill |
| Runtime Authorization | `policy-risk` | registered policy ref/hash、account scope、issued/expiry、authorization ref | account fact、allocation、exchange result |
| Venue Account Ref | `exchange-gateway` | venue、environment、market、account alias | credential material、余额、策略资格 |
| Exchange Account Facts | `exchange-gateway` | equity、balance、margin、position、open order、fill、`as_of` | 本地 thesis、risk budget、promotion |
| Portfolio Account Projection | `portfolio-execution-state` | event-derived exposure、reserved risk、active flow、risk lock、reconcile status | venue truth、API credential、执行授权 |
| Capital Allocation Proposal | `live-decision-planning` | strategy / symbol scope、建议 risk budget、expiry、source refs | 余额扣减、资金预占事实、exchange write |
| Execution Capability | `live-execution-control` | target action、最大允许效果、idempotency、expiry、policy / fact refs | 长期账户状态、策略升格 |

资金约束不是一个可被多个域修改的“余额对象”：policy 给上限，exchange 给真钱事实，state 给可重建投影，decision 提议分配，execution 以最新事实执行硬校验并产生受限 command。凭证只对 exchange adapter 可见，不进入 profile、job ticket、artifact 或 domain outbox。

`available_to_trade` 也不是新的 durable balance：它是 execution 在决策时刻根据 exchange equity / available margin、state 中已占用或待确认风险、policy cap 与当前 intent 求出的 admissible capacity。exchange confirmation 之前不得把 proposal、reservation 或 submit response 当成已成交资金变化；unknown result 必须进入 reconcile / risk lock。

Profile 可以绑定 account scope，但当前不固定单账户、多账户或 capital-pool cardinality；account identity 与风险聚合范围使用稳定 ref 表达，待多账户成为真实产品需求后再决定具体模型。

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

### 4.1 三个长期闭环

Program 目标上同时维持三个长期闭环，但每次工作仍由有界 job / run 完成：

| 闭环 | 长期 owner 语义 | 有界工作 | 当前实现差距 |
| --- | --- | --- | --- |
| 市场数据供给 | 接纳 Runtime / R&D 数据需求，维护采集、readiness、coverage、immutable source 与安全释放 | scan、补数、订阅协调、segment finalize、dataset export、owner GC | L2 只有固定单 symbol production candidate；尚无多 symbol demand reconciliation 和 raw release / GC |
| 在线交易 | 慢轨全市场发现，候选深化，快轨守护 active flow，执行后确认、对账和复盘 | J01/J02/J03、preflight、execution、J07 | 慢轨粗筛已存在；当前 server profile 未启用完整 domain jobs，L2 尚未进入交易 authority |
| 策略工厂 | 持续吸收 research finding、实验失败、forward/live evidence 和 improvement request，推进新 hypothesis / version | Campaign、Agent Run、Trial、Replay、Forward、Review | 当前 J04 只补一次 hypothesis 并受 program terminal 状态停止；论文 finding、代码开发、retire 与 review 回流未闭合 |

“长期”不等于一个永久 Agent session，也不等于无界计算。Program / Control Plane 保存 durable state 并持续选择工作；Agent Host 只执行带 deadline、预算、能力 allowlist 和结构化结果的短生命周期任务。

L2 等高频数据采用需求驱动而非调用驱动：

```text
market scan / active flow / position / RD
  -> typed data need
  -> Market Data owner reconciles resident collection
  -> readiness / coverage
  -> current read or finalized historical source
```

调用方不直接拉起 Rust owner，不注入 endpoint/path，也不能把 current-book snapshot 当历史 Replay source。全市场发现先用低成本 scan / OHLCV；只有晋级候选、active exposure 或明确研究任务才扩大 L2 采集。

容量治理也是 owner-driven，不是“磁盘满后人工删文件”：

```text
periodic inventory / soft watermark
  -> classify by owner + lineage + ref/pin + retention + rebuildability
  -> compact / delete owner-authorized candidates
  -> remeasure
  -> defer low-priority new writes if still constrained
  -> hard line: stop nonessential writes/new risk, preserve defense and evidence
```

Agent 可协助解释未知大文件或提出清理候选，但没有文件删除 authority。通用 artifact GC 只处理其合同内可重建 artifact；L2 raw 必须经过 Market Data finalize、compaction、跨 consumer reference closure 和 retention release 后才进入专属 GC。active flow、未完成 Trial、冻结 dataset、review evidence、durable store 与 incomplete incident fail closed 保留。

## 5. 在线链

```text
exchange + market facts + state projection + runtime authorization
  -> DecisionInputBundle
  -> TradePlanDraft
  -> CapitalAllocationProposal
  -> ActionIntent
  -> execution gate + owner-fact PREFLIGHT
  -> execution contract + ExecutionCapability
  -> exchange router / write gate / adapter
  -> confirmation / reconcile
  -> trade event / projection
  -> closed-flow REVIEW
  -> lifecycle evidence / improvement request
```

| Stage | Owner | Durable result |
| --- | --- | --- |
| facts | market-data-products / exchange-gateway | market/exchange refs |
| observe / plan | live-decision-planning | DecisionInput / TradePlan / unallocated Proposal / blocked Intent |
| guard / execute / recover | live-execution-control | verdict、ExecutionCapability、exchange result、event draft |
| event / projection | portfolio-execution-state | `plan_event`、flow read model |
| review | governance-review-compliance | governance evidence / feedback |

慢轨可生成 setup 和 thesis；快轨只继承并守护 active flow。未知订单、无法归属的仓位或 reconcile failure 形成 risk lock，新增风险停止，防御动作仍需审计。

多个 setup 同时通过单标的资格时，必须先由账户级 capital allocation 对现有 exposure、相关风险、流动性和候选集统一裁决；单个 setup 合格不等于拥有资金。候选在等待 L2、Agent 或资金期间持续受 TTL、instrument status、freshness 和 invalidation 约束，失效后释放短期数据需求且不创建空 flow。

单笔 closed-flow review 只形成 evidence。Governance 必须按精确 strategy version、regime、样本成熟度和 execution attribution 评审后，才能 keep / pause / retire 或提出 improvement request；不能因一次亏损自动退役。退役只禁止该版本产生新 setup / forward / live 动作，既有 exposure 仍由 reconcile、快轨和减风险路径管理至闭合。

## 6. Research 链

```text
Research Source / cited Finding / Runtime Lesson
  -> Universe / Proposal
  -> immutable Experiment Contract
  -> reserved Trial
  -> Replay Execution Result
  -> Research Review
  -> accept_for_draft
  -> Draft Strategy binding
  -> Forward Result
  -> Governance evidence intake / promotion
  -> keep / pause / retire / improvement request
  -> next hypothesis or version
```

- Research Control Plane 是 Contract、Trial、Result、Research Review、research lifecycle 和 Draft authorization 的单写者；策略 `draft / shadow / live-small / paused / retired` lifecycle 仍属于 Governance。
- 外层 R&D Factory 长期运行；Campaign / Agent Run / Trial 的预算耗尽、blocked 或 candidate found 是局部终态，不应永久终止 Factory。
- 局部 token、trial、compute、并行度和 locked holdout 预算仍必须存在；持续研发不能退化为无界 Agent loop 或自动参数搜索。
- Research 读取 OHLCV 时只消费 `market-data.store` 生成的内容寻址 slice manifest；兼容 DB locator 只传给 owner，不形成 Research 物理表权限。
- Research 使用历史 L2 时只消费 finalized manifest / source ref；需要未来微观结构证据时先声明采集需求，不能从 current-book port 追溯过去。
- cited finding 是 hypothesis 的外部依据，不是本项目实验结果；source / citation authority 属于 `artifact-knowledge`，MCP 只可提供 owner-backed search/query adapter。
- Replay / Forward 是证据执行面，不生成 hypothesis，不决定 promotion。
- Agent Roles 只提交 Proposal / Candidate request / Decision，不直接写权威事实。
- family 是 Universe 中稳定的机制身份；family implementation 才是某 engine / release 的代码。策略版本由 MD source、compiled contract、证据和 implementation / Agent policy binding 组成。目标 engine 已有实现时只物化新策略版本；实现不足或机制新增时才走 capability assessment、隔离 patch、CI、code review、release 与重新验证。
- MD 叙事不自动等于可执行代码。机器 Trade Contract 编译为 Strategy IR；无法机械表达但被明确接纳的语义条款只能进入有界 Agent-assisted proposal，随后仍经过确定性 owner validation / preflight，且不能冒充 Replay parity。
- 新 release 不重新解释已有 flow；在线事件、review 与 recovery 必须能回到精确 MD / compiled contract / implementation / Agent policy binding，旧兼容能力在依赖闭合前不得清除。
- compatibility 实现只为 parity 和迁移服务，不自动获得长期 authority。

## 7. Store、Message Class 与 Rail

当前有 10 个 logical store：trade event、flow read model、market data、OHLCV、exchange runtime、artifact catalog、research state、governance ledger、policy registry、ops runtime。owner 与 DDL 见 [storage-architecture.md](./storage-architecture.md)。Runtime authorization 与 execution capability 都是短期、内容绑定的 authority projection，不新增 durable store。

当前 10 条 logical rail：command、ops、fact、policy、market data、exchange、store、data lineage、artifact、governance。Rail 只携带 envelope、summary 和 refs；大 payload 留在 owner store。

Rail 是协议 namespace，不等于 broker、队列或物理 transport。每个 domain envelope 已强制声明 `interaction`；不能只凭 rail 名称推断权限：

当前物理基线、message route SLO、delivery / ordering / replay、service 拆分门、broker 采用门与语言边界见 [Physical Runtime and Transport Decision](./physical-runtime-transport.md)。`domain-bus` 当前只做 control envelope audit，不是 worker dispatcher 或高吞吐 broker；顶层 domain 也不自动对应独立网络服务。

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
| runtime policy | `policy-risk` only | decision、execution、exchange write gate | policy ref/hash、account scope、authorization ref、expiry |
| market fact | `market-data-products` | decision、execution | snapshot / feature refs、freshness、watermark |
| dataset lineage | `market-data-products` | research、artifact | immutable slice / dataset manifest、source hash、lineage refs |
| account fact | `exchange-gateway` | decision、execution / reconcile | equity、position、orders、fills、confirmation refs |
| action intent | `live-decision-planning` | `live-execution-control` | DecisionInput、plan、unallocated proposal、blocked intent、expiry、source refs |
| privileged exchange command / result | execution / exchange | exchange / execution | ExecutionCapability、bounded action、idempotency、request/result/confirmation refs |
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

- trading config 的 compiler → registry → runtime authorization 主路径已进入 slow-track 与 trade-flow；旧的兼容入口仍以 [trading-config.md](../runtime/trading-config.md) 的 known gaps 为准。
- Replay 已有受限 certified vertical slice；未认证的 queue/depth partial、通用 multi-order、remote transport 等不得表述为已支持。
- compatibility 子树仍存在时，只能缩减，不能新增 authority 语义。
- 多策略组合级资本竞争、相关性约束和资金 reservation authority 尚未决定；当前只有 policy cap、decision proposal、state projection 与 execution preflight，不提前新增 portfolio allocator。
- 当前仍是单节点模块化 runtime 加已批准的独立 Rust L2 数据面；broker、跨节点服务拆分和 exchange write 独立 trust unit 都必须经过 [physical transport adoption gate](./physical-runtime-transport.md)，不得把目标态冒充当前部署。
- 当前 Agent 北向事实只有外部 Codex/MCP 操作和受限 Model Gateway task；常驻可替换 Host 尚未采用。[Agent Host Runtime plan](./migrations/agent-host-runtime-integration-plan.md) 只定义 proposed adapter/评测路径，不新增 domain、store 或当前部署单元。

## 10. 变更合同

修改顶层架构必须同步：

1. 本文与受影响的 [Authority Map](./architecture-overview-v2.mmd)、[Communication Map](./architecture-communication-v2.mmd)、[Runtime Topology](./architecture-runtime-v2.mmd)、[Data & Trust Map](./architecture-data-trust-v2.mmd)。
2. [architecture-manifest.json](./architecture-manifest.json)。
3. owner module `CONTRACT.md` 与 schema。
4. `toolset.json` / rail registry / logical store schema（若受影响）。
5. 生成投影和 architecture checks。

目录移动、业务行为改变和 authority 迁移不得混成不可审计的一步。
