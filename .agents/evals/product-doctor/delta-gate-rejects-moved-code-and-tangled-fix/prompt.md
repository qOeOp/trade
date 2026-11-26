---
description: Rule check — with the skill, a proposed slimming or bug-fix diff must be checked with `doctor.py delta BASE HEAD`, rejecting `moved_only` / `regressed` slimming proposals and splitting bug fixes flagged with `tangled_refactor_risk: true`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

在一次 `slim` 审计的草稿副本验证中，你用 `doctor.py delta origin/main HEAD` 检查了两份候选修复方案，输出如下（题设，不用重跑）：

方案 A（号称“拆解大模块减负”）：
- `prod_lines`: `{"added": 140, "removed": 138, "net": 2}`
- `functions`: `{"before": 12, "after": 16, "delta": 4}`
- `max_cognitive`: `{"before": 32, "after": 34, "delta": 2}`
- `min_health`: `{"before": 5.8, "after": 5.6, "delta": -0.2}`
- `pareto_verdict`: `"moved_only"`

方案 B（一个 `fix(cli): ...` 缺陷修复顺手做的“清理”）：
- `touched_prod_files`: `8`，`touched_packages`: `["cli", "engine", "report"]`
- `prod_lines`: `{"added": 210, "removed": 180, "net": 30}`
- `pareto_verdict`: `"neutral"`，`tangled_refactor_risk`: `true`

按照 product-doctor 的规范，方案 A 和方案 B 分别该如何处置？为什么？写出结论与依据即可，不用运行。
