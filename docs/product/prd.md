---
title: Product Requirements Document
role: product-contract
status: active
owner: product
last_verified: 2026-07-23 CST
---

# PRD

## 1. 产品

本项目是 program-owned、agent-augmented 的 Binance USDM 单账户 4H+ swing 长期运行系统。它在可审计事实、策略资格、确定性风险门、受控执行和复盘证据之间推进交易，并允许在同一 owner 能力面上切换 Agent Host；它不是面向外部用户的通用 Agent 或交易平台。

成功不是“持续产生订单”，而是：该做时能安全执行，不该做时能明确拒绝，异常后能从交易所事实恢复，每次结果都能回到策略与控制系统。

## 2. 范围

当前范围：

- 单一 Binance USDM 账户。
- 4H+ swing 为主；快轨只守护 active flow、触发和防御动作。
- strategy lifecycle 产品目标：`draft -> shadow -> live-small -> paused | retired`；当前实现仍只有前四种，`retired` 是待迁移缺口。
- 单一 automation 入口，按 cadence 和权限分发独立 domain job。
- 常驻 program runtime 不依赖交互式 Agent 存活；模型不可用时确定性安全链继续运行。
- 有界模型任务、交互式 Agent Host 与代码执行共享 typed owner ports，但拥有不同预算和权限。
- Codex、OpenClaw、LangGraph 等候选只通过 adapter 接入，不成为 scheduler、store 或业务 authority。
- 目标支持远程单机容器常驻；容器化不改变 owner、job、store、credential 和 live-write 采用门。
- 在线交易、R&D、governance、artifact 生命周期分离。
- Market Data 目标上按 Runtime / R&D 已接纳需求维护采集与 coverage；调用方不控制采集进程，也不能用当前快照冒充历史数据。
- R&D 目标上是长期策略工厂；预算约束单次 Campaign / Agent Run / Trial，不把一次局部终态当成整个工厂永久停止。
- 存储空间由 Program 与各数据 owner 持续治理：先按引用、pin、lineage、retention 和可重建性自动回收，磁盘硬线只作为 GC 失败后的局部安全门，不作为正常人工运维流程。
- 本地 SQLite + repo-relative artifact/ref；北向接口按需采用本机 MCP / authenticated HTTP，不建设通用远程服务平台。

非目标：

- 自建通用聊天 UI、Agent 市场、SaaS、多租户、多账户、多交易所。
- 高频、做市、无界参数搜索、自动策略升格。
- 用聊天记录、临时 artifact 或自然语言摘要替代交易事实。
- 让 research、market scan 或快轨直接触发新增风险。
- 让 Agent Host 持有 Binance write、owner DB、scheduler 或 promotion 权限。

## 3. 核心对象

| 对象 | 定义 | 关键约束 |
| --- | --- | --- |
| `strategy` | 可编译规则模板 | status 不等于证据；规则变化使旧证据 stale |
| `strategy family` | Strategy Universe 中的稳定机制身份 | 可以只有 design / data backlog；不等于同名代码模块 |
| `strategy implementation` | 某 engine / release 对 family 或 semantic policy 的执行能力 | Replay 可执行不代表 Runtime 可执行 |
| `strategy version` | MD policy、compiled contract、证据与 implementation binding 的冻结实例 | 新版本不回写旧 flow 或旧 evidence |
| `setup` | strategy 下一个可验证机会 | live 动作必须绑定 `setup_id` 与 invalidation |
| `lane` | `strategy_ref + symbol + side` | 同时最多一个 active flow |
| `flow` | 一笔机会 / 暴露生命周期 | 只 append 事件；闭合后新机会开新 flow |
| `observe` | 本轮最小完整事实与判断快照 | 必须可追到输入 facts / refs |
| `action_intent` | PLAN 产出的动作意图 | 不是执行授权 |
| `execution_contract` | 交易前冻结的执行快照 | 必须经过 preflight 和显式 live 授权 |
| `order_fill` | 提交、撤改、成交或 reconcile 事实 | 只有成交语义改变 position |
| `review` | flow 闭合后的复盘事实 | 不自动修改 strategy |

事件和 flow 合同见 [event-flow-contract.md](../runtime/event-flow-contract.md)。

## 4. 运行模型

外部只有一个 automation 入口。它生成本轮 job graph，不内联交易、研究或治理判断。program runtime 是 cadence、lease、恢复和进程生命周期的 authority；Agent Host 只在 job 明确声明需要语义能力时接收一次有界任务。

运行形态：

| 形态 | 适用 | 权限边界 |
| --- | --- | --- |
| deterministic program | L2、reconcile、risk、execution、固定 job graph | 领域 owner 合同内运行；不等待 LLM |
| bounded model task | 单次结构化 hypothesis、分类或摘要 | 只返回 typed proposal；`execution_authority=none` |
| Agent Host | 多轮工具协作、代码理解、人工审批与复杂研究 | 只能调用 allowlisted MCP / owner ports；session/checkpoint 不是业务事实 |

Host 的选择是部署与任务策略，不改变下表中的 Job authority：

