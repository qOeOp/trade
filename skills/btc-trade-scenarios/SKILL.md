---
name: btc-trade-scenarios
description: Turn BTC market context into scenario-based long and short trade plans with entry, stop, targets, and invalidation. Use when the user asks for possible entry points, stop loss and take profit levels, or wants a structured trade plan built from verified live BTC data, provided market snapshots, or stored trade context.
---

# Btc Trade Scenarios

## Boundary

- `mission`: 把市场简报收敛为条件式多空计划，而不是预言式指令。
- `owned_artifacts`: `skills/btc-trade-scenarios/`。
- `upstream_inputs`: `research-synthesis` 输出、用户时间框架、`decision-chain` 只读上下文、`risk-guard` 约束。
- `downstream_outputs`: long / short / no-trade scenarios，包含触发、入场、止损、止盈、失效条件。
- `invariants`: 必须条件式；必须写清 invalidation；默认双边计划；结构脏时允许以观望为主。
- `allowed_dependencies`: `research-synthesis`、`risk-guard`、`decision-chain` 只读。
- `forbidden_dependencies`: `records/` 写入、实时执行、个性化仓位建议、跳过 invalidation。
- `non_goals`: 不是复盘模块，不是实时数据验证模块，不是 record writer。
- `change_triggers`: 稳定的策略家族分化；需要对多个时间框架输出独立计划；需要引入 plan scoring。
- `future_split_points`: 当“情景生成”和“计划评分/筛选”出现独立变更时，可拆成 `scenario-builder` 与 `scenario-eval`。

## Contract Authority

- module ownership 与 cross-module dependency truth 以 [docs/architecture/modular-outline.md](/Users/vx/WebstormProjects/trade/docs/architecture/modular-outline.md) 和 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。
- 本 skill 只定义 scenario workflow 与输出字段，不重新定义 records truth。
- 本地表达框架以 [references/strategy-framework.md](references/strategy-framework.md) 为准；它是 wording guide，不是新的 dependency truth。

## Workflow

1. If the request is time-sensitive, refresh or verify the current BTC context first.
2. Start from the existing market bias, range, and reference levels.
3. Build scenarios, not prophecy. Each scenario must be conditional.
4. Prefer two-sided planning: one long setup and one short setup, even if one side has lower confidence.
5. If structure is messy, downgrade confidence and make `观望` the primary recommendation.

## Required Fields Per Scenario

- `逻辑`: Why the setup exists.
- `触发条件`: What must happen before the scenario becomes valid.
- `入场区/触发价`: Use the supplied zones or nearby structure.
- `止损`: State the invalidation price clearly.
- `止盈`: At least two target levels when possible.
- `失效条件`: Explain when the plan is wrong.

## Judgment Rules

- Use zones for pullbacks and rejections.
- Use trigger prices for breakout and breakdown setups.
- If the implied reward-to-risk is poor or the invalidation is too far, say the setup is not worth taking.
- If the bias is bullish, the long setup can be the primary case and the short setup the hedge case. Reverse this in bearish conditions.
- Keep price precision practical. Whole dollars are enough for BTC here.

## Do Not Do This

- Do not present a trade as guaranteed.
- Do not omit invalidation.
- Do not prescribe leverage, position size, or “all-in” behavior.

## Reference

Read [references/strategy-framework.md](references/strategy-framework.md) to stay consistent on setup types and output wording.
