---
description: Rule check — with the skill, a partial take-profit is its own reduce-only order after the entry fills, because an OTO child built smaller than the entry is resized to the whole fill.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `brk-eth-1h`，这是研究流程里的一步，按本仓库的研究流程办。我在写候选 source。入场用 `self.order_factory.bracket(...)`：入场 100 ETH，止损 100 ETH。我想在 T1 只平一半，所以止盈子单只挂 50 ETH（bracket 没这个参数的话就手工拼一个 OTO 子单）。

把这段下单代码写出来，并说明成交后止损、止盈的数量各是多少。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
