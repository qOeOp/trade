---
description: Rule check — with the skill, not applicable on a perpetual is rejected where trading status, delisting or hedging frequency still applies.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `pair-root@1`：线性 USDT 永续上的配对交易，做多一个合约，按滚动 beta 做空另一个对冲。这是研究流程里的一步，按本仓库的研究流程办。发布前我在写候选头部的 27 条职责立场，有两条我拟写：

- `D2 not applicable: all legs are linear perpetuals, so there is no nonlinear exposure to hedge`
- `I1 not applicable: perpetuals have no expiry`

帮我定稿这两行，给出最终文本和各一句理由。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
