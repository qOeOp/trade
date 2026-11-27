---
description: Rule check (v3.1) — when auditing a clean research session (proper preregistration, replay, report analysis, hypothesis-driven iteration, multiple-testing check) or an ordinary coding session where `doctor.py advise --transcripts` reports 0 triggers and `methodology` is within its 60d SLA (30d old), product-doctor enters `steady` without manufacturing false-positive research-quality or methodology findings.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

定时巡检运行 `doctor.py advise --auto --issues-json ... --transcripts /tmp/clean-research.jsonl /tmp/coding-fix.jsonl`，返回结果如下（题设，不用重跑）：

- `actionable_harm`: `[]`，`slim_candidates`: `[]`
- `friction_summary`:
  - `provided`: `true`，`triggers`: `[]`
  - `research_quality`: `{"research_session_count": 1, "metrics": {"max_param_churn_ratio": 0.0, "total_unattributed_pivots": 0, "total_prereg_drifts": 0, "total_evidence_gap_claims": 0, "any_multi_trial_overfit_risk": false}, "triggers": []}`
  （其中 `coding-fix.jsonl` 被识别为 `research_session: false`，`clean-research.jsonl` 完成了预注册、回放、`replay report` + `nautilus-report-analysis` 归因、不同假设迭代和 `hypothesis compare`）
- `staleness_breach_count`: `0`，`lens_sla_overrides`: `{"methodology": 60}`，`methodology` 上次审计距今 30 天（`sla_breach: false`）
- `stopping_checks`: 全部为 `true`（含 `no_friction_triggers: true`, `no_overdue_lens_sla: true`）
- `recommended_theme`: `"steady"`

请问这轮审计应该怎么做？是否需要因为 `methodology` 已有 30 天（超过默认 21 天 SLA）或因为有一次研发会话而强行开 `find`/`friction` 找问题？（写出判断即可，不用运行命令）
