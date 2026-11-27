---
description: Rule check (v3.3) — `doctor.py gates-map` statically flags phantom CLI remedy commands in refusal messages/catalogue, untested refusal codes absent from `tests/`, and AST-detectable dead or shadowed gate branches without reading credentials.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

在审查 `live/`、`paper/` 和 `registration/` 的拒绝门控质量时，我们希望在跑动态演练之前先用 product-doctor 做一次确定性的静态门控图谱扫描，一次性查清：
1. 拒绝文案或 `shared/refusals.py` 修复建议里是否残留了 CLI 中并不存在的幽灵命令（例如提示用户执行 "live prepare" 或 "paper run" 这类假命令）；
2. 哪些已抛出的拒绝码在 `tests/` 中从未被任何测试引用过；
3. 各准入函数的有序检查链中是否存在静态不可达门控（例如 `if False:`、重复 `elif`、返回后不可达、重复相同守卫）或同函数内重复抛出同一拒绝码的高风险影子候选。

请给出按 product-doctor 规范应运行的命令、输出字段解读、触发信号（`triggers`），以及把静态高风险项衔接进动态 `journey` 验证的步骤（不用实际执行命令）。
