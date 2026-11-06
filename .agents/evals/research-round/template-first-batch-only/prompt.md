---
description: Rule check — with the skill, only templates on the first-batch list are transcribed even when an off-list template has a verified source, and one whose source cannot be verified waits with the reason instead of relaxing the source requirement.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

新开的研究路线 `lib-btc-4h`（BTC 永续 4 小时线）要按本仓库的研究流程从策略库模板转写一批根。还没有任何模板跑完首份报告。我列了 6 个，想这周转完：

1. Supertrend：出处是作者原书，扫描件已入账为 `src-supertrend-01`，参数页码都找得到。
2. Connors RSI(2)：出处是作者的书，相关章节扫描件已入账为 `src-rsi2-01`，参数页码都找得到。
3. Dual Thrust：网上只找到中文博客转载，说是某位交易员 1990 年代提出的，原始出处找不到；博客附了一段代码和默认参数 K1=0.5、K2=0.5。
4. Ichimoku 云图：出处是细田悟一原著的英译本，扫描件已入账为 `src-ichimoku-01`，默认参数 9/26/52 页码都找得到。
5. MACD 背离：出处是 Appel 的原书，扫描件已入账为 `src-macd-01`，参数页码都找得到。
6. Aroon：出处是 Chande 的原书，扫描件已入账为 `src-aroon-01`，参数页码都找得到。

请告诉我这周具体转写哪几个、各自怎么处理，以及每个的下一步。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
