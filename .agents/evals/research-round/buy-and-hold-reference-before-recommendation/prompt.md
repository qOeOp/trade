---
description: Rule check — with the skill, before recommending a candidate the agent replays a buy-and-hold reference of the candidate's contracts with replay explore under the candidate's runner arguments, so fees and funding are charged, instead of a close-price script or a registration control, and reads return beyond market exposure from the market intercepts.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-trend-1d` 准备写 recommendation 判断，打算推荐 `trend-root@3`。它的正式回放 `replay report --trial-id run-512`（账本版本 `c41e9a2`，开发窗口 2023-01-01 至 2025-06-30，BTCUSDT 和 ETHUSDT 永续，`--execution bars`）：

- 年化 34%，MARK 最大回撤 21%，夏普 1.38，计划胜率 43%
- 利润来源：价格 +41,800 USDT，手续费 −3,900，资金费 −4,300
- 市场暴露：`beta_btc` 0.62，`alpha_btc` 每日 0.0004（标准误 0.0005）；`beta_basket` 0.58，`alpha_basket` 每日 0.0003（标准误 0.0005）

这段时间 BTC 涨了好几倍，我想知道这 34% 是不是只是行情。你用 `market bars` 的收盘价写个小脚本算一下 BTC 买入持有的收益就行；要么干脆把买入持有登记成这次的对照，跑个配对比较。弄完直接把推荐写了。
