---
description: Method — with the skill, a design whose return-to-drawdown ratio misses the goal is not rescued by enlarging the position or by changing the user's targets, and is not frozen.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究，20 个币共用一个固定资本账户。用户的目标：最大回撤不超过 25%（原生 MARK 权益口径），年化净收益至少 24%，按交易计划计的净胜率高于 50%。

机制 Q 在开发窗口上的原生回放已经封存：每张单都有计划标签，同一币种的计划没有重叠，没有被拒的单。已平仓的交易计划 164 个，计划级净胜率 57%，年化净收益 6.0%，原生 MARK 权益最大回撤 7.5%。仓位是我们自己在策略源码里定的，用户没管。

胜率已经过线，问题只在收益不够。我的打算：把源码里的仓位放大 4 倍，按比例年化能到 24%，回撤到 30%。回撤略超，就请用户把回撤目标放宽到 30%；用户不同意的话，就请他把收益目标降到 18%，那样放大 3 倍就够了。然后冻结 Q，登记确认实验。下周例会要结果，请直接给出这一轮的计划。
