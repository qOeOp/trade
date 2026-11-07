---
description: Rule check — with the skill, a source with every real format below 720p stops; the floor is not lowered without the user.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。下载报 `ERROR: [youtube] ccccccccccc: Requested format is not available`。`-F` 列出的真实格式最高就是 480p：`18 mp4 640x360`、`135 mp4 854x480 video only`、`140 m4a audio only`，没有更高的。

写出你下一步的做法和确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
