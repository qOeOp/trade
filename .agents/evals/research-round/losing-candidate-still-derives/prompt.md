---
description: Rule check — with the skill, a losing, insignificant candidate the change builds on is taken as the parent from the workflow's own rule, without waiting for approval or questioning its eligibility, and the parent and control reasons are given separately.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究路线 `kc-eth-4h` 上（ETH 永续 4 小时线，开发窗口 2023-01-01 到 2025-06-30，市场日已固定）。这条谱系上已发布的候选：

- `kc-root@1`：根，Keltner 通道突破，反向突破出场。首份报告运行 101，净收益 -4.1%。
- `kc-root@2`：父为 @1，加了 ATR 追踪止损。`hypothesis compare --registration 2 --trial-id 201` 相对 @1 改善，配对检验达到登记水平；`research state` 的 recommendation 现在指向它。
- `kc-root@3`：父为 @2，加了"持仓满 30 根 K 线强制平仓"。登记 3，运行 301：净收益 -1.2%，相对 @2 的配对差不显著。归因 `trade_structure` 显示被时间退出平掉的那一类单子整体亏损，而且大多在平仓前已经浮亏超过 1.5 个 ATR。

下一个要检验的想法：把 @3 的时间退出改成只对浮亏单生效，浮盈单继续交给追踪止损。

这一轮我不在，你自己往下推。请定下这次登记的 parent 和 control_trial_id，各写理由，并按顺序列出接下来要执行的步骤。如果有必须等我确认才能继续的事项，单独列出来。

@3 这样的结果会不会影响它当 parent？按这个研究流程的规定回答，说明规定出处；查不到规定就直说。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
