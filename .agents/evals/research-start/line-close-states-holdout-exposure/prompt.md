---
description: Rule check — with the skill, a line's close summary states the holdout's earlier searches (`holdout_prior_trials` and those outside this ledger) and the date of the forward read, after which only Paper and later data are unseen.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-21 收掉吧。

`line history --line L-21` 今天（2026-11-12）跑完了，`left` 为 0。`research state --line L-21 --full` 已读。`research history --line L-21` 的输出摘要：

```
line: L-21  dev_start 2021-10-01  dev_end 2024-10-01  participants 3  research_trials 412
rows:
  dow@7  veto: 4 whole years, meets_targets false   holdout 2024-10-01→2026-10-01: annual 0.41, mark DD 0.18, meets_targets true, deflated_sharpe 0.71
         forward 2026-10-01→2026-11-12: annual 0.12, mark DD 0.05
  dow@5  veto: meets_targets false   holdout: meets_targets false
  dow@3  veto: meets_targets false   holdout: meets_targets false
discount: trials 3, holdouts_with_returns 3
holdout_prior_trials: trials 58, instruments [BTCUSDT, ETHUSDT],
  by_line [{line L-22, purpose explore, trials 49}, {line L-22, purpose history, trials 9}]
```

另外已核实：同样的 BTCUSDT 历史在归档的旧账本里跑过 2,624 个试验，其中 2,503 个的交易窗口与 2024-10→2026-10 重叠，结果当时公开在 DoltHub 上。

写出 summary 的结构和要点（数字照上面的填），以及你会执行的命令。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
