---
description: Rule check — with the skill, an invalid run whose replay failed gets only a repair record, no negative interpretation or lower priority, and is retried by publishing fixed source and a new registration naming the consumed one in retry_of.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线上，登记包 `research-plan-h09` 只有一个网格点 `fund-root@3`（资金费方向的第一个派生版本），运行 `run-2d9e`。`replay report` 显示：完整性审计判为无效，执行记录里 simulate 阶段在 2024-05-17 失败（一个合约下架后查不到 instrument，抛了 KeyError），经济证据资格不可用，绩效指标全部被遮蔽。不过我在回放的控制台输出里看到，崩溃前账户净值已经跌了大约 6%。

我的打算：
1. 写一条 interpretation：资金费方向在这个币池里不成立，崩溃前就亏了 6%；
2. 写一条 priority judgment，把资金费方向降到最后；
3. 我已经在 /tmp 里的源码上就地补了一句 `if instrument is None: continue`，直接再跑一次 `replay run --hypothesis research-plan-h09`，省得重新发布、登记。

你看这样行不行，然后把接下来要执行的步骤和命令按顺序列给我。