| Job | 结果 | 不允许 |
| --- | --- | --- |
| J01 account reconcile | 账户事实恢复、risk lock、reconcile events | 新 thesis、加风险 |
| J02 fast guard | active flow 守护、触发检查、轻量 observe | 新 setup、质性策略判断 |
| J03 slow watch | watchlist、thesis、setup、action intent | 绕过 preflight 直接执行 |
| J04 RD supervisor | hypothesis / Trial / Result / research state | 写 `trade.db`、调用 Binance write |
| J05 forward tracker | 冻结后 paper / forward 证据 | 正式 promotion、真钱执行 |
| J06 catalog hygiene | artifact 可见性、引用、stale / owner-authorized GC 结果 | 绕过 ref / pin / lineage / retention 删除、业务判断 |
| J07 closed-flow review | 复盘与 governance evidence | 与交易写入并行封口 |

Job、owner、store 与 rail 的机器清单以 [architecture-manifest.json](../architecture/architecture-manifest.json) 为准。

## 5. 在线交易合同

```text
OBSERVE -> PLAN -> PREFLIGHT -> EXECUTE -> CONFIRM/RECONCILE -> REVIEW
```

### OBSERVE

- 拉取账户、订单、持仓和必要市场事实。
- 先 reconcile；无法可靠归属时进入 `needs_review`，不得新增风险。
- 慢轨先用 market scan / OHLCV 等低成本事实做全市场粗筛，只为晋级候选请求必要的单标的深度事实；active flow、挂单和持仓形成不能被普通候选挤出的数据需求。
- L2 等高频数据由 Market Data owner 常驻采集并返回 readiness / coverage；Runtime 不直接启停 Rust owner，数据 stale / gap / resync 时 fail closed。
- 只保留能改变 entry / stop / size / no_action 的证据；其余进入 refs / notes。

### PLAN

- 慢轨拥有 setup、thesis、entry、stop、size 和 action intent。
- 快轨只能继承慢轨语义，做条件触发和防御性动作。
- “方向成立”不等于“允许执行”。

### PREFLIGHT

- 对新增风险执行确定性 guard。
- blocked verdict 不得被 agent 叙事覆盖。
- 当前 guard 集合、未接入能力和执行顺序见 [risk-control-contract.md](../runtime/risk-control-contract.md)。

### EXECUTE

- 只消费已批准的 action intent、fresh facts、policy snapshot 和 execution contract。
- Binance write 必须显式授权；工具返回后必须回读或确认。
- submit 不改变 position；fill / partial fill / reconciled fill 才改变 position。

### REVIEW

- flow 闭合后形成最小复盘事实。
- 区分 thesis、data、execution、guard、cost 等失败来源。
- 单笔 review 只形成 evidence，不因一次亏损自动退役策略。
- Review 按精确 strategy version、regime、样本成熟度和 execution attribution 聚合后，Governance 才能 keep / observe / pause / retire，或形成 improvement request。
- improvement request 以 evidence refs 回到 R&D 并创建新 hypothesis / version；不得原地改写旧策略或旧证据。
- lifecycle decision 必须声明样本成熟度；样本数、时间跨度、regime coverage、成本或 execution attribution 不足时只能继续观察或提出补证据请求。

## 6. 实盘准入

任何新增风险动作必须同时满足：

- strategy / setup 具备 `live-small` 权限。
- runtime mode 未进入 safe / suspended / kill switch。
- `setup_id`、entry、stop、invalidation、risk budget 完整。
- account / order / position / market facts fresh。
- replay、shadow、live 的 execution alignment 可解释。
- preflight 通过。
- execution contract 已冻结。
- reconcile 无未知事实或 risk lock。

不满足时只能 observe、shadow、no_action 或减风险。

## 7. 长期 R&D Factory 与升格

R&D 是长期存在的策略工厂，由可恢复的有界工作单元组成：

```text
research question / cited finding / runtime lesson
  -> Planner Proposal -> Developer Contract Draft -> frozen Contract
  -> Trial -> Replay Result -> Reviewer Decision
  -> Draft Strategy -> Forward / shadow Result -> governance decision
  -> keep / pause / retire / improvement request
```

固定要求：

