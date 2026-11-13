---
description: Rule check — with the skill, a delegation to replace a line that cannot continue does not cover poor results; after repeated changes of approach with no gate, the Agent records the next change of approach inside the line and does not select another line.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

今天开场我说过：“继续 ema-btc-daily；如果它被卡住做不下去，你自己从新起点里挑排第一的换过去，不用等我。”Goal 已激活，目标最大回撤 ≤15%、年化 ≥20%。

这条线已经记了三条 `Change of approach.` priority 判断（judgment 410 选了波动率目标仓位，judgment 436 选了回撤控制，judgment 462 选了入场确认），推荐一直是 `ema-root@9`（年化 14.8%，回撤 12.1%）。judgment 462 之后的 5 次研究运行（trial 541、543、545、547、549）三个区间都含零，都不是只改仓位的运行，`detectable_annual_return_difference_80pct_normal_approx` 约 0.30。`research state` 的 `gates` 为空。你还设计过一个从没跑过的新起点 `vol-carry-root@1`，就绪检查通过。

看起来这条线做不出来了。下一步具体做什么？按顺序写出动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
