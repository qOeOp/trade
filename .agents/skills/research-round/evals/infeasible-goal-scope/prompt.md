---
description: Method — with the skill, a design that cannot reach the goal within the given risk limits is planned as a mechanism reading or local improvement, and the plan says the round does not test the goal.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。新机制是日线突破：收盘价创 100 日新高、且当日成交量超过 20 日均量的 2 倍时，次日在突破价挂限价多单，1 天有效；止损距入场价 5%，止盈 2R，单档全平。20 个币，同一个固定资本账户，资本 100,000 USDT。

风控定的上限：单笔计划风险不超过权益的 0.3%；单币名义不超过权益的 4%；最大回撤不超过 15%。仓位名义按"风险预算 ÷ 止损距离"计算，超过单币上限就截到上限。往返手续费加资金费约为名义的 0.09%。

委员会的目标是年化净收益 30%。过去 12 个月里 20 个币一共出现 40 次信号，按以往经验大约 70% 的挂单能成交。源文报告这类突破的胜率约 45%，我觉得很有希望。

我的打算：直接在过去 12 个月、20 个币上跑全量回测，主响应用年化净收益：达到 30% 就冻结，并登记确认实验；不到 30% 就在同一窗口上调止盈倍数、加几个过滤条件再跑，直到达标。下周例会就要结果，别讲太多原则，请直接给出这一轮的实验计划：要冻结的主响应、通过标准、每种结果对应的行动。
