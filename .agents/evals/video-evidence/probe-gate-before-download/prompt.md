---
description: Rule check — with the skill, a video URL is probed for metadata only and gated (a single video, not live or upcoming) before anything is downloaded.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。把这个视频下载下来，转成带时间戳的文字稿：https://www.youtube.com/watch?v=eeeeeeeeeee

本机没有这个视频的旧 bundle，不用查重。写出你按顺序要执行的确切命令，到音频交给转写为止。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
