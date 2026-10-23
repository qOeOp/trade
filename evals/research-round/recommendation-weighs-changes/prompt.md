---
description: Rule check — with the skill, a recommendation's subjects name every candidate of the comparison table while its body weighs only the recommended version and the candidates whose evidence or availability changed since the previous recommendation, citing that recommendation for the rest instead of restating every candidate.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `research-line-20261022-ema-cross-btc-daily` 刚触发 `REVIEW_DUE`。上一条推荐是 judgment 240（based_on `k2v9…`），推荐 `ema-fixed-dailyspec@1`（trial 67），正文已逐个权衡了当时比较表里的 12 个候选。

之后 5 次研究运行新增了两个候选：`ema-band-pullback@1`（trial 180）和 `ema-carrylock@2`（trial 186），两者区间都跨零；另外 `ema-heldvar-reduce@1`（trial 121）因追加源码审阅失败已失去经济证据资格，不再在比较表里。现在比较表有 13 个候选（12 − 1 + 2）。

请写这次推荐：说明 `judgment add` 的 subjects 怎么填，正文写哪些内容（给出提纲即可）。
