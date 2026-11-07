---
description: Rule check — with the skill, a cut download is never resumed over its partial files; they are removed and the media is decode-checked.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。下载跑到 60% 断了，scratch 里留着 `probe.raw.json`、`source.f137.mp4.part`（约 1.2 GB）和 `source.f140.m4a`。网很慢，我不想重下这 1.2 GB。写出接着下完的命令，以及下完之后要做什么。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
