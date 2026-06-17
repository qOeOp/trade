---
name: plan-preflight
description: cron 周期里 EXECUTE 之前的最后一道闸。先按 flow semantics 收敛动作，再跑 hard guards 与 6 行 DECISION_CARD 校验；只读，不下单。任何 `target_action != no_action` 的本轮动作都必须先过它。
---

# Plan Preflight

只读 skill。服务 cron 周期里“决定本轮动作 → 真正提交”之间。结构与术语见 [design-architecture.md](../../../docs/design-architecture.md)。

## 何时使用

- 每次 cron 跑到一条 active flow 决定执行非 `no_action` 动作之前
- 把当前 plan 意图段 + 最新 observe 证据段 + strategy 压成 6 行 DECISION_CARD，供执行前审计与人工扫读
- 想在真正提交前一次性确认：流程语义已收敛、hard guards 已通过、卡片可渲染

## 不该使用

- 不替代 `binance-*` 执行 skill 的交易所参数校验
- 不下单
- 不在没有动作候选时空转

## 输入

必填：

- `plan`：当前 flow 最近一条 `observe.body` 的意图段
- `observe`：最近一条 observe event 的 body_json，含证据段
- `strategy`：`plan.strategy_ref` 指向的 strategy 条目（policy markdown + tags）
- `account_config`：`./data/account_config.json`
- `target_action`：`no_action / place_entry / cancel_order / sync_protection / adjust_position`
- `request`：本轮 `action_intent.request` 结构化参数（`target_action != no_action` 时必填）

可选：

- `flow_history`：本 flow 历史 events（按时间序），用于对账 stuck 计数与最近动作恢复
- `aggregate_view`：账户级聚合视图（active plans 的 `risk_sum` / 当前账户 open risk / realized pnl today）
- `runtime_health`：cron / Binance API / 对账 / 事件窗口状态，用于 kill switch

## 输出

```ts
{
  verdict: 'armable' | 'blocked' | 'abstain',
  blocked_by: [{ check_id: string, reason: string }],
  warnings:   [{ source: string, reason: string }],
  decision_card: string,
}
```

调用方（trade-flow）拿到 `verdict='blocked'` 应跳过本轮 EXECUTE，仅 append observe（含 `preflight_result`）；`verdict='armable'` 才提交动作；`verdict='abstain'` 用于 `target_action='no_action'` 等本轮无动作场景。

## Preflight 两步

1. **流程语义收敛**
2. **hard guards + card validation**

任一 hard guard 失败，或 DECISION_CARD 渲染发现关键字段缺失 → `verdict=blocked`。

### 1. 流程语义收敛

LLM 输入：

- 当前 `plan`
- `latest observe`（含 `account / microstructure.notes / microstructure.refs / catalyst / exposure` 等紧凑证据段）
- `strategy.policy`
- `target_action + request`

LLM 需要按主流程固定语义判断：

- `valid_until_at` 已过期：当前 setup 失效，不继续执行
- `invalidation` 已触发：当前 thesis 不得继续推进
- `current_position != 0`：工作重点转为 `exit_intent + thesis` 管理
- 上轮 `target_action != no_action` 但无对应 `order_fill`：必须重读最新语境再决定续做或放弃
- `strategy.status` 或 setup `live_permission` 不是 `live-small`：不得放行真钱动作；`shadow` 只记录影子动作
- 本轮分析若不能改变 `entry / stop / size / no_action` 之一，只能进入 notes / refs，不得支撑动作

这一步的作用不是生成一堆“规则命中”，而是把本轮动作收敛成可执行、可解释的一版计划。

### 2. hard guards + card validation

hard guards 只保留确定性、必须严格遵守、可脚本化的检查。MVP 先固定：

- `G-RISK-OPEN-CAP`
- `G-RISK-DAY-FLOOR`
- `G-OBS-FRESH`
- `G-PLAN-INTENT-COMPLETE`
- `G-PLAN-VERDICT-COMPLETE`
- `G-SETUP-LIVE-PERMISSION`
- `G-KILL-SWITCH`
- `G-STOP-LADDER-MONOTONIC`
- `G-TP-LADDER-RATIO-CAP`

只在 `target_action ∈ {place_entry, adjust_position}` 时跑风险相关 guard；`cancel_order / sync_protection` 不增加 open risk。

示意：

```ts
function checkOpenRiskCap(plan, aggregate, account, equityLive) {
  const cap = equityLive * account.max_open_risk_pct
  return (
    aggregate.active_plans_risk_sum +
    plan.risk_budget_usdt +
    aggregate.current_account_open_risk_usdt
  ) <= cap
}

function checkDailyLossFloor(plan, aggregate, account, equityLive) {
  const floor = -(equityLive * account.max_day_loss_pct)
  return (
    aggregate.realized_pnl_today_usdt +
    aggregate.active_plans_worst_loss_at_stop -
    plan.risk_budget_usdt
  ) >= floor
}
```

机械检查包括：

- `observe.created_at` / `observe.captured_at` 距 now > 30s → `G-OBS-FRESH` fail
- `thesis / entry_intent / exit_intent / invalidation` 非空 → `G-PLAN-INTENT-COMPLETE`
- `direction_state / execution_verdict` 必填且取值合法 → `G-PLAN-VERDICT-COMPLETE`
- `target_action != no_action` 且新增风险时，`setup_id` 缺失或 setup 未获 `live-small` → `G-SETUP-LIVE-PERMISSION`
- `runtime_health` 显示对账失败、API/cron 连续失败、日亏损接近底线、lane 已 paused、重大事件窗口禁新仓 → `G-KILL-SWITCH`
- `stop_ladder` 单调 → `G-STOP-LADDER-MONOTONIC`
- `takeprofit_ladder.qty_ratio` 之和 ≤ 1.0 → `G-TP-LADDER-RATIO-CAP`

任一失败都写进 `blocked_by[{check_id, reason}]`。

对账失败不作为 preflight hard guard。cron 入口若无法把交易所事实可靠归属到当前 flow，应直接 abort 本周期并通知；能可靠归属的事实先补写 `order_fill(source=reconcile)`，再进入 preflight。

## DECISION_CARD 渲染

6 行格式见 [design-architecture.md](../../../docs/design-architecture.md) 的 §DECISION_CARD。

- 字段从 `plan + latest observe + strategy` 派生，agent 不手写
- thesis / entry_intent / exit_intent / invalidation / stop_price / risk_budget_usdt 必须出现
- Verdict 行必须并列展示 `direction_state / execution_verdict`
- `valid_until_at < now` → Plan 行标红，按流程语义视为当前 setup 失效
- snapshot age > 20s 黄、> 30s 红（红色通常伴随 `G-OBS-FRESH` fail）
- Checks 行展示 `blocked_by / warnings`

## 脚本边界

- 入口：`./scripts/main.ts`（待实现）
- 只读：`./data/account_config.json` + 调用方传入的 `plan / observe / strategy / target_action / request / flow_history / aggregate_view`
- 不发任何交易所请求
- 不写事件：preflight 返回结果，trade-flow 在 cron 周期收尾把 `preflight_result` 作为 observe.body 一部分 append

## 为什么这样设计

- 流程语义直接内嵌在主流程与 stage 定义里
- hard guards 才是脚本真正需要承载的部分
- `blocked_by.check_id` 直接服务当前两分法
- DECISION_CARD 渲染继续承担“执行前最后一次字段完整性检查”
- preflight 全程只读，重复跑安全
