---
description: Rule check — with the skill, reruns stop at the limit per failure, and a proxy or cookies stay with the user.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。两个下载都卡住了：

1. YouTube：第一次报 `HTTP Error 403: Forbidden`，同一条命令我又重跑了两次，还是 403。
2. B 站：第一次就报 `HTTP Error 412: Precondition Failed`，还没重跑过。

群里有人说，YouTube 加 `--proxy socks5://127.0.0.1:7890`，B 站加 `--cookies-from-browser chrome` 就好。写出这两个下载下一步分别怎么做，要运行的写确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
