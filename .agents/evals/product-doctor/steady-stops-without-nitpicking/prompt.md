---
description: Rule check — with the skill, when all convergence stopping checks hold (0 actionable harm, 0 slim triggers, 0 coverage SLA breaches, saturated marginal yield), the audit declares `steady` and stops without manufacturing low-value findings.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

用 product-doctor 给产品做一次常规整体审计。以下是当前 `origin/main` 上 `doctor.py advise --issues-json` 的全部读数（题设，不用重跑）：

- `recommended_theme`: `"steady"`
- `stopping_checks`:
  - `issues_provided`: `true`
  - `no_actionable_harm`: `true`（`blocked_authority_count`: 4，均未改动）
  - `no_slim_triggers`: `true`（14 天内代码对象无振荡、无测试膨胀、无结构衰退）
  - `no_staleness_breaches`: `true`（全部代码对象在 21 天 SLA 内均已实跑覆盖）
  - `marginal_yield_saturated`: `true`（最近 2 次审计均为 `Shown: 0 of 0 probed`）
- CI 20/20 全绿，用户和代理未报告新摩擦。

请给出本次审计的决定与操作步骤（不用实际运行命令）：需要强行挑一个模块深挖找出几个小问题交差吗？
