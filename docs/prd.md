# PRD

## 1. 范围

当前产品只服务一个闭环：

```text
cron / user message
  -> OBSERVE
  -> PLAN + preflight
  -> EXECUTE
  -> REVIEW
```

目标是让 agent 基于 Binance USDM 事实、setup 资格证和 hard guards，安全推进少量 4H+ swing 实盘机会。

不做交易 SaaS、UI、跨账户、跨交易所、日内 probe、hedge 多腿。

完整系统保留离线验证链，但只作为 setup 准入机制，不展开成平台化研究系统：

```text
research / review
  -> replay / backtest
  -> shadow
  -> live-small / paused
```

## 2. 固定术语

| 术语 | 定义 |
| --- | --- |
| `strategy` | 规则模板；不等于实盘资格 |
| `setup` | strategy 内一个可验证的交易机会；live 动作必须引用 `setup_id` |
| `lane` | `strategy_ref + symbol + side` 的运行槽位 |
| `flow` | 一笔具体机会 / 暴露的生命周期 |
| `observe` | 本轮最小完整决策快照 |
| `order_fill` | 交易所提交、撤改、成交或对账补录事实 |
| `review` | flow 阶段性闭合后的最小复盘样本 |
| `execution_contract` | 提交前由 observe / request / 账户事实 / 交易所规格编译出的执行快照 |

## 3. 实盘准入

任何 `target_action != no_action` 且会新增风险的动作，必须满足：

- strategy / setup 已获 `live-small`
- `setup_id` 存在
- 账户、挂单、持仓、价格事实新鲜
- stop / invalidation / risk_budget 完整
- preflight 通过
- `execution_contract_snapshot` 已生成
- 对账未失败

未满足时只能 observe、shadow 或减风险。

## 4. Strategy / Setup

strategy 文件使用 markdown + frontmatter：

```yaml
---
strategy_id: S-XXX
name: text
status: draft | shadow | live-small | paused
tags: []
---
```

每个可交易 setup 至少声明：

- `setup_id`
- `hypothesis`
- `regime`
- `entry_rule`
- `stop_rule`
- `no_trade_conditions`
- `size_policy`
- `evidence_ref`
- `live_permission`

`draft` 只能分析；`shadow` 可记录影子动作，不提交 Binance；`live-small` 才能小资金实盘；`paused` 只允许观察和减风险。

## 5. Replay / Backtest / Shadow

这条链路只回答一个问题：setup 有没有资格动真钱。

最小输入：

- `setup_id`
- 样本范围
- 入场规则
- stop 规则
- size 规则
- fee / slippage / funding 假设

最小输出：

- 样本数
- 净 R 或净 pnl
- 最大回撤
- 失败类型
- 是否允许进入 `shadow` 或 `live-small`

禁止项：

- 没有规则口径就报胜率
- 只保留成功样本
- 因单个漂亮案例直接升 live-small
- 把回测系统扩成泛研究平台

## 6. OBSERVE

职责：

- 拉账户 / 持仓 / 挂单 / 成交事实
- 对账；无法可靠恢复则 abort
- 拉必要市场数据
- 补 setup 相关证据
- append 完整 observe

OBSERVE 不负责拍板交易，不负责穷举所有信息。全市场扫描只能产出候选；候选必须回到单标的 setup 判断。

## 7. PLAN

职责：

- 判断 setup 是否仍成立
- 输出 `direction_state`
- 输出 `execution_verdict`
- 写 `action_intent`
- 让 preflight 决定是否可执行

PLAN 不能把“方向成立”偷换成“必须执行”。合法组合包括：`偏多已确认 + 不追`、`中性 + 持有不动`。

信号准入：

只有能改变 `entry / stop / size / no_action` 的分析，才允许进入 `action_intent`。其他内容只能进入 notes / refs。

## 8. PREFLIGHT

preflight 是真钱动作前最后一道闸。

MVP hard guards：

- `G-RISK-OPEN-CAP`
- `G-RISK-DAY-FLOOR`
- `G-OBS-FRESH`
- `G-PLAN-INTENT-COMPLETE`
- `G-PLAN-VERDICT-COMPLETE`
- `G-SETUP-LIVE-PERMISSION`
- `G-KILL-SWITCH`
- `G-STOP-LADDER-MONOTONIC`
- `G-TP-LADDER-RATIO-CAP`

任一失败，本轮不执行，只 append observe。

## 9. EXECUTE

EXECUTE 只读：

```text
latest_observe.action_intent.request
```

执行顺序固定：

```text
request
  -> preview
  -> execution_contract_snapshot
  -> execute skill
  -> order_fill(source=trade_flow)
```

`order_fill(source=trade_flow)` 必须引用：

- `source_observe_event_key`
- `execution_contract_snapshot`

## 10. REVIEW

review 只做闭合样本，不自动升级策略。review 可以生成待验证假设，但必须进入 replay / backtest / shadow，不能直接升 live-small。

最小字段：

- `outcome`
- `pnl_pct`
- `thesis_held`
- `key_lesson`
- `promote_to_strategy`
- `notes`

review 只回答四类问题：

- setup 不成立
- 事实不够或不新鲜
- 执行出错
- hard guard 缺失或过严

## 11. Kill Switch

触发后禁止新增风险，只允许减风险动作：

- 对账无法恢复
- Binance API / cron 连续失败
- 日亏损接近底线
- lane / setup 连续亏损达到上限
- 重大事件窗口且 strategy 未明确允许

## 12. 数据与持久化

唯一核心表：

```text
plan_event(event_key, chain_id, kind, body_json, created_at)
```

`kind` 只允许：

- `observe`
- `order_fill`
- `review`

strategy policy 走 markdown；account / notify config 走 JSON；市场原始数据留在各 skill 输出或 refs，不塞进 `observe`。

## 13. 非目标

以下内容不进入当前 PRD：

- 平台化策略分支版本系统
- 自动策略挖矿 / 自动升格
- UI / 看板
- chat-history 实盘证据化
- 多账户 / 多交易所
- hedge 多腿净敞口
- 日内高频和 probe
