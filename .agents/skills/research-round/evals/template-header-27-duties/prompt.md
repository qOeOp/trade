---
description: Rule check — with the skill, a root's header starts with the verifiable source and its bundle, then gives all 27 duty lines with a source label each, labelling rules carried to another market or timeframe as 研究者.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把 EMA 交叉模板转写成研究路线 `lib-btc-4h`（BTC 永续 4 小时线）的根 `ema-root`。出处是一篇工作论文：https://example.org/papers/ema-cross.pdf ，v3，2016-03-02，原件已入账为证据包 `src-ema-cross-01`。论文在标普 500 股指期货日线上测试：EMA 20 上穿 EMA 50 做多、下穿做空，始终持仓，反向交叉时反手；论文没写仓位、执行价格和保证金。

请写出这个根文件开头的文件头。同事说 27 行太啰嗦，只写用到的几行，其余省略就行；来源栏全部写"出处"也可以，反正规则都是从论文来的。
