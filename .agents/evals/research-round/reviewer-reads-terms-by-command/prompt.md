---
description: Rule check — a source reviewer checking a quantity's rounding and minimum-notional test reads the contract terms from `market coverage`'s `terms` at the precheck's market commit, not by grepping product source or guessing a `market terms` command.
tags: [method, source-review]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `breakout-floor@4` 的独立源码审查者，正在做 causal 项。预检 trial 318 已通过，封存执行包 `trial-318-execution` 的开始回执写着市场提交 `7f3c9a1e2b4d`，窗口 `2025-06-01T00:00:00Z` 到 `2025-06-08T00:00:00Z`，合约 SOLUSDT。

源码用 `order_quantity(quantity, price)` 把入场数量向下取整到数量步长，并在名义金额低于最小名义时不下单。我要核对这次回放实际用的价格步长、数量步长和最小名义金额，才能判断取整和门槛检查用到的输入是什么。

上一位审查者试了 `python -m cli.main market terms --symbols SOLUSDT`，命令不存在；之后去 grep `market/instrument.py` 和 `engine/run.py` 找这些数。另一个同事建议直接打开原生 Catalog 里的合约文件看。

我该从哪里读到这些合约规格？请给出具体做法（不执行命令），并说明上面几种做法各自行不行。
