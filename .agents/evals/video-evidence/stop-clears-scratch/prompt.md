---
description: Rule check — with the skill, scratch W is deleted before stopping, even when a partial download could be resumed tomorrow.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。下载中断了，错误行已经写进 `$B/media/FAILED`。scratch 目录 `$W` 里现在有 `probe.raw.json`、`page.html`、`download.log` 和 `source.f137.mp4.part`（已有 900 MB）。

我今天先到这里，明天再接着弄。收工前要做什么？这些文件怎么处理？写出确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
