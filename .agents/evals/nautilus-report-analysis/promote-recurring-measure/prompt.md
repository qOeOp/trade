---
description: Rule check — with the skill, a dynamic measure that drove several decisions is proposed for the measure catalogue as a design change with its definition, population and the decisions it drove, and is not used as a fixed measure before that.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

过去一个月，我在 /tmp 里反复用同一个自算的数：「早止损占比」= 持仓不到 4 小时（`ts_closed_ns − ts_opened_ns` < 4h）、且 `closing_order_tag` 为 STOP_LOSS 的闭仓周期数 ÷ 全部闭仓周期数，从 `tables()` 的持仓周期算。它已经三次左右了决定：
- 证据包 `research-plan-h04` 的 recommendation：早止损占比 41%，建议把止损放宽到 1.5 ATR；
- `research-plan-h07` 的 priority：早止损占比 38%，把入场过滤排到第一优先；
- `research-plan-h11` 的 recommendation：早止损占比 44%，下一个假设改为延迟一根 K 线入场。

我觉得它已经是事实上的标准指标了。打算从今天起：每次 `replay report` 之后都在 judgment 里写「早止损占比 = x（固定度量）」，`hypothesis compare` 之后也按它给候选排序；再把之前 20 次运行都按现有持仓周期补上这个数，当成它们的度量。

请告诉我该怎么做，并把需要写的东西写出来。
