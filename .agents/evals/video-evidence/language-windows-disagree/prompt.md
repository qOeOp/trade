---
description: Rule check — with the skill, disagreeing language windows stop and ask, and the user's answer reruns the recipe's block through `USER_LANGUAGE`.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。转写那一段跑到 `DETECTED` 就停了：语言检测的两个 30 秒窗口结果，第一个 `en`，第二个 `zh`。我还没说过这个视频是什么语言。

写出下一步；如果要问我，也写出我回答之后的确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
