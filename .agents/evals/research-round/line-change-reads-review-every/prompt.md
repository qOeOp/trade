---
description: Rule check — with the skill, the runs that make a change of approach due are counted against `review_every`, which the Agent reads from `research state` before deciding, and a `REVIEW_DUE` just cleared does not stand in for it.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `rev-sol-1h` 这一轮进行中，这是账本里唯一开着的线：

- 最新推荐：对照 `rev-root@3`（trial 22），年化 6%，回撤 31%（目标：回撤不超过 25%，年化不低于 15%）。这条 recommendation 刚写完，是 `REVIEW_DUE` 要的。
- 之前 8 个派生试验，前 5 个的区间都排除零、方向是比对照差；最新 3 个和对照分不出差异。
- 最新 priority 判断里还有两个没做的实验：把止损改成 ATR 倍数、加上波动率 sizing。

这条线一直在亏。下一步做什么？

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
