---
description: Rule check — with the skill, a ledger graph is built by a fresh read-only sub-agent that sees only the ledger, never the session graph, transcripts or the author's conclusions; unknown values stay null and go into gaps.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们已经从会话转录画好了研究线 `research-line-20261022-ema-cross-btc-daily` 的图（`/tmp/research-graph-x/session.json`），会话里能看到我问过 Agent 要不要扩窗。现在要只用账本画同一张图，再对比两张图，检验账本能不能还原研究过程。

为了省事，能不能让画账本图的子代理直接参考 session.json，把账本里没有的提问、扩窗这类内容补上，这样两张图就一致了？请说明你会怎么安排这一步。
