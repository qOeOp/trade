---
name: plan-preflight
description: cron 周期里 EXECUTE 之前的最后一道闸。跑两条硬 invariant（open risk cap / daily loss floor）+ 读 constitution.md 判 must/should/context + 渲染 6 行 DECISION_CARD；只读，不下单。任何 `target_action != 'no_action'` 的本轮动作都必须先过它。
---

# Plan Preflight

只读 skill。服务 cron 周期里"决定本轮动作 → 真正提交"之间。结构与术语见 [design-architecture.md](../../../docs/design-architecture.md) 的 `Plan 设计`；规则集见同目录 [constitution.md](./constitution.md)。

## 何时使用

- 每次 cron 跑到一条 open chain 决定要执行非 `no_action` 动作之前（`open_chain` / `place_order` / `move_stop` / `cancel` / `close`）
- 把当前 plan 意图段 + 最新 observe 证据段 + strategy 压成 6 行 DECISION_CARD，供执行前审计与人工扫读
- 想一次性跑全量 constitution 条款判断当前 plan 是否健康

## 不该使用

- 不替代 `binance-order-preview` 的参数校验（preflight 管 plan 自洽 + 风险底线，preview 管交易所 payload）
- 不下单
- 不在没 open chain 的 cron 周期空转——没有要执行的动作就跳过

## 输入

- 必填：
  - `plan`：当前 chain 最近一条 observe.body 的"意图段"（`symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation / expected_rr_net / valid_until_at? / acknowledgements?`）
  - `observe`：最近一条 observe event 的 body_json，含证据段（`account.equity_usdt / account.available_balance_usdt / account.snapshot_at / microstructure / catalyst / exposure / reconcile_diffs`）；语义上必须是"最小完整快照"，不是 patch
  - `strategy`：plan.strategy_ref 指向的 strategy_pool 条目（`policy_md` + `tags`）
  - `account_config`：`./data/account_config.json`（只含风险阈值 / 比例，不含 live equity）
  - `target_action`：本轮即将执行的动作（`open_chain` / `place_order` / `move_stop` / `cancel` / `close` / `no_action`）；决定哪些条款 in scope
- 可选：
  - `parent_chain_intents`：若本 chain 有 `plan_relation` parent，传入父链 current_plan，用于 hedge / net-exposure 判断（hedge MVP 阶段一般不传）
  - `intent_history`：本 chain 历史意图段序列（按时间序），用于 ack 重复计数

## 输出

```ts
{
  invariant: {
    open_risk_check: 'pass' | 'fail',
    daily_loss_check: 'pass' | 'fail',
    detail: {...}
  },
  must:      [{ clause_id, pass: boolean, reason: string }],   // MUST 条款逐条
  should:    [{ clause_id, status: 'pass' | 'warn-need-ack' | 'ack-accepted' | 'ack-exceeded', reason, ack?: {reason} }],
  context:   [{ clause_id, note }],                             // 不拦，显示用
  decision_card: string,                                        // 6 行，见 design-architecture.md
  verdict:   'armable' | 'blocked',                             // 任何 MUST fail / invariant fail / ack-exceeded → blocked
}
```

调用方（trade-flow）拿到 `verdict='blocked'` 应跳过本轮 EXECUTE，仅 append observe（含 preflight_result）；`verdict='armable'` 才提交动作。

## 硬 Invariant（代码强制，不走 LLM）

两条规则，先算"成交后总 open risk"，再算"今日亏损底线"：

```ts
// 成交后账户累计 open risk 不许超 equityLive × account.max_open_risk_pct
function checkOpenRiskInvariant(plan, active_plans_risk_sum, account, equityLive) {
  const target = plan.risk_budget_usdt
  const cap = equityLive * account.max_open_risk_pct
  return (active_plans_risk_sum + target) <= cap
}

// 今日已实现亏损 + 各活跃 plan 按 stop 估算的最坏浮亏 + candidate risk
// 不许穿 equityLive × account.max_day_loss_pct
function checkDailyLossInvariant(realizedPnlToday, activePlansWorstLoss, candidateRisk, account, equityLive) {
  const floor = -(equityLive * account.max_day_loss_pct)
  return (realizedPnlToday + activePlansWorstLoss - candidateRisk) >= floor
}
```

