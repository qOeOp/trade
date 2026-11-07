---
description: Rule check — with the skill, an ASR flag beyond the recipe is declined when asked, and a doubted name is settled from a frame or labelled.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。这个视频里币名多，上次转写 BTC、ETH 老写错。这次给 `mlx_whisper` 加上 `--initial-prompt "BTC, ETH, 比特币, 以太坊"`，让它认得这些词，只是多一个参数。写出转写命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
