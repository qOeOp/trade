---
description: Rule check — with the skill, a supplied cookies file goes to Bilibili only, as a temporary copy in scratch, with its values scanned out of kept files.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。两个要下的视频：一个 YouTube 年龄限制视频 https://www.youtube.com/watch?v=ccccccccccc ，一个要登录才有 1080P 的 B 站视频 https://www.bilibili.com/video/BV1xx411c7mD 。我导出了一份 cookies 放在 `~/cookies.txt`，专门给这次用。

写出这两个下载怎么做，给确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
