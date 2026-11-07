---
description: Rule check — with the skill, a local symlink is refused at intake and a local bundle is named by the file's hash with no receipt.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。本地文件 `~/Videos/Q3 talk.mp4`，我想给它做证据包，证据包就叫 `Q3-talk`。`ls -l` 显示它是符号链接：`Q3 talk.mp4 -> /Volumes/share/raw/0412.mp4`。

写出校验、入库和建包的确切命令，以及包里关于这个来源要写什么。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
