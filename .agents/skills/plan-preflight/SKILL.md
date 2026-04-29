---
name: plan-preflight
description: cron 周期里 EXECUTE 之前的最后一道闸。preflight 三段（代码爆仓护栏 / 代码数据卫生 / LLM 读 rules.md）+ 渲染 6 行 DECISION_CARD；只读，不下单。任何 `target_action != no_action` 的本轮动作都必须先过它。
---

# Plan Preflight

只读 skill。服务 cron 周期里"决定本轮动作 → 真正提交"之间。结构与术语见 [design-architecture.md](../../../docs/design-architecture.md)；规则集见同目录 [rules.md](./rules.md)。

## 何时使用

- 每次 cron 跑到一条 open chain 决定执行非 `no_action` 动作之前
- 把当前 plan 意图段 + 最新 observe 证据段 + strategy 压成 6 行 DECISION_CARD，供执行前审计与人工扫读
- 想一次性跑全量 rule 判定当前 plan 是否健康

## 不该使用

- 不替代 `binance-*` 执行 skill 的参数校验（preflight 管 plan 自洽 + 风险底线，execute skill 管交易所 payload 合法）
- 不下单
- 不在没 open chain 的 cron 周期空转

## 输入

必填：

- `plan`：当前 chain 最近一条 `observe.body` 的"意图段"（`symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation / expected_rr_net / valid_until_at? / stop_ladder? / takeprofit_ladder? / risk_budget_change?`）
- `observe`：最近一条 observe event 的 body_json，含证据段（`account / microstructure / catalyst / exposure / reconcile_diffs`）；最小完整快照
- `strategy`：plan.strategy_ref 指向的 strategy 条目（policy markdown + tags）
- `account_config`：`./data/account_config.json`
- `target_action`：`no_action / place_entry / cancel_order / sync_protection / adjust_position`
- `request`：本轮 `action_intent.request` 结构化参数（`target_action != no_action` 时必填）

可选：

- `chain_history`：本 chain 历史 events（按时间序），用于 `R-RECON-CHAIN-NOT-STUCK` 的 stuck 计数
- `aggregate_view`：跨链聚合（active plans 的 `risk_sum` / 当前账户 open risk / 同簇 exposure），代码爆仓护栏与 `R-CORRELATED-EXPOSURE-CAP` 计算用

## 输出

```ts
{
  verdict: 'armable' | 'blocked' | 'abstain',
  violations: [{ rule_id: string, reason: string }],   // 任一非空 → blocked
  warnings:   [{ rule_id: string, reason: string }],   // 不阻拦但记录
  decision_card: string,                                // 6 行扫读视图
}
```

调用方（trade-flow）拿到 `verdict='blocked'` 应跳过本轮 EXECUTE，仅 append observe（含 `preflight_result`）；`verdict='armable'` 才提交动作；`verdict='abstain'` 用于 `target_action='no_action'` 等本轮无动作场景。

## Preflight 三段

1. **代码爆仓护栏**（`R-RISK-*`）
2. **代码数据卫生**（`R-OBS-FRESH` / `R-PLAN-INTENT-COMPLETE` / `R-PLAN-VALID-WINDOW` / `R-STOP-LADDER-MONOTONIC` / `R-TP-LADDER-RATIO-CAP` / `R-RECON-CHAIN-NOT-STUCK`）
3. **LLM 判**：读完整 rules.md + plan + observe + strategy.policy，判其余 rule（`R-PLAN-INVALIDATION-TRIGGERED` / `R-FUNDING-*` / `R-CORRELATED-EXPOSURE-CAP` 等）

任一段产出 violations 非空 → 短路返回 `verdict=blocked`。warnings 不阻拦。

### 1. 代码爆仓护栏

只在 `target_action ∈ {place_entry, adjust_position}` 时跑（`cancel_order` / `sync_protection` 不增加 open risk）。

```ts
// R-RISK-OPEN-CAP
function checkOpenRiskCap(plan, aggregate, account, equityLive) {
  const cap = equityLive * account.max_open_risk_pct
  return (
    aggregate.active_plans_risk_sum +
    plan.risk_budget_usdt +
    aggregate.current_account_open_risk_usdt
  ) <= cap
}

// R-RISK-DAY-FLOOR
function checkDailyLossFloor(plan, aggregate, account, equityLive) {
  const floor = -(equityLive * account.max_day_loss_pct)
  return (
    aggregate.realized_pnl_today_usdt +
    aggregate.active_plans_worst_loss_at_stop -
    plan.risk_budget_usdt
  ) >= floor
}
```

