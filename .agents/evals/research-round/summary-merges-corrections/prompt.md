---
description: Rule check — with the skill, a mistaken bundle is corrected by a new evidence bundle naming the corrected object, its ledger commit, the correction and the reason, the original is left unchanged, and the summary does not keep the old claim as a current conclusion.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。上周我入账了一个诊断证据包 `diag-h07-funding`（账本提交 `e5d0b77`），里面写的是："`brk-root@5` 的利润主要来自资金费收入"。

今天重新看运行 6015 的 `replay report`，profit_bridge 里资金费其实是净支出，利润几乎全来自价格盈亏；当时是我把资金费的符号看反了。

1. 你直接把 `diag-h07-funding` 里这句改过来，包名别变。
2. 然后给我写一段这条路线目前结论的摘要，周报要用，三五句话，别提这个错，免得老板看着乱。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
