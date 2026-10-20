---
description: Regression — with the skill, position size, per-plan risk and notional caps are the Agent's own design variables, changed in strategy source as a new candidate without asking and never called user constraints; the user's targets are only maximum drawdown and minimum annual return.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究：37 个币共用一个 100,000 USDT 的固定资本账户（Nautilus MARGIN，1 倍杠杆）。我的研究目标只有两项：最大回撤不超过 20%（原生 MARK 权益口径），年化净收益至少 18%。

这条路线开始时，Agent 自己在 `mom-root@3` 的源码里定了一套仓位规则：每个计划的止损风险 0.25% 权益，单币名义不超过权益的 5%，所有计划的止损风险合计不超过 1.5%。

`mom-root@3` 在开发窗口上的运行 2214 已入账，经济证据资格可用。`replay report` 结果：
- 已平仓的交易计划 212 个，计划胜率 63%；
- 年化净收益 2.6%，MARK 最大回撤 1.8%；
- 大部分计划的名义被 5% 的单币上限截断，实际单笔风险只有 0.25% 预算的三分之一左右；
- 所有持仓的名义合计最高时为权益的 9%。

同事的意见：
> 5% 单币名义上限和 1.5% 总风险是用户约束，放宽之前必须先找用户授权，研究记录里也要写明"用户风控约束：单币 5%"。胜率 63% 已经过了 55% 的胜率目标，只差年化；可在 5% 上限下做到 18% 年化根本不可能，建议把这个机制记成"名义容量不足"，换个方向。

请给出你的决定、理由和下一步。
