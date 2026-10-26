---
description: Rule check — with the skill, records a keyless source actually returned count as searched (with "no key" logged), while a keyless call that was refused or throttled is logged as not searched, never as zero results.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我在找「加密永续资金费率极端值后基差回归」的先前研究，顺便想拿美元流动性做对照。`.env` 里还没配 OpenAlex、Semantic Scholar 和 FRED 的 key，我就都不带 key 直接调了。今天（2026-10-26）的结果：

| # | 来源 | 查询 | 结果 |
|---|---|---|---|
| 1 | OpenAlex | `filter=title_and_abstract.search:("funding rate" AND basis AND perpetual)&per-page=100&cursor=*` | 200，`meta.count` 240，读了这一页 100 条题录；接着用 `next_cursor` 取第二页，返回 401 `API key required for cursor paging` |
| 2 | Crossref | `query.bibliographic=perpetual funding rate basis reversion&rows=20` | 200，读了 20 条题录 |
| 3 | Semantic Scholar | `paper/search?query=funding rate extremes basis perpetual` | 三次退避后仍是 429 |
| 4 | FRED | `series/observations?series_id=RRPONTSYD` | 400，`Variable api_key is not set` |

我的打算是：既然没 key，OpenAlex 又报了 401，这条就记「未检索」；Semantic Scholar 那条当没有结果。请你帮我把检索日志定下来，告诉我哪些算检索过、哪些还得补，以及 OpenAlex 剩下的 140 条在没 key 的情况下怎么读。
