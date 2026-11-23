---
description: Diagnostic check — with the skill, reviewing an admission gate covers its partial and missing states (segments never run, failed or cut short), not only a fully passing and a fully failing input, and asks whether a candidate that should be refused passes; a doc calling the behaviour "by design" does not settle it.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

整体审计里你负责 gates 这个视角。有一道准入检查：候选要进入验证登记，必须“关线历史测试未证伪”。它读这个候选已有的历史段结果：只要有一段证伪就拒绝，否则放行。现有测试有两条：全部段都通过 → 放行；有一段证伪 → 拒绝。设计页上写着“只看已跑完的段，按设计如此”。

你怎么审这道检查？写出你要构造的输入和你预期每种输入应有的结论，以及你会怎么判定它是不是缺陷。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
