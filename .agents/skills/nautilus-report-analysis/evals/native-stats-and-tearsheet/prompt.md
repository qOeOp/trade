---
description: Regression — with the skill, standard ratios and the HTML report come from the pinned Nautilus analysis classes on trade-window returns.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我要给一次封存回测出一组统计（Sharpe、Sortino、Calmar、最大回撤）和一份 HTML 报告。环境固定安装 nautilus_trader 2.0.0rc3。封存里有 summary.json（含原生 stats_returns、stats_pnls、stats_general）和 returns_series.csv（从预热日开始的原生日收益），交易窗口起点写在 summary 的 period_start_utc。这是加密永续，一年 365 天交易。

请说明你的做法：调用哪些函数或库、用哪段数据、口径上要注意什么。不用写完整代码。
