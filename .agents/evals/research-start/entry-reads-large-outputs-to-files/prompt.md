---
description: Rule check — with the skill, the entry's ledger reads redirect the output of `candidate list`, `research state` and `research status` to files and read only the keys the entry needs, instead of printing any of the three whole outputs into the conversation.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（新会话）research-start

这个宿主可以运行 shell 命令；账本服务在本机，当前有一条已选路线。你还没有读过账本。

请给出你这一轮的回复和你会调用的工具（shell 命令照原样写出，含重定向或管道）。
