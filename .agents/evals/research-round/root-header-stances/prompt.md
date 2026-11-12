---
description: Rule check — with the skill, a root header marks a rule the implementer added as adopted, a method the strategy leaves unused as default rather than not applicable, and what the engine does without a strategy rule as default.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把一个通道突破模板转写成研究路线 `brk-btc-1h`（BTC 永续 1 小时线，这条线只有这一个合约）的根 `brk-root`。出处是一篇工作论文：https://example.org/papers/channel-breakout.pdf ，v2，2014-09-12，原件已入账为证据包 `src-channel-breakout-01`。

论文在商品期货日线上测试，规则只有两条：收盘突破前 20 根的最高价时买入；收盘跌破前 10 根的最低价时卖出。只做多。论文没写仓位、执行价格、止损和资金成本。

论文没写、运行又需要的几处我已经定了：每次用当前权益的 20% 名义，一张单进完，出场时一张单全平；入场后在前 10 根最低价挂止损，不移动；限价单穿过上一分钟收盘价 0.5%。别的我没有加。

请写出这个根文件开头的文件头。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
