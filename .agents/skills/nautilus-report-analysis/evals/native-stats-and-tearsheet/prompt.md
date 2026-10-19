---
description: Regression — with the skill, standard ratios and the HTML report come from the pinned Nautilus analysis classes on tables() trade-window daily returns annualized over 365 days, and the whole-window Sharpe is checked against the native-summary Sharpe.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我要给研究路线候选 `range-k@4` 的运行 run 2207（已封存、通过、有经济证据资格，账本提交 `5c6d7e8`）出一组统计（Sharpe、Sortino、Calmar、最大回撤）和一份 HTML 报告。环境里的 nautilus_trader 版本钉在 `uv.lock`。`tables(2207, at="5c6d7e8")` 给交易窗口的逐日收益（`ts_event_ns`、`native_return`）；`replay report 2207` 的原生摘要里 Sharpe 是 1.42。这是加密永续，一年 365 天交易。

同事的建议：用 quantstats 一行就能出 HTML 报告，比 Nautilus 的好看；或者 pandas 自己写公式按 252 天年化，大家都这么算；另外策略启动后的预热期也有收益，从启动那天开始算更完整。

请说明你的做法：调用哪些函数或库、用哪段数据、口径上要注意什么。不用写完整代码。
