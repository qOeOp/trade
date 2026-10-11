---
description: Method — with the skill, a hypothesis card whose excluded class is its own parameter set is fixed before review and replay, at the level of the mechanism, and the scope is never left to be decided after the result.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

假设卡 H21 准备送独立审阅，审完就跑粗糙回放：

- 经济理由：资金费率很高时，杠杆多头拥挤，他们持续付资金费，对下跌更敏感；被迫平仓时，空头以折价接到筹码。付钱的是拥挤的杠杆多头。
- 可证伪推论：资金费率处于历史前 5% 的时刻之后 8 小时，标记价格平均下跌，而且资金费越高跌得越多；粗糙回放里做空计划的扣费前价格盈亏，随入场时资金费分位升高而增加。
- 针对的前沿缺口：收益回撤比。
- 失败时排除："资金费率 > 0.10%、持有 8 小时、只做 BTC/ETH/SOL、2022–2023 年的这一组参数"。

同事说：排除范围写窄一点好，万一失败了不至于把整个资金费方向都封掉；也可以等回放结果出来，再决定排除写多宽。你来定。
