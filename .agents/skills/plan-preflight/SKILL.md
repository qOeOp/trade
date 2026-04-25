---
name: plan-preflight
description: PLAN → EXECUTE 之间的 plan 写入校验 skill。跑一条硬 invariant + 读 constitution.md 判 must/should/context + 渲染 DECISION_CARD；只读，不下单。升 (plan, armed) 和 armed → fired 前的最后一道闸。
---

# Plan Preflight

只读 skill。服务 `PLAN` 收尾与 `EXECUTE` 前一刻。结构见 [design-architecture.md](../../../docs/design-architecture.md) 的 `Plan 设计`；规则集见同目录 [constitution.md](./constitution.md)。

## 何时使用

- plan 即将写入新 intent 事件并升级 `gate`（任何 `drafting → armed`、`armed → fired` 都必须过一次）
- agent 想在扣扳机前一次性跑全量 constitution 条款
- 需要把当前 intent + observe + strategy 压成 8 行 DECISION_CARD 供人机确认

## 不该使用

- 不替代 `binance-order-preview` 的参数校验（preflight 管 plan 自洽，preview 管交易所 payload）
- 不下单
- 不做 in-position 期的规则评估——那是 monitor / REVIEW 的事

## 输入

- 必填：
  - `plan`：完整 intent event body_json（含 `market / side / entry / stop / risk_budget_usdt / phase / gate / strategy_ref / thesis / stop_anchor / tranches? / targets? / exit_note? / acknowledgements?`）
  - `observe`：最近一条 observe event 的 body_json（含 `account / microstructure / catalyst / exposure / cluster_net_exposure`）
  - `strategy`：plan.strategy_ref 指向的 strategy_pool 条目（`policy_md` + `tags`）
  - `account_config`：`./data/account_config.json`
- 可选：
  - `target_gate`：即将升级到的 gate（缺省 = plan.gate）
  - `parent_chain_intents`：若本 chain 有 plan_relation parent，传入父链 current_intent，用于 hedge / net-exposure 判断

## 输出

```ts
{
  invariant: { open_risk_check: 'pass' | 'fail', detail: {...} },
  must:      [{ clause_id, pass: boolean, reason: string }],   // MUST 条款逐条
  should:    [{ clause_id, status: 'pass' | 'warn-need-ack' | 'ack-accepted' | 'ack-exceeded', reason, ack?: {reason} }],
  context:   [{ clause_id, note }],                             // 不拦，显示用
  decision_card: string,                                        // 8 行，见 design-architecture.md
  verdict:   'armable' | 'blocked',                             // 任何 MUST fail / invariant fail / ack-exceeded → blocked
}
```

## 硬 Invariant（代码强制，不走 LLM）

一条规则 + 一段 TypeScript 判定：

```ts
// 成交后账户累计 open risk 不许超 account.equity × account.max_open_risk_pct
function checkOpenRiskInvariant(plan, active_plans_risk_sum, account) {
  const target = plan.risk_budget_usdt
  const cap = account.equity * account.max_open_risk_pct
  return (active_plans_risk_sum + target) <= cap
}
```

这是唯一一条"LLM 判错也不许放过"的规则。失败 → verdict=blocked，无法 ack 放行。

## Constitution 判定流程

1. 加载 `constitution.md` 全文 + 当前 plan + observe + strategy.policy_md
2. 过 MUST 段：LLM 逐条判 `pass` 或 `fail + reason`
3. 过 SHOULD 段：LLM 逐条判 `pass / warn-need-ack / ack-accepted / ack-exceeded`
   - `ack-accepted`：plan.acknowledgements[] 里有该 clause_id + 具体 reason（非空字符串、> 10 字符）
   - `ack-exceeded`：本 chain 内（通过 intent history 聚合）该 clause_id 以**不同 reason** 累计超 3 次
4. 过 CONTEXT 段：LLM 输出 `context[]` 注解
5. 合成 `verdict`：任何 MUST fail / invariant fail / ack-exceeded → `blocked`；否则 `armable`

## DECISION_CARD 渲染

8 行格式固定，见 [design-architecture.md](../../../docs/design-architecture.md#decision_card唯一视图)。渲染规则：

- 字段从 plan + latest observe + strategy 派生，agent 不手写
- spot plan 隐 funding/OI
- tranches 非空：Route 行 entry 显 `<首档> (+N 档)`
- S-HEDGE-GENERIC：Strategy 行追加 `hedges → <parent_chain_ids>`
- snapshot age > 20s 黄、> 30s 红（红 → C-EXEC-MICROSTRUCTURE-FRESH 自动 fail）
- Checks 行：`MUST ✔/✗ <clause>`、`SHOULD ⚠ack <clause+reason>`、`CTX <note>`
- 卡渲染失败（关键字段缺失） → 等同 C-DECISION-CARD-COMPLETE fail

## 脚本边界

- 入口脚本：`./scripts/main.ts`（待实现）
- 只读 `./data/account_config.json` + 调用方传入的 event body
- 不发任何交易所请求（微结构 / catalyst 由上游 skill 抓好传入）
- `--dry-json` 打印 LLM 的原始 constitution 判定结果，便于 debug
- 写 `check` 事件：由调用方（trade-flow/stages/plan）决定写不写；preflight 本身只返回结果

## 为什么这样设计

- **硬 invariant 只 1 条**：真会爆仓的只有"累计风险超上限"这一件事，其余都不会立即爆仓
- **其它规则全放 constitution**：新增规则不需要改代码 / 改 schema / migrate 数据库，markdown 加一行即可
- **LLM 判错 ≠ 爆仓**：硬 invariant 兜底；LLM 漏掉 "funding 要提及" 顶多让 REVIEW 数据变脏，不会让账户爆
- **DECISION_CARD 渲染 = 字段齐全校验**：一石二鸟，不再单独写"必填字段"规则

脚本与 helper 的具体形状待 P0-0 bootstrap 套件目录落地后再补。
