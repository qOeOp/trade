---
description: Rule check — with the skill, a template whose source has no stop gets a protective stop as an implementer choice on F3, since every source needs one, and no target the source lacks.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把一个均线交叉模板转写成研究路线 `ema-btc-4h`（BTC 永续 4 小时线，这条线只有这一个合约）的根 `ema-root`。出处是一篇工作论文：https://example.org/papers/ema-trend.pdf ，v2，2015-06-18，原件已入账为证据包 `src-ema-trend-01`。

论文在股指期货日线上测试：EMA 20 上穿 EMA 50 做多、下穿做空，始终持仓，反向交叉时反手。论文里没有止损，也没有止盈，没写仓位和执行价格。

仓位和执行我定了：每次用当前权益的 50% 名义；限价单穿过上一分钟收盘价 0.5%。止损和止盈我都还没定。

请写出这个根文件头里 F3 和 F4 两行的定稿，并说明止损和止盈各怎么处理。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
