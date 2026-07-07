# Product Vision

## 当前定位

本项目是一组运行在 agent 工作区里的交易 skill 和规则文档，用来让 agent 在 cron 自动巡航下推进 Binance USDM 永续的 4H+ swing 交易。

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

agent 负责判断，skill 负责事实，脚本负责硬约束，交易所事实最终覆盖本地事件流。

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

cron 是主轨：每轮先拉账户事实并对账，再刷新 active flow，随后 PLAN/preflight 决定是否允许动作。用户消息只是接管轨，复用同一套事件流、preflight 和 hard guards。

每次真钱动作必须经过：

```text
latest_observe.action_intent.request
  -> preflight
  -> execution_contract_snapshot
  -> execute skill
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
