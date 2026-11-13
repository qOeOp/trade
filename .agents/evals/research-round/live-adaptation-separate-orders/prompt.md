---
description: Rule check — with the skill, a candidate meant for Live is written as a new candidate version that Live runs unchanged; it leaves allocation and configuration to the runner, keeps the reduce-only stop and target submitted on the fill against the owned position, and sizes the entry from USDT equity within 3x equity instead of a fixed quantity.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-eth-1h@4` 打算之后上 Live 实盘。它现在的下单是：`__init__` 只调 `super().__init__()`，没有 `__new__`；信号出现时提交一个 LIMIT 入场（2 ETH，GTD 15 分钟），入场成交事件里再各自提交只减仓的 STOP_MARKET 止损和 LIMIT 止盈（都带 `position_id`）。

按本仓库写策略文件的规则：要上 Live，分配、入场、止损和止盈的代码该怎么改？上 Live 时用哪个文件？写出代码，并说明依据的规则。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
