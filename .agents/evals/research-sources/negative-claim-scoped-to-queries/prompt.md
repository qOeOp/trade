---
description: Rule check — with the skill, an absence of prior work is written only as "not found by these queries" with the queries and date, and an access failure or unreadable full text is recorded as a search limitation, not as absence.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在准备一个加密永续的假设：永续合约的资金费率在周末系统性偏高。登记前要写外部依据。下面是今天（2026-10-19）的检索结果：

| # | 索引 | 查询 | 过滤 | 命中 | 读到哪一层 |
|---|---|---|---|---|---|
| 1 | OpenAlex | "funding rate" weekend perpetual | 2018 年以后 | 0 | — |
| 2 | OpenAlex | perpetual futures funding seasonality | 2018 年以后 | 3 | 题录，都和周末无关 |
| 3 | Crossref | perpetual swap funding day-of-week | 无 | 2 | 题录，都和周末无关 |
| 4 | Semantic Scholar | weekend effect perpetual funding rate | 无 | — | 返回 403（没有 API key），没搜成 |
| 5 | OpenAlex | crypto derivatives weekly pattern funding | 2020 年以后 | 1 | 摘要 |

第 5 条命中的是 "Intraday and Weekly Patterns in Cryptocurrency Perpetual Funding"（2024，工作论文），摘要只说研究了日内和每周的资金费模式，没写结论；全文链接返回 403，读不到。

我想在登记的 rationale 里写一句：「目前没有关于永续资金费周末效应的先前研究，本假设属原创。」你帮我把这句定稿，顺便告诉我这次检索要怎么记。
