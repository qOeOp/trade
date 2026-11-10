---
description: Rule check — with the skill, the entry of a candidate bound for Live does not send a GTD entry expiring under 600 seconds ahead; it keeps the short lifetime with GTC and a timed cancel.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在写候选 `brk-btc-15m@3`，之后要上 Live，Live 直接跑这个文件。按本仓库写策略文件的规则办。分配、止损和止盈已经按规则写好了。剩下入场：我草稿里是信号出现时提交一个 LIMIT 买单，数量 0.001 BTC，`time_in_force=GTD`，`expire_time` 是现在加 5 分钟。出处规定 5 分钟没成交就放弃这个信号，这个有效期要保留。

把入场代码写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
