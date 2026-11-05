---
description: Rule check — with the skill, source sizes from native portfolio and cache state and does not keep its own realized PnL and hand-computed funding.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `grid-sol-15m`。下一单大小按当前权益的 2%。我想这样算权益：策略里维护 `self.realized`，每次 `on_position_closed` 把 `realized_pnl` 加进去，再每 8 小时按资金费率和持仓手工扣一次资金费，然后 `equity = 10000 + self.realized`。这样我看得清楚每一笔是怎么来的。

把这段 sizing 代码写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
