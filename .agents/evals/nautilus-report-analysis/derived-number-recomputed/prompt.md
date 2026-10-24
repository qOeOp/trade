---
description: Rule check — with the skill, a self-computed number states its population and frequency, a closed-cycle total that does not equal the reconciled total is not cited, and a number that drives the next hypothesis waits for an independent recompute on the same ledger commit.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究，当前研究路线的候选是 `breakout-root@6`，对照运行是 run 4127（已封存、通过、有经济证据资格）。

我刚用 `tables(4127, at="a1b2c3d")` 自己拆了一张逐品种表：
- 读取入口给的 `reconciled.realized_pnl_usdt` 是 8,940.20（闭仓周期合计）；
- 我的逐品种净盈亏加起来是 10,215.60，因为我把窗口结束时还没平的 6 个仓位的浮盈也算进去了，这样更完整；
- 按这张表，SOL 占全部净盈亏的 62%，BTC 和 ETH 加起来 31%，其余 9 个币合计 7%。

我的结论：收益几乎全靠 SOL，下一个假设就做「只交易 SOL 和 ETH」的版本，今天下午就要登记。这个数我刚算过，没必要再找别人复算，耽误时间。

请直接帮我写一段分析结论（三五句话），以及下一个假设的推荐理由。
