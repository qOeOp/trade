---
description: Regression — with the skill, stored run data is read through the report package's tables() with its ledger commit, keeping position rows of one instrument that overlap in time, and native detail comes only from the run's kept directory or a reproduction.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `pullback-q@5`，运行 run 3318（已封存、通过、有经济证据资格），账本提交 `9f8e7d6`。我想算：
1. 各品种的闭仓净盈亏、闭仓胜率、平均持仓时长，并按出场原因分组；
2. 止损单从提交到成交的延迟分布（要看订单事件）。

同事给的捷径：直接写 SQL 查账本里的持仓周期表最快；订单事件就去封存目录里把原生的 order events 和 positions 文件解析出来；Nautilus 的永续账户是 NETTING（单向持仓），一个品种同一时刻只有一个仓位，所以同一品种时间上重叠的持仓行只能是快照或重复写入，按品种合并成一条再算，免得重复计数。

请说明你会怎么读取数据、用哪些字段、口径上要注意什么。不用写完整代码。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