其中 `equityLive = observe.account.equity_usdt`。这两条都是"LLM 判错也不许放过"的规则。任一失败 → verdict=blocked，无法 ack 放行。

只在 `target_action='place_order'`（开仓 / 加仓）时跑这两条；`move_stop` / `cancel` / `close` 不增加 open risk，跳过 invariant 但仍跑 constitution。

## Constitution 判定流程

1. 加载 `constitution.md` 全文 + 当前 plan + observe + strategy.policy_md
2. 先跑机械 MUST（无需 LLM）：`C-PLAN-INTENT-COMPLETE` / `C-OBS-SNAPSHOT-FRESH` / `C-EXEC-STOP-MARK` / `C-EXEC-OTOCO-MOTHER` / `C-PLAN-VALID-WINDOW-NOT-EXPIRED`——任一 fail 直接短路返回 blocked
3. 过剩余 MUST 段：LLM 逐条判 `pass` 或 `fail + reason`
4. 过 SHOULD 段：LLM 逐条判 `pass / warn-need-ack / ack-accepted / ack-exceeded`
   - `ack-accepted`：plan.acknowledgements[] 里有该 clause_id + 具体 reason（非空字符串、> 10 字符）
   - `ack-exceeded`：本 chain 内（通过 `intent_history` 聚合）该 clause_id 以**不同 reason** 累计超 3 次
5. 过 CONTEXT 段：LLM 输出 `context[]` 注解
6. 合成 `verdict`：任何 MUST fail / invariant fail / ack-exceeded → `blocked`；否则 `armable`

## DECISION_CARD 渲染

6 行格式固定，见 [design-architecture.md](../../../docs/design-architecture.md) 的 `DECISION_CARD（6 行扫读视图）`。渲染规则：

- 字段从 plan + latest observe + strategy 派生，agent 不手写
- `thesis` / `entry_intent` / `exit_intent` / `invalidation` / `stop_price` / `risk_budget_usdt` 必须出现在卡里（缺失即 `C-PLAN-INTENT-COMPLETE` fail，等同 `C-DECISION-CARD-COMPLETE` fail）
- `entry_intent` / `exit_intent` 在卡里压成 1-2 句摘要（LLM 提炼），原文留在 plan body 供 constitution 判定
- 父子对冲：若本 chain 是 hedge 腿（`plan_relation.kind='hedge'` 指向父），Plan 行追加 `hedges → <parent_chain_ids>`（hedge MVP 阶段一般不出现）
- `valid_until_at < now`：直接触发 `C-PLAN-VALID-WINDOW-NOT-EXPIRED` fail
- `observe.account.snapshot_at` age > 20s 黄、> 30s 红（红 → `C-EXEC-OBSERVE-FRESH` 自动 fail）
- Checks 行：`MUST ✔/✗ <clause>`、`SHOULD ⚠ack <clause+reason>`、`CTX <note>`
- 卡渲染失败（关键字段缺失） → 等同 `C-DECISION-CARD-COMPLETE` fail

## 脚本边界

- 入口脚本：`./scripts/main.ts`（待实现）
- 只读 `./data/account_config.json` + 调用方传入的 plan / observe / strategy / target_action / intent_history
- 不发任何交易所请求（微结构 / catalyst 由上游 OBSERVE 阶段抓好写进 observe.body）
- `--dry-json` 打印 LLM 的原始 constitution 判定结果，便于 debug
- 不写事件：preflight 只返回结果。trade-flow 在 cron 周期收尾把 preflight_result 作为 observe.body 的一部分 append 进库

## 为什么这样设计

- **硬 invariant 只守两条底线**：`open risk cap` 与 `daily loss floor`。其余都不直接决定账户是否立刻出事
- **其它规则全放 constitution**：新增规则不需要改代码 / 改 schema / migrate 数据库，markdown 加一行即可
- **LLM 判错 ≠ 爆仓**：硬 invariant 兜底；LLM 漏掉 "funding 要提及" 顶多让 REVIEW 数据变脏，不会让账户爆
- **DECISION_CARD 渲染 = 字段齐全校验**：一石二鸟，不再单独写"必填字段"规则
- **cron 周期幂等性**：preflight 只读不写，重复跑安全；写入由 trade-flow 在收尾统一负责

脚本与 helper 的具体形状待 P0-0 bootstrap 套件目录落地后再补。