`equityLive = observe.account.equity_usdt`。任一失败 → violations 加对应 rule_id + 数值 reason（如 `"open_risk 加 candidate 会超预算 $42"`）。

### 2. 代码数据卫生

机械检查，无需 LLM：

- `R-OBS-FRESH`：`observe.captured_at` 距 now > 30s → fail
- `R-PLAN-INTENT-COMPLETE`：必填字段非空（`symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation`；4H+ 持仓时含 `expected_rr_net`）
- `R-PLAN-VALID-WINDOW`：`plan.valid_until_at` 存在且已过期 → fail
- `R-STOP-LADDER-MONOTONIC`：long 方向 trigger / new_stop 都递增；short 反向。任意档位破坏即 fail
- `R-TP-LADDER-RATIO-CAP`：`sum(qty_ratio) > 1.0` → fail
- `R-RECON-CHAIN-NOT-STUCK`：`observe.body.reconcile_diffs` 非空即 fail；reduce `chain_history` 检查连续 ≥ 3 轮非空 → 额外触发 stuck 通知

### 3. LLM 读 rules.md 判

LLM 输入：

- 完整 [rules.md](./rules.md)（按 H2 组织成 R-ID 段落）
- 当前 plan 意图段
- latest observe（含证据段：account / microstructure / catalyst / exposure）
- strategy.policy（markdown）
- target_action + request

LLM 输出 JSON：

```json
{
  "violations": [
    {"rule_id": "R-FUNDING-NET-RR", "reason": "thesis 没把 funding 折进 expected_rr_net"}
  ],
  "warnings": []
}
```

LLM 自己读 rule 内容判强弱（"违反直接拒" → violation；"建议" → warning）。preflight 不再分 MUST / SHOULD / CONTEXT 三级，rule 强弱由 markdown 内容自然承载。

三段输出合并 → 最终 verdict / violations / warnings。

## DECISION_CARD 渲染

6 行格式见 [design-architecture.md](../../../docs/design-architecture.md) 的 §DECISION_CARD。preflight 在 verdict 决定后渲染：

- 字段从 plan + latest observe + strategy 派生，agent 不手写
- thesis / entry_intent / exit_intent / invalidation / stop_price / risk_budget_usdt 必须出现 —— 缺失则 `R-PLAN-INTENT-COMPLETE` 已 fail，本轮不渲染卡片
- entry_intent / exit_intent 在卡里压成 1-2 句摘要（LLM 提炼），原文留 plan body
- `valid_until_at < now` → Plan 行标红（已被 `R-PLAN-VALID-WINDOW` 拒）
- snapshot age > 20s 黄、> 30s 红（红色已被 `R-OBS-FRESH` 拒）
- Checks 行展示 violations / warnings 的 `rule_id + reason`

## 想绕一条 rule

写进 plan.thesis 或 entry_intent 自然语言里说清楚理由 —— LLM 在判 rule 时读这段语境，可能输出 warning 而非 violation。review 阶段人工判是否合理。**没有 ack 字段、没有特殊机制**。

代码兜底的 rule（`R-RISK-*` / `R-OBS-FRESH` / `R-PLAN-*` / `R-STOP-*` / `R-TP-*` / `R-RECON-*`）不接受任何绕过 —— 这些是数学公式 / schema 完整性 / 时效性，写进 thesis 也不放行。

## 脚本边界

- 入口：`./scripts/main.ts`（待实现）
- 只读：`./data/account_config.json` + `./rules.md` + 调用方传入的 plan / observe / strategy / target_action / request / chain_history / aggregate_view
- 不发任何交易所请求；微结构 / catalyst 由上游 OBSERVE 阶段抓好写进 observe.body
- 不写事件：preflight 返回结果，trade-flow 在 cron 周期收尾把 `preflight_result` 作为 observe.body 一部分 append
- `--dry-json`：打印 LLM 原始 rule 判定，便于 debug

## 为什么这样设计

- **代码爆仓护栏只守两条**：`R-RISK-OPEN-CAP` / `R-RISK-DAY-FLOOR`。其余都不会让账户立刻出事
- **其余规则全 rules.md**：新增规则不改代码、不改 schema、不 migration —— markdown 加一段
- **LLM 判错 ≠ 爆仓**：代码兜底；LLM 漏掉 "funding 要提及" 顶多让 review 数据变脏
- **rule_id 是稳定句柄**：复盘按 `violations[].rule_id` 聚合；不引入 clause_id / ack 治理工具
- **DECISION_CARD 渲染 = 字段齐全校验**：硬字段缺则卡片渲染失败，preflight 直接拒
- **cron 周期幂等**：preflight 只读不写，重复跑安全；写入由 trade-flow 在收尾统一负责
