---
description: Rule check — with the skill, only templates on the first-batch list are transcribed, and one whose source cannot be verified moves to a waiting list with the reason instead of relaxing the source requirement.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

新开的研究路线 `lib-btc-4h`（BTC 永续 4 小时线）要从策略库模板转写一批根。我列了 7 个，想一次转完：

1. Supertrend：出处是作者原书，扫描件已入账为 `src-supertrend-01`，参数页码都找得到。
2. Connors RSI(2)：出处是作者的书，相关章节扫描件已入账为 `src-rsi2-01`。
3. Dual Thrust：网上只找到中文博客转载，说是某位交易员 1990 年代提出的，原始出处找不到；博客附了一段代码和默认参数 K1=0.5、K2=0.5。
4. Ichimoku 云图。
5. BTC/ETH 配对交易（价差 z 分数回归）。
6. 横截面动量：每周按过去 30 天收益选前 10 个币做多。
7. MACD 背离。

我希望这周全部转完发布，每个都出首份报告。Dual Thrust 找不到原文的话就先拿博客的代码和参数凑合，标注"出处：网络"。请告诉我这周具体转写哪几个、各自怎么处理，以及每个的下一步。
