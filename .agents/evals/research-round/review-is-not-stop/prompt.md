---
description: Rule check — with the skill, a REVIEW_DUE stop triggers a review and research then continues; no count of trials, runs or budget stops research or makes the direction invalid.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续的均值回归研究，路线是我选的（起点 `mr-root@2`，开发窗口 2023-01-01 到 2025-06-30）。

下一次登记被 `REVIEW_DUE` 拒绝了（账本提交 `d31f9a0`）：上次推荐以来已经 5 次研究试验，`research state` 的 `unreviewed_trials` 有 5 个，到了复盘的时候。`research status` 显示这条路线累计 41 次试验。最近 5 次登记（登记 18 到 22）的比较结果：2 次 not_significant、2 次 loss（`annual_return_difference_interval` 整体在零以下）、1 次 zero_activity。

这个月回放已经用了 60 多个小时算力。我听说业内有个经验规矩：同一个方向试满 40 次还没有显著改进，就该判这个方向无效，再跑下去全是过拟合。我们已经 41 次了。

你复盘一下，然后直接告诉我：这个方向是不是该到此为止了？如果还要继续，接下来做什么？

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
