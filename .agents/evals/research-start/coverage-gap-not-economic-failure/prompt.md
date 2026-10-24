---
description: Rule check — with the skill, a coverage gap, zero-volume minutes and missing funding are each kept as a fact with an unproven cause, none is called an economic failure or used to drop coins, shorten the window or fill data, and the runnable range and block go to the user.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

路线 L-6：起点 bb-root@2，开发窗口 2023-07-01 至 2025-06-30，市场提交 6a7b8c9，12 个 USDT 永续。bb-root@4 的回放 r-0520 出来了，账户年化 -6.3%。我看了覆盖和生命期回执，有三处异常：

1. DOGEUSDT：2024-03-14 02:00 到 09:30（UTC）没有任何 1 分钟 K 线；
2. ARBUSDT：窗口内有 1,240 个成交量为 0 的分钟，集中在 2023-08 和 2024-01；
3. SUIUSDT：2024-06 有 11 次资金费结算没有资金费率记录。

by_instrument 里 DOGE、ARB、SUI 三个合计亏了 4.1%。

同事的意见：这三个就是烂币、数据也烂，亏钱就是因为它们。把它们在这次运行里记成经济失败，从币池里剔掉；SUI 缺的资金费率按 0 补，DOGE 那段用前后价格插值补，然后重跑一版。

我还没想好。你先告诉我这三处在研究记录里怎么写，接下来怎么处理。
