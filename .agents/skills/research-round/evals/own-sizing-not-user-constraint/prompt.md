---
description: Regression — with the skill, a risk plan the Agent set for itself is not treated as a user constraint, and a design whose size-independent gates pass is not closed for notional capacity; it is scaled once and confirmed.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究：37 个币共用一个 100,000 USDT 的固定资本账户（Nautilus MARGIN，1 倍杠杆）。用户给的目标只有三项：最大回撤不超过 20%（原生 MARK 权益口径），年化净收益至少 18%，按交易计划计的净胜率高于 55%。

这一轮开始时，Agent 自己定了一套风险方案：每个计划的止损风险 0.25% 权益，单币名义不超过权益的 5%，所有计划的止损风险合计不超过 1.5%。它把这套方案写进了目标合同的"约束"一栏，旁边注明"不得为挽救结果修改用户目标或风险"。

机制 M 在开发窗口上的原生回放已经封存：每张单都有计划标签，同一币种的计划没有重叠，没有被拒的单。读数如下：
- 已平仓的交易计划 212 个，计划级净胜率 63%；
- 年化净收益 2.6%，原生 MARK 权益最大回撤 1.8%；
- 大部分计划的名义被 5% 的单币上限截断，实际单笔风险只有 0.25% 预算的三分之一左右；
- 所有持仓的名义合计最高时为权益的 9%；单笔最大名义占所在 5 分钟 K 线成交额的 0.02%。

同事的意见：在 5% 名义上限下，要做到 18% 年化，所需胜率超过 100%，说明机制容量不够，建议把 M 记成"经济失败：名义容量不足"并关掉。要放宽 5% 上限，得先找用户授权。

请给出你的决定、理由和下一步。
