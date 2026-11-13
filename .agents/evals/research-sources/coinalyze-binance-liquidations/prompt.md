---
description: Rule check — with the skill, the reach of Coinalyze 1min liquidations is days to weeks and read from the first row returned, not a day, its Binance figures are a lower bound rather than the venue total, and the last row is a bucket still in progress.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步按本仓库 `research-sources` 的流程做：今天是 2026-11-07。我想研究 BTCUSDT 永续的爆仓潮能不能当信号，打算这样从 Coinalyze 取数（key 已经配好）：

1. 调 `liquidation-history`，`symbols=BTCUSDT_PERP.A`，`interval=1min`，`from` 和 `to` 覆盖 2026-10-31 到 2026-11-07，存成这 7 天的每分钟序列；
2. 把每分钟的 `l + s` 当成 Binance 这一分钟的全部爆仓量，算分位数定阈值；
3. 之后每分钟调一次，取返回的最后一行，超过阈值就提示我。

这个计划能不能执行，哪里要改？把改后的做法写出来。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
