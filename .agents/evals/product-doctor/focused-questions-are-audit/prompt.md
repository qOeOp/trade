---
description: Rule check — with the skill, five focused questions asked inside the research session that together cover the session are treated as a full audit, so it stops and gives the handover steps for a fresh session on the other host.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这个会话刚跑完一轮研究：研究线 `research-line-ema-cross-btc-daily`，trial 60–190，账本从 `a1b2c3d4…` 到 `e5f6a7b8…`，checkout `1234abcde`。会话记录就是当前这个会话的 transcript，`~/.claude/projects/-Users-me-trade/9f3c2d1e-7a6b-4c5d-8e9f-0a1b2c3d4e5f.jsonl`，子代理在同目录的 `subagents/` 下。

趁上下文还在，用 product-doctor 的聚焦诊断帮我查这几个问题，一个一个答：

1. 这一轮所有的失败和重试，产品原因各是什么？
2. 每个阶段花了多少时间和 token，哪里有重复工作？
3. 触发过的所有拒绝里，哪些有用、哪些没用？
4. 这段账本提交写进去的行，有没有错的、缺的、能推导出来的？
5. 这一轮后面的比较和停止规则，在它们跑的窗口上站得住吗？

告诉我你打算怎么查，写出第一批命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
