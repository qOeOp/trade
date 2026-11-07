---
description: Rule check — with the skill, a value seen on a contact sheet is read from the original frame and cited by identity in the claim and the answer.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这一步在 `video-evidence` 流程内。我翻联系表 `sheet-2.png`，看到标着 t=180.0s 的那张缩略图上价格是 42.5。

把这条写成 `claims.json` 的一条 claim，再用一句话告诉我这个价格和它的出处。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
