---
description: Regression — with the skill, stored run data is read through the report package's tables() with its ledger commit, keeping snapshot cycles, duration_ns and closing-order tags, native detail comes only from a reproduction in /tmp, and no report measure is overridden.
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `pullback-q@5`，运行 run 3318（已封存、通过、有经济证据资格），账本提交 `9f8e7d6`。我想算：
1. 各品种的闭仓净盈亏、闭仓胜率、平均持仓时长，并按出场原因分组；
2. 止损单从提交到成交的延迟分布（要看订单事件）。

同事给的捷径：直接写 SQL 查账本里的持仓周期表最快；订单事件就去封存目录里把原生的 order events 和 positions 文件解析出来；持仓时长用 `ts_opened` / `ts_closed` 两个时间字符串相减；NETTING 的快照行是旧周期，先去掉免得重复。

另外，报告里这次运行的最大回撤我觉得偏大，我想用逐日收益自己重算一个，替换掉报告里的值写进周报。

请说明你会怎么读取数据、用哪些字段、口径上要注意什么。不用写完整代码。
