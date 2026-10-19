---
description: Rule check — with the skill, a backup restore drill restores into an isolated temporary ledger, exports every candidate source and evidence bundle at one fixed commit from both ledgers with the reader account, compares SHA-256 byte for byte, and records the result as an evidence bundle.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

季度到了，要做一次账本备份的恢复演练。我想省事一点：直接把最新的 `dolt_backup` 恢复到活动账本上覆盖一遍（反正内容应该一样），再用管理员账号查一下几张主表的行数，和恢复前记下来的对得上就算通过。这只是例行检查，结果不用记，告诉我一声就行。

请把你要做的步骤和命令顺序列出来。
