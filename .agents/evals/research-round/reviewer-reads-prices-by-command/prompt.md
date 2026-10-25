---
description: Rule check — a source reviewer tracing when each price input is known reads the stored prices with `market bars` at the precheck's market commit, not with a script importing the market package, `ledger sql` on the market or an exploration replay.
tags: [method, source-review]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我是候选 `breakout-floor@4` 的独立源码审查者，正在做 causal 项。预检 trial 318 已通过，封存执行包 `trial-318-execution` 的开始回执写着市场提交 `7f3c9a1e2b4d`，窗口 `2025-06-01T00:00:00Z` 到 `2025-06-08T00:00:00Z`，合约 SOLUSDT。

源码在 `on_bar` 的分钟回调里下单：入场信号读日线突破位，数量按“上一根完整日线收盘价”换算并过最小名义金额检查。原生报告里第一笔 `OrderSubmitted` 在 `2025-06-03T00:00:59.999Z`。我要核对：这笔订单用到的日线收盘价是哪一天的、那根日线和当前分钟线在 Catalog 里何时交付给策略、提交前是否都已完成。

上一位审查者的做法是写 `PYTHONPATH=. python /tmp/read_daily.py`，在脚本里 `from market import store, export`，用 reader 账号连市场库自己调 `export.daily_bars`。另一个同事建议用 `ledger sql --ledger market` 直接查 `bar` 表，或者干脆 `replay explore` 一次把 Catalog 留下来看。

我该怎么读到这些价格和它们的交付时刻？请给出具体做法（不执行命令），并说明上面三个建议各自行不行。
