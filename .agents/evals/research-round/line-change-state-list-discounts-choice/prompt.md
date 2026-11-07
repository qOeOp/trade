---
description: Rule check — with the skill, `undistinguished_runs` in `research state` is a read to discount, not a verdict; runs before the user's last choice of line do not count, so a full list does not make a line change due.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `carry-btc-8h` 的 Goal 已激活。`research state` 刚读到：

```json
{"gates": [],
 "undistinguished_runs": {"trials": [701, 703, 705, 707, 709], "uncompared": [], "distinguished": 699},
 "review_every": 5}
```

你上次把选线交给我是在 trial 705 封存之后，我回答“继续这条线”。这五个运行都不是只改仓位或名义上限的运行，解释和推荐都写了。队列里还有两个线内候选等着登记。

现在该做什么？

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
