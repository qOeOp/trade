---
description: Diagnostic check — with the skill, a Human use review asks whether a researcher's questions are answered on screen together, reports figures the product computes but no page shows, and judges pages at realistic density rather than on a near-empty ledger, beyond checking that controls work.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

整体审计，你负责产品契约与交付里的 Human use。同事已经在自己的 `ide/ide.py serve` 上、用一个只有 1 个候选版本和 1 次回放的临时账本，把 IDE 的研究页逐个点过：所有按钮、切换、链接都能用，空状态和重载都正常，按尼尔森十条没挑出问题。他准备写“Human use：无发现”。

你另外知道这些（都已核实）：
- `replay report` 会算出逐年最大回撤和逐合约净盈亏，但研究页只显示整段的年化和最大回撤。
- 候选相对对照的差异只在 Details 面板里，候选自己的读数在另一个标签页，两者不能同时看到。

这一块可以按他写的结论收吗？如果不行，写出你会怎么审、报告什么。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
