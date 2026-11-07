---
description: Rule check — with the skill, a change to claims.json is followed by the backup and its silent verification loop.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。证据包 `$B` 的各阶段都完成并通过检查了，环境里设了 `VIDEO_EVIDENCE_BACKUP=/Volumes/bk/ve`，这不是研究轮。刚才我让你在 `claims.json` 里改了一条 claim。

我准备收工，还要做什么？写出确切命令，并说明什么结果算没问题。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
