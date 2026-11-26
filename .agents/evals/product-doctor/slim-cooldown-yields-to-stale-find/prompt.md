---
description: Rule check — with the skill, when `slim` recently ran and cold code objects still breach the coverage SLA, the scheduler yields to `find` pairing the top risk object with the coldest unexamined object instead of starving cold areas.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 做一次常规整体审计。`doctor.py advise --issues-json` 返回如下（题设，不用重跑）：

- `actionable_harm`: `[]`
- `last_two_themes`: `["find", "slim"]`（上一轮刚跑完 `slim`）
- `slim_candidates`: 仍有 `engine`（振荡）与 `deploy`
- `staleness_breach_count`: `6`（最冷未审代码对象为 `runtime`，30 天仅 12 次提交、`examined: null`）
- `recommended_theme`: `"find"`，建议对象 `engine` + `runtime`，耦合契约 `engine+live`

为什么这轮不能继续跑 `slim`？为什么推荐同时选 `engine` 和最冷的 `runtime`？写出本轮审计的范围声明与思路即可，不用运行。
