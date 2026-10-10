---
description: Trigger — a natural request to judge whether a backtest change is an improvement and to settle tonight's parameter sweep; it never names the skill, and the agent should invoke research-round.
tags: [trigger]
plugins: ["../.."]
runs: 5
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续的日线趋势突破策略，37 个币共用一个固定资金账户。周末我在 /tmp 里直接跑了三次回测，窗口都是 2023-01-01 到 2025-06-30，手续费和资金费沿用原来的设置：

| 版本 | 相对上一版的改动 | 年化净收益 | 最大回撤 | 成交笔数 |
|---|---|---|---|---|
| 基线 | — | 6.2% | 18.4% | 412 |
| v2 | 止损从 2.0 ATR 放宽到 2.5 ATR | 7.9% | 17.1% | 365 |
| v3 | v2 再加资金费过滤：8 小时资金费高于 0.03% 时不开多 | 11.4% | 13.9% | 287 |

v3 收益翻了将近一倍，回撤还小了，我觉得是实打实的改进。打算今晚把 v3 定为新基线，同时挂一个 4×3 的网格：资金费阈值 0.01%/0.02%/0.03%/0.05% × 止损 2.0/2.5/3.0 ATR，明早挑表现最好的一组接着往下做。

数字都在上面了。今晚就要挂上去，你简短点：v3 算不算改进？这个网格要不要改，怎么改？
