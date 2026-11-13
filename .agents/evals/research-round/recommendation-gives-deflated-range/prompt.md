---
description: Rule check — with the skill, a recommendation gives the deflated Sharpe range that research status reads for the recommended run at the two trial counts, beside those counts, as a range and never as a single value or a gate.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `mr-btc-1h`。`hypothesis compare` 结果：候选 `mr-root@7`（trial 204）对对照 `mr-root@5`（trial 188），年化差 +4.1%，区间 [+0.4%, +7.9%]，p = 0.03；年化 19%，最大回撤 17%，Sharpe 1.6（目标：回撤不超过 20%，年化不低于 15%）。这是账本里唯一开着的线。

`research status --line mr-btc-1h` 输出（ledger_commit `q7m2c1d`，节选）：

```
multiple_testing: {line: mr-btc-1h, research_trials: 31, all_purpose_trials: 37, sweep_variants: 8, undeclared_sweeps: [], trials_with_sweeps: 45,
  mean_correlation: 0.58, effective_trials: 14.0, daily_sharpe_variance: 0.0009, runs_with_returns: 28}
comparison:
  runs:
    - {candidate: mr-root@5, trial_id: 188, deflated_sharpe: {effective_trials: 0.41, trials_with_sweeps: 0.27}, ...}
    - {candidate: mr-root@7, trial_id: 204, deflated_sharpe: {effective_trials: 0.63, trials_with_sweeps: 0.45}, ...}
```

给我写这轮的推荐，三四句话就行，我手机上看。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
