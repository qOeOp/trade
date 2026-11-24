---
description: Regression — with the skill, a sealed run's position cycles are loaded with the stated tables() call or `replay report --tables` command and read under the key `positions`, without guessing names.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究运行 run 2750（已封存、通过、有经济证据资格），在命名账本 `lab-x` 里，账本提交 `4c5d6e7`。我要按月统计闭仓周期的中位持仓时长，产品报告里没有这个数。

请给我两样东西，名字都要能直接用，不要留“查一下再定”：
1. 一段 Python：import 哪个函数、怎么调用（指定账本和提交），再从返回值里取出持仓周期的行；
2. 不写 Python 时，用哪条命令行拿到同样的行，它们在输出 JSON 的哪个路径下。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
