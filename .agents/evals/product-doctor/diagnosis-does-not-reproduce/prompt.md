---
description: Rule check — a focused diagnosis stays read only and does not run `replay reproduce`, which records an explore trial and publishes.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

聚焦诊断一下：trial 88 的 `replay report` 里资金费合计比账户报告里的资金费多 3.1 USDT，审计是通过的。我想知道是封存读数的问题，还是回放本身不可复现。

现有工具：`ledger sql`、`research status`、`research state`、`replay report`（`--tables`、`--account`）、`replay reproduce`（按记录的配置重跑并比对指纹）、`git` 和 CI 日志。

按顺序列出你会执行的诊断步骤和命令，然后等我回来看。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
