# Product Vision

## 当前定位

本项目是一组运行在 agent 工作区里的交易 tool 和规则文档，用来让 agent 在 cron 自动巡航下推进 Binance USDM 永续的 4H+ swing 交易。

它不是交易 SaaS、不是全市场研究平台、不是 UI 产品。当前目标是让 agent 在事实新鲜、风险明确、setup 已验证、执行可审计的前提下，小资金推进少量实盘机会。

完整系统需要两条链：

- 在线交易链：`OBSERVE -> PLAN -> EXECUTE -> REVIEW`
- 离线验证链：`research / review -> replay / backtest -> shadow -> live-small / paused`

当前优先实现在线链和 setup 级 replay / shadow gate；离线验证链已实现最小可运行闭环，不提前做平台化。
最终产品必须形成完整策略迭代闭环：`replay evidence -> shadow samples -> live-small samples -> review -> strategy policy change -> replay again`。当前已固定 evidence ledger、四类 evidence fingerprint、locked holdout、strategy-review、strategy-promote；只做有预算的因子筛选，不做无界搜索或自动升格。

## 核心原则

- No tested edge, no trade
- No fresh facts, no trade
- No executable contract, no trade
- No stop, no trade
- No reconciliation, no trade

agent 负责判断，tool 负责事实，脚本负责硬约束，交易所事实最终覆盖本地事件流。

## 产品边界

当前只做：

- Binance USDM 永续单账户
- 4H+ swing
- cron 主轨 + 用户偶尔接管
- `OBSERVE -> PLAN -> EXECUTE -> REVIEW`
- setup 级 `draft / shadow / live-small / paused`
- 小资金实盘前的 replay / shadow gate
- append-only 事件流与交易所对账

当前不做：

- probe / 日内高频
- hedge 多腿净敞口
- 平台化策略演化系统
- 通用回测平台
- 看板 / UI / 多终端产品
- 跨账户 / 跨交易所
- chat-history 作为实盘证据源

## 运行方式

一条高频 automation supervisor 是唯一外部入口：先生成本轮任务图，再把盯市、慢轨判断、strategy R&D supervisor、R&D forward tracker、artifact 保洁分发给上下文隔离的 subagent；平仓 review 在交易与对账完成后按事件串行收尾。慢轨、R&D 和保洁仍由各自 cadence gate 控制，不因入口高频唤醒而高频运行。

产品运行像一个小型投研交易台，而不是一个单线程聊天机器人：

- 总控：列出本轮 job、检查 cadence / lock / concurrency / permission，最后收口摘要。
- live 线：用 `live-small` 策略盯市、管理 active flow、触发经过 preflight 的执行。
- shadow 线：继续跟踪已冻结候选和 paper / shadow 样本，累积执行前证据。
- R&D 线：研发新策略，失败经验进入下一轮 hypothesis，直到 shadow 候选、预算耗尽或阻断。
- review 线：复盘已闭合交易，把执行、成本、regime、策略条款问题写回迭代链。
- hygiene 线：维护 artifact / catalog，保证证据可找、可删、可复读。

strategy R&D supervisor 的产品语义是“学习型研究员”，不是单次实验按钮：它在预算内读取上一轮 `failure_summary / reliability_gate / universe_lessons`，生成下一条更受约束的 hypothesis，循环到 `shadow_candidate_found / budget_exhausted / data_or_tool_blocked` 才停。它只能写研究 artifact、catalog metadata 与 gated strategy draft，不能写 `trade.db` 或触发 Binance。

subagent 是运行时并行与上下文卫生机制，不是新的事实源或权限主体。读重任务可以并行；`trade.db` 写入、交易动作和 review 封口必须按 concurrency group 串行，并继续经过 CLI、cron lock、preflight 与交易所事实回读。

用户消息只是接管轨，复用同一套事件流、preflight 和 hard guards。

每次真钱动作必须经过：

```text
latest_observe.action_intent.request
  -> preflight
  -> execution_contract_snapshot
  -> execute tool
  -> order_fill
```

## 核心对象

- `strategy`：规则模板，不是实盘资格。
- `setup`：strategy 内一个可验证的交易机会；live 动作必须引用 `setup_id`。
- `lane`：`strategy_ref + symbol + side` 的运行槽位。
- `flow`：一笔具体机会 / 暴露从 observe 到闭合的生命周期。
- `plan_event`：唯一持久事件流，承载 `observe / order_fill / review`。

## 判断质量

市场分析只在能改变以下四项之一时进入动作：

- `entry`
- `stop`
- `size`
- `no_action`

不能改变这四项的内容只能进入 notes / refs，不参与真钱动作。

## 成功标准

第一阶段成功不是“系统很聪明”，而是：

- 不重复下单
- 不漏保护
- 对账失败能停
- 未验证 setup 不动真钱
- 每笔新增风险都有 stop / invalidation / risk_budget
- 每次执行都有 `execution_contract_snapshot`
- review 能分清 setup、事实、执行、hard guard 哪一层出错

## 完整性边界

系统最终必须能回答三件事：

- 为什么这个 setup 有 edge
- 这个 edge 在历史 / shadow / 小资金里是否站得住
- 当前实盘动作是否仍满足事实、风险、执行和对账约束

为回答这三件事，离线验证链是完整系统的一部分；但它只服务 setup 准入，不扩成独立研究平台。

必须避免：

- 因单个漂亮案例直接升 live-small
- 把回测系统扩成泛研究平台
- 把 Roll / VPIN 直接写成开仓信号
- 无引用的 replay / shadow / market artifact 长期堆积
