---
name: plan-preflight
description: PLAN → EXECUTE 之间的 plan 写入校验 skill。批量跑 hardcode 规则（R-001..R-024 中对应当前 status 生效的子集）+ 渲染 DECISION_CARD；只读，不下单。ready-execute → wait-until-fill 转换前的最后一道闸。
---

# Plan Preflight

只读 skill。服务 `PLAN` 收尾与 `EXECUTE` 前一刻，跑 [Plan 写入校验](../../docs/design-architecture.md#plan-写入校验) 列出的 hardcode 规则并渲染 [DECISION_CARD](../../docs/design-architecture.md#decision_card派生视图不是字段)。

## 何时使用

- plan 即将写入或升级 status（`draft → wait-condition / ready-probe`、`wait-condition → ready-execute`、`ready-execute → wait-until-fill`）
- agent 想在扣扳机前一次性跑全量规则
- 需要把 body_json 压成 6 行卡片供人机确认
- 需要核对微结构快照是否新鲜（R-022）、catalyst 是否被看见（R-023）

## 不该使用

- 不是用来替代 `binance-order-preview` 的参数校验（preflight 管 plan 自洽，preview 管交易所 payload）
- 不做实际下单
- 不做 monitoring 期的规则评估（REVIEW / OBSERVE 用独立 rule_evaluation 流）

## 输入

- 必填：
  - `plan`：完整 plan body_json（含 `status / market_type / what / why / context / exposure / execution_lane / risk_budget / ...`）
  - `account_snapshot`：`./data/account_config.json` + `./data/account_state.json` 的最新快照（`account_equity / max_loss_pct / max_open_risk_pct_after_fill / max_correlated_exposure_usdt / max_correlated_gross_exposure_usdt / portfolio_context.open_risk_pct`）
- 可选：
  - `microstructure_snapshot`：若 plan body 里没带最新微结构，可由调用方单独注入（仍需带 `snapshot_at`）
  - `catalyst_window`：当前持仓预期窗口的 catalyst 列表（缺省时直接读 plan.context.catalyst.items）
  - `target_status`：即将升级到的 status（缺省 = plan.status）——决定生效哪一档规则

## 输出

- `passed`：通过的 rule_id 列表
- `failed_rules`：`[{rule_id, severity: "reject", reason, field_path?}]`——任何一条非空即 preflight fail
- `warnings`：`[{rule_id, severity: "warn-ack", reason, required_ack?}]`——plan 写入时必须有对应 `rule_acknowledgements[]` 条目
- `decision_card`：6 行字符串（见 DECISION_CARD 固定格式），字段从 plan body 派生；任何关键字段缺失时卡片渲染失败 → 视为 R-021 fail
- `freshness`：`{microstructure_age_s, catalyst_window_covered, snapshot_at}`——R-022 / R-023 所需的时间戳上下文

## 覆盖的规则

按 target_status 激活：

- `≥ wait-condition`（含 ready-probe 骨架）：R-001 / R-003 / R-004 / R-012 / R-018
- `ready-probe only`：R-024（probe 硬 cap）
- `≥ ready-execute`：追加 R-002 / R-005 / R-006 / R-008 / R-009 / R-011 / R-013 / R-014 / R-015 / R-020 / R-022 / R-023
- `ready-execute → wait-until-fill only`：R-021（preflight 自身必须输出完整卡，`Checks` 行不含 ✗）

R-007（OTOCO visibility）、R-016 / R-017 / R-019 由 monitoring / execution 链上独立 hook 处理，不在 preflight 范围。

## 执行顺序

1. 载入 plan + account_snapshot，解析 `target_status`
2. 按 target_status 激活规则集，逐条跑校验
3. 渲染 DECISION_CARD；字段不齐即 R-021 fail
4. 返回 `passed / failed_rules / warnings / decision_card / freshness`
5. 调用方据此决定是否写入 plan、是否进入 wait-until-fill

## 脚本边界

- 入口脚本是 `./scripts/main.ts`（待实现）
- 只读 `./data/account_config.json` / `./data/account_state.json`；不写任何文件
- 不发任何交易所请求（微结构 / catalyst 由上游 skill 抓好传入）
- `--dry-json` 打印解析后的规则输入，不跑校验

脚本与 helper 的具体形状待 P0-0 bootstrap 套件目录落地后再补。
