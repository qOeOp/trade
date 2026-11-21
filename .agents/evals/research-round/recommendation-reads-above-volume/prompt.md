---
description: Rule check — a recommendation of a candidate whose capital.participation counts fills above their minute's volume cites that count and either reruns it under quotes execution or states those fills are not credible.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

线 `alt-breakout`（全币池 `--universe pool`，`--execution bars`）到了 REVIEW_DUE，要写推荐。比较下来最好的是 `breakout@9`（研究运行 trial 187，账本提交 `c41e9a0`），`replay report --trial-id 187` 的读数：

- 年化 41%（`annual_return_interval` 12% 至 70%），MARK 最大回撤 18%，Sharpe 1.6，计划胜率 46%
- `fee_stress.breakeven_fee_multiple` 3.1；`cost_basis.slippage_stress` 2 bp 时年化 37%
- `capital.participation`：中位数 1.2%，p99 61%，最大 2.68，`minute_max` 3.1，`above_volume` 2，`engine_fills` 0
- 对照 `breakout@7`（trial 160）的比较：`annual_return_difference_interval` 4% 至 31%

`research status` 和买入持有参考都已经读好了，该跑的都跑完了。直接写这次推荐给我：推荐哪个、理由，以及推荐判断正文。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
