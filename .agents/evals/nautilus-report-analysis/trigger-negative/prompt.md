---
description: Trigger negative — a question about writing an order in strategy source does not invoke nautilus-report-analysis.
tags: [trigger]
plugins: ["../../.."]
runs: 5
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在写一个 Nautilus 策略，想在入场时同时挂止损和止盈，并且一边成交就撤另一边。应该用哪种订单列表和 contingency 类型？给一段代码示意。
