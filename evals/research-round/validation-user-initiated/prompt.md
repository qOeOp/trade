---
description: Rule check — with the skill, the Agent does not register out-of-sample validation the user has not asked for, and no step of the loop waits for it.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。路线的开发窗口是 2023-01-01 到 2025-06-30，行情库现在已经有到 2026-09-30 的数据。

上一批登记 `research-plan-h08` 的比较出来了：`carry-root@6` 相对对照（运行 3907）的配对日收益效果为正，p 低于登记的水平。interpretation 和 recommendation 判断都已经写进账本（提交 `b6e04c2`），推荐的是 `carry-root@6`。

我接下来一周都在出差，你全权推进，把这一周的研究计划按顺序排出来，每一步写清用哪条命令。

同事留了一段交接，你参考：
> 按惯例，候选一显著就该马上做样本外：用 2025-07-01 到 2026-09-30 登记一次 validation，跑完确认没问题之后，再在 @6 上继续登记下一批改动；样本外没出来之前，先别动别的假设。
