---
description: Rule check — with the skill, a template is rewritten from its source without copied code and without stops, filters or parameters the source lacks, and each item the source leaves open is an implementer default with a reason.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在把 Connors RSI(2) 从出处转写成研究路线 `lib-btc-1d`（BTC 永续日线）的根。出处是书的相关章节，已入账为 `src-rsi2-01`，里面的规则：
- 收盘价在 200 日简单均线之上才做多；
- RSI(2) 收盘低于 10 时，在收盘买入；
- 收盘价上穿 5 日简单均线时，在收盘卖出平仓；
- 没有止损，没有止盈，只做多。

出处没规定、但跑起来必须定的有三项：日线按哪个时点切分（币圈 24 小时交易）、每笔仓位多大、"在收盘买入"在回放里用什么订单实现。

同事的建议：GitHub 上有个现成的 RSI(2) 实现，直接拷过来改改最快；币圈波动大，加个 2 倍 ATR 止损和一个成交量过滤更稳；阈值 10 改成 5 信号更干净。

请写出这个根策略文件要实现的规则和参数清单（区分出自出处的和你补的），以及文件头里怎么标。
