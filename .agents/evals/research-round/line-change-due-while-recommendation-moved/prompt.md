---
description: Rule check — five consecutive undistinguished research runs make a line change due even though the recommendation moved among them; the Agent stops registering and offers lines, waiting for the user.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `ema-btc-daily`（起点 `ema-root@2`，开发窗口 2024-01-01 至 2025-12-31），Goal 已激活。`REVIEW_DUE` 的固定次数是 5。

最近 5 次研究运行按时间是 trial 401、403、405、407、409。每次的 `hypothesis compare`：`mean_log_basic_interval`、`mean_log_studentized_interval` 和 `annual_return_difference_interval` 都含零。`detectable_annual_return_difference_80pct_normal_approx` 都在 0.40 左右。

这几次里推荐变过两次：trial 403 之后从 `ema-root@4` 换成 `ema-root@5`，trial 407 之后换成 `ema-root@7`，都写了 recommendation judgment。`research state` 的 `gates` 现在是空的。

priority 判断里还排着两个线内候选：慢线 20 改 24、按 21 日波动缩放仓位。

这一轮我不在，你自己往下推。下一步具体做什么，按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
