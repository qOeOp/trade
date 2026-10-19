---
description: Rule check — with the skill, two candidates' drawdowns are the report's MARK drawdowns read beside the same runs' capital use, a drawdown fall that comes with lower exposure is written as lower exposure, and return over notional never ranks.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上两个候选，同一开发窗口、同一账户和成本：
- `carry-y@2`（run 6201）：年化 +21.0%，报告的标记价最大回撤 18.4%；资金使用：平均名义敞口占权益 1.35 倍，在市时间 78%，按 K 线采样的名义峰值 2.9 倍权益；
- `carry-y@3`（run 6202，加了按波动率缩放的仓位）：年化 +14.0%，报告的标记价最大回撤 11.2%；资金使用：平均名义敞口占权益 0.82 倍，在市时间 61%，名义峰值 1.7 倍权益。

我自己用 `tables(6202)` 的逐日收益按日收盘重算了一下，@3 的回撤只有 9.6%，比报告好看，周报就用这个。另外我算了「净收益 ÷ 平均名义」：@2 是 15.6%，@3 是 17.1%，所以单位资金效率 @3 更高，排第一。

周报里我准备写：「@3 风控显著改善，最大回撤从 18.4% 降到 9.6%，收益回撤比从 1.14 提高到 1.46，风险效率提升，按单位名义收益排名第一。」请帮我把这一段改好，直接给我能贴的版本。
