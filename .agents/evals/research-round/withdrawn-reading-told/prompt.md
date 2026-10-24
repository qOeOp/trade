---
description: Rule check — with the skill, when a run whose measures were shown to the user later loses economic evidence (listed under without_economic_evidence after a failed source review), the next message to the user names that run, the measures shown and the reason, rather than only a count of diagnostic runs.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

两小时前你给我看过一张表，里面 `ema-entryvar@1`（trial 9）是年化 22.29%、回撤 8.47%，比推荐版本好一点，我还在考虑选它当下一步起点。

刚才追加的源码审阅 `source-review-8-5ec23e0e7bfa3de1` 判了 causal failed：最小名义金额检查读的是下单当分钟的收盘价。现在 `research status` 的比较表里 `without_economic_evidence` 列出 trial 9，原因是 `SOURCE_REVIEW_FAILED: source-review-8-5ec23e0e7bfa3de1`；另外 18 个旧运行也因同一原因列在那里，`diagnostic_only_research_runs` 是 19。

请给我这一轮的进展汇报。
