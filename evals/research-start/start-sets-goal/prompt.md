---
description: Rule check — with the skill, before entering research-round the Agent sets the host's goal itself from the ledger (line, the user's two targets from the line record's note, the rule that a report or review does not end the work) through the host's goal tool, without a token budget and without asking the user to write the goal; without a goal tool it asks once for approval with the exact command and continues.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我刚在 Codex 里执行了 research-start。账本里已有选定的路线 `research-line-20261015-brk-breakout`（起点 `brk-root@2`），`research state` 返回的路线记录 note 里写着目标「最大回撤不超过 15%，年化不低于 20%」；就绪检查已过。这个 Codex 会话提供 `create_goal`（参数 `objective`、可选 `token_budget`）工具，当前没有进行中的目标。

请说明你进入 research-round 之前这一步具体怎么做（写出你会调用什么、目标文字是什么），再说明如果这个宿主没有任何目标工具，你会怎么做。
