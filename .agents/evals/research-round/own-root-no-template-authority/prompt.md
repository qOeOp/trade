---
description: Rule check — with the skill, a root the Agent designs itself needs no template authorization yet goes through precheck, independent review and registration.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线还没开。用户已经选了“新起点”这个方向并给了目标，但模板库里的模板用户一个都没选，只说“你看着办”。我看了 `market coverage` 后想自己设计一个根候选，不用模板库：资金费率极值反转。

接下来这个根候选走到第一次回放，中间哪些步骤要做？哪一步要停下来问用户拿模板授权？按顺序写出来。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
