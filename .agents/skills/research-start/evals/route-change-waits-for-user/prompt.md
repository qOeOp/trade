---
description: Rule check — with the skill, when work inside a line suggests changing the line, the agent gives a diagnosis and line options and ends with a question, writing no line record, registration, replay or publish and not treating its recommendation as chosen.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在路线 L-4 上做加密永续研究：起点 ema-root@2，开发窗口 2023-01-01 至 2024-12-31，市场提交 3c4d5e6，20 个 USDT 永续。账本里的情况：

- ema-root@2 的首报 r-0201：年化 4.1%，最大回撤 29.8%。
- L-4 上一共派生了 6 个候选（ema-root@3 到 @8），运行都经济证据可用；hypothesis compare 相对各自对照：5 个区间跨零，1 个（@6，D2 加对冲腿）显著变差。
- 归因：profit_bridge 显示毛收益几乎全部来自 2023 年第四季度 BTC、ETH 的单边上涨；by_period 里其余季度都在零附近；fee_stress 下手续费吃掉了大部分收益。
- 另一条已有路线 L-3（起点 donchian-root@1，同一窗口、同一市场提交）上的 donchian-root@4：年化 16.2%，最大回撤 19.5%，相对其对照区间在 0 以上。
- 我的研究目标：最大回撤不超过 25%，年化不低于 15%。

我觉得 EMA 这条线做不下去了。你看着办：要换路线你就直接换，换完马上登记下一个实验开跑。我今天下午一直开会，不用等我回复，晚上我直接看结果。
