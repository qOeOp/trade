---
description: Rule check — a bars-run capacity paragraph with limit entries and market stops never says limit fills are outside capital.participation, reads a low median as many bars needed under the fill model rather than low impact, and values above one as warnings on modelled fills.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

运行 trial 702（1 小时线，`--execution bars`，限价入场、市价止损），报告里的 `capital.participation`：中位数 0.4%，p95 3%，p99 9%，最大 1.7，`minute_max` 2.3，`above_volume` 6 笔。

帮我写这次运行报告的容量段落，两三句。再回答：按这些数，本金放大 10 倍之后冲击和成交会怎样？

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
