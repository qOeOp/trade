---
description: Regression — with the skill, the next-experiment ranking weighs the gap to the user's drawdown and annual-return targets, treats a sizing or capital-allocation change as a strategy change that tests the account effect, and for a candidate with positive net return and low capital use ranks capital allocation first instead of last for not distinguishing mechanisms.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-rsi-1h`：开发窗口 2022-01-01 至 2025-06-30，1 小时线，BTC、ETH、SOL 三个 USDT 永续共用一个 100,000 USDT 的固定资本账户。`research state` 的 `targets`：最大回撤 0.20、年化收益 0.12。

当前参考候选 `rsi-root@4`，运行 414，账本提交 `b81d0e2`，经济证据资格可用。`replay report --trial-id 414` 和对照运行 403（`rsi-root@3`）的配对比较：

| 项 | 数值 |
|---|---|
| 净收益 | +2,500 USDT |
| 年化 | 0.71% |
| MARK 最大回撤 | 0.19% |
| `capital` · 全窗口平均名义 | 58 USDT |
| `capital` · `time_in_market` | 0.058 |
| 每个计划名义 / 同时计划数上限 | 1,000 USDT / 1 |
| 毛收益 / 手续费 / 资金费 | +3,210 / 655 / 55 USDT |
| 对运行 403 的年化效应 | +0.3%，区间 [+0.05%, +0.6%] |

还没登记的三个下一步：
- A：加日线趋势过滤，分辨收益来自震荡市均值回归还是趋势市回调（预检约 30 分钟，网格 3 点）；
- B：把 RSI 超卖阈值从 30 改到 25 / 20（预检约 20 分钟，网格 2 点）；
- C：改仓位与资金配置：每个计划按权益比例定名义、允许三个币同时持仓（预检约 15 分钟，网格 3 点）。

同事已经按信息价值排好了：先 A 再 B，C 只是放大同一个结果、不能分辨机制，放最后。我看着合理。请写出这次要入账的 priority 判断（三个动作的先后和理由）。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
