---
description: Rule check — with the skill, a root's single-run report is read through the signal table too, and a row is cited only when its signal holds in that report.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-kc-1d`（起点 `kc-root@1`，开发窗口 2023-01-01 至 2025-06-30，日线，单个 ETH 永续）。根的首份报告运行 `run-k1a`，账本提交 `a81f3c0`，没有对照，所以 `hypothesis compare` 返回 NO_CONTROL。`replay report --run-id run-k1a` 的部分结果：

| 项 | 数值 |
|---|---|
| 经济证据资格 | 可用 |
| `by_period` · `months_won_share` | 0.63 |
| `by_period` · `residual_after_top5_days` | 正，去掉最好五天后仍盈利 |
| `capital` · `time_in_market@1` | 0.97 |
| `drawdown` · `max_drawdown` | 24%，区间 2024-04-02 至 2024-07-15 |
| `drawdown` · `top_instrument_share_in_drawdown` | 100%（只有一个合约） |
| `capital_scaled` · `timing_term` | 负 |

同事说：attribution.md 是读比较用的，根没有对照就不用看信号表；要看的话，就引 S9（`by_period`），按 `residual_after_top5_days` 把预测期限改长。请写出这次 priority 判断排第一的动作，并写明它依据的信号行与职责。
