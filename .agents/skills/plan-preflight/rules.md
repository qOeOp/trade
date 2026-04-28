# Rules

> plan-preflight 用的规则集。新增规则 = 加一个 H2 段落，命名 `R-<DOMAIN>-<POINT>`。
> 不分级、不打 ack 标签 —— 强弱写在内容里，LLM 读上下文判。
> 想绕一条 rule，写进 `plan.thesis` 或 `plan.entry_intent` 自然语言里说清楚理由；review 阶段人工判是否合理。
> 设计背景见 [design-architecture.md](../../../docs/design-architecture.md)。

## 术语

- `plan`：当前 chain 最近一条 `observe.body` 的"意图段"
- `observe`：最近一条 `observe` 事件的 body
- `equity_live`：`observe.account.equity_usdt`
- `target_action`：本轮即将执行的动作（`no_action / place_entry / cancel_order / sync_protection / adjust_position`）
- `account`：`./data/account_config.json`（阈值 / 比例）

平台范围：Binance USDM 永续 4H+ swing。

---

## R-RISK-OPEN-CAP — 爆仓护栏：成交后总 open risk 不超预算

scope: `target_action ∈ {place_entry, adjust_position}`

任何新挂单 / 加仓必须满足：

```
sum(risk_budget_usdt for active plans ∪ {candidate}) + current_account_open_risk_usdt
  ≤ equity_live × account.max_open_risk_pct
```

违反直接拒。代码兜底；不让 LLM 介入。

why: 单笔/累计 open risk 超预算是真会爆仓的两件事之一，写成代码兜底是最后的安全网。

---

## R-RISK-DAY-FLOOR — 爆仓护栏：今日累计亏损不穿底

scope: `target_action ∈ {place_entry, adjust_position}`

任何新挂单 / 加仓必须满足：

```
realized_pnl_today_usdt + sum(unrealized_loss_at_stop for active plans) - candidate.risk_budget_usdt
  ≥ -(equity_live × account.max_day_loss_pct)
```

违反直接拒。代码兜底；不让 LLM 介入。

why: 今日已亏到该收手了还在加单是手贱，写成代码不走 LLM。

---

## R-OBS-FRESH — observe 距 now ≤ 30s

scope: `target_action != no_action`

最近 `observe.captured_at` 距 now > 30 秒视为 stale，本轮拒所有新动作。20–30 秒之间 DECISION_CARD 标黄但允许。

违反直接拒。代码兜底（机械时间戳比对）。

why: funding / OI / orderbook 过期会让 context 判断失真，严重时 stop 价位不对。

---

## R-PLAN-INTENT-COMPLETE — plan 必填字段非空

scope: `target_action != no_action`

以下字段必须全部非空：`symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation`。`expected_rr_net` 在 4H+ 持仓时必填。

违反直接拒。代码兜底（schema 校验）。

why: plan 是 agent 执行依据；任一段缺失等于让 agent 自由发挥。

---

## R-PLAN-VALID-WINDOW — valid_until_at 已过期视为废弃

scope: `target_action ∈ {place_entry, adjust_position}` 且 `plan.valid_until_at != null`

要求 `now ≤ plan.valid_until_at`。过期 plan 不得继续 place / adjust。

违反直接拒。代码兜底。

why: 过期 setup 沿旧观察执行，最容易把"当时能做"错当"现在还能做"。

---

## R-PLAN-INVALIDATION-TRIGGERED — setup 失效后不得继续执行

scope: `target_action ∈ {place_entry, adjust_position}`

LLM 读 `plan.invalidation` 自然语言 + `latest_observe.microstructure` 当前价格 / 多周期收盘，判断 invalidation 条件是否已触发。触发即拒，要求 agent 改走 `cancel_order` / `sync_protection`（平仓）/ `no_action`。

违反直接拒。LLM 判。

why: invalidation 是 thesis 废位（不同于 stop 止血价），已穿过的 plan 继续执行等于在已失效的 setup 上扣扳机。

---

## R-STOP-LADDER-MONOTONIC — stop_ladder 单调

