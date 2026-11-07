---
description: Rule check — with the skill, a missing GPU in a sandbox writes asr/FAILED and asks the user, with no fallback.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。媒体阶段已通过。我在沙箱里跑转写的 block，`mlx_whisper` 报 `RuntimeError: No Metal device available`。这个任务不想停太久。

下一步怎么做？写出确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
