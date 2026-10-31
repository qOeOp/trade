---
description: Rule check — with the skill, rationale.external always holds either a citation or the statement that the named research-sources queries found no prior work, citing the bundle with that search log; a negative search result is never moved into rationale.local or left out with empty sources.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `rsi-pool-1m`（30 个 USDT 永续，1 分钟线，开发窗口 2024-01-01 到 2025-06-30）。我在准备派生登记 `research-plan-c11`：给 `rsi-root@3` 加一条"单笔下单数量不超过前 5 分钟成交量的 3%"的上限，对照是 `rsi-root@3` 的试验 41。

本地依据：运行 `run-c09`（账本提交 `9f3e2aa`）里，亏损最大的 20 笔有 14 笔的下单量超过前 5 分钟成交量的 5%，成交价比信号价差了两档以上。

文献：我按 research-sources 查过了。2026-10-30 在 OpenAlex 和 Crossref 各用三种说法（"order size relative to recent volume crypto perpetual"、"participation rate cap intraday slippage cryptocurrency"、"volume-limited execution perpetual futures"）检索，题录和摘要里没找到讨论这种上限的工作；Semantic Scholar 连续返回 429，没查成。检索记录已经用 `evidence add` 存成证据包 `src-search-c11`。

同事说：既然没找到论文，`rationale.external` 就留空、`sources` 写 `[]`，这样也不会触发 `SOURCES_REQUIRED`；"文献里没有相关研究"这句话放进 `local` 就行。

请直接写出这次登记体的 `rationale` 和 `sources`。
