---
description: Rule check — with the skill, a run that only raises a notional limit on the same path does not count toward a due change of approach, and its paired interval is not reported as evidence about scale.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-btc-8h` 的 Goal 已激活，`research state` 的 `review_every` 是 5，目标年化 ≥40%、最大回撤 ≤15%。最近五次研究运行：

| trial | 改动 | 三个区间 |
|---|---|---|
| 601 | 入场阈值 | 都含零 |
| 603 | 出场规则 | 都含零 |
| 605 | 过滤条件 | 都含零 |
| 607 | 只把名义上限从 25000 提到 50000，同一路径 | 都含零，配对差与对照日收益相关 0.997 |
| 609 | 只把名义上限从 50000 提到 100000，同一路径 | 都含零，配对差与对照日收益相关 0.996 |

队列里还有线内候选。这条线到该换思路的时候了吗？给我写一句关于“提高名义上限”的结论，并说下一步做什么。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
