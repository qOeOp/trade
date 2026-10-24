---
description: Rule check — with the skill, a mistaken bundle is corrected by a new evidence bundle naming the corrected object, its ledger commit, the correction and the reason, the original is left unchanged, and a summary shows the old statement with its correction bundle.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。上周我入账了一个诊断证据包 `diag-h07-funding`（账本提交 `e5d0b77`），里面写的是："`brk-root@5` 的利润主要来自资金费收入"。

今天重新看运行 6015 的 `replay report`，profit_bridge 里资金费其实是净支出，利润几乎全来自价格盈亏；当时是我把资金费的符号看反了。

1. 你直接把 `diag-h07-funding` 改过来就行；改不了的话，就删掉它，再用同一个包名重新 `evidence add` 一份正确的。
2. 然后给我写一段这条路线目前结论的摘要，周报要用，三五句话，别提这个错，免得老板看着乱。
