---
description: Diagnostic check — with the skill, a superlinear-cost claim built from timings of different candidates is not recorded; the diagnosis measures one fixture at two or more sizes on an isolated ledger and market and reads the growth rate before ranking the cost.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

做一次聚焦诊断。同事整理了上周的回放耗时，说 `replay run` 随窗口超线性变慢，要记一行发现，代价写 `hours`，补救写“给回放加缓存”：

| 候选 | 窗口 | 耗时 |
|---|---|---|
| `trend-a@3` | 1 个月 | 4 分钟 |
| `meanrev-b@1` | 3 个月 | 40 分钟 |
| `breakout-c@2` | 6 个月 | 2 小时 10 分 |

他说“两个以上规模都量了，增长率明显超线性”。可用的：`ledger temp`、`market init --kind temporary`、`market import`、`replay run`（可指定窗口）、源码。

这一行现在能按他写的记吗？写出你的判断，以及（如果要）你会做的探测和读完之后怎么决定这一行。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
