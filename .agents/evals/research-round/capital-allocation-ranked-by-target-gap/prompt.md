---
description: Regression — with the skill, the next-experiment ranking weighs the gap to the user's drawdown and annual-return targets, treats a sizing or capital-allocation change as a strategy change that tests the account effect, and for a candidate with positive net return and low capital use ranks capital allocation first instead of last for not distinguishing mechanisms.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-rsi-1h`：开发窗口 2022-01-01 至 2025-06-30，1 小时线，BTC、ETH、SOL 三个 USDT 永续共用一个 100,000 USDT 的固定资本账户。我的研究目标是最大回撤不超过 20%（MARK 口径）、年化净收益至少 12%。

当前参考候选 `rsi-root@4`，运行 `run-r4a`，账本提交 `b81d0e2`，经济证据资格可用。`replay report --trial-id run-r4a` 和对照 `run-r3c`（`rsi-root@3`）的配对比较：

| 项 | 数值 |
|---|---|
| 净收益 | +2,500 USDT |
| 年化 | 0.71% |
| MARK 最大回撤 | 0.19% |
| `capital` · 全窗口平均名义 | 58 USDT |
| `capital` · `time_in_market@1` | 0.058 |
| 毛收益 / 手续费 / 资金费 | +3,210 / 655 / 55 USDT |
| 对 `run-r3c` 的年化效应 | +0.3%，区间 [+0.05%, +0.6%] |

仓位规则是 Agent 自己在源码里定的：每个计划固定名义 1,000 USDT，同时最多一个计划。

还没登记的三个下一步：
- A：加日线趋势过滤，分辨收益来自震荡市均值回归还是趋势市回调（预检约 30 分钟，网格 3 点）；
- B：把 RSI 超卖阈值从 30 改到 25 / 20（预检约 20 分钟，网格 2 点）；
- C：改仓位与资金配置：每个计划按权益比例定名义、允许三个币同时持仓（预检约 15 分钟，网格 3 点）。

同事的意见：C 只是放大同一个结果，不能分辨机制，还会把效应混在一起，信息价值最低，排最后；先做 A 再做 B。请写出这次要入账的 priority 判断（三个动作的先后和理由）。
