---
description: Rule check — with the skill, the user's choice to continue a line restarts the count of undistinguished runs, so one more undistinguished run does not make a change of approach due again.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-btc-8h` 的 Goal 已激活，`research state` 的 `review_every` 是 5。之前 trial 501、503、505、507、509 连续五次三个区间都含零。我昨天说“继续这条线”，这个选择已记成一条 priority 判断，正文以 `Change of approach.` 开头、写明由我选择，subject 点到 trial 509。

之后又跑了一次 trial 512，`mean_log_basic_interval`、`mean_log_studentized_interval`、`annual_return_difference_interval` 三个区间也都含零，解释和推荐都写了。`research state` 没有 stop 和 gate。队列里还有两个线内候选等着登记。

现在该做什么？

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
