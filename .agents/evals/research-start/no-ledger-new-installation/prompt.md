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

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
