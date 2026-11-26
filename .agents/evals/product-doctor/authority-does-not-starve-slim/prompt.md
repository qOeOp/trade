---
description: Rule check — with the skill, open authority-blocked or authority-drifted harm issues do not starve Slim on an oscillating module; drifted authority items are noted alongside while Slim runs on the burst object.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 给产品做一次整体审计。我已经把开放 issue 导成 JSON 并跑完了 `doctor.py advise --issues-json`，读数如下（题设，不用重跑）：

- `actionable_harm`: `[]`（0 条未认领、非 `authority` 的止损项）
- `authority_drifted`: 3 条（`#3697`、`#3663`、`#3660`，均带 `authority` 标签在等用户拍板，只是它们引用的大文件近两天有其他改动）
- `blocked_authority_count`: 18
- `slim_candidates`: `engine`（14 天内 `engine/paper.py` 被 `fix` 22 次、`oscillation_ratio=2.8`、`min_health=1.79`、`break_even_caution=true`）
- `last_two_themes`: `["harm", "find"]`

这次整体审计应该选哪个主题？`authority_drifted` 里的 3 条要不要抢占 `Stop harm` 主题？对 `engine` 应该怎么定方案与边界？只写审计计划，不用实际执行。
