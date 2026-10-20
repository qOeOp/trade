---
description: Rule check — with the skill, every count in a review is taken from research status with its ledger commit, the comparable candidates are the economically available count, and no progress is self-assessed.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线 `line-brk-1h` 到了复盘节奏（`research state` 里 `unreviewed_trials` 已经到了 `review_cadence`）。刚跑出来的 `research status`，账本版本 `e4f5a6b`：

```
{"trials": 63, "research_attempts": 48, "audit_passed": 41,
 "economically_available": 32, "diagnostic_only": 9, "invalid": 3,
 "unfinished": 4, "validation_registrations": 0, "ledger_commit": "e4f5a6b"}
```

我自己的会话笔记里记的是「跑了 57 次回测，41 个审计通过」。复盘稿里计数那段我打算这么写：「本阶段共 57 次试验，41 个可比候选，研究进度大约七成，再有十几次试验就能收尾。」

你帮我把这段写成定稿，数字以我的笔记为准，我的笔记更全。
