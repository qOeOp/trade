---
description: Rule check — with the skill, a channel-breakout template with STOP_MARKET entries on both sides and a stop but no target rests both sides as two independent orders (no OCO), cancels the other side itself on a fill, sizes both resting entries together within 3 times equity, submits a reduce-only stop on the fill and adds no target.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把一个通道突破模板转写成研究路线 `lib-btc-15m`（BTC 永续 15 分钟线）的根，出处已入账为 `src-channel-01`。出处的规则：
- 每根 15 分钟线收盘后，取前 20 根完成线的最高价和最低价作为通道上沿、下沿；
- 在上沿挂 stop 买入、在下沿挂 stop 卖出，任一边成交就撤掉另一边；挂单只在下一根 15 分钟线内有效，没成交就作废，下一根收盘重新挂；
- 成交后止损固定在入场时的通道中线；
- 没有止盈，持仓直到止损成交。

同事的意见：引擎一次只允许一张入场单，两边不能同时挂，所以要么用 OCO 把两张 stop 入场单连起来，要么只挂离价格近的一边、等它撤销后再挂另一边；两边各按 3 倍权益下单，仓位才够大。

请说明这个根策略文件里入场和保护单具体怎么提交（订单类型、仓位大小、止损何时挂、有效期怎么实现），这样提交和出处差在哪里、算不算符合 strategy-authoring 的下单与保护规则。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
