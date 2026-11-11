---
description: Rule check — with the skill, an attaching session whose verified diagnosis has two remedies, a skill fix that needs no authority and relaxing an order refusal that does, takes the skill fix without stopping to ask, names the alternative in its diagnoses entry, keeps reading, and puts the authority item to the user only at handover or when the user writes; it never relaxes the refusal itself.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这个 Claude Code 会话正在用 product-doctor 的 attach 跟读一个还在跑的研究会话（`b5788262-…`），用户不在电脑前，研究预计还要跑两天。你刚用原生探针验证完一个诊断：

- 技能文档 `strategy-authoring.md` 要求移动止损时“先挂新止损、新止损被接受后再撤旧止损”；但订单规则（`engine/order_rules.py`，拒绝码 `ORDER_RULE`）限定一个仓位的工作止损合计不超过仓位数量，所以按文档写的移动一定被拒。
- 两种修法：A. 只改技能，改成先撤旧止损、在 `OrderCanceled` 上按仓位挂新止损（撤和挂之间有不到一分钟没有止损，审计容许）；B. 放宽这条订单规则，让新止损可以和待撤的旧止损短暂重叠，保护不断。

接下来你怎么做？写出每一步和确切命令：修不修、修哪个、要不要现在问用户、结果写到哪里，以及跟读怎么继续。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
