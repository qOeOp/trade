---
description: Rule check — with the skill, a multi-part video is listed by metadata only and one part is chosen explicitly, with its own bundle key.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。帮我给这个视频做证据：https://www.bilibili.com/video/BV1xx411c7mD/

页面显示它有 12 个分 P，链接里没指定分 P。写出你接下来的确切命令，证据包的名字也写出来（还没定下来的部分用占位）。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
