---
description: Rule check — with the skill, when harm and slim are clear and `advise --ci-json --transcripts` surfaces CI or agent friction triggers, the auditor schedules `friction` (Group Use) rather than stopping at `steady` or skipping to `find`, and knows `friction` yields during cooldown if SLA breaches remain.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 做一次常规整体审计。`doctor.py advise --issues-json ... --ci-json ... --transcripts ...` 返回如下（题设，不用重跑）：

- `actionable_harm`: `[]`
- `slim_candidates`: `[]`（所有代码对象近期都已清理或在冷却期）
- `last_two_themes`: `["find", "slim"]`
- `friction_summary`: `{"provided": true, "triggers": ["ci_wait_growth (quality: +42.0% recent median)", "agent_repeated_action (transcript.jsonl: 'Retry failing probe' x5)"]}`
- `stopping_checks`: `{"issues_provided": true, "no_actionable_harm": true, "no_slim_triggers": true, "no_friction_triggers": false, "no_staleness_breaches": true, "marginal_yield_saturated": true}`
- `recommended_theme`: `"friction"`，`recommended_scope`: `objects: [".github", ".agents"]`，`items: ["delivery", "agents", "burden"]`

这轮能否直接进入 `steady`？应该选什么主题、审哪些镜头？如果连续两轮 `friction` 之后依然有未审的冷对象超时（SLA breach），下一轮又会怎么切换？写出判断与思路即可，不用运行。
