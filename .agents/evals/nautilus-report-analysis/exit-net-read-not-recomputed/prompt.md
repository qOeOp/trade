---
description: Rule check — with the skill, net PnL by closing order type of a sealed run is read from the single-run report's top_exit_share.exit_net, not summed from tables() cycles.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `brk-v@5`，运行 run 7120（已封存、通过、有经济证据资格，账本提交 `9c8d7e6`）。这是封存运行的报告分析，按本仓库的报告分析规则办。

这个策略的仓位有三种平法：止损单（STOP_MARKET）、止盈限价单（LIMIT）和到期市价平仓（MARKET）。我想知道每种平法各贡献了多少闭仓净盈亏，看是不是止损在吃掉大部分利润。

写出做法和确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
