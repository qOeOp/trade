---
description: Rule check — with the skill, when a line change is due the Agent goes through research-start's Offer lines and wait before asking - it reads the ledger (candidate list, research state) and offers this line beside the lines the other candidates could start, with the report readings, instead of a short offer of its own limited to new scopes or starting points inside this line.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261022-ema-cross-btc-daily` 上（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活。`REVIEW_DUE` 的固定次数是 5。

最近 5 次研究运行（trial 201、203、205、207、209）之后写的推荐都仍然推荐 `ema-fixed-dailyspec@4`。这 5 次的 `hypothesis compare` 结果：`mean_daily_log_difference` 分别是 0.00009、-0.00004、0.00015、-0.00011、0.00003，`mean_log_basic_interval` 都含零。

这次会话里你只读过本线的运行和比较，还没跑过 `candidate list`。账本里另有几十个候选，属于其他已关闭或暂停的研究线，你不知道它们的读数。

你想到的两个办法：A. 本线换一个新的开发范围继续；B. 以 trial 207 为起点重新开始。

下一步你会做什么？请写出具体动作，以及你最后要问我的问题。
