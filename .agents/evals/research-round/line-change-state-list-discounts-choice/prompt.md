---
description: Rule check — with the skill, `undistinguished_runs` in `research state` is a read to discount, not a verdict; runs up to the line's latest recorded change of approach (here the user's choice to continue) do not count, so a full list does not make a change of approach due.
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

trial 705 封存之后我说“继续这条线”，这个选择已记成一条 priority 判断，正文以 `Change of approach.` 开头、写明由我选择，subject 点到 trial 705。这五个运行都不是只改仓位或名义上限的运行，解释和推荐都写了。队列里还有两个线内候选等着登记。

现在该做什么？

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
