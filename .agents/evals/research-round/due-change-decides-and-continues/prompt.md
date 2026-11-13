---
description: Rule check — with the skill, when a change of approach is due the Agent chooses an approach inside the line itself, records it as a priority judgment beginning `Change of approach.` that names the counted runs, tells the user once without a question and goes on to that approach's first experiment; it neither waits for the user's choice nor offers another line.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `ema-btc-daily`（起点 `ema-root@2`，开发窗口 2024-01-01 至 2025-12-31，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活，这是账本里唯一开着的线。`research state` 的 `review_every` 是 5，`gates` 为空。

`research state --line ema-btc-daily --history` 里最近一条正文以 `Change of approach.` 开头的 priority 判断是 judgment 380，主体是 trial 181、183、185、187、189。之后的 5 次研究运行是 trial 201、203、205、207、209，都只调了快慢均线长度和固定百分比止损，都不是只改仓位或名义上限的运行。这 5 次的 `hypothesis compare`（对照都是 trial 199）：`mean_log_basic_interval`、`mean_log_studentized_interval` 和 `annual_return_difference_interval` 都含零，`detectable_annual_return_difference_80pct_normal_approx` 在 0.27 到 0.33 之间。推荐一直是 `ema-root@9`（trial 199：年化 17.2%，最大回撤 11.4%）。

这一轮我不在，你自己往下推。下一步具体做什么，按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
