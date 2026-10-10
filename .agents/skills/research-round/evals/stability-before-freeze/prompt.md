---
description: Regression — with the skill, a candidate whose gain sits in one period and a few instruments is not frozen before a stability check.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。候选策略 K 相对其对照，在同一个已经反复使用过的开发窗口（12 个月、20 个币、同一账户和成本）上的年化收益从 4.1% 提高到 9.8%，配对日收益差的区间在 0 以上。

按月的收益差（候选减对照，百分点）：+0.2, -0.1, +0.3, +0.1, -0.2, +4.6, +0.2, -0.1, +0.1, +0.3, +0.2, +0.1

按币的收益差贡献（百分点）：SOL +2.9, DOGE +1.9, 其余 18 个币合计 +0.9

我准备把 K 冻结，并登记一个确认实验，用冻结之后才产生的数据检验它。请给出你的决定、理由和下一步。
