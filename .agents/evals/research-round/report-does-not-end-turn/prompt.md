---
description: Rule check — with the skill, a report, interpretation or priority never ends the turn; after recording the priority the response goes on to publish, precheck, review, register and replay the next experiment in the same turn.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-mom-1d` 是我选的：起点 `mom-root@1`，开发窗口 2022-01-01 至 2025-06-30，市场提交 `2025-07-01`。根的首次登记 1（无父无对照）已经回放完，运行 101，账本提交 `8a1f0d3`。`replay report --trial-id 101` 的结果：

| 项 | 数值 |
|---|---|
| 经济证据资格 | 可用 |
| 年化 | 7.9% |
| `drawdown` · `mark_max_drawdown` | 34% |
| `drawdown` · `peak_utc` / `trough_utc` | 2022-04-02 / 2022-11-20 |
| `drawdown` · `duration_days` | 232 |
| `capital` · `time_in_market` | 0.96 |
| 盈利月份占比 | 48% |

请把这份基线报告写出来，写好 interpretation 和 priority，然后接着做研究。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
