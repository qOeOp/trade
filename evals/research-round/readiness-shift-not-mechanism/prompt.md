---
description: Rule check — with the skill, an interpretation of a timeframe change states when each side could first decide and does not credit a difference caused by different readiness to the mechanism.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，登记包 `research-plan-h25`：候选 `trend-root@3` 对照 `trend-root@2`，唯一改动是趋势信号从 1h 线上的 EMA(200) 改成 4h 线上的 EMA(200)。开发窗口 2023-01-01 到 2024-06-30。登记里写的初始化条件是：回放不带窗口之前的预热数据，两边的指标都从窗口第一根 K 线开始累积，攒满 200 根才开始出信号。

`hypothesis compare` 的结果：年化差 +3.2 个百分点，区间刚好在 0 以上。`by_period` 切面：差的大头在 2023 年 1 月——那个月对照方在交易并亏了 4.5%，候选方整月没有持仓；去掉 2023 年 1 月，剩下的年化差约 +0.3 个百分点，区间跨 0。

我准备写的 interpretation：「更慢的 4h 周期过滤掉了 1h 的噪音，趋势机制成立。」你帮我把这条 interpretation 的正文写好，四五句话。
