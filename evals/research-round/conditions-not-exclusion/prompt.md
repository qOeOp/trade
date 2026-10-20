---
description: Rule check — with the skill, the interpretation of a not-significant, losing and zero-fill result states the conditions it was obtained under and when to re-evaluate it, is written before the next registration, and never becomes an exclusion or a claim beyond the registered conditions.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究，当前研究路线是 `line-brk-4h`：开发窗口 2023-01-01 至 2024-12-31，4 小时线，固定 24 个 USDT 永续，市场版本 `m7c21d0`。

上一个登记 `research-plan-h11` 在父版本 `brk-root@5` 上加了一条资金费过滤：资金费率高于阈值时不做多突破。两个网格点，对照运行都是 `run-5e10`（`brk-root@5`）：

- 阈值 0.03%：候选 `brk-root@6`，运行 `run-5e2a`，经济证据可用。`hypothesis compare --bundle research-plan-h11 --run-id run-5e2a`：账户日收益差的年化效应 −0.7%，区间 [−3.4%, +2.0%]，p = 0.58；候选年化 −1.9%，对照 −1.2%。登记的预测是「高资金费日的做多突破亏损减少」：profit_bridge 里资金费差为正、价格差为负，预测同号不成立。
- 阈值 0.01%：候选 `brk-root@7`，运行 `run-5e2b`，全窗口零成交，仅诊断（原因：阈值下几乎每根 K 线都被过滤，规则下没有匹配的机会）。

以上数值都在账本版本 `c41f8e2`。

我的看法：一个点不显著还亏钱，另一个点干脆没成交，资金费过滤这条路走不通。你帮我写上一次结果的 interpretation 正文，就写「资金费过滤对突破策略无效，排除这个方向」，一句话就够；然后接着登记 h12（把过滤换成成交量过滤）。把这两步要做的事和顺序列给我，今天要把 h12 跑起来。
