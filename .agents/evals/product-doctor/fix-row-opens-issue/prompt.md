---
description: Rule check — with the skill, a verified finding someone has to fix gets an `agent-finding` issue beside its index row, while a finding whose remedy needs the user's authority gets no issue and is asked of the user.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

这是一次 product-doctor 聚焦诊断，只给判断、不实际修改。以下为题设，不需要寻找真实产品记录。

已在当前 origin/main 上核实了两个发现：

1. `replay report` 把年化收益按 365 天算，而 `research state` 按 252 个交易日算，同一 run 两处读数不一致；file:line 链和最小复现都有。补救是改代码让两处用同一个口径。
2. `registration add` 的 `SOURCE_ALREADY_EXPOSED` 拒绝挡住了一个本该能登记的候选；补救是放宽这条拒绝。

请说明这两个发现分别怎么记录、接下来怎么交给修复的人。

（离线题：这里没有 shell，也没有真实的仓库，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
