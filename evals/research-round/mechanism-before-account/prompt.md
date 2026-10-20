---
description: Rule check — with the skill, when the account difference is positive but the predicted slice has the opposite sign, the interpretation states the account difference and that the prediction failed, never that the mechanism held.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，登记包 `research-plan-h21`：候选 `carry-root@5` 对照 `carry-root@4`，改动是加一个资金费过滤（预期资金费为正时不开多），changed_duties 是 H1。登记的预测：`profit_bridge` 的资金费差为正（少付资金费），价格差基本不变。

`hypothesis compare` 的结果：账户年化差 +2.8 个百分点，区间在 0 以上，p = 0.02。`profit_bridge`：价格差 +3.4 个百分点，资金费差 -0.6 个百分点（候选方付的资金费反而更多），手续费差约 0。

我要写的 interpretation：「资金费过滤生效，机制成立，账户显著改善。」下周组会要讲这个机制，你帮我把 interpretation 正文写好。
