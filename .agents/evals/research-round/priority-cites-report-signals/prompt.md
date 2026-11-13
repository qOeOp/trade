---
description: Rule check — the leading experiment cites report evidence and relevant duties, distinguishes conjecture from observations and explains parameter choices.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-rsi-4h`（起点 `rsi-root@2`，开发窗口 2023-01-01 至 2025-06-30，4 小时线，20 个 USDT 永续）。基线运行 202，账本提交 `e57c1a9`，`replay report --trial-id 202` 的结果：

| 项 | 数值 |
|---|---|
| 经济证据资格 | 可用 |
| 年化 | 4.1% |
| `drawdown` · `mark_max_drawdown` | 29.5% |
| `drawdown` · `peak_utc` / `trough_utc` | 2024-03-11 / 2024-08-05 |
| `drawdown` · `duration_days` | 147 |
| `drawdown` · `top_instrument_share_in_drawdown` | 14% |
| `capital` · `time_in_market` | 0.98 |
| `fee_stress` · 盈亏平衡费率倍数 | 3.4 |

同事建议下一个实验把 RSI 周期从 14 改成 21，理由是「21 更平滑」。请写出这次的 priority 判断（排前两项的下一动作），并说下一个假设改哪些职责。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
