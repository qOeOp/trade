---
description: Rule check — with the skill, an entry size cap on volume uses a window longer than one minute, because a one-minute cap makes the position a random function of one minute's volume, and the excess is not carried to later entries.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `alt-mom-1h`，`--execution bars`，这是研究流程里的一步，按本仓库的研究流程办。为了成交量现实一点，我要限制每笔入场不超过成交量的 1%。常量放文件里。写法上：每次下单用下单前最后一根已收盘 1 分钟 K 线的成交量算上限，超过上限时的处理你定。

把这段写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
