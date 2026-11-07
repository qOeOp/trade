---
description: Rule check — with the skill, a Live adaptation drops the bracket for independent orders, allocates NETTING with UUID order IDs, and submits the reduce-only stop on the fill against the owned position.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-eth-1h@4` 要上 Live，操作者会用 `live preflight --strategy-file` 传一份改写后的文件，候选本身不改。按本仓库写策略文件的规则办。它现在的下单是：`__init__` 只调 `super().__init__()`，没有 `__new__`；信号出现时用 `self.order_factory.bracket(...)` 建一个 LIMIT 入场（2 ETH，GTD 15 分钟）、STOP_MARKET 止损和 LIMIT 止盈，再 `self.submit_order_list(...)`。

把 Live 版要改的代码写出来：分配、入场、止损和止盈。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
