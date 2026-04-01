---
name: btc-market-brief
description: Analyze BTC market context into a concise brief covering structure, momentum, volatility, and key levels. Use when the user asks what BTC looks like now, wants trend context before planning a trade, or needs current support and resistance summarized from verified live data, provided screenshots, or stored trade notes.
---

# Btc Market Brief

## Boundary

- `mission`: 把已验证的市场事实压缩成简明、可引用、可接续的 BTC 结构判断。
- `owned_artifacts`: `skills/btc-market-brief/`。
- `upstream_inputs`: fresh market data、用户截图、`records/daily/`、既有 trade cases 只读上下文。
- `downstream_outputs`: market brief、关键支撑阻力、偏向与结构切换条件。
- `invariants`: 事实与解释分离；实时结论必须说明数据时间；输出只能是 brief，不是执行指令。
- `allowed_dependencies`: `operator-surface`、`risk-guard`、`decision-chain` 只读。
- `forbidden_dependencies`: `records/` 写入、完整 trade scenario 生成、未验证新闻或订单簿细节。
- `non_goals`: 不是新闻链路，不是回测模块，不是执行模块。
- `change_triggers`: 需要稳定整合多源研究资产；BTC 之外出现多品种支持；brief 格式持续失效。
- `future_split_points`: 当“市场事实提取”和“观点压缩”出现不同 owner 或不同输入资产时，可拆成 `market-facts` 与 `research-briefs`。

## Contract Authority

- module ownership 与 cross-module dependency truth 以 [docs/architecture/modular-outline.md](/Users/vx/WebstormProjects/trade/docs/architecture/modular-outline.md) 和 [docs/architecture/dependency-rules.md](/Users/vx/WebstormProjects/trade/docs/architecture/dependency-rules.md) 为准。
- 本 skill 只定义 brief workflow 与输出骨架，不单独声明新的 module contract。
- 本地输出模板以 [references/output-template.md](references/output-template.md) 为准；它是格式提示，不是新的 dependency truth。

## Workflow

1. If the question is about `current` BTC, verify fresh market data first.
2. Treat verified live data, user-supplied market snapshots, and repo records as the source of truth.
3. Explain the current BTC state in plain language before discussing trade scenarios.
4. Separate facts from interpretation. Facts come from data; interpretation comes from structure and momentum.

## Output Rules

- State the current directional bias with a confidence tone such as `偏多`, `偏空`, or `震荡偏中性`.
- Mention why that bias exists using 24h, 7d, 30d change, volatility, volume trend, and position inside the 30d range.
- Surface the most important nearby support and resistance first. Do not dump every number.
- If volatility is high, say the market is fast and easy to fake out.
- If structure is mixed, explicitly say the market is not clean enough for aggressive conviction.

## Do Not Do This

- Do not invent news, ETF flows, macro catalysts, or order-book data that are not in context.
- Do not call a level “strong” or “guaranteed” without noting it is only a reference level.
- Do not jump straight into a trade recommendation before summarizing market state.

## Reference

Read [references/output-template.md](references/output-template.md) when you need the preferred market-brief structure.
