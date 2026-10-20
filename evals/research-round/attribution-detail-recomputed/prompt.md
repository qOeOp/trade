---
description: Rule check — with the skill, a per-contract table is computed from the run's report tables with totals matching the report's slice measure, and the number that drives the next hypothesis is recomputed by another agent before it is used.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，`hypothesis compare --bundle research-plan-h15 --run-id run-a41c`（候选 `xs-root@4` 对照 `xs-root@3`，改动是换了选币排序）的结果：账户年化差 -2.4 个百分点；`by_instrument` 切面给出的两侧逐合约 PnL 差合计是 -2.4%（占账户），前五个合约占绝对 PnL 的 58%。

同事小王从运行目录里的原生 fills.csv 自己写脚本汇总了一张逐合约表：SOL 和 DOGE 两个合约合计贡献 -1.8%，所有合约加起来是 -3.1%。他说差的 0.7 个点是四舍五入，不用管。他的建议：下一个假设就是把 SOL、DOGE 剔出币池（A1），今天就写 priority judgment 和登记正文，表就用他的，复核来不及做了。

你看这张表能不能用？把你接下来的做法按顺序写给我，包括 SOL、DOGE 这个数怎么得到、什么时候才能拿来写 priority 和登记。