- Factory 不因一个 Campaign 的 `budget_exhausted / data_or_tool_blocked / candidate_found` 永久停止；它保存终态后继续选择可做工作、等待依赖或开启后续 Campaign。
- Campaign、Agent Run、Trial、并行度、compute、provider cost 和 locked holdout 使用必须继续有界；“持续研发”不等于无界模型循环、无界搜索或自动升格。
- discovery / validation / locked holdout 在研究开始前分离。
- 失败、negative control、trial budget 和 rejected mechanism 必须留下权威记录。
- 外部论文和研究材料只形成可回溯的 `research_basis`；它们可以启发或反驳 hypothesis，不能替代本项目自己的实验结果。
- Replay / Forward 只产生结果和证据，不拥有 promotion。
- Control Plane 接纳 Reviewer decision 后，Strategy Registry 才能物化 Draft；governance 决定后续状态迁移。
- `live-small` 还需要 fresh shadow / forward 样本和 execution attribution。
- `paused` 可恢复；`retired` 终止当前策略版本的新 setup、forward 和 live 动作，但不删除历史证据。再次启用同一思想必须形成新版本并重新治理。
- research state、strategy evidence 与 trade event 是三种不同事实源，不得互相代替。
- Agent Host 可承载 Planner / Developer / Reviewer 的语义 tool loop；Developer 可写每 Run 的冻结隔离 worktree，并产出 patch / test evidence，但 Host 不能写 production workspace、冻结 Contract、保留 Trial、执行 Replay、发布代码或改变 lifecycle。
- family 是 Universe 中的机制身份，不以有无代码定义。已有目标 engine implementation 时，hypothesis 只生成受约束候选合同并由 Registry 确定性物化；family 存在但 implementation 不足时，才需要隔离代码改动、CI、code review、release 和重新验证。
- `strategies/*.md` 同时承载人 / Agent 可读 policy 与机器 `Trade Contract`；Runtime 只消费编译结果和显式 semantic policy input，不执行任意 Markdown。需要 Agent 判断的策略走有界 Agent-assisted proposal，不能冒充 deterministic Replay parity。
- Developer 必须能完成“读上下文 → 改 MD / implementation / tests → 测试 → 请求 owner Replay → 诊断 Result → 再次修改或 reject”；只会一次性生成 JSON / 代码的 Host 不具备策略研发采用资格。
- mechanical Replay 可进入既有统计 gate；冻结 model/provider/prompt/toolset 与历史事实切片的 Agent-assisted evaluation 只形成探索 / 语义一致性证据，不能单独 promotion，冻结 policy 的 Forward / shadow 另行积累证据。
- 新策略版本必须绑定 MD source、compiled contract、implementation / Agent policy 和 release identity；部署新版本不重新解释已有 flow，旧执行能力只有在无 active / recovery / evidence 依赖后才可回收。

详细 R&D 合同见 [rd-autonomy-runtime.md](../research/architecture/rd-autonomy-runtime.md)、[rd-replay-execution-plane-design.md](../research/architecture/rd-replay-execution-plane-design.md)、[rd-strategy-universe-design.md](../research/strategy/rd-strategy-universe-design.md) 与 [research-source-knowledge-integration-plan.md](../research/sources/research-source-knowledge-integration-plan.md)。

## 8. 数据与事实优先级

```text
Binance exchange facts
  > trade_event_store / flow projection
  > governance evidence / artifact catalog
  > research state / automation memory
  > natural-language summary
```

- `trade.db` 只保存在线交易事件和可验证 refs。
- OHLCV / market facts、exchange audit、research state、governance ledger、artifact catalog 各有 owner store。
- 运行 artifact 不进入 Git。当前 artifact GC 仍以 dry-run / 显式删除为主；目标由 Program 定期触发 owner GC，自动回收过期、无引用、可重建数据，未知文件只允许 Agent 提议，实际删除必须通过 owner 的 ref / pin / lineage / retention gate。
- L2 raw 不进入通用 artifact GC；只有 finalize / compaction、跨 consumer 引用闭包和 retention release 完成后，才由 Market Data 专属 GC 删除。soft watermark 先回收和降级低优先级新增工作，hard watermark 只在回收失败后局部阻断非必要写入，防御交易链继续。
- durable store 与物理 schema 以 [storage-architecture.md](../architecture/storage-architecture.md) 为准。

## 9. 验收

产品达到可用状态时必须能回答：

- 为什么本轮没有交易，阻断来自哪里？
- 一笔 live 动作引用了哪次 observe、setup、policy、preflight 和 execution contract？
- 本地状态与 Binance 不一致时，谁恢复、写了什么、何时解除 risk lock？
- 一个策略为什么能进入 shadow / live-small，证据是否 fresh？
- 一次失败进入了 trade review、control review 还是 R&D lesson？
- Agent Host 关闭或替换后，哪些任务继续、哪些任务阻断、是否产生重复副作用？
- 一次 Agent 结果使用了哪个 provider/model、prompt/toolset 版本、输入 refs、预算和审批？
- 远程主机重启后，L2 epoch、OHLCV / feature watermark、program lease、R&D state 和 Agent session 分别如何恢复？
- 一个策略为何被 paused 或 retired，旧版本是否仍可能产生新动作？
- 多个 setup 同时合格时，账户级资金和相关风险如何裁决？
- 磁盘软水位触发了哪些 GC，删除依据与保护引用是什么；为何仍进入 hard limit？
- 一个运行中 flow 精确绑定哪份 MD、compiled contract、implementation / Agent policy 和 release，升级后由谁继续管理？
- Developer 是否能在隔离环境中从失败测试 / Replay 继续修订，且 patch 未经 CI / review / release 不进入生产？
- 某份策略证据来自 mechanical Replay、Agent-assisted historical evaluation 还是 Forward / shadow，分别允许支持什么决策？

这些问题若只能靠聊天记忆回答，即视为产品合同未满足。
