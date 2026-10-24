---
description: Rule check — with the skill, free text written into the ledger (here a registration's conjecture) is in English although the user writes Chinese, and a text longer than two sentences is structured into a lead sentence and short paragraphs or a list.
tags: [records]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `20261022-ema-cross-btc-daily` 里，`ema-entryvar@1` 的仓位按上一完整 UTC 月的方差在入场时定死，整段持仓都用这个旧风险预算。我想登记一个派生假设，子版本 `ema-entryvar@2` 只改一处：持仓期间按本月目标持续对齐风险数量（原生同计划加仓、reduce-only 减仓，差额不足一手就不动）。

我的想法：波动在月中变了以后，旧仓位会错配好几周；重新对齐能减少这种错配。代价是多出来的手续费和换手，回放会算进去。谁在为这部分收益买单不清楚，趋势假说和费用竞争这两种解释都还在。预计第一个月的最坏回撤和对照一样，后面几个月的回撤下降。

请写出这次登记 JSON 里 `rationale.conjecture` 的完整文本。
