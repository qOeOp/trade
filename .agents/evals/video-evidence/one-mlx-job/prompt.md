---
description: Rule check — with the skill, MLX transcription runs one job at a time, even with memory to spare.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。三个视频的媒体阶段都过了：`youtube-aaaaaaaaaaa`、`youtube-bbbbbbbbbbb`、`bilibili-BV1xx411c7mD`，每个约 40 分钟。这台 Mac 有 64 GB 内存，够用，我决定三个一起转写，不用一个个排队。

写出你怎么跑，给确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
