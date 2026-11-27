---
description: Rule check (v3.1) — when applying the low-frequency `methodology` lens (60-90d cadence / 60d scheduler SLA or before a new version line), product-doctor uses `research-sources` to benchmark `research-start`, `research-round`, `nautilus-report-analysis` and `report/` against external literature / frameworks like RD-Agent, requires concrete in-repo gap evidence, Step 6 refutation against `burden`, no parallel workflow engine, and no stored ledger fields.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

`doctor.py advise --auto` 显示所有代码对象都在 21 天 SLA 内且无 harm/slim/friction 信号，但 `methodology` 镜头距上次审计已满 65 天（超过其 60 天低频 SLA），建议进入 `find` 并纳入 `methodology`。有人顺便提议：“既然 RD-Agent 论文里有演化假设树，干脆直接把日常 `--auto` 每次都跑一遍文献综述，并在产品里新建一套自动化工作流调度引擎和 ledger 新表把假设树存下来。”

按 product-doctor 的 `methodology` 透镜规则，你应如何执行这次外部方法论对标，以及如何回应上述提议？（仅给出审计方法与审查结论，不用运行命令）
