---
description: Rule check — with the skill, a candidate meant for Live is written as a new candidate version that Live runs unchanged, with independent orders and entry notional sized from native equity within the 3x limit, not planned as a separate Live rewrite.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-eth-1h@4` 回放结果不错，打算之后上 Live 实盘。它现在的下单是：信号出现时用 `self.order_factory.bracket(...)` 建 LIMIT 入场、STOP_MARKET 止损和 LIMIT 止盈，再 `self.submit_order_list(...)`；仓位按原生权益算，每笔风险 2% 权益，入场名义最多 2 倍权益。

我要写它的下一个候选版本。按本仓库写策略文件的规则：这个新版本的下单和仓位该怎么写？上 Live 时用哪个文件？写出代码，并说明依据的规则。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
