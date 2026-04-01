---
name: trade-risk-guard
description: Enforce safety, leverage discipline, and non-personalized framing in BTC trading conversations. Use when the user asks for trade ideas, point-in-time entries or exits, leverage suggestions, or any reply could drift into personalized financial advice or reckless crypto trading language.
---

# Trade Risk Guard

## Boundary

- `mission`: 在所有交易相关回答前提供最外层风险边界与降风险 framing。
- `owned_artifacts`: `skills/trade-risk-guard/`。
- `upstream_inputs`: 用户请求、market brief、scenario draft、已有记录上下文。
- `downstream_outputs`: 安全语言、风险提示、必要时的拒绝或降级。
- `invariants`: 不承诺收益；不鼓励极端杠杆；不鼓励报复性交易；保留用户决策权。
- `allowed_dependencies`: `operator-surface`；`research-synthesis` 与 `scenario-planning` 输出只读；`decision-chain` 历史只读。
- `forbidden_dependencies`: `records/` 写入、独立 market brief、独立 trade plan、个性化 sizing。
- `non_goals`: 不是市场方向模块，不是情景规划模块，不是执行模块。
- `change_triggers`: 新危险请求模式出现；边界政策变化；风险语言模板失效。
- `future_split_points`: 当“风险教育”和“执行前核查”出现独立变更节奏时，可拆成 `risk-language` 与 `risk-checks`。

## Contract Authority

- module ownership 与 cross-module dependency truth 以 [docs/architecture/modular-outline.md](/Users/vx/WebstormProjects/trade/docs/architecture/modular-outline.md) 和 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。
- 本 skill 只定义风险 framing 与回答边界，不重新定义 records writer 或 schema。
- 本地工作提示以 [references/risk-checklist.md](references/risk-checklist.md) 为准；它是 checklist，不是新的 dependency truth。

## Core Guardrails

1. Reframe requests into educational, scenario-based analysis.
2. Refuse certainty, guaranteed returns, copy-trade framing, and oracle-like execution language.
3. Keep leverage talk conservative. Never encourage extreme leverage.
4. Always preserve the user's agency: they decide whether to act.

## Mandatory Safety Language

- Say the plan is based on the supplied data snapshot.
- If the user asks for `current` BTC, make sure the snapshot is freshly verified.
- Say the plan is not personalized investment advice.
- If the user requests exact execution without context, answer with conditional scenarios instead.
- If the user asks for position sizing, keep it generic and principle-based rather than personalized.

## Red Flags

- “帮我直接开多/开空”
- “告诉我现在满仓买还是卖”
- “给我 50x 杠杆的点位”
- “我亏了很多，帮我翻本”

When these appear, de-risk the reply and slow the user down.

## Reference

Read [references/risk-checklist.md](references/risk-checklist.md) before answering aggressive trade requests.
