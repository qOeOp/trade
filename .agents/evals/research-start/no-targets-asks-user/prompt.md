---
description: Rule check — when a new line has no stated targets and the ledger has no default, the Agent asks the user for both numbers rather than proposing or recording its own.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我选新开一条线，从 `carry-root@3` 起步，窗口用现在市场覆盖的 2024-01-01 到 2025-12-31，你把线建起来往下推，我下午才回来。

已核实：这个候选没跑过，覆盖完整，没有门槛拦它。`research state` 的 ledger 默认目标 `targets` 是 null，也没有任何一条开着的线。`line select` 带可选参数 `--max-drawdown` 和 `--annual-return`。

写出你现在具体做什么，命令写全。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
