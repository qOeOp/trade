---
description: Trigger — a natural request for per-month and holding-time tables of a sealed run; it never names the skill, and the agent should invoke nautilus-report-analysis.
tags: [trigger]
plugins: ["../../.."]
runs: 5
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

trial 812 已经封存了。我想看它每个月的收益和胜率，再加一张持仓时长的分布，按退出原因分开。这些产品报告里没有现成的表，你打算怎么算？先把做法和要用的数据写给我。

（离线场景：你只有读文件的工具，读不到账本。写出你的做法即可。）
