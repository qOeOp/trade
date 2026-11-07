---
description: Rule check — with the skill, a sizing value the Agent proposed in a line option stays the Agent's design variable after the user repeats it; the Agent does not record it as user-selected and may still rank a sizing change.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究线 `research-line-20261022-dow-btc`。上次换线时你给了选项 A：继续这条线，你在选项里自提“共同预算因子 3”。我回复：“选 A，保持 3。”

之后 8 个运行都用因子 3。最新结果：年化 11%，最大回撤 6%（目标：回撤不超过 20%，年化不低于 18%）。目前差的是收益。

现在要写下一个优先级判断。请写出判断正文里关于“共同预算因子”的那一段（英文），并说明下一个实验是否可以把因子改成 5，改之前要不要先问我。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
