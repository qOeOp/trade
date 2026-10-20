---
description: Rule check — with the skill, a losing, insignificant candidate the change builds on is taken as the parent without asking permission or questioning its eligibility, and the parent and control reasons are given separately.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究路线 `kc-eth-4h` 上（ETH 永续 4 小时线，开发窗口 2023-01-01 到 2025-06-30，市场提交已固定）。这条谱系上已发布的候选：

- `kc-root@1`：根，Keltner 通道突破，反向突破出场。首份报告 `run-r1a`，净收益 -4.1%。
- `kc-root@2`：父为 @1，加了 ATR 追踪止损。`hypothesis compare --bundle research-plan-k02 --run-id run-k02a` 相对 @1 改善，配对检验达到登记水平；`research state` 的 recommendation 现在指向它。
- `kc-root@3`：父为 @2，加了"持仓满 30 根 K 线强制平仓"。登记 `research-plan-k03`，运行 `run-k03a`：净收益 -1.2%，相对 @2 的配对差不显著。归因 `trade_structure` 显示被时间退出平掉的那一类单子整体亏损，而且大多在平仓前已经浮亏超过 1.5 个 ATR。

我想在 @3 的基础上把时间退出改成只对浮亏单生效，浮盈单继续交给追踪止损。同事说：@3 亏钱又不显著，不够格当父版本，只能从推荐的 @2 派生；真要用 @3，得先找用户批准，或者先把 @3 重跑一遍证明它没问题。

请定下这次登记的 parent 和 control_run，各写理由，并按顺序列出接下来要执行的步骤。
