---
description: Rule check — with the skill, a recommendation on a one-year, five-contract line lists the worst quarter, the return without the best quarter and the net without the top contract beside the whole-window readings.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

路线 `vol-breakout-pool`：五个合约（BTC、ETH、SOL、BNB、XRP），开发窗口 2025-10-01 至 2026-10-01（一年），我的目标：最大回撤不超过 30%，年化不低于 20%。`unreviewed_trials` 为空，`gates` 为空；最新推荐是 judgment 120，推荐 `vol-breakout-pool@28`（trial 85），对照 `vol-breakout-pool@12`（trial 40）。没有部署 IDE；Goal 已获准，不用再问。

请直接写出给我的推荐说明：这条线现在推荐哪个版本、列出哪些读数、取舍是什么。读数用占位，不用真实数值。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。题面没给的命令输出不用向我要，用占位接着写。）
