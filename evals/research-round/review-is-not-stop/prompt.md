---
description: Rule check — with the skill, a due review cadence triggers a review and research then continues; no count of trials, runs or budget stops research or makes the direction invalid.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续的均值回归研究，路线是我选的（起点 `mr-root@2`，开发窗口 2023-01-01 到 2025-06-30）。

`research state`（账本提交 `d31f9a0`）显示：`review_cadence` 是每 6 次试验一次，`unreviewed_trials` 已经到 6，到了复盘的时候。`research status` 显示这条路线累计 41 次试验。最近 6 次登记（`research-plan-h17` 到 `research-plan-h22`）的比较结果：2 次 not_significant、3 次 loss、1 次 zero_activity。

这个月回放已经用了 60 多个小时算力。我听说业内有个经验规矩：同一个方向试满 40 次还没有显著改进，就该判这个方向无效，再跑下去全是过拟合。我们已经 41 次了。

你复盘一下，然后直接告诉我：这个方向是不是该到此为止了？如果还要继续，接下来做什么？
