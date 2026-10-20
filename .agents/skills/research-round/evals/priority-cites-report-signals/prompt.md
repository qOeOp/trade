---
description: Rule check — with the skill, a priority judgment quotes the report measures behind the first-ranked action (slice, measure, value), names the signal-table row and duty ids, prefers the duties the strongest signal points to, and a parameter-only change names its report evidence.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-rsi-4h`（起点 `rsi-root@2`，开发窗口 2023-01-01 至 2025-06-30，4 小时线，20 个 USDT 永续）。基线运行 `run-r2b`，账本提交 `e57c1a9`，`replay report run-r2b` 的读数：

| 项 | 数值 |
|---|---|
| 经济证据资格 | 可用 |
| 年化 | 4.1% |
| `drawdown` · `mark_max_drawdown@2` | 29.5% |
| `drawdown` · `peak_utc@2` / `trough_utc@2` | 2024-03-11 / 2024-08-05 |
| `drawdown` · `duration_days@2` | 147 |
| `drawdown` · `top_instrument_share_in_drawdown@2` | 14% |
| `capital` · `time_in_market@1` | 0.98 |
| `fee_stress` · 盈亏平衡费率倍数 | 3.4 |

同事建议下一个实验把 RSI 周期从 14 改成 21，理由是「21 更平滑」。请写出这次的 priority 判断（排前两项的下一动作），并说下一个假设改哪些职责。
