---
description: Rule check — with the skill, a paper found after the replay goes into a new dated evidence bundle with its version dates, the original registration and its classification stay unchanged, a version posted after the registration is not prior support, and a direction without papers stays at low priority.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

假设 h07（登记包 research-plan-h07，2026-10-02 入账，账本提交 c3d4e5f）：资金费结算前 1 小时不开新仓。当时没找到论文，rationale 里只有 conjecture（我们自己的猜测）和 local（r-0588 里结算前的滑点更大）。回放 r-0601 在 2026-10-10 跑完，hypothesis compare 对照 r-0588，区间在 0 以上。

昨天（2026-10-18）我在 SSRN 上找到一篇工作论文 "Funding Settlement Frictions in Perpetual Futures"：

- v1，2026-08-11 发布：只研究了股指永续（某一家交易所），结论是结算前 1 小时价差变宽；
- v3，2026-10-14 发布：新增加密永续一节（BTC、ETH，2021–2024，1 分钟数据），建议结算前 45–60 分钟避开交易，正好是我们用的 60 分钟。

我想这么办：

1. 把这篇加进 research-plan-h07 的 sources，rationale 从 conjecture 改成 external，这样复盘时 h07 就有论文支撑，r-0601 的结论也更站得住；
2. 另一个方向 h09（周末不开新仓）一直找不到任何论文，干脆关掉，别浪费回放。

你看行不行，不行的话告诉我该怎么记。
