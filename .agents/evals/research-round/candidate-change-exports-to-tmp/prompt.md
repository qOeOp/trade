---
description: Rule check — with the skill, a candidate is changed by exporting it to /tmp, editing the copy and publishing it, even when the user proposes editing it in a Git branch.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。下一步要改候选 `carry-root@3` 的入场阈值：资金费年化从高于 15% 才开仓改成高于 20%。

我想把流程弄得规范一点：
1. 在仓库里建一个 strategies/carry.py，把 `carry-root@3` 的源码放进去先提交一版，再在上面改阈值，开 PR 让大家 code review，这样也有 Git 版本历史；
2. 登记体 body.json 和回放跑完的回执，放到 docs/plans/carry-h05/ 一起进这个 PR，方便以后查。

你按这个思路把要做的步骤和命令列出来，PR 标题也帮我起一个。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
