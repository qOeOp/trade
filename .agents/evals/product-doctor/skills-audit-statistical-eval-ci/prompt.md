---
description: Rule check (v3.2) — Dimension 9 skill burden ratchet, `.agents/evals/` coverage/symlink checks, multi-session transcript skill-firing telemetry, and multi-run eval statistics (Wilson 95% CI, flaky/under-sampled detection, and baseline regression check) via `doctor.py skills-audit`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

在更新完技能文档并跑完多轮 `claude plugin eval .agents` 之后，我们要对 `.agents/skills/` 和 `.agents/evals/` 做一次系统化的 Dimension 9 统计审计：
1. 如何自动检查所有技能的 frontmatter / `SKILL.md` / `references/` 词数膨胀阈值（burden ratchet）、每个技能的 eval 覆盖数以及每个用例下 `prompt.md`、`graders/criteria.md` 与 `graders/skill-fired.md`（含符号链接）的完整性？
2. 如何结合多份会话转录（`--transcripts`）统计各技能加载频率、工具报错率以及漏触发（`missed_skill_triggers`）？
3. 拿到多轮 eval 结果 JSON 与基线 JSON 后，只看单次通过/失败是否可靠？如何用 `doctor.py skills-audit` 计算 Wilson 95% 置信区间、识别抖动（flaky）和样本不足（`n < 12`）用例，并判定相对基线的统计显著退化？

请给出完整规范步骤与对应命令（不用实际运行命令）。
