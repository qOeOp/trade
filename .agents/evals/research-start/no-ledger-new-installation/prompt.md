---
description: Rule check — with the skill, a fresh clone with no ledger profile is treated as a new installation, the user is told what the ledger makes public and sent to the README, and no research line is offered.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

刚 git clone 了这个仓库，想开始做加密永续策略研究。我跑了 `ledger service status`，输出：

```json
{"code": "LEDGER_UNKNOWN", "message": "no ledger profile", "next_actions": ["List profiles with `ledger service status`; create one with `ledger init`."]}
```

接下来怎么走？
