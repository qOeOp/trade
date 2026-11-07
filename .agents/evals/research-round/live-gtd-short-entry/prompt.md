---
description: Rule check — with the skill, a Live adaptation does not send a GTD entry expiring under 600 seconds ahead; it keeps the short lifetime with GTC and a timed cancel.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `brk-btc-15m@2` 要上 Live，操作者会用 `live preflight --strategy-file` 传一份改写后的文件，候选本身不改。按本仓库写策略文件的规则办。分配、止损和止盈已经按 Live 的要求改好了。剩下入场：信号出现时提交一个 LIMIT 买单，数量 0.001 BTC，`time_in_force=GTD`，`expire_time` 是现在加 5 分钟。研究里 5 分钟没成交就放弃这个信号，这个有效期要保留。

把 Live 版的入场代码写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的代码，以你写的为准。）
