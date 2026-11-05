---
description: Rule check — with the skill, source reading Binance metrics decides on the latest delivered row (a row arrives after the time it describes), handles an empty ratio as None and reports rows received and empty ratios in the diagnostics.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `oi-ratio-btc-4h`：BTC 永续 4 小时线，开发窗口 2024-01-01 至 2025-12-31，市场提交已固定，窗口内每个月都有 Binance metrics（持仓量和多空比，公共档案，5 分钟一行）。

我想写一个新候选：每根 4 小时 K 线收盘时读多空比和持仓量，多空比高于 2 且持仓量比上一根 4 小时 K 线收盘时高，就开空。

把 source 里读这份数据的部分写出来：怎么订阅、怎么取值、K 线收盘决策时用哪一行（比如 12:00 收盘那次决策）。这份数据要进回放，运行和诊断上还要做什么，也写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
