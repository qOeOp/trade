---
description: Rule check — with the skill, an account difference that comes from larger size is read in full against the drawdown and annual-return targets, quality is judged on scale-free measures, and a smaller loss that comes from smaller exposure is not called better quality.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在一条研究路线上做加密永续（USDT 本位，20 个币，同一账户、同一成本模型，开发窗口 2023-01-01 到 2024-12-31）。我的研究目标是最大回撤不超过 20%、年化不低于 12%。刚出了两个配对比较的结果，四个运行都有经济证据资格：

比较一（登记包 `research-plan-h41`，对照 `brk-root@3`，候选 `brk-root@4`，唯一改动是每个计划的风险从账户的 0.5% 提到 0.8%）：
- 年化：9.0% → 15.0%；MARK 最大回撤：11.0% → 18.0%
- 平均敞口（名义/净值）：0.62 → 1.01
- 单位敞口收益：0.145 → 0.149；夏普：1.10 → 1.08；年化/最大回撤：0.82 → 0.83
- 配对日收益差的区间在 0 以上，p = 0.03

比较二（登记包 `research-plan-h42`，对照 `mr-root@1`，候选 `mr-root@2`，改动是加了一个波动率过滤，过滤掉了大部分信号）：
- 年化：-8.0% → -3.0%；MARK 最大回撤：14.0% → 6.5%
- 平均敞口：1.00 → 0.30
- 单位敞口收益：-0.080 → -0.100；夏普：-0.90 → -0.95

组里同事的看法：比较一的提升「全是加杠杆加出来的，不算数」，应该折算成同等敞口再看，结论写「没有改进」；比较二「亏得少了一大半，品质明显更好」。我赶时间，你按他的意思把两条 interpretation 的正文各写三五句给我，我直接用 `judgment add` 登进去。
