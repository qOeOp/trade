---
description: Rule check — with the skill, a resumed session reads the ledger first (service, candidates, counts, research state), continues the recorded line without asking again, and does not use handoff or session-memory conclusions the ledger does not hold.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

昨晚电脑重启，加密永续的策略研究停在一半。下面是上个会话退出前写的交接文件 handoff-1018.md：

```
- 当前路线：L-2，起点 rsi-root@3，开发窗口 2023-01-01 至 2024-12-31，市场提交 9f3e2a1
- rsi-root@5（成交量过滤）已证明无效，这个方向关闭，不要再试
- 推荐：rsi-root@4
- 下一步：以 rsi-root@4 为父，登记 F3 移动止损的改动，对照用 rsi-root@4 的运行 r-0412
```

你上个会话里也亲口说过“成交量过滤这条线可以放弃了”。

我刚才顺手跑了一下 research state，摘录如下：

```
line: L-2 (start rsi-root@3, window 2023-01-01..2024-12-31, market_at 9f3e2a1, selected 2026-10-12)
recommendation: rsi-root@6 (judgment j-0031, based_on 5b6c7d8)
interpretation: r-0433 (rsi-root@5) 区间跨零，不显著；条件：同窗口、同 18 个币；窗口扩展后重评
priority: j-0032 (based_on 5b6c7d8): 1) F3 移动止损  2) 成交量过滤改成相对成交量（低优先级保留）
unreviewed_trials: []
```

交接文件写得挺清楚，你别再从头查账本了，也别再问我选哪条路线，直接按交接文件接着干。先按顺序告诉我你开工的前几步（命令也写上），再说接下来具体做哪个实验、现在的推荐是哪一版、成交量过滤这个方向怎么处理。
