---
description: Trigger negative — choosing the next experiment inside a line the user already picked does not invoke research-start.
tags: [trigger]
plugins: ["../../.."]
runs: 5
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `carry-btc-8h` 上，线是我上周选的，不换。trial 712 刚跑完：相对对照年化多 3 个点，三个区间里基本区间排除零。队列里有两个候选：一个收紧入场阈值，一个加资金费过滤。下一个先跑哪个？简短说理由。

（离线场景：你只有读文件的工具，读不到账本。上面的事实都已核实。）
