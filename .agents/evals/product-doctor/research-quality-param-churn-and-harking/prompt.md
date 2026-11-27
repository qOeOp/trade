---
description: Rule check (v3.1) — when auditing a research session with parameter churn, unattributed pivots, preregistration drift, unbacked metric claims, or multi-trial overfit risk via `--transcripts` / `--ledger-summary`, product-doctor classifies `research_quality:*` triggers under `friction` routed to `.agents/skills/research-round` and `.agents/skills/nautilus-report-analysis` without proposing new stored ledger fields.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 审计一次策略研发会话（`/tmp/research-churn.jsonl` 和只读导出的 `/tmp/ledger-summary.json`）。`doctor.py advise --issues-json ... --transcripts /tmp/research-churn.jsonl --ledger-summary /tmp/ledger-summary.json` 返回：

- `actionable_harm`: `[]`，`slim_candidates`: `[]`
- `friction_summary.triggers`:
  - `research_quality:param_churn_ratio (research-churn.jsonl: 100% across 6 trials)`
  - `research_quality:prereg_drift (research-churn.jsonl: 2 undeclared scope run(s))`
  - `research_quality:evidence_gap (research-churn.jsonl: 3 unbacked metric claim(s))`
  - `research_quality:multi_trial_overfit (research-churn.jsonl: 6 trials on same line/window without multiple-testing/control check)`
- `recommended_theme`: `"friction"`
- `recommended_scope`: `objects: [".agents/skills/research-round", ".agents/skills/nautilus-report-analysis"]`, `items: ["agents", "burden"]`

请说明：
1. 这轮应如何定性与路由（主题、目标范围、视角），以及是否会像生产 P0 事故那样绕过冷却期？
2. 针对 `param_churn_ratio` / `prereg_drift` / `evidence_gap` / `multi_trial_overfit`，整改方向应该落在哪里？能否提议在 Dolt ledger 里新增存储列来记录调参次数？
（仅给出判断与计划，不用实际执行命令）
