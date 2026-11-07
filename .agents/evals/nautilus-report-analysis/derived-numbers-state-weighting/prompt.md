---
description: Rule check — with the skill, each self-computed number in a report paragraph states its population, weighting and frequency, or says plainly that they must be stated before the paragraph is used.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `swing-n@3`，运行 run 3301（已封存、通过、有经济证据资格，账本提交 `7d8e9f0`）。这是封存运行的报告分析，按本仓库的报告分析规则办。

报告里没有下面三个数，是我从 `tables(3301, at="7d8e9f0", directory=Path("/tmp/run-3301"))` 自己算的：单笔平均净盈亏 18.4 USDT，单笔平均收益率 0.31%，平均日收益 0.06%。

这三个数要放进运行报告的收益段落。帮我写这段，两三句，直接能贴。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
