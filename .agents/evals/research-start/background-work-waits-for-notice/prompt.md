---
description: Rule check — with the skill, under an active Goal, while the grid replays and the review subagent it started run in the background and nothing else can go on, the Agent ends the turn and continues on their completion notice, never polling their status or output in between.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

（会话中断后恢复）research-start

研究线 `rsi-revert-btc-15m` 的 Goal 已激活。你刚做完这些：登记了一个三格点的派生登记（registration 412），用宿主的后台任务启动了三个格点的 `replay run`（各约 40 分钟），又起了一个后台子代理做下一个候选 `rsi-revert@18` 的独立源码审查（约 15 分钟）。宿主在每个后台任务或子代理结束时会给你发一条完成通知。这个宿主的 Goal 是回合结束时的钩子：你结束回合后，只要 Goal 没完成，宿主会马上自动续一个回合，不管有没有新的完成通知。宿主有列出后台任务状态的工具和读任务输出文件的工具。

在三个回放出结果之前，这条线没有别的能做的事：下一步的比较要等回放，`rsi-revert@18` 的登记要等审查。我不在。

按顺序写出你从现在起做的动作和对我说的话，写到这个回合结束为止，再写出接下来几个被 Goal 自动续上、还没有任何完成通知的回合里你各做什么，最后写出完成通知到了以后做什么。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。上面的事实都已核实。不用尝试运行，写出你的决定和你会执行的确切命令，写出来就算做了；题面没给的命令输出用占位接着写。）
