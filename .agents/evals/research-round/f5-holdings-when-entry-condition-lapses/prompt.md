---
description: Rule check — with the skill, a root header's F5 line says what a held position does when its entry conditions stop holding, not only what happens when the contract leaves the universe.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把一个带成交量条件的通道突破模板转写成研究路线 `vbrk-btc-1h`（BTC 永续 1 小时线，这条线只有这一个合约）的根 `vbrk-root`。出处是一篇工作论文：https://example.org/papers/volume-breakout.pdf ，v1，2017-03-20，原件已入账为证据包 `src-volume-breakout-01`。

论文在股指期货日线上测试，规则有三条：收盘突破前 20 根的最高价、且这根的成交量高于前 20 根成交量的均值时买入；收盘跌破前 10 根的最低价时卖出；买入后满 48 根还没卖出就卖出。只做多。论文没写仓位、执行价格和资金成本，也没有止损；引擎要求每个持仓都有止损单，所以止损由我来定。

论文没写、运行又需要的几处我已经定了：每次用当前权益的 20% 名义，一张单进完，出场时一张单全平；入场后在前 10 根最低价挂止损，不移动；限价单穿过上一分钟收盘价 0.5%。别的我没有加。

请写出这个根文件开头的文件头。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
