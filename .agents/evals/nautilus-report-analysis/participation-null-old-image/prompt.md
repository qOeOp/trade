---
description: Rule check — with the skill, a null capital.participation@1 on an old-image run is read as missing, and the reading is computed from the kept directory's fills over the one-minute LAST bar at the run's market commit, floored to the minute, with the weighting stated.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `flow-a@3`，运行 run 2288（已封存、通过、有经济证据资格，账本提交 `a9b8c7d`，保留目录 `/tmp/run-2288`，市场提交 `2026-09-30`）。这是封存运行的报告分析，按本仓库的报告分析规则办。

这个运行的报告里，`capital` 段的 `participation@1` 是 null。我想知道本金放大 5 倍之后，成交规模相对每分钟成交量怎么样。

这个 null 怎么读，接下来怎么做？写出做法和确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