scope: `plan.stop_ladder` 非空

要求：long 方向 `trigger_price` 与 `new_stop` 都递增；short 方向都递减。任意档位破坏单调即拒。

违反直接拒。代码兜底（数组扫描）。

why: 非单调 ladder 会让 agent 在错误位置反向移动 stop。

---

## R-TP-LADDER-RATIO-CAP — takeprofit_ladder.qty_ratio 之和 ≤ 1.0

scope: `plan.takeprofit_ladder` 非空

要求 `sum(qty_ratio for ladder entries) ≤ 1.0`。

违反直接拒。代码兜底。

why: 总比例 > 1 会让减仓量超过持仓量。

---

## R-FUNDING-NET-RR — 持仓 4H+ 必须把 funding 折进 expected_rr_net

scope: strategy.policy 或 plan.thesis / exit_intent 暗示持仓 ≥ 4h，且 `target_action ∈ {place_entry, adjust_position}`

LLM 读 `plan.thesis / exit_intent / expected_rr_net` 附近文字，判断是否量化提及 funding（百分比或绝对值）。未量化即记 violation。

违反直接拒。LLM 判。

why: 4H+ 持仓 funding 不算进 RR 等于把"看似为正"的 EV 实际亏掉累计 funding。

如要绕：plan.thesis 或 exit_intent 写明 reason（如"本 plan funding rate 接近 0；或父仓 hedge 已抵消 funding"）。

---

## R-FUNDING-BREAKEVEN — 持仓 ≥ 24H 在 stop_ladder 加一档把累计 funding 折进 break_even

scope: `plan.stop_ladder` 非空且 `plan.exit_intent` 暗示 break_even / 保本移止损规则，且持仓预期 ≥ 24h

LLM 读 stop_ladder 与 exit_intent，判断是否有一档对应"break_even 折入累计 funding"。

违反直接拒。LLM 判。

why: 入场前 expected_rr_net 算了 funding，但持仓中段触发 break_even 时若用 entry_avg 不含 funding，等于"看似保本"实际亏累计 funding。

---

## R-CORRELATED-EXPOSURE-CAP — 同簇敞口受 max_correlated_exposure_usdt 约束

scope: `target_action ∈ {place_entry, adjust_position}` 且 `account.max_correlated_exposure_usdt` 已配置

LLM 读 `plan.exposure`（同簇标签）+ 跨链聚合视图（按 cluster reduce active plans 的 net exposure），判断加上本 plan 后的同簇 net exposure 是否 ≤ 阈值。

违反直接拒。LLM 判。

如要绕：plan.thesis 写明 reason（如"本 plan 与旧链反向，实际降低净敞口"）。

---

## R-RECON-CHAIN-NOT-STUCK — 对账 stuck 的 chain 不得继续动作

scope: `target_action != no_action`

代码读本 chain 最近 N 条 observe 的 `reconcile_diffs`：连续 ≥ 3 轮非空即视为 stuck，拒所有新动作直至人工介入。

违反直接拒。代码兜底（reduce 历史 observe）。

why: 事件流与交易所失同步时再下单等于盲打。

如要绕：append 一条 observe 时显式记录人工核对结论（自然语言 `decision_summary`），LLM 在下轮 preflight 中据此判定 stuck 已解除。

---

## 附录：如何增加一条新规则

1. 起 rule_id：`R-<DOMAIN>-<POINT>`；DOMAIN 建议 `RISK / OBS / PLAN / STOP / TP / FUNDING / CORRELATED / RECON / EXEC / MARKET`
2. H2 标题：`R-ID — 一句话标题`
3. 写 scope（什么条件下触发）+ 检查内容 + 强弱（违反直接拒 / 违反警告 / 仅提醒）+ enforcement（代码兜底 / LLM 判）
4. why 或如要绕的 reason 示例
5. 完。不需要改 schema、不需要 migration（除非是新代码兜底 rule，需要在 plan-preflight 实现里加一段）

git history 即版本记录；规则废止时用 ~~删除线~~ 保留一段时间方便审计，再彻底删。
