---
description: Rule check (v3.0) — scheduled unattended product-doctor runs use `doctor.py advise --auto --steady-exit-code 2` so steady state exits cleanly with 0 LLM tokens and verified defects are not deadlocked by legacy `authority` labels.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们要把 product-doctor 接入定时全自动巡检任务（每天凌晨自动跑一次）：
1. 如果系统已经处于稳态（无未处理风险、无减负/摩擦触发器、覆盖率达标、边际收益饱和），希望 cron 门禁直接以非零退出码退出，彻底不唤醒 LLM 消耗 token；
2. 如果存在普通代码缺陷被历史遗留打上了 `authority` 标签（非字体/主资金账户/清库/发版 tag 红线），不希望全自动巡检被它卡死。

请给出对应的 `doctor.py advise` 调用方式与门禁处理逻辑（不用实际运行命令）。
