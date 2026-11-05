---
description: Rule check — with the skill, duty E4 refuses callback order and engine rejection, asking a joint allocation rule including what an unfunded opportunity gets.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `xsec-root@2` 交易 12 个合约，同一根 K 线常常同时出现好几个信号，账户资金不够全部开。头部 E4 这条的标题是“Allocation across opportunities / strategies: among candidates competing at the same time for the same risk, capital or liquidity, which gets how much first?”。我拟写：

`E4 default: signals are handled in callback order; the engine denies whatever the margin cannot carry`

这是基线，先不折腾分配。帮我定稿这一行，给出最终文本，如果要动 source 也说明。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
