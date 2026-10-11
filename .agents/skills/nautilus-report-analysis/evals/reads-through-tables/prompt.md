---
description: Regression — with the skill, stored run data is read through the tables loader, keeping snapshot cycles, exact close times and closing-order tags.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我要从这个仓库研究账本里一次已入库的原生回测（有 run ID）算三样东西：各品种的闭仓净 PnL、闭仓胜率、平均持仓时长，并且按出场原因分组。

请说明你会怎么读数据、用哪些字段、口径上要注意什么。不用写完整代码。
