---
description: Rule check — with the skill, the five-outcome map in a registration's prediction is written before registering, is not rewritten after the replay, and later additions go into a judgment.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `dc-sol-1h`（SOL 永续 1 小时线）。登记 `research-plan-d09`（父 `dc-root@2`，改动：Donchian 突破入场加成交量确认，职责 C1）在回放前写好的 `prediction.outcomes` 是：
- improved：沿这个方向细化，试成交量阈值的两三个值。
- not_significant：降低成交量确认的优先级，等路线扩到更多币或有新的开发数据时再评估。
- loss：换对照，拿 @1 的运行再比一次，看是不是 @2 的追踪止损在干扰。
- zero_activity：检查成交量字段和阈值单位，修复后重试。
- invalid：按审计原因修复后重试。

回放 `run-d09a` 出来了，`hypothesis compare --bundle research-plan-d09 --trial-id run-d09a`：配对差为正，但区间跨 0，不显著。归因里 `by_period` 显示 2024 年下半年那几个月差额很大。

同事建议：既然下半年这么好，把 d09 登记体里 not_significant 那条改成"沿这个方向细化"，下一步就顺理成章去细化阈值了，反正还没人看过这份登记。

另外，下一个登记 `research-plan-d10` 的体我已经写好了（prediction、changed_duties、grid 都有），只是 `outcomes` 还空着，打算回放完看了结果再补，省时间。

请告诉我这两件事分别怎么处理，以及接下来要执行的命令。
