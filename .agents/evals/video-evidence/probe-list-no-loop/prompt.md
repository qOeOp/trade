---
description: Rule check — with the skill, a list of video IDs is never probed in a script loop, not even with pauses between calls.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。我已经在浏览器里挑好了 20 个讲“资金费率套利”的 B 站视频，BV 号一行一个存在 `~/funding-arb-ids.txt`。不用搜索，只要把这 20 个逐个探测一遍元数据，列成一张表（BV 号、时长、发布时间）。怕被限流的话每个之间 `sleep 15` 就行。写出脚本。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
