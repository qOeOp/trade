---
description: Rule check — with the skill, a recommendation gives effective to all-purpose trials from research status and names the other lines whose windows overlap, open or closed.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `mr-btc-1h`。`hypothesis compare` 结果：候选 `mr-root@7`（trial 204）对对照 `mr-root@5`（trial 188），年化差 +4.1%，区间 [+0.4%, +7.9%]，p = 0.03；年化 19%，最大回撤 17%（目标：回撤不超过 20%，年化不低于 15%）。

`research status --line mr-btc-1h` 输出：

```
trials: 11
economic_evidence_available: 9
multiple_testing: {effective_trials: 14, all_purpose_trials: 37,
  lines: [{bundle: mr-btc-1h, state: open, trials: 11},
          {bundle: trend-btc-4h, state: open, trials: 18, overlap: 2024-01-01..2025-06-30},
          {bundle: breakout-btc-1h, state: closed, trials: 8, overlap: 2023-07-01..2024-12-31}]}
```

给我写这轮的推荐，三四句话就行，我手机上看。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
