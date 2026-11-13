---
description: Rule check — with the skill, sizing each of ten contracts at half of portfolio equity is met with the fact that all instances share one account and the source needs a stated allocation.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `xsec-10`，十个 USDT 永续合约，一小时 K 线。策略每个合约各自判断信号，满足就开仓。我打算每个合约的开仓名义都是 `self.portfolio.equity` 的 50%，这样单合约的收益够大。

把这段 sizing 写出来，并说明这份 source 在资金上还要写什么，运行时账户是怎么安排的。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
