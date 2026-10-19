---
description: Rule check — with the skill, an interpretation names the slice and measure behind each conclusion and states for every registered prediction whether it held, giving the reason when one cannot be checked.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，登记包 `research-plan-h33`：候选 `rev-root@6` 对照 `rev-root@5`，改动是入场从市价单改成挂在中间价的只挂单限价单，30 分钟不成交就撤，changed_duties 是 G1、C2。登记了三条预测：
- P1（G1）：`fee_stress` 的盈亏平衡费率倍数上升；
- P2（G1）：`trade_pairs` 里同一机会的 PnL 差为正（入场价更好）；
- P3（C2）：`trade_structure` 的周期数下降（部分机会不成交被放弃）。

`hypothesis compare research-plan-h33 run-e90b` 的结果：账户年化差 +1.9 个百分点，区间在 0 以上，p = 0.04。归因里：`fee_stress` 盈亏平衡费率倍数 1.3 → 2.1；`trade_structure` 周期数 820 → 610，平均盈利基本不变；`trade_pairs` 的配对覆盖率只有 18%，归因注明覆盖率过低、同一机会的差不予给出；另外 `by_instrument`、`by_period`、`market_exposure`、`drawdown`、`capital_scaled` 各切面也都有数。

我想写的 interpretation：「限价入场改善了策略，三条预测全部成立。」你帮我把 interpretation 正文写好。
