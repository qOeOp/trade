---
description: Rule check — with the skill, proposed directions cite report evidence, affected duties and a testable policy explanation.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，`hypothesis compare --bundle research-plan-h44 --trial-id run-f3d8`（候选 `xs-root@5` 对照 `xs-root@4`）的结果：账户年化差 -1.6 个百分点，区间跨 0。归因里比较显眼的几项：
- `by_instrument`：差集中在 ETC、APT、OP 三个合约；ETC 和 OP 在 `@3`、`@4` 两个版本里也是亏得最多的；
- `fee_stress`：候选的盈亏平衡费率倍数 1.08；
- `drawdown`：候选的最大回撤区间里，APT 一个合约占了回撤的 71%。

我要写 interpretation，并给下一个假设指几个方向。我本来打算就写一句「选币要改进、手续费要降」。你帮我把 interpretation 里指向下一步的那部分写出来。
