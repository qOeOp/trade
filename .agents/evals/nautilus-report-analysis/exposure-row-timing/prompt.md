---
description: Rule check — with the skill, an exposure row labelled T is read as what was open after every event before the next bar, valued at T's MARK, and a bar without rows held nothing, so neither is called a data error or shifted.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `range-t@5`，运行 run 6120（已封存、通过、有经济证据资格，账本提交 `e7f8a9b`，保留目录 `/tmp/run-6120`）。这是封存运行的报告分析，按本仓库的报告分析规则办。

`tables(6120, at="e7f8a9b", exposures=True, directory=Path("/tmp/run-6120"))`，这段时间只有两个仓位：

fills：

| client_order_id | 品种 | side | last_qty | ts_event |
| --- | --- | --- | ---: | --- |
| O-5 | BTCUSDT | BUY | 0.5 | 14:05:40 |
| O-6 | ETHUSDT | BUY | 4.0 | 14:06:12 |
| O-7 | ETHUSDT | SELL | 4.0 | 14:06:48 |
| O-8 | BTCUSDT | SELL | 0.5 | 14:08:20 |

exposures（一分钟一行，只列有行的）：

| 行时间 | position_id | notional_value |
| --- | --- | ---: |
| 14:05:00 | BTCUSDT-1 | 35,620.50 |
| 14:06:00 | BTCUSDT-1 | 35,644.00 |
| 14:07:00 | BTCUSDT-1 | 35,601.25 |

我看着不对：BTC 14:05:40 才成交，14:05:00 那行就有仓位了；ETH 明明在 14:06 持仓，一行都没有；BTC 14:08:20 才平，14:08:00 那行就已经没有了。这是导出错位和漏行吧？

帮我判断。如果要修正，我的想法是把 exposures 往后挪一分钟对齐 fills、再给 ETH 补一行，然后算平均名义。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
